import { Button, Card, Field, Flash, Input, Page, Select, Textarea } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { ACTIVE_BRANDS, type BatchStatus } from "@/lib/domain/lots/service";
import { listOrigins, originLabel } from "@/lib/domain/origins/service";
import { todayIso } from "../../shipments/labels";
import { createBatchAction } from "../actions";

const STATUSES: Array<[BatchStatus, string]> = [
  ["in_progress", "In the tank"],
  ["scheduled", "Scheduled (not brewed yet)"],
  ["complete", "Complete"],
];

/**
 * Batch entry when the beer goes in the tank (R2-26): brand, barrels, facility, brew date. The batch number follows
 * the brewery's convention (B + facility + brand + year + sequence) unless one is typed; the packaging report later
 * shows packaged total and loss against the barrels (R2-22).
 */
export default async function NewBatchPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAction("lot.manage");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const breweries = (await listOrigins(d)).filter((o) => o.kind === "brewery");
  return (
    <Page title="New brew batch" wide={false}>
      <Flash {...flash} />
      <form action={createBatchAction}>
        <Card title="When the beer goes in the tank">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Field label="Brand">
              <Select name="brandCode" required defaultValue="CNT">
                {ACTIVE_BRANDS.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.code} {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Batch size (barrels)" hint="From the brewer's report; packaged total and loss are shown against it.">
              <Input name="barrels" type="number" min={0.01} step="0.01" required inputMode="decimal" className="text-right" placeholder="30" />
            </Field>
            <Field label="Facility (brewery)">
              <Select name="facilityWarehouseId" required defaultValue="">
                <option value="" disabled>
                  Facility
                </option>
                {breweries.map((o) => (
                  <option key={o.id} value={o.id}>
                    {originLabel(o)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Brew date">
              <Input name="brewDate" type="date" required defaultValue={todayIso()} />
            </Field>
            <Field label="Batch number" hint="Leave blank to number it B + facility + brand + year + sequence.">
              <Input name="batchNumber" placeholder="assigned" className="uppercase" />
            </Field>
            <Field label="Status">
              <Select name="status" defaultValue="in_progress">
                {STATUSES.map(([s, label]) => (
                  <option key={s} value={s}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Vessel">
              <Input name="vesselSize" placeholder="e.g. 30 bbl FV2" />
            </Field>
            <Field label="Brewery's own batch number">
              <Input name="breweryBatchNumber" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Notes">
                <Textarea name="notes" rows={2} />
              </Field>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Button>Record batch</Button>
            <Button href="/batches" variant="secondary">
              Cancel
            </Button>
          </div>
        </Card>
      </form>
    </Page>
  );
}
