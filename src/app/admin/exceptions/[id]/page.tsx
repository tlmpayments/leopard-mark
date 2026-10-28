import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Button, Card, Field, Flash, Input, KV, Page, Select, StatusBadge, Textarea, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { ROLES, ROLE_LABEL } from "@/lib/authz/actor";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { listEmployees } from "@/lib/domain/employees/service";
import { getExceptionDetail, linksForCases } from "@/lib/exceptions/service";
import { CATEGORY_LABEL } from "@/components/work-queue";
import { noteExceptionAction, reopenExceptionAction, transitionExceptionAction } from "../../actions";

export default async function ExceptionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const actor = await requireAction("exception.view");
  const d = await getDb();
  const detail = await getExceptionDetail(d, id);
  if (!detail) notFound();
  const { case: c, notes, children } = detail;
  // A case is visible only within the actor's market authority (REV-11); market-less cases (failed jobs) need unrestricted scope.
  if (c.marketId ? !can(actor, "exception.view", { marketId: c.marketId }) : !can(actor, "integration.view")) notFound();
  const links = (await linksForCases(d, [c.id])).get(c.id) ?? [];
  const flash = await flashFrom(searchParams);
  const manage = can(actor, "exception.manage", { marketId: c.marketId });
  const employees = manage ? await listEmployees(d) : [];
  return (
    <Page title={c.title} subtitle={<span className="flex gap-2"><Badge>{CATEGORY_LABEL[c.category] ?? c.category.replace(/_/g, " ")}</Badge><StatusBadge value={c.state} /></span>}>
      <Flash {...flash} />
      <Card title="Case">
        <KV
          items={[
            ["Cause", c.cause],
            ["Owner", c.ownerRole ? `${ROLE_LABEL[c.ownerRole]}${c.ownerEmployeeId ? ` · ${employees.find((e) => e.id === c.ownerEmployeeId)?.displayName ?? ""}` : ""}` : "unassigned"],
            ["Next action", c.nextAction],
            ["Waiting on", c.waitingParty],
            ["Review at", c.reviewAt ? fmtDate(c.reviewAt) : "— (D27 review cadence unselected)"],
            ["Severity", c.severity ?? "— (D27 unselected; set by a person)"],
            ["Opened", fmtDate(c.createdAt)],
            ["Resolution", c.resolution],
          ]}
        />
        {links.length ? (
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <span className="text-xs uppercase tracking-wide text-muted">Affects:</span>
            {links.map((l) =>
              l.href ? (
                <Link key={l.id} href={l.href} className="underline">
                  {l.label}
                  {l.relation ? <span className="text-xs text-muted"> ({l.relation})</span> : null}
                </Link>
              ) : (
                <span key={l.id}>{l.label}</span>
              ),
            )}
          </div>
        ) : null}
        {c.parentCaseId ? (
          <p className="mt-2 text-xs text-muted">
            Child of <Link href={`/admin/exceptions/${c.parentCaseId}`} className="underline">parent incident</Link>; resolving this never resolves the parent.
          </p>
        ) : null}
        {children.length ? (
          <ul className="mt-2 text-sm">
            {children.map((ch) => (
              <li key={ch.id}>
                <Link href={`/admin/exceptions/${ch.id}`} className="underline">{ch.title}</Link> <StatusBadge value={ch.state} />
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      {manage && c.state !== "resolved" ? (
        <Card title="Update">
          <form action={transitionExceptionAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="caseId" value={id} />
            <Field label="State">
              <Select name="state" defaultValue={c.state === "open" ? "acknowledged" : c.state}>
                <option value="acknowledged">Acknowledged</option>
                <option value="assigned">Assigned</option>
                <option value="waiting">Waiting</option>
                <option value="resolved">Resolved</option>
              </Select>
            </Field>
            <Field label="Owner role">
              <Select name="ownerRole" defaultValue={c.ownerRole ?? ""}>
                <option value="">—</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Owner (person)">
              <Select name="ownerEmployeeId" defaultValue={c.ownerEmployeeId ?? ""}>
                <option value="">—</option>
                {employees.filter((e) => e.enabled).map((e) => (
                  <option key={e.id} value={e.id}>{e.displayName}</option>
                ))}
              </Select>
            </Field>
            <Field label="Next action">
              <Input name="nextAction" defaultValue={c.nextAction ?? ""} />
            </Field>
            <Field label="Waiting party">
              <Input name="waitingParty" defaultValue={c.waitingParty ?? ""} />
            </Field>
            <Field label="Review at">
              <Input name="reviewAt" type="datetime-local" />
            </Field>
            <Field label="Severity (free text; D27 unselected)">
              <Input name="severity" defaultValue={c.severity ?? ""} />
            </Field>
            <Field label="Resolution / note">
              <Textarea name="resolution" rows={2} />
            </Field>
            <div className="sm:col-span-2">
              <Button small>Save</Button>
              <span className="ml-2 text-xs text-muted">Resolve only when the cause and required consequences are addressed.</span>
            </div>
          </form>
        </Card>
      ) : null}
      {manage && c.state === "resolved" ? (
        <Card title="Reopen">
          <form action={reopenExceptionAction} className="flex gap-2">
            <input type="hidden" name="caseId" value={id} />
            <Input name="note" required placeholder="Why has the condition returned?" aria-label="Reason" />
            <Button small variant="secondary">Reopen case</Button>
          </form>
        </Card>
      ) : null}
      <Card title="History">
        <ul className="divide-y divide-line text-sm">
          {notes.map((n) => (
            <li key={n.id} className="py-1.5">
              <span className="text-xs text-muted">{fmtDate(n.at)} · {n.actorKind}</span> — {n.body}
            </li>
          ))}
        </ul>
        {can(actor, "exception.view") ? (
          <form action={noteExceptionAction} className="mt-2 flex gap-2">
            <input type="hidden" name="caseId" value={id} />
            <Input name="body" required placeholder="Add a note" />
            <Button small variant="secondary">Add</Button>
          </form>
        ) : null}
      </Card>
    </Page>
  );
}
