import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { withTx, type DbOrTx, type Tx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { openException, resolveByDedupeKeys } from "@/lib/exceptions/service";

/**
 * Allocation / available-to-sell (brief §16, O18).
 *
 * Meanings kept distinct:
 *   on-hand (evidence-backed sellable stock at a warehouse)
 *   reserved (submitted demand holding units, state = reserved)
 *   route-committed (loaded on a truck: on-hand already reduced by the load movement)
 *   unavailable / pending inspection / in transit (never available)
 *
 * available = on-hand − Σ reserved. Fulfillment consumes the reservation and
 * the load movement reduces on-hand; the same units are never subtracted
 * twice (R20).
 *
 * Coherence rules enforced across every stock path (§4.3):
 *   - new commitments and ordinary sample consumption take only UNRESERVED units;
 *   - physical evidence is never falsified: a count below reservations is
 *     recorded as-is and exposed as an owned allocation discrepancy whose
 *     deficit stays visible (never hidden by a clamped "available 0");
 *   - released stock is offered to existing waiting demand (oldest first,
 *     excluding Admin-displaced demand — D14 stays unselected) before any
 *     newer demand can take it.
 */

export interface Availability {
  warehouseId: string;
  skuId: string;
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
  /** Reservations exceeding physical stock (a recorded shortfall); 0 when supportable. */
  deficitQty: number;
  unavailableQty: number;
  pendingInspectionQty: number;
  inTransitQty: number;
  evidenceSource: string | null;
  evidenceAt: Date | null;
}

export async function availability(db: DbOrTx, warehouseId: string, skuId: string): Promise<Availability> {
  const [pos] = await db
    .select()
    .from(schema.stockPosition)
    .where(and(eq(schema.stockPosition.warehouseId, warehouseId), eq(schema.stockPosition.skuId, skuId)));
  const [{ reserved: orderReserved }] = await db
    .select({ reserved: sql<number>`coalesce(sum(${schema.reservation.reservedQty}), 0)::int` })
    .from(schema.reservation)
    .where(and(eq(schema.reservation.warehouseId, warehouseId), eq(schema.reservation.skuId, skuId), eq(schema.reservation.state, "reserved")));
  // Confirmed shipments hold stock at the origin until delivery or void (SHIPMENTS_SPEC §2, acceptance 3).
  const [{ allocated }] = await db
    .select({ allocated: sql<number>`coalesce(sum(${schema.shipmentAllocation.qty}), 0)::int` })
    .from(schema.shipmentAllocation)
    .where(and(eq(schema.shipmentAllocation.warehouseId, warehouseId), eq(schema.shipmentAllocation.skuId, skuId), isNull(schema.shipmentAllocation.releasedAt)));
  const reserved = orderReserved + allocated;
  const onHand = pos?.onHandQty ?? 0;
  return {
    warehouseId,
    skuId,
    onHandQty: onHand,
    reservedQty: reserved,
    availableQty: Math.max(0, onHand - reserved),
    deficitQty: Math.max(0, reserved - onHand),
    unavailableQty: pos?.unavailableQty ?? 0,
    pendingInspectionQty: pos?.pendingInspectionQty ?? 0,
    inTransitQty: pos?.inTransitQty ?? 0,
    evidenceSource: pos?.evidenceSource ?? null,
    evidenceAt: pos?.evidenceAt ?? null,
  };
}

export async function warehouseAvailability(db: DbOrTx, warehouseId: string) {
  const positions = await db.select().from(schema.stockPosition).where(eq(schema.stockPosition.warehouseId, warehouseId));
  const reservedRows = await db
    .select({ skuId: schema.reservation.skuId, reserved: sql<number>`coalesce(sum(${schema.reservation.reservedQty}), 0)::int` })
    .from(schema.reservation)
    .where(and(eq(schema.reservation.warehouseId, warehouseId), eq(schema.reservation.state, "reserved")))
    .groupBy(schema.reservation.skuId);
  const allocatedRows = await db
    .select({ skuId: schema.shipmentAllocation.skuId, allocated: sql<number>`coalesce(sum(${schema.shipmentAllocation.qty}), 0)::int` })
    .from(schema.shipmentAllocation)
    .where(and(eq(schema.shipmentAllocation.warehouseId, warehouseId), isNull(schema.shipmentAllocation.releasedAt)))
    .groupBy(schema.shipmentAllocation.skuId);
  const reservedBySku = new Map(reservedRows.map((r) => [r.skuId, r.reserved]));
  for (const a of allocatedRows) reservedBySku.set(a.skuId, (reservedBySku.get(a.skuId) ?? 0) + a.allocated);
  return positions.map((p) => {
    const reserved = reservedBySku.get(p.skuId) ?? 0;
    return { ...p, reservedQty: reserved, availableQty: Math.max(0, p.onHandQty - reserved), deficitQty: Math.max(0, reserved - p.onHandQty) };
  });
}

/**
 * Lock the stock position row so concurrent submissions are serialized
 * (first-come-first-served). Creates a zero row if none exists.
 */
export async function lockPosition(tx: Tx, warehouseId: string, skuId: string) {
  await tx.insert(schema.stockPosition).values({ warehouseId, skuId, onHandQty: 0 }).onConflictDoNothing();
  const [pos] = await tx
    .select()
    .from(schema.stockPosition)
    .where(and(eq(schema.stockPosition.warehouseId, warehouseId), eq(schema.stockPosition.skuId, skuId)))
    .for("update");
  return pos;
}

export interface ReserveResult {
  reservationId: string;
  reservedQty: number;
  unmetQty: number;
}

/**
 * Reserve supportable units for an order line at submission (inside the
 * caller's transaction). Waiting demand that predates this line is served
 * first from any stock that became available since it was recorded, so a
 * newer order can never jump an older shortage (REV-09, AC10).
 */
export async function reserveForLine(
  tx: Tx,
  actor: Actor,
  input: { orderLineId: string; warehouseId: string; skuId: string; qty: number },
): Promise<ReserveResult> {
  await lockPosition(tx, input.warehouseId, input.skuId);
  await fillUnmetDemand(tx, actor, input.warehouseId, input.skuId);
  const avail = await availability(tx, input.warehouseId, input.skuId);
  const reservedQty = Math.min(avail.availableQty, input.qty);
  const unmetQty = input.qty - reservedQty;
  const [row] = await tx
    .insert(schema.reservation)
    .values({ orderLineId: input.orderLineId, warehouseId: input.warehouseId, skuId: input.skuId, reservedQty, unmetQty, state: "reserved" })
    .returning();
  return { reservationId: row.id, reservedQty, unmetQty };
}

/**
 * Release unused reserved units (cancellation/amendment) and immediately
 * offer them to waiting demand, oldest first, under the position lock. Never
 * touches route-committed stock.
 */
export async function releaseLineReservations(
  tx: Tx,
  actor: Actor,
  orderLineId: string,
  reason: string,
): Promise<{ released: number; routeCommittedLeft: number }> {
  // Lock order is always position → reservation (same as fillUnmetDemand) so concurrent paths cannot deadlock.
  const peek = await tx.select({ warehouseId: schema.reservation.warehouseId, skuId: schema.reservation.skuId }).from(schema.reservation).where(eq(schema.reservation.orderLineId, orderLineId));
  const keys = Array.from(new Set(peek.map((p) => `${p.warehouseId}|${p.skuId}`))).sort();
  for (const key of keys) {
    const [warehouseId, skuId] = key.split("|");
    await lockPosition(tx, warehouseId, skuId);
  }
  const rows = await tx.select().from(schema.reservation).where(eq(schema.reservation.orderLineId, orderLineId)).for("update");
  let released = 0;
  let routeCommittedLeft = 0;
  const touched = new Set<string>();
  for (const r of rows) {
    if (r.state === "reserved") {
      await tx
        .update(schema.reservation)
        .set({ state: "released", releasedAt: new Date(), releaseReason: reason, releasedByEmployeeId: actor.employeeId })
        .where(eq(schema.reservation.id, r.id));
      released += r.reservedQty;
      touched.add(`${r.warehouseId}|${r.skuId}`);
    } else if (r.state === "route_committed") {
      routeCommittedLeft += r.reservedQty;
    }
  }
  for (const key of touched) {
    const [warehouseId, skuId] = key.split("|");
    await fillUnmetDemand(tx, actor, warehouseId, skuId);
  }
  return { released, routeCommittedLeft };
}

/**
 * Amend the demand of an existing line to a new remaining quantity WITHOUT
 * losing the line's place in the queue (REV-09/AC10): a reduction trims
 * unmet demand first, then reserved units (which are offered to older
 * waiting demand); an increase is new demand — waiting demand is served
 * first, then the extra takes what is left.
 */
export async function adjustLineReservation(tx: Tx, actor: Actor, input: { orderLineId: string; warehouseId: string; skuId: string; targetRemaining: number }) {
  await lockPosition(tx, input.warehouseId, input.skuId);
  const [existing] = await tx
    .select()
    .from(schema.reservation)
    .where(and(eq(schema.reservation.orderLineId, input.orderLineId), eq(schema.reservation.state, "reserved")))
    .for("update");
  if (!existing) {
    if (input.targetRemaining <= 0) return { reservedQty: 0, unmetQty: 0 };
    return reserveForLine(tx, actor, { orderLineId: input.orderLineId, warehouseId: input.warehouseId, skuId: input.skuId, qty: input.targetRemaining });
  }
  const current = existing.reservedQty + existing.unmetQty;
  if (input.targetRemaining === current) return { reservedQty: existing.reservedQty, unmetQty: existing.unmetQty };
  if (input.targetRemaining <= 0) {
    await tx.update(schema.reservation).set({ state: "released", releasedAt: new Date(), releaseReason: "amended to zero", releasedByEmployeeId: actor.employeeId }).where(eq(schema.reservation.id, existing.id));
    await fillUnmetDemand(tx, actor, input.warehouseId, input.skuId);
    return { reservedQty: 0, unmetQty: 0 };
  }
  if (input.targetRemaining < current) {
    const reservedQty = Math.min(existing.reservedQty, input.targetRemaining);
    const unmetQty = input.targetRemaining - reservedQty;
    await tx.update(schema.reservation).set({ reservedQty, unmetQty }).where(eq(schema.reservation.id, existing.id));
    if (reservedQty < existing.reservedQty) await fillUnmetDemand(tx, actor, input.warehouseId, input.skuId);
    return { reservedQty, unmetQty };
  }
  // Increase: older waiting demand first, then this line's extra units.
  await fillUnmetDemand(tx, actor, input.warehouseId, input.skuId);
  const extra = input.targetRemaining - current;
  const avail = (await availability(tx, input.warehouseId, input.skuId)).availableQty;
  const add = Math.min(avail, extra);
  const reservedQty = existing.reservedQty + add;
  const unmetQty = existing.unmetQty + (extra - add);
  await tx.update(schema.reservation).set({ reservedQty, unmetQty }).where(eq(schema.reservation.id, existing.id));
  return { reservedQty, unmetQty };
}

/**
 * Fill retained unmet demand for a warehouse/SKU from current availability,
 * oldest reservation first (the original submission order). Called after
 * stock receipt/adjustment, after any release and before any new
 * reservation. This is the confirmed FCFS behaviour applied to retained
 * demand, not a D14 priority policy: nothing is displaced.
 */
export async function fillUnmetDemand(tx: Tx, actor: Actor, warehouseId: string, skuId: string) {
  await lockPosition(tx, warehouseId, skuId);
  const before = await availability(tx, warehouseId, skuId);
  let avail = before.availableQty;
  const filled: Array<{ reservationId: string; qty: number }> = [];
  const resolvedKeys: string[] = [];
  if (avail > 0) {
    const unmet = await tx
      .select()
      .from(schema.reservation)
      .where(
        and(
          eq(schema.reservation.warehouseId, warehouseId),
          eq(schema.reservation.skuId, skuId),
          eq(schema.reservation.state, "reserved"),
          sql`${schema.reservation.unmetQty} > 0`,
          // Demand Admin displaced keeps its place in the record but is not auto-restored (D14 unselected).
          sql`${schema.reservation.displacedAt} is null`,
        ),
      )
      .orderBy(schema.reservation.createdAt, schema.reservation.id)
      .for("update");
    for (const r of unmet) {
      if (avail <= 0) break;
      const take = Math.min(avail, r.unmetQty);
      await tx.update(schema.reservation).set({ reservedQty: r.reservedQty + take, unmetQty: r.unmetQty - take }).where(eq(schema.reservation.id, r.id));
      avail -= take;
      filled.push({ reservationId: r.id, qty: take });
      if (r.unmetQty - take === 0) {
        const [line] = await tx.select({ orderId: schema.orderLine.orderId }).from(schema.orderLine).where(eq(schema.orderLine.id, r.orderLineId));
        if (line) resolvedKeys.push(`allocation_shortage:${line.orderId}`);
      }
      await recordAudit(tx, actor, {
        action: "allocation.fill_unmet",
        subjectType: "reservation",
        subjectId: r.id,
        prior: { reservedQty: r.reservedQty, unmetQty: r.unmetQty },
        current: { reservedQty: r.reservedQty + take, unmetQty: r.unmetQty - take },
      });
    }
  }
  // A shortage case resolves only when every line of that order is fully reserved.
  const stillOpen = new Set<string>();
  for (const key of resolvedKeys) {
    const orderId = key.split(":")[1];
    const lines = await tx.select({ id: schema.orderLine.id }).from(schema.orderLine).where(eq(schema.orderLine.orderId, orderId));
    const [{ open }] = await tx
      .select({ open: sql<number>`coalesce(sum(${schema.reservation.unmetQty}), 0)::int` })
      .from(schema.reservation)
      .where(and(inArray(schema.reservation.orderLineId, lines.map((l) => l.id)), eq(schema.reservation.state, "reserved")));
    if (open > 0) stillOpen.add(key);
  }
  await resolveByDedupeKeys(tx, actor, resolvedKeys.filter((k) => !stillOpen.has(k)), "Unmet demand filled from available stock");
  // A previously recorded shortfall that is now covered resolves itself.
  const after = await availability(tx, warehouseId, skuId);
  if (after.deficitQty === 0) {
    await resolveByDedupeKeys(tx, actor, [discrepancyKey(warehouseId, skuId)], "Physical stock again covers every reservation");
  }
  return filled;
}

export function discrepancyKey(warehouseId: string, skuId: string) {
  return `allocation_discrepancy:${warehouseId}:${skuId}`;
}

/**
 * After physical stock decreased: if reservations now exceed on-hand, keep
 * the physical fact and open ONE owned discrepancy naming every affected
 * commitment. Admin resolves it by sourcing stock or by explicitly releasing
 * (displacing) specific reservations — never by the system silently trimming
 * commitments (§4.3, REV-03/REV-05).
 */
async function surfaceDiscrepancy(tx: Tx, actor: Actor, warehouseId: string, skuId: string, cause: string) {
  const avail = await availability(tx, warehouseId, skuId);
  if (avail.deficitQty === 0) return null;
  const affected = await tx
    .select({ reservationId: schema.reservation.id, reservedQty: schema.reservation.reservedQty, orderId: schema.orderLine.orderId, orderNumber: schema.order.orderNumber, locationId: schema.order.locationId, marketId: schema.order.marketId })
    .from(schema.reservation)
    .innerJoin(schema.orderLine, eq(schema.orderLine.id, schema.reservation.orderLineId))
    .innerJoin(schema.order, eq(schema.order.id, schema.orderLine.orderId))
    .where(and(eq(schema.reservation.warehouseId, warehouseId), eq(schema.reservation.skuId, skuId), eq(schema.reservation.state, "reserved"), sql`${schema.reservation.reservedQty} > 0`))
    .orderBy(schema.reservation.createdAt);
  const [wh] = await tx.select().from(schema.warehouse).where(eq(schema.warehouse.id, warehouseId));
  const [sku] = await tx.select().from(schema.sku).where(eq(schema.sku.id, skuId));
  return openException(tx, actor, {
    category: "allocation_discrepancy",
    title: `Stock shortfall: ${sku?.name ?? "SKU"} at ${wh?.name ?? "warehouse"} — ${avail.deficitQty} reserved unit(s) not physically on hand`,
    cause: `${cause}. On hand ${avail.onHandQty}, reserved ${avail.reservedQty}. Affected orders (oldest first): ${affected.map((a) => `${a.orderNumber} (${a.reservedQty})`).join(", ") || "none"}.`,
    marketId: wh?.marketId ?? null,
    ownerRole: "admin",
    nextAction: "Source stock (receipt/transfer) or explicitly release the reservation(s) that cannot be supported, recording who is displaced and why. Commitments are not trimmed automatically.",
    dedupeKey: discrepancyKey(warehouseId, skuId),
    links: affected.map((a) => ({ subjectType: "order", subjectId: a.orderId, relation: `${a.reservedQty} reserved` })),
  });
}

export type StockMovementKind = (typeof schema.stockMovementKindEnum.enumValues)[number];

/** Semantics by movement kind (REV-05, AC09). */
export const MOVEMENT_SEMANTICS: Record<StockMovementKind, { direction: "increase" | "decrease" | "either" | "internal"; label: string; quantityLabel: string }> = {
  opening: { direction: "increase", label: "Opening count", quantityLabel: "Units counted" },
  receipt: { direction: "increase", label: "Receipt", quantityLabel: "Units received" },
  adjustment: { direction: "either", label: "Physical adjustment", quantityLabel: "Signed change (+ found / − missing)" },
  damage: { direction: "decrease", label: "Damage", quantityLabel: "Units damaged (removed from sellable)" },
  sample_withdrawal: { direction: "internal", label: "Sample withdrawal", quantityLabel: "" },
  sample_return: { direction: "internal", label: "Sample return", quantityLabel: "" },
  transfer_out: { direction: "internal", label: "Transfer out", quantityLabel: "" },
  transfer_in: { direction: "internal", label: "Transfer in", quantityLabel: "" },
  load: { direction: "internal", label: "Loaded (phase 2)", quantityLabel: "" },
  route_return: { direction: "internal", label: "Route return (phase 2)", quantityLabel: "" },
  shipment_out: { direction: "internal", label: "Shipment delivered", quantityLabel: "" },
  count: { direction: "internal", label: "Physical count applied", quantityLabel: "" },
  packaging: { direction: "internal", label: "Packaging run", quantityLabel: "" },
};

/**
 * Record evidence-backed stock (opening/receipt/adjustment/damage). D16
 * cadence/tolerance is unselected: this records what a person confirms, with
 * source, and refreshes availability. Direction is enforced by kind: damage
 * can only remove sellable units (they become unavailable), receipts and
 * opening counts only add, adjustments are signed. Invalid requests write
 * nothing.
 */
export async function recordStockMovement(
  db: DbOrTx,
  actor: Actor,
  input: { warehouseId: string; skuId: string; kind: StockMovementKind; qtyDelta: number; evidence: string; referenceType?: string; referenceId?: string; lotId?: string | null },
) {
  const [wh] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, input.warehouseId));
  if (!wh) throw new BusinessError("Warehouse not found");
  authorize(actor, "stock.record", { marketId: wh.marketId });
  const sem = MOVEMENT_SEMANTICS[input.kind];
  if (!sem) throw new BusinessError("Unknown movement kind", { field: "kind" });
  if (sem.direction === "internal") {
    throw new BusinessError(
      input.kind === "transfer_in" || input.kind === "transfer_out"
        ? "Use the transfer departure / receipt actions so in-transit stock is tracked"
        : `${sem.label} movements are written by their own workflow, not by hand`,
      { field: "kind" },
    );
  }
  if (!Number.isInteger(input.qtyDelta) || input.qtyDelta === 0) throw new BusinessError("Quantity must be a non-zero whole number", { field: "qtyDelta" });
  if (sem.direction === "increase" && input.qtyDelta < 0) throw new BusinessError(`${sem.label} can only add sellable units; record damage or an adjustment to remove units`, { field: "qtyDelta" });
  if (sem.direction === "decrease" && input.qtyDelta > 0) throw new BusinessError(`${sem.label} can only remove sellable units — it never creates sellable stock`, { field: "qtyDelta" });
  if (!input.evidence.trim()) throw new BusinessError("Stock evidence/source is required", { field: "evidence" });
  return withTx(db, async (tx) => {
    const pos = await lockPosition(tx, input.warehouseId, input.skuId);
    const next = pos.onHandQty + input.qtyDelta;
    if (next < 0) throw new BusinessError(`On-hand cannot go below zero (on hand ${pos.onHandQty}, change ${input.qtyDelta}). Record the count you actually have.`, { field: "qtyDelta" });
    const set: Partial<typeof schema.stockPosition.$inferInsert> = {
      onHandQty: next,
      evidenceSource: input.evidence,
      evidenceAt: new Date(),
      confirmedByEmployeeId: actor.employeeId,
      updatedAt: new Date(),
    };
    if (input.kind === "damage") set.unavailableQty = pos.unavailableQty + Math.abs(input.qtyDelta);
    await tx.update(schema.stockPosition).set(set).where(eq(schema.stockPosition.id, pos.id));
    const [mv] = await tx
      .insert(schema.stockMovement)
      .values({
        warehouseId: input.warehouseId,
        skuId: input.skuId,
        kind: input.kind,
        qtyDelta: input.qtyDelta,
        evidence: input.evidence,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        actorEmployeeId: actor.employeeId,
        lotId: input.lotId ?? null,
      })
      .returning();
    await recordAudit(tx, actor, {
      action: "stock.movement",
      subjectType: "stock_position",
      subjectId: pos.id,
      prior: { onHandQty: pos.onHandQty },
      current: { onHandQty: next, kind: input.kind, qtyDelta: input.qtyDelta },
      reason: input.evidence,
      marketId: wh.marketId,
    });
    if (input.qtyDelta > 0) {
      await fillUnmetDemand(tx, actor, input.warehouseId, input.skuId);
    } else {
      await surfaceDiscrepancy(tx, actor, input.warehouseId, input.skuId, `${sem.label}: ${input.evidence}`);
    }
    return mv;
  });
}

/**
 * Sample consumption/restoration share the position with orders (O19). A
 * withdrawal takes only UNRESERVED units — it can never consume units already
 * promised to a customer (REV-03, AC06). Returns/corrections that add units
 * refill waiting demand oldest first.
 */
export async function applySampleStock(
  tx: Tx,
  actor: Actor,
  input: { warehouseId: string; skuId: string; delta: number; kind: "sample_withdrawal" | "sample_return" | "adjustment"; referenceId: string; evidence: string },
) {
  const pos = await lockPosition(tx, input.warehouseId, input.skuId);
  if (input.delta < 0) {
    const avail = await availability(tx, input.warehouseId, input.skuId);
    if (avail.availableQty < -input.delta) {
      throw new BusinessError(
        `Only ${avail.availableQty} unreserved unit(s) are available (on hand ${avail.onHandQty}, reserved for customers ${avail.reservedQty}). Samples cannot consume units promised to orders; record a receipt or have Admin release a reservation first.`,
        { field: "qty", code: "insufficient_unreserved" },
      );
    }
  }
  const next = pos.onHandQty + input.delta;
  await tx.update(schema.stockPosition).set({ onHandQty: next, updatedAt: new Date() }).where(eq(schema.stockPosition.id, pos.id));
  await tx.insert(schema.stockMovement).values({
    warehouseId: input.warehouseId,
    skuId: input.skuId,
    kind: input.kind,
    qtyDelta: input.delta,
    referenceType: "sample_withdrawal",
    referenceId: input.referenceId,
    evidence: input.evidence,
    actorEmployeeId: actor.employeeId,
  });
  if (input.delta > 0) await fillUnmetDemand(tx, actor, input.warehouseId, input.skuId);
}

/**
 * Transfer between warehouses (brief §18 [R/D] R22): departure debits the
 * origin and puts the units IN TRANSIT at the destination; they become
 * available only on confirmed receipt. Never available at both ends.
 */
export async function recordTransferDeparture(
  db: DbOrTx,
  actor: Actor,
  input: { fromWarehouseId: string; toWarehouseId: string; skuId: string; qty: number; evidence: string },
) {
  const [from] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, input.fromWarehouseId));
  const [to] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, input.toWarehouseId));
  if (!from || !to) throw new BusinessError("Warehouse not found");
  if (from.id === to.id) throw new BusinessError("Origin and destination must differ");
  authorize(actor, "stock.record", { marketId: from.marketId });
  authorize(actor, "stock.record", { marketId: to.marketId });
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new BusinessError("Quantity must be a positive whole number", { field: "qty" });
  if (!input.evidence.trim()) throw new BusinessError("Departure evidence is required", { field: "evidence" });
  return withTx(db, async (tx) => {
    // Consistent lock order (by warehouse id) so two opposite transfers cannot deadlock.
    const order = [input.fromWarehouseId, input.toWarehouseId].sort();
    for (const w of order) await lockPosition(tx, w, input.skuId);
    const origin = await lockPosition(tx, input.fromWarehouseId, input.skuId);
    const avail = await availability(tx, input.fromWarehouseId, input.skuId);
    if (avail.availableQty < input.qty) {
      throw new BusinessError(`Only ${avail.availableQty} unreserved unit(s) available to transfer (reserved demand stays with its warehouse)`, { field: "qty" });
    }
    await tx.update(schema.stockPosition).set({ onHandQty: origin.onHandQty - input.qty, updatedAt: new Date() }).where(eq(schema.stockPosition.id, origin.id));
    const dest = await lockPosition(tx, input.toWarehouseId, input.skuId);
    await tx.update(schema.stockPosition).set({ inTransitQty: dest.inTransitQty + input.qty, updatedAt: new Date() }).where(eq(schema.stockPosition.id, dest.id));
    const [mv] = await tx
      .insert(schema.stockMovement)
      .values({
        warehouseId: input.fromWarehouseId,
        skuId: input.skuId,
        kind: "transfer_out",
        qtyDelta: -input.qty,
        referenceType: "warehouse",
        referenceId: input.toWarehouseId,
        evidence: input.evidence,
        actorEmployeeId: actor.employeeId,
      })
      .returning();
    await recordAudit(tx, actor, {
      action: "stock.transfer_departure",
      subjectType: "stock_movement",
      subjectId: mv.id,
      current: { from: input.fromWarehouseId, to: input.toWarehouseId, skuId: input.skuId, qty: input.qty },
      reason: input.evidence,
      marketId: from.marketId,
    });
    return mv;
  });
}

export async function recordTransferReceipt(
  db: DbOrTx,
  actor: Actor,
  input: { toWarehouseId: string; skuId: string; qty: number; evidence: string },
) {
  const [to] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, input.toWarehouseId));
  if (!to) throw new BusinessError("Warehouse not found");
  authorize(actor, "stock.record", { marketId: to.marketId });
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new BusinessError("Quantity must be a positive whole number", { field: "qty" });
  if (!input.evidence.trim()) throw new BusinessError("Receipt evidence is required", { field: "evidence" });
  return withTx(db, async (tx) => {
    const dest = await lockPosition(tx, input.toWarehouseId, input.skuId);
    if (dest.inTransitQty < input.qty) {
      throw new StaleStateError(`Only ${dest.inTransitQty} unit(s) are in transit to this warehouse; a receipt cannot exceed the departure (a replayed receipt has no second effect)`);
    }
    await tx
      .update(schema.stockPosition)
      .set({
        inTransitQty: dest.inTransitQty - input.qty,
        onHandQty: dest.onHandQty + input.qty,
        evidenceSource: input.evidence,
        evidenceAt: new Date(),
        confirmedByEmployeeId: actor.employeeId,
        updatedAt: new Date(),
      })
      .where(eq(schema.stockPosition.id, dest.id));
    const [mv] = await tx
      .insert(schema.stockMovement)
      .values({ warehouseId: input.toWarehouseId, skuId: input.skuId, kind: "transfer_in", qtyDelta: input.qty, referenceType: "transfer", evidence: input.evidence, actorEmployeeId: actor.employeeId })
      .returning();
    await recordAudit(tx, actor, {
      action: "stock.transfer_receipt",
      subjectType: "stock_movement",
      subjectId: mv.id,
      current: { to: input.toWarehouseId, skuId: input.skuId, qty: input.qty },
      reason: input.evidence,
      marketId: to.marketId,
    });
    await fillUnmetDemand(tx, actor, input.toWarehouseId, input.skuId);
    return mv;
  });
}

async function loadReservationContext(db: DbOrTx, reservationId: string) {
  const [pre] = await db.select().from(schema.reservation).where(eq(schema.reservation.id, reservationId));
  if (!pre) throw new BusinessError("Reservation not found");
  const [line] = await db.select().from(schema.orderLine).where(eq(schema.orderLine.id, pre.orderLineId));
  const [ord] = line ? await db.select().from(schema.order).where(eq(schema.order.id, line.orderId)) : [];
  return { pre, line, ord };
}

/**
 * Admin releases a specific reservation (source/delay/partial decisions,
 * brief §16 [R]). Records who was displaced and why; demand is retained as
 * unmet so it is never lost (D14 restored-priority is not selected: the
 * released demand simply keeps its original submission time).
 */
export async function adminReleaseReservation(db: DbOrTx, actor: Actor, reservationId: string, reason: string) {
  const { pre, ord } = await loadReservationContext(db, reservationId);
  authorize(actor, "allocation.resolve", { marketId: ord?.marketId });
  if (!reason.trim()) throw new BusinessError("A reason is required (who was displaced and why)", { field: "reason" });
  return withTx(db, async (tx) => {
    await lockPosition(tx, pre.warehouseId, pre.skuId);
    const [r] = await tx.select().from(schema.reservation).where(eq(schema.reservation.id, reservationId)).for("update");
    if (r.state !== "reserved") throw new StaleStateError(`Reservation is ${r.state}; only reserved units can be released`);
    if (r.reservedQty === 0 && r.displacedAt) throw new StaleStateError("This demand was already released and is waiting for an explicit re-queue");
    const [row] = await tx
      .update(schema.reservation)
      .set({ reservedQty: 0, unmetQty: r.unmetQty + r.reservedQty, displacementNote: reason, displacedAt: new Date(), releasedByEmployeeId: actor.employeeId })
      .where(eq(schema.reservation.id, reservationId))
      .returning();
    await recordAudit(tx, actor, {
      action: "allocation.admin_release",
      subjectType: "reservation",
      subjectId: reservationId,
      prior: { reservedQty: r.reservedQty, unmetQty: r.unmetQty },
      current: { reservedQty: 0, unmetQty: row.unmetQty, displacedAt: row.displacedAt },
      reason,
      marketId: ord?.marketId,
    });
    // Freed units go to OTHER retained demand, oldest first; the displaced line waits for an explicit re-queue.
    await fillUnmetDemand(tx, actor, r.warehouseId, r.skuId);
    if (ord) {
      await openException(tx, actor, {
        category: "allocation_shortage",
        title: `Demand displaced on ${ord.orderNumber}`,
        cause: reason,
        marketId: ord.marketId,
        locationId: ord.locationId,
        ownerRole: "admin",
        nextAction: "Source, reallocate, delay or agree partial fulfilment with the customer",
        dedupeKey: `allocation_shortage:${ord.id}`,
        links: [{ subjectType: "order", subjectId: ord.id }],
      });
    }
    return row;
  });
}

/** Admin puts displaced demand back into the normal oldest-first refill (D14 restored priority stays an explicit act). */
export async function adminRequeueReservation(db: DbOrTx, actor: Actor, reservationId: string, reason: string) {
  const { pre, ord } = await loadReservationContext(db, reservationId);
  authorize(actor, "allocation.resolve", { marketId: ord?.marketId });
  return withTx(db, async (tx) => {
    await lockPosition(tx, pre.warehouseId, pre.skuId);
    const [r] = await tx.select().from(schema.reservation).where(eq(schema.reservation.id, reservationId)).for("update");
    if (r.state !== "reserved") throw new StaleStateError(`Reservation is ${r.state}; it cannot be re-queued`);
    if (!r.displacedAt) throw new StaleStateError("This demand is not displaced; nothing to re-queue");
    await tx.update(schema.reservation).set({ displacedAt: null }).where(eq(schema.reservation.id, reservationId));
    await recordAudit(tx, actor, {
      action: "allocation.admin_requeue",
      subjectType: "reservation",
      subjectId: reservationId,
      prior: { displacedAt: r.displacedAt },
      current: { displacedAt: null },
      reason,
      marketId: ord?.marketId,
    });
    await fillUnmetDemand(tx, actor, pre.warehouseId, pre.skuId);
  });
}

/**
 * Reassign an EXISTING uncommitted order to another warehouse (§4.6, AT13
 * partial). Distinct from the location's future default (setWarehouseOverride).
 * Both the order's market and the destination warehouse's market must be in
 * the actor's authority; loaded/route-committed lines are refused and an
 * owned reconciliation task is opened instead of inventing dispatch facts.
 * Old reservations are released (refilling waiting demand there), the
 * destination is reserved FCFS behind its own waiting demand, and any
 * shortfall stays as retained unmet demand. Market, seller, price and
 * original quantities are untouched.
 */
export async function reassignOrderWarehouse(db: DbOrTx, actor: Actor, orderId: string, toWarehouseId: string, reason: string) {
  const [ord] = await db.select().from(schema.order).where(eq(schema.order.id, orderId));
  if (!ord) throw new BusinessError("Order not found");
  const [to] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, toWarehouseId));
  if (!to || !to.active) throw new BusinessError("Destination warehouse not found or inactive");
  authorize(actor, "allocation.resolve", { marketId: ord.marketId });
  authorize(actor, "stock.record", { marketId: to.marketId });
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  if (ord.demandState === "cancelled" || ord.demandState === "fulfilled") throw new StaleStateError(`Order is ${ord.demandState}; nothing to reassign`);
  if (ord.warehouseId === toWarehouseId) throw new StaleStateError("The order is already served from that warehouse");
  const preLines = await db.select({ id: schema.orderLine.id }).from(schema.orderLine).where(eq(schema.orderLine.orderId, orderId));
  const loaded = preLines.length
    ? await db.select().from(schema.reservation).where(and(inArray(schema.reservation.orderLineId, preLines.map((l) => l.id)), eq(schema.reservation.state, "route_committed")))
    : [];
  if (loaded.length) {
    // The refusal is durable: the reconciliation task is recorded outside the refused transaction.
    await openException(db, actor, {
        category: "custody_reconciliation",
        title: `${ord.orderNumber}: reassignment needs physical reconciliation`,
        cause: `${loaded.reduce((s, r) => s + r.reservedQty, 0)} unit(s) are loaded/route-committed; the application cannot move loaded custody by itself. Requested destination: ${to.name}. Reason: ${reason}`,
        marketId: ord.marketId,
        locationId: ord.locationId,
        ownerRole: "admin",
        nextAction: "Confirm actual custody with the driver/host, unload or return with evidence, then reassign.",
      dedupeKey: `custody_reconciliation:${orderId}`,
      links: [{ subjectType: "order", subjectId: orderId }],
    });
    throw new BusinessError("Some units are already loaded; reassignment is refused and a custody reconciliation task has been opened instead.", { code: "loaded_work" });
  }
  return withTx(db, async (tx) => {
    const [locked] = await tx.select().from(schema.order).where(eq(schema.order.id, orderId)).for("update");
    if (locked.demandState === "cancelled" || locked.demandState === "fulfilled") throw new StaleStateError(`Order is ${locked.demandState}; nothing to reassign`);
    if (locked.warehouseId === toWarehouseId) throw new StaleStateError("The order is already served from that warehouse");
    const lines = await tx.select().from(schema.orderLine).where(eq(schema.orderLine.orderId, orderId));
    const lineIds = lines.map((l) => l.id);
    const reservations = lineIds.length ? await tx.select().from(schema.reservation).where(inArray(schema.reservation.orderLineId, lineIds)).for("update") : [];
    if (reservations.some((r) => r.state === "route_committed")) throw new StaleStateError("Units were loaded while you were editing; reload the order.");
    const result: Array<{ lineId: string; reservedQty: number; unmetQty: number }> = [];
    for (const l of lines) {
      const remaining = l.currentQty - l.deliveredQty;
      await releaseLineReservations(tx, actor, l.id, `Reassigned to ${to.name}: ${reason}`);
      if (remaining > 0) {
        const r = await reserveForLine(tx, actor, { orderLineId: l.id, warehouseId: toWarehouseId, skuId: l.skuId, qty: remaining });
        result.push({ lineId: l.id, reservedQty: r.reservedQty, unmetQty: r.unmetQty });
      }
    }
    await tx.update(schema.order).set({ warehouseId: toWarehouseId, updatedAt: new Date() }).where(eq(schema.order.id, orderId));
    await recordAudit(tx, actor, {
      action: "order.reassign_warehouse",
      subjectType: "order",
      subjectId: orderId,
      prior: { warehouseId: locked.warehouseId },
      current: { warehouseId: toWarehouseId, lines: result },
      reason,
      marketId: ord.marketId,
    });
    const shortage = result.some((r) => r.unmetQty > 0);
    if (shortage) {
      await openException(tx, actor, {
        category: "allocation_shortage",
        title: `Shortage on ${ord.orderNumber} after reassignment to ${to.name}`,
        cause: result.filter((r) => r.unmetQty > 0).map((r) => `line ${r.lineId.slice(0, 8)}: ${r.unmetQty} unmet`).join("; "),
        marketId: ord.marketId,
        locationId: ord.locationId,
        ownerRole: "admin",
        nextAction: "Source, reallocate, delay or agree partial fulfilment (D14/D15 remain unselected).",
        dedupeKey: `allocation_shortage:${orderId}`,
        links: [{ subjectType: "order", subjectId: orderId }],
      });
    } else {
      await resolveByDedupeKeys(tx, actor, [`allocation_shortage:${orderId}`], `Fully reserved at ${to.name} after reassignment`);
    }
    return { orderId, toWarehouseId, lines: result, shortage };
  });
}

// ---------------------------------------------------------------------------
// Order reservations and the shipment created from the order (round 2, R2-1)
// ---------------------------------------------------------------------------

/**
 * The shipment created from an order is confirmed: its lines now hold the stock through shipment allocations, so the
 * order's reservations move to `route_committed` (no longer counted in availability) rather than counting twice.
 */
/**
 * Confirmation of an order's shipment (R2-1): the quantity on each shipment line moves from the order's reservation
 * to the shipment (route_committed, so availability does not count it twice once the shipment allocation exists).
 * Whatever the reservation holds beyond the line (units reserved after the draft was cut, or units still waiting
 * for stock) stays in the queue as a plain reservation with its original place.
 */
export async function commitReservationsForShipmentLines(tx: Tx, lines: Array<{ orderLineId: string | null; qty: number }>): Promise<number> {
  let committed = 0;
  for (const line of lines) {
    if (!line.orderLineId) continue;
    let need = line.qty;
    const rows = await tx
      .select()
      .from(schema.reservation)
      .where(and(eq(schema.reservation.orderLineId, line.orderLineId), eq(schema.reservation.state, "reserved")))
      .orderBy(schema.reservation.createdAt, schema.reservation.id)
      .for("update");
    for (const r of rows) {
      if (need <= 0) break;
      const take = Math.min(need, r.reservedQty);
      if (take <= 0) continue;
      need -= take;
      committed += take;
      const leftover = r.reservedQty - take;
      await tx.update(schema.reservation).set({ state: "route_committed", reservedQty: take, unmetQty: 0 }).where(eq(schema.reservation.id, r.id));
      if (leftover > 0 || r.unmetQty > 0) {
        await tx.insert(schema.reservation).values({ orderLineId: r.orderLineId, warehouseId: r.warehouseId, skuId: r.skuId, reservedQty: leftover, unmetQty: r.unmetQty, state: "reserved", createdAt: r.createdAt });
      }
    }
  }
  return committed;
}

/** Kept for callers that commit whole lines; the shipment path uses commitReservationsForShipmentLines. */
export async function commitReservationsForOrderLines(tx: Tx, orderLineIds: string[]): Promise<number> {
  if (orderLineIds.length === 0) return 0;
  const rows = await tx
    .update(schema.reservation)
    .set({ state: "route_committed" })
    .where(and(inArray(schema.reservation.orderLineId, orderLineIds), eq(schema.reservation.state, "reserved")))
    .returning({ id: schema.reservation.id });
  return rows.length;
}

/** The shipment was voided and the order reopened (R2-7): route-committed reservations count again as reserved. */
export async function uncommitReservationsForOrderLines(tx: Tx, orderLineIds: string[]): Promise<number> {
  if (orderLineIds.length === 0) return 0;
  const rows = await tx
    .update(schema.reservation)
    .set({ state: "reserved" })
    .where(and(inArray(schema.reservation.orderLineId, orderLineIds), eq(schema.reservation.state, "route_committed")))
    .returning({ id: schema.reservation.id });
  return rows.length;
}

/**
 * Delivered (R2-8): the committed reservations of the delivered order lines are consumed. Units the account did not
 * keep (refused, damaged) are open demand again on the order: they are re-reserved from what is on hand at the origin
 * (refused units never left it) and anything short waits in the queue, so the office can ship them again or cancel.
 */
export async function fulfilReservationsForOrderLines(tx: Tx, actor: Actor, lines: Array<{ orderLineId: string | null; delivered: number; notKept: number }>): Promise<number> {
  let fulfilled = 0;
  for (const line of lines) {
    if (!line.orderLineId) continue;
    const rows = await tx
      .update(schema.reservation)
      .set({ state: "fulfilled", releasedAt: new Date(), releaseReason: "Delivered" })
      .where(and(eq(schema.reservation.orderLineId, line.orderLineId), eq(schema.reservation.state, "route_committed")))
      .returning({ id: schema.reservation.id, warehouseId: schema.reservation.warehouseId, skuId: schema.reservation.skuId });
    fulfilled += rows.length;
    if (line.notKept > 0 && rows[0]) {
      const r = await reserveForLine(tx, actor, { orderLineId: line.orderLineId, warehouseId: rows[0].warehouseId, skuId: rows[0].skuId, qty: line.notKept });
      await recordAudit(tx, actor, { action: "allocation.re_reserve", subjectType: "reservation", subjectId: r.reservationId, current: { reservedQty: r.reservedQty, unmetQty: r.unmetQty }, reason: "Units refused or damaged at delivery stay open demand on the order (R2-8, R2-9)" });
    }
  }
  return fulfilled;
}
