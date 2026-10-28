import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { marketScopeFor, type Actor } from "@/lib/authz/actor";
import { authorize, can } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { withTx, type DbOrTx, type Tx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { openException, resolveByDedupeKeys } from "@/lib/exceptions/service";
import { getPolicy } from "@/lib/policy/policy";
import { adjustLineReservation, releaseLineReservations, reserveForLine } from "../allocation/service";
import { KEG_DEPOSIT_CENTS, MINIMUM_DELIVERY_CENTS, currentPrice } from "../catalog/service";
import { primaryWarehouse } from "../markets/service";
import { createNoticeIntent, withdrawPendingNotices } from "../notices/service";

/**
 * Order intake (brief §12–§15, O12–O18).
 *
 * Flow: location → SKU → quantity → optional date/notes → submit.
 * - Fixed market prices; Sales cannot override.
 * - Unique market-specific order number (technical syntax: CODE-000123, T06).
 * - Submission consumes supportable allocation FCFS; unmet demand retained.
 * - Holds and readiness gaps never block capture (U06–U07).
 * - $90 minimum is evaluated and flagged; the basis is D11 (unselected).
 * - Abnormal orders are flagged only by a person or a selected D09 criterion.
 */

export interface OrderLineInput {
  skuId: string;
  qty: number;
}

export interface SubmitOrderInput {
  locationId: string;
  lines: OrderLineInput[];
  requestedDate?: string | null;
  notes?: string | null;
  source?: "sales" | "email" | "standing";
  /** Idempotency for one submission (replay-safe); a legitimate repeat order uses a new key. */
  submissionKey?: string | null;
  intakeRequestId?: string | null;
  standingOccurrenceId?: string | null;
  /** Rep at transaction; defaults to the actor when the actor holds Sales. */
  repEmployeeId?: string | null;
}

export interface MinimumEvaluation {
  thresholdCents: number;
  merchandiseCents: number;
  depositCents: number;
  kegCount: number;
  candidates: Record<string, number>;
  verdict: "meets" | "below" | "depends_on_unselected_D11";
  basis: "unselected" | string;
}

export function evaluateMinimum(
  lines: Array<{ qty: number; unitPriceCents: number; kegsPerUnit: number }>,
  d11: { status: "unselected" } | { status: "selected"; selection: Record<string, unknown> },
): MinimumEvaluation {
  const merchandiseCents = lines.reduce((s, l) => s + l.qty * l.unitPriceCents, 0);
  const kegCount = lines.reduce((s, l) => s + l.qty * l.kegsPerUnit, 0);
  const depositCents = kegCount * KEG_DEPOSIT_CENTS;
  const candidates = {
    merchandise_only: merchandiseCents,
    merchandise_plus_deposits: merchandiseCents + depositCents,
  };
  if (d11.status === "selected" && typeof d11.selection.value_basis === "string" && d11.selection.value_basis in candidates) {
    const basis = d11.selection.value_basis as keyof typeof candidates;
    return {
      thresholdCents: MINIMUM_DELIVERY_CENTS,
      merchandiseCents,
      depositCents,
      kegCount,
      candidates,
      verdict: candidates[basis] >= MINIMUM_DELIVERY_CENTS ? "meets" : "below",
      basis,
    };
  }
  const values = Object.values(candidates);
  const allMeet = values.every((v) => v >= MINIMUM_DELIVERY_CENTS);
  const noneMeet = values.every((v) => v < MINIMUM_DELIVERY_CENTS);
  return {
    thresholdCents: MINIMUM_DELIVERY_CENTS,
    merchandiseCents,
    depositCents,
    kegCount,
    candidates,
    verdict: allMeet ? "meets" : noneMeet ? "below" : "depends_on_unselected_D11",
    basis: "unselected",
  };
}

async function nextOrderNumber(tx: Tx, marketId: string): Promise<string> {
  const [m] = await tx.select().from(schema.market).where(eq(schema.market.id, marketId)).for("update");
  if (!m) throw new Error("Market not found");
  const seq = m.orderSeq;
  await tx.update(schema.market).set({ orderSeq: seq + 1 }).where(eq(schema.market.id, marketId));
  return `${m.code}-${String(seq).padStart(6, "0")}`;
}

export interface SubmitOrderResult {
  order: typeof schema.order.$inferSelect;
  lines: Array<typeof schema.orderLine.$inferSelect & { reservedQty: number; unmetQty: number }>;
  replayed: boolean;
  minimum: MinimumEvaluation;
  shortage: boolean;
}

/** Stable hash of what was asked for, so a replayed key with different content is refused (AC12). */
export function submissionPayloadHash(input: Pick<SubmitOrderInput, "locationId" | "lines" | "requestedDate" | "notes">): string {
  const merged = new Map<string, number>();
  for (const l of input.lines) merged.set(l.skuId, (merged.get(l.skuId) ?? 0) + l.qty);
  const canonical = JSON.stringify({
    locationId: input.locationId,
    lines: Array.from(merged.entries()).sort(([a], [b]) => a.localeCompare(b)),
    requestedDate: input.requestedDate?.trim() || null,
    notes: input.notes?.trim() || null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function submitOrder(db: DbOrTx, actor: Actor, input: SubmitOrderInput): Promise<SubmitOrderResult> {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
  if (!loc) throw new BusinessError("Location not found", { field: "locationId" });
  authorize(actor, "order.submit", { marketId: loc.marketId });
  if (!input.lines.length) throw new BusinessError("At least one line is required", { field: "lines" });
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new BusinessError("Quantities must be positive whole numbers", { field: "lines" });
  }
  const merged = new Map<string, number>();
  for (const l of input.lines) merged.set(l.skuId, (merged.get(l.skuId) ?? 0) + l.qty);
  const payloadHash = submissionPayloadHash(input);

  return withTx(db, async (tx) => {
    // Lock the location row: serializes same-location submissions so a replayed key is seen exactly once
    // and the location's current status is the one we decide on (REV-10/AC11: closed locations refuse capture).
    const [lockedLoc] = await tx.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId)).for("update");
    if (lockedLoc.status === "closed") throw new StaleStateError("This location is closed; reopen it (Admin) before capturing new demand.");
    if (input.submissionKey) {
      const [existing] = await tx
        .select()
        .from(schema.order)
        .where(and(eq(schema.order.locationId, input.locationId), eq(schema.order.submissionKey, input.submissionKey)))
        .limit(1);
      if (existing) {
        if (existing.submissionPayloadHash && existing.submissionPayloadHash !== payloadHash) {
          throw new StaleStateError(
            `This submission was already recorded as ${existing.orderNumber} with different content. Nothing was changed — open ${existing.orderNumber} to amend it, or start a new order to add demand.`,
          );
        }
        const lines = await linesWithAllocation(tx, existing.id);
        return {
          order: existing,
          lines,
          replayed: true,
          minimum: existing.minimumEvaluation as MinimumEvaluation,
          shortage: lines.some((l) => l.unmetQty > 0),
        };
      }
    }
    const warehouseId = lockedLoc.warehouseOverrideId ?? (await primaryWarehouse(tx, loc.marketId))?.id ?? null;
    if (!warehouseId) throw new BusinessError("No primary warehouse is configured for this market (Admin: Markets → warehouses)");

    const priced: Array<{ skuId: string; qty: number; unitPriceCents: number; marketPriceId: string; kegsPerUnit: number; skuName: string }> = [];
    for (const [skuId, qty] of merged) {
      const [s] = await tx.select().from(schema.sku).where(eq(schema.sku.id, skuId));
      if (!s) throw new BusinessError("Unknown product", { field: "lines" });
      if (s.archivedAt) throw new BusinessError(`${s.name} is archived and cannot be newly ordered`, { field: `qty:${skuId}` });
      const price = await currentPrice(tx, loc.marketId, skuId);
      if (!price) throw new BusinessError(`${s.name} has no price in this market; Admin must set one`, { field: `qty:${skuId}` });
      priced.push({ skuId, qty, unitPriceCents: price.priceCents, marketPriceId: price.id, kegsPerUnit: s.kegsPerUnit, skuName: s.name });
    }

    const d11 = await getPolicy(tx, "D11", { marketId: loc.marketId });
    const minimum = evaluateMinimum(priced, d11);
    const abnormal = await evaluateAbnormal(tx, priced, loc.marketId);

    const orderNumber = await nextOrderNumber(tx, loc.marketId);
    const repEmployeeId = input.repEmployeeId ?? (can(actor, "order.submit") && actor.grants.some((g) => g.role === "sales") ? actor.employeeId : loc.currentRepEmployeeId);
    const [ord] = await tx
      .insert(schema.order)
      .values({
        marketId: loc.marketId,
        locationId: loc.id,
        orderNumber,
        source: input.source ?? "sales",
        requestedDate: input.requestedDate?.trim() || null,
        notes: input.notes?.trim() || null,
        repEmployeeId,
        submittedByEmployeeId: actor.employeeId,
        submissionKey: input.submissionKey ?? null,
        submissionPayloadHash: input.submissionKey ? payloadHash : null,
        intakeRequestId: input.intakeRequestId ?? null,
        standingOccurrenceId: input.standingOccurrenceId ?? null,
        warehouseId,
        abnormalFlag: abnormal.flag,
        abnormalReason: abnormal.reason,
        minimumEvaluation: minimum,
      })
      .returning();

    const lines: SubmitOrderResult["lines"] = [];
    let lineNo = 1;
    let shortage = false;
    for (const p of priced) {
      const [line] = await tx
        .insert(schema.orderLine)
        .values({
          orderId: ord.id,
          lineNo: lineNo++,
          skuId: p.skuId,
          orderedQty: p.qty,
          currentQty: p.qty,
          unitPriceCentsAtSubmission: p.unitPriceCents,
          marketPriceIdAtSubmission: p.marketPriceId,
          kegsPerUnit: p.kegsPerUnit,
        })
        .returning();
      const r = await reserveForLine(tx, actor, { orderLineId: line.id, warehouseId, skuId: p.skuId, qty: p.qty });
      if (r.unmetQty > 0) shortage = true;
      lines.push({ ...line, reservedQty: r.reservedQty, unmetQty: r.unmetQty });
    }

    await recordAudit(tx, actor, {
      action: "order.submit",
      subjectType: "order",
      subjectId: ord.id,
      current: {
        orderNumber,
        locationId: loc.id,
        lines: lines.map((l) => ({ skuId: l.skuId, qty: l.orderedQty, unitPriceCents: l.unitPriceCentsAtSubmission, reserved: l.reservedQty, unmet: l.unmetQty })),
        minimum: minimum.verdict,
        abnormal: abnormal.flag,
      },
      marketId: loc.marketId,
    });

    if (shortage) {
      await openException(tx, actor, {
        category: "allocation_shortage",
        title: `Shortage on ${orderNumber} — ${loc.tradeName}`,
        cause: lines
          .filter((l) => l.unmetQty > 0)
          .map((l) => `${priced.find((p) => p.skuId === l.skuId)?.skuName}: ${l.unmetQty} unmet of ${l.orderedQty}`)
          .join("; "),
        marketId: loc.marketId,
        locationId: loc.id,
        ownerRole: "admin",
        nextAction: "Source, reallocate, delay or agree partial fulfilment (D14/D15 remain unselected).",
        dedupeKey: `allocation_shortage:${ord.id}`,
        links: [{ subjectType: "order", subjectId: ord.id }],
      });
    }
    if (minimum.verdict !== "meets") {
      await openException(tx, actor, {
        category: "below_minimum",
        title: `${orderNumber} ${minimum.verdict === "below" ? "is below" : "may be below"} the $90 minimum — ${loc.tradeName}`,
        cause: `Merchandise ${(minimum.merchandiseCents / 100).toFixed(2)}, deposits ${(minimum.depositCents / 100).toFixed(2)}; value basis is D11 (unselected).`,
        marketId: loc.marketId,
        locationId: loc.id,
        ownerRole: "admin",
        nextAction: "Consolidate with other demand, delay, or approve an exception before release. Never bill undelivered goods to reach the minimum.",
        dedupeKey: `below_minimum:${ord.id}`,
        links: [{ subjectType: "order", subjectId: ord.id }],
      });
    }
    if (abnormal.flag) {
      await openException(tx, actor, {
        category: "abnormal_order",
        title: `${orderNumber} flagged abnormal — ${loc.tradeName}`,
        cause: abnormal.reason ?? "Flagged",
        marketId: loc.marketId,
        locationId: loc.id,
        ownerRole: "admin",
        nextAction: "Confirm with the customer/rep; flagged is not rejected (O13).",
        dedupeKey: `abnormal_order:${ord.id}`,
        links: [{ subjectType: "order", subjectId: ord.id }],
      });
    }

    // Order-received notice intent (O16): recorded; sender allocation is D32/IG04 → manual single-sender process until selected.
    const recipient = await orderNoticeRecipient(tx, loc.id);
    await createNoticeIntent(tx, actor, {
      purpose: "order_received",
      subjectType: "order",
      subjectId: ord.id,
      marketId: loc.marketId,
      locationId: loc.id,
      recipientEmail: recipient?.email ?? null,
      recipientContactId: recipient?.contactId ?? null,
      content: {
        subject: `Order ${orderNumber} received — ${loc.tradeName}`,
        summary: `Order ${orderNumber} received for ${loc.tradeName}. This confirms receipt of your order; it is not a delivery date commitment.`,
        lines: lines.map((l) => ({ sku: priced.find((p) => p.skuId === l.skuId)?.skuName ?? l.skuId, qty: l.orderedQty })),
      },
    });

    return { order: ord, lines, replayed: false, minimum, shortage };
  });
}

async function evaluateAbnormal(
  tx: Tx,
  priced: Array<{ qty: number; skuName: string }>,
  marketId: string,
): Promise<{ flag: boolean; reason: string | null }> {
  const d09 = await getPolicy<{ abnormal_max_line_qty?: number; abnormal_max_order_units?: number }>(tx, "D09", { marketId });
  if (d09.status !== "selected") return { flag: false, reason: null };
  const maxLine = Number(d09.selection.abnormal_max_line_qty);
  const maxTotal = Number(d09.selection.abnormal_max_order_units);
  const total = priced.reduce((s, p) => s + p.qty, 0);
  const bigLine = Number.isFinite(maxLine) && maxLine > 0 ? priced.find((p) => p.qty > maxLine) : undefined;
  if (bigLine) return { flag: true, reason: `${bigLine.skuName} × ${bigLine.qty} exceeds D09 line criterion (${maxLine}) [${d09.kind} selection]` };
  if (Number.isFinite(maxTotal) && maxTotal > 0 && total > maxTotal) return { flag: true, reason: `Total ${total} units exceeds D09 order criterion (${maxTotal}) [${d09.kind} selection]` };
  return { flag: false, reason: null };
}

async function orderNoticeRecipient(tx: Tx, locationId: string) {
  const rows = await tx
    .select({ contactId: schema.contact.id, email: schema.contact.email, role: schema.locationContact.contactRole, mayOrder: schema.locationContact.mayOrder })
    .from(schema.locationContact)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
    .where(and(eq(schema.locationContact.locationId, locationId), eq(schema.locationContact.current, true)));
  return rows.find((r) => r.role === "buyer" && r.email) ?? rows.find((r) => r.mayOrder && r.email) ?? null;
}

export async function linesWithAllocation(db: DbOrTx, orderId: string) {
  const lines = await db.select().from(schema.orderLine).where(eq(schema.orderLine.orderId, orderId)).orderBy(schema.orderLine.lineNo);
  const out = [];
  for (const l of lines) {
    const res = await db.select().from(schema.reservation).where(eq(schema.reservation.orderLineId, l.id));
    const active = res.filter((r) => r.state === "reserved" || r.state === "route_committed");
    out.push({
      ...l,
      reservedQty: active.reduce((s, r) => s + r.reservedQty, 0),
      unmetQty: active.reduce((s, r) => s + r.unmetQty, 0),
    });
  }
  return out;
}

export async function getOrder(db: DbOrTx, orderId: string) {
  const [ord] = await db.select().from(schema.order).where(eq(schema.order.id, orderId));
  if (!ord) return null;
  const lines = await linesWithAllocation(db, orderId);
  const skus = await db.select().from(schema.sku).where(inArray(schema.sku.id, lines.map((l) => l.skuId)));
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, ord.locationId));
  const [market] = await db.select().from(schema.market).where(eq(schema.market.id, ord.marketId));
  const changes = await db
    .select()
    .from(schema.orderLineChange)
    .where(inArray(schema.orderLineChange.orderLineId, lines.map((l) => l.id)))
    .orderBy(desc(schema.orderLineChange.at));
  const exceptions = await db
    .select({ c: schema.exceptionCase })
    .from(schema.exceptionLink)
    .innerJoin(schema.exceptionCase, eq(schema.exceptionCase.id, schema.exceptionLink.caseId))
    .where(and(eq(schema.exceptionLink.subjectType, "order"), eq(schema.exceptionLink.subjectId, orderId)));
  const notices = await db.select().from(schema.notice).where(and(eq(schema.notice.subjectType, "order"), eq(schema.notice.subjectId, orderId)));
  const visits = await db.select().from(schema.deliveryVisitLine).where(eq(schema.deliveryVisitLine.orderId, orderId));
  const audit = await db
    .select()
    .from(schema.auditEvent)
    .where(and(eq(schema.auditEvent.subjectType, "order"), eq(schema.auditEvent.subjectId, orderId)))
    .orderBy(desc(schema.auditEvent.at));
  return {
    order: ord,
    lines: lines.map((l) => ({ ...l, sku: skus.find((s) => s.id === l.skuId)! })),
    location: loc,
    market,
    changes,
    exceptions: exceptions.map((e) => e.c),
    notices,
    visits,
    audit,
  };
}

/** Roles that may see commercial order records market-wide (Driver/Service sees only assigned execution context — REV-11). */
export const ORDER_VIEW_ROLES = ["owner", "admin", "accounting", "sales"] as const;

export async function listOrders(
  db: DbOrTx,
  actor: Actor,
  opts: { locationId?: string; marketId?: string; limit?: number; offset?: number; state?: string } = {},
) {
  const scope = marketScopeFor(actor, [...ORDER_VIEW_ROLES]);
  const conds = [];
  if (actor.kind !== "system" && !actor.grants.some((g) => g.role === "owner") && scope !== "all") {
    if (scope.length === 0) return [];
    conds.push(inArray(schema.order.marketId, scope));
  }
  if (opts.locationId) conds.push(eq(schema.order.locationId, opts.locationId));
  if (opts.marketId) conds.push(eq(schema.order.marketId, opts.marketId));
  if (opts.state === "open") conds.push(inArray(schema.order.demandState, ["submitted", "partially_fulfilled"]));
  else if (opts.state === "cancelled") conds.push(eq(schema.order.demandState, "cancelled"));
  return db
    .select({ order: schema.order, location: schema.customerLocation })
    .from(schema.order)
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.order.locationId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.order.submittedAt))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
}

/**
 * Cancel undelivered demand (brief §13). Actual receipt is never erased;
 * only reserved (not loaded) units are released. Loaded units raise a custody
 * reconciliation exception rather than a pretended warehouse receipt.
 */
export async function cancelUndeliveredDemand(db: DbOrTx, actor: Actor, orderId: string, reason: string) {
  const [pre] = await db.select().from(schema.order).where(eq(schema.order.id, orderId));
  if (!pre) throw new BusinessError("Order not found");
  authorize(actor, "order.cancel_undelivered", { marketId: pre.marketId });
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  return withTx(db, async (tx) => {
    // Lock the order so a competing amendment/cancellation sees the final state, not a stale page (REV-10, AC11).
    const [ord] = await tx.select().from(schema.order).where(eq(schema.order.id, orderId)).for("update");
    if (ord.demandState === "cancelled") throw new StaleStateError(`${ord.orderNumber} was already cancelled${ord.cancelledAt ? ` on ${ord.cancelledAt.toISOString().slice(0, 10)}` : ""}; nothing further to cancel.`);
    if (ord.demandState === "fulfilled") throw new StaleStateError(`${ord.orderNumber} is fulfilled; there is no undelivered demand to cancel.`);
    const lines = await tx.select().from(schema.orderLine).where(eq(schema.orderLine.orderId, orderId)).for("update");
    if (!lines.some((l) => l.currentQty - l.deliveredQty > 0)) throw new StaleStateError(`${ord.orderNumber} has no undelivered demand left.`);
    let routeCommitted = 0;
    let anyDelivered = false;
    for (const l of lines) {
      const cancellable = l.currentQty - l.deliveredQty;
      if (l.deliveredQty > 0) anyDelivered = true;
      if (cancellable <= 0) continue;
      await tx
        .update(schema.orderLine)
        .set({ currentQty: l.deliveredQty, cancelledQty: l.cancelledQty + cancellable })
        .where(eq(schema.orderLine.id, l.id));
      await tx.insert(schema.orderLineChange).values({
        orderLineId: l.id,
        actorEmployeeId: actor.employeeId,
        kind: "cancel",
        priorQty: l.currentQty,
        currentQty: l.deliveredQty,
        reason,
        policyStatus: "applied",
      });
      const rel = await releaseLineReservations(tx, actor, l.id, `Cancelled: ${reason}`);
      routeCommitted += rel.routeCommittedLeft;
    }
    const [row] = await tx
      .update(schema.order)
      .set({
        demandState: anyDelivered ? "fulfilled" : "cancelled",
        cancelledAt: new Date(),
        cancelReason: reason,
        cancelledByEmployeeId: actor.employeeId,
        updatedAt: new Date(),
      })
      .where(eq(schema.order.id, orderId))
      .returning();
    await recordAudit(tx, actor, {
      action: "order.cancel_undelivered",
      subjectType: "order",
      subjectId: orderId,
      prior: { demandState: ord.demandState, lines: lines.map((l) => ({ id: l.id, currentQty: l.currentQty })) },
      current: { demandState: row.demandState, routeCommittedUnitsToReconcile: routeCommitted },
      reason,
      marketId: ord.marketId,
    });
    // Cause gone → dependent shortage/minimum cases resolve and unsent notices about this order are withdrawn.
    await resolveByDedupeKeys(tx, actor, [`allocation_shortage:${orderId}`, `below_minimum:${orderId}`], "Demand cancelled");
    if (!anyDelivered) await withdrawPendingNotices(tx, actor, { subjectType: "order", subjectId: orderId, reason: `${ord.orderNumber} cancelled before the notice was sent` });
    if (routeCommitted > 0) {
      await openException(tx, actor, {
        category: "custody_reconciliation",
        title: `${ord.orderNumber} cancelled after loading — physical custody to reconcile`,
        cause: `${routeCommitted} loaded unit(s) were cancelled; releasing demand does not prove warehouse receipt (brief §13).`,
        marketId: ord.marketId,
        locationId: ord.locationId,
        ownerRole: "admin",
        nextAction: "Confirm actual custody/condition before any availability is restored (D16).",
        dedupeKey: `custody_reconciliation:${orderId}`,
        links: [{ subjectType: "order", subjectId: orderId }],
      });
    }
    return row;
  });
}

/**
 * Sales/Admin change request after submission (amend quantity, substitution).
 * Authority by commitment stage and price treatment are D10/D12 (unselected):
 * the request is recorded with the observed prices and routed to Admin; no
 * silent effect on demand, price or allocation.
 */
export async function requestOrderChange(
  db: DbOrTx,
  actor: Actor,
  input: { orderLineId: string; kind: "amend_qty" | "substitution_request"; requestedQty?: number; substituteSkuId?: string; reason: string },
) {
  const [line] = await db.select().from(schema.orderLine).where(eq(schema.orderLine.id, input.orderLineId));
  if (!line) throw new BusinessError("Order line not found");
  const [ord] = await db.select().from(schema.order).where(eq(schema.order.id, line.orderId));
  authorize(actor, "order.request_change", { marketId: ord.marketId });
  if (ord.demandState === "cancelled" || ord.demandState === "fulfilled") throw new StaleStateError(`${ord.orderNumber} is ${ord.demandState}; a change can no longer be requested.`);
  if (!input.reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  if (input.kind === "amend_qty" && (input.requestedQty === undefined || !Number.isInteger(input.requestedQty) || input.requestedQty < 0)) throw new BusinessError("Requested quantity must be a whole number", { field: "requestedQty" });
  const price = await currentPrice(db, ord.marketId, line.skuId);
  const [change] = await db
    .insert(schema.orderLineChange)
    .values({
      orderLineId: line.id,
      actorEmployeeId: actor.employeeId,
      kind: input.kind,
      priorQty: line.currentQty,
      currentQty: input.requestedQty ?? null,
      priorPriceCents: line.unitPriceCentsAtSubmission,
      proposedPriceCents: price?.priceCents ?? null,
      reason: input.reason + (input.substituteSkuId ? ` [substitute SKU ${input.substituteSkuId}]` : ""),
      policyStatus: "recorded_unselected_policy",
    })
    .returning();
  await recordAudit(db, actor, {
    action: "order.change_request",
    subjectType: "order",
    subjectId: ord.id,
    current: { lineId: line.id, kind: input.kind, requestedQty: input.requestedQty ?? null, substituteSkuId: input.substituteSkuId ?? null, submittedPrice: line.unitPriceCentsAtSubmission, currentMarketPrice: price?.priceCents ?? null },
    reason: input.reason,
    marketId: ord.marketId,
  });
  await openException(db, actor, {
    category: "order_change_request",
    title: `Change requested on ${ord.orderNumber}`,
    cause: `${input.kind}: ${input.reason}. Submitted price ${line.unitPriceCentsAtSubmission}¢, current market price ${price?.priceCents ?? "none"}¢.`,
    marketId: ord.marketId,
    locationId: ord.locationId,
    ownerRole: "admin",
    nextAction: "D10 (amendment authority by stage) and D12 (price commitment) are unselected. Admin may apply a quantity change before commitment only where no price question arises.",
    dedupeKey: `order_change_request:${change.id}`,
    links: [{ subjectType: "order", subjectId: ord.id }],
  });
  return change;
}

/**
 * Admin applies a quantity amendment before any physical commitment.
 * Allowed only when the submitted price equals the current market price for
 * added units (otherwise D12 must be selected first). Reservations are
 * adjusted once; history is retained.
 */
export async function adminAmendQuantity(db: DbOrTx, actor: Actor, orderLineId: string, newQty: number, reason: string) {
  const [pre] = await db.select().from(schema.orderLine).where(eq(schema.orderLine.id, orderLineId));
  if (!pre) throw new BusinessError("Order line not found");
  const [preOrd] = await db.select().from(schema.order).where(eq(schema.order.id, pre.orderId));
  authorize(actor, "allocation.resolve", { marketId: preOrd.marketId });
  if (!Number.isInteger(newQty) || newQty < 0) throw new BusinessError("New quantity must be a whole number", { field: "newQty" });
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  return withTx(db, async (tx) => {
    // Current state is decided under the order lock, never from what a page showed earlier (REV-10, AC11).
    const [ord] = await tx.select().from(schema.order).where(eq(schema.order.id, pre.orderId)).for("update");
    const [line] = await tx.select().from(schema.orderLine).where(eq(schema.orderLine.id, orderLineId)).for("update");
    if (ord.demandState === "cancelled") throw new StaleStateError(`${ord.orderNumber} is cancelled; it cannot be amended (place a new order instead).`);
    if (ord.demandState === "fulfilled") throw new StaleStateError(`${ord.orderNumber} is fulfilled; amend a delivered order through a correction, not an amendment.`);
    const [loc] = await tx.select({ status: schema.customerLocation.status }).from(schema.customerLocation).where(eq(schema.customerLocation.id, ord.locationId));
    if (loc?.status === "closed") throw new StaleStateError("The location is closed; existing demand can be cancelled but not increased.");
    if (newQty < line.deliveredQty) throw new BusinessError(`New quantity cannot be below the ${line.deliveredQty} already delivered`, { field: "newQty" });
    if (newQty === line.currentQty) throw new StaleStateError(`Quantity is already ${newQty}; nothing to change.`);
    const res = await tx.select().from(schema.reservation).where(eq(schema.reservation.orderLineId, orderLineId));
    if (res.some((r) => r.state === "route_committed")) throw new BusinessError("Line is loaded/route-committed; coordinate with the driver and use correction, not amendment (brief §13)", { code: "loaded_work" });
    if (newQty > line.currentQty) {
      const [sku] = await tx.select().from(schema.sku).where(eq(schema.sku.id, line.skuId));
      if (sku?.archivedAt) throw new BusinessError(`${sku.name} is archived; its quantity cannot be increased`, { field: "newQty" });
      const price = await currentPrice(tx, ord.marketId, line.skuId);
      if (!price || price.priceCents !== line.unitPriceCentsAtSubmission) {
        throw new BusinessError("Added quantity would need a price decision (D12 unselected): submitted price differs from the current market price", { code: "unselected_policy" });
      }
    }
    const remaining = newQty - line.deliveredQty;
    if (ord.warehouseId) {
      // Keeps this line's place in the queue: a reduction frees units to older waiting demand, an increase queues behind it (AC10).
      await adjustLineReservation(tx, actor, { orderLineId, warehouseId: ord.warehouseId, skuId: line.skuId, targetRemaining: remaining });
    } else if (remaining <= 0) {
      await releaseLineReservations(tx, actor, orderLineId, `Amendment: ${reason}`);
    }
    const [row] = await tx.update(schema.orderLine).set({ currentQty: newQty }).where(eq(schema.orderLine.id, orderLineId)).returning();
    await tx.insert(schema.orderLineChange).values({
      orderLineId,
      actorEmployeeId: actor.employeeId,
      kind: "amend_qty",
      priorQty: line.currentQty,
      currentQty: newQty,
      reason,
      policyStatus: "applied",
    });
    await reassessOrder(tx, actor, ord.id);
    await recordAudit(tx, actor, {
      action: "order.amend_qty",
      subjectType: "order",
      subjectId: ord.id,
      prior: { lineId: orderLineId, currentQty: line.currentQty },
      current: { lineId: orderLineId, currentQty: newQty },
      reason,
      marketId: ord.marketId,
    });
    return row;
  });
}

/**
 * After an amendment: recompute the $90 evaluation over current demand and
 * open/resolve the below-minimum and shortage cases from the new facts
 * (brief §13: an authorized amendment reassesses minimum and reservation).
 */
async function reassessOrder(tx: Tx, actor: Actor, orderId: string) {
  const [ord] = await tx.select().from(schema.order).where(eq(schema.order.id, orderId));
  const [loc] = await tx.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, ord.locationId));
  const lines = await linesWithAllocation(tx, orderId);
  const live = lines.filter((l) => l.currentQty - l.deliveredQty > 0);
  const d11 = await getPolicy(tx, "D11", { marketId: ord.marketId });
  const minimum = evaluateMinimum(live.map((l) => ({ qty: l.currentQty, unitPriceCents: l.unitPriceCentsAtSubmission, kegsPerUnit: l.kegsPerUnit })), d11);
  await tx.update(schema.order).set({ minimumEvaluation: minimum, updatedAt: new Date() }).where(eq(schema.order.id, orderId));
  const shortage = live.some((l) => l.unmetQty > 0);
  if (shortage) {
    await openException(tx, actor, {
      category: "allocation_shortage",
      title: `Shortage on ${ord.orderNumber} — ${loc?.tradeName ?? ""}`,
      cause: live.filter((l) => l.unmetQty > 0).map((l) => `line ${l.lineNo}: ${l.unmetQty} unmet`).join("; "),
      marketId: ord.marketId,
      locationId: ord.locationId,
      ownerRole: "admin",
      nextAction: "Source, reallocate, delay or agree partial fulfilment (D14/D15 remain unselected).",
      dedupeKey: `allocation_shortage:${orderId}`,
      links: [{ subjectType: "order", subjectId: orderId }],
    });
  } else {
    await resolveByDedupeKeys(tx, actor, [`allocation_shortage:${orderId}`], "No unmet demand after amendment");
  }
  if (minimum.verdict !== "meets" && live.length > 0) {
    await openException(tx, actor, {
      category: "below_minimum",
      title: `${ord.orderNumber} ${minimum.verdict === "below" ? "is below" : "may be below"} the $90 minimum after amendment`,
      cause: `Merchandise ${(minimum.merchandiseCents / 100).toFixed(2)}, deposits ${(minimum.depositCents / 100).toFixed(2)}; value basis is D11 (${minimum.basis}).`,
      marketId: ord.marketId,
      locationId: ord.locationId,
      ownerRole: "admin",
      nextAction: "Consolidate with other demand, delay, or approve an exception before release. Never bill undelivered goods to reach the minimum.",
      dedupeKey: `below_minimum:${orderId}`,
      links: [{ subjectType: "order", subjectId: orderId }],
    });
  } else {
    await resolveByDedupeKeys(tx, actor, [`below_minimum:${orderId}`], "Meets the minimum after amendment");
  }
}

export async function flagAbnormal(db: DbOrTx, actor: Actor, orderId: string, reason: string) {
  const [ord] = await db.select().from(schema.order).where(eq(schema.order.id, orderId));
  if (!ord) throw new BusinessError("Order not found");
  authorize(actor, "order.flag_abnormal", { marketId: ord.marketId });
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  if (ord.abnormalFlag) throw new StaleStateError(`${ord.orderNumber} is already flagged`);
  const [row] = await db.update(schema.order).set({ abnormalFlag: true, abnormalReason: reason, updatedAt: new Date() }).where(eq(schema.order.id, orderId)).returning();
  await recordAudit(db, actor, { action: "order.flag_abnormal", subjectType: "order", subjectId: orderId, prior: { abnormalFlag: ord.abnormalFlag }, current: { abnormalFlag: true }, reason, marketId: ord.marketId });
  await openException(db, actor, {
    category: "abnormal_order",
    title: `${ord.orderNumber} flagged abnormal`,
    cause: reason,
    marketId: ord.marketId,
    locationId: ord.locationId,
    ownerRole: "admin",
    nextAction: "Confirm with the customer/rep; flagged is not rejected (O13).",
    dedupeKey: `abnormal_order:${orderId}`,
    links: [{ subjectType: "order", subjectId: orderId }],
  });
  return row;
}

export interface RepeatPreviewLine {
  skuId: string;
  skuName: string;
  qty: number;
  previousPriceCents: number;
  currentPriceCents: number | null;
  orderable: boolean;
  change: "none" | "price_changed" | "archived" | "no_price";
}

/**
 * Repeat-order preview (O14, R17 [R], UX-03): shows the prior order's lines
 * against the CURRENT catalog and prices before anything is submitted;
 * archived products are not resurrected, changed prices are marked, and the
 * new order gets its own business identity (a fresh submission key).
 */
export async function repeatOrderPreview(db: DbOrTx, orderId: string): Promise<{ sourceOrder: typeof schema.order.$inferSelect | null; lines: RepeatPreviewLine[] }> {
  const [last] = await db.select().from(schema.order).where(eq(schema.order.id, orderId)).limit(1);
  if (!last) return { sourceOrder: null, lines: [] };
  return previewFromOrder(db, last);
}

export async function repeatLastOrderPreview(db: DbOrTx, locationId: string): Promise<{ sourceOrder: typeof schema.order.$inferSelect | null; lines: RepeatPreviewLine[] }> {
  const [last] = await db
    .select()
    .from(schema.order)
    .where(and(eq(schema.order.locationId, locationId), ne(schema.order.demandState, "cancelled")))
    .orderBy(desc(schema.order.submittedAt))
    .limit(1);
  if (!last) return { sourceOrder: null, lines: [] };
  return previewFromOrder(db, last);
}

async function previewFromOrder(db: DbOrTx, last: typeof schema.order.$inferSelect): Promise<{ sourceOrder: typeof schema.order.$inferSelect; lines: RepeatPreviewLine[] }> {
  const lines = await db.select().from(schema.orderLine).where(eq(schema.orderLine.orderId, last.id)).orderBy(schema.orderLine.lineNo);
  const out: RepeatPreviewLine[] = [];
  for (const l of lines) {
    const [s] = await db.select().from(schema.sku).where(eq(schema.sku.id, l.skuId));
    const price = await currentPrice(db, last.marketId, l.skuId);
    const archived = Boolean(s?.archivedAt);
    out.push({
      skuId: l.skuId,
      skuName: s?.name ?? "Unknown",
      qty: l.orderedQty,
      previousPriceCents: l.unitPriceCentsAtSubmission,
      currentPriceCents: price?.priceCents ?? null,
      orderable: !archived && price !== null,
      change: archived ? "archived" : price === null ? "no_price" : price.priceCents !== l.unitPriceCentsAtSubmission ? "price_changed" : "none",
    });
  }
  return { sourceOrder: last, lines: out };
}

/** Demand a market currently holds: submitted orders with remaining quantity, for the command center. */
export async function openDemandSummary(db: DbOrTx, marketIds: "all" | string[]) {
  const conds = [inArray(schema.order.demandState, ["submitted", "partially_fulfilled"])];
  if (marketIds !== "all") {
    if (marketIds.length === 0) return { orders: 0, unmetUnits: 0 };
    conds.push(inArray(schema.order.marketId, marketIds));
  }
  const [{ orders }] = await db.select({ orders: sql<number>`count(*)::int` }).from(schema.order).where(and(...conds));
  const [{ unmet }] = await db
    .select({ unmet: sql<number>`coalesce(sum(${schema.reservation.unmetQty}),0)::int` })
    .from(schema.reservation)
    .innerJoin(schema.orderLine, eq(schema.orderLine.id, schema.reservation.orderLineId))
    .innerJoin(schema.order, eq(schema.order.id, schema.orderLine.orderId))
    .where(and(eq(schema.reservation.state, "reserved"), ...conds));
  return { orders, unmetUnits: unmet };
}
