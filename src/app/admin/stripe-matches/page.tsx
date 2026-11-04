import Link from "next/link";
import { Button, Card, Flash, Input, Notice, Page, Select, StatusBadge, Table, fmtDate, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { formatCents } from "@/lib/domain/catalog/service";
import { invoiceLinkCandidates, listCustomerMatches, listInvoiceMatches, matchCandidates } from "@/lib/domain/collection";
import { importStripeMatchesAction } from "../../integrations/actions";
import { confirmMatchAction, dismissInvoiceMatchAction, dismissMatchAction, linkInvoiceMatchAction } from "./actions";
import "@/lib/domain/collection";

/**
 * The one-time match of what the ACH app (and the dashboard) made in Stripe before the portal (C2): customers to
 * accounts, open invoices to portal invoices. Suggestions come from the billing email, the name, the account and the
 * amount; a person confirms each, and nothing is linked on a guess.
 */
export default async function StripeMatchesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAction("integration.manage");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const view = param(sp, "view") ?? "open";
  const d = await getDb();
  const states = view === "open" ? (["suggested"] as const) : undefined;
  const [customers, invoices, candidates, invoiceCandidates] = await Promise.all([listCustomerMatches(d, { states: states ? [...states] : undefined }), listInvoiceMatches(d, { states: states ? [...states] : undefined }), matchCandidates(d), invoiceLinkCandidates(d)]);
  return (
    <Page
      title="Stripe matching"
      subtitle="Customers and invoices made in Stripe before the portal (the ACH app, the dashboard), matched to accounts and invoices here. One Stripe customer per licensed location; a shared billing email is never matched on its own."
      actions={
        <div className="flex gap-2">
          <Link href="/admin/stripe-matches?view=open" className={`px-3 py-1 text-sm ${view === "open" ? "bg-navy text-paper" : "border border-rule"}`}>
            Open
          </Link>
          <Link href="/admin/stripe-matches?view=all" className={`px-3 py-1 text-sm ${view === "all" ? "bg-navy text-paper" : "border border-rule"}`}>
            All
          </Link>
          <form action={importStripeMatchesAction}>
            <Button small variant="secondary">
              Import from Stripe again
            </Button>
          </form>
        </div>
      }
    >
      <Flash {...flash} />
      <Notice tone="info" title="What confirming does.">
        A confirmed customer takes the portal&apos;s identifiers in Stripe and its one bank becomes the default (the ACH app never set one). A linked invoice becomes the portal invoice&apos;s Stripe copy; if Stripe already shows it paid, the portal follows.
      </Notice>
      <Card title={`Stripe customers (${customers.length})`}>
        {customers.length === 0 ? <p className="text-sm text-ink-2">Nothing to match. Run the import from Integrations once Stripe is connected.</p> : null}
        <ul className="divide-y divide-rule-soft">
          {customers.map(({ match: m, suggested, confirmed }) => (
            <li key={m.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">
                    {m.name ?? "(no name)"} <span className="text-xs text-ink-3">{m.email ?? "no email"} · {m.stripeCustomerId}</span>
                  </div>
                  <div className="text-xs text-ink-3">
                    In Stripe since {m.stripeCreatedAt ? fmtDay(m.stripeCreatedAt.toISOString().slice(0, 10)) : "unknown"} · {m.bankLast4 ? `${m.bankName ?? "bank"} ending ${m.bankLast4}${m.hasDefaultBank ? " (default)" : " (not set as default)"}` : "no bank on the customer"}
                  </div>
                </div>
                <StatusBadge value={m.state} />
              </div>
              {m.state === "suggested" ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <form action={confirmMatchAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="matchId" value={m.id} />
                    <Select name="locationId" defaultValue={m.suggestedLocationId ?? ""} required aria-label="Account">
                      <option value="" disabled>
                        {suggested ? `Suggested: ${suggested.tradeName} (by ${m.suggestedBy})` : "Choose the account"}
                      </option>
                      {candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.tradeName} ({c.kind}{c.legacyAccountId ? `, ${c.legacyAccountId}` : ""})
                        </option>
                      ))}
                    </Select>
                    <Input name="note" placeholder="Note" aria-label="Note" />
                    <Button small>Confirm</Button>
                  </form>
                  <form action={dismissMatchAction} className="flex items-end gap-2">
                    <input type="hidden" name="matchId" value={m.id} />
                    <Input name="note" required placeholder="Not ours because…" aria-label="Reason" />
                    <Button small variant="ghost">
                      Dismiss
                    </Button>
                  </form>
                </div>
              ) : (
                <p className="mt-1 text-xs text-ink-3">
                  {m.state === "confirmed" && confirmed ? (
                    <>
                      Linked to{" "}
                      <Link href={`/locations/${confirmed.id}`} className="text-navy hover:underline">
                        {confirmed.tradeName}
                      </Link>
                    </>
                  ) : (
                    "Dismissed"
                  )}{" "}
                  {fmtDate(m.decidedAt)}
                  {m.note ? `: ${m.note}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title={`Stripe invoices the portal did not create (${invoices.length})`}>
        {invoices.length === 0 ? <p className="text-sm text-ink-2">None open. The charge-retailer route and hand-made invoices show up here after an import.</p> : null}
        <Table
          caption="Open or recently paid in Stripe, no portal id"
          head={["Stripe invoice", "Customer", "Due", "Total", "Remaining", "State", "Link to"]}
          widths={[LIST_WIDTHS.number, undefined, LIST_WIDTHS.date, LIST_WIDTHS.money, LIST_WIDTHS.money, LIST_WIDTHS.status, "26rem"]}
          align={["left", "left", "left", "right", "right", "left", "left"]}
          empty="Nothing here."
          rows={invoices.map(({ match: m, location, suggested, linked }) => [
            <span key="n">
              {m.hostedInvoiceUrl ? (
                <a href={m.hostedInvoiceUrl} target="_blank" rel="noopener" className="text-navy hover:underline">
                  {m.stripeNumber ?? m.stripeInvoiceId}
                </a>
              ) : (
                m.stripeNumber ?? m.stripeInvoiceId
              )}
              <span className="block text-xs text-ink-3">{m.status} in Stripe</span>
            </span>,
            <span key="c">
              {m.customerName ?? m.stripeCustomerId ?? "—"}
              {location ? (
                <span className="block text-xs text-ink-3">
                  account{" "}
                  <Link href={`/locations/${location.id}`} className="text-navy hover:underline">
                    {location.tradeName}
                  </Link>
                </span>
              ) : (
                <span className="block text-xs text-ink-3">customer not matched to an account yet</span>
              )}
            </span>,
            fmtDay(m.dueDate),
            formatCents(m.totalCents),
            formatCents(m.amountRemainingCents),
            <StatusBadge key="s" value={m.state} />,
            m.state === "suggested" ? (
              <div key="f" className="space-y-1">
                <form action={linkInvoiceMatchAction} className="flex flex-wrap items-end gap-1">
                  <input type="hidden" name="matchId" value={m.id} />
                  <Select name="invoiceId" defaultValue={m.suggestedInvoiceId ?? ""} required aria-label="Portal invoice">
                    <option value="" disabled>
                      {suggested ? `Suggested: ${suggested.number} (${m.suggestedBy === "amount_and_account" ? "same account and total" : "same total"})` : "Choose the portal invoice"}
                    </option>
                    {invoiceCandidates
                      .filter((c) => c.totalCents === m.totalCents || c.id === m.suggestedInvoiceId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.number} {c.tradeName ?? ""} {formatCents(c.totalCents)} {fmtDay(c.invoiceDate)}
                        </option>
                      ))}
                  </Select>
                  <Button small>Link</Button>
                </form>
                <form action={dismissInvoiceMatchAction} className="flex items-end gap-1">
                  <input type="hidden" name="matchId" value={m.id} />
                  <Input name="note" required placeholder="Handled in Stripe because…" aria-label="Reason" />
                  <Button small variant="ghost">
                    Dismiss
                  </Button>
                </form>
              </div>
            ) : linked ? (
              <Link key="l" href={`/invoices/${linked.id}`} className="text-navy hover:underline">
                {linked.number}
              </Link>
            ) : (
              <span key="d" className="text-xs text-ink-3">
                {m.note ?? "dismissed"}
              </span>
            ),
          ])}
        />
        <p className="mt-2 text-xs text-ink-3">Only portal invoices with the same total are offered; a Stripe invoice with a different total is credited or corrected first, never linked.</p>
      </Card>
    </Page>
  );
}
