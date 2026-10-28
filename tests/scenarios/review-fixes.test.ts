import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { recordStockMovement } from "@/lib/domain/allocation/service";
import { editOperational, recordLicenseDecision } from "@/lib/domain/customers/service";
import { provisionEmployee, resolveGoogleSignIn } from "@/lib/domain/employees/service";
import { createHold, grantOverride } from "@/lib/domain/holds/service";
import { adminAmendQuantity, getOrder, submitOrder } from "@/lib/domain/orders/service";
import { evaluateLocationReadiness } from "@/lib/domain/readiness/service";
import { transitionException } from "@/lib/exceptions/service";
import { enqueueJob, registerJobHandler, runDueJobs } from "@/lib/jobs/queue";
import { getPolicy, listDecisions, recordSelection } from "@/lib/policy/policy";
import { createTestDb } from "../support/db";
import { buildFixture, makeEmployee, makeLocation, type Fixture } from "../support/fixtures";

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

describe("Override scope (non-negotiable 9, U09–U11)", () => {
  it("an override covers only the hold it names, only its named order, and never a hold created later", async () => {
    const loc = await verifiedLocation("Override Outpost");
    const h1 = await createHold(db, f.admin, { locationId: loc.id, kind: "admin_manual", cause: "Pause A" });
    const o1 = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 3 }] });
    const o2 = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 3 }] });
    // holdId is mandatory
    await expect(grantOverride(db, f.admin, { locationId: loc.id, holdId: "00000000-0000-0000-0000-000000000000", scope: "x", reason: "x" })).rejects.toThrow(/one active hold/);
    await grantOverride(db, f.admin, { locationId: loc.id, holdId: h1.id, orderId: o1.order.id, scope: `Order ${o1.order.orderNumber}`, reason: "customer confirmed" });
    expect((await evaluateLocationReadiness(db, loc.id, { orderId: o1.order.id })).releasable).toBe(true);
    expect((await evaluateLocationReadiness(db, loc.id, { orderId: o2.order.id })).releasable).toBe(false); // other order
    expect((await evaluateLocationReadiness(db, loc.id)).releasable).toBe(false); // location-level view
    // A hold created AFTER the override is a new cause; the old override cannot pre-clear it.
    await createHold(db, f.admin, { locationId: loc.id, kind: "compliance", cause: "New cause after override" });
    const r = await evaluateLocationReadiness(db, loc.id, { orderId: o1.order.id });
    expect(r.releasable).toBe(false);
    expect(r.conditions.filter((c) => c.code.startsWith("hold:") && c.status === "blocked")).toHaveLength(1);
  });
});

describe("Policy scope and effective dating (§2.2, D33)", () => {
  it("a market-scoped selection does not govern another market; a future-dated selection is not effective yet and the register agrees", async () => {
    await recordSelection(db, f.owner, { decisionId: "D11", kind: "production", selection: { value_basis: "merchandise_only" }, scope: "NC only", marketIds: [f.market.id], effectiveFrom: new Date(0) });
    expect((await getPolicy(db, "D11", { marketId: f.market.id })).status).toBe("selected");
    expect((await getPolicy(db, "D11", { marketId: f.market2.id })).status).toBe("unselected");
    expect((await getPolicy(db, "D11")).status).toBe("unselected"); // market-less question cannot use a market-scoped answer
    // Future-dated change for the same market: current selection stays in force until then.
    const future = new Date(Date.now() + 7 * 86_400_000);
    await recordSelection(db, f.owner, { decisionId: "D11", kind: "production", selection: { value_basis: "merchandise_plus_deposits" }, scope: "NC only, next week", marketIds: [f.market.id], effectiveFrom: future });
    const now = await getPolicy<{ value_basis: string }>(db, "D11", { marketId: f.market.id });
    expect(now.status === "selected" && now.selection.value_basis).toBe("merchandise_only");
    const later = await getPolicy<{ value_basis: string }>(db, "D11", { marketId: f.market.id, now: new Date(future.getTime() + 1000) });
    expect(later.status === "selected" && later.selection.value_basis).toBe("merchandise_plus_deposits");
    const reg = (await listDecisions(db)).find((d) => d.id === "D11")!;
    expect(reg.status).toBe("selected");
    expect(reg.selections).toHaveLength(2);
    // Clean up.
    await db.update(schema.decisionSelection).set({ supersededAt: new Date(0) }).where(eq(schema.decisionSelection.decisionId, "D11"));
  });
});

describe("Jobs: unknown ≠ success (non-negotiable 8)", () => {
  it("a permanently failed job opens an owned exception and does not block a fresh request", async () => {
    let calls = 0;
    registerJobHandler("test.always_fail", async () => {
      calls++;
      throw new Error("provider unreachable");
    });
    const first = await enqueueJob(db, "test.always_fail", {}, { dedupeKey: "test:x", maxAttempts: 1 });
    expect(first.outcome).toBe("queued");
    const dup = await enqueueJob(db, "test.always_fail", {}, { dedupeKey: "test:x", maxAttempts: 1 });
    expect(dup.outcome).toBe("already_active");
    const results = await runDueJobs(db, { limit: 10 });
    expect(results.find((r) => r.kind === "test.always_fail")?.outcome).toBe("failed");
    const cases = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.category, "provider_handoff_failed"));
    expect(cases.length).toBeGreaterThanOrEqual(1);
    // After terminal failure a new request is accepted (active-only dedupe).
    const again = await enqueueJob(db, "test.always_fail", {}, { dedupeKey: "test:x", maxAttempts: 1 });
    expect(again.outcome).toBe("queued");
    expect(calls).toBe(1);
  });

  it("a job stranded in running past its lease is reclaimed", async () => {
    registerJobHandler("test.ok", async () => {});
    const q = await enqueueJob(db, "test.ok", {}, {});
    await db.update(schema.job).set({ status: "running", lockedAt: new Date(Date.now() - 60 * 60_000), lockedBy: "dead-worker" }).where(eq(schema.job.id, q.job.id));
    const results = await runDueJobs(db, { limit: 10 });
    expect(results.find((r) => r.id === q.job.id)?.outcome).toBe("done");
  });
});

describe("Amendment reassesses minimum and shortage (§13)", () => {
  it("reducing an order below $90 opens the below-minimum case; restoring resolves it", async () => {
    const loc = await verifiedLocation("Amend Arms");
    const res = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 5 }] }); // $180
    expect(res.minimum.verdict).toBe("meets");
    await adminAmendQuantity(db, f.admin, res.lines[0].id, 2, "customer reduced"); // $72
    let cases = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `below_minimum:${res.order.id}`));
    expect(cases[0]?.state).toBe("open");
    expect(((await getOrder(db, res.order.id))?.order.minimumEvaluation as { verdict: string }).verdict).toBe("below");
    await adminAmendQuantity(db, f.admin, res.lines[0].id, 4, "customer restored"); // $144, same price → allowed
    cases = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `below_minimum:${res.order.id}`));
    expect(cases[0]?.state).toBe("resolved");
  });
});

describe("Market scope on mutations (§5, O38)", () => {
  it("an Admin scoped to one market cannot record stock in, or manage cases of, another market", async () => {
    const maAdmin = await makeEmployee(db, f.owner, "MA Admin", "ma-admin@example.test", "admin", f.market2.id);
    await expect(recordStockMovement(db, maAdmin, { warehouseId: f.warehouse.id, skuId: f.skus.cantinescaCase.id, kind: "receipt", qtyDelta: 1, evidence: "x" })).rejects.toBeInstanceOf(AuthorizationError);
    const loc = await verifiedLocation("Scoped Saloon");
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.locationId, loc.id));
    await expect(transitionException(db, maAdmin, { caseId: c.id, state: "acknowledged" })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("Sales cannot rename a location's trade or legal name in place (D07); Admin can with a reason", async () => {
    const loc = await verifiedLocation("Rename Roadhouse");
    await expect(editOperational(db, f.sales, loc.id, { tradeName: "Different Name" })).rejects.toBeInstanceOf(AuthorizationError);
    await editOperational(db, f.sales, loc.id, { deliveryInstructions: "ring bell" }); // operational detail is fine
    await expect(editOperational(db, f.admin, loc.id, { tradeName: "Different Name" })).rejects.toThrow(/reason/);
    const row = await editOperational(db, f.admin, loc.id, { tradeName: "Different Name" }, "Signage changed; same operator and premises");
    expect(row.tradeName).toBe("Different Name");
  });
});

describe("Identity integrity (AT61 hardening)", () => {
  it("refuses provisioning a second employee on an email that is another employee's current identity, and audits a Google-side rename", async () => {
    await provisionEmployee(db, f.admin, { displayName: "One", email: "same@leopardmark.test", grants: [] });
    await expect(provisionEmployee(db, f.admin, { displayName: "Two", email: "same@leopardmark.test", grants: [] })).rejects.toThrow(/current identity of another employee/);
    const first = await resolveGoogleSignIn(db, { subject: "google-one", email: "same@leopardmark.test", emailVerified: true });
    expect(first.outcome).toBe("ok");
    const renamed = await resolveGoogleSignIn(db, { subject: "google-one", email: "one.renamed@leopardmark.test", emailVerified: true });
    expect(renamed.outcome).toBe("ok");
    const ids = await db.select().from(schema.employeeIdentity).where(eq(schema.employeeIdentity.employeeId, (first as { employeeId: string }).employeeId));
    expect(ids.filter((i) => i.current)).toHaveLength(1);
    expect(ids.find((i) => i.current)?.email).toBe("one.renamed@leopardmark.test");
    const audit = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.action, "employee.email_rename_observed"));
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});
