import { Button, Card, Field, Flash, Input, Notice, Page, Select, Textarea } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { listSkus } from "@/lib/domain/catalog/service";
import { BRAND_CODES, brandCodeForSku, listBatches } from "@/lib/domain/lots/service";
import { listOrigins } from "@/lib/domain/origins/service";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { todayIso } from "../../shipments/labels";
import { recordPackagingReportAction } from "../actions";

/** The one-page packaging report (4.4): the office enters what the host reports; the lot code is computed, never typed. */
export default async function NewLotPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAction("lot.manage");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const facilityParam = param(sp, "facility");
  const d = await getDb();
  const [origins, skus, batches, settings] = await Promise.all([listOrigins(d), listSkus(d), listBatches(d), getCompanySettings(d)]);
  const breweries = origins.filter((o) => o.kind === "brewery");
  const facilityName = new Map(origins.map((o) => [o.id, o.name]));
  const activeSkus = skus.filter((s) => !s.archivedAt);
  const brands = [...BRAND_CODES].sort((a, b) => Number(b.active) - Number(a.active));
  const skuBrands = Array.from(new Set(activeSkus.map((s) => brandCodeForSku(s.code))));
  const openBatches = batches.filter((b) => b.status !== "destroyed" && b.status !== "cancelled" && (!facilityParam || b.facilityWarehouseId === facilityParam));
  const today = todayIso();

  return (
    <Page title="Packaging report" subtitle="One run at a time: facility, brand, packaging date and run digit give the lot code; quantities per SKU come from the host's packaging sheet (4.4).">
      <Flash {...flash} />
      <form action={recordPackagingReportAction} className="space-y-4">
        <Card title="Run">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Facility (brewery)" hint="Only breweries package; the facility's two-digit lot code leads the lot code.">
              <Select name="facilityWarehouseId" required defaultValue={facilityParam ?? ""}>
                <option value="" disabled>
                  Facility…
                </option>
                {breweries.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.lotFacilityCode ? `${o.lotFacilityCode} · ` : "(no lot code) · "}
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Brand">
              <Select name="brandCode" required defaultValue="CNT">
                {brands.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.code} · {b.name}
                    {b.active ? "" : " (inactive)"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Packaging date" hint="Packaging that spans two dates is an open question (4.5): record the date the host reports.">
              <Input name="packagingDate" type="date" required defaultValue={today} />
            </Field>
            <Field label="Run" hint="One digit per packaging run per day (1 for the first run); letters only for experimental variants.">
              <Input name="runCode" required maxLength={1} defaultValue="1" className="w-24 uppercase" />
            </Field>
            <Field label="Batch (optional)" hint="A batch usually yields one lot (4.2). The batch must belong to the facility chosen above.">
              <Select name="batchId" defaultValue="">
                <option value="">No batch</option>
                {openBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNumber} · {facilityName.get(b.facilityWarehouseId) ?? ""} · {b.brandCode} · {b.status.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantities">
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" name="quantitiesUnknown" /> Quantities not yet known (host to confirm; opens an exception, 4.6)
              </label>
            </Field>
          </div>
        </Card>
        <Card title="Quantities packaged per SKU (blank = not in this run)">
          {skuBrands.map((brand) => (
            <div key={brand} className="mb-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-muted">{brand} · {BRAND_CODES.find((b) => b.code === brand)?.name ?? ""}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {activeSkus
                  .filter((s) => brandCodeForSku(s.code) === brand)
                  .map((s) => (
                    <label key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1">
                      <span className="text-sm">
                        <span className="font-mono text-xs">{s.code}</span> {s.brand} {s.name} <span className="text-xs text-muted">({s.sellingUnit})</span>
                      </span>
                      <Input name={`qty:${s.id}`} type="number" min={0} step={1} inputMode="numeric" className="w-24" aria-label={`${s.code} quantity`} />
                    </label>
                  ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted">Enter the SKUs of the brand chosen above; a lot normally holds several SKUs (4.3).</p>
        </Card>
        <Card title="Notes">
          <Textarea name="notes" rows={2} placeholder="Host's sheet reference, Ekos flag, anything the warehouse should know" />
        </Card>
        <div className="flex gap-2">
          <Button>Record lot</Button>
          <Button href="/lots" variant="secondary">
            Cancel
          </Button>
        </div>
      </form>
      <Notice tone="info" title="Marking convention (4.7):">
        {settings.markingConvention ?? "Not set in company settings."}
      </Notice>
    </Page>
  );
}
