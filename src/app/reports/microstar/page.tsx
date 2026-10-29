import { Button, Card, Field, Flash, Input, Notice, Page, Select, Table, fmtDay } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { microstarReport, type MicroStarRow } from "@/lib/domain/kegs/service";
import { todayIso } from "../../shipments/labels";

function groupTotals(rows: MicroStarRow[]) {
  const by = new Map<string, { groupName: string; halfOut: number; sixtelOut: number; halfIn: number; sixtelIn: number; events: number }>();
  for (const r of rows) {
    const g = by.get(r.groupId) ?? { groupName: r.groupName, halfOut: 0, sixtelOut: 0, halfIn: 0, sixtelIn: 0, events: 0 };
    g.halfOut += r.halfOut;
    g.sixtelOut += r.sixtelOut;
    g.halfIn += r.halfIn;
    g.sixtelIn += r.sixtelIn;
    g.events += 1;
    by.set(r.groupId, g);
  }
  return Array.from(by.values()).sort((a, b) => a.groupName.localeCompare(b.groupName));
}

export default async function MicroStarPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("report.export");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const monthParam = param(sp, "month");
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : todayIso().slice(0, 7);
  const groupBy: "distributor" | "brewery" = param(sp, "groupBy") === "brewery" ? "brewery" : "distributor";
  const d = await getDb();
  const rows = await microstarReport(d, actor, { month, groupBy });
  const totals = groupTotals(rows);
  const csvHref = `/reports/microstar/csv?month=${month}&groupBy=${groupBy}`;

  return (
    <Page
      title="MicroStar outbound report"
      subtitle="Kegs shipped per distributor or per brewery for a month, counts only, no serials (8.6)."
      actions={
        <a href={csvHref} className="inline-flex min-h-11 items-center justify-center bg-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">
          Download CSV
        </a>
      }
    >
      <Flash {...flash} />
      <form className="flex flex-wrap items-end gap-2" role="search">
        <Field label="Month">
          <Input name="month" type="month" defaultValue={month} />
        </Field>
        <Field label="Group by">
          <Select name="groupBy" defaultValue={groupBy}>
            <option value="distributor">Distributor (destination account)</option>
            <option value="brewery">Brewery (origin)</option>
          </Select>
        </Field>
        <Button variant="secondary">Show</Button>
      </form>
      <Card title={`Totals for ${month} by ${groupBy}`}>
        <Table
          caption="MicroStar totals"
          head={[groupBy === "distributor" ? "Distributor" : "Brewery", "Events", "1/2 bbl out", "1/6 bbl out", "1/2 bbl in", "1/6 bbl in"]}
          rows={totals.map((t) => [t.groupName, String(t.events), String(t.halfOut), String(t.sixtelOut), String(t.halfIn), String(t.sixtelIn)])}
        />
      </Card>
      <Card title="Detail">
        <Table caption="MicroStar detail" head={["Group", "Date", "Shipment", "1/2 bbl out", "1/6 bbl out", "1/2 bbl in", "1/6 bbl in"]} rows={rows.map((r) => [r.groupName, fmtDay(r.on), r.shipmentNumber ?? "—", String(r.halfOut), String(r.sixtelOut), String(r.halfIn), String(r.sixtelIn)])} />
      </Card>
      <Notice tone="info">{groupBy === "distributor" ? "Only accounts of kind distributor appear; retail deliveries are excluded." : "Only keg events tied to a shipment from a brewery origin appear; hand-entered opening balances and adjustments have no origin."}</Notice>
    </Page>
  );
}
