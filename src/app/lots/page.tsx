import Link from "next/link";
import { Badge, Button, Card, Flash, Input, Page, Select, Table, fmtDay } from "@/components/ui";
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
            <Button href="/lots/new">Packaging report</Button>
            <Button href="/batches" variant="secondary">
              Batches
            </Button>
          </>
        ) : (
          <Button href="/batches" variant="secondary">
            Batches
          </Button>
        )
      }
    >
      <Flash {...flash} />
      <form className="grid gap-2 sm:grid-cols-5" role="search">
        <Select name="facility" defaultValue={facility ?? ""} aria-label="Facility">
          <option value="">All facilities</option>
          {origins
            .filter((o) => o.kind === "brewery")
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.lotFacilityCode ? `${o.lotFacilityCode} · ` : ""}
                {o.name}
              </option>
            ))}
        </Select>
        <Select name="brand" defaultValue={brand ?? ""} aria-label="Brand">
          <option value="">All brands</option>
          {BRAND_CODES.map((b) => (
            <option key={b.code} value={b.code}>
              {b.code} · {b.name}
            </option>
          ))}
        </Select>
        <Input name="q" defaultValue={q ?? ""} placeholder="Lot code" aria-label="Lot code" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="legacy" value="1" defaultChecked={legacy} /> Show dotted legacy lots
        </label>
        <Button variant="secondary">Filter</Button>
      </form>
      <Card>
        <Table
          caption="Lots"
          head={["Lot code", "Facility", "Brand", "Packaged", "Run", "Quantities", "Source", "Age (days)"]}
          rows={shown.map((l) => [
            <Link key="c" href={`/lots/${l.id}`} className="font-mono text-sm font-medium hover:underline">
              {l.lotCode}
              {l.legacyCode ? <span className="ml-1 text-xs text-muted">({l.legacyCode}, history only)</span> : null}
            </Link>,
            facilityName.get(l.facilityWarehouseId) ?? "—",
            `${l.brandCode}${brandName.has(l.brandCode) ? ` · ${brandName.get(l.brandCode)}` : ""}`,
            fmtDay(l.packagingDate),
            l.runCode,
            l.quantitiesKnown ? <Badge key="q" tone="good">known</Badge> : <Badge key="q" tone="warn">unconfirmed</Badge>,
            SOURCE_LABEL[l.source] ?? l.source,
            String(ageDays(l.packagingDate, today)),
          ])}
        />
        <p className="mt-2 text-xs text-muted">Lot age is internal (4.8) and never printed on customer documents. Dotted legacy lots never appear in pickers (1.7).</p>
      </Card>
    </Page>
  );
}
