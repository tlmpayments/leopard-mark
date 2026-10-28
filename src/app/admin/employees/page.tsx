import { Badge, Button, Card, Field, Flash, Input, Notice, Page, Select, StatusBadge, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { ROLES, ROLE_LABEL, hasRole } from "@/lib/authz/actor";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { listEmployees } from "@/lib/domain/employees/service";
import { listMarkets } from "@/lib/domain/markets/service";
import { grantRoleAction, offboardAction, provisionEmployeeAction, renameEmailAction, revokeGrantAction, setEnabledAction, setPinAction } from "../actions";

/**
 * Employees & access (REV-01/REV-17). The service enforces authority; the
 * page only avoids offering what the service would refuse: Owner authority
 * appears only for an Owner, a market-scoped Admin sees its own markets.
 */
export default async function EmployeesPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("employee.view");
  const manage = can(actor, "employee.manage");
  const isOwner = hasRole(actor, "owner");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const [employees, allMarkets] = await Promise.all([listEmployees(d), listMarkets(d)]);
  const adminMarkets = actor.grants.filter((g) => g.role === "admin").map((g) => g.marketId);
  const globalAdmin = isOwner || adminMarkets.includes(null);
  const markets = globalAdmin ? allMarkets : allMarkets.filter((m) => adminMarkets.includes(m.id));
  const grantableRoles = ROLES.filter((r) => r !== "owner" || isOwner);
  return (
    <Page title="Employees & access" subtitle="Company email + PIN signs people in; internal grants authorize. Exactly five roles. Disabling stops existing sessions on their next request.">
      <Flash {...flash} />
      <Notice tone="info">
        Provision by company email and give the person a temporary PIN (tell it to them directly — it is never shown again here); they choose their own PIN at first sign-in. A re-used address later belongs to a NEW person and inherits nothing — offboard the previous employee first (identity retired, PIN ended, grants revoked, history kept). Owner authority is granted only by an Owner; an Admin acts only inside its own markets and never on its own grants or PIN.
      </Notice>
      {manage ? (
        <Card title="Provision employee">
          <form action={provisionEmployeeAction} className="grid gap-3 sm:grid-cols-4">
            <Field label="Name">
              <Input name="displayName" required />
            </Field>
            <Field label="Company email">
              <Input name="email" type="email" required />
            </Field>
            <Field label="Initial role">
              <Select name="role" defaultValue="sales">
                {grantableRoles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={globalAdmin ? "Market (blank = all)" : "Market (your markets)"}>
              <Select name="marketId" defaultValue={globalAdmin ? "" : markets[0]?.id ?? ""}>
                {globalAdmin ? <option value="">All markets</option> : null}
                {markets.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Temporary PIN (6–12 digits; optional)" hint="They must change it at first sign-in.">
              <Input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6,12}" autoComplete="off" />
            </Field>
            <div className="sm:col-span-4">
              <Button small>Provision</Button>
            </div>
          </form>
        </Card>
      ) : null}
      <Card title="People">
        <ul className="divide-y divide-line">
          {employees.map((e) => {
            const current = e.identities.find((i) => i.current);
            const retired = e.identities.filter((i) => !i.current);
            const self = e.id === actor.employeeId;
            const targetIsOwner = e.grants.some((g) => g.role === "owner");
            const canTouch = manage && !self && (isOwner || !targetIsOwner);
            return (
              <li key={e.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{e.displayName}</span>
                    <span className="ml-2 text-xs text-muted">{current?.email ?? "no current identity (retired)"}</span>{" "}
                    {current ? (
                      e.credential ? (
                        e.credential.locked ? (
                          <Badge tone="danger">PIN locked until {fmtDate(e.credential.lockedUntil)}</Badge>
                        ) : e.credential.mustChange ? (
                          <Badge tone="warn">temporary PIN — must change at sign-in</Badge>
                        ) : (
                          <Badge tone="good">PIN set{e.credential.lastUsedAt ? ` · last sign-in ${fmtDate(e.credential.lastUsedAt)}` : ""}</Badge>
                        )
                      ) : (
                        <Badge tone="warn">no PIN — cannot sign in</Badge>
                      )
                    ) : (
                      <Badge>identity retired</Badge>
                    )}{" "}
                    {current?.googleSubject ? <Badge tone="info">Google bound</Badge> : null}
                  </div>
                  <StatusBadge value={e.enabled ? "active" : "inactive"} title={e.enabled ? "Enabled" : "Disabled"} />
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {e.grants.map((g) => (
                    <span key={g.id} className="inline-flex items-center gap-1">
                      <Badge tone="info">
                        {ROLE_LABEL[g.role]} · {g.marketId ? allMarkets.find((m) => m.id === g.marketId)?.code ?? "?" : "all markets"}
                      </Badge>
                      {canTouch && (g.role !== "owner" || isOwner) ? (
                        <form action={revokeGrantAction} className="inline">
                          <input type="hidden" name="grantId" value={g.id} />
                          <input type="hidden" name="reason" value="revoked from access page" />
                          <button className="min-h-6 px-1 text-xs text-danger hover:underline" aria-label={`Revoke ${ROLE_LABEL[g.role]}`}>
                            × revoke
                          </button>
                        </form>
                      ) : null}
                    </span>
                  ))}
                  {e.grants.length === 0 ? <span className="text-xs text-muted">no grants</span> : null}
                </div>
                {retired.length ? <p className="mt-1 text-xs text-muted">History: {retired.map((i) => `${i.email} (${i.endedReason ?? "ended"} ${fmtDate(i.endedAt)})`).join("; ")}</p> : null}
                {e.disableReason ? <p className="text-xs text-muted">Disabled {fmtDate(e.disabledAt)}: {e.disableReason}</p> : null}
                {canTouch ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-accent">Manage</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <form action={grantRoleAction} className="flex flex-wrap gap-1">
                        <input type="hidden" name="employeeId" value={e.id} />
                        <Select name="role" defaultValue="sales" aria-label="Role" className="max-w-[10rem]">
                          {grantableRoles.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </Select>
                        <Select name="marketId" defaultValue={globalAdmin ? "" : markets[0]?.id ?? ""} aria-label="Market" className="max-w-[8rem]">
                          {globalAdmin ? <option value="">All</option> : null}
                          {markets.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.code}
                            </option>
                          ))}
                        </Select>
                        <Button small variant="secondary">Grant</Button>
                      </form>
                      <form action={setEnabledAction} className="flex gap-1">
                        <input type="hidden" name="employeeId" value={e.id} />
                        <input type="hidden" name="enabled" value={e.enabled ? "false" : "true"} />
                        <Input name="reason" placeholder="Reason" aria-label="Reason" />
                        <Button small variant={e.enabled ? "danger" : "secondary"}>{e.enabled ? "Disable" : "Enable"}</Button>
                      </form>
                      {current ? (
                        <form action={setPinAction} className="flex flex-wrap gap-1">
                          <input type="hidden" name="employeeId" value={e.id} />
                          <Input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6,12}" autoComplete="off" required placeholder="Temporary PIN" aria-label="Temporary PIN" className="max-w-[9rem]" />
                          <Input name="pinAgain" type="password" inputMode="numeric" pattern="[0-9]{6,12}" autoComplete="off" required placeholder="Again" aria-label="Temporary PIN again" className="max-w-[6rem]" />
                          <Input name="reason" placeholder="Reason (e.g. forgot PIN)" aria-label="Reason" className="max-w-[12rem]" />
                          <Button small variant="secondary">{e.credential ? "Reset PIN" : "Set PIN"}</Button>
                        </form>
                      ) : null}
                      {current ? (
                        <form action={renameEmailAction} className="flex gap-1">
                          <input type="hidden" name="employeeId" value={e.id} />
                          <Input name="email" type="email" placeholder="New company email (same person)" aria-label="New email" />
                          <Button small variant="secondary">Rename</Button>
                        </form>
                      ) : null}
                      {current ? (
                        <form action={offboardAction} className="flex gap-1">
                          <input type="hidden" name="employeeId" value={e.id} />
                          <Input name="reason" required placeholder="Offboard reason" aria-label="Offboard reason" />
                          <Button small variant="danger">Offboard (retire identity, revoke all)</Button>
                        </form>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
    </Page>
  );
}
