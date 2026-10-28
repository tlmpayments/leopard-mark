import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Actor } from "@/lib/authz/actor";
import { can } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";

/**
 * Account / order activity timeline (UX-05). Composed from the existing
 * authoritative records (audit events for the location, its orders and its
 * notices; order line changes; exception notes) — no event store, no
 * duplicated business records. Permission-filtered: financial/access facts
 * are shown only to roles that may see them, and the whole timeline is
 * refused outside the actor's market authority. Paginated by (at, id)
 * cursor so older history is always reachable.
 */
export interface TimelineEntry {
  id: string;
  at: Date;
  actorKind: string;
  actorName: string | null;
  action: string;
  /** Plain-language description. */
  text: string;
  reason: string | null;
  subjectType: string;
  subjectId: string;
  href: string | null;
  /** Supporting structured detail for Admin/Owner (never bearer URLs or secrets). */
  detail: unknown;
}

export interface TimelineResult {
  allowed: boolean;
  entries: TimelineEntry[];
  nextCursor: string | null;
}

const ACTION_TEXT: Record<string, (a: typeof schema.auditEvent.$inferSelect) => string> = {
  "location.create": () => "Account created",
  "location.edit_operational": () => "Operational details edited",
  "location.status": (a) => `Status changed to ${(a.current as { status?: string })?.status ?? "?"}`,
  "location.assign_rep": () => "Current rep changed",
  "location.warehouse_override": () => "Default warehouse changed",
  "location.billing_email.request": (a) => `Billing-email change requested (${(a.current as { requested?: string })?.requested ?? ""})`,
  "location.billing_email.approved": (a) => `Billing-email change approved → ${(a.current as { billingEmail?: string })?.billingEmail ?? ""}`,
  "location.billing_email.rejected": () => "Billing-email change rejected",
  "license.decision": (a) => `License decision: ${(a.current as { state?: string })?.state?.replace(/_/g, " ") ?? ""}`,
  "hold.create": (a) => `Hold placed (${(a.current as { kind?: string })?.kind?.replace(/_/g, " ") ?? ""})`,
  "hold.resolve": () => "Hold cause resolved",
  "hold.override": () => "Delivery override granted (audited)",
  "hold.override_withdraw": () => "Delivery override withdrawn",
  "payment.request_setup": () => "Payment setup requested",
  "payment.set_payer": () => "Payer authority assigned",
  "payment.clear_payer": () => "Payer authority revoked",
  "payment.direct_revocation": () => "Customer revoked payment authorization",
  "stripe.customer.request": () => "Stripe customer association requested",
  "stripe.customer.established": () => "Stripe customer established",
  "stripe.hosted_setup.created": () => "Hosted setup link issued",
  "order.submit": (a) => `Order ${(a.current as { orderNumber?: string })?.orderNumber ?? ""} recorded`,
  "order.cancel_undelivered": () => "Undelivered demand cancelled",
  "order.change_request": (a) => `Change requested (${(a.current as { kind?: string })?.kind?.replace(/_/g, " ") ?? ""})`,
  "order.amend_qty": (a) => `Quantity amended ${(a.prior as { currentQty?: number })?.currentQty ?? "?"} → ${(a.current as { currentQty?: number })?.currentQty ?? "?"}`,
  "order.flag_abnormal": () => "Flagged abnormal (not rejected)",
  "order.reassign_warehouse": () => "Order reassigned to another warehouse",
  "allocation.fill_unmet": (a) => `Waiting demand filled: ${(a.prior as { unmetQty?: number })?.unmetQty ?? "?"} → ${(a.current as { unmetQty?: number })?.unmetQty ?? "?"} unmet`,
  "allocation.admin_release": () => "Reserved units released by Admin (demand retained)",
  "allocation.admin_requeue": () => "Displaced demand re-queued",
  "standing.create": () => "Standing arrangement captured",
  "standing.state": (a) => `Standing arrangement ${(a.current as { state?: string })?.state ?? ""}`,
  "notice.sent": () => "Notice sent (manual process, recorded by staff)",
  "notice.failed": () => "Notice send failed",
  "notice.unknown": () => "Notice outcome unknown",
  "notice.reissue": () => "Notice re-issued as a new version",
  "notice.withdrawn": () => "Notice withdrawn before sending (cause gone)",
  "exception.open": (a) => `Case opened: ${(a.current as { title?: string })?.title ?? ""}`,
  "exception.transition": (a) => `Case ${(a.current as { state?: string })?.state ?? "updated"}`,
  "exception.resolve_by_cause": () => "Case resolved (cause gone)",
  "exception.reopen": () => "Case reopened",
  "sample.withdraw": () => "Sample withdrawn",
  "sample.return": () => "Sample returned",
  "sample.correct": () => "Sample corrected",
  "intake.convert": () => "Email intake converted to an order",
};

/** Actions whose facts are financial/access-sensitive: hidden from roles without payment.view. */
const FINANCE_ACTIONS = new Set(["payment.request_setup", "payment.set_payer", "payment.clear_payer", "payment.direct_revocation", "stripe.customer.request", "stripe.customer.established", "stripe.hosted_setup.created"]);

function encodeCursor(at: Date, id: string) {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}
function decodeCursor(c: string | null | undefined): { at: Date; id: string } | null {
  if (!c) return null;
  try {
    const [iso, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !id) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export async function activityTimeline(
  db: DbOrTx,
  actor: Actor,
  scope: { locationId?: string; orderId?: string; cursor?: string | null; limit?: number; kinds?: Array<"orders" | "readiness" | "contacts" | "cases" | "notices" | "payment"> },
): Promise<TimelineResult> {
  const limit = Math.min(Math.max(scope.limit ?? 30, 5), 100);
  let marketId: string | null = null;
  let locationId = scope.locationId ?? null;
  const subjects: Array<{ type: string; id: string }> = [];
  if (scope.orderId) {
    const [o] = await db.select().from(schema.order).where(eq(schema.order.id, scope.orderId));
    if (!o) return { allowed: false, entries: [], nextCursor: null };
    marketId = o.marketId;
    locationId = locationId ?? null;
    subjects.push({ type: "order", id: o.id });
    if (!can(actor, "order.view", { marketId })) return { allowed: false, entries: [], nextCursor: null };
  }
  if (locationId) {
    const [l] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
    if (!l) return { allowed: false, entries: [], nextCursor: null };
    marketId = l.marketId;
    if (!can(actor, "location.view", { marketId })) return { allowed: false, entries: [], nextCursor: null };
    subjects.push({ type: "customer_location", id: l.id });
    const orders = await db.select({ id: schema.order.id }).from(schema.order).where(eq(schema.order.locationId, l.id));
    for (const o of orders) subjects.push({ type: "order", id: o.id });
  }
  if (subjects.length === 0) return { allowed: false, entries: [], nextCursor: null };
  // Notices and cases linked to these subjects.
  const noticeIds = await db
    .select({ id: schema.notice.id })
    .from(schema.notice)
    .where(or(...subjects.map((s) => and(eq(schema.notice.subjectType, s.type), eq(schema.notice.subjectId, s.id))!))!);
  for (const n of noticeIds) subjects.push({ type: "notice", id: n.id });
  const caseIds = await db
    .select({ caseId: schema.exceptionLink.caseId })
    .from(schema.exceptionLink)
    .where(or(...subjects.map((s) => and(eq(schema.exceptionLink.subjectType, s.type), eq(schema.exceptionLink.subjectId, s.id))!))!);
  for (const c of new Set(caseIds.map((c) => c.caseId))) subjects.push({ type: "exception_case", id: c });

  const showFinance = can(actor, "payment.view", { marketId });
  const showAudit = can(actor, "audit.view", { marketId });
  const cursor = decodeCursor(scope.cursor);
  const subjectCond = or(...subjects.map((s) => and(eq(schema.auditEvent.subjectType, s.type), eq(schema.auditEvent.subjectId, s.id))!))!;
  const conds = [subjectCond];
  if (cursor) conds.push(or(lt(schema.auditEvent.at, cursor.at), and(eq(schema.auditEvent.at, cursor.at), lt(schema.auditEvent.id, cursor.id))!)!);
  if (!showFinance) conds.push(sql`${schema.auditEvent.action} not in (${sql.join([...FINANCE_ACTIONS].map((a) => sql`${a}`), sql`, `)})`);
  if (scope.kinds?.length) {
    const prefixes: string[] = [];
    for (const k of scope.kinds) {
      if (k === "orders") prefixes.push("order.", "allocation.", "standing.", "intake.");
      if (k === "readiness") prefixes.push("license.", "hold.", "location.status");
      if (k === "contacts") prefixes.push("location.billing_email", "location.edit_operational", "location.assign_rep", "location.create", "location.warehouse_override");
      if (k === "cases") prefixes.push("exception.");
      if (k === "notices") prefixes.push("notice.");
      if (k === "payment") prefixes.push("payment.", "stripe.");
    }
    conds.push(or(...prefixes.map((p) => sql`${schema.auditEvent.action} like ${p + "%"}`))!);
  }
  const rows = await db
    .select()
    .from(schema.auditEvent)
    .where(and(...conds))
    .orderBy(desc(schema.auditEvent.at), desc(schema.auditEvent.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const employeeIds = Array.from(new Set(page.map((r) => r.actorEmployeeId).filter((x): x is string => Boolean(x))));
  const employees = employeeIds.length ? await db.select({ id: schema.employee.id, displayName: schema.employee.displayName }).from(schema.employee).where(inArray(schema.employee.id, employeeIds)) : [];
  const orderIds = page.filter((r) => r.subjectType === "order").map((r) => r.subjectId);
  const orders = orderIds.length ? await db.select({ id: schema.order.id, orderNumber: schema.order.orderNumber }).from(schema.order).where(inArray(schema.order.id, orderIds)) : [];
  const entries: TimelineEntry[] = page.map((r) => {
    const text = ACTION_TEXT[r.action]?.(r) ?? r.action.replace(/[._]/g, " ");
    const orderNumber = orders.find((o) => o.id === r.subjectId)?.orderNumber;
    return {
      id: r.id,
      at: r.at,
      actorKind: r.actorKind,
      actorName: employees.find((e) => e.id === r.actorEmployeeId)?.displayName ?? (r.actorKind === "system" ? "System" : null),
      action: r.action,
      text: orderNumber && r.subjectType === "order" && !text.includes(orderNumber) ? `${orderNumber}: ${text}` : text,
      reason: r.reason,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      href: r.subjectType === "order" ? `/orders/${r.subjectId}` : r.subjectType === "exception_case" ? `/admin/exceptions/${r.subjectId}` : r.subjectType === "customer_location" ? `/locations/${r.subjectId}` : null,
      detail: showAudit ? { prior: r.prior, current: r.current } : null,
    };
  });
  const last = page[page.length - 1];
  return { allowed: true, entries, nextCursor: rows.length > limit && last ? encodeCursor(last.at, last.id) : null };
}
