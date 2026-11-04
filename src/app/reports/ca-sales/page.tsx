import { Button, Card, Field, Input, Page, Table } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { formatCents } from "@/lib/domain/catalog/service";
import { FORMAT_LABEL, isCaliforniaMarket, listMarketsForReports, salesByFormat } from "@/lib/domain/reports/service";
import { todayIso } from "../../shipments/labels";

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
function addMonths(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** California sales by format: units and barrels per month and package from issued invoices, for the state beer return. */
export default async function CaSalesPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("report.view");
  const sp = await searchParams;
  const today = todayIso();
  const from = param(sp, "from") ?? addMonths(monthStart(today), -3);
  const to = param(sp, "to") ?? addMonths(monthStart(today), 1);
  const d = await getDb();
  const markets = await listMarketsForReports(d);
  const chosen = ([] as string[]).concat(sp.market ?? []).filter(Boolean);
  const ids = chosen.length ? chosen : markets.filter(isCaliforniaMarket).map((m) => m.id);
  const r = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) ? await salesByFormat(d, actor, { from, to, marketIds: ids }) : { rows: [], totals: { units: 0, barrels: 0, revenueCents: 0 } };
  const query = new URLSearchParams([["from", from], ["to", to], ...ids.map((id) => ["market", id] as [string, string])]).toString();
  return (
    <Page
      title="California sales by format"
      subtitle="Charged beer on issued invoices (INV) by month and package, with barrels (31 gallons). Choose other markets to run it for them."
      actions={
        can(actor, "report.export") ? (
          <Button href={`/reports/ca-sales/csv?${query}`} variant="secondary">
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
          <Field label="Markets" hint="California markets are pre-selected.">
            <div className="flex flex-wrap gap-3 text-sm">
              {markets.map((m) => (
                <label key={m.id} className="flex items-center gap-1">
                  <input type="checkbox" name="market" value={m.id} defaultChecked={ids.includes(m.id)} /> {m.code}
                </label>
              ))}
            </div>
          </Field>
          <Button small variant="secondary">
            Run
          </Button>
        </form>
      </Card>
      <Table
        caption={`Sales by format, ${from} to ${to}`}
        head={["Month", "Format", "Units", "Barrels", "Revenue", "Invoices"]}
        widths={["6rem", undefined, LIST_WIDTHS.qty, "7rem", LIST_WIDTHS.money, LIST_WIDTHS.qty]}
        align={["left", "left", "right", "right", "right", "right"]}
        empty="No charged beer invoiced in these markets and dates."
        rows={[
          ...r.rows.map((row) => [row.month, FORMAT_LABEL[row.packageKind] ?? row.packageKind, String(row.units), row.barrels.toFixed(3), formatCents(row.revenueCents), String(row.invoices)]),
          ...(r.rows.length ? [["Total", "", String(r.totals.units), r.totals.barrels.toFixed(3), formatCents(r.totals.revenueCents), ""]] : []),
        ]}
      />
    </Page>
  );
}
