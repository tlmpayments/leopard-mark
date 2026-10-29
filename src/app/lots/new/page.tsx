import { Button, Card, Code, Field, Flash, Input, Notice, Page, Select, Textarea } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { listSkus } from "@/lib/domain/catalog/service";
import { ACTIVE_BRANDS, BRAND_CODES, brandCodeForSku, listBatches } from "@/lib/domain/lots/service";
import { listOrigins, originLabel } from "@/lib/domain/origins/service";
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
  const activeSkus = skus.filter((s) => !s.archivedAt);
  const brands = ACTIVE_BRANDS;
  const skuBrands = Array.from(new Set(activeSkus.map((s) => brandCodeForSku(s.code))));
  const openBatches = batches.filter((b) => b.status !== "destroyed" && b.status !== "cancelled" && (!facilityParam || b.facilityWarehouseId === facilityParam));
  const today = todayIso();

  return (
    <Page title="Packaging report" subtitle="One run at a time: facility, brand, packaging date and run digit give the lot code; quantities per SKU come from the host's packaging sheet (4.4)." wide={false}>
      <Flash {...flash} />
      <form action={recordPackagingReportAction} className="space-y-8">
        <Card title="Run">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
            <Field label="Facility (brewery)" hint="Only breweries package; the facility's two-digit lot code leads the lot code.">
              <Select name="facilityWarehouseId" required defaultValue={facilityParam ?? ""}>
                <option value="" disabled>
                  Facility
                </option>
                {breweries.map((o) => (
                  <option key={o.id} value={o.id}>
                    {originLabel(o)}
                    {o.lotFacilityCode ? "" : " (no lot code yet)"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Brand">
              <Select name="brandCode" required defaultValue="CNT">
                {brands.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.code} {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-[1fr_5rem] gap-x-3">
              <Field label="Packaging date" hint="The first day of the run (R2-21); a second day is added on the lot afterwards. The run digit changes only for a different brew.">
                <Input name="packagingDate" type="date" required defaultValue={today} />
              </Field>
              <Field label="Run" hint="One digit per brew.">
                <Input name="runCode" required maxLength={1} defaultValue="1" className="text-center uppercase" />
              </Field>
            </div>
            <Field label="Batch" hint="A batch yields one lot (4.2); choosing a batch already packaged adds this day to its lot (R2-21). Packaged total and loss show against the batch size (R2-22).">
              <Select name="batchId" defaultValue="">
                <option value="">No batch</option>
                {openBatches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNumber} {originLabel(origins.find((o) => o.id === b.facilityWarehouseId))} {b.brandCode}
                    {b.barrels ? ` ${Number(b.barrels).toFixed(0)} bbl` : ""} {b.status.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Quantities" hint="Opens an exception until the host confirms (4.6).">
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" name="quantitiesUnknown" /> Not yet known
              </label>
            </Field>
          </div>
        </Card>

        <Card title="Quantities packaged per SKU">
          <table className="w-full text-[13px] leading-5">
            <thead>
              <tr>
                <th scope="col" className="border-b border-rule py-1 pr-2 text-left font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2">
                  SKU
                </th>
                <th scope="col" className="border-b border-rule py-1 pr-2 text-left font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2">
                  Description
                </th>
                <th scope="col" className="border-b border-rule py-1 pr-2 text-left font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2">
                  Selling unit
                </th>
                <th scope="col" className="w-28 border-b border-rule py-1 text-right font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2">
                  Qty packaged
                </th>
              </tr>
            </thead>
            <tbody>
              {skuBrands.map((brand) => (
                <GroupRows key={brand} brand={brand} name={BRAND_CODES.find((b) => b.code === brand)?.name ?? activeSkus.find((s) => brandCodeForSku(s.code) === brand)?.brand ?? ""} skus={activeSkus.filter((s) => brandCodeForSku(s.code) === brand)} />
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-3">Blank means not in this run. Enter the SKUs of the brand chosen above; a lot normally holds several SKUs (4.3).</p>
        </Card>

        <Card title="Notes">
          <Textarea name="notes" rows={2} placeholder="Host's sheet reference, Ekos flag, anything the warehouse should know" />
        </Card>

        <div className="flex items-center gap-2 border-t border-rule pt-4">
          <Button>Record lot</Button>
          <Button href="/lots" variant="ghost">
            Cancel
          </Button>
        </div>
      </form>
      <Notice tone="info" title="Marking convention (4.7).">
        {settings.markingConvention ?? "Not set in company settings."}
      </Notice>
    </Page>
  );
}

function GroupRows({ brand, name, skus }: { brand: string; name: string; skus: Array<{ id: string; code: string; brand: string; name: string; sellingUnit: string }> }) {
  return (
    <>
      <tr>
        <td colSpan={4} className="pb-1 pt-3 font-display text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3">
          {brand} {name}
        </td>
      </tr>
      {skus.map((s) => (
        <tr key={s.id} className="border-b border-rule-soft hover:bg-hover">
          <td className="py-1 pr-2 align-middle">
            <Code>{s.code}</Code>
          </td>
          <td className="py-1 pr-2 align-middle">
            {s.brand} {s.name}
          </td>
          <td className="py-1 pr-2 align-middle text-ink-2">{s.sellingUnit}</td>
          <td className="py-1 text-right align-middle">
            <Input name={`qty:${s.id}`} type="number" min={0} step={1} inputMode="numeric" className="h-8 w-24 text-right" aria-label={`${s.code} quantity`} />
          </td>
        </tr>
      ))}
    </>
  );
}
