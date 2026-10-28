import { notFound } from "next/navigation";
import { Badge, Button, Card, Field, Flash, Input, KV, Notice, Page, Select, StatusBadge, Textarea, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { isProduction } from "@/lib/env";
import { listMarkets } from "@/lib/domain/markets/service";
import { IMPLEMENTED_DECISIONS } from "@/lib/policy/implemented";
import { listDecisions, policyMatrix } from "@/lib/policy/policy";
import { fieldSpecs } from "@/lib/policy/schema";
import { recordSelectionAction, withdrawSelectionAction } from "../../actions";

/**
 * Decision register detail (UX-07): typed controls derived from the
 * decision's schema (no JSON for supported fields), per-market effective
 * policy and scheduled changes, implementation coverage, history with
 * withdrawal per selection. Five facts are kept apart: recorded, effective
 * here/now, implemented, capability evidence, activated.
 */
export default async function DecisionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const actor = await requireAction("decision.view");
  const db = await getDb();
  const d = (await listDecisions(db)).find((x) => x.id === id.toUpperCase());
  if (!d) notFound();
  const markets = await listMarkets(db);
  const matrix = await policyMatrix(db, d.id);
  const flash = await flashFrom(searchParams);
  const canProd = can(actor, "decision.select_production");
  const canTest = can(actor, "decision.record_test_selection") && !isProduction();
  const impl = IMPLEMENTED_DECISIONS[d.id];
  const specs = fieldSpecs(d.selectionSchema);
  const codeFor = (ids: string[] | null) => (ids && ids.length ? ids.map((m) => markets.find((x) => x.id === m)?.code ?? "?") : markets.map((m) => m.code));
  const now = new Date();
  return (
    <Page title={`${d.id} — ${d.title}`} subtitle={<span className="flex flex-wrap gap-1"><StatusBadge value={d.status} />{d.scheduled ? <Badge tone="warn">change scheduled</Badge> : null}{d.testOnly ? <Badge tone="warn">test selection only</Badge> : null}<Badge tone={impl ? "good" : "neutral"}>{impl ? "execution implemented" : "execution not implemented"}</Badge></span>}>
      <Flash {...flash} />
      <Card title="What remains open">
        <p className="text-sm">{d.question}</p>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Confirmed behaviour that still applies">
          <p className="text-sm">{d.confirmedBehavior}</p>
        </Card>
        <Card title="Safe implementation support now">
          <p className="text-sm">{d.safeSupport}</p>
        </Card>
        <Card title="Kept inactive / unselected">
          <p className="text-sm">{d.keepInactive}</p>
        </Card>
        <Card title="Accountable function and urgency">
          <p className="text-sm">{d.accountable}</p>
        </Card>
      </div>

      <Card title="What a selection changes in the application">
        {impl ? (
          <>
            <p className="text-sm">{impl.effect}</p>
            <KV items={[["Executed fields", impl.executedKeys.join(", ")], ["Recorded only (not executed yet)", impl.recordedOnlyKeys?.join(", ") ?? "—"], ["Commissioning dependency", impl.dependsOn ?? "none"]]} />
          </>
        ) : (
          <Notice tone="info">Recording a selection here documents the Owner&apos;s choice with scope, effective date and history. No application branch executes it in this revision — the register says so rather than pretending.</Notice>
        )}
      </Card>

      <Card title="Effective policy by market (now)">
        <ul className="divide-y divide-line text-sm">
          {matrix.cells.map((c) => (
            <li key={c.marketId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                <Badge>{c.marketCode}</Badge>{" "}
                {c.effective ? (
                  <>
                    <Badge tone={c.effectiveKind === "production" ? "good" : "warn"}>{c.effectiveKind === "production" ? "production" : "TEST"}</Badge> {c.effective.scope} — {Object.entries(c.effective.selection).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join("|") : String(v)}`).join(", ") || "(no fields)"}
                    <span className="text-xs text-muted"> since {fmtDate(c.effective.effectiveFrom)}</span>
                  </>
                ) : (
                  <StatusBadge value="unselected" />
                )}
              </span>
              {c.scheduled.length ? <span className="text-xs text-warn">then: {c.scheduled.map((s) => `${fmtDate(s.effectiveFrom)} → ${s.scope}`).join("; ")}</span> : null}
            </li>
          ))}
          {matrix.cells.length === 0 ? <li className="py-2 text-sm text-muted">No markets yet.</li> : null}
        </ul>
        {impl && matrix.cells.some((c) => c.effective) ? (
          <p className="mt-2 text-xs text-muted">Example: {impl.example((matrix.cells.find((c) => c.effective)?.effective?.selection ?? {}) as Record<string, unknown>, matrix.cells.filter((c) => c.effective).map((c) => c.marketCode))}</p>
        ) : null}
      </Card>

      <Card title="History (every selection, including withdrawn)">
        {matrix.history.length === 0 ? <p className="text-sm text-muted">None recorded.</p> : null}
        <ul className="divide-y divide-line text-sm">
          {matrix.history.map((s) => {
            const live = (s.supersededAt === null || s.supersededAt > now) && s.effectiveFrom <= now;
            const future = (s.supersededAt === null || s.supersededAt > now) && s.effectiveFrom > now;
            return (
              <li key={s.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap gap-1">
                    <Badge tone={s.kind === "production" ? "good" : "warn"}>{s.kind === "production" ? "production" : "TEST"}</Badge>
                    <span>{s.scope}</span>
                    <Badge tone="info">{codeFor(s.marketIds).join(", ")}</Badge>
                    {s.supersededAt && s.supersededAt <= now ? <Badge>withdrawn {fmtDate(s.supersededAt)}</Badge> : future ? <Badge tone="warn">scheduled</Badge> : live ? <Badge tone="good">in force</Badge> : null}
                  </span>
                  <span className="text-xs text-muted">effective {fmtDate(s.effectiveFrom)} · recorded {fmtDate(s.recordedAt)}</span>
                </div>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-accent">Structured value</summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-background p-2 text-xs">{JSON.stringify(s.selection, null, 2)}</pre>
                </details>
                {s.note ? <p className="text-xs text-muted">{s.note}</p> : null}
                {s.withdrawnReason ? <p className="text-xs text-muted">Withdrawn: {s.withdrawnReason}</p> : null}
                {(live || future) && ((s.kind === "production" && canProd) || (s.kind === "test" && canTest)) ? (
                  <form action={withdrawSelectionAction} className="mt-1 flex gap-2">
                    <input type="hidden" name="decisionId" value={d.id} />
                    <input type="hidden" name="selectionId" value={s.id} />
                    <Input name="reason" required placeholder="Reason for withdrawal" aria-label="Reason" />
                    <Button small variant="secondary">Withdraw this selection</Button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
        {canProd && matrix.history.some((s) => s.kind === "production" && (s.supersededAt === null || s.supersededAt > now)) ? (
          <form action={withdrawSelectionAction} className="mt-2 flex gap-2">
            <input type="hidden" name="decisionId" value={d.id} />
            <Input name="reason" required placeholder="Reason" aria-label="Reason" />
            <Button small variant="ghost">Withdraw every production selection (back to unselected)</Button>
          </form>
        ) : null}
      </Card>

      {canProd || canTest ? (
        <Card title="Record a selection">
          <form action={recordSelectionAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="decisionId" value={d.id} />
            <Field label="Kind">
              <Select name="kind" defaultValue={canProd ? "production" : "test"}>
                {canProd ? <option value="production">Production (Owner)</option> : null}
                {canTest ? <option value="test">TEST selection (labelled; never production policy)</option> : null}
              </Select>
            </Field>
            <Field label="Markets" hint="Tick none for every market. A market-specific selection overrides an all-markets one; other markets keep theirs.">
              <div className="grid grid-cols-2 gap-1">
                {markets.map((m) => (
                  <label key={m.id} className="flex min-h-9 items-center gap-2 text-sm">
                    <input type="checkbox" name="marketIds" value={m.id} className="h-4 w-4" /> {m.name} ({m.code})
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Effective from" hint="Blank = now. A later date schedules the change; the current selection stays in force until then.">
              <Input name="effectiveFrom" type="datetime-local" />
            </Field>
            <Field label="Scope (description)">
              <Input name="scope" placeholder="e.g. all markets / NC market only" />
            </Field>
            {specs.length ? (
              specs.map((spec) => (
                <Field key={spec.key} label={spec.key.replace(/_/g, " ")} hint={`${spec.hint}${impl?.executedKeys.includes(spec.key) ? "" : " (recorded only — not executed in this revision)"}`}>
                  {spec.type.kind === "boolean" ? (
                    <Select name={`sel:${spec.key}`} defaultValue="">
                      <option value="">— leave unresolved —</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </Select>
                  ) : spec.type.kind === "enum" ? (
                    <Select name={`sel:${spec.key}`} defaultValue="">
                      <option value="">— leave unresolved —</option>
                      {spec.type.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : spec.type.kind === "integer" ? (
                    <Input name={`sel:${spec.key}`} type="number" min={0} step={1} inputMode="numeric" />
                  ) : spec.type.kind === "string_list" ? (
                    <Input name={`sel:${spec.key}`} placeholder="Comma-separated, e.g. NC, MA" />
                  ) : spec.type.kind === "object" ? (
                    <Textarea name={`sel:${spec.key}`} rows={3} placeholder='{"order_received": "gmail"}' />
                  ) : (
                    <Input name={`sel:${spec.key}`} />
                  )}
                </Field>
              ))
            ) : (
              <div className="sm:col-span-2">
                <Field label="Choice (free-form JSON — no structured fields exist for this record)">
                  <Textarea name="selectionJson" rows={3} defaultValue="{}" />
                </Field>
              </div>
            )}
            <Field label="Note">
              <Input name="note" />
            </Field>
            <div className="sm:col-span-2 text-xs text-muted">
              Before recording: markets ticked above are the ones affected from the effective date; every other market keeps its current policy. Fields left blank stay unresolved and their behaviour stays inactive.
              {impl ? "This decision is executed by the application; the example above will update to the recorded value." : "This decision is recorded only; nothing executes it."}
            </div>
            <div className="sm:col-span-2">
              <Button small>Record</Button>
            </div>
          </form>
        </Card>
      ) : (
        <Notice tone="info">Only the Owner records production policy. Admin/Accounting may record labelled TEST selections outside production.</Notice>
      )}
    </Page>
  );
}
