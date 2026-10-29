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

/** Called inside the delivery transaction; idempotent per shipment. */
export async function recordKegEventForShipment(db: DbOrTx, actor: Actor, shipmentId: string) {
  const [s] = await db.select().from(schema.shipment).where(eq(schema.shipment.id, shipmentId));
  if (!s || !s.destinationLocationId) return null;
  const [existing] = await db.select().from(schema.kegEvent).where(and(eq(schema.kegEvent.shipmentId, shipmentId), eq(schema.kegEvent.kind, "shipment")));
  if (existing) return existing;
  const lines = await db
    .select({ qty: schema.shipmentLine.qty, packageKind: schema.sku.packageKind })
    .from(schema.shipmentLine)
    .innerJoin(schema.sku, eq(schema.sku.id, schema.shipmentLine.skuId))
    .where(eq(schema.shipmentLine.shipmentId, shipmentId));
  let halfOut = 0;
  let sixtelOut = 0;
  for (const l of lines) {
    if (l.packageKind === "keg_half") halfOut += l.qty;
    if (l.packageKind === "keg_sixtel") sixtelOut += l.qty;
  }
  const [pickup] = await db.select().from(schema.shipmentKegPickup).where(eq(schema.shipmentKegPickup.shipmentId, shipmentId));
  const halfIn = pickup?.halfIn ?? 0;
  const sixtelIn = pickup?.sixtelIn ?? 0;
  if (halfOut + sixtelOut + halfIn + sixtelIn === 0) return null;
  const [row] = await db
    .insert(schema.kegEvent)
    .values({ locationId: s.destinationLocationId, shipmentId, on: s.actualDate ?? s.scheduledDate, kind: "shipment", halfOut, sixtelOut, halfIn, sixtelIn, recordedByEmployeeId: actor.employeeId })
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
  groupId: string;
  groupName: string;
  on: string;
  shipmentNumber: string | null;
  halfOut: number;
  sixtelOut: number;
  halfIn: number;
  sixtelIn: number;
}

/**
 * MicroStar outbound report (8.6): kegs shipped per distributor (by destination account) or per brewery (by origin) for
 * a month. Counts only, no serials. Returned as rows for CSV and on-screen use.
 */
export async function microstarReport(db: DbOrTx, actor: Actor, input: { month: string; groupBy: "distributor" | "brewery" }): Promise<MicroStarRow[]> {
  authorize(actor, "report.export");
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new BusinessError("Month must be YYYY-MM", { field: "month" });
  const from = `${input.month}-01`;
  const [y, m] = input.month.split("-").map(Number);
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const rows = await db
    .select({ ev: schema.kegEvent, s: schema.shipment, loc: schema.customerLocation, origin: schema.warehouse })
    .from(schema.kegEvent)
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.kegEvent.locationId))
    .leftJoin(schema.shipment, eq(schema.shipment.id, schema.kegEvent.shipmentId))
    .leftJoin(schema.warehouse, eq(schema.warehouse.id, schema.shipment.originWarehouseId))
    .where(and(gte(schema.kegEvent.on, from), lte(schema.kegEvent.on, to)))
    .orderBy(asc(schema.kegEvent.on));
  const out: MicroStarRow[] = [];
  for (const r of rows) {
    if (input.groupBy === "distributor") {
      if (r.loc.kind !== "distributor") continue;
      out.push({ groupId: r.loc.id, groupName: r.loc.tradeName, on: r.ev.on, shipmentNumber: r.s?.number ?? null, halfOut: r.ev.halfOut, sixtelOut: r.ev.sixtelOut, halfIn: r.ev.halfIn, sixtelIn: r.ev.sixtelIn });
    } else {
      if (!r.origin || r.origin.kind !== "brewery") continue;
      out.push({ groupId: r.origin.id, groupName: r.origin.name, on: r.ev.on, shipmentNumber: r.s?.number ?? null, halfOut: r.ev.halfOut, sixtelOut: r.ev.sixtelOut, halfIn: r.ev.halfIn, sixtelIn: r.ev.sixtelIn });
    }
  }
  return out;
}

export function microstarCsv(rows: MicroStarRow[]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Group", "Date", "Shipment", "1/2 bbl out", "1/6 bbl out", "1/2 bbl in", "1/6 bbl in"];
  return [head.join(","), ...rows.map((r) => [r.groupName, r.on, r.shipmentNumber, r.halfOut, r.sixtelOut, r.halfIn, r.sixtelIn].map(esc).join(","))].join("\n") + "\n";
}
