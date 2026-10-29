/**
 * Keg balances per account by size, counts only (decisions 8.4, 8.5, 8.6).
 * Balance = Σ out − Σ in. A delivered D or S shipment writes kegs out from its keg lines and kegs in from the empties
 * collected at the stop; opening balances and adjustments are entered by hand.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { authorize } from "@/lib/authz/authorize";
import { marketScopeFor, type Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { BusinessError } from "@/lib/errors";

export type KegEvent = typeof schema.kegEvent.$inferSelect;

export interface KegBalance {
  locationId: string;
  tradeName: string;
  marketId: string;
  kind: string;
  halfOut: number;
  halfIn: number;
  sixtelOut: number;
  sixtelIn: number;
  halfBalance: number;
  sixtelBalance: number;
  lastEventOn: string | null;
}

/**
 * Called inside the delivery transaction; idempotent per shipment. Kegs out count what the account kept: the
 * delivered quantity per line (R2-8), so refused and damaged kegs never enter the account's balance. With
 * `replace`, an office correction (R2-38) rewrites the shipment's event from the corrected lines.
 */
export async function recordKegEventForShipment(db: DbOrTx, actor: Actor, shipmentId: string, opts: { replace?: boolean } = {}) {
  const [s] = await db.select().from(schema.shipment).where(eq(schema.shipment.id, shipmentId));
  if (!s || !s.destinationLocationId) return null;
  const [existing] = await db.select().from(schema.kegEvent).where(and(eq(schema.kegEvent.shipmentId, shipmentId), eq(schema.kegEvent.kind, "shipment")));
  if (existing && !opts.replace) return existing;
  const lines = await db
    .select({ qty: schema.shipmentLine.qty, deliveredQty: schema.shipmentLine.deliveredQty, packageKind: schema.sku.packageKind })
    .from(schema.shipmentLine)
    .innerJoin(schema.sku, eq(schema.sku.id, schema.shipmentLine.skuId))
    .where(eq(schema.shipmentLine.shipmentId, shipmentId));
  let halfOut = 0;
  let sixtelOut = 0;
  for (const l of lines) {
    const kept = l.deliveredQty ?? l.qty;
    if (l.packageKind === "keg_half") halfOut += kept;
    if (l.packageKind === "keg_sixtel") sixtelOut += kept;
  }
  const [pickup] = await db.select().from(schema.shipmentKegPickup).where(eq(schema.shipmentKegPickup.shipmentId, shipmentId));
  const halfIn = pickup?.halfIn ?? 0;
  const sixtelIn = pickup?.sixtelIn ?? 0;
  const on = s.actualDate ?? s.scheduledDate ?? new Date().toISOString().slice(0, 10);
  if (existing) {
    // Never deleted: a correction that leaves no kegs keeps the row at zero with the note, so the history stays readable.
    const [row] = await db.update(schema.kegEvent).set({ halfOut, sixtelOut, halfIn, sixtelIn, on, note: "Corrected by the office after delivery" }).where(eq(schema.kegEvent.id, existing.id)).returning();
    return row;
  }
  if (halfOut + sixtelOut + halfIn + sixtelIn === 0) return null;
  const [row] = await db
    .insert(schema.kegEvent)
    .values({ locationId: s.destinationLocationId, shipmentId, on, kind: "shipment", halfOut, sixtelOut, halfIn, sixtelIn, recordedByEmployeeId: actor.employeeId })
    .returning();
  return row;
}

/** Opening balance or adjustment entered by hand (8.5, 8.7). Pickups without a shipment use kind "pickup". */
export async function recordKegEvent(
  db: DbOrTx,
  actor: Actor,
  input: { locationId: string; on: string; kind: "opening" | "adjustment" | "pickup"; halfOut?: number; sixtelOut?: number; halfIn?: number; sixtelIn?: number; note: string },
) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
  if (!loc) throw new BusinessError("Account not found");
  authorize(actor, "keg.record", { marketId: loc.marketId });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.on)) throw new BusinessError("Date must be YYYY-MM-DD", { field: "on" });
  if (!input.note.trim()) throw new BusinessError("A note is required (who counted, what happened)", { field: "note" });
  const vals = [input.halfOut ?? 0, input.sixtelOut ?? 0, input.halfIn ?? 0, input.sixtelIn ?? 0];
  if (vals.some((v) => !Number.isInteger(v) || v < 0)) throw new BusinessError("Keg counts are whole numbers of zero or more");
  if (vals.every((v) => v === 0)) throw new BusinessError("Enter at least one keg count");
  const [row] = await db
    .insert(schema.kegEvent)
    .values({ locationId: input.locationId, on: input.on, kind: input.kind, halfOut: vals[0], sixtelOut: vals[1], halfIn: vals[2], sixtelIn: vals[3], note: input.note.trim(), recordedByEmployeeId: actor.employeeId })
    .returning();
  await recordAudit(db, actor, { action: "keg.event", subjectType: "keg_event", subjectId: row.id, current: input, marketId: loc.marketId });
  return row;
}

export async function kegBalances(db: DbOrTx, actor: Actor, opts: { marketId?: string; locationId?: string; onlyOpen?: boolean } = {}): Promise<KegBalance[]> {
  const scope = marketScopeFor(actor, ["owner", "admin", "accounting", "sales"]);
  const conds = [];
  if (actor.kind !== "system" && !actor.grants.some((g) => g.role === "owner") && scope !== "all") {
    if (scope.length === 0) return [];
    conds.push(inArray(schema.customerLocation.marketId, scope));
  }
  if (opts.marketId) conds.push(eq(schema.customerLocation.marketId, opts.marketId));
  if (opts.locationId) conds.push(eq(schema.customerLocation.id, opts.locationId));
  const rows = await db
    .select({
      locationId: schema.customerLocation.id,
      tradeName: schema.customerLocation.tradeName,
      marketId: schema.customerLocation.marketId,
      kind: schema.customerLocation.kind,
      halfOut: sql<number>`coalesce(sum(${schema.kegEvent.halfOut}), 0)::int`,
      halfIn: sql<number>`coalesce(sum(${schema.kegEvent.halfIn}), 0)::int`,
      sixtelOut: sql<number>`coalesce(sum(${schema.kegEvent.sixtelOut}), 0)::int`,
      sixtelIn: sql<number>`coalesce(sum(${schema.kegEvent.sixtelIn}), 0)::int`,
      lastEventOn: sql<string | null>`max(${schema.kegEvent.on})`,
    })
    .from(schema.kegEvent)
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.kegEvent.locationId))
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(schema.customerLocation.id, schema.customerLocation.tradeName, schema.customerLocation.marketId, schema.customerLocation.kind)
    .orderBy(asc(schema.customerLocation.tradeName));
  const out = rows.map((r) => ({ ...r, halfBalance: r.halfOut - r.halfIn, sixtelBalance: r.sixtelOut - r.sixtelIn }));
  return opts.onlyOpen ? out.filter((r) => r.halfBalance !== 0 || r.sixtelBalance !== 0) : out;
}

export async function kegHistory(db: DbOrTx, locationId: string, limit = 100): Promise<KegEvent[]> {
  return db.select().from(schema.kegEvent).where(eq(schema.kegEvent.locationId, locationId)).orderBy(desc(schema.kegEvent.on), desc(schema.kegEvent.createdAt)).limit(limit);
}

export interface MicroStarRow {
  facilityId: string;
  facilityName: string;
  on: string;
  shipmentNumber: string | null;
  distributorId: string;
  distributorName: string;
  halfOut: number;
  sixtelOut: number;
}

/**
 * MicroStar outbound report (8.6, R2-25): per facility (brewery origin) per month, every delivered shipment to a
 * distributor with its BOL number and the kegs out by size. Counts only, no serials; returns are not tracked
 * (MicroStar bills the distributor). Hand-entered balances and retail deliveries never appear.
 */
export async function microstarReport(db: DbOrTx, actor: Actor, input: { month: string; facilityWarehouseId?: string | null }): Promise<MicroStarRow[]> {
  authorize(actor, "report.export");
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new BusinessError("Month must be YYYY-MM", { field: "month" });
  const from = `${input.month}-01`;
  const [y, m] = input.month.split("-").map(Number);
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const rows = await db
    .select({ ev: schema.kegEvent, s: schema.shipment, loc: schema.customerLocation, origin: schema.warehouse })
    .from(schema.kegEvent)
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.kegEvent.locationId))
    .innerJoin(schema.shipment, eq(schema.shipment.id, schema.kegEvent.shipmentId))
    .innerJoin(schema.warehouse, eq(schema.warehouse.id, schema.shipment.originWarehouseId))
    .where(and(gte(schema.kegEvent.on, from), lte(schema.kegEvent.on, to), eq(schema.kegEvent.kind, "shipment"), eq(schema.customerLocation.kind, "distributor")))
    .orderBy(asc(schema.warehouse.name), asc(schema.kegEvent.on), asc(schema.shipment.number));
  const out: MicroStarRow[] = [];
  for (const r of rows) {
    if (input.facilityWarehouseId && r.origin.id !== input.facilityWarehouseId) continue;
    if (r.ev.halfOut + r.ev.sixtelOut === 0) continue;
    out.push({ facilityId: r.origin.id, facilityName: r.origin.originCode ? `${r.origin.originCode} ${r.origin.name}` : r.origin.name, on: r.ev.on, shipmentNumber: r.s.number, distributorId: r.loc.id, distributorName: r.loc.tradeName, halfOut: r.ev.halfOut, sixtelOut: r.ev.sixtelOut });
  }
  return out;
}

/** Plain CSV, one row per BOL: facility, date, BOL, distributor, 1/2 bbl out, 1/6 bbl out. */
export function microstarCsv(rows: MicroStarRow[]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Facility", "Date", "BOL", "Distributor", "1/2 bbl out", "1/6 bbl out"];
  return [head.join(","), ...rows.map((r) => [r.facilityName, r.on, r.shipmentNumber, r.distributorName, r.halfOut, r.sixtelOut].map(esc).join(","))].join("\n") + "\n";
}
