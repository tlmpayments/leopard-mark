import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIONS } from "@/lib/authz/actions";
import { AuthorizationError, can } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { loadActor, provisionEmployee, recordEmailRename, resolveGoogleSignIn, revokeGrant, setEmployeeEnabled } from "@/lib/domain/employees/service";
import { submitOrder } from "@/lib/domain/orders/service";
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

describe("AT61 — Employee email rename", () => {
  it("first sign-in binds the Google subject to the provisioned email; rename keeps the same employee; a re-used email is a different person and inherits nothing", async () => {
    const { employee } = await provisionEmployee(db, f.admin, { displayName: "Ren Rep", email: "ren@leopardmark.test", grants: [{ role: "sales", marketId: f.market.id }] });
    // Unprovisioned account is refused; nothing is auto-created.
    const stranger = await resolveGoogleSignIn(db, { subject: "google-stranger", email: "stranger@leopardmark.test", emailVerified: true });
    expect(stranger.outcome).toBe("refused");
    // First sign-in binds subject.
    const first = await resolveGoogleSignIn(db, { subject: "google-ren", email: "ren@leopardmark.test", emailVerified: true });
    expect(first).toMatchObject({ outcome: "ok", employeeId: employee.id });
    // Google email rename (same subject) → same employee, history intact.
    await recordEmailRename(db, f.admin, employee.id, "renata@leopardmark.test");
    const renamed = await resolveGoogleSignIn(db, { subject: "google-ren", email: "renata@leopardmark.test", emailVerified: true });
    expect(renamed).toMatchObject({ outcome: "ok", employeeId: employee.id });
    const actor = await loadActor(db, employee.id);
    expect(actor?.grants).toEqual([{ role: "sales", marketId: f.market.id }]);
    // Old address re-used by a NEW Google account (different subject): refused — no inherited grants or audit identity.
    const reuse = await resolveGoogleSignIn(db, { subject: "google-newperson", email: "ren@leopardmark.test", emailVerified: true });
    expect(reuse.outcome).toBe("refused");
    // Provision the new person separately → new employee id, no grants inherited.
    const { employee: other } = await provisionEmployee(db, f.admin, { displayName: "New Ren", email: "ren@leopardmark.test", grants: [] });
    const bound = await resolveGoogleSignIn(db, { subject: "google-newperson", email: "ren@leopardmark.test", emailVerified: true });
    expect(bound).toMatchObject({ outcome: "ok", employeeId: other.id });
    expect(other.id).not.toBe(employee.id);
    expect((await loadActor(db, other.id))?.grants).toEqual([]);
  });
});

describe("AT62 — Disable signed-in employee", () => {
  it("effective internal disable stops business use on the next request; a stale grant/enable signal cannot restore it; revoked grants stay revoked", async () => {
    const { employee } = await provisionEmployee(db, f.admin, { displayName: "Dan Departing", email: "dan@leopardmark.test", grants: [{ role: "sales", marketId: f.market.id }] });
    await resolveGoogleSignIn(db, { subject: "google-dan", email: "dan@leopardmark.test", emailVerified: true });
    const dan = (await loadActor(db, employee.id))!;
    const { location } = await makeLocation(db, dan, f.market.id, "Dan's Last Account");
    // Session cookie still exists (dan actor object in hand); Admin disables.
    await setEmployeeEnabled(db, f.admin, employee.id, false, "Left the company");
    // The next request re-loads the actor from the database → null (no business use).
    expect(await loadActor(db, employee.id)).toBeNull();
    // Google sign-in cannot restore it.
    const again = await resolveGoogleSignIn(db, { subject: "google-dan", email: "dan@leopardmark.test", emailVerified: true });
    expect(again.outcome).toBe("refused");
    // A stale enablement path (grant insert) doesn't matter: the employee row is disabled.
    await db.insert(schema.roleGrant).values({ employeeId: employee.id, role: "admin", marketId: null });
    expect(await loadActor(db, employee.id)).toBeNull();
    // Audit retains prior/current and reason.
    const audits = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.subjectId, employee.id));
    const disable = audits.find((a) => a.action === "employee.disable");
    expect(disable?.reason).toBe("Left the company");
    expect(disable?.prior).toEqual({ enabled: true });
    expect(disable?.current).toEqual({ enabled: false });
    // History Dan created remains attributed to Dan.
    const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, location.id));
    expect(loc.createdByEmployeeId).toBe(employee.id);
    // Re-enable then revoke a grant: revocation is a fact, never a delete.
    await setEmployeeEnabled(db, f.admin, employee.id, true, "Returned");
    const grants = await db.select().from(schema.roleGrant).where(eq(schema.roleGrant.employeeId, employee.id));
    const salesGrant = grants.find((g) => g.role === "sales")!;
    await revokeGrant(db, f.admin, salesGrant.id, "Moved to accounting");
    const after = (await loadActor(db, employee.id))!;
    expect(after.grants.some((g) => g.role === "sales")).toBe(false);
    expect((await db.select().from(schema.roleGrant).where(eq(schema.roleGrant.id, salesGrant.id)))[0].revokedAt).not.toBeNull();
    // Self-disable is refused.
    await expect(setEmployeeEnabled(db, f.admin, f.admin.employeeId!, false, "oops")).rejects.toThrow(/own access/);
  });
});

describe("Five roles and confirmed powers (brief §5, AT80)", () => {
  it("Owner can do everything; Sales/Driver cannot issue credits, override holds, approve billing email, manage prices or access; market scope applies", () => {
    for (const action of Object.keys(ACTIONS) as Array<keyof typeof ACTIONS>) {
      expect(can(f.owner, action)).toBe(true);
    }
    expect(can(f.sales, "credit.issue")).toBe(false);
    expect(can(f.sales, "hold.override")).toBe(false);
    expect(can(f.sales, "location.billing_email.approve")).toBe(false);
    expect(can(f.sales, "price.manage")).toBe(false);
    expect(can(f.sales, "employee.manage")).toBe(false);
    expect(can(f.sales, "decision.select_production")).toBe(false);
    expect(can(f.admin, "decision.select_production")).toBe(false); // Owner selects policy
    expect(can(f.driver, "order.submit")).toBe(false);
    expect(can(f.driver, "finance.view")).toBe(false);
    expect(can(f.accounting, "credit.issue")).toBe(false); // R2-14: Owner or back office only
    expect(can(f.admin, "credit.issue")).toBe(true);
    expect(can(f.driver, "shipment.deliver")).toBe(true); // R2-38: own assigned stops, enforced by the service
    expect(can(f.sales, "credit.request")).toBe(true);
    expect(can(f.sales, "order.submit", { marketId: f.market.id })).toBe(true);
    expect(can(f.sales, "order.submit", { marketId: f.market2.id })).toBe(false);
    expect(can(f.admin, "order.submit", { marketId: f.market2.id })).toBe(true); // market-wide grant
  });

  it("an unauthorized Sales rep in another market cannot submit demand there", async () => {
    const { location } = await makeLocation(db, f.sales, f.market.id, "Scope Saloon");
    await expect(submitOrder(db, f.sales2, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: location.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] })).rejects.toBeInstanceOf(AuthorizationError);
  });
});
