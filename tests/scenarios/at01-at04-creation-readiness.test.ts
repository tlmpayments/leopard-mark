import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import {
  decideBillingEmailChange,
  findSimilarLocations,
  flagSuspectedDuplicate,
  getLocation,
  recordLicenseDecision,
  requestBillingEmailChange,
} from "@/lib/domain/customers/service";
import { submitOrder } from "@/lib/domain/orders/service";
import { requestPaymentSetup, setPayerContact } from "@/lib/domain/payment/service";
import { evaluateLocationReadiness } from "@/lib/domain/readiness/service";
import { runDueJobs } from "@/lib/jobs/queue";
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

describe("AT01 — New customer", () => {
  it("Sales creates a licensed-location record with minimal entry; verification and provider association stay pending", async () => {
    const { location, similar } = await makeLocation(db, f.sales, f.market.id, "The Corner Tap");
    expect(location.tradeName).toBe("The Corner Tap");
    expect(similar).toHaveLength(0);
    const detail = await getLocation(db, location.id);
    expect(detail?.delivery?.line1).toBe("100 Main St");
    expect(detail?.billing?.id).toBe(detail?.delivery?.id); // reuse: billing same as delivery
    expect(detail?.contacts.map((c) => c.contactRole).sort()).toEqual(["ap", "buyer"]);
    expect(detail?.license?.state).toBe("unverified");
    expect(detail?.payment?.setupState).toBe("not_requested");
    // No preapproval/underwriting: an order can be captured immediately.
    const res = await submitOrder(db, f.sales, { locationId: location.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 3 }] });
    expect(res.order.orderNumber).toMatch(/^NC-\d{6}$/);
    // Audit exists with actor.
    const audits = await db.select().from(schema.auditEvent).where(and(eq(schema.auditEvent.subjectType, "customer_location"), eq(schema.auditEvent.subjectId, location.id)));
    expect(audits.some((a) => a.action === "location.create" && a.actorEmployeeId === f.sales.employeeId)).toBe(true);
  });

  it("Sales outside the market cannot create the location; Driver cannot create at all", async () => {
    await expect(makeLocation(db, f.sales2, f.market.id, "Wrong Market Bar")).rejects.toBeInstanceOf(AuthorizationError);
    await expect(makeLocation(db, f.driver, f.market.id, "Driver Bar")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("provider association is requested, not simulated: reference stays pending while Stripe is not connected", async () => {
    const { location } = await makeLocation(db, f.sales, f.market.id, "Pending Provider Pub");
    await assignPayer(location.id);
    await requestPaymentSetup(db, f.admin, location.id);
    await runDueJobs(db);
    const refs = await db.select().from(schema.providerReference).where(eq(schema.providerReference.subjectId, location.id));
    expect(refs).toHaveLength(1);
    expect(refs[0].status).toBe("pending");
    expect(refs[0].providerId).toBeNull();
    const detail = await getLocation(db, location.id);
    expect(detail?.payment?.setupState).toBe("requested");
    // No repeated customer entry required: re-requesting reuses the same reference.
    await requestPaymentSetup(db, f.admin, location.id);
    const refs2 = await db.select().from(schema.providerReference).where(eq(schema.providerReference.subjectId, location.id));
    expect(refs2).toHaveLength(1);
  });
});

/** Payer authority is an explicit Accounting act (REV-08); tests assign the AP contact deliberately. */
async function assignPayer(locationId: string) {
  const detail = await getLocation(db, locationId);
  const ap = detail!.contacts.find((c) => c.contactRole === "ap") ?? detail!.contacts[0];
  await setPayerContact(db, f.accounting, locationId, ap.contactId, "test: shared AP explicitly authorized");
}

describe("AT02 — Similar-name customer", () => {
  it("two identical trade names remain separate; warning does not reject or merge; shared AP pools nothing", async () => {
    const a = await makeLocation(db, f.sales, f.market.id, "Golden Gate Grill");
    const b = await makeLocation(db, f.sales, f.market.id, "Golden Gate Grill");
    expect(a.location.id).not.toBe(b.location.id);
    expect(b.similar.map((s) => s.id)).toContain(a.location.id); // warned
    const similar = await findSimilarLocations(db, f.market.id, "Golden Gate");
    expect(similar.length).toBeGreaterThanOrEqual(2);
    // Same AP contact reused across both — but payment relationships are per location.
    const da = await getLocation(db, a.location.id);
    const dbb = await getLocation(db, b.location.id);
    const apA = da!.contacts.find((c) => c.contactRole === "ap")!;
    const apB = dbb!.contacts.find((c) => c.contactRole === "ap")!;
    expect(apA.contactId).toBe(apB.contactId); // same person record
    expect(da!.payment!.id).not.toBe(dbb!.payment!.id);
    expect(apA.mayAuthorizePayment).toBe(false);
    // Admin can investigate a suspected duplicate without deleting anything.
    const { case: c } = await flagSuspectedDuplicate(db, f.admin, a.location.id, b.location.id, "Same street, check license");
    expect(c.category).toBe("duplicate_suspected");
    expect((await getLocation(db, a.location.id))?.location.status).toBe("active");
    expect((await getLocation(db, b.location.id))?.location.status).toBe("active");
  });
});

describe("AT03 — Missing license, later verified", () => {
  it("captures account/order before license enrichment; delivery stays unverified until the company records a decision", async () => {
    const { location } = await makeLocation(db, f.sales, f.market.id, "Unlicensed Yet Lounge");
    await submitOrder(db, f.sales, { locationId: location.id, lines: [{ skuId: f.skus.sunlightHalf.id, qty: 1 }] });
    let readiness = await evaluateLocationReadiness(db, location.id);
    expect(readiness.conditions.find((c) => c.code === "license")?.status).toBe("pending");
    expect(readiness.releasable).toBe(false);
    // A "verified" decision without evidence is refused (no false verified status).
    await expect(recordLicenseDecision(db, f.admin, { locationId: location.id, state: "verified" })).rejects.toThrow(/evidence/);
    // Sales cannot verify.
    await expect(recordLicenseDecision(db, f.sales, { locationId: location.id, state: "verified", licenseNumber: "ABC-123" })).rejects.toBeInstanceOf(AuthorizationError);
    await recordLicenseDecision(db, f.admin, { locationId: location.id, state: "verified", licenseNumber: "ABC-123", evidence: "ABC lookup 2026-09-17" });
    readiness = await evaluateLocationReadiness(db, location.id);
    expect(readiness.conditions.find((c) => c.code === "license")?.status).toBe("satisfied");
    // No refresh schedule was invented: only the current decision exists, history retained.
    const history = await db.select().from(schema.licenseVerification).where(eq(schema.licenseVerification.locationId, location.id));
    expect(history).toHaveLength(2);
    expect(history.filter((h) => h.current)).toHaveLength(1);
    // Exception resolved by cause.
    const cases = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `license_unverified:${location.id}`));
    expect(cases[0].state).toBe("resolved");
  });
});

describe("AT04 — First order before ACH setup", () => {
  it("missing setup blocks neither capture nor the first-delivery allowance; no debit path exists", async () => {
    const { location } = await makeLocation(db, f.sales, f.market.id, "First Timer Taproom");
    await recordLicenseDecision(db, f.admin, { locationId: location.id, state: "verified", licenseNumber: "L-1", evidence: "lookup" });
    const res = await submitOrder(db, f.sales, { locationId: location.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 5 }] });
    expect(res.order.demandState).toBe("submitted");
    const readiness = await evaluateLocationReadiness(db, location.id);
    expect(readiness.isFirstDelivery).toBe(true);
    expect(readiness.conditions.find((c) => c.code === "delivery_rule")?.status).toBe("satisfied");
    expect(readiness.releasable).toBe(true);
    // Setup follow-up remains distinct: requesting setup opens its own case and a notice intent, no financial effect.
    await assignPayer(location.id);
    await requestPaymentSetup(db, f.accounting, location.id);
    const notices = await db.select().from(schema.notice).where(eq(schema.notice.subjectId, location.id));
    expect(notices.some((n) => n.purpose === "payment_setup_invitation" && n.state === "manual_pending" && n.intendedSender === "unselected")).toBe(true);
  });
});

describe("Billing-email change requires Admin approval (O06 / AT74)", () => {
  it("Sales requests, Admin approves; past recipients are not rewritten", async () => {
    const { location } = await makeLocation(db, f.sales, f.market.id, "Approval Alehouse");
    const req = await requestBillingEmailChange(db, f.sales, { locationId: location.id, requestedEmail: "newap@example.test" });
    expect(req.state).toBe("pending");
    let detail = await getLocation(db, location.id);
    expect(detail?.contacts.find((c) => c.contactRole === "ap")?.contact.email).toBe("ap@shared-ap.example.test");
    await expect(decideBillingEmailChange(db, f.sales, req.id, "approved")).rejects.toBeInstanceOf(AuthorizationError);
    await decideBillingEmailChange(db, f.admin, req.id, "approved", "confirmed with buyer by phone");
    detail = await getLocation(db, location.id);
    expect(detail?.contacts.find((c) => c.contactRole === "ap")?.contact.email).toBe("newap@example.test");
    const ended = await db.select().from(schema.locationContact).where(and(eq(schema.locationContact.locationId, location.id), eq(schema.locationContact.current, false)));
    expect(ended).toHaveLength(1); // history retained
  });
});
