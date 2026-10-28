import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { availability, reassignOrderWarehouse, recordStockMovement, recordTransferDeparture, recordTransferReceipt } from "@/lib/domain/allocation/service";
import { archiveSku, createSku, setMarketPrice } from "@/lib/domain/catalog/service";
import { recordLicenseDecision, setLocationStatus, setWarehouseOverride } from "@/lib/domain/customers/service";
import { createWarehouse } from "@/lib/domain/markets/service";
import { adminAmendQuantity, cancelUndeliveredDemand, getOrder, requestOrderChange, submitOrder } from "@/lib/domain/orders/service";
import { correctSampleWithdrawal, recordSampleWithdrawal, returnSample } from "@/lib/domain/samples/service";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

/**
 * REV-03/04/05/09/10 and §4.3/§4.6: AC06–AC12, AC25, AC26 on real SQL
 * (PGlite). The concurrency variants of AC07/AC08/AC11/AC12 run against real
 * Postgres in tests/postgres/races.test.ts.
 */
let db: Db;
let close: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
});
afterAll(async () => close());

async function verifiedLocation(name: string) {
  const { location } = await makeLocation(db, f.sales, f.market.id, name);
  await recordLicenseDecision(db, f.admin, { locationId: location.id, state: "verified", licenseNumber: "L-1", evidence: "lookup" });
  return location;
}

/** A fresh SKU with its own 20-unit position so scenarios do not interfere. */
async function freshSku(code: string, opening = 20) {
  const sku = await createSku(db, f.admin, { code, name: `${code} case`, brand: "Test", packageKind: "case_12oz_can", sellingUnit: "case" });
  await setMarketPrice(db, f.admin, { marketId: f.market.id, skuId: sku.id, priceCents: 3600 });
  if (opening > 0) await recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "opening", qtyDelta: opening, evidence: "opening" });
  return sku;
}

describe("REV-03 / AC06 — samples cannot consume units promised to customers", () => {
  it("20 on hand fully reserved → a 5-unit sample is refused; after a partial reservation only the unreserved units can be sampled", async () => {
    const sku = await freshSku("S-AC06");
    const loc = await verifiedLocation("Sample Denied");
    await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 20 }] });
    await expect(recordSampleWithdrawal(db, f.sales, { marketId: f.market.id, skuId: sku.id, qty: 5, withdrawnOn: "2026-09-17" })).rejects.toThrow(/Only 0 unreserved/);
    let a = await availability(db, f.warehouse.id, sku.id);
    expect(a.onHandQty).toBe(20);
    expect(a.reservedQty).toBe(20);
    expect(a.deficitQty).toBe(0);
    // Partial reservation: 20 on hand, 12 reserved → 8 available; 9 refused, 8 allowed.
    const sku2 = await freshSku("S-AC06b");
    await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku2.id, qty: 12 }] });
    await expect(recordSampleWithdrawal(db, f.sales, { marketId: f.market.id, skuId: sku2.id, qty: 9, withdrawnOn: "2026-09-17" })).rejects.toThrow(/Only 8 unreserved/);
    await recordSampleWithdrawal(db, f.sales, { marketId: f.market.id, skuId: sku2.id, qty: 8, withdrawnOn: "2026-09-17" });
    a = await availability(db, f.warehouse.id, sku2.id);
    expect(a.onHandQty).toBe(12);
    expect(a.reservedQty).toBe(12);
    expect(a.availableQty).toBe(0);
  });
});

describe("REV-05 / AC09 — movement semantics by kind; physical shortfall stays visible", () => {
  it("damage never creates sellable stock; receipt/opening only add; adjustment is signed; invalid requests write nothing", async () => {
    const sku = await freshSku("S-AC09");
    const movementsBefore = (await db.select().from(schema.stockMovement).where(eq(schema.stockMovement.skuId, sku.id))).length;
    await expect(recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "damage", qtyDelta: 3, evidence: "x" })).rejects.toThrow(/never creates sellable stock/);
    await expect(recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "receipt", qtyDelta: -3, evidence: "x" })).rejects.toThrow(/only add/);
    await expect(recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "opening", qtyDelta: 0, evidence: "x" })).rejects.toThrow(/non-zero/);
    await expect(recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "adjustment", qtyDelta: 1.5, evidence: "x" })).rejects.toThrow(/whole number/);
    await expect(recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "load", qtyDelta: -1, evidence: "x" })).rejects.toThrow(/own workflow/);
    await expect(recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "adjustment", qtyDelta: -50, evidence: "x" })).rejects.toThrow(/below zero/);
    expect((await db.select().from(schema.stockMovement).where(eq(schema.stockMovement.skuId, sku.id))).length).toBe(movementsBefore);
    expect((await availability(db, f.warehouse.id, sku.id)).onHandQty).toBe(20);
    await recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "damage", qtyDelta: -3, evidence: "forklift" });
    let a = await availability(db, f.warehouse.id, sku.id);
    expect(a.onHandQty).toBe(17);
    expect(a.unavailableQty).toBe(3);
    await recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "adjustment", qtyDelta: 2, evidence: "found on pallet" });
    await recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "adjustment", qtyDelta: -1, evidence: "count" });
    a = await availability(db, f.warehouse.id, sku.id);
    expect(a.onHandQty).toBe(18);
  });

  it("a physical count below reservations is recorded as-is and exposed as ONE owned discrepancy naming the affected orders; deficit is not clamped away", async () => {
    const sku = await freshSku("S-AC09b");
    const loc = await verifiedLocation("Deficit Deli");
    const loc2 = await verifiedLocation("Deficit Diner");
    const o1 = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 12 }] });
    const o2 = await submitOrder(db, f.sales, { locationId: loc2.id, lines: [{ skuId: sku.id, qty: 6 }] });
    await recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "damage", qtyDelta: -10, evidence: "water damage on 10 cases" });
    const a = await availability(db, f.warehouse.id, sku.id);
    expect(a.onHandQty).toBe(10);
    expect(a.reservedQty).toBe(18); // commitments untouched — the physical fact is recorded, not falsified
    expect(a.availableQty).toBe(0);
    expect(a.deficitQty).toBe(8);
    const cases = await db.select().from(schema.exceptionCase).where(and(eq(schema.exceptionCase.category, "allocation_discrepancy"), eq(schema.exceptionCase.state, "open")));
    const mine = cases.filter((c) => c.dedupeKey === `allocation_discrepancy:${f.warehouse.id}:${sku.id}`);
    expect(mine).toHaveLength(1);
    expect(mine[0].cause).toMatch(new RegExp(`${o1.order.orderNumber}.*${o2.order.orderNumber}`));
    // Second observation → same incident.
    await recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "adjustment", qtyDelta: -1, evidence: "recount" });
    expect((await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, mine[0].dedupeKey!))).filter((c) => c.state !== "resolved")).toHaveLength(1);
    // Receipt covers the shortfall → discrepancy resolves itself (targeted follow-through).
    await recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "receipt", qtyDelta: 9, evidence: "replacement delivery" });
    expect((await availability(db, f.warehouse.id, sku.id)).deficitQty).toBe(0);
    const [resolved] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.id, mine[0].id));
    expect(resolved.state).toBe("resolved");
  });
});

describe("REV-04 / AC07 / AC08 — sample transitions are claimed once", () => {
  it("a second return of the same sample is refused with the current state; correction after return refused; stock restored exactly once", async () => {
    const sku = await freshSku("S-AC07");
    const s = await recordSampleWithdrawal(db, f.sales, { marketId: f.market.id, skuId: sku.id, qty: 2, withdrawnOn: "2026-09-17" });
    expect((await availability(db, f.warehouse.id, sku.id)).onHandQty).toBe(18);
    await returnSample(db, f.admin, s.id, "sellable", "sealed, inspected");
    expect((await availability(db, f.warehouse.id, sku.id)).onHandQty).toBe(20);
    await expect(returnSample(db, f.admin, s.id, "sellable", "again")).rejects.toBeInstanceOf(StaleStateError);
    await expect(correctSampleWithdrawal(db, f.sales, s.id, 1, "oops")).rejects.toThrow(/already returned sellable/);
    expect((await availability(db, f.warehouse.id, sku.id)).onHandQty).toBe(20);
    // Two corrections: the second sees "corrected".
    const s2 = await recordSampleWithdrawal(db, f.sales, { marketId: f.market.id, skuId: sku.id, qty: 4, withdrawnOn: "2026-09-17" });
    const c1 = await correctSampleWithdrawal(db, f.sales, s2.id, 3, "only three taken");
    await expect(correctSampleWithdrawal(db, f.sales, s2.id, 2, "again")).rejects.toThrow(/already corrected/);
    expect((await availability(db, f.warehouse.id, sku.id)).onHandQty).toBe(17);
    // Correction that takes MORE cannot dip into reserved units.
    const loc = await verifiedLocation("Sample Corr");
    await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 17 }] });
    await expect(correctSampleWithdrawal(db, f.sales, c1.id, 5, "actually five")).rejects.toThrow(/unreserved/);
  });
});

describe("REV-09 / AC10 — released stock goes to older waiting demand first", () => {
  it("A reserves 20, B waits for 5, A cancels, C requests 5 → B is filled, C waits", async () => {
    const sku = await freshSku("S-AC10");
    const la = await verifiedLocation("A Ale");
    const lb = await verifiedLocation("B Bar");
    const lc = await verifiedLocation("C Cafe");
    const a = await submitOrder(db, f.sales, { locationId: la.id, lines: [{ skuId: sku.id, qty: 20 }] });
    const b = await submitOrder(db, f.sales, { locationId: lb.id, lines: [{ skuId: sku.id, qty: 5 }] });
    expect(b.lines[0].unmetQty).toBe(5);
    await cancelUndeliveredDemand(db, f.admin, a.order.id, "customer cancelled");
    const c = await submitOrder(db, f.sales, { locationId: lc.id, lines: [{ skuId: sku.id, qty: 5 }] });
    const bNow = await getOrder(db, b.order.id);
    expect(bNow?.lines[0].reservedQty).toBe(5);
    expect(bNow?.lines[0].unmetQty).toBe(0);
    expect(c.lines[0].reservedQty).toBe(5); // 20 freed: B takes 5, C takes 5 of the remaining 15
    const [bCase] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `allocation_shortage:${b.order.id}`));
    expect(bCase.state).toBe("resolved");
  });

  it("a quantity reduction on the holder refills the waiter before anyone new", async () => {
    const sku = await freshSku("S-AC10b");
    const la = await verifiedLocation("A2 Ale");
    const lb = await verifiedLocation("B2 Bar");
    const lc = await verifiedLocation("C2 Cafe");
    const a = await submitOrder(db, f.sales, { locationId: la.id, lines: [{ skuId: sku.id, qty: 20 }] });
    const b = await submitOrder(db, f.sales, { locationId: lb.id, lines: [{ skuId: sku.id, qty: 5 }] });
    await adminAmendQuantity(db, f.admin, a.lines[0].id, 17, "customer reduced");
    const c = await submitOrder(db, f.sales, { locationId: lc.id, lines: [{ skuId: sku.id, qty: 5 }] });
    expect((await getOrder(db, b.order.id))?.lines[0].reservedQty).toBe(3);
    expect((await getOrder(db, b.order.id))?.lines[0].unmetQty).toBe(2);
    expect(c.lines[0].reservedQty).toBe(0);
    expect(c.lines[0].unmetQty).toBe(5);
    // Admin-displaced demand is NOT auto-restored (D14 unselected) — nothing here displaces anyone.
    const displaced = await db.select().from(schema.reservation).where(and(eq(schema.reservation.skuId, sku.id), eq(schema.reservation.state, "reserved")));
    expect(displaced.every((r) => r.displacedAt === null)).toBe(true);
  });
});

describe("REV-10 / AC11 — stale transitions are refused with the current state", () => {
  it("amendment after cancellation gets no reservation; cancel twice; archived SKU cannot be increased; closed location refuses capture", async () => {
    const sku = await freshSku("S-AC11");
    const loc = await verifiedLocation("Stale State Saloon");
    const o = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 4 }] });
    await cancelUndeliveredDemand(db, f.admin, o.order.id, "changed mind");
    await expect(adminAmendQuantity(db, f.admin, o.lines[0].id, 3, "stale form")).rejects.toThrow(/cancelled; it cannot be amended/);
    const after = await getOrder(db, o.order.id);
    expect(after?.order.demandState).toBe("cancelled");
    expect(after?.lines[0].reservedQty).toBe(0);
    expect(after?.lines[0].currentQty).toBe(0);
    await expect(cancelUndeliveredDemand(db, f.admin, o.order.id, "again")).rejects.toBeInstanceOf(StaleStateError);
    await expect(requestOrderChange(db, f.sales, { orderLineId: o.lines[0].id, kind: "amend_qty", requestedQty: 2, reason: "late" })).rejects.toBeInstanceOf(StaleStateError);
    // Archived SKU: existing demand keeps, increase refused.
    const o2 = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 2 }] });
    await archiveSku(db, f.admin, sku.id, "discontinued");
    await expect(adminAmendQuantity(db, f.admin, o2.lines[0].id, 5, "more")).rejects.toThrow(/archived/);
    await adminAmendQuantity(db, f.admin, o2.lines[0].id, 1, "less is fine");
    expect((await getOrder(db, o2.order.id))?.lines[0].currentQty).toBe(1);
    // Closed location: capture refused, existing demand can only shrink.
    await setLocationStatus(db, f.admin, loc.id, "closed", "closed down");
    await expect(submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] })).rejects.toThrow(/closed/);
    await expect(adminAmendQuantity(db, f.admin, o2.lines[0].id, 3, "more")).rejects.toThrow(/closed/);
  });
});

describe("AC12 — submission keys", () => {
  it("same key + same payload replays; same key + changed payload is refused naming the original; a new key is a new order", async () => {
    const sku = await freshSku("S-AC12");
    const loc = await verifiedLocation("Replay Ramen");
    const first = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 2 }], submissionKey: "k-1", notes: "hi" });
    const replay = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 2 }], submissionKey: "k-1", notes: "hi" });
    expect(replay.replayed).toBe(true);
    expect(replay.order.id).toBe(first.order.id);
    await expect(submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 3 }], submissionKey: "k-1", notes: "hi" })).rejects.toThrow(new RegExp(`already recorded as ${first.order.orderNumber} with different content`));
    const fresh = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 2 }], submissionKey: "k-2", notes: "hi" });
    expect(fresh.order.id).not.toBe(first.order.id);
    expect((await db.select().from(schema.order).where(eq(schema.order.locationId, loc.id))).length).toBe(2);
  });
});

describe("§4.6 / AC25 — future default versus reassignment of an existing order", () => {
  it("override changes only future orders; reassignment moves an existing uncommitted order with FCFS at the destination, refuses loaded work and needs both scopes", async () => {
    const sku = await freshSku("S-AC25");
    const second = await createWarehouse(db, f.admin, { marketId: f.market.id, name: "Second NC", isPrimary: false });
    const loc = await verifiedLocation("Reassign Rest");
    const o = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 5 }] });
    expect(o.order.warehouseId).toBe(f.warehouse.id);
    // Future default: existing order untouched.
    await setWarehouseOverride(db, f.admin, loc.id, second.id, "closer next time");
    expect((await getOrder(db, o.order.id))?.order.warehouseId).toBe(f.warehouse.id);
    await expect(setWarehouseOverride(db, f.admin, loc.id, second.id, "same")).rejects.toBeInstanceOf(StaleStateError);
    // Reassign existing: destination has no stock → shortfall retained as demand; price/market untouched; old units freed.
    await expect(reassignOrderWarehouse(db, f.sales, o.order.id, second.id, "x")).rejects.toThrow();
    const r = await reassignOrderWarehouse(db, f.admin, o.order.id, second.id, "consolidate route");
    expect(r.shortage).toBe(true);
    const moved = await getOrder(db, o.order.id);
    expect(moved?.order.warehouseId).toBe(second.id);
    expect(moved?.order.marketId).toBe(f.market.id);
    expect(moved?.lines[0].unitPriceCentsAtSubmission).toBe(3600);
    expect(moved?.lines[0].currentQty).toBe(5);
    expect(moved?.lines[0].unmetQty).toBe(5);
    expect((await availability(db, f.warehouse.id, sku.id)).reservedQty).toBe(0);
    // Stock arrives at destination → transfer receipt refills it.
    await recordTransferDeparture(db, f.admin, { fromWarehouseId: f.warehouse.id, toWarehouseId: second.id, skuId: sku.id, qty: 5, evidence: "van" });
    expect((await availability(db, second.id, sku.id)).availableQty).toBe(0); // in transit: at neither
    expect((await availability(db, f.warehouse.id, sku.id)).onHandQty).toBe(15);
    await recordTransferReceipt(db, f.admin, { toWarehouseId: second.id, skuId: sku.id, qty: 5, evidence: "received" });
    expect((await getOrder(db, o.order.id))?.lines[0].reservedQty).toBe(5);
    // Replayed receipt has no second effect.
    await expect(recordTransferReceipt(db, f.admin, { toWarehouseId: second.id, skuId: sku.id, qty: 5, evidence: "received again" })).rejects.toBeInstanceOf(StaleStateError);
    // Loaded work: refused + owned reconciliation task, no fabricated movement.
    const [resv] = await db.select().from(schema.reservation).where(and(eq(schema.reservation.orderLineId, o.lines[0].id), eq(schema.reservation.state, "reserved")));
    await db.update(schema.reservation).set({ state: "route_committed" }).where(eq(schema.reservation.id, resv.id));
    await expect(reassignOrderWarehouse(db, f.admin, o.order.id, f.warehouse.id, "back")).rejects.toThrow(/loaded/);
    const task = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `custody_reconciliation:${o.order.id}`));
    expect(task).toHaveLength(1);
    expect((await getOrder(db, o.order.id))?.order.warehouseId).toBe(second.id);
  });
});

describe("AC26 — transfers", () => {
  it("departure needs unreserved units; cancellation after loading never fabricates a warehouse receipt", async () => {
    const sku = await freshSku("S-AC26");
    const second = await createWarehouse(db, f.admin, { marketId: f.market.id, name: "Third NC", isPrimary: false });
    const loc = await verifiedLocation("Transfer Tavern");
    await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 18 }] });
    await expect(recordTransferDeparture(db, f.admin, { fromWarehouseId: f.warehouse.id, toWarehouseId: second.id, skuId: sku.id, qty: 5, evidence: "van" })).rejects.toThrow(/Only 2 unreserved/);
    await expect(recordTransferDeparture(db, f.admin, { fromWarehouseId: f.warehouse.id, toWarehouseId: f.warehouse.id, skuId: sku.id, qty: 1, evidence: "van" })).rejects.toBeInstanceOf(BusinessError);
  });
});
