import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { SYSTEM_ACTOR, hasRole, type Actor } from "@/lib/authz/actor";
import { AuthorizationError, authorize } from "@/lib/authz/authorize";
import { PIN_LOCK_AFTER, dummyHash, hashPin, lockoutMs, validatePinPolicy, verifyPin } from "@/lib/auth/pin";
import * as schema from "@/lib/db/schema";
import { withTx, type DbOrTx } from "@/lib/db/types";
import { BusinessError } from "@/lib/errors";
import { activeGrants } from "./service";

/**
 * Employee sign-in credentials (company email + PIN).
 *
 * The identity model is unchanged: the employee record, its CURRENT identity
 * row (the email) and its grants decide authority on every request. A PIN
 * only answers "is this the person" at sign-in. Rules:
 * - Only an scrypt hash is stored; a PIN is never written to audit, logs or URLs.
 * - A temporary PIN set by an Owner/Admin must be changed before any business
 *   use; a person changes their own PIN only by proving the current one.
 * - A reset or change ends the old credential row (kept as history) and every
 *   session issued against it stops on its next request.
 * - Failed attempts lock the credential (15 min after 5, doubling), so guessing
 *   is bounded on every instance; refusals are audited, never explained to the
 *   browser beyond "email or PIN not recognised".
 */

export type PinSignInResolution =
  | { outcome: "ok"; employeeId: string; identityId: string; credentialId: string; mustChange: boolean }
  | { outcome: "refused"; reason: "unknown" | "disabled" | "locked"; retryAfterMs?: number };

export async function currentCredential(db: DbOrTx, employeeId: string) {
  const [row] = await db
    .select()
    .from(schema.employeeCredential)
    .where(and(eq(schema.employeeCredential.employeeId, employeeId), eq(schema.employeeCredential.current, true)))
    .limit(1);
  return row ?? null;
}

/** Who may set (reset) another person's PIN: an Owner for anyone; an Admin for non-Owners inside its markets; nobody for themselves (use changeOwnPin). */
async function assertPinAuthority(db: DbOrTx, actor: Actor, employeeId: string): Promise<void> {
  if (actor.kind === "system") return;
  if (actor.employeeId === employeeId) throw new AuthorizationError("employee.manage", "Change your own PIN from your account page (it needs your current PIN).");
  if (hasRole(actor, "owner")) return;
  authorize(actor, "employee.manage");
  const grants = await activeGrants(db, employeeId);
  if (grants.some((g) => g.role === "owner")) throw new AuthorizationError("employee.manage", "Only an Owner can reset an Owner's PIN.");
  for (const g of grants) {
    const manages = actor.grants.some((a) => a.role === "admin" && (a.marketId === null || (g.marketId !== null && a.marketId === g.marketId)));
    if (!manages) throw new AuthorizationError("employee.manage", "This employee holds access in a market you do not manage.");
  }
}

/**
 * Set a temporary PIN for an employee (Owner/Admin, or the bootstrap script as
 * the system actor). The person must change it at first sign-in. Ends any
 * existing credential, which signs the person out everywhere.
 */
export async function setEmployeePin(db: DbOrTx, actor: Actor, employeeId: string, pin: string, opts: { reason: string; mustChange?: boolean } ) {
  await assertPinAuthority(db, actor, employeeId);
  validatePinPolicy(pin);
  if (!opts.reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  const [emp] = await db.select().from(schema.employee).where(eq(schema.employee.id, employeeId)).limit(1);
  if (!emp) throw new BusinessError("Employee not found");
  const pinHash = await hashPin(pin);
  return withTx(db, async (tx) => {
    const prior = await currentCredential(tx, employeeId);
    if (prior) {
      await tx
        .update(schema.employeeCredential)
        .set({ current: false, endedAt: new Date(), endedReason: "reset", endedByEmployeeId: actor.employeeId })
        .where(eq(schema.employeeCredential.id, prior.id));
    }
    const [row] = await tx
      .insert(schema.employeeCredential)
      .values({ employeeId, pinHash, mustChange: opts.mustChange ?? true, setByEmployeeId: actor.employeeId })
      .returning();
    await recordAudit(tx, actor, {
      action: prior ? "credential.reset" : "credential.set",
      subjectType: "employee",
      subjectId: employeeId,
      prior: prior ? { credentialId: prior.id, setAt: prior.setAt } : null,
      current: { credentialId: row.id, mustChange: row.mustChange },
      reason: opts.reason,
    });
    return row;
  });
}

/** The signed-in person replaces their PIN by proving the current one. Ends the old credential (other sessions stop). */
export async function changeOwnPin(db: DbOrTx, actor: Actor, input: { currentPin: string; newPin: string; confirmPin: string }) {
  if (!actor.employeeId) throw new AuthorizationError("employee.manage", "Sign in first.");
  const employeeId = actor.employeeId;
  const cred = await currentCredential(db, employeeId);
  if (!cred) throw new BusinessError("No PIN is set for this account; ask an Owner or Admin to set a temporary one.", { field: "currentPin" });
  if (cred.lockedUntil && cred.lockedUntil.getTime() > Date.now()) throw new BusinessError("This PIN is temporarily locked after repeated failed attempts; try again later.", { field: "currentPin" });
  if (!(await verifyPin(input.currentPin, cred.pinHash))) {
    await noteFailure(db, cred.id, cred.failedAttempts);
    throw new BusinessError("The current PIN is not correct.", { field: "currentPin" });
  }
  validatePinPolicy(input.newPin, "newPin");
  if (input.newPin !== input.confirmPin) throw new BusinessError("The two entries of the new PIN differ.", { field: "confirmPin" });
  if (input.newPin === input.currentPin) throw new BusinessError("Choose a PIN different from the current one.", { field: "newPin" });
  const pinHash = await hashPin(input.newPin);
  return withTx(db, async (tx) => {
    const [ended] = await tx
      .update(schema.employeeCredential)
      .set({ current: false, endedAt: new Date(), endedReason: "changed", endedByEmployeeId: employeeId })
      .where(and(eq(schema.employeeCredential.id, cred.id), eq(schema.employeeCredential.current, true)))
      .returning();
    if (!ended) throw new BusinessError("Your PIN was changed elsewhere a moment ago; sign in again.");
    const [row] = await tx.insert(schema.employeeCredential).values({ employeeId, pinHash, mustChange: false, setByEmployeeId: employeeId }).returning();
    await recordAudit(tx, actor, {
      action: "credential.changed",
      subjectType: "employee",
      subjectId: employeeId,
      prior: { credentialId: cred.id },
      current: { credentialId: row.id, mustChange: false },
    });
    return row;
  });
}

async function noteFailure(db: DbOrTx, credentialId: string, priorFailures: number) {
  const failures = priorFailures + 1;
  const lock = lockoutMs(failures);
  await db
    .update(schema.employeeCredential)
    .set({ failedAttempts: failures, lockedUntil: lock ? new Date(Date.now() + lock) : null })
    .where(eq(schema.employeeCredential.id, credentialId));
  return lock;
}

/**
 * Resolve an email + PIN to a signed-in employee. Never creates anything.
 * Unknown email, missing PIN and wrong PIN all resolve to the same "unknown"
 * refusal (a dummy hash is verified for unknown emails so timing is alike);
 * disablement is reported only after the PIN proved the person.
 */
export async function signInWithPin(db: DbOrTx, input: { email: string; pin: string }): Promise<PinSignInResolution> {
  const email = input.email.trim().toLowerCase();
  const pin = input.pin.trim();
  const refuse = async (reason: "unknown" | "disabled" | "locked", subjectId: string | null, detail: string, retryAfterMs?: number): Promise<PinSignInResolution> => {
    await recordAudit(db, SYSTEM_ACTOR, { action: "auth.refused", subjectType: subjectId ? "employee" : "sign_in", subjectId: subjectId ?? email, current: { email, method: "pin" }, reason: detail });
    return { outcome: "refused", reason, retryAfterMs };
  };
  const [identity] = email
    ? await db
        .select()
        .from(schema.employeeIdentity)
        .where(and(eq(schema.employeeIdentity.email, email), eq(schema.employeeIdentity.current, true)))
        .limit(1)
    : [];
  const cred = identity ? await currentCredential(db, identity.employeeId) : null;
  if (!identity || !cred) {
    await verifyPin(pin, await dummyHash());
    return refuse("unknown", identity?.employeeId ?? null, identity ? "no_pin_set" : "unknown_email");
  }
  if (cred.lockedUntil && cred.lockedUntil.getTime() > Date.now()) {
    const retryAfterMs = cred.lockedUntil.getTime() - Date.now();
    return refuse("locked", identity.employeeId, `locked_after_${cred.failedAttempts}_failures`, retryAfterMs);
  }
  if (!(await verifyPin(pin, cred.pinHash))) {
    const lock = await noteFailure(db, cred.id, cred.failedAttempts);
    return refuse("unknown", identity.employeeId, lock ? `bad_pin_locked_${cred.failedAttempts + 1}` : `bad_pin_${cred.failedAttempts + 1}`, lock || undefined);
  }
  const [emp] = await db.select().from(schema.employee).where(eq(schema.employee.id, identity.employeeId)).limit(1);
  if (!emp || !emp.enabled) return refuse("disabled", identity.employeeId, "employee_disabled");
  await db
    .update(schema.employeeCredential)
    .set({ failedAttempts: 0, lockedUntil: null, lastUsedAt: new Date() })
    .where(eq(schema.employeeCredential.id, cred.id));
  await db.update(schema.employeeIdentity).set({ lastSeenAt: new Date() }).where(eq(schema.employeeIdentity.id, identity.id));
  await recordAudit(db, { kind: "employee", employeeId: emp.id, displayName: emp.displayName, email, grants: [] }, { action: "auth.sign_in", subjectType: "employee", subjectId: emp.id, current: { email, method: "pin" } });
  return { outcome: "ok", employeeId: emp.id, identityId: identity.id, credentialId: cred.id, mustChange: cred.mustChange };
}

/** Is the credential a session was issued against still the current one? (A reset/change ends every session.) */
export async function credentialIsCurrent(db: DbOrTx, credentialId: string, employeeId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.employeeCredential.id })
    .from(schema.employeeCredential)
    .where(and(eq(schema.employeeCredential.id, credentialId), eq(schema.employeeCredential.employeeId, employeeId), eq(schema.employeeCredential.current, true)))
    .limit(1);
  return Boolean(row);
}

export { PIN_LOCK_AFTER };
