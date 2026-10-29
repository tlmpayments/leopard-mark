import Link from "next/link";
import { isNotNull } from "drizzle-orm";
import { Button, Code, FilterBar, Flash, Input, Page, Select, StatusBadge, Table, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { BRAND_CODES, listBatches, lotYield, type BatchStatus } from "@/lib/domain/lots/service";
import { listOrigins, originLabel } from "@/lib/domain/origins/service";
import { todayIso } from "../shipments/labels";
import { setBatchStatusAction } from "./actions";

const STATUSES: BatchStatus[] = ["scheduled", "in_progress", "complete", "destroyed", "cancelled"];

/** Brew batches: size in barrels against what the packaging report yielded, loss displayed only (R2-22, R2-26). */
export default async function BatchesPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("lot.view");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const facility = param(sp, "facility");
  const focus = param(sp, "focus");
  const d = await getDb();
  const [origins, batches, lots] = await Promise.all([listOrigins(d, { includeInactive: true }), listBatches(d, { facilityWarehouseId: facility }), d.select({ id: schema.lot.id, lotCode: schema.lot.lotCode, batchId: schema.lot.batchId }).from(schema.lot).where(isNotNull(schema.lot.batchId))]);
  const originById = new Map(origins.map((o) => [o.id, o]));
  const brandName = new Map(BRAND_CODES.map((b) => [b.code, b.name]));
  const yields = new Map<string, Awaited<ReturnType<typeof lotYield>>>();
  for (const l of lots) if (l.batchId) yields.set(l.id, await lotYield(d, l.id));
  const canManage = can(actor, "lot.manage");
  const today = todayIso();
  const bbl = (n: number | null) => (n === null ? "—" : n.toFixed(2));

  return (
    <Page title="Brew batches" actions={canManage ? <Button href="/batches/new">New batch</Button> : null}>
      <Flash {...flash} />
      <FilterBar role="search">
        <Select name="facility" defaultValue={facility ?? ""} aria-label="Facility">
          <option value="">All facilities</option>
          {origins
            .filter((o) => o.kind === "brewery")
            .map((o) => (
              <option key={o.id} value={o.id}>
                {originLabel(o)}
              </option>
            ))}
        </Select>
        <Button variant="secondary" small>
          Filter
        </Button>
        <Link href="/lots" className="text-sm text-navy hover:underline">
          Lots
        </Link>
      </FilterBar>
      <Table
        caption="Brew batches"
        head={["Batch", "Facility", "Brand", "Brewed", "Barrels", "Packaged bbl", "Loss bbl", "Lots", "Status", ""]}
        widths={[LIST_WIDTHS.number, "12rem", "9rem", LIST_WIDTHS.date, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.qty, undefined, LIST_WIDTHS.status, "9rem"]}
        align={["left", "left", "left", "left", "right", "right", "right", "left", "left", "left"]}
        empty="No batches recorded."
        rows={batches.map((b) => {
          const batchLots = lots.filter((l) => l.batchId === b.id);
          const packaged = batchLots.reduce((s, l) => s + (yields.get(l.id)?.packagedBarrels ?? 0), 0);
          const barrels = b.barrels ? Number(b.barrels) : null;
          const loss = barrels !== null && batchLots.length ? barrels - packaged : null;
          return [
            <span key="n" id={b.id} className={focus === b.id ? "font-semibold" : ""}>
              <Code>{b.batchNumber}</Code>
              {b.breweryBatchNumber ? <span className="block text-xs text-ink-3">brewery {b.breweryBatchNumber}</span> : null}
            </span>,
            originLabel(originById.get(b.facilityWarehouseId)),
            `${b.brandCode} ${brandName.get(b.brandCode) ?? ""}`.trim(),
            fmtDay(b.brewDate),
            bbl(barrels),
            batchLots.length ? packaged.toFixed(2) : "—",
            loss === null ? "—" : <span key="l" className={loss < 0 ? "font-semibold" : ""}>{loss.toFixed(2)}</span>,
            batchLots.length ? (
              <span key="lots">
                {batchLots.map((l, i) => (
                  <span key={l.id}>
                    {i ? ", " : ""}
                    <Link href={`/lots/${l.id}`} className="text-navy hover:underline">
                      <Code>{l.lotCode}</Code>
                    </Link>
                  </span>
                ))}
              </span>
            ) : (
              <span key="lots" className="text-ink-3">
                not packaged
              </span>
            ),
            <span key="s">
              <StatusBadge value={b.status} />
              {b.statusReason ? <span className="block text-xs text-ink-3">{b.statusReason}</span> : null}
            </span>,
            canManage ? (
              <details key="a">
                <summary className="cursor-pointer text-xs text-navy">Status</summary>
                <form action={setBatchStatusAction} className="mt-1 grid w-56 gap-1.5">
                  <input type="hidden" name="batchId" value={b.id} />
                  <Select name="status" defaultValue={b.status} aria-label="Status">
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                  <Input name="on" type="date" required defaultValue={today} aria-label="Status date" />
                  <Input name="reason" placeholder="Reason (destroyed, cancelled)" aria-label="Reason" />
                  <Button small variant="secondary">
                    Save
                  </Button>
                </form>
              </details>
            ) : (
              ""
            ),
          ];
        })}
      />
      <p className="text-xs text-ink-3">Loss is displayed only: barrels brewed less barrels packaged across the batch&apos;s lots (R2-22). Negative means more was packaged than the batch size says.</p>
    </Page>
  );
}
