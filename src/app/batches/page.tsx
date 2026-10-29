import Link from "next/link";
import { isNotNull } from "drizzle-orm";
import { Button, Card, Flash, Input, Page, Select, StatusBadge, fmtDay } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { BRAND_CODES, listBatches, type BatchStatus } from "@/lib/domain/lots/service";
import { listOrigins } from "@/lib/domain/origins/service";
import { todayIso } from "../shipments/labels";
import { setBatchStatusAction } from "./actions";

const STATUSES: BatchStatus[] = ["scheduled", "in_progress", "complete", "destroyed", "cancelled"];

export default async function BatchesPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("lot.view");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const facility = param(sp, "facility");
  const focus = param(sp, "focus");
  const d = await getDb();
  const [origins, batches, lots] = await Promise.all([listOrigins(d, { includeInactive: true }), listBatches(d, { facilityWarehouseId: facility }), d.select({ id: schema.lot.id, lotCode: schema.lot.lotCode, batchId: schema.lot.batchId }).from(schema.lot).where(isNotNull(schema.lot.batchId))]);
  const facilityName = new Map(origins.map((o) => [o.id, o.name]));
  const brandName = new Map(BRAND_CODES.map((b) => [b.code, b.name]));
  const canManage = can(actor, "lot.manage");
  const today = todayIso();

  return (
    <Page title="Brew batches" subtitle="A batch usually yields one lot (4.2); destroyed and cancelled batches keep their status, reason and date (4.10)." actions={canManage ? <Button href="/batches/new">New batch</Button> : null}>
      <Flash {...flash} />
      <form className="flex flex-wrap gap-2" role="search">
        <Select name="facility" defaultValue={facility ?? ""} aria-label="Facility" className="max-w-xs">
          <option value="">All facilities</option>
          {origins
            .filter((o) => o.kind === "brewery")
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </Select>
        <Button variant="secondary">Filter</Button>
        <Button href="/lots" variant="ghost">
          Lots
        </Button>
      </form>
      <Card>
        {batches.length === 0 ? (
          <p className="text-sm text-muted">No batches recorded.</p>
        ) : (
          <ul className="divide-y divide-line">
            {batches.map((b) => {
              const batchLots = lots.filter((l) => l.batchId === b.id);
              return (
                <li key={b.id} id={b.id} className={`py-3 ${focus === b.id ? "rounded-lg bg-info-soft px-2" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm">
                      <span className="font-mono font-medium">{b.batchNumber}</span> · {facilityName.get(b.facilityWarehouseId) ?? "—"} · {b.brandCode}
                      {brandName.has(b.brandCode) ? ` ${brandName.get(b.brandCode)}` : ""}
                      <span className="block text-xs text-muted">
                        {b.brewDate ? `Brewed ${fmtDay(b.brewDate)}` : "No brew date"}
                        {b.vesselSize ? ` · ${b.vesselSize}` : ""}
                        {b.breweryBatchNumber ? ` · brewery # ${b.breweryBatchNumber}` : ""}
                        {b.source === "imported" ? " · imported" : ""}
                        {b.statusChangedOn ? ` · status set ${fmtDay(b.statusChangedOn)}` : ""}
                        {b.statusReason ? ` · ${b.statusReason}` : ""}
                      </span>
                      {batchLots.length ? (
                        <span className="block text-xs">
                          Lots:{" "}
                          {batchLots.map((l, i) => (
                            <span key={l.id}>
                              {i ? ", " : ""}
                              <Link href={`/lots/${l.id}`} className="underline">
                                {l.lotCode}
                              </Link>
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {b.notes ? <span className="block text-xs text-muted">{b.notes}</span> : null}
                    </span>
                    <StatusBadge value={b.status} />
                  </div>
                  {canManage ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-accent">Change status</summary>
                      <form action={setBatchStatusAction} className="mt-1 grid gap-2 sm:grid-cols-4">
                        <input type="hidden" name="batchId" value={b.id} />
                        <Select name="status" defaultValue={b.status} aria-label="Status">
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s.replace(/_/g, " ")}
                            </option>
                          ))}
                        </Select>
                        <Input name="on" type="date" required defaultValue={today} aria-label="Status date" />
                        <Input name="reason" placeholder="Reason (required for destroyed or cancelled)" aria-label="Reason" />
                        <Button small variant="secondary">
                          Save
                        </Button>
                      </form>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </Page>
  );
}
