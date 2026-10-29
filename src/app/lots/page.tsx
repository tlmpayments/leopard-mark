import Link from "next/link";
import { Button, Code, FilterBar, Flash, Input, Num, Page, Select, Table, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { BRAND_CODES, listLots } from "@/lib/domain/lots/service";
import { listOrigins } from "@/lib/domain/origins/service";
import { todayIso } from "../shipments/labels";

const SOURCE_LABEL: Record<string, string> = { packaging_report: "packaging report", production_tab: "Production tab (import)", bol_log_backfill: "BOL log backfill" };

function ageDays(packagingDate: string, today: string): number {
  return Math.max(0, Math.round((new Date(today + "T00:00:00Z").getTime() - new Date(packagingDate + "T00:00:00Z").getTime()) / 86_400_000));
}

export default async function LotsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("lot.view");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const facility = param(sp, "facility");
  const brand = param(sp, "brand");
  const legacy = param(sp, "legacy") === "1";
  const q = param(sp, "q")?.toUpperCase();
  const d = await getDb();
  const [origins, lots] = await Promise.all([listOrigins(d, { includeInactive: true }), listLots(d, { facilityWarehouseId: facility, brandCode: brand, includeLegacy: legacy })]);
  const facilityName = new Map(origins.map((o) => [o.id, o.name]));
  const brandName = new Map(BRAND_CODES.map((b) => [b.code, b.name]));
  const shown = q ? lots.filter((l) => l.lotCode.includes(q) || (l.legacyCode ?? "").toUpperCase().includes(q)) : lots;
  const today = todayIso();

  return (
    <Page
      title="Lots"
      subtitle="One lot per packaging run: facility, brand, packaging date and run. Every beer line on a shipment names a lot from this list (4.1)."
      actions={
        can(actor, "lot.manage") ? (
          <>
            <Button href="/batches" variant="secondary" small>
              Batches
            </Button>
            <Button href="/lots/new" small>
              Packaging report
            </Button>
          </>
        ) : (
          <Button href="/batches" variant="secondary" small>
            Batches
          </Button>
        )
      }
    >
      <Flash {...flash} />
      <FilterBar>
        <Select name="facility" defaultValue={facility ?? ""} aria-label="Facility" className="min-w-40">
          <option value="">All facilities</option>
          {origins
            .filter((o) => o.kind === "brewery")
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.lotFacilityCode ? `${o.lotFacilityCode} ` : ""}
                {o.name}
              </option>
            ))}
        </Select>
        <Select name="brand" defaultValue={brand ?? ""} aria-label="Brand">
          <option value="">All brands</option>
          {BRAND_CODES.map((b) => (
            <option key={b.code} value={b.code}>
              {b.code} {b.name}
            </option>
          ))}
        </Select>
        <Input name="q" defaultValue={q ?? ""} placeholder="Lot code" aria-label="Lot code" className="w-44 font-mono" />
        <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
          <input type="checkbox" name="legacy" value="1" defaultChecked={legacy} /> Dotted legacy lots
        </label>
        <Button variant="secondary" small>
          Filter
        </Button>
      </FilterBar>
      <Table
        caption="Lots"
        head={["Lot code", "Facility", "Brand", "Packaged", "Run", "Quantities", "Source", "Age (days)"]}
        widths={[LIST_WIDTHS.number, undefined, "11rem", LIST_WIDTHS.date, "3.5rem", LIST_WIDTHS.status, "12rem", LIST_WIDTHS.qty]}
        align={["left", "left", "left", "left", "center", "left", "left", "right"]}
        empty="No lots match this filter."
        rows={shown.map((l) => [
          <Link key="c" href={`/lots/${l.id}`} className="whitespace-nowrap text-navy hover:underline">
            <Code className="font-medium">{l.lotCode}</Code>
            {l.legacyCode ? <span className="ml-1.5 text-[11px] text-ink-3">{l.legacyCode}, history only</span> : null}
          </Link>,
          facilityName.get(l.facilityWarehouseId) ?? "—",
          `${l.brandCode}${brandName.has(l.brandCode) ? ` ${brandName.get(l.brandCode)}` : ""}`,
          <span key="d" className="whitespace-nowrap">{fmtDay(l.packagingDate)}</span>,
          l.runCode,
          l.quantitiesKnown ? <span key="q" className="font-semibold text-navy">Known</span> : <span key="q" className="text-ink-2">Unconfirmed</span>,
          SOURCE_LABEL[l.source] ?? l.source,
          <Num key="a">{String(ageDays(l.packagingDate, today))}</Num>,
        ])}
      />
      <p className="text-xs text-ink-3">Lot age is internal (4.8) and never printed on customer documents. Dotted legacy lots never appear in pickers (1.7).</p>
    </Page>
  );
}
