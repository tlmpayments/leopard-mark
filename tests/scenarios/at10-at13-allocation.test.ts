import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { adminReleaseReservation, adminRequeueReservation, availability, recordStockMovement, recordTransferDeparture, recordTransferReceipt } from "@/lib/domain/allocation/service";
import { recordLicenseDecision, setWarehouseOverride } from "@/lib/domain/customers/service";
import { createWarehouse } from "@/lib/domain/markets/service";
import { cancelUndeliveredDemand, getOrder, submitOrder } from "@/lib/domain/orders/service";
import { correctSampleWithdrawal, recordSampleWithdrawal, returnSample } from "@/lib/domain/samples/service";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

let db: Db;
let close: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
});
afterAll(() => close());

async function verifiedLocation(name: string) {
  const { location } = await makeLocation(db, f.sales, f.market.id, name);
  await recordLicenseDecision(db, f.admin, { locationId: location.id, state: "verified", licenseNumber: "L", evidence: "lookup" });
  return location;
}

describe("AT10 — Reservation and cancellation", () => {
  it("submission reserves once; replay of the same submission creates no second reservation; cancellation releases unused units; loaded units are not claimed back", async () => {
    const loc = await verifiedLocation("Reserve Rooftop");
    const before = await availability(db, f.warehouse.id, f.skus.sunlightHalf.id);
    const res = await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: f.skus.sunlightHalf.id, qty: 3 }], submissionKey: "sub-1" });
    const replay = await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: f.skus.sunlightHalf.id, qty: 3 }], submissionKey: "sub-1" });
    expect(replay.replayed).toBe(true);
    expect(replay.order.id).toBe(res.order.id);
    let now = await availability(db, f.warehouse.id, f.skus.sunlightHalf.id);
    expect(now.availableQty).toBe(before.availableQty - 3);
    // A legitimate repeat order (new key) is a new order.
    const repeat = await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: f.skus.sunlightHalf.id, qty: 1 }], submissionKey: "sub-2" });
    expect(repeat.order.id).not.toBe(res.order.id);
    // Sales cannot cancel (D10 pending); Admin cancels undelivered demand.
    await expect(cancelUndeliveredDemand(db, f.sales, res.order.id, "changed mind")).rejects.toBeInstanceOf(AuthorizationError);
    await cancelUndeliveredDemand(db, f.admin, res.order.id, "Customer cancelled before scheduling");
    now = await availability(db, f.warehouse.id, f.skus.sunlightHalf.id);
    expect(now.availableQty).toBe(before.availableQty - 1);
    const o = await getOrder(db, res.order.id);
    expect(o?.order.demandState).toBe("cancelled");
    expect(o?.lines[0].orderedQty).toBe(3); // original retained
    expect(o?.lines[0].currentQty).toBe(0);
    expect(o?.lines[0].cancelledQty).toBe(3);
    // After load (route_committed), cancellation does not claim warehouse receipt.
    const loaded = await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: f.skus.sunlightHalf.id, qty: 2 }] });
    const [resv] = await db.select().from(schema.reservation).where(eq(schema.reservation.orderLineId, loaded.lines[0].id));
    await db.update(schema.reservation).set({ state: "route_committed" }).where(eq(schema.reservation.id, resv.id));
    // Loading is a phase-2 workflow (not hand-entered, REV-05): simulate its physical fact directly for this test.
    await expect(recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: f.skus.sunlightHalf.id, kind: "load", qtyDelta: -2, evidence: "loaded on truck (test)" })).rejects.toThrow(/own workflow/);
    await db.update(schema.stockPosition).set({ onHandQty: sql`on_hand_qty - 2` }).where(and(eq(schema.stockPosition.warehouseId, f.warehouse.id), eq(schema.stockPosition.skuId, f.skus.sunlightHalf.id)));
    await db.insert(schema.stockMovement).values({ warehouseId: f.warehouse.id, skuId: f.skus.sunlightHalf.id, kind: "load", qtyDelta: -2, evidence: "loaded on truck (test)" });
    const availBeforeCancel = (await availability(db, f.warehouse.id, f.skus.sunlightHalf.id)).availableQty;
    await cancelUndeliveredDemand(db, f.admin, loaded.order.id, "Customer cancelled after load");
    expect((await availability(db, f.warehouse.id, f.skus.sunlightHalf.id)).availableQty).toBe(availBeforeCancel); // no double-count back
    const custodyCase = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `custody_reconciliation:${loaded.order.id}`));
    expect(custodyCase).toHaveLength(1);
  });
});

describe("AT11 — Shortage", () => {
  it("reserves only supportable units, retains unmet demand, Admin resolves; receipt fills oldest demand first; no expiry invented", async () => {
    const loc = await verifiedLocation("Shortfall Shack");
    const loc2 = await verifiedLocation("Later Lounge");
    const avail = (await availability(db, f.warehouse.id, f.skus.cantinescaSixtel.id)).availableQty;
    const big = await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: f.skus.cantinescaSixtel.id, qty: avail + 5 }] });
    expect(big.shortage).toBe(true);
    expect(big.lines[0].reservedQty).toBe(avail);
    expect(big.lines[0].unmetQty).toBe(5);
    const later = await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc2.id, lines: [{ skuId: f.skus.cantinescaSixtel.id, qty: 2 }] });
    expect(later.lines[0].reservedQty).toBe(0);
    expect(later.lines[0].unmetQty).toBe(2);
    const cases = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `allocation_shortage:${big.order.id}`));
    expect(cases[0].state).toBe("open");
    // Receipt of 6 fills the oldest unmet demand first (FCFS), then the next.
    await recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: f.skus.cantinescaSixtel.id, kind: "receipt", qtyDelta: 6, evidence: "brewery transfer received" });
    const bigAfter = await getOrder(db, big.order.id);
    expect(bigAfter?.lines[0].unmetQty).toBe(0);
    const laterAfter = await getOrder(db, loc2.id ? later.order.id : "");
    expect(laterAfter?.lines[0].reservedQty).toBe(1);
    expect(laterAfter?.lines[0].unmetQty).toBe(1);
    expect((await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `allocation_shortage:${big.order.id}`)))[0].state).toBe("resolved");
    expect((await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `allocation_shortage:${later.order.id}`)))[0].state).toBe("open");
    // Admin can release a reservation (displacement recorded); demand is retained as unmet — no automatic restored priority.
    const [r] = await db.select().from(schema.reservation).where(eq(schema.reservation.orderLineId, bigAfter!.lines[0].id));
    await expect(adminReleaseReservation(db, f.sales, r.id, "x")).rejects.toBeInstanceOf(AuthorizationError);
    const released = await adminReleaseReservation(db, f.admin, r.id, "Reallocated to a scheduled route; customer informed");
    expect(released.reservedQty).toBe(0);
    expect(released.unmetQty).toBe(avail + 5);
    expect(released.displacementNote).toMatch(/Reallocated/);
    expect(released.displacedAt).not.toBeNull();
    // Freed units went to OTHER retained demand (oldest first); the displaced line is not auto-restored (D14 unselected).
    const laterFilled = await getOrder(db, later.order.id);
    expect(laterFilled?.lines[0].reservedQty).toBe(2);
    expect(laterFilled?.lines[0].unmetQty).toBe(0);
    expect((await getOrder(db, big.order.id))?.lines[0].reservedQty).toBe(0);
    // Explicit Admin re-queue puts it back in the normal refill.
    await adminRequeueReservation(db, f.admin, r.id, "Customer confirmed they still want it");
    expect((await getOrder(db, big.order.id))?.lines[0].reservedQty).toBeGreaterThan(0);
  });
});

describe("AT12 — Sample withdrawal", () => {
  it("records rep/market/SKU/qty/date; consumes the same allocation once; corrections and sellable returns keep history; no invoice", async () => {
    const before = (await availability(db, f.warehouse.id, f.skus.sunlightCase.id)).availableQty;
    const s = await recordSampleWithdrawal(db, f.sales, { marketId: f.market.id, skuId: f.skus.sunlightCase.id, qty: 3, withdrawnOn: "2026-09-15" });
    expect((await availability(db, f.warehouse.id, f.skus.sunlightCase.id)).availableQty).toBe(before - 3);
    // Sales cannot record a sample for someone else; Admin can.
    await expect(recordSampleWithdrawal(db, f.sales, { marketId: f.market.id, skuId: f.skus.sunlightCase.id, qty: 1, withdrawnOn: "2026-09-15", repEmployeeId: f.admin.employeeId })).rejects.toThrow(/own samples/);
    // Correct 3 → 2 with history.
    const corrected = await correctSampleWithdrawal(db, f.sales, s.id, 2, "Only two cases were taken");
    expect(corrected.correctedOfId).toBe(s.id);
    expect((await availability(db, f.warehouse.id, f.skus.sunlightCase.id)).availableQty).toBe(before - 2);
    const orig = await db.select().from(schema.sampleWithdrawal).where(eq(schema.sampleWithdrawal.id, s.id));
    expect(orig[0].state).toBe("corrected");
    // Return unused sellable with evidence → restores availability; damaged never does.
    await expect(returnSample(db, f.sales, corrected.id, "sellable", "x")).rejects.toBeInstanceOf(AuthorizationError);
    await returnSample(db, f.admin, corrected.id, "sellable", "Inspected at warehouse, sealed");
    expect((await availability(db, f.warehouse.id, f.skus.sunlightCase.id)).availableQty).toBe(before);
    const dmg = await recordSampleWithdrawal(db, f.sales, { marketId: f.market.id, skuId: f.skus.sunlightCase.id, qty: 1, withdrawnOn: "2026-09-16" });
    await returnSample(db, f.admin, dmg.id, "damaged", "Dented cases");
    expect((await availability(db, f.warehouse.id, f.skus.sunlightCase.id)).availableQty).toBe(before - 1);
    // No invoice obligation exists for samples.
    expect(await db.select().from(schema.invoiceObligation)).toHaveLength(0);
  });
});

describe("AT13 — Warehouse reassignment", () => {
  it("Admin override changes the serving warehouse; market/price preserved; availability is per warehouse; transfer stays in transit until received", async () => {
    const second = await createWarehouse(db, f.admin, { marketId: f.market.id, name: "Overflow (Oakland)", isPrimary: false });
    const loc = await verifiedLocation("Reassigned Roadhouse");
    await expect(setWarehouseOverride(db, f.sales, loc.id, second.id, "x")).rejects.toBeInstanceOf(AuthorizationError);
    await setWarehouseOverride(db, f.admin, loc.id, second.id, "Closer to customer");
    // New warehouse has no stock: order reserves nothing, unmet retained — no duplicate availability.
    const res = await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 2 }] });
    expect(res.order.warehouseId).toBe(second.id);
    expect(res.order.marketId).toBe(f.market.id);
    expect(res.lines[0].unitPriceCentsAtSubmission).toBe(3600); // market price unchanged
    expect(res.lines[0].reservedQty).toBe(0);
    expect(res.lines[0].unmetQty).toBe(2);
    // Transfer out of primary → in transit at destination; not available at either end until receipt.
    const primaryBefore = (await availability(db, f.warehouse.id, f.skus.cantinescaCase.id)).availableQty;
    await expect(recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: f.skus.cantinescaCase.id, kind: "transfer_out", qtyDelta: -4, evidence: "x" })).rejects.toThrow(/transfer departure/);
    await recordTransferDeparture(db, f.admin, { fromWarehouseId: f.warehouse.id, toWarehouseId: second.id, skuId: f.skus.cantinescaCase.id, qty: 4, evidence: "Transfer T-1 departed" });
    expect((await availability(db, f.warehouse.id, f.skus.cantinescaCase.id)).availableQty).toBe(primaryBefore - 4);
    const inTransit = await availability(db, second.id, f.skus.cantinescaCase.id);
    expect(inTransit.availableQty).toBe(0);
    expect(inTransit.inTransitQty).toBe(4);
    // Receiving more than departed is refused; receipt converts in-transit to on-hand and fills retained demand.
    await expect(recordTransferReceipt(db, f.admin, { toWarehouseId: second.id, skuId: f.skus.cantinescaCase.id, qty: 5, evidence: "x" })).rejects.toThrow(/in transit/);
    await recordTransferReceipt(db, f.admin, { toWarehouseId: second.id, skuId: f.skus.cantinescaCase.id, qty: 4, evidence: "Transfer T-1 received & counted" });
    const after = await getOrder(db, res.order.id);
    expect(after?.lines[0].reservedQty).toBe(2); // receipt filled the retained demand
    const received = await availability(db, second.id, f.skus.cantinescaCase.id);
    expect(received.availableQty).toBe(2);
    expect(received.inTransitQty).toBe(0);
  });
});
