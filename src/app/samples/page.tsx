import { Button, Flash, Notice, Page, StatusBadge, Table, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { listSamples } from "@/lib/domain/samples/service";

/**
 * Phase 1 sample withdrawals, kept readable as history (R2-27). New samples are orders with "no charge" to the
 * market's samples house or a rep's home address, which produce an S shipment and an NC invoice.
 */
export default async function SamplesPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("sample.record");
  const d = await getDb();
  const flash = await flashFrom(searchParams);
  const samples = await listSamples(d, actor);
  return (
    <Page
      title="Samples history"
      actions={
        <Button href="/orders/new" variant="secondary">
          New samples order
        </Button>
      }
    >
      <Flash {...flash} />
      <Notice tone="info" title="Samples are orders now (R2-27).">
        Start a new order, choose the market&apos;s samples house or the rep&apos;s home address and tick &quot;No charge&quot;: the goods ship as an S shipment with a BOL and invoice at no charge on the NC series. The withdrawals below are Phase 1 records, kept as history and no longer added to.
      </Notice>
      <Table
        caption="Phase 1 sample withdrawals"
        head={["Date", "Rep", "Product", "Qty", "State", "Notes"]}
        widths={[LIST_WIDTHS.date, "12rem", undefined, LIST_WIDTHS.qty, LIST_WIDTHS.status, "20rem"]}
        align={["left", "left", "left", "right", "left", "left"]}
        empty="No Phase 1 sample withdrawals were recorded."
        rows={samples.map(({ s, sku, rep }) => [fmtDay(s.withdrawnOn), rep.displayName, `${sku.brand} ${sku.name}`, String(s.qty), <StatusBadge key="s" value={s.state} />, [s.notes, s.correctedOfId ? "correction" : null].filter(Boolean).join("; ") || "—"])}
      />
    </Page>
  );
}
