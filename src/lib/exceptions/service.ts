import { and, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor, Role } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";

export type ExceptionState = "open" | "acknowledged" | "assigned" | "waiting" | "resolved";

export interface OpenExceptionInput {
  category: string;
  title: string;
  cause?: string;
  marketId?: string | null;
  locationId?: string | null;
  ownerRole?: Role | null;
  nextAction?: string | null;
  /** While an open case with this key exists, a second open() returns it (one incident, R44). */
  dedupeKey?: string | null;
  links?: Array<{ subjectType: string; subjectId: string; relation?: string }>;
  parentCaseId?: string | null;
}

/**
 * Open (or reuse) an exception case. Routine established transitions never
 * call this; it is for actual uncertainty, authority or judgment (brief §41).
 */
export async function openException(db: DbOrTx, actor: Actor, input: OpenExceptionInput) {
  if (input.dedupeKey) {
    const [existing] = await db
      .select()
      .from(schema.exceptionCase)
      .where(and(eq(schema.exceptionCase.dedupeKey, input.dedupeKey), ne(schema.exceptionCase.state, "resolved")))
      .limit(1);
    if (existing) {
      // Attach any new links to the same incident rather than opening a duplicate.
      for (const l of input.links ?? []) {
        const [dup] = await db
          .select({ id: schema.exceptionLink.id })
          .from(schema.exceptionLink)
          .where(
            and(
              eq(schema.exceptionLink.caseId, existing.id),
              eq(schema.exceptionLink.subjectType, l.subjectType),
              eq(schema.exceptionLink.subjectId, l.subjectId),
            ),
          )
          .limit(1);
        if (!dup) {
          await db.insert(schema.exceptionLink).values({ caseId: existing.id, ...l });
        }
      }
      return { case: existing, created: false as const };
    }
  }
  const [row] = await db
    .insert(schema.exceptionCase)
    .values({
      category: input.category,
      title: input.title,
      cause: input.cause ?? null,
      marketId: input.marketId ?? null,
      locationId: input.locationId ?? null,
      ownerRole: input.ownerRole ?? null,
      nextAction: input.nextAction ?? null,
      dedupeKey: input.dedupeKey ?? null,
      parentCaseId: input.parentCaseId ?? null,
    })
    .returning();
  for (const l of input.links ?? []) {
    await db.insert(schema.exceptionLink).values({ caseId: row.id, ...l });
  }
  await db.insert(schema.exceptionNote).values({
    caseId: row.id,
    actorEmployeeId: actor.employeeId,
    actorKind: actor.kind === "dev_fixture" ? "dev_fixture" : actor.kind,
    kind: "state_change",
    body: `Opened (${input.category})`,
  });
  await recordAudit(db, actor, {
    action: "exception.open",
    subjectType: "exception_case",
    subjectId: row.id,
    current: { category: input.category, title: input.title, dedupeKey: input.dedupeKey ?? null },
    marketId: input.marketId ?? null,
  });
  return { case: row, created: true as const };
}

export interface TransitionInput {
  caseId: string;
  state: ExceptionState;
  note?: string;
  ownerRole?: Role | null;
  ownerEmployeeId?: string | null;
  nextAction?: string | null;
  waitingParty?: string | null;
  reviewAt?: Date | null;
  resolution?: string | null;
  severity?: string | null;
}

/**
 * Move a case between acknowledged/assigned/waiting/resolved. Resolving a
 * child never resolves its parent; the parent is reviewed, not auto-closed
 * (brief §41).
 */
export async function transitionException(db: DbOrTx, actor: Actor, input: TransitionInput) {
  const [prior] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.id, input.caseId));
  if (!prior) throw new BusinessError("Exception case not found");
  authorize(actor, "exception.manage", { marketId: prior.marketId });
  if (prior.state === "resolved") throw new StaleStateError("This case is already resolved; reopen it deliberately if the condition returned.");
  if (input.state === "resolved" && !input.resolution && !input.note) {
    throw new BusinessError("A resolution is required to resolve a case", { field: "resolution" });
  }
  const set: Partial<typeof schema.exceptionCase.$inferInsert> = {
    state: input.state,
    updatedAt: new Date(),
  };
  if (input.ownerRole !== undefined) set.ownerRole = input.ownerRole;
  if (input.ownerEmployeeId !== undefined) set.ownerEmployeeId = input.ownerEmployeeId;
  if (input.nextAction !== undefined) set.nextAction = input.nextAction;
  if (input.waitingParty !== undefined) set.waitingParty = input.waitingParty;
  if (input.reviewAt !== undefined) set.reviewAt = input.reviewAt;
  if (input.severity !== undefined) set.severity = input.severity;
  if (input.state === "resolved") {
    set.resolution = input.resolution ?? input.note ?? null;
    set.resolvedAt = new Date();
    set.resolvedByEmployeeId = actor.employeeId;
  }
  const [current] = await db
    .update(schema.exceptionCase)
    .set(set)
    .where(and(eq(schema.exceptionCase.id, input.caseId), eq(schema.exceptionCase.state, prior.state)))
    .returning();
  if (!current) throw new StaleStateError("The case changed while you were editing; reload it and try again.");
  await db.insert(schema.exceptionNote).values({
    caseId: input.caseId,
    actorEmployeeId: actor.employeeId,
    actorKind: actor.kind === "dev_fixture" ? "dev_fixture" : actor.kind,
    kind: "state_change",
    body: input.note ? `${prior.state} → ${input.state}: ${input.note}` : `${prior.state} → ${input.state}`,
  });
  await recordAudit(db, actor, {
    action: "exception.transition",
    subjectType: "exception_case",
    subjectId: input.caseId,
    prior: { state: prior.state, ownerRole: prior.ownerRole, nextAction: prior.nextAction },
    current: { state: current.state, ownerRole: current.ownerRole, nextAction: current.nextAction, resolution: current.resolution },
    reason: input.note ?? input.resolution ?? null,
    marketId: prior.marketId,
  });
  if (input.state === "resolved" && prior.parentCaseId) {
    await db.insert(schema.exceptionNote).values({
      caseId: prior.parentCaseId,
      actorKind: "system",
      kind: "note",
      body: `Child case ${prior.id} resolved; parent remains ${"open"} for review of remaining consequences.`,
    });
  }
  return current;
}

export async function addExceptionNote(db: DbOrTx, actor: Actor, caseId: string, body: string, data?: unknown) {
  const [c] = await db.select({ marketId: schema.exceptionCase.marketId }).from(schema.exceptionCase).where(eq(schema.exceptionCase.id, caseId));
  if (!c) throw new BusinessError("Exception case not found");
  authorize(actor, "exception.view", { marketId: c.marketId });
  if (!body.trim()) throw new BusinessError("A note needs text", { field: "body" });
  await db.insert(schema.exceptionNote).values({
    caseId,
    actorEmployeeId: actor.employeeId,
    actorKind: actor.kind === "dev_fixture" ? "dev_fixture" : actor.kind,
    kind: "note",
    body,
    data: data ?? null,
  });
}

/**
 * Resolve every open case with the given dedupe key(s): used when the cause is
 * established as gone (e.g. shortage reserved after stock receipt). Cause
 * resolution updates dependent views; it never restores obsolete commitments.
 */
export async function resolveByDedupeKeys(db: DbOrTx, actor: Actor, keys: string[], resolution: string) {
  if (keys.length === 0) return 0;
  const rows = await db
    .update(schema.exceptionCase)
    .set({ state: "resolved", resolution, resolvedAt: new Date(), resolvedByEmployeeId: actor.employeeId, updatedAt: new Date() })
    .where(and(inArray(schema.exceptionCase.dedupeKey, keys), ne(schema.exceptionCase.state, "resolved")))
    .returning({ id: schema.exceptionCase.id });
  for (const r of rows) {
    await db.insert(schema.exceptionNote).values({ caseId: r.id, actorKind: "system", kind: "state_change", body: `Resolved: ${resolution}` });
    await recordAudit(db, actor, { action: "exception.resolve_by_cause", subjectType: "exception_case", subjectId: r.id, reason: resolution });
  }
  return rows.length;
}

export interface ExceptionFilter {
  marketIds?: "all" | string[];
  locationId?: string;
  category?: string;
  ownerRole?: Role;
  state?: ExceptionState | "waiting_only" | "due";
  limit?: number;
}

/**
 * Open cases within a market scope. A case without a market (e.g. a failed
 * background job) is visible to actors with an unrestricted scope only.
 */
export async function listOpenExceptions(db: DbOrTx, opts: ExceptionFilter = {}) {
  const conds = [ne(schema.exceptionCase.state, "resolved")];
  if (opts.marketIds && opts.marketIds !== "all") {
    if (opts.marketIds.length === 0) return [];
    conds.push(inArray(schema.exceptionCase.marketId, opts.marketIds));
  }
  if (opts.locationId) conds.push(eq(schema.exceptionCase.locationId, opts.locationId));
  if (opts.category) conds.push(eq(schema.exceptionCase.category, opts.category));
  if (opts.ownerRole) conds.push(eq(schema.exceptionCase.ownerRole, opts.ownerRole));
  if (opts.state === "waiting_only") conds.push(eq(schema.exceptionCase.state, "waiting"));
  else if (opts.state === "due") conds.push(lte(schema.exceptionCase.reviewAt, new Date()));
  else if (opts.state) conds.push(eq(schema.exceptionCase.state, opts.state));
  return db
    .select()
    .from(schema.exceptionCase)
    .where(and(...conds))
    .orderBy(desc(schema.exceptionCase.createdAt))
    .limit(opts.limit ?? 200);
}

/** Subjects linked to a set of cases, for rendering "affects NC-000012, NC-000013" without a query per row. */
export async function linksForCases(db: DbOrTx, caseIds: string[]) {
  if (!caseIds.length) return new Map<string, Array<typeof schema.exceptionLink.$inferSelect & { label: string; href: string | null }>>();
  const links = await db.select().from(schema.exceptionLink).where(inArray(schema.exceptionLink.caseId, caseIds));
  const orderIds = links.filter((l) => l.subjectType === "order").map((l) => l.subjectId);
  const orders = orderIds.length ? await db.select({ id: schema.order.id, orderNumber: schema.order.orderNumber }).from(schema.order).where(inArray(schema.order.id, orderIds)) : [];
  const locIds = links.filter((l) => l.subjectType === "customer_location").map((l) => l.subjectId);
  const locs = locIds.length ? await db.select({ id: schema.customerLocation.id, tradeName: schema.customerLocation.tradeName }).from(schema.customerLocation).where(inArray(schema.customerLocation.id, locIds)) : [];
  const out = new Map<string, Array<typeof schema.exceptionLink.$inferSelect & { label: string; href: string | null }>>();
  for (const l of links) {
    let label = l.subjectType.replace(/_/g, " ");
    let href: string | null = null;
    if (l.subjectType === "order") {
      label = orders.find((o) => o.id === l.subjectId)?.orderNumber ?? "order";
      href = `/orders/${l.subjectId}`;
    } else if (l.subjectType === "customer_location") {
      label = locs.find((x) => x.id === l.subjectId)?.tradeName ?? "account";
      href = `/locations/${l.subjectId}`;
    } else if (l.subjectType === "notice") {
      label = "notice";
      href = `/admin/notices?focus=${l.subjectId}`;
    } else if (l.subjectType === "order_intake_request") {
      label = "email intake";
      href = `/admin/intake`;
    } else if (l.subjectType === "standing_arrangement") {
      label = "standing arrangement";
    }
    const list = out.get(l.caseId) ?? [];
    list.push({ ...l, label, href });
    out.set(l.caseId, list);
  }
  return out;
}

/** Reopen a resolved case deliberately (the condition returned); history stays. */
export async function reopenException(db: DbOrTx, actor: Actor, caseId: string, note: string) {
  const [prior] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.id, caseId));
  if (!prior) throw new BusinessError("Exception case not found");
  authorize(actor, "exception.manage", { marketId: prior.marketId });
  if (prior.state !== "resolved") throw new StaleStateError("The case is not resolved.");
  if (!note.trim()) throw new BusinessError("Say why the case is reopened", { field: "note" });
  const [row] = await db
    .update(schema.exceptionCase)
    .set({ state: "open", resolution: null, resolvedAt: null, resolvedByEmployeeId: null, updatedAt: new Date() })
    .where(and(eq(schema.exceptionCase.id, caseId), eq(schema.exceptionCase.state, "resolved")))
    .returning();
  if (!row) throw new StaleStateError("The case changed while you were editing.");
  await db.insert(schema.exceptionNote).values({ caseId, actorEmployeeId: actor.employeeId, actorKind: actor.kind === "dev_fixture" ? "dev_fixture" : actor.kind, kind: "state_change", body: `resolved → open: ${note}` });
  await recordAudit(db, actor, { action: "exception.reopen", subjectType: "exception_case", subjectId: caseId, prior: { state: "resolved" }, current: { state: "open" }, reason: note, marketId: prior.marketId });
  return row;
}

export async function countOpenExceptions(db: DbOrTx, marketIds: "all" | string[]) {
  const conds = [ne(schema.exceptionCase.state, "resolved")];
  if (marketIds !== "all") {
    if (marketIds.length === 0) return 0;
    conds.push(inArray(schema.exceptionCase.marketId, marketIds));
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.exceptionCase).where(and(...conds));
  return n;
}

export async function getExceptionDetail(db: DbOrTx, caseId: string) {
  const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.id, caseId));
  if (!c) return null;
  const links = await db.select().from(schema.exceptionLink).where(eq(schema.exceptionLink.caseId, caseId));
  const notes = await db.select().from(schema.exceptionNote).where(eq(schema.exceptionNote.caseId, caseId)).orderBy(schema.exceptionNote.at);
  const children = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.parentCaseId, caseId));
  return { case: c, links, notes, children };
}
