import { and, desc, eq, isNull } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { SYSTEM_ACTOR, hasRole, type Actor, type ActorGrant, type Role } from "@/lib/authz/actor";
import { AuthorizationError, authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { withTx, type DbOrTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";

/**
 * Employee lifecycle: provisioning by email, Google subject binding on first
 * sign-in, role/market grants, effective disablement, identity retirement.
 *
 * Rules (brief §5, AT61/AT62, AT79/AT80):
 * - Google authenticates; only an existing enabled employee record with a
 *   matching CURRENT identity row is authorized. There is no auto-provisioning.
 * - A Google `sub` is the stable external key. The first sign-in binds the
 *   provisioned email's identity row to that `sub`.
 * - An email later re-used by a different Google account (different `sub`)
 *   inherits nothing: sign-in is refused until Owner/Admin provisions that
 *   person as a new employee.
 * - Disabling stops existing-session business use on the next request.
 * - Grant authority is enforced here, not by hiding buttons (REV-01):
 *   Owner authority is granted/revoked only by an Owner; an Admin acts only
 *   within the markets of its own employee.manage grant; nobody but an Owner
 *   changes their own grants.
 */

export async function loadActor(db: DbOrTx, employeeId: string, kind: "employee" | "dev_fixture" = "employee"): Promise<Actor | null> {
  const [emp] = await db.select().from(schema.employee).where(eq(schema.employee.id, employeeId));
  if (!emp || !emp.enabled) return null;
  const [identity] = await db
    .select()
    .from(schema.employeeIdentity)
    .where(and(eq(schema.employeeIdentity.employeeId, employeeId), eq(schema.employeeIdentity.current, true)))
    .limit(1);
  const grants = await activeGrants(db, employeeId);
  return {
    kind,
    employeeId: emp.id,
    displayName: emp.displayName,
    email: identity?.email ?? null,
    grants,
  };
}

/**
 * Actor for a signed-in session: the employee must be enabled AND the
 * identity the session was issued for must still be the employee's current
 * identity. A retired/reassigned identity therefore ends every session that
 * used it, without waiting for the cookie to expire (REV-17, AC18).
 */
export async function loadActorForSession(db: DbOrTx, employeeId: string, identityId: string, kind: "employee" | "dev_fixture", credentialId?: string): Promise<Actor | null> {
  const [identity] = await db.select().from(schema.employeeIdentity).where(eq(schema.employeeIdentity.id, identityId)).limit(1);
  if (!identity || !identity.current || identity.employeeId !== employeeId) return null;
  // A PIN session is bound to the credential it was proven with: a reset or change ends it on the next request.
  if (credentialId) {
    const [cred] = await db
      .select({ id: schema.employeeCredential.id })
      .from(schema.employeeCredential)
      .where(and(eq(schema.employeeCredential.id, credentialId), eq(schema.employeeCredential.employeeId, employeeId), eq(schema.employeeCredential.current, true)))
      .limit(1);
    if (!cred) return null;
  }
  return loadActor(db, employeeId, kind);
}

export async function activeGrants(db: DbOrTx, employeeId: string): Promise<ActorGrant[]> {
  const rows = await db
    .select({ role: schema.roleGrant.role, marketId: schema.roleGrant.marketId })
    .from(schema.roleGrant)
    .where(and(eq(schema.roleGrant.employeeId, employeeId), isNull(schema.roleGrant.revokedAt)));
  return rows.map((r) => ({ role: r.role, marketId: r.marketId }));
}

// ---------------------------------------------------------------------------
// Grant authority (REV-01)
// ---------------------------------------------------------------------------

function isOwner(actor: Actor): boolean {
  return actor.kind === "system" || hasRole(actor, "owner");
}

/** Does the actor hold employee.manage for this market — a global grant when marketId is null? */
function managesMarket(actor: Actor, marketId: string | null): boolean {
  if (isOwner(actor)) return true;
  return actor.grants.some((g) => g.role === "admin" && (g.marketId === null || (marketId !== null && g.marketId === marketId)));
}

/**
 * Enforce who may add or remove a (role, market) grant on an employee.
 * - Owner: anything.
 * - Admin: never Owner authority; only within its own market scope (a
 *   market-scoped Admin cannot issue a global grant); never its own grants.
 * Authorization refusals are AuthorizationError so the UI shows "not permitted".
 */
export function assertGrantAuthority(actor: Actor, target: { employeeId: string; role: Role; marketId: string | null }): void {
  if (isOwner(actor)) return;
  authorize(actor, "employee.manage");
  if (target.role === "owner") throw new AuthorizationError("employee.manage", "Only an Owner can grant or revoke Owner authority.");
  if (actor.employeeId === target.employeeId) throw new AuthorizationError("employee.manage", "You cannot change your own grants; ask an Owner or another Admin.");
  if (!managesMarket(actor, target.marketId)) {
    throw new AuthorizationError(
      "employee.manage",
      target.marketId === null ? "A market-scoped Admin cannot issue a grant covering every market." : "You do not manage access in that market.",
    );
  }
}

/** Enable/disable/offboard: the actor must manage every market the target's active grants cover and may not touch an Owner. */
async function assertLifecycleAuthority(db: DbOrTx, actor: Actor, employeeId: string): Promise<void> {
  if (isOwner(actor)) return;
  authorize(actor, "employee.manage");
  if (actor.employeeId === employeeId) throw new AuthorizationError("employee.manage", "You cannot change your own access.");
  const grants = await activeGrants(db, employeeId);
  if (grants.some((g) => g.role === "owner")) throw new AuthorizationError("employee.manage", "Only an Owner can change an Owner's access.");
  for (const g of grants) {
    if (!managesMarket(actor, g.marketId)) throw new AuthorizationError("employee.manage", "This employee holds access in a market you do not manage.");
  }
}

// ---------------------------------------------------------------------------
// Google sign-in resolution
// ---------------------------------------------------------------------------

export type SignInResolution =
  | { outcome: "ok"; employeeId: string; identityId: string }
  | { outcome: "refused"; reason: string };

/**
 * Resolve a Google assertion to an internal employee. Never creates an
 * employee. Binds `sub` on first sign-in of a provisioned email. All writes
 * happen in one transaction.
 */
export async function resolveGoogleSignIn(
  db: DbOrTx,
  assertion: { subject: string; email: string; emailVerified: boolean },
): Promise<SignInResolution> {
  if (!assertion.emailVerified) {
    return { outcome: "refused", reason: "Google reports the email address as unverified." };
  }
  return withTx(db, async (tx) => {
    // 1. Known subject on a CURRENT identity → that employee, regardless of current email (rename-safe).
    const [bySubject] = await tx
      .select()
      .from(schema.employeeIdentity)
      .where(and(eq(schema.employeeIdentity.googleSubject, assertion.subject), eq(schema.employeeIdentity.current, true)))
      .limit(1);
    if (bySubject) {
      const [emp] = await tx.select().from(schema.employee).where(eq(schema.employee.id, bySubject.employeeId));
      if (!emp || !emp.enabled) return { outcome: "refused", reason: "Employee access is disabled." };
      if (bySubject.email !== assertion.email) {
        // Google-side rename: end the old identity row, start a new current one with the same subject; audit it.
        await tx
          .update(schema.employeeIdentity)
          .set({ current: false, endedAt: new Date(), endedReason: "rename", googleSubject: null })
          .where(eq(schema.employeeIdentity.id, bySubject.id));
        const [next] = await tx
          .insert(schema.employeeIdentity)
          .values({ employeeId: emp.id, email: assertion.email, googleSubject: assertion.subject, lastSeenAt: new Date() })
          .returning();
        await recordAudit(tx, SYSTEM_ACTOR, {
          action: "employee.email_rename_observed",
          subjectType: "employee",
          subjectId: emp.id,
          prior: { email: bySubject.email },
          current: { email: assertion.email },
          reason: "Google reported a different email for a known subject at sign-in",
        });
        return { outcome: "ok", employeeId: emp.id, identityId: next.id };
      }
      await tx.update(schema.employeeIdentity).set({ lastSeenAt: new Date() }).where(eq(schema.employeeIdentity.id, bySubject.id));
      return { outcome: "ok", employeeId: emp.id, identityId: bySubject.id };
    }
    // 2. Provisioned email with no subject yet → bind on first sign-in.
    const [byEmail] = await tx
      .select()
      .from(schema.employeeIdentity)
      .where(and(eq(schema.employeeIdentity.email, assertion.email), eq(schema.employeeIdentity.current, true)))
      .orderBy(desc(schema.employeeIdentity.firstSeenAt))
      .limit(1);
    if (!byEmail) {
      const [ended] = await tx
        .select({ id: schema.employeeIdentity.id })
        .from(schema.employeeIdentity)
        .where(and(eq(schema.employeeIdentity.googleSubject, assertion.subject), eq(schema.employeeIdentity.current, false)))
        .limit(1);
      if (ended) return { outcome: "refused", reason: "This Google identity was retired for its employee. Ask Owner/Admin to provision access again." };
      return { outcome: "refused", reason: "This Google account is not provisioned as an employee. Ask Owner/Admin." };
    }
    if (byEmail.googleSubject && byEmail.googleSubject !== assertion.subject) {
      // Same email, different person: inherits neither permissions nor audit identity (AT61).
      return {
        outcome: "refused",
        reason: "This email address is already bound to a different Google identity. A re-used address must be provisioned as a new employee.",
      };
    }
    const [emp] = await tx.select().from(schema.employee).where(eq(schema.employee.id, byEmail.employeeId));
    if (!emp || !emp.enabled) return { outcome: "refused", reason: "Employee access is disabled." };
    await tx
      .update(schema.employeeIdentity)
      .set({ googleSubject: assertion.subject, lastSeenAt: new Date() })
      .where(eq(schema.employeeIdentity.id, byEmail.id));
    return { outcome: "ok", employeeId: emp.id, identityId: byEmail.id };
  });
}

// ---------------------------------------------------------------------------
// Provisioning and grants
// ---------------------------------------------------------------------------

export interface ProvisionEmployeeInput {
  displayName: string;
  email: string;
  grants: Array<{ role: Role; marketId: string | null }>;
}

export async function provisionEmployee(db: DbOrTx, actor: Actor, input: ProvisionEmployeeInput) {
  authorize(actor, "employee.manage");
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BusinessError("A valid company email is required", { field: "email" });
  if (!input.displayName.trim()) throw new BusinessError("A display name is required", { field: "displayName" });
  // Authority for every requested grant is checked before anything is written (target employee does not exist yet → self-check moot).
  for (const g of input.grants) assertGrantAuthority(actor, { employeeId: "(new)", role: g.role, marketId: g.marketId });
  return withTx(db, async (tx) => {
    const [dup] = await tx
      .select({ employeeId: schema.employeeIdentity.employeeId })
      .from(schema.employeeIdentity)
      .where(and(eq(schema.employeeIdentity.email, email), eq(schema.employeeIdentity.current, true)))
      .limit(1);
    if (dup) {
      throw new BusinessError(
        "That email is the current identity of another employee. Offboard that employee (which retires the identity) or record a rename first, then provision the new person.",
        { field: "email", code: "email_in_use" },
      );
    }
    const [emp] = await tx.insert(schema.employee).values({ displayName: input.displayName.trim() }).returning();
    const [identity] = await tx
      .insert(schema.employeeIdentity)
      .values({ employeeId: emp.id, email, googleSubject: null })
      .returning();
    for (const g of input.grants) {
      await tx.insert(schema.roleGrant).values({ employeeId: emp.id, role: g.role, marketId: g.marketId, grantedByEmployeeId: actor.employeeId });
    }
    await recordAudit(tx, actor, {
      action: "employee.provision",
      subjectType: "employee",
      subjectId: emp.id,
      current: { displayName: emp.displayName, email, grants: input.grants },
    });
    return { employee: emp, identity };
  });
}

export async function grantRole(db: DbOrTx, actor: Actor, employeeId: string, role: Role, marketId: string | null) {
  assertGrantAuthority(actor, { employeeId, role, marketId });
  const [target] = await db.select().from(schema.employee).where(eq(schema.employee.id, employeeId));
  if (!target) throw new BusinessError("Employee not found");
  const [existing] = await db
    .select()
    .from(schema.roleGrant)
    .where(
      and(
        eq(schema.roleGrant.employeeId, employeeId),
        eq(schema.roleGrant.role, role),
        marketId === null ? isNull(schema.roleGrant.marketId) : eq(schema.roleGrant.marketId, marketId),
        isNull(schema.roleGrant.revokedAt),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [row] = await db
    .insert(schema.roleGrant)
    .values({ employeeId, role, marketId, grantedByEmployeeId: actor.employeeId })
    .returning();
  await recordAudit(db, actor, { action: "employee.grant", subjectType: "employee", subjectId: employeeId, current: { role, marketId } });
  return row;
}

export async function revokeGrant(db: DbOrTx, actor: Actor, grantId: string, reason: string) {
  const [prior] = await db.select().from(schema.roleGrant).where(eq(schema.roleGrant.id, grantId));
  if (!prior) throw new BusinessError("Grant not found");
  assertGrantAuthority(actor, { employeeId: prior.employeeId, role: prior.role, marketId: prior.marketId });
  if (prior.revokedAt) return prior;
  const [row] = await db
    .update(schema.roleGrant)
    .set({ revokedAt: new Date(), revokedByEmployeeId: actor.employeeId, revokeReason: reason })
    .where(and(eq(schema.roleGrant.id, grantId), isNull(schema.roleGrant.revokedAt)))
    .returning();
  if (!row) throw new StaleStateError("That grant was already revoked.");
  await recordAudit(db, actor, {
    action: "employee.revoke_grant",
    subjectType: "employee",
    subjectId: prior.employeeId,
    prior: { role: prior.role, marketId: prior.marketId },
    current: null,
    reason,
  });
  return row;
}

/** Internal effective disablement — immediate for existing sessions. */
export async function setEmployeeEnabled(db: DbOrTx, actor: Actor, employeeId: string, enabled: boolean, reason: string) {
  await assertLifecycleAuthority(db, actor, employeeId);
  if (actor.employeeId === employeeId && !enabled) {
    throw new BusinessError("An employee cannot disable their own access.");
  }
  const [prior] = await db.select().from(schema.employee).where(eq(schema.employee.id, employeeId));
  if (!prior) throw new BusinessError("Employee not found");
  if (prior.enabled === enabled) return prior;
  const [row] = await db
    .update(schema.employee)
    .set(
      enabled
        ? { enabled: true, disabledAt: null, disabledByEmployeeId: null, disableReason: null }
        : { enabled: false, disabledAt: new Date(), disabledByEmployeeId: actor.employeeId, disableReason: reason },
    )
    .where(eq(schema.employee.id, employeeId))
    .returning();
  await recordAudit(db, actor, {
    action: enabled ? "employee.enable" : "employee.disable",
    subjectType: "employee",
    subjectId: employeeId,
    prior: { enabled: prior.enabled },
    current: { enabled: row.enabled },
    reason,
  });
  return row;
}

/**
 * Google email rename for the same person: end the old identity row and start
 * a new current row with the same subject. Audit identity (employee id) is
 * unchanged (AT61). One transaction.
 */
export async function recordEmailRename(db: DbOrTx, actor: Actor, employeeId: string, newEmail: string) {
  await assertLifecycleAuthority(db, actor, employeeId);
  const email = newEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BusinessError("A valid company email is required", { field: "email" });
  return withTx(db, async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.employeeIdentity)
      .where(and(eq(schema.employeeIdentity.employeeId, employeeId), eq(schema.employeeIdentity.current, true)))
      .limit(1);
    if (!current) throw new BusinessError("No current identity for this employee (it was retired). Provision access again instead of renaming.");
    if (current.email === email) return current;
    const [taken] = await tx
      .select({ id: schema.employeeIdentity.id })
      .from(schema.employeeIdentity)
      .where(and(eq(schema.employeeIdentity.email, email), eq(schema.employeeIdentity.current, true)))
      .limit(1);
    if (taken) throw new BusinessError("That email is already another employee's current identity", { field: "email" });
    await tx
      .update(schema.employeeIdentity)
      .set({ current: false, endedAt: new Date(), endedReason: "rename", endedByEmployeeId: actor.employeeId, googleSubject: null })
      .where(eq(schema.employeeIdentity.id, current.id));
    const [next] = await tx
      .insert(schema.employeeIdentity)
      .values({ employeeId, email, googleSubject: current.googleSubject })
      .returning();
    await recordAudit(tx, actor, {
      action: "employee.email_rename",
      subjectType: "employee",
      subjectId: employeeId,
      prior: { email: current.email },
      current: { email },
    });
    return next;
  });
}

/**
 * Offboarding (REV-17, AT61/AT62): disable the employee, revoke every active
 * grant and retire the current identity — one transaction. The employee
 * record, its ended identity (with the Google subject) and all audit history
 * stay. The email is then free for a NEW person, who is provisioned as a new
 * employee with intentionally assigned grants; nothing is inherited. Any
 * session issued for the retired identity stops working on its next request.
 */
export async function offboardEmployee(db: DbOrTx, actor: Actor, employeeId: string, reason: string) {
  await assertLifecycleAuthority(db, actor, employeeId);
  if (actor.employeeId === employeeId) throw new BusinessError("You cannot offboard yourself.");
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  return withTx(db, async (tx) => {
    const [emp] = await tx.select().from(schema.employee).where(eq(schema.employee.id, employeeId)).for("update");
    if (!emp) throw new BusinessError("Employee not found");
    const grants = await tx.select().from(schema.roleGrant).where(and(eq(schema.roleGrant.employeeId, employeeId), isNull(schema.roleGrant.revokedAt)));
    for (const g of grants) {
      await tx
        .update(schema.roleGrant)
        .set({ revokedAt: new Date(), revokedByEmployeeId: actor.employeeId, revokeReason: `Offboarded: ${reason}` })
        .where(eq(schema.roleGrant.id, g.id));
    }
    if (emp.enabled) {
      await tx
        .update(schema.employee)
        .set({ enabled: false, disabledAt: new Date(), disabledByEmployeeId: actor.employeeId, disableReason: reason })
        .where(eq(schema.employee.id, employeeId));
    }
    const [identity] = await tx
      .select()
      .from(schema.employeeIdentity)
      .where(and(eq(schema.employeeIdentity.employeeId, employeeId), eq(schema.employeeIdentity.current, true)))
      .limit(1);
    if (identity) {
      await tx
        .update(schema.employeeIdentity)
        .set({ current: false, endedAt: new Date(), endedReason: "retired", endedByEmployeeId: actor.employeeId })
        .where(eq(schema.employeeIdentity.id, identity.id));
    }
    // The sign-in credential ends with the identity (history kept); a new person on this email gets their own.
    await tx
      .update(schema.employeeCredential)
      .set({ current: false, endedAt: new Date(), endedReason: "offboarded", endedByEmployeeId: actor.employeeId })
      .where(and(eq(schema.employeeCredential.employeeId, employeeId), eq(schema.employeeCredential.current, true)));
    await recordAudit(tx, actor, {
      action: "employee.offboard",
      subjectType: "employee",
      subjectId: employeeId,
      prior: { enabled: emp.enabled, email: identity?.email ?? null, grants: grants.map((g) => ({ role: g.role, marketId: g.marketId })) },
      current: { enabled: false, identityRetired: Boolean(identity), grants: [] },
      reason,
    });
    return { employeeId, retiredIdentityId: identity?.id ?? null, revokedGrants: grants.length };
  });
}

export async function listEmployees(db: DbOrTx) {
  const emps = await db.select().from(schema.employee).orderBy(schema.employee.displayName);
  const identities = await db.select().from(schema.employeeIdentity);
  const grants = await db.select().from(schema.roleGrant).where(isNull(schema.roleGrant.revokedAt));
  // Credential STATE only — never the hash.
  const credentials = await db
    .select({
      employeeId: schema.employeeCredential.employeeId,
      setAt: schema.employeeCredential.setAt,
      mustChange: schema.employeeCredential.mustChange,
      lockedUntil: schema.employeeCredential.lockedUntil,
      lastUsedAt: schema.employeeCredential.lastUsedAt,
      failedAttempts: schema.employeeCredential.failedAttempts,
    })
    .from(schema.employeeCredential)
    .where(eq(schema.employeeCredential.current, true));
  const now = Date.now();
  return emps.map((e) => {
    const c = credentials.find((x) => x.employeeId === e.id);
    return {
      ...e,
      identities: identities.filter((i) => i.employeeId === e.id),
      grants: grants.filter((g) => g.employeeId === e.id),
      credential: c ? { ...c, locked: Boolean(c.lockedUntil && c.lockedUntil.getTime() > now) } : null,
    };
  });
}
