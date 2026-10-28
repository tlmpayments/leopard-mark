import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { availability, recordStockMovement } from "@/lib/domain/allocation/service";
import { createSku, setMarketPrice } from "@/lib/domain/catalog/service";
import { recordLicenseDecision } from "@/lib/domain/customers/service";
import { convertIntakeToOrder, recordIntakeRequest } from "@/lib/domain/intake/service";
import { adminAmendQuantity, cancelUndeliveredDemand, getOrder, submitOrder } from "@/lib/domain/orders/service";
import { correctSampleWithdrawal, recordSampleWithdrawal, returnSample } from "@/lib/domain/samples/service";
import { decideBillingEmailChange, requestBillingEmailChange } from "@/lib/domain/customers/service";
import { StaleStateError } from "@/lib/errors";
import { enqueueJob, registerJobHandler, runDueJobs } from "@/lib/jobs/queue";
import { createPgTestDb, pgAvailable } from "../support/pg";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

/**
 * Real-Postgres races (AC07, AC08, AC10, AC11, AC12, AC22, AC23, AC28).
 * Every scenario fires the competing calls on separate pooled connections so
 * row locks, conditional updates and unique indexes are exercised for real.
 * Requires TEST_DATABASE_URL (see tests/support/pg.ts); otherwise skipped.
 */
const run = pgAvailable() ? describe : describe.skip;
if (!pgAvailable()) console.warn("[tests/postgres] TEST_DATABASE_URL not set — real-Postgres race scenarios SKIPPED (not run).");

let db: Db;
let close: () => Promise<void>;
let f: Fixture;

run("Real-Postgres concurrency", () => {
  beforeAll(async () => {
    ({ db, close } = await createPgTestDb());
    f = await buildFixture(db);
  }, 120_000);
  afterAll(async () => close());

  async function freshSku(code: string, opening = 20) {
    const sku = await createSku(db, f.admin, { code, name: `${code} case`, brand: "Race", packageKind: "case_12oz_can", sellingUnit: "case" });
    await setMarketPrice(db, f.admin, { marketId: f.market.id, skuId: sku.id, priceCents: 3600 });
    if (opening) await recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: sku.id, kind: "opening", qtyDelta: opening, evidence: "opening" });
    return sku;
  }
  async function verifiedLocation(name: string) {
    const { location } = await makeLocation(db, f.sales, f.market.id, name);
    await recordLicenseDecision(db, f.admin, { locationId: location.id, state: "verified", licenseNumber: "L", evidence: "e" });
    return location;
  }
  const settled = (ps: Array<Promise<unknown>>) => Promise.allSettled(ps);

  it("AC07 — simultaneous returns of one sample: stock ends at 20, exactly one return effect", async () => {
    const sku = await freshSku("R-AC07");
    const s = await recordSampleWithdrawal(db, f.sales, { marketId: f.market.id, skuId: sku.id, qty: 2, withdrawnOn: "2026-09-17" });
    const results = await settled([returnSample(db, f.admin, s.id, "sellable", "a"), returnSample(db, f.admin, s.id, "sellable", "b"), returnSample(db, f.admin, s.id, "sellable", "c")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof StaleStateError)).toHaveLength(2);
    expect((await availability(db, f.warehouse.id, sku.id)).onHandQty).toBe(20);
    const moves = await db.select().from(schema.stockMovement).where(and(eq(schema.stockMovement.skuId, sku.id), eq(schema.stockMovement.kind, "sample_return")));
    expect(moves).toHaveLength(1);
  });

  it("AC08 — return races correction; two corrections race: one transition, complete history", async () => {
    const sku = await freshSku("R-AC08");
    const s = await recordSampleWithdrawal(db, f.sales, { marketId: f.market.id, skuId: sku.id, qty: 4, withdrawnOn: "2026-09-17" });
    const r = await settled([returnSample(db, f.admin, s.id, "sellable", "x"), correctSampleWithdrawal(db, f.sales, s.id, 3, "only three")]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const onHand = (await availability(db, f.warehouse.id, sku.id)).onHandQty;
    expect([20, 17]).toContain(onHand); // returned all (20) or corrected to 3 (17) — never both
    const s2 = await recordSampleWithdrawal(db, f.sales, { marketId: f.market.id, skuId: sku.id, qty: 2, withdrawnOn: "2026-09-17" });
    const before = (await availability(db, f.warehouse.id, sku.id)).onHandQty;
    const r2 = await settled([correctSampleWithdrawal(db, f.sales, s2.id, 1, "a"), correctSampleWithdrawal(db, f.sales, s2.id, 0, "b")]);
    expect(r2.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const after = (await availability(db, f.warehouse.id, sku.id)).onHandQty;
    expect([before + 1, before + 2]).toContain(after);
    expect((await db.select().from(schema.sampleWithdrawal).where(eq(schema.sampleWithdrawal.correctedOfId, s2.id))).length).toBe(1);
  });

  it("AC10 — concurrent submissions never over-reserve; total reserved ≤ on hand; unmet retained", async () => {
    const sku = await freshSku("R-AC10", 10);
    const locs = await Promise.all([1, 2, 3, 4, 5].map((i) => verifiedLocation(`Race Loc ${i}`)));
    const results = await settled(locs.map((l) => submitOrder(db, f.sales, { locationId: l.id, lines: [{ skuId: sku.id, qty: 4 }] })));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const a = await availability(db, f.warehouse.id, sku.id);
    expect(a.reservedQty).toBe(10);
    expect(a.deficitQty).toBe(0);
    const resv = await db.select().from(schema.reservation).where(eq(schema.reservation.skuId, sku.id));
    expect(resv.reduce((s, r) => s + r.unmetQty, 0)).toBe(10);
  });

  it("AC11 — concurrent amendment and cancellation: one wins, no reservation survives on a cancelled order", async () => {
    const sku = await freshSku("R-AC11");
    const loc = await verifiedLocation("Amend vs Cancel");
    const o = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 4 }] });
    const r = await settled([cancelUndeliveredDemand(db, f.admin, o.order.id, "cancel"), adminAmendQuantity(db, f.admin, o.lines[0].id, 6, "amend")]);
    const after = await getOrder(db, o.order.id);
    if (after?.order.demandState === "cancelled") {
      expect(after.lines[0].reservedQty).toBe(0);
      expect((await availability(db, f.warehouse.id, sku.id)).reservedQty).toBe(0);
    } else {
      expect(after?.lines[0].currentQty).toBe(6);
    }
    expect(r.filter((x) => x.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
  });

  it("AC12 — the same submission key fired simultaneously produces exactly one order", async () => {
    const sku = await freshSku("R-AC12");
    const loc = await verifiedLocation("Double Click Deli");
    const input = { locationId: loc.id, lines: [{ skuId: sku.id, qty: 2 }], submissionKey: "dbl-1" };
    const r = await settled([submitOrder(db, f.sales, input), submitOrder(db, f.sales, input), submitOrder(db, f.sales, input)]);
    expect(r.every((x) => x.status === "fulfilled")).toBe(true);
    const ids = new Set(r.map((x) => (x as PromiseFulfilledResult<Awaited<ReturnType<typeof submitOrder>>>).value.order.id));
    expect(ids.size).toBe(1);
    expect((await db.select().from(schema.order).where(eq(schema.order.locationId, loc.id))).length).toBe(1);
    expect(r.filter((x) => (x as PromiseFulfilledResult<Awaited<ReturnType<typeof submitOrder>>>).value.replayed).length).toBe(2);
  });

  it("AC22 — two workers draining the same queue run each job exactly once", async () => {
    let runs = 0;
    registerJobHandler("race.once", { run: async () => { await new Promise((r) => setTimeout(r, 20)); runs++; } });
    for (let i = 0; i < 6; i++) await enqueueJob(db, "race.once", { i });
    const [a, b] = await Promise.all([runDueJobs(db, { workerId: "A", limit: 10 }), runDueJobs(db, { workerId: "B", limit: 10 })]);
    const done = [...a, ...b].filter((r) => r.outcome === "done");
    expect(done).toHaveLength(6);
    expect(runs).toBe(6);
    const rows = await db.select().from(schema.job).where(eq(schema.job.kind, "race.once"));
    expect(rows.every((j) => j.status === "done" && j.attempts === 1)).toBe(true);
  });

  it("AC23 — two handlers converting one intake at the same time: one order, one source state", async () => {
    const a = await verifiedLocation("Intake Race A");
    const b = await verifiedLocation("Intake Race B");
    const req = await recordIntakeRequest(db, f.admin, { fromEmail: "x@y.test", subject: "s", body: "b", marketId: f.market.id });
    const r = await settled([
      convertIntakeToOrder(db, f.admin, { intakeId: req.id, locationId: a.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] }),
      convertIntakeToOrder(db, f.admin, { intakeId: req.id, locationId: b.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected" && x.reason instanceof StaleStateError)).toHaveLength(1);
    expect((await db.select().from(schema.order).where(eq(schema.order.intakeRequestId, req.id))).length).toBe(1);
  });

  it("AC28 — replayed/competing billing-email approvals: one decision", async () => {
    const loc = await verifiedLocation("Billing Race");
    const req = await requestBillingEmailChange(db, f.sales, { locationId: loc.id, requestedEmail: "race@example.test" });
    const r = await settled([decideBillingEmailChange(db, f.admin, req.id, "approved"), decideBillingEmailChange(db, f.admin, req.id, "rejected"), decideBillingEmailChange(db, f.admin, req.id, "approved")]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const aps = await db.select().from(schema.locationContact).where(and(eq(schema.locationContact.locationId, loc.id), eq(schema.locationContact.contactRole, "ap"), eq(schema.locationContact.current, true)));
    expect(aps).toHaveLength(1);
  });
});
