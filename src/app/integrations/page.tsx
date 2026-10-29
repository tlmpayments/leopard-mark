import { Badge, Button, Card, Flash, Input, KV, Notice, Page, Select, StatusBadge, Table, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { appEnv, configurationProblems, demoModeEnabled, fixtureMode } from "@/lib/env";
import { providerStatuses } from "@/lib/integrations/registry";
import { jobSummary, listJobs } from "@/lib/jobs/queue";
import { runJobsAction } from "../admin/actions";
import { activationAction, checkStripeAction, recordGateAction } from "./actions";

const CONNECTION_LABEL: Record<string, string> = { not_applicable: "n/a", no_check: "untested", failed: "failed", stale: "stale", ok: "verified" };

/**
 * Build-versus-activate status per provider (REV-12 / UX-07 fact 5): five
 * separate facts per provider — built, credentials, connection evidence,
 * capability demonstration, activation — none of which implies the next.
 */
export default async function IntegrationsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("integration.view");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const [statuses, jobs, jobRows, events] = await Promise.all([providerStatuses(d), jobSummary(d), listJobs(d, { statuses: ["waiting", "queued", "running", "failed"], limit: 50 }), d.select().from(schema.providerEvent).orderBy(desc(schema.providerEvent.receivedAt)).limit(10)]);
  const manage = can(actor, "integration.manage");
  const problems = configurationProblems();
  return (
    <Page title="Integrations" subtitle={`Build-versus-activate facts per provider (environment: ${appEnv()}, fixture mode: ${fixtureMode()}). A successful API request is never "integration complete".`}>
      <Flash {...flash} />
      {demoModeEnabled() ? (
        <Notice tone="warn" title="DEVELOPMENT DEMO MODE:">
          no provider credentials are configured, so every adapter reports its real state and every capability gate stays unproven. Nothing on this page is mocked as successful.
        </Notice>
      ) : null}
      {problems.length ? (
        <Card title="Configuration needs attention">
          <ul className="list-disc pl-5 text-sm text-danger">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
      ) : null}
      {statuses.map((s) => (
        <Card key={s.provider} title={s.name}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge value={s.state} title={s.headline} />
            <span className="text-sm">{s.headline}</span>
            <Badge>phase {s.phase}</Badge>
          </div>
          <div className="mb-2 grid gap-2 text-xs sm:grid-cols-5">
            <div className="border-t border-rule pt-2">
              <div className="uppercase tracking-wide text-muted">1 · Built</div>
              <div>{s.built === "adapter" ? "adapter" : s.built === "boundary_only" ? "boundary only" : "not implemented"}</div>
            </div>
            <div className="border-t border-rule pt-2">
              <div className="uppercase tracking-wide text-muted">2 · Credentials</div>
              <div>{s.credentialsPresent ? "present (names only; values never shown)" : `missing: ${s.missingEnv.join(", ")}`}</div>
            </div>
            <div className="border-t border-rule pt-2">
              <div className="uppercase tracking-wide text-muted">3 · Connection</div>
              <div>
                <StatusBadge value={s.connection === "ok" ? "ok" : s.connection === "no_check" ? "no_check" : s.connection === "not_applicable" ? "not_applicable_yet" : s.connection} title={CONNECTION_LABEL[s.connection]} /> <span className="text-muted">{s.connectionDetail}</span>
                {s.recorded?.lastCheckedAt ? <span className="block text-muted">last check {fmtDate(s.recorded.lastCheckedAt)}{s.environment ? ` · ${s.environment} mode` : ""}{s.accountId ? ` · account ${s.accountId}` : ""}</span> : null}
              </div>
            </div>
            <div className="border-t border-rule pt-2">
              <div className="uppercase tracking-wide text-muted">4 · Capability</div>
              <div>{s.capability === "not_applicable" ? "n/a" : s.capability.replace(/_/g, " ")}</div>
            </div>
            <div className="border-t border-rule pt-2">
              <div className="uppercase tracking-wide text-muted">5 · Activation</div>
              <div>{s.activation.replace(/_/g, " ")}</div>
            </div>
          </div>
          <KV
            items={[
              ["Owns (authoritative)", s.owns],
              ["Internal keeps", s.internalKeeps],
              ["Callback / webhook", [s.callbackPath, s.webhookPath].filter(Boolean).join(" · ") || "—"],
              ["Scopes", s.scopes?.join(", ") ?? "—"],
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {s.provider === "stripe" && manage ? (
              <form action={checkStripeAction}>
                <Button small variant="secondary">Check connectivity (binds account + credential)</Button>
              </form>
            ) : null}
            {manage && s.built === "adapter" && s.connection === "ok" ? (
              <form action={activationAction} className="flex gap-1">
                <input type="hidden" name="provider" value={s.provider} />
                <input type="hidden" name="accepted" value={s.activation === "accepted_for_live_use" ? "false" : "true"} />
                <Input name="evidence" placeholder="Activation evidence / approval reference" className="max-w-[18rem]" aria-label="Evidence" required={s.activation !== "accepted_for_live_use"} />
                <Button small variant={s.activation === "accepted_for_live_use" ? "danger" : "secondary"}>{s.activation === "accepted_for_live_use" ? "Withdraw live acceptance" : "Record acceptance for live use"}</Button>
              </form>
            ) : null}
          </div>
          {s.gates.length ? (
            <div className="mt-3">
              <h3 className="mb-1 text-xs font-semibold uppercase text-muted">Capability gates (a person records the demonstration; API success never does)</h3>
              <Table
                head={["Gate", "Class", "Status", "Evidence", ""]}
                rows={s.gates.map((g) => [
                  <span key="n" title={g.requiredDemonstration}>
                    {g.name}
                  </span>,
                  g.classification.replace(/_/g, " "),
                  <StatusBadge key="s" value={g.status} />,
                  <span key="e" className="text-xs text-muted">
                    {g.evidence ?? g.permittedControl ?? ""}
                  </span>,
                  can(actor, "gate.record") ? (
                    <form key="f" action={recordGateAction} className="flex gap-1">
                      <input type="hidden" name="gateId" value={g.id} />
                      <Select name="status" defaultValue={g.status} aria-label="Gate status">
                        <option value="unproven">unproven</option>
                        <option value="demonstrated">demonstrated</option>
                        <option value="temporary_control_approved">temporary control approved</option>
                        <option value="not_applicable_yet">not applicable yet</option>
                      </Select>
                      <Input name="evidence" placeholder="Evidence" aria-label="Evidence" />
                      <Button small variant="ghost">Save</Button>
                    </form>
                  ) : (
                    ""
                  ),
                ])}
              />
            </div>
          ) : null}
        </Card>
      ))}
      <Card title="Background work (Postgres queue drained by Vercel Cron)">
        <KV items={Object.entries(jobs).map(([k, v]) => [k, String(v)])} />
        <Table
          caption="Jobs that are not done"
          head={["Kind", "State", "Attempts", "Why / last error", "Next run"]}
          rows={jobRows.map((j) => [j.kind, <StatusBadge key="s" value={j.status} />, `${j.attempts}/${j.maxAttempts}`, <span key="w" className="text-xs text-muted">{j.waitingReason ?? j.lastError ?? "—"}</span>, j.status === "queued" ? fmtDate(j.runAt) : "—"])}
        />
        <p className="mt-1 text-xs text-muted">Waiting work resumes by itself once a connectivity check succeeds; failed work opens an owned case saying the provider effect is unknown until checked.</p>
        {manage ? (
          <form action={runJobsAction} className="mt-2">
            <Button small variant="secondary">Run due jobs now</Button>
          </form>
        ) : null}
      </Card>
      <Card title="Recent provider events (idempotent record)">
        <Table head={["Provider", "Event", "Type", "Received", "Outcome"]} rows={events.map((e) => [e.provider, <code key="i" className="text-xs">{e.eventId}</code>, e.type, fmtDate(e.receivedAt), e.outcome ?? "—"])} />
      </Card>
      <div>
        <Button href="/admin/notices" variant="secondary">
          Customer notices (manual single-sender process)
        </Button>
      </div>
    </Page>
  );
}
