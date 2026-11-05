import { Flash, Notice, Page, fmtDay } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { skuLabel } from "@/lib/domain/catalog/label";
import { listSkus } from "@/lib/domain/catalog/service";
import { ACTIVE_BRANDS, BRAND_CODES, packagingBatchOptions, skuInBrand } from "@/lib/domain/lots/service";
import { listOrigins, originLabel } from "@/lib/domain/origins/service";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { todayIso } from "../../shipments/labels";
import { recordPackagingReportAction } from "../actions";
import { PackagingForm, type PackagingFormBatch } from "./packaging-form";

/**
 * The one-page packaging report (4.4): the office enters what the host reports; the lot code is computed, never typed.
 * Batch first: the batch brings its facility and brand. ?facility= narrows the batch list, ?batch= preselects one.
 */
export default async function NewLotPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAction("lot.manage");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const today = todayIso();
  const d = await getDb();
  const [origins, skus, batchOptions, settings] = await Promise.all([listOrigins(d, { includeInactive: true }), listSkus(d), packagingBatchOptions(d, { today }), getCompanySettings(d)]);
  const originById = new Map(origins.map((o) => [o.id, o]));
  const breweries = origins.filter((o) => o.kind === "brewery" && o.active);
  const brandLabel = (code: string) => `${code} ${BRAND_CODES.find((b) => b.code === code)?.name ?? ""}`.trim();
  const batches: PackagingFormBatch[] = batchOptions.map(({ batch: b, lot }) => {
    const facilityLabel = originLabel(originById.get(b.facilityWarehouseId));
    const label = [b.batchNumber, facilityLabel, brandLabel(b.brandCode), b.barrels ? `${Number(b.barrels)} bbl` : null, b.brewDate ? `brewed ${fmtDay(b.brewDate)}` : "brew date not set", lot ? `lot ${lot.lotCode}` : null].filter(Boolean).join(" · ");
    return { id: b.id, label, facilityId: b.facilityWarehouseId, facilityLabel, brandCode: b.brandCode, brandLabel: brandLabel(b.brandCode), lot: lot ? { lotCode: lot.lotCode, lastPackagedOn: lot.lastPackagedOn } : null };
  });
  const facilityParam = param(sp, "facility");

  return (
    <Page title="Packaging report" subtitle="Choose the batch and its brewery and brand fill in; the packaging date and run digit complete the lot code. Quantities per SKU come from the host's packaging sheet (4.4)." wide={false}>
      <Flash {...flash} />
      <PackagingForm
        facilities={breweries.map((o) => ({ id: o.id, label: `${originLabel(o)}${o.lotFacilityCode ? "" : " (no lot code yet)"}` }))}
        brands={ACTIVE_BRANDS.map((b) => ({ code: b.code, name: b.name }))}
        batches={batches}
        skus={skus
          .filter((s) => !s.archivedAt)
          .map((s) => ({ id: s.id, code: s.code, label: skuLabel(s), sellingUnit: s.sellingUnit, brandCodes: BRAND_CODES.filter((b) => skuInBrand(s, b.code)).map((b) => b.code) }))}
        initialFacilityId={facilityParam && breweries.some((o) => o.id === facilityParam) ? facilityParam : ""}
        initialBatchId={param(sp, "batch") ?? ""}
        defaultBrand="CNT"
        today={today}
        action={recordPackagingReportAction}
      />
      <Notice tone="info" title="Marking convention (4.7).">
        {settings.markingConvention ?? "Not set in company settings."}
      </Notice>
    </Page>
  );
}
