import { and, eq, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor, Role } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { openException } from "@/lib/exceptions/service";

export type HoldKind = (typeof schema.holdKindEnum.enumValues)[number];

/**
 * Causal holds (brief §31). Each hold names its cause; only that cause's
 * resolution clears it. Processing/unknown never creates a hold. Admin
 * override changes permission with audit; it never marks debt paid.
 * Payment-failure holds are created by the phase 3 payment module from
 * definitive Stripe evidence; Admin may record compliance/readiness/manual
 * holds now.
 */
export async function createHold(
  db: DbOrTx,
  actor: Actor,
  input: { locationId: string; kind: HoldKind; cause: string; causeReferenceType?: string; causeReferenceId?: string },
) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
  if (!loc) throw new Error("Location not found");
  authorize(actor, "hold.manage", { marketId: loc.marketId });
  if (input.kind === "payment_failure" && actor.kind !== "system") {
    throw new Error("Payment-failure holds are created only from definitive provider evidence (phase 3), not by hand.");
  }
  if (!input.cause.trim()) throw new Error("A cause is required");
  const [row] = await db
    .insert(schema.hold)
    .values({
      locationId: input.locationId,
      kind: input.kind,
      cause: input.cause.trim(),
      causeReferenceType: input.causeReferenceType ?? null,
      causeReferenceId: input.causeReferenceId ?? null,
      createdByEmployeeId: actor.employeeId,
    })
    .returning();
  await recordAudit(db, actor, { action: "hold.create", subjectType: "customer_location", subjectId: input.locationId, current: { holdId: row.id, kind: row.kind, cause: row.cause }, marketId: loc.marketId });
  await openException(db, actor, {
    category: "hold",
    title: `Hold (${input.kind.replace("_", " ")}) — ${loc.tradeName}`,
    cause: input.cause,
    marketId: loc.marketId,
    locationId: loc.id,
    ownerRole: (input.kind === "payment_failure" ? "accounting" : "admin") as Role,
    nextAction: "Resolve the cause; orders remain capturable, merchandise delivery is blocked.",
    dedupeKey: `hold:${row.id}`,
    links: [{ subjectType: "hold", subjectId: row.id }],
  });
  return row;
}

/** Clear only this cause. Unrelated holds persist. */
export async function resolveHold(db: DbOrTx, actor: Actor, holdId: string, resolution: string) {
  const [h] = await db.select().from(schema.hold).where(eq(schema.hold.id, holdId));
  if (!h) throw new Error("Hold not found");
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, h.locationId));
  authorize(actor, "hold.manage", { marketId: loc?.marketId });
  if (!h.active) return h;
  if (h.kind === "payment_failure" && actor.kind !== "system") {
    throw new Error("A payment-failure hold clears automatically from proven resolution (phase 3); use an audited override to permit delivery meanwhile.");
  }
  const [row] = await db
    .update(schema.hold)
    .set({ active: false, resolvedAt: new Date(), resolution, resolvedByEmployeeId: actor.employeeId })
    .where(eq(schema.hold.id, holdId))
    .returning();
  await recordAudit(db, actor, { action: "hold.resolve", subjectType: "customer_location", subjectId: h.locationId, prior: { holdId, active: true }, current: { holdId, active: false }, reason: resolution, marketId: loc?.marketId });
  await db
    .update(schema.exceptionCase)
    .set({ state: "resolved", resolution, resolvedAt: new Date(), resolvedByEmployeeId: actor.employeeId })
    .where(and(eq(schema.exceptionCase.dedupeKey, `hold:${holdId}`), sql`${schema.exceptionCase.state} <> 'resolved'`));
  return row;
}

/**
 * Admin override: permission despite ONE named cause. Scope names the
 * delivery/order it applies to. An override covers only the hold it names and
 * never a hold created after it was granted (a later definitive failure is a
 * new cause). Duration/expiry is D03 (unselected) → no automatic expiry;
 * withdrawing is an explicit act.
 */
export async function grantOverride(
  db: DbOrTx,
  actor: Actor,
  input: { locationId: string; holdId: string; scope: string; orderId?: string | null; reason: string },
) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
  if (!loc) throw new Error("Location not found");
  authorize(actor, "hold.override", { marketId: loc.marketId });
  if (!input.reason.trim() || !input.scope.trim()) throw new Error("Scope and reason are required for an override");
  const [target] = await db.select().from(schema.hold).where(and(eq(schema.hold.id, input.holdId), eq(schema.hold.locationId, input.locationId)));
  if (!target || !target.active) throw new Error("An override must name one active hold at this location");
  const role: Role = actor.grants.some((g) => g.role === "owner") ? "owner" : "admin";
  if (!actor.employeeId) throw new Error("Overrides must be granted by a person");
  const [row] = await db
    .insert(schema.holdOverride)
    .values({
      locationId: input.locationId,
      holdId: input.holdId,
      scope: input.scope.trim(),
      orderId: input.orderId ?? null,
      reason: input.reason.trim(),
      grantedByEmployeeId: actor.employeeId,
      grantedByRole: role,
    })
    .returning();
  await recordAudit(db, actor, {
    action: "hold.override",
    subjectType: "customer_location",
    subjectId: input.locationId,
    current: { overrideId: row.id, holdId: input.holdId, scope: row.scope, orderId: input.orderId ?? null },
    reason: input.reason,
    marketId: loc.marketId,
  });
  return row;
}

export async function withdrawOverride(db: DbOrTx, actor: Actor, overrideId: string, reason: string) {
  const [o] = await db.select().from(schema.holdOverride).where(eq(schema.holdOverride.id, overrideId));
  if (!o) throw new Error("Override not found");
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, o.locationId));
  authorize(actor, "hold.override", { marketId: loc?.marketId });
  const [row] = await db.update(schema.holdOverride).set({ withdrawnAt: new Date(), withdrawnByEmployeeId: actor.employeeId }).where(eq(schema.holdOverride.id, overrideId)).returning();
  await recordAudit(db, actor, { action: "hold.override_withdraw", subjectType: "customer_location", subjectId: o.locationId, prior: { overrideId, active: true }, current: { overrideId, active: false }, reason, marketId: loc?.marketId });
  return row;
}
