import { Button, Card, Field, Input, Notice, Page, Table } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { formatCents } from "@/lib/domain/catalog/service";
import { FORMAT_LABEL, sampleWriteOff } from "@/lib/domain/reports/service";
import { todayIso } from "../../shipments/labels";

function addMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** Sample write-off: no-charge goods (NC invoices) at unit cost by month and recipient. */
export default async function SampleWriteOffPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("report.view");
  const sp = await searchParams;
  const today = todayIso();
  const from = param(sp, "from") ?? addMonths(`${today.slice(0, 7)}-01`, -3);
  const to = param(sp, "to") ?? addMonths(`${today.slice(0, 7)}-01`, 1);
  const d = await getDb();
  const r = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) ? await sampleWriteOff(d, actor, { from, to }) : { rows: [], totals: { units: 0, barrels: 0, costCents: 0, costUnknown: false } };
  return (
    <Page
      title="Sample write-off"
      subtitle="Goods that left at no charge (NC invoices: samples to the samples house or a rep's address, other no-charge orders), valued at the SKU's unit cost."
      actions={
        can(actor, "report.export") ? (
          <Button href={`/reports/sample-writeoff/csv?from=${from}&to=${to}`} variant="secondary">
            Download CSV
          </Button>
        ) : undefined
      }
    >
      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="From (invoice date)">
            <Input name="from" type="date" defaultValue={from} />
          </Field>
          <Field label="To (exclusive)">
            <Input name="to" type="date" defaultValue={to} />
          </Field>
          <Button small variant="secondary">
            Run
          </Button>
        </form>
      </Card>
      {r.totals.costUnknown ? <Notice tone="warn">Some SKUs have no unit cost (Catalog and prices); their rows show no cost and the total leaves them out.</Notice> : null}
      <Table
        caption={`No-charge goods, ${from} to ${to}`}
        head={["Month", "Recipient", "Kind", "Format", "Units", "Barrels", "Cost", "Invoices"]}
        widths={["6rem", undefined, "7rem", "11rem", LIST_WIDTHS.qty, "6rem", LIST_WIDTHS.money, LIST_WIDTHS.qty]}
        align={["left", "left", "left", "left", "right", "right", "right", "right"]}
        empty="Nothing left at no charge in these dates."
        rows={[
          ...r.rows.map((row) => [row.month, row.recipient, row.recipientKind, FORMAT_LABEL[row.packageKind] ?? row.packageKind, String(row.units), row.barrels.toFixed(3), row.costCents === null ? "cost not set" : formatCents(row.costCents), String(row.invoices)]),
          ...(r.rows.length ? [["Total", "", "", "", String(r.totals.units), r.totals.barrels.toFixed(3), formatCents(r.totals.costCents), ""]] : []),
        ]}
      />
    </Page>
  );
}
