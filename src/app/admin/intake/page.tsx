import { Button, Card, Field, Flash, Input, Notice, Page, Select, StatusBadge, Textarea, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { listSkus } from "@/lib/domain/catalog/service";
import { listLocations } from "@/lib/domain/customers/service";
import { listOpenIntake } from "@/lib/domain/intake/service";
import { listMarkets } from "@/lib/domain/markets/service";
import { convertIntakeAction, intakeIncompleteAction, recordIntakeAction } from "../actions";

export default async function IntakePage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("intake.handle");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const [requests, locations, skus, markets] = await Promise.all([listOpenIntake(d), listLocations(d, actor), listSkus(d), listMarkets(d)]);
  return (
    <Page title="Email order intake" subtitle="The source message is preserved verbatim. A person matches location, SKU, quantity and intent before it becomes demand (R14). Ambiguity rules are D09 (unselected).">
      <Flash {...flash} />
      <Notice tone="info">Gmail mailbox reading is not connected; paste the email here. Conversion goes through the same downstream order process as Sales entry (O12).</Notice>
      <Card title="Record an email order">
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
          <Button small variant="secondary">Record</Button>
        </form>
      </Card>
      {requests.map((r) => (
        <Card key={r.id} title={`${r.subject ?? "(no subject)"} — ${r.fromEmail ?? "unknown sender"}`}>
          <div className="mb-2 flex items-center gap-2 text-xs text-muted">
            <StatusBadge value={r.state} /> {fmtDate(r.receivedAt)} {r.missingEssentials ? `· missing: ${r.missingEssentials}` : ""}
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-xs">{r.body}</pre>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-accent">Convert to order</summary>
            <form action={convertIntakeAction} className="mt-2 space-y-2">
              <input type="hidden" name="intakeId" value={r.id} />
              <Field label="Location">
                <Select name="locationId" required defaultValue="">
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
                {skus.filter((s) => !s.archivedAt).map((s) => (
                  <label key={s.id} className="flex items-center justify-between gap-2 border-b border-rule-soft py-1 text-sm">
                    <span>
                      {s.brand} {s.name}
                    </span>
                    <Input name={`qty:${s.id}`} type="number" min={0} className="w-20" placeholder="0" />
                  </label>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Requested date">
                  <Input name="requestedDate" type="date" />
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
            <Button small variant="secondary">Mark incomplete</Button>
          </form>
        </Card>
      ))}
      {requests.length === 0 ? <Card><p className="text-sm text-muted">No email demand awaiting review.</p></Card> : null}
    </Page>
  );
}
