import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { archiveSku } from "@/lib/domain/catalog/service";
import { decideBillingEmailChange, getLocation, licenseVerificationRequirement, recordLicenseDecision, requestBillingEmailChange } from "@/lib/domain/customers/service";
import { createHold } from "@/lib/domain/holds/service";
import { getOrder } from "@/lib/domain/orders/service";
import { authorizedPayer, clearPayerContact, requestPaymentSetup, setPayerContact } from "@/lib/domain/payment/service";
import { evaluateLocationReadiness } from "@/lib/domain/readiness/service";
import { createStandingArrangement, generateStandingOccurrences, listStandingForLocation } from "@/lib/domain/standing/service";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { runPolicyFollowThrough } from "@/lib/policy/followthrough";
import { getPolicy, listDecisions, policyMatrix, recordSelection, withdrawProductionSelection, withdrawSelection } from "@/lib/policy/policy";
import { validateSelection } from "@/lib/policy/schema";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

/**
 * REV-06 (AC13/AC14/AC15), REV-07 (AC16), REV-08 (AC17), REV-16 (AC24),
 * AC28 — policy timelines keep unaffected markets; labels are not authority;
 * payer authority is intentional; standing generation never loses demand.
 */
let db: Db;
let close: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
});
afterAll(async () => close());

const day = 86_400_000;

describe("REV-06 / AC13 — global then one-market override keeps the other markets", () => {
  it("D11 for all markets, then a different D11 for NC: MA keeps the global basis; withdrawing the override restores it; history retained", async () => {
    await recordSelection(db, f.owner, { decisionId: "D11", kind: "production", selection: { value_basis: "merchandise_only" }, scope: "all markets", effectiveFrom: new Date(Date.now() - 10 * day) });
    const override = await recordSelection(db, f.owner, { decisionId: "D11", kind: "production", selection: { value_basis: "merchandise_plus_deposits" }, scope: "NC only", marketIds: [f.market.id], effectiveFrom: new Date(Date.now() - day) });
    const nc = await getPolicy<{ value_basis: string }>(db, "D11", { marketId: f.market.id });
    const ma = await getPolicy<{ value_basis: string }>(db, "D11", { marketId: f.market2.id });
    expect(nc.status === "selected" && nc.selection.value_basis).toBe("merchandise_plus_deposits");
    expect(ma.status === "selected" && ma.selection.value_basis).toBe("merchandise_only");
    const matrix = await policyMatrix(db, "D11");
    expect(matrix.cells.find((c) => c.marketId === f.market2.id)?.effective?.scope).toBe("all markets");
    expect(matrix.cells.find((c) => c.marketId === f.market.id)?.effective?.scope).toBe("NC only");
    // Withdraw only the override: NC falls back to the global selection; nothing global was withdrawn.
    await withdrawSelection(db, f.owner, override.row.id, "revert NC");
    const ncAfter = await getPolicy<{ value_basis: string }>(db, "D11", { marketId: f.market.id });
    expect(ncAfter.status === "selected" && ncAfter.selection.value_basis).toBe("merchandise_only");
    const history = await db.select().from(schema.decisionSelection).where(eq(schema.decisionSelection.decisionId, "D11"));
    expect(history).toHaveLength(2);
    expect(history.find((h) => h.id === override.row.id)?.withdrawnReason).toBe("revert NC");
    await withdrawProductionSelection(db, f.owner, "D11", "cleanup");
    expect((await getPolicy(db, "D11", { marketId: f.market2.id })).status).toBe("unselected");
  });

  it("overlapping market sets are deterministic (latest effective, then latest recorded) and each market keeps a policy", async () => {
    const m3 = await (await import("@/lib/domain/markets/service")).createMarket(db, f.owner, { code: "LA", name: "Los Angeles" });
    const first = await recordSelection(db, f.owner, { decisionId: "D09", kind: "production", selection: { abnormal_max_line_qty: 10 }, scope: "NC+MA", marketIds: [f.market.id, f.market2.id], effectiveFrom: new Date(Date.now() - 5 * day) });
    await recordSelection(db, f.owner, { decisionId: "D09", kind: "production", selection: { abnormal_max_line_qty: 20 }, scope: "MA+LA", marketIds: [f.market2.id, m3.id], effectiveFrom: new Date(Date.now() - 2 * day) });
    const get = async (m: string) => {
      const p = await getPolicy<{ abnormal_max_line_qty: number }>(db, "D09", { marketId: m });
      return p.status === "selected" ? p.selection.abnormal_max_line_qty : null;
    };
    expect(await get(f.market.id)).toBe(10); // NC untouched by the second selection
    expect(await get(f.market2.id)).toBe(20); // MA: later effective wins
    expect(await get(m3.id)).toBe(20);
    expect(first.row.supersededAt).toBeNull(); // nothing was edited or split
    await withdrawProductionSelection(db, f.owner, "D09", "cleanup");
  });
});

describe("REV-06 / AC14 — scheduled changes entered out of order; withdrawal; concurrent edits", () => {
  it("a future-dated global selection recorded BEFORE an earlier-dated one does not lose either interval", async () => {
    const future = new Date(Date.now() + 5 * day);
    const fut = await recordSelection(db, f.owner, { decisionId: "D13", kind: "production", selection: { cadence_days: 7, generate_when_held: true }, scope: "all, from next week", effectiveFrom: future });
    const now = await recordSelection(db, f.owner, { decisionId: "D13", kind: "production", selection: { cadence_days: 14, generate_when_held: false }, scope: "all, now", effectiveFrom: new Date(Date.now() - day) });
    const current = await getPolicy<{ cadence_days: number }>(db, "D13", { marketId: f.market.id });
    expect(current.status === "selected" && current.selection.cadence_days).toBe(14);
    const later = await getPolicy<{ cadence_days: number }>(db, "D13", { marketId: f.market.id, now: new Date(Date.now() + 6 * day) });
    expect(later.status === "selected" && later.selection.cadence_days).toBe(7);
    expect(fut.row.supersededAt).toBeNull();
    expect(now.row.supersededAt).toBeNull();
    const matrix = await policyMatrix(db, "D13");
    expect(matrix.cells[0].effective?.id).toBe(now.row.id);
    expect(matrix.cells[0].scheduled.map((s) => s.id)).toEqual([fut.row.id]);
    const listed = (await listDecisions(db)).find((d) => d.id === "D13");
    expect(listed?.status).toBe("selected");
    expect(listed?.scheduled).toBe(true);
    // "Concurrent" edits: two recordings with the same effective date → the later recording wins deterministically; both remain in history.
    const a = await recordSelection(db, f.owner, { decisionId: "D13", kind: "production", selection: { cadence_days: 21, generate_when_held: false }, scope: "edit A", effectiveFrom: new Date(Date.now() - day) });
    const b = await recordSelection(db, f.owner, { decisionId: "D13", kind: "production", selection: { cadence_days: 28, generate_when_held: false }, scope: "edit B", effectiveFrom: new Date(Date.now() - day) });
    const after = await getPolicy<{ cadence_days: number }>(db, "D13", { marketId: f.market.id });
    expect(after.status === "selected" && after.selectionId).toBe(b.row.id);
    // Withdrawing an already-withdrawn selection is a clear stale refusal.
    await withdrawSelection(db, f.owner, b.row.id, "mistake");
    await expect(withdrawSelection(db, f.owner, b.row.id, "again")).rejects.toBeInstanceOf(StaleStateError);
    expect((await getPolicy<{ cadence_days: number }>(db, "D13", { marketId: f.market.id }) as { selectionId?: string }).selectionId).toBe(a.row.id);
    await withdrawProductionSelection(db, f.owner, "D13", "cleanup");
  });
});

describe("REV-06/16 / AC15 — typed validation; test selections never activate in production; unsupported stays explicit", () => {
  it("empty / malformed / unknown-key selections are refused; missing keys are reported as unresolved and stay inactive", async () => {
    await expect(recordSelection(db, f.owner, { decisionId: "D13", kind: "production", selection: {}, scope: "x", effectiveFrom: new Date(0) })).rejects.toThrow(/Nothing was selected/);
    await expect(recordSelection(db, f.owner, { decisionId: "D13", kind: "production", selection: { cadence_days: "fortnightly" }, scope: "x", effectiveFrom: new Date(0) })).rejects.toThrow(/cadence_days: must be a whole number/);
    await expect(recordSelection(db, f.owner, { decisionId: "D13", kind: "production", selection: { cadence: 14 }, scope: "x", effectiveFrom: new Date(0) })).rejects.toThrow(/unknown field/);
    await expect(recordSelection(db, f.owner, { decisionId: "D11", kind: "production", selection: { value_basis: "gross" }, scope: "x", effectiveFrom: new Date(0) })).rejects.toThrow(/must be one of/);
    const v = validateSelection({ cadence_days: "integer days", generate_when_held: "true|false" }, { cadence_days: "14" });
    expect(v.value).toEqual({ cadence_days: 14 });
    expect(v.missingKeys).toEqual(["generate_when_held"]);
    // A partial D13 is recorded as such but does not generate (REV-16).
    const partial = await recordSelection(db, f.owner, { decisionId: "D13", kind: "production", selection: { cadence_days: 14 }, scope: "partial", effectiveFrom: new Date(0) });
    expect(partial.validation.missingKeys).toEqual(["generate_when_held"]);
    await withdrawProductionSelection(db, f.owner, "D13", "cleanup");
    // Permission: Sales cannot record even a test selection; Admin cannot record production.
    await expect(recordSelection(db, f.sales, { decisionId: "D13", kind: "test", selection: { cadence_days: 14, generate_when_held: false }, scope: "x", effectiveFrom: new Date(0) })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(recordSelection(db, f.admin, { decisionId: "D13", kind: "production", selection: { cadence_days: 14, generate_when_held: false }, scope: "x", effectiveFrom: new Date(0) })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("a test selection is ignored when FV_ENV=production", async () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = env.FV_ENV;
    await recordSelection(db, f.admin, { decisionId: "D09", kind: "test", selection: { abnormal_max_line_qty: 3 }, scope: "test", effectiveFrom: new Date(0) });
    expect((await getPolicy(db, "D09", { marketId: f.market.id })).status).toBe("selected");
    env.FV_ENV = "production";
    try {
      expect((await getPolicy(db, "D09", { marketId: f.market.id })).status).toBe("unselected");
      await expect(recordSelection(db, f.admin, { decisionId: "D09", kind: "test", selection: { abnormal_max_line_qty: 3 }, scope: "test", effectiveFrom: new Date(0) })).rejects.toThrow(/not recorded in production/);
    } finally {
      if (saved === undefined) delete env.FV_ENV;
      else env.FV_ENV = saved;
    }
    await db.update(schema.decisionSelection).set({ supersededAt: new Date() }).where(eq(schema.decisionSelection.decisionId, "D09"));
  });
});

describe("REV-07 / AC16 — 'license not applicable' is derived from D02, not from a label", () => {
  it("with D02 unselected Admin cannot record not_applicable; a wrong-market D02 does not help; a withdrawn exemption reopens the work", async () => {
    const { location } = await makeLocation(db, f.sales, f.market.id, "Exempt Eatery");
    await expect(recordLicenseDecision(db, f.admin, { locationId: location.id, state: "not_applicable" })).rejects.toThrow(/D02 is unselected/);
    let r = await evaluateLocationReadiness(db, location.id);
    expect(r.conditions.find((c) => c.code === "license")?.status).toBe("pending");
    expect(r.releasable).toBe(false);
    // Capture still works while the delivery condition is unresolved.
    const { submitOrder } = await import("@/lib/domain/orders/service");
    await submitOrder(db, f.sales, { locationId: location.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] });
    // D02 that requires verification only in MA (i.e. NC exempt) but scoped to MA only → NC still unselected.
    const wrong = await recordSelection(db, f.owner, { decisionId: "D02", kind: "production", selection: { verification_required_markets: ["MA"] }, scope: "MA only", marketIds: [f.market2.id], effectiveFrom: new Date(0) });
    expect((await licenseVerificationRequirement(db, f.market.id)).basis).toBe("unselected");
    await expect(recordLicenseDecision(db, f.admin, { locationId: location.id, state: "not_applicable" })).rejects.toThrow(/D02 is unselected/);
    await withdrawSelection(db, f.owner, wrong.row.id, "wrong scope");
    // A TEST selection is not authority either.
    await recordSelection(db, f.admin, { decisionId: "D02", kind: "test", selection: { verification_required_markets: ["MA"] }, scope: "test", effectiveFrom: new Date(0) });
    await expect(recordLicenseDecision(db, f.admin, { locationId: location.id, state: "not_applicable" })).rejects.toThrow(/TEST selection/);
    r = await evaluateLocationReadiness(db, location.id);
    expect(r.conditions.find((c) => c.code === "license")?.status).toBe("pending");
    await db.update(schema.decisionSelection).set({ supersededAt: new Date() }).where(and(eq(schema.decisionSelection.decisionId, "D02"), eq(schema.decisionSelection.kind, "test")));
    // A production D02 selection covering NC and exempting it: readiness satisfied by policy, the open case resolves by follow-through.
    const exempt = await recordSelection(db, f.owner, { decisionId: "D02", kind: "production", selection: { verification_required_markets: ["MA"] }, scope: "all", effectiveFrom: new Date(0) });
    await runPolicyFollowThrough(db, f.owner, "D02", null);
    r = await evaluateLocationReadiness(db, location.id);
    expect(r.conditions.find((c) => c.code === "license")?.status).toBe("satisfied");
    expect(r.conditions.find((c) => c.code === "license")?.plain).toMatch(/not required/);
    const [c1] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `license_unverified:${location.id}`));
    expect(c1.state).toBe("resolved");
    // Now recording not_applicable is allowed (it is consistent with policy).
    await recordLicenseDecision(db, f.admin, { locationId: location.id, state: "not_applicable" });
    // Withdraw the exemption: the label no longer counts; readiness pending again and the case reopens (dedupe → one open case).
    await withdrawSelection(db, f.owner, exempt.row.id, "policy reversed");
    await runPolicyFollowThrough(db, f.owner, "D02", null);
    r = await evaluateLocationReadiness(db, location.id);
    const lic = r.conditions.find((c) => c.code === "license");
    expect(lic?.status).toBe("pending");
    expect(lic?.plain).toMatch(/recorded as not applicable, but/);
    const open = await db.select().from(schema.exceptionCase).where(and(eq(schema.exceptionCase.dedupeKey, `license_unverified:${location.id}`), eq(schema.exceptionCase.state, "open")));
    expect(open).toHaveLength(1);
  });
});

describe("REV-08 / AC17 — payer authority is intentional and location-specific", () => {
  it("shared AP for two locations does not authorize either; explicit assignment (with shared note) does; unrelated contact refused; revocation stops setup", async () => {
    const a = (await makeLocation(db, f.sales, f.market.id, "Shared AP One")).location;
    const b = (await makeLocation(db, f.sales, f.market.id, "Shared AP Two")).location;
    for (const l of [a, b]) {
      const d = await getLocation(db, l.id);
      expect(d?.payment?.payerContactId).toBeNull();
      expect(d?.contacts.every((c) => c.mayAuthorizePayment === false)).toBe(true);
      const auth = await authorizedPayer(db, l.id);
      expect(auth.ok).toBe(false);
      await expect(requestPaymentSetup(db, f.accounting, l.id)).rejects.toThrow(/No payer has been assigned/);
      expect(await db.select().from(schema.notice).where(eq(schema.notice.subjectId, l.id))).toHaveLength(0);
    }
    const ap = (await getLocation(db, a.id))!.contacts.find((c) => c.contactRole === "ap")!;
    // Passing an explicit contact id that is not the assigned payer is refused too.
    await expect(requestPaymentSetup(db, f.accounting, a.id, ap.contactId)).rejects.toThrow(/not this location's assigned payer/);
    // An unrelated contact (buyer of B) cannot be A's payer.
    const bBuyer = (await getLocation(db, b.id))!.contacts.find((c) => c.contactRole === "buyer")!;
    await expect(setPayerContact(db, f.accounting, a.id, bBuyer.contactId)).rejects.toThrow(/current contact of this location/);
    await expect(setPayerContact(db, f.sales, a.id, ap.contactId)).rejects.toBeInstanceOf(AuthorizationError);
    await setPayerContact(db, f.accounting, a.id, ap.contactId);
    const r1 = await requestPaymentSetup(db, f.accounting, a.id);
    expect(r1.notice.recipientEmail).toBe("ap@shared-ap.example.test");
    expect(r1.notice.recipientContactId).toBe(ap.contactId);
    // Same shared contact on B needs the explicit shared-payer note.
    const bAp = (await getLocation(db, b.id))!.contacts.find((c) => c.contactRole === "ap")!;
    expect(bAp.contactId).toBe(ap.contactId); // same person record reused
    await expect(setPayerContact(db, f.accounting, b.id, bAp.contactId)).rejects.toThrow(/Shared payer authority must be explicitly authorized/);
    await setPayerContact(db, f.accounting, b.id, bAp.contactId, "Both venues owned by the same LLC; confirmed by the owner 9/17");
    expect((await getLocation(db, b.id))?.payment?.sharedPayerAuthorized).toBe(true);
    await requestPaymentSetup(db, f.accounting, b.id);
    // Repeated request reuses the pending invitation (no duplicate intents).
    const again = await requestPaymentSetup(db, f.accounting, b.id);
    expect(again.noticeReused).toBe(true);
    expect((await db.select().from(schema.notice).where(and(eq(schema.notice.subjectId, b.id), eq(schema.notice.purpose, "payment_setup_invitation")))).length).toBe(1);
    // Revoke on A: further setup paths refuse until re-assigned.
    await clearPayerContact(db, f.accounting, a.id, "AP contact left the company");
    expect((await authorizedPayer(db, a.id)).ok).toBe(false);
    await expect(requestPaymentSetup(db, f.accounting, a.id)).rejects.toThrow(/No payer has been assigned/);
    const { createHostedSetupSession } = await import("@/lib/integrations/stripe/adapter");
    await expect(createHostedSetupSession(db, f.accounting, a.id, "http://x")).rejects.toThrow(/No payer has been assigned/);
  });
});

describe("AC28 — competing billing-email decisions", () => {
  it("one decision wins; replay refused with the current state; recipients of past notices unchanged; payer authority untouched", async () => {
    const { location } = await makeLocation(db, f.sales, f.market.id, "Billing Bistro");
    const ap = (await getLocation(db, location.id))!.contacts.find((c) => c.contactRole === "ap")!;
    await setPayerContact(db, f.accounting, location.id, ap.contactId, "shared AP explicitly authorized for the test");
    const setup = await requestPaymentSetup(db, f.accounting, location.id);
    const req = await requestBillingEmailChange(db, f.sales, { locationId: location.id, requestedEmail: "new-ap@example.test" });
    expect((await requestBillingEmailChange(db, f.sales, { locationId: location.id, requestedEmail: "new-ap@example.test" })).id).toBe(req.id); // no duplicate pending request
    await decideBillingEmailChange(db, f.admin, req.id, "approved");
    await expect(decideBillingEmailChange(db, f.admin, req.id, "rejected")).rejects.toBeInstanceOf(StaleStateError);
    const d = await getLocation(db, location.id);
    expect(d?.contacts.find((c) => c.contactRole === "ap")?.contact.email).toBe("new-ap@example.test");
    // The old invitation intent keeps its original recipient snapshot; the new AP contact has no payer authority.
    const [oldNotice] = await db.select().from(schema.notice).where(eq(schema.notice.id, setup.notice.id));
    expect(oldNotice.recipientEmail).toBe("ap@shared-ap.example.test");
    expect(d?.contacts.find((c) => c.contactRole === "ap")?.mayAuthorizePayment).toBe(false);
    expect(d?.payment?.payerContactId).toBe(ap.contactId); // still the intentionally assigned payer (now an ended AP association → authority check will flag it)
    expect((await authorizedPayer(db, location.id)).ok).toBe(false);
  });
});

describe("REV-16 / AC24 — standing arrangements never lose demand silently", () => {
  it("mixed archived/active lines generate a partial order AND an owned review; incomplete policy is owned, not defaulted; held skip is owned; failure is owned", async () => {
    const { location } = await makeLocation(db, f.sales, f.market.id, "Standing Stand");
    await recordLicenseDecision(db, f.admin, { locationId: location.id, state: "verified", licenseNumber: "L", evidence: "e" });
    const arr = await createStandingArrangement(db, f.sales, { locationId: location.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 2 }, { skuId: f.skus.sunlightCase.id, qty: 3 }], authorizationNote: "email 9/1" });
    // Incomplete policy (no generate_when_held) → nothing generated, owned case, no default assumed.
    await recordSelection(db, f.admin, { decisionId: "D13", kind: "test", selection: { cadence_days: 7 }, scope: "test partial", effectiveFrom: new Date(0) });
    let report = await generateStandingOccurrences(db, f.admin);
    expect(report.generated).toHaveLength(0);
    expect(report.skipped.some((s) => s.arrangementId === arr.id && /incomplete/.test(s.reason))).toBe(true);
    let cases = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `standing_policy_incomplete:${arr.id}`));
    expect(cases).toHaveLength(1);
    expect(cases[0].ownerRole).toBe("owner");
    await db.update(schema.decisionSelection).set({ supersededAt: new Date() }).where(eq(schema.decisionSelection.decisionId, "D13"));
    // Complete policy; one SKU archived → partial generation with the skipped line recorded and a Sales review case.
    await archiveSku(db, f.admin, f.skus.sunlightCase.id, "discontinued");
    await recordSelection(db, f.admin, { decisionId: "D13", kind: "test", selection: { cadence_days: 7, generate_when_held: false }, scope: "test", effectiveFrom: new Date(0) });
    report = await generateStandingOccurrences(db, f.admin);
    const gen = report.generated.find((g) => g.arrangementId === arr.id);
    expect(gen?.skippedLines).toBe(1);
    const listed = await listStandingForLocation(db, location.id);
    const occ = listed[0].occurrences[0];
    expect(occ.outcome).toBe("generated_partial");
    expect((occ.detail as { skippedLines: Array<{ qty: number }> }).skippedLines[0].qty).toBe(3);
    const order = await getOrder(db, occ.orderId!);
    expect(order?.lines).toHaveLength(1);
    expect(order?.order.notes).toMatch(/not included \(archived\)/);
    cases = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `standing_review:${arr.id}`));
    expect(cases).toHaveLength(1);
    expect(cases[0].ownerRole).toBe("sales");
    expect(cases[0].cause).toMatch(/Sunlight Groove 24 oz case × 3/);
    expect((await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.id, (await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `standing_policy_incomplete:${arr.id}`)))[0].id)))[0].state).toBe("resolved");
    // Held + generate_when_held=false in the next cycle → skipped and owned.
    await createHold(db, f.admin, { locationId: location.id, kind: "admin_manual", cause: "pause requested" });
    const later = new Date(Date.now() + 8 * day);
    report = await generateStandingOccurrences(db, f.admin, later);
    expect(report.skipped.some((s) => s.arrangementId === arr.id && /held/.test(s.reason))).toBe(true);
    expect(await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.category, "standing_skipped"))).toHaveLength(1);
    // Generation failure (price removed) → failed + owned case, nothing written for the cycle.
    await db.update(schema.hold).set({ active: false }).where(eq(schema.hold.locationId, location.id));
    await db.update(schema.marketPrice).set({ effectiveTo: new Date(0) }).where(eq(schema.marketPrice.skuId, f.skus.cantinescaCase.id));
    const later2 = new Date(Date.now() + 15 * day);
    report = await generateStandingOccurrences(db, f.admin, later2);
    expect(report.failed.some((x) => x.arrangementId === arr.id)).toBe(true);
    expect(await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `standing_generation_failed:${arr.id}`))).toHaveLength(1);
    const occs = await db.select().from(schema.standingOccurrence).where(eq(schema.standingOccurrence.arrangementId, arr.id));
    expect(occs.map((o) => o.cycleKey).sort()).toEqual(["c0", "c1"]); // c2 not burned
    await db.update(schema.decisionSelection).set({ supersededAt: new Date() }).where(eq(schema.decisionSelection.decisionId, "D13"));
    void BusinessError;
  });
});
