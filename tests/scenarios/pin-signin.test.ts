import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PIN_LOCK_AFTER, PIN_LOCK_BASE_MS, generatePin, hashPin, lockoutMs, validatePinPolicy, verifyPin } from "@/lib/auth/pin";
import { AuthorizationError } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { changeOwnPin, credentialIsCurrent, currentCredential, setEmployeePin, signInWithPin } from "@/lib/domain/employees/credentials";
import { loadActorForSession, offboardEmployee, provisionEmployee, setEmployeeEnabled } from "@/lib/domain/employees/service";
import { BusinessError } from "@/lib/errors";
import { createTestDb } from "../support/db";
import { buildFixture, makeEmployee, type Fixture } from "../support/fixtures";

/**
 * Company email + PIN sign-in (replaces Google as the normal method; the
 * internal authorization model is untouched). Covers: PIN policy and hashing,
 * sign-in outcomes, lockout, disablement after a correct PIN, temporary PINs
 * that must be changed, who may set another person's PIN, own-PIN change,
 * sessions dying on reset/change/offboarding, and the audit trail never
 * carrying a PIN.
 */
let db: Db;
let close: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
});
afterAll(async () => close());

describe("PIN policy and hashing", () => {
  it("accepts 6–12 digits and refuses trivial patterns; hashes are salted scrypt and verify in constant time", async () => {
    for (const bad of ["12345", "1234567890123", "abcdef", "111111", "123456", "654321", "0123456789", "121212", "9876543"]) {
      expect(() => validatePinPolicy(bad), bad).toThrow(BusinessError);
    }
    for (const ok of ["135790", "482157", "20481024", "907315"]) expect(() => validatePinPolicy(ok)).not.toThrow();
    const h1 = await hashPin("482157");
    const h2 = await hashPin("482157");
    expect(h1).not.toBe(h2);
    expect(h1.startsWith("scrypt$")).toBe(true);
    expect(h1).not.toContain("482157");
    expect(await verifyPin("482157", h1)).toBe(true);
    expect(await verifyPin("482158", h1)).toBe(false);
    expect(await verifyPin("482157", "not-a-hash")).toBe(false);
    for (let i = 0; i < 20; i++) expect(() => validatePinPolicy(generatePin(8))).not.toThrow();
    expect(lockoutMs(PIN_LOCK_AFTER - 1)).toBe(0);
    expect(lockoutMs(PIN_LOCK_AFTER)).toBe(PIN_LOCK_BASE_MS);
    expect(lockoutMs(PIN_LOCK_AFTER + 1)).toBe(PIN_LOCK_BASE_MS * 2);
    expect(lockoutMs(PIN_LOCK_AFTER + 20)).toBe(24 * 3_600_000);
  });
});

describe("Sign-in with email + PIN", () => {
  it("signs in a provisioned, enabled employee with the right PIN; wrong PIN, unknown email and missing PIN all read the same; nothing is created", async () => {
    const rep = await makeEmployee(db, f.owner, "Pat PIN", "pat@example.test", "sales", f.market.id);
    expect((await signInWithPin(db, { email: "pat@example.test", pin: "907315" })).outcome).toBe("refused"); // no PIN yet
    await setEmployeePin(db, f.admin, rep.employeeId!, "907315", { reason: "onboarding" });
    const ok = await signInWithPin(db, { email: "PAT@example.test ", pin: "907315" });
    expect(ok.outcome).toBe("ok");
    if (ok.outcome !== "ok") return;
    expect(ok.employeeId).toBe(rep.employeeId);
    expect(ok.mustChange).toBe(true);
    const wrong = await signInWithPin(db, { email: "pat@example.test", pin: "907316" });
    const unknown = await signInWithPin(db, { email: "nobody@example.test", pin: "907315" });
    const empty = await signInWithPin(db, { email: "pat@example.test", pin: "" });
    expect([wrong, unknown, empty].map((r) => r.outcome === "refused" && r.reason)).toEqual(["unknown", "unknown", "unknown"]);
    const employees = await db.select().from(schema.employee);
    expect(employees.some((e) => e.displayName.includes("nobody"))).toBe(false);
    // Audit: sign-in and refusals recorded; no PIN value anywhere in the audit table.
    const audits = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.subjectId, rep.employeeId!));
    expect(audits.some((a) => a.action === "auth.sign_in")).toBe(true);
    expect(audits.some((a) => a.action === "auth.refused")).toBe(true);
    expect(JSON.stringify(audits)).not.toContain("907315");
    expect(JSON.stringify(audits)).not.toContain("907316");
  });

  it("locks after five failures (15 min, doubling), tells the person it is locked, and a correct PIN resets the counter after the lock expires", async () => {
    const rep = await makeEmployee(db, f.owner, "Lou Lock", "lou@example.test", "sales", f.market.id);
    await setEmployeePin(db, f.owner, rep.employeeId!, "482157", { reason: "onboarding", mustChange: false });
    for (let i = 0; i < PIN_LOCK_AFTER; i++) expect((await signInWithPin(db, { email: "lou@example.test", pin: "000001" })).outcome).toBe("refused");
    const locked = await signInWithPin(db, { email: "lou@example.test", pin: "482157" }); // right PIN, but locked
    expect(locked.outcome === "refused" && locked.reason).toBe("locked");
    expect(locked.outcome === "refused" && (locked.retryAfterMs ?? 0)).toBeGreaterThan(14 * 60_000);
    // Simulate the lock expiring, then sign in normally; the counter is reset.
    const cred = (await currentCredential(db, rep.employeeId!))!;
    expect(cred.failedAttempts).toBe(PIN_LOCK_AFTER);
    await db.update(schema.employeeCredential).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(schema.employeeCredential.id, cred.id));
    expect((await signInWithPin(db, { email: "lou@example.test", pin: "482157" })).outcome).toBe("ok");
    expect((await currentCredential(db, rep.employeeId!))!.failedAttempts).toBe(0);
  });

  it("a disabled employee is refused even with the right PIN (after the PIN proved the person); re-enabling restores sign-in", async () => {
    const rep = await makeEmployee(db, f.owner, "Dee Disabled", "dee-pin@example.test", "sales", f.market.id);
    await setEmployeePin(db, f.owner, rep.employeeId!, "907315", { reason: "onboarding", mustChange: false });
    await setEmployeeEnabled(db, f.admin, rep.employeeId!, false, "left the company");
    const r = await signInWithPin(db, { email: "dee-pin@example.test", pin: "907315" });
    expect(r.outcome === "refused" && r.reason).toBe("disabled");
    expect((await signInWithPin(db, { email: "dee-pin@example.test", pin: "000001" })).outcome === "refused").toBe(true); // wrong PIN never reveals disablement
    await setEmployeeEnabled(db, f.admin, rep.employeeId!, true, "back");
    expect((await signInWithPin(db, { email: "dee-pin@example.test", pin: "907315" })).outcome).toBe("ok");
  });
});

describe("Temporary PINs, own-PIN change and session binding", () => {
  it("a temporary PIN must be changed; changing it needs the current PIN and a policy-valid new one; the old credential ends and sessions bound to it stop", async () => {
    const rep = await makeEmployee(db, f.owner, "Cam Change", "cam@example.test", "sales", f.market.id);
    await setEmployeePin(db, f.admin, rep.employeeId!, "482157", { reason: "onboarding" });
    const first = await signInWithPin(db, { email: "cam@example.test", pin: "482157" });
    expect(first.outcome === "ok" && first.mustChange).toBe(true);
    const credId = first.outcome === "ok" ? first.credentialId : "";
    const identityId = first.outcome === "ok" ? first.identityId : "";
    expect(await loadActorForSession(db, rep.employeeId!, identityId, "employee", credId)).not.toBeNull();
    await expect(changeOwnPin(db, rep, { currentPin: "000000", newPin: "907315", confirmPin: "907315" })).rejects.toThrow(/current PIN is not correct/);
    await expect(changeOwnPin(db, rep, { currentPin: "482157", newPin: "123456", confirmPin: "123456" })).rejects.toThrow(/straight run/);
    await expect(changeOwnPin(db, rep, { currentPin: "482157", newPin: "907315", confirmPin: "907316" })).rejects.toThrow(/differ/);
    await expect(changeOwnPin(db, rep, { currentPin: "482157", newPin: "482157", confirmPin: "482157" })).rejects.toThrow(/different from the current/);
    const next = await changeOwnPin(db, rep, { currentPin: "482157", newPin: "907315", confirmPin: "907315" });
    expect(next.mustChange).toBe(false);
    // The session issued against the temporary credential is dead; a new sign-in uses the new PIN only.
    expect(await loadActorForSession(db, rep.employeeId!, identityId, "employee", credId)).toBeNull();
    expect(await credentialIsCurrent(db, next.id, rep.employeeId!)).toBe(true);
    expect((await signInWithPin(db, { email: "cam@example.test", pin: "482157" })).outcome).toBe("refused");
    const again = await signInWithPin(db, { email: "cam@example.test", pin: "907315" });
    expect(again.outcome === "ok" && again.mustChange).toBe(false);
    // History: both credential rows exist, the first ended as "changed".
    const rows = await db.select().from(schema.employeeCredential).where(eq(schema.employeeCredential.employeeId, rep.employeeId!));
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === credId)?.endedReason).toBe("changed");
    // Fixture/Google sessions carry no credential and are unaffected by the credential check.
    expect(await loadActorForSession(db, rep.employeeId!, identityId, "dev_fixture")).not.toBeNull();
  });

  it("who may set another person's PIN: Owner anyone; Admin only non-Owners inside its markets; nobody their own; a reset ends sessions", async () => {
    const ncAdmin = await makeEmployee(db, f.owner, "Nia NC-Admin", "nia-pin@example.test", "admin", f.market.id);
    const ncRep = await makeEmployee(db, f.owner, "Rep NC", "repnc-pin@example.test", "sales", f.market.id);
    const maRep = await makeEmployee(db, f.owner, "Rep MA", "repma-pin@example.test", "sales", f.market2.id);
    await expect(setEmployeePin(db, ncAdmin, f.owner.employeeId!, "907315", { reason: "x" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(setEmployeePin(db, ncAdmin, maRep.employeeId!, "907315", { reason: "x" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(setEmployeePin(db, ncAdmin, ncAdmin.employeeId!, "907315", { reason: "x" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(setEmployeePin(db, f.sales, ncRep.employeeId!, "907315", { reason: "x" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(setEmployeePin(db, ncAdmin, ncRep.employeeId!, "111111", { reason: "x" })).rejects.toThrow(/repeated digit/);
    await setEmployeePin(db, ncAdmin, ncRep.employeeId!, "907315", { reason: "onboarding" });
    await setEmployeePin(db, f.owner, ncAdmin.employeeId!, "907315", { reason: "owner sets admin" });
    await setEmployeePin(db, f.owner, f.admin.employeeId!, "907315", { reason: "owner sets global admin" });
    const s = await signInWithPin(db, { email: "repnc-pin@example.test", pin: "907315" });
    const credId = s.outcome === "ok" ? s.credentialId : "";
    const identityId = s.outcome === "ok" ? s.identityId : "";
    expect(await loadActorForSession(db, ncRep.employeeId!, identityId, "employee", credId)).not.toBeNull();
    await setEmployeePin(db, f.owner, ncRep.employeeId!, "482157", { reason: "forgot PIN" });
    expect(await loadActorForSession(db, ncRep.employeeId!, identityId, "employee", credId)).toBeNull();
    const [ended] = await db.select().from(schema.employeeCredential).where(eq(schema.employeeCredential.id, credId));
    expect(ended.current).toBe(false);
    expect(ended.endedReason).toBe("reset");
  });

  it("offboarding ends the credential; a new person provisioned on the same email signs in only with their own PIN", async () => {
    const old = await makeEmployee(db, f.owner, "Old Lee", "lee-pin@example.test", "sales", f.market.id);
    await setEmployeePin(db, f.owner, old.employeeId!, "907315", { reason: "onboarding", mustChange: false });
    expect((await signInWithPin(db, { email: "lee-pin@example.test", pin: "907315" })).outcome).toBe("ok");
    await offboardEmployee(db, f.owner, old.employeeId!, "left");
    expect((await signInWithPin(db, { email: "lee-pin@example.test", pin: "907315" })).outcome).toBe("refused");
    const fresh = await provisionEmployee(db, f.owner, { displayName: "New Lee", email: "lee-pin@example.test", grants: [{ role: "sales", marketId: f.market.id }] });
    expect((await signInWithPin(db, { email: "lee-pin@example.test", pin: "907315" })).outcome).toBe("refused"); // old PIN does not carry over
    await setEmployeePin(db, f.owner, fresh.employee.id, "482157", { reason: "onboarding" });
    const r = await signInWithPin(db, { email: "lee-pin@example.test", pin: "482157" });
    expect(r.outcome === "ok" && r.employeeId).toBe(fresh.employee.id);
    const [oldCred] = await db
      .select()
      .from(schema.employeeCredential)
      .where(and(eq(schema.employeeCredential.employeeId, old.employeeId!), eq(schema.employeeCredential.current, false)));
    expect(oldCred.endedReason).toBe("offboarded");
  });
});
