import Link from "next/link";
import { Badge, Button, Card, Field, Flash, Input, Notice, Page, Select, StatusBadge, Textarea, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { listSkus } from "@/lib/domain/catalog/service";
import { listLocations } from "@/lib/domain/customers/service";
import type { ParsedDraft } from "@/lib/domain/intake/parse";
import { attachmentsForIntake, listOpenIntake } from "@/lib/domain/intake/service";
import { listMarkets } from "@/lib/domain/markets/service";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { gmailConfigured } from "@/lib/integrations/gmail/adapter";
import { convertIntakeAction, intakeIncompleteAction, recordIntakeAction } from "../actions";

/**
 * Email order intake. Round 4: the orders@ mailbox is read in by the cron (when the switch is on); each message arrives
 * with its attachments and, for a known sender, a pre-filled draft. A person checks the draft and converts it; nothing
 * is ordered or sent back on its own.
 */
export default async function IntakePage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("intake.handle");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const [requests, locations, skus, markets, settings] = await Promise.all([listOpenIntake(d), listLocations(d, actor), listSkus(d), listMarkets(d), getCompanySettings(d)]);
  const attachments = await attachmentsForIntake(d, requests.map((r) => r.id));
  const [sync] = await d.select().from(schema.mailboxSync).where(eq(schema.mailboxSync.mailbox, settings.intakeMailboxAddress));
  const activeSkus = skus.filter((s) => !s.archivedAt);
  return (
    <Page title="Email order intake" subtitle="The source message is preserved verbatim. A person matches account, product, quantity and intent before it becomes demand (R14). Known senders arrive with a draft to check.">
      <Flash {...flash} />
      {settings.intakeMailboxEnabled && gmailConfigured() ? (
        <Notice tone="info" title={`Reading ${settings.intakeMailboxAddress}.`}>
          {sync?.lastPolledAt ? `Last read ${fmtDate(sync.lastPolledAt)}; ${sync.messagesSeen} message${sync.messagesSeen === 1 ? "" : "s"} recorded so far.` : "Not read yet; the cron reads every few minutes."}
          {sync?.lastError ? ` Last error: ${sync.lastError}` : ""} Nothing is sent back; any acknowledgement goes through Approvals.
        </Notice>
      ) : (
        <Notice tone="info">
          The mailbox is not being read ({settings.intakeMailboxEnabled ? "Gmail is not connected" : "the switch in Company settings is off"}); paste the email here. Conversion goes through the same downstream order process as Sales entry (O12).
        </Notice>
      )}
      <Card title="Record an email order by hand">
        <form action={recordIntakeAction} className="grid gap-2 sm:grid-cols-3">
          <Input name="fromEmail" type="email" placeholder="From" />
          <Input name="subject" placeholder="Subject" />
          <Select name="marketId" defaultValue="">
            <option value="">Market (optional)</option>
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <div className="sm:col-span-3">
            <Textarea name="body" required rows={4} placeholder="Paste the message body" />
          </div>
          <Button small variant="secondary">
            Record
          </Button>
        </form>
      </Card>
      {requests.map((r) => {
        const draft = (r.parsed ?? null) as ParsedDraft | null;
        const mine = attachments.filter((a) => a.intakeId === r.id);
        const qtyFor = (skuId: string) => draft?.lines.find((l) => l.skuId === skuId)?.qty;
        return (
          <Card key={r.id} title={`${r.subject ?? "(no subject)"} — ${r.fromEmail ?? "unknown sender"}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <StatusBadge value={r.state} /> {fmtDate(r.receivedAt)}
              {r.mailbox ? <Badge>from {r.mailbox}</Badge> : <Badge>pasted</Badge>}
              {draft ? <Badge tone={draft.confidence === "high" ? "good" : draft.confidence === "medium" ? "warn" : "neutral"}>draft: {draft.confidence} confidence</Badge> : null}
              {r.missingEssentials ? `· missing: ${r.missingEssentials}` : ""}
            </div>
            {draft ? (
              <div className="mb-2 border border-rule-soft bg-paper p-3 text-sm">
                <div className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-2">What the parser read</div>
                <p className="mt-1">
                  Account:{" "}
                  {draft.locationId ? (
                    <Link href={`/locations/${draft.locationId}`} className="text-navy hover:underline">
                      {draft.locationName}
                    </Link>
                  ) : (
                    <span className="text-ink-2">not recognised</span>
                  )}
                  {draft.senderMatch ? <span className="text-xs text-ink-3"> (by {draft.senderMatch === "contact_email" ? "the sender's address" : "the sender's domain"})</span> : null}
                  {draft.poNumber ? <span> · PO {draft.poNumber}</span> : null}
                  {draft.requestedDate ? <span> · wants {draft.requestedDate}</span> : null}
                </p>
                {draft.lines.length ? (
                  <ul className="mt-1 text-sm">
                    {draft.lines.map((l) => (
                      <li key={l.skuId}>
                        {l.qty} × {l.skuName} <span className="text-xs text-ink-3">(by {l.via}: &ldquo;{l.matched}&rdquo;)</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {draft.notes.length ? <p className="mt-1 text-xs text-ink-3">{draft.notes.join(" ")}</p> : null}
              </div>
            ) : null}
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-xs">{r.body}</pre>
            {mine.length ? (
              <ul className="mt-2 text-sm">
                {mine.map((a) => (
                  <li key={a.id} className="py-1">
                    {a.kept ? (
                      <a href={`/admin/intake/attachments/${a.id}`} className="text-navy hover:underline">
                        {a.filename}
                      </a>
                    ) : (
                      <span>{a.filename}</span>
                    )}{" "}
                    <span className="text-xs text-ink-3">
                      {a.mime ?? ""} {Math.max(1, Math.round(a.sizeBytes / 1024))} KB
                    </span>
                    {a.textExtract ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-navy">Text read from it</summary>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-xs">{a.textExtract.slice(0, 4000)}</pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <details className="mt-2" open={Boolean(draft && draft.lines.length)}>
              <summary className="cursor-pointer text-sm text-accent">Convert to order</summary>
              <form action={convertIntakeAction} className="mt-2 space-y-2">
                <input type="hidden" name="intakeId" value={r.id} />
                <Field label="Account">
                  <Select name="locationId" required defaultValue={draft?.locationId ?? r.locationId ?? ""}>
                    <option value="" disabled>
                      Match the licensed location…
                    </option>
                    {locations.map(({ loc, market }) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.tradeName} ({market.code})
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid gap-2 sm:grid-cols-2">
                  {activeSkus.map((s) => (
                    <label key={s.id} className="flex items-center justify-between gap-2 border-b border-rule-soft py-1 text-sm">
                      <span>
                        {s.brand} {s.name}
                      </span>
                      <Input name={`qty:${s.id}`} type="number" min={0} className="w-20" placeholder="0" defaultValue={qtyFor(s.id) ?? ""} />
                    </label>
                  ))}
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <Field label="PO numbers" hint="Printed on the BOL and the invoice.">
                    <Input name="poNumbers" defaultValue={draft?.poNumber ?? ""} />
                  </Field>
                  <Field label="Requested date">
                    <Input name="requestedDate" type="date" defaultValue={draft?.requestedDate ?? ""} />
                  </Field>
                  <Field label="If the origin is short (R2-5)" hint="Ask refuses and shows the shortfall; the other two record your decision.">
                    <Select name="shortfallDecision" defaultValue="">
                      <option value="">Ask me</option>
                      <option value="ship_available">Ship what is on hand</option>
                      <option value="hold">Hold the order</option>
                    </Select>
                  </Field>
                  <Field label="Reason (when shipping short)">
                    <Input name="shortfallReason" placeholder="e.g. buyer agreed to take the rest next week" />
                  </Field>
                </div>
                <Button small>Convert</Button>
              </form>
            </details>
            <form action={intakeIncompleteAction} className="mt-2 flex gap-2">
              <input type="hidden" name="intakeId" value={r.id} />
              <Input name="missing" required placeholder="Missing essentials (e.g. quantity for Cantinesca)" />
              <Button small variant="secondary">
                Mark incomplete
              </Button>
            </form>
          </Card>
        );
      })}
      {requests.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No email demand awaiting review.</p>
        </Card>
      ) : null}
    </Page>
  );
}
