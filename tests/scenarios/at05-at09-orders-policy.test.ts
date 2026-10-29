import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { archiveSku, setMarketPrice } from "@/lib/domain/catalog/service";
import { recordLicenseDecision } from "@/lib/domain/customers/service";
import { createHold, grantOverride, resolveHold } from "@/lib/domain/holds/service";
import { adminAmendQuantity, evaluateMinimum, getOrder, repeatLastOrderPreview, requestOrderChange, submitOrder } from "@/lib/domain/orders/service";
import { evaluateLocationReadiness } from "@/lib/domain/readiness/service";
import { createStandingArrangement, generateStandingOccurrences, listStandingForLocation } from "@/lib/domain/standing/service";
import { getPolicy, recordSelection, withdrawProductionSelection } from "@/lib/policy/policy";
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

describe("AT05 — D01 unresolved", () => {
  it("a second delivery cannot pass by assuming saved bank / initiated debit / paid invoice; demand is retained", async () => {
    const loc = await verifiedLocation("Second Delivery Saloon");
    // Simulate an accepted first delivery (phase 2 record) — receipt is a fact.
    await db.insert(schema.deliveryVisit).values({ locationId: loc.id, deliveryDate: "2026-09-10", outcome: "accepted", acceptedMerchandiseCents: 18000, acceptedKegCount: 0 });
    // Even with a "method usable" provider status, D01 stays unresolved.
    await db.update(schema.paymentRelationship).set({ setupState: "method_usable", channel: "stripe_ach" }).where(eq(schema.paymentRelationship.locationId, loc.id));
    const res = await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 4 }] });
    expect(res.order.demandState).toBe("submitted"); // demand retained
    const readiness = await evaluateLocationReadiness(db, loc.id);
    const rule = readiness.conditions.find((c) => c.code === "delivery_rule")!;
    expect(rule.status).toBe("unresolved");
    expect(rule.decisionId).toBe("D01");
    expect(readiness.releasable).toBe(false);
    expect((await getPolicy(db, "D01")).status).toBe("unselected");
  });

  it("a labelled TEST selection exercises the valid_authorization candidate without becoming production policy", async () => {
    const loc = await verifiedLocation("Test Selection Tavern");
    await db.insert(schema.deliveryVisit).values({ locationId: loc.id, deliveryDate: "2026-09-11", outcome: "accepted" });
    await db.update(schema.paymentRelationship).set({ setupState: "method_usable", channel: "stripe_ach" }).where(eq(schema.paymentRelationship.locationId, loc.id));
    // Sales cannot record even a test selection; Owner-only for production.
    await expect(recordSelectionAs(f.sales, "test")).rejects.toBeInstanceOf(AuthorizationError);
    await recordSelectionAs(f.admin, "test");
    const readiness = await evaluateLocationReadiness(db, loc.id);
    const rule = readiness.conditions.find((c) => c.code === "delivery_rule")!;
    expect(rule.status).toBe("satisfied");
    expect(rule.detail).toContain("[test selection]");
    const [decision] = await db.select().from(schema.decision).where(eq(schema.decision.id, "D01"));
    expect(decision.status).toBe("unselected"); // test selection never flips production status
    // Clean up test selection.
    await db.update(schema.decisionSelection).set({ supersededAt: new Date() }).where(eq(schema.decisionSelection.decisionId, "D01"));
  });
});

async function recordSelectionAs(actor: Fixture["admin"], kind: "test" | "production") {
  return recordSelection(db, actor, { decisionId: "D01", kind, selection: { readiness_interpretation: "valid_authorization" }, scope: "all markets", effectiveFrom: new Date(0) });
}

describe("AT06 — Order under payment hold", () => {
  it("order is captured and consumes allocation; delivery restricted for the actual cause; another cause keeps blocking after one resolves", async () => {
    const loc = await verifiedLocation("Held Hideaway");
    const compliance = await createHold(db, f.admin, { locationId: loc.id, kind: "compliance", cause: "Receiving entrance unconfirmed" });
    const manual = await createHold(db, f.admin, { locationId: loc.id, kind: "admin_manual", cause: "Customer asked to pause deliveries" });
    // Payment-failure holds cannot be hand-made (they come from definitive provider evidence).
    await expect(createHold(db, f.admin, { locationId: loc.id, kind: "payment_failure", cause: "x" })).rejects.toThrow(/definitive provider evidence/);
    const res = await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: f.skus.sunlightCase.id, qty: 2 }] });
    expect(res.lines[0].reservedQty).toBe(2); // consumed allocation normally
    let readiness = await evaluateLocationReadiness(db, loc.id);
    expect(readiness.conditions.filter((c) => c.code.startsWith("hold:") && c.status === "blocked")).toHaveLength(2);
    await resolveHold(db, f.admin, compliance.id, "Entrance confirmed by buyer");
    readiness = await evaluateLocationReadiness(db, loc.id);
    expect(readiness.conditions.filter((c) => c.code.startsWith("hold:") && c.status === "blocked")).toHaveLength(1);
    expect(readiness.releasable).toBe(false); // other cause remains
    // Order is not lost.
    const order = await getOrder(db, res.order.id);
    expect(order?.order.demandState).toBe("submitted");
    // Audited override changes permission only; the hold stays active.
    await expect(grantOverride(db, f.sales, { locationId: loc.id, holdId: manual.id, scope: res.order.orderNumber, reason: "x" })).rejects.toBeInstanceOf(AuthorizationError);
    await grantOverride(db, f.admin, { locationId: loc.id, holdId: manual.id, scope: `Order ${res.order.orderNumber}`, reason: "Owner confirmed pause lifted for this delivery" });
    readiness = await evaluateLocationReadiness(db, loc.id);
    expect(readiness.releasable).toBe(true);
    const [h] = await db.select().from(schema.hold).where(eq(schema.hold.id, manual.id));
    expect(h.active).toBe(true);
  });
});

describe("AT07 — Minimum edge cases", () => {
  it("compares merchandise below $90 with deposits; threshold confirmed, D11 basis unselected; nothing is billed to reach it", () => {
    const unselected = { status: "unselected" as const };
    // 1 sixtel: merchandise $95 → meets under every basis
    expect(evaluateMinimum([{ qty: 1, unitPriceCents: 9500, kegsPerUnit: 1 }], unselected).verdict).toBe("meets");
    // 2 cases at $36 = $72 merchandise, no deposits → below under every basis
    expect(evaluateMinimum([{ qty: 2, unitPriceCents: 3600, kegsPerUnit: 0 }], unselected).verdict).toBe("below");
    // $60 merchandise + $35 deposit: merchandise-only below, with deposits meets → depends on D11
    const mixed = evaluateMinimum([{ qty: 1, unitPriceCents: 6000, kegsPerUnit: 1 }], unselected);
    expect(mixed.verdict).toBe("depends_on_unselected_D11");
    expect(mixed.basis).toBe("unselected");
    // With a selected basis the verdict follows it.
    expect(evaluateMinimum([{ qty: 1, unitPriceCents: 6000, kegsPerUnit: 1 }], { status: "selected", selection: { value_basis: "merchandise_only" } }).verdict).toBe("below");
    expect(evaluateMinimum([{ qty: 1, unitPriceCents: 6000, kegsPerUnit: 1 }], { status: "selected", selection: { value_basis: "merchandise_plus_deposits" } }).verdict).toBe("meets");
  });

  it("a below-minimum order is captured and flagged for Admin, not rejected", async () => {
    const loc = await verifiedLocation("Small Order Snug");
    const res = await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 2 }] });
    expect(res.minimum.verdict).toBe("below");
    const cases = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `below_minimum:${res.order.id}`));
    expect(cases).toHaveLength(1);
    expect(cases[0].state).toBe("open");
  });
});

describe("AT08 — Price-change edge", () => {
  it("Sales cannot override; a later market price change leaves the submitted price history intact; additions with a price question are held for D12", async () => {
    const loc = await verifiedLocation("Price Point Pub");
    const res = await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 3 }] });
    expect(res.lines[0].unitPriceCentsAtSubmission).toBe(3600);
    await expect(setMarketPrice(db, f.sales, { marketId: f.market.id, skuId: f.skus.cantinescaCase.id, priceCents: 100 })).rejects.toBeInstanceOf(AuthorizationError);
    await setMarketPrice(db, f.admin, { marketId: f.market.id, skuId: f.skus.cantinescaCase.id, priceCents: 3900, reason: "Q4 list" });
    const order = await getOrder(db, res.order.id);
    expect(order?.lines[0].unitPriceCentsAtSubmission).toBe(3600); // original preserved
    // Sales requests +2: recorded with both prices, routed to Admin, no silent effect.
    const change = await requestOrderChange(db, f.sales, { orderLineId: res.lines[0].id, kind: "amend_qty", requestedQty: 5, reason: "Customer wants two more" });
    expect(change.policyStatus).toBe("recorded_unselected_policy");
    expect(change.priorPriceCents).toBe(3600);
    expect(change.proposedPriceCents).toBe(3900);
    expect((await getOrder(db, res.order.id))?.lines[0].currentQty).toBe(3);
    // Admin cannot apply the addition while the price differs (D12 unselected)…
    await expect(adminAmendQuantity(db, f.admin, res.lines[0].id, 5, "apply")).rejects.toThrow(/D12/);
    // …but a reduction has no price question and applies with history.
    await adminAmendQuantity(db, f.admin, res.lines[0].id, 2, "Customer reduced");
    const after = await getOrder(db, res.order.id);
    expect(after?.lines[0].currentQty).toBe(2);
    expect(after?.lines[0].orderedQty).toBe(3);
    expect(after?.lines[0].reservedQty).toBe(2);
    // Substitution request is a request, never a change.
    await requestOrderChange(db, f.sales, { orderLineId: res.lines[0].id, kind: "substitution_request", substituteSkuId: f.skus.sunlightCase.id, reason: "Out of Cantinesca?" });
    expect((await getOrder(db, res.order.id))?.lines[0].skuId).toBe(f.skus.cantinescaCase.id);
    // Restore price for later tests.
    await setMarketPrice(db, f.admin, { marketId: f.market.id, skuId: f.skus.cantinescaCase.id, priceCents: 3600, reason: "restore" });
  });

  it("repeat-last-order shows changes and never resurrects an archived SKU", async () => {
    const loc = await verifiedLocation("Repeat Rathskeller");
    await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: f.skus.sunlightCase.id, qty: 2 }, { skuId: f.skus.cantinescaSixtel.id, qty: 1 }] });
    await setMarketPrice(db, f.admin, { marketId: f.market.id, skuId: f.skus.sunlightCase.id, priceCents: 4400 });
    const tempSku = await (await import("@/lib/domain/catalog/service")).createSku(db, f.admin, { code: "TMP-1", name: "Seasonal", brand: "Cantinesca", packageKind: "case_12oz_can", sellingUnit: "case" });
    await setMarketPrice(db, f.admin, { marketId: f.market.id, skuId: tempSku.id, priceCents: 3000 });
    await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: f.skus.sunlightCase.id, qty: 2 }, { skuId: tempSku.id, qty: 1 }] });
    await archiveSku(db, f.admin, tempSku.id, "season over");
    const preview = await repeatLastOrderPreview(db, loc.id);
    expect(preview.lines.find((l) => l.skuId === tempSku.id)?.change).toBe("archived");
    expect(preview.lines.find((l) => l.skuId === tempSku.id)?.orderable).toBe(false);
    expect(preview.lines.find((l) => l.skuId === f.skus.sunlightCase.id)?.change).toBe("none");
    await expect(submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: loc.id, lines: [{ skuId: tempSku.id, qty: 1 }] })).rejects.toThrow(/archived/);
    await setMarketPrice(db, f.admin, { marketId: f.market.id, skuId: f.skus.sunlightCase.id, priceCents: 4200 });
  });
});

describe("AT09 — Standing structure", () => {
  it("creates arrangement support with no active recurrence; a test D13 policy generates one occurrence per cycle through normal allocation, never a Stripe Subscription", async () => {
    const loc = await verifiedLocation("Standing Stein");
    const arr = await createStandingArrangement(db, f.sales, { locationId: loc.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 4 }], authorizationNote: "Buyer asked by email 9/1", requestedCadence: "every two weeks" });
    let report = await generateStandingOccurrences(db, f.admin);
    expect(report.policy).toBe("unselected");
    expect(report.generated).toHaveLength(0);
    let listed = await listStandingForLocation(db, loc.id);
    expect(listed[0].occurrences).toHaveLength(0);
    // Explicit TEST selection
    await recordSelection(db, f.admin, { decisionId: "D13", kind: "test", selection: { cadence_days: 14, generate_when_held: false }, scope: "test only", effectiveFrom: new Date(0) });
    report = await generateStandingOccurrences(db, f.admin);
    expect(report.policy).toBe("test");
    expect(report.generated.filter((g) => g.arrangementId === arr.id)).toHaveLength(1);
    // Same cycle again → no duplicate
    report = await generateStandingOccurrences(db, f.admin);
    expect(report.generated.filter((g) => g.arrangementId === arr.id)).toHaveLength(0);
    listed = await listStandingForLocation(db, loc.id);
    expect(listed[0].occurrences).toHaveLength(1);
    const orderId = listed[0].occurrences[0].orderId!;
    const order = await getOrder(db, orderId);
    expect(order?.order.source).toBe("standing");
    expect(order?.lines[0].reservedQty).toBe(4);
    // Held location + generate_when_held=false → skipped_policy in the next cycle.
    await createHold(db, f.admin, { locationId: loc.id, kind: "admin_manual", cause: "pause" });
    const later = new Date(Date.now() + 15 * 86_400_000);
    report = await generateStandingOccurrences(db, f.admin, later);
    expect(report.skipped.some((s) => s.arrangementId === arr.id && /held/.test(s.reason))).toBe(true);
    // No provider reference of any subscription kind exists.
    const refs = await db.select().from(schema.providerReference).where(eq(schema.providerReference.providerObject, "subscription"));
    expect(refs).toHaveLength(0);
    await db.update(schema.decisionSelection).set({ supersededAt: new Date() }).where(eq(schema.decisionSelection.decisionId, "D13"));
  });
});

describe("Decision register discipline (AT79)", () => {
  it("every D/SD/T/IG record exists and is unselected by default; production selection is Owner-only and reversible with history", async () => {
    const all = await db.select().from(schema.decision);
    expect(all.map((d) => d.id).sort()).toEqual(expect.arrayContaining(["D01", "D35", "SD01", "SD10", "T01", "T10", "IG01", "IG11"]));
    expect(all).toHaveLength(66);
    expect(all.every((d) => d.status === "unselected")).toBe(true);
    await expect(recordSelection(db, f.admin, { decisionId: "D09", kind: "production", selection: { abnormal_max_line_qty: 50 }, scope: "NC market", effectiveFrom: new Date(0) })).rejects.toBeInstanceOf(AuthorizationError);
    await recordSelection(db, f.owner, { decisionId: "D09", kind: "production", selection: { abnormal_max_line_qty: 50 }, scope: "NC market", effectiveFrom: new Date(0) });
    expect((await getPolicy(db, "D09")).status).toBe("selected");
    await expect(withdrawProductionSelection(db, f.admin, "D09", "x")).rejects.toBeInstanceOf(AuthorizationError);
    await withdrawProductionSelection(db, f.owner, "D09", "reverting for the test");
    expect((await getPolicy(db, "D09")).status).toBe("unselected");
    const history = await db.select().from(schema.decisionSelection).where(and(eq(schema.decisionSelection.decisionId, "D09")));
    expect(history).toHaveLength(1);
    expect(history[0].supersededAt).not.toBeNull();
  });
});
