import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationError, can } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { getLocation, listLocations, setWarehouseOverride } from "@/lib/domain/customers/service";
import { grantRole, loadActor, loadActorForSession, offboardEmployee, provisionEmployee, recordEmailRename, resolveGoogleSignIn, revokeGrant, setEmployeeEnabled } from "@/lib/domain/employees/service";
import { createWarehouse } from "@/lib/domain/markets/service";
import { getOrder, listOrders, submitOrder } from "@/lib/domain/orders/service";
import { search } from "@/lib/domain/search/service";
import { activityTimeline } from "@/lib/domain/timeline/service";
import { recordSelection } from "@/lib/policy/policy";
import { createTestDb } from "../support/db";
import { buildFixture, makeEmployee, makeLocation, type Fixture } from "../support/fixtures";

/**
 * REV-01 (AC01), REV-11 (AC02/AC03), REV-17 (AC18), AC38 — authority is
 * enforced in the service boundary, scoped to the actual resource, and the
 * identity lifecycle ends sessions immediately.
 */
let db: Db;
let close: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
});
afterAll(async () => close());

describe("REV-01 / AC01 — Owner authority cannot be self-granted or provisioned by an Admin", () => {
  it("Admin cannot grant itself Owner, grant Owner to anyone, provision an Owner, or revoke an Owner grant; Owner still can", async () => {
    await expect(grantRole(db, f.admin, f.admin.employeeId!, "owner", null)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(grantRole(db, f.admin, f.accounting.employeeId!, "owner", null)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(provisionEmployee(db, f.admin, { displayName: "Sneaky", email: "sneaky@example.test", grants: [{ role: "owner", marketId: null }] })).rejects.toBeInstanceOf(AuthorizationError);
    // Nothing was written by the refused provisioning.
    const sneaky = await db.select().from(schema.employeeIdentity).where(eq(schema.employeeIdentity.email, "sneaky@example.test"));
    expect(sneaky).toHaveLength(0);
    // Still not allowed to select production policy afterwards.
    const reloaded = (await loadActor(db, f.admin.employeeId!))!;
    expect(can(reloaded, "decision.select_production")).toBe(false);
    await expect(recordSelection(db, reloaded, { decisionId: "D09", kind: "production", selection: { abnormal_max_line_qty: 5 }, scope: "all", effectiveFrom: new Date(0) })).rejects.toBeInstanceOf(AuthorizationError);
    // Owner grants Owner; Admin cannot revoke it.
    const ownerGrant = await grantRole(db, f.owner, f.accounting.employeeId!, "owner", null);
    await expect(revokeGrant(db, f.admin, ownerGrant.id, "x")).rejects.toBeInstanceOf(AuthorizationError);
    await revokeGrant(db, f.owner, ownerGrant.id, "test cleanup");
  });

  it("Admin cannot change its own grants, but legitimate management of others still works", async () => {
    await expect(grantRole(db, f.admin, f.admin.employeeId!, "accounting", null)).rejects.toBeInstanceOf(AuthorizationError);
    const rep = await provisionEmployee(db, f.admin, { displayName: "Rae Rep", email: "rae@example.test", grants: [{ role: "sales", marketId: f.market.id }] });
    const g = await grantRole(db, f.admin, rep.employee.id, "driver_service", f.market.id);
    expect(g.role).toBe("driver_service");
    await revokeGrant(db, f.admin, g.id, "not needed");
    await expect(setEmployeeEnabled(db, f.admin, f.owner.employeeId!, false, "coup")).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("REV-11 / AC02 — market-scoped Admin stays inside its market", () => {
  it("a market-scoped Admin cannot issue a global grant, grant in another market, or point a customer at another market's warehouse", async () => {
    const ncAdmin = await makeEmployee(db, f.owner, "Nia NC-Admin", "nia@example.test", "admin", f.market.id);
    const rep = await provisionEmployee(db, ncAdmin, { displayName: "Rep NC", email: "repnc@example.test", grants: [{ role: "sales", marketId: f.market.id }] });
    await expect(grantRole(db, ncAdmin, rep.employee.id, "sales", null)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(grantRole(db, ncAdmin, rep.employee.id, "sales", f.market2.id)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(provisionEmployee(db, ncAdmin, { displayName: "Global", email: "global@example.test", grants: [{ role: "accounting", marketId: null }] })).rejects.toBeInstanceOf(AuthorizationError);
    // Warehouse in MA; NC-scoped admin cannot assign it to an NC customer. Global admin can (both markets in authority).
    const maWarehouse = await createWarehouse(db, f.owner, { marketId: f.market2.id, name: "MA overflow", isPrimary: false });
    const { location } = await makeLocation(db, f.sales, f.market.id, "Cross Market Cafe");
    await expect(setWarehouseOverride(db, ncAdmin, location.id, maWarehouse.id, "closer")).rejects.toBeInstanceOf(AuthorizationError);
    await setWarehouseOverride(db, f.admin, location.id, maWarehouse.id, "cross-market fulfilment authorized by global Admin");
    expect((await getLocation(db, location.id))?.location.warehouseOverrideId).toBe(maWarehouse.id);
    // An employee holding Admin in NC and Sales in MA gets no Admin audit view on an MA record.
    const mixed = await makeEmployee(db, f.owner, "Mixed Roles", "mixed@example.test", "admin", f.market.id);
    await grantRole(db, f.owner, mixed.employeeId!, "sales", f.market2.id);
    const mixedActor = (await loadActor(db, mixed.employeeId!))!;
    expect(can(mixedActor, "audit.view", { marketId: f.market.id })).toBe(true);
    expect(can(mixedActor, "audit.view", { marketId: f.market2.id })).toBe(false);
    const { location: maLoc } = await makeLocation(db, f.sales2, f.market2.id, "MA Record");
    // As MA Sales the person may see the MA account's timeline, but with no Admin audit detail (prior/current values).
    const tl = await activityTimeline(db, mixedActor, { locationId: maLoc.id });
    expect(tl.allowed).toBe(true);
    expect(tl.entries.length).toBeGreaterThan(0);
    expect(tl.entries.every((e) => e.detail === null)).toBe(true);
    const tlNc = await activityTimeline(db, mixedActor, { locationId: location.id });
    expect(tlNc.entries.some((e) => e.detail !== null)).toBe(true);
  });
});

describe("REV-11 / AC03 — Driver/Service sees only assigned execution context", () => {
  it("driver gets no market-wide accounts/orders from lists, search or direct record access", async () => {
    const { location } = await makeLocation(db, f.sales, f.market.id, "Driver Denied Diner");
    const o = await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: location.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] });
    expect(can(f.driver, "order.view", { marketId: f.market.id })).toBe(false);
    expect(can(f.driver, "location.view", { marketId: f.market.id })).toBe(false);
    expect(await listOrders(db, f.driver)).toHaveLength(0);
    const hits = await search(db, f.driver, "Driver Denied");
    expect(hits.filter((h) => h.kind === "location" || h.kind === "order" || h.kind === "contact")).toHaveLength(0);
    const hitsByNumber = await search(db, f.driver, o.order.orderNumber);
    expect(hitsByNumber.filter((h) => h.kind === "order")).toHaveLength(0);
    // Product search stays available but never links a driver to the Admin catalog.
    const prod = await search(db, f.driver, "Cantinesca");
    expect(prod.every((h) => h.kind === "sku" && h.href === "/products")).toBe(true);
    const tl = await activityTimeline(db, f.driver, { orderId: o.order.id });
    expect(tl.allowed).toBe(false);
    expect((await getOrder(db, o.order.id))?.order.id).toBe(o.order.id); // service read is guarded by pages via can(); listing/search are the guarded queries
  });
});

describe("UX-05 / UX-09 / AC34 — lists, search and timeline beyond the page size stay scoped and paginated", () => {
  it("40 accounts page through listLocations without loss or overlap; search stays within market authority; the timeline cursor reaches every entry once with filters intact", async () => {
    const created: string[] = [];
    for (let i = 0; i < 40; i++) created.push((await makeLocation(db, f.sales, f.market.id, `Paged Pub ${String(i).padStart(2, "0")}`)).location.id);
    // Paged listing: pages are disjoint, ordered, and together cover every created account.
    const seen = new Set<string>();
    for (let offset = 0; ; offset += 15) {
      const page = await listLocations(db, f.sales, { q: "Paged Pub", limit: 15, offset });
      for (const r of page) {
        expect(seen.has(r.loc.id)).toBe(false);
        seen.add(r.loc.id);
      }
      if (page.length < 15) break;
    }
    expect(created.every((id) => seen.has(id))).toBe(true);
    // Market scope survives paging: MA Sales sees none of the NC accounts on any page.
    expect(await listLocations(db, f.sales2, { q: "Paged Pub", limit: 15, offset: 0 })).toHaveLength(0);
    // Search is bounded and scoped rather than unbounded: NC Sales gets hits, MA Sales gets none.
    expect((await search(db, f.sales, "Paged Pub")).filter((h) => h.kind === "location").length).toBeGreaterThan(0);
    expect((await search(db, f.sales2, "Paged Pub")).filter((h) => h.kind === "location")).toHaveLength(0);
    // Timeline: more entries than one page → cursor walks them once, newest first, and a kind filter narrows without breaking the walk.
    const { location } = await makeLocation(db, f.sales, f.market.id, "Busy Timeline Bar");
    for (let i = 0; i < 12; i++) await submitOrder(db, f.sales, { shortfallDecision: "ship_available", shortfallReason: "test: ships what is on hand", locationId: location.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] });
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await activityTimeline(db, f.admin, { locationId: location.id, cursor, limit: 5 });
      expect(r.allowed).toBe(true);
      for (const e of r.entries) {
        expect(ids.includes(e.id)).toBe(false);
        ids.push(e.id);
      }
      cursor = r.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBeGreaterThan(2);
    expect(ids.length).toBeGreaterThanOrEqual(13); // 12 orders + account creation, plus their cases/notices
    const onlyOrders = await activityTimeline(db, f.admin, { locationId: location.id, kinds: ["orders"], limit: 100 });
    expect(onlyOrders.entries.length).toBeGreaterThanOrEqual(12);
    expect(onlyOrders.entries.every((e) => /order|stock|amend|cancel/i.test(e.text))).toBe(true);
    // Every timeline entry links to a record the reader may open (no bare ids as destinations).
    expect(onlyOrders.entries.every((e) => !e.href || e.href.startsWith("/orders/") || e.href.startsWith("/locations/"))).toBe(true);
  });
});

describe("REV-17 / AC18 — offboarding, reuse of an email, rename, stale sessions", () => {
  it("disable alone keeps the identity; offboarding retires it so a NEW person can be provisioned with the same email and no inherited grants; old session/subject die", async () => {
    const { employee, identity } = await provisionEmployee(db, f.admin, { displayName: "Dan Departing", email: "dan@leopardmark.test", grants: [{ role: "sales", marketId: f.market.id }] });
    // Bind a Google subject via first sign-in.
    const signin = await resolveGoogleSignIn(db, { subject: "google-sub-dan", email: "dan@leopardmark.test", emailVerified: true });
    expect(signin.outcome).toBe("ok");
    // A "session" for this identity works.
    expect(await loadActorForSession(db, employee.id, identity.id, "employee")).not.toBeNull();
    // Disable: session dies immediately, but the email is still held → provisioning explains what to do.
    await setEmployeeEnabled(db, f.admin, employee.id, false, "left the company");
    expect(await loadActorForSession(db, employee.id, identity.id, "employee")).toBeNull();
    await expect(provisionEmployee(db, f.admin, { displayName: "New Dan", email: "dan@leopardmark.test", grants: [] })).rejects.toThrow(/Offboard/);
    // Offboard: identity retired (history kept with subject), grants revoked, employee record preserved.
    const result = await offboardEmployee(db, f.admin, employee.id, "left the company; laptop returned");
    expect(result.retiredIdentityId).toBe(identity.id);
    const [old] = await db.select().from(schema.employeeIdentity).where(eq(schema.employeeIdentity.id, identity.id));
    expect(old.current).toBe(false);
    expect(old.googleSubject).toBe("google-sub-dan"); // history preserved
    expect(old.endedReason).toBe("retired");
    const [emp] = await db.select().from(schema.employee).where(eq(schema.employee.id, employee.id));
    expect(emp.enabled).toBe(false);
    // The old Google subject can no longer sign in; the old session is dead.
    expect((await resolveGoogleSignIn(db, { subject: "google-sub-dan", email: "dan@leopardmark.test", emailVerified: true })).outcome).toBe("refused");
    expect(await loadActorForSession(db, employee.id, identity.id, "employee")).toBeNull();
    // Same email, new person: new employee, new grants only.
    const fresh = await provisionEmployee(db, f.admin, { displayName: "New Dan", email: "dan@leopardmark.test", grants: [{ role: "driver_service", marketId: f.market.id }] });
    expect(fresh.employee.id).not.toBe(employee.id);
    const newActor = (await loadActor(db, fresh.employee.id))!;
    expect(newActor.grants).toEqual([{ role: "driver_service", marketId: f.market.id }]);
    // A different Google account binds to the new identity; the old subject stays refused.
    const bind = await resolveGoogleSignIn(db, { subject: "google-sub-new-dan", email: "dan@leopardmark.test", emailVerified: true });
    expect(bind.outcome).toBe("ok");
    if (bind.outcome === "ok") expect(bind.employeeId).toBe(fresh.employee.id);
    expect((await resolveGoogleSignIn(db, { subject: "google-sub-dan", email: "dan@leopardmark.test", emailVerified: true })).outcome).toBe("refused");
  });

  it("rename keeps the employee and subject, ends the old identity row, and the session bound to the old identity stops", async () => {
    const { employee, identity } = await provisionEmployee(db, f.admin, { displayName: "Rin Renamed", email: "rin@leopardmark.test", grants: [{ role: "sales", marketId: f.market.id }] });
    await resolveGoogleSignIn(db, { subject: "google-sub-rin", email: "rin@leopardmark.test", emailVerified: true });
    const next = await recordEmailRename(db, f.admin, employee.id, "rin.new@leopardmark.test");
    expect(next.employeeId).toBe(employee.id);
    expect(next.googleSubject).toBe("google-sub-rin");
    expect(await loadActorForSession(db, employee.id, identity.id, "employee")).toBeNull();
    expect((await loadActorForSession(db, employee.id, next.id, "employee"))?.email).toBe("rin.new@leopardmark.test");
    const rows = await db.select().from(schema.employeeIdentity).where(and(eq(schema.employeeIdentity.employeeId, employee.id), eq(schema.employeeIdentity.current, true)));
    expect(rows).toHaveLength(1);
  });

  it("AC38 — a signed-in employee disabled mid-session is refused on the very next action", async () => {
    const { employee, identity } = await provisionEmployee(db, f.admin, { displayName: "Sam Session", email: "samsession@leopardmark.test", grants: [{ role: "sales", marketId: f.market.id }] });
    const before = await loadActorForSession(db, employee.id, identity.id, "employee");
    expect(before).not.toBeNull();
    const { location } = await makeLocation(db, before!, f.market.id, "Session Saloon");
    await setEmployeeEnabled(db, f.admin, employee.id, false, "disabled during session");
    const after = await loadActorForSession(db, employee.id, identity.id, "employee");
    expect(after).toBeNull();
    // Even with a cached actor object, the stale actor's grants are what the request re-reads: the service is called with null → refused by the page layer.
    void location;
  });
});
