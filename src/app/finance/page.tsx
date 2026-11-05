import Link from "next/link";
import { Button, Card, Field, Flash, Input, KV, Notice, Page, StatusBadge, Table, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { formatCents } from "@/lib/domain/catalog/service";
import { AGING_BUCKETS, AGING_BUCKET_LABEL, COLLECTION_STATE_LABEL, arAging, listPayoutsWithDetail, moneySummary } from "@/lib/domain/collection";
import { approvalCounts } from "@/lib/domain/approvals/service";
import { stripeConfigured } from "@/lib/integrations/stripe/adapter";
import { syncPayoutsAction } from "../integrations/actions";
import { todayIso } from "../shipments/labels";
import "@/lib/domain/collection";

/**
 * Finance (Round 4): the office's cash picture, receivables ageing (S7), payouts matched to invoices (S8) and the
 * monthly export for the CFO (R2). Plain tables and plain CSVs; Stripe's own reports stay in the dashboard.
 */
export default async function FinancePage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("finance.view");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const asOf = param(sp, "asOf") ?? todayIso();
  const month = param(sp, "month") ?? asOf.slice(0, 7);
  const d = await getDb();
  const [summary, aging, payouts, counts] = await Promise.all([moneySummary(d, actor, asOf), arAging(d, actor, asOf), listPayoutsWithDetail(d, 20), approvalCounts(d)]);
  const canExport = can(actor, "report.export");
  const manage = can(actor, "integration.manage");
  return (
    <Page
      title="Finance"
      subtitle="Receivables, payments and payouts, with Stripe as the money ledger. The portal invoice stays the official one."
      actions={
        <form method="get" className="flex items-end gap-2">
          <Field label="As of">
            <Input name="asOf" type="date" defaultValue={asOf} />
          </Field>
          <Button small variant="secondary">
            Refresh
          </Button>
        </form>
      }
    >
      <Flash {...flash} />
      {!stripeConfigured() ? <Notice tone="info">Stripe is not connected on this deployment; the figures below come from payments recorded by hand.</Notice> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Debits">
          <KV
            columns={1}
            items={[
              ["Due to run", `${formatCents(summary.scheduledToday.total)} (${summary.scheduledToday.n})`],
              ["Scheduled later", `${formatCents(summary.scheduledLater.total)} (${summary.scheduledLater.n})`],
              ["Processing", `${formatCents(summary.processing.total)} (${summary.processing.n})`],
              ["Returned", `${formatCents(summary.failed.total)} (${summary.failed.n})`],
            ]}
          />
          <p className="mt-2 text-xs text-ink-3">
            {counts.pending ? (
              <Link href="/approvals" className="text-navy hover:underline">
                {counts.pending} item{counts.pending === 1 ? "" : "s"} waiting for approval
              </Link>
            ) : (
              "Nothing waiting for approval"
            )}
          </p>
        </Card>
        <Card title={`Settled in ${month}`}>
          <KV columns={1} items={[["Payments settled", `${formatCents(summary.settled.total)} (${summary.settled.n})`], ["Next payout", summary.nextPayout ? `${formatCents(summary.nextPayout.amountCents)} arriving ${fmtDay(summary.nextPayout.arrivalDate)}` : "none pending"], ["Last payout", summary.lastPayout ? `${formatCents(summary.lastPayout.amountCents)} on ${fmtDay(summary.lastPayout.arrivalDate)}` : "none yet"]]} />
        </Card>
        <Card title="Open receivables">
          <KV columns={1} items={[...AGING_BUCKETS.map((b) => [AGING_BUCKET_LABEL[b], formatCents(aging.totals[b])] as [string, string]), ["Total", formatCents(aging.total)]]} />
        </Card>
      </div>

      <Card
        title={`Receivables ageing as of ${fmtDay(asOf)}`}
        footer={
          canExport ? (
            <a href={`/finance/aging/csv?asOf=${asOf}`} className="text-sm text-navy hover:underline">
              Download CSV
            </a>
          ) : null
        }
      >
        <Table
          caption="Open invoices by account and age"
          head={["Account", "Market", "Pays by", "Current", "1 to 30", "31 to 60", "61 to 90", "90 and over", "Total"]}
          widths={[undefined, "5rem", "6rem", LIST_WIDTHS.money, LIST_WIDTHS.money, LIST_WIDTHS.money, LIST_WIDTHS.money, LIST_WIDTHS.money, LIST_WIDTHS.money]}
          align={["left", "left", "left", "right", "right", "right", "right", "right", "right"]}
          empty="Nothing open."
          rows={aging.rows.map((r) => [
            <span key="a">
              <Link href={`/locations/${r.locationId}`} className="text-navy hover:underline">
                {r.tradeName}
              </Link>
              <span className="block text-xs text-ink-3">{r.invoices.map((i) => `${i.number ?? "draft"} ${COLLECTION_STATE_LABEL[i.collectionState] ? `(${COLLECTION_STATE_LABEL[i.collectionState].toLowerCase()})` : ""}`).join(", ")}</span>
            </span>,
            r.marketCode,
            r.payBy ?? "—",
            ...AGING_BUCKETS.map((b) => (r.buckets[b] ? formatCents(r.buckets[b]) : "")),
            formatCents(r.total),
          ])}
        />
      </Card>

      <Card
        title="Payouts to the bank (Stripe)"
        footer={
          <div className="flex flex-wrap items-center gap-3">
            {canExport ? (
              <a href="/finance/payouts/csv" className="text-sm text-navy hover:underline">
                Download CSV
              </a>
            ) : null}
            {manage && stripeConfigured() ? (
              <form action={syncPayoutsAction}>
                <Button small variant="secondary">
                  Pull payouts from Stripe now
                </Button>
              </form>
            ) : null}
          </div>
        }
      >
        {payouts.length === 0 ? (
          <p className="text-sm text-ink-2">No payouts pulled yet. Stripe sends a webhook when one pays; the portal then pulls what it carried.</p>
        ) : (
          <Table
            caption="Payouts, newest first"
            head={["Arrival", "Status", "Amount", "What it carried"]}
            widths={[LIST_WIDTHS.date, LIST_WIDTHS.status, LIST_WIDTHS.money, undefined]}
            align={["left", "left", "right", "left"]}
            rows={payouts.map(({ payout, lines }) => [
              fmtDay(payout.arrivalDate),
              <StatusBadge key="s" value={payout.status} />,
              formatCents(payout.amountCents),
              lines.length ? (
                <span key="l" className="text-xs">
                  {lines.map((l, i) => (
                    <span key={l.bt.id}>
                      {i ? "; " : ""}
                      {l.inv ? (
                        <Link href={`/invoices/${l.inv.id}`} className="text-navy hover:underline">
                          {l.inv.number}
                        </Link>
                      ) : (
                        l.bt.description ?? l.bt.type
                      )}{" "}
                      {formatCents(l.bt.amountCents)} less {formatCents(l.bt.feeCents)} fee
                    </span>
                  ))}
                </span>
              ) : (
                <span key="n" className="text-xs text-ink-3">
                  not itemised yet
                </span>
              ),
            ])}
          />
        )}
      </Card>

      <Card title="Monthly export for the CFO">
        <form method="get" action="/finance/export/csv" className="flex flex-wrap items-end gap-2">
          <Field label="Month" hint="Invoices by invoice date, payments by date received, credit memos, Stripe payouts and fees. One plain CSV with a section per table.">
            <Input name="month" type="month" defaultValue={month} />
          </Field>
          <Button small variant="secondary" disabled={!canExport}>
            Download CSV
          </Button>
        </form>
      </Card>
    </Page>
  );
}
