import { Button, FilterBar, Flash, Input, Notice, Page, Select, Table, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { microstarReport, type MicroStarRow } from "@/lib/domain/kegs/service";
import { listOrigins, originLabel } from "@/lib/domain/origins/service";
import { todayIso } from "../../shipments/labels";

function totals(rows: MicroStarRow[]) {
  const by = new Map<string, { facilityName: string; distributorName: string; halfOut: number; sixtelOut: number; bols: number }>();
  for (const r of rows) {
    const key = `${r.facilityId}|${r.distributorId}`;
    const g = by.get(key) ?? { facilityName: r.facilityName, distributorName: r.distributorName, halfOut: 0, sixtelOut: 0, bols: 0 };
    g.halfOut += r.halfOut;
    g.sixtelOut += r.sixtelOut;
    g.bols += 1;
    by.set(key, g);
  }
  return Array.from(by.values()).sort((a, b) => a.facilityName.localeCompare(b.facilityName) || a.distributorName.localeCompare(b.distributorName));
}

/** MicroStar outbound (8.6, R2-25): per facility per month, kegs out by size, distributor and BOL. Lives under Kegs (R2-35). */
export default async function MicroStarPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("report.export");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const monthParam = param(sp, "month");
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : todayIso().slice(0, 7);
  const facility = param(sp, "facility") ?? "";
  const d = await getDb();
  const breweries = (await listOrigins(d, { includeInactive: true })).filter((o) => o.kind === "brewery");
  const rows = await microstarReport(d, actor, { month, facilityWarehouseId: facility || null });
  const csvHref = `/reports/microstar/csv?month=${month}${facility ? `&facility=${facility}` : ""}`;

  return (
    <Page
      title="MicroStar report"
      actions={
        <Button href={csvHref} variant="secondary">
          Download CSV
        </Button>
      }
    >
      <Flash {...flash} />
      <FilterBar role="search">
        <Input name="month" type="month" defaultValue={month} aria-label="Month" />
        <Select name="facility" defaultValue={facility} aria-label="Facility">
          <option value="">All facilities</option>
          {breweries.map((o) => (
            <option key={o.id} value={o.id}>
              {originLabel(o)}
            </option>
          ))}
        </Select>
        <Button variant="secondary" small>
          Show
        </Button>
      </FilterBar>
      <Table
        caption="MicroStar totals"
        head={["Facility", "Distributor", "BOLs", "1/2 bbl out", "1/6 bbl out"]}
        widths={["14rem", undefined, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.qty]}
        align={["left", "left", "right", "right", "right"]}
        empty="No kegs shipped to a distributor from a brewery this month."
        rows={totals(rows).map((t) => [t.facilityName, t.distributorName, String(t.bols), String(t.halfOut), String(t.sixtelOut)])}
      />
      <Table
        caption="MicroStar detail"
        head={["Facility", "Date", "BOL", "Distributor", "1/2 bbl out", "1/6 bbl out"]}
        widths={["14rem", LIST_WIDTHS.date, LIST_WIDTHS.number, undefined, LIST_WIDTHS.qty, LIST_WIDTHS.qty]}
        align={["left", "left", "left", "left", "right", "right"]}
        empty="No detail."
        rows={rows.map((r) => [r.facilityName, fmtDay(r.on), <span key="n" className="font-display">{r.shipmentNumber ?? "—"}</span>, r.distributorName, String(r.halfOut), String(r.sixtelOut)])}
      />
      <Notice tone="info">Counts only, no serials. Kegs shipped to distributors from a brewery; returns are not tracked here because MicroStar bills the distributor for its kegs (R2-25).</Notice>
    </Page>
  );
}
