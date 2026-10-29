import { Button, Card, Field, Flash, Input, Page, Select, Textarea } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { BRAND_CODES, type BatchStatus } from "@/lib/domain/lots/service";
import { listOrigins } from "@/lib/domain/origins/service";
import { createBatchAction } from "../actions";

const STATUSES: BatchStatus[] = ["scheduled", "in_progress", "complete"];

export default async function NewBatchPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAction("lot.manage");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const breweries = (await listOrigins(d)).filter((o) => o.kind === "brewery");
  const brands = [...BRAND_CODES].sort((a, b) => Number(b.active) - Number(a.active));
  return (
    <Page title="New brew batch" subtitle="Batch number as the brewery and the Production tab use it, for example B01CNT26001.">
      <Flash {...flash} />
      <form action={createBatchAction}>
        <Card>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Facility (brewery)">
              <Select name="facilityWarehouseId" required defaultValue="">
                <option value="" disabled>
                  Facility…
                </option>
                {breweries.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.lotFacilityCode ? `${o.lotFacilityCode} · ` : ""}
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
            <Field label="Batch number">
              <Input name="batchNumber" required placeholder="B01CNT26001" className="uppercase" />
            </Field>
            <Field label="Brew date">
              <Input name="brewDate" type="date" />
            </Field>
            <Field label="Vessel size">
              <Input name="vesselSize" placeholder="e.g. 30 bbl" />
            </Field>
            <Field label="Brewery's own batch number">
              <Input name="breweryBatchNumber" />
            </Field>
            <Field label="Status">
              <Select name="status" defaultValue="scheduled">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notes">
              <Textarea name="notes" rows={2} />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
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
