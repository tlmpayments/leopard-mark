import { Badge, Button, Card, Flash, Input, KV, Notice, Page, Select, StatusBadge, Table, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { appEnv, configurationProblems, demoModeEnabled, fixtureMode } from "@/lib/env";
import { providerStatuses } from "@/lib/integrations/registry";
import { stripeGatewayMode } from "@/lib/integrations/stripe/gateway";
import { jobSummary, listJobs } from "@/lib/jobs/queue";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { listCustomerMatches } from "@/lib/domain/collection";
import { runHourlyChecksAction, runJobsAction } from "../admin/actions";
import { SCOPE_LABEL, companyMailboxes, googleClientConfigured, listMailboxConnections } from "@/lib/integrations/gmail/connection";
import { activationAction, checkGmailAction, checkStripeAction, disconnectMailboxAction, importStripeMatchesAction, recordGateAction, syncPayoutsAction } from "./actions";
import "@/lib/domain/collection";

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
  const [statuses, jobs, jobRows, events, settings, matches] = await Promise.all([providerStatuses(d), jobSummary(d), listJobs(d, { statuses: ["waiting", "queued", "running", "failed"], limit: 50 }), d.select().from(schema.providerEvent).orderBy(desc(schema.providerEvent.receivedAt)).limit(10), getCompanySettings(d), listCustomerMatches(d, { states: ["suggested"] })]);
  const mailboxRows = await listMailboxConnections(d);
  const ownerCanConnect = can(actor, "settings.manage");
  const manage = can(actor, "integration.manage");
  const problems = configurationProblems();
  const fakeStripe = stripeGatewayMode() === "fake";
  return (
    <Page title="Integrations" subtitle={`Build-versus-activate facts per provider (environment: ${appEnv()}, fixture mode: ${fixtureMode()}). A successful API request is never "integration complete".`}>
      <Flash {...flash} />
      {demoModeEnabled() ? (
        <Notice tone="warn" title="DEVELOPMENT DEMO MODE:">
          no provider credentials are configured, so every adapter reports its real state and every capability gate stays unproven. {fakeStripe ? "Stripe runs against an in-memory stand-in (FV_STRIPE_FAKE), impossible on a deployment, so the collection flow can be walked through end to end." : "Nothing on this page is mocked as successful."}
        </Notice>
      ) : null}
      {fakeStripe && !demoModeEnabled() ? (
        <Notice tone="warn" title="Stripe is the in-memory stand-in (FV_STRIPE_FAKE).">
          Local only; a deployment never gets it.
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
              <div>{s.credentialsPresent ? (s.provider === "stripe" && fakeStripe ? "in-memory stand-in (FV_STRIPE_FAKE); no key" : "present (names only; values never shown)") : `missing: ${s.missingEnv.join(", ")}`}</div>
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
              <>
                <form action={checkStripeAction}>
                  <Button small variant="secondary">Check connectivity (binds account + credential)</Button>
                </form>
                {s.connection === "ok" ? (
                  <>
                    <form action={importStripeMatchesAction}>
                      <Button small variant="secondary">Import the ACH app&apos;s customers for matching (C2)</Button>
                    </form>
                    <form action={syncPayoutsAction}>
                      <Button small variant="secondary">Pull payouts now (S8)</Button>
                    </form>
                  </>
                ) : null}
                {matches.length ? (
                  <Button small variant="ghost" href="/admin/stripe-matches">
                    {matches.length} Stripe customer{matches.length === 1 ? "" : "s"} waiting to be matched
                  </Button>
                ) : null}
              </>
            ) : null}
            {s.provider === "gmail" && manage ? (
              <form action={checkGmailAction}>
                <Button small variant="secondary">Check the {settings.intakeMailboxAddress} mailbox</Button>
              </form>
            ) : null}
          </div>
          {s.provider === "gmail" ? (
            <div className="mb-2">
              <h3 className="mb-1 text-xs font-semibold uppercase text-muted">Mailboxes (each connected by the Owner signing in to it once; no domain-wide key)</h3>
              <Table
                head={["Mailbox", "Used for", "Needs", "Connection", ""]}
                rows={companyMailboxes(settings).map((m) => {
                  const conn = mailboxRows.find((r) => r.mailbox === m.mailbox && !r.disconnectedAt && r.refreshTokenEnc);
                  const missing = conn ? m.scopes.filter((sc) => !conn.scopes.includes(sc)) : [];
                  return [
                    <span key="m" className="font-mono text-xs">{m.mailbox}</span>,
                    m.purpose,
                    m.scopes.map((sc) => SCOPE_LABEL[sc] ?? sc).join(" and "),
                    conn ? (
                      <span key="c">
                        <Badge tone={conn.lastError || missing.length ? "warn" : "good"}>{conn.lastError ? "needs reconnecting" : missing.length ? `missing ${missing.map((sc) => SCOPE_LABEL[sc] ?? sc).join(", ")}` : "connected"}</Badge>{" "}
                        <span className="text-xs text-muted">since {conn.connectedAt.toISOString().slice(0, 10)}{conn.lastUsedAt ? `, last used ${conn.lastUsedAt.toISOString().slice(0, 10)}` : ""}</span>
                        {conn.lastError ? <span className="block text-xs text-danger">{conn.lastError}</span> : null}
                      </span>
                    ) : (
                      <Badge key="c" tone="warn">not connected</Badge>
                    ),
                    ownerCanConnect ? (
                      <span key="a" className="flex flex-wrap gap-1">
                        {googleClientConfigured() ? (
                          <Button small variant="secondary" href={`/api/integrations/gmail/start?mailbox=${encodeURIComponent(m.mailbox)}`}>
                            {conn ? "Reconnect" : "Connect mailbox"}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted">Google client not configured</span>
                        )}
                        {conn ? (
                          <form action={disconnectMailboxAction} className="flex gap-1">
                            <input type="hidden" name="mailbox" value={m.mailbox} />
                            <Input name="reason" placeholder="Reason" aria-label="Reason" className="max-w-[9rem]" />
                            <Button small variant="danger">Disconnect</Button>
                          </form>
                        ) : null}
                      </span>
                    ) : (
                      <span key="a" className="text-xs text-muted">Owner connects</span>
                    ),
                  ];
                })}
              />
              <p className="mt-1 text-xs text-muted">
                Connect mailbox opens Google: sign in as that mailbox and allow what it asks. Google&apos;s return address for this must be listed in the Google client&apos;s Authorized redirect URIs: <span className="font-mono">/api/integrations/gmail/callback</span> on this site. Disconnecting revokes the sign-in with Google.
              </p>
            </div>
          ) : null}
          <div className="mb-2 flex flex-wrap items-center gap-2">
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
          <>
            <div className="mt-2 flex flex-wrap gap-2">
              <form action={runJobsAction}>
                <Button small variant="secondary">Run due jobs now</Button>
              </form>
              <form action={runHourlyChecksAction}>
                <Button small variant="secondary">Run the hourly checks now</Button>
              </form>
            </div>
            <p className="mt-1 text-xs text-muted">The hourly checks (overdue invoices, due-date debits, unfinished bank setups) only open cases or queue approvals. Production runs them every hour; a preview runs them only from this button.</p>
          </>
        ) : null}
      </Card>
      <Card title="Recent provider events (idempotent record)">
        <Table head={["Provider", "Event", "Type", "Received", "Outcome"]} rows={events.map((e) => [e.provider, <code key="i" className="text-xs">{e.eventId}</code>, e.type, fmtDate(e.receivedAt), e.outcome ?? "—"])} />
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button href="/approvals" variant="secondary">
          Approvals (everything that leaves the company)
        </Button>
        <Button href="/admin/notices" variant="secondary">
          Customer notices (Phase 1 manual intents)
        </Button>
      </div>
    </Page>
  );
}
