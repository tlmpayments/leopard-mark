import { and, desc, eq, inArray } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { marketScopeFor, type Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { withTx, type DbOrTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { openException, resolveByDedupeKeys } from "@/lib/exceptions/service";

/**
 * Customer notices (brief §42, D32/IG04, REV-18 / UX-08).
 *
 * A notice is an INTENT: purpose, linked subject, intended recipient,
 * content/version. Sender allocation is unselected (D32/IG04), so nothing is
 * sent automatically: an authorized person sends through the company's
 * single manual process and records the outcome here — sent, failed or
 * unknown — with evidence. Intent, recorded send and provider-confirmed
 * delivery are three different facts and are never inferred from each other.
 *
 * One pending intent per business purpose/subject/version (dedupe key); a
 * deliberate new version supersedes the old one and keeps it as history.
 */

export type NoticePurpose = "order_received" | "payment_setup_invitation";

export const NOTICE_PURPOSE_LABEL: Record<string, string> = {
  order_received: "Order received",
  payment_setup_invitation: "Payment setup invitation",
};

export interface NoticeContent {
  subject?: string;
  summary: string;
  lines?: Array<{ sku: string; qty: number }>;
  /** Never a bearer URL: hosted setup links are shown only to finance users on the location page. */
  [key: string]: unknown;
}

export function noticeDedupeKey(purpose: string, subjectType: string, subjectId: string, version: number) {
  return `${purpose}:${subjectType}:${subjectId}:v${version}`;
}

/**
 * Record (or reuse) the pending intent for a business event. A repeated
 * request for the same purpose/subject returns the existing pending notice
 * instead of inserting a duplicate. Missing recipient → owned follow-up.
 */
export async function createNoticeIntent(
  db: DbOrTx,
  actor: Actor,
  input: {
    purpose: NoticePurpose;
    subjectType: "order" | "customer_location";
    subjectId: string;
    marketId: string | null;
    locationId: string | null;
    recipientEmail: string | null;
    recipientContactId: string | null;
    content: NoticeContent;
    version?: number;
    supersedesNoticeId?: string | null;
  },
) {
  const version = input.version ?? 1;
  const dedupeKey = noticeDedupeKey(input.purpose, input.subjectType, input.subjectId, version);
  const [existing] = await db
    .select()
    .from(schema.notice)
    .where(and(eq(schema.notice.dedupeKey, dedupeKey), inArray(schema.notice.state, ["intended", "manual_pending"])))
    .limit(1);
  if (existing) return { notice: existing, created: false as const };
  const [row] = await db
    .insert(schema.notice)
    .values({
      purpose: input.purpose,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      version,
      marketId: input.marketId,
      locationId: input.locationId,
      recipientEmail: input.recipientEmail,
      recipientContactId: input.recipientContactId,
      intendedSender: "unselected",
      state: "manual_pending",
      content: input.content,
      dedupeKey,
      supersedesNoticeId: input.supersedesNoticeId ?? null,
    })
    .returning();
  if (!input.recipientEmail) {
    await openException(db, actor, {
      category: "notice_no_recipient",
      title: `${NOTICE_PURPOSE_LABEL[input.purpose] ?? input.purpose} has no recipient email`,
      cause: "The location has no contact with an email address for this purpose; the notice cannot be sent until one is recorded.",
      marketId: input.marketId,
      locationId: input.locationId,
      ownerRole: "sales",
      nextAction: "Add or correct the contact email on the account, then re-issue the notice.",
      dedupeKey: `notice_no_recipient:${row.id}`,
      links: [{ subjectType: "notice", subjectId: row.id }, { subjectType: input.subjectType, subjectId: input.subjectId }],
    });
  }
  return { notice: row, created: true as const };
}

async function loadNotice(db: DbOrTx, noticeId: string) {
  const [n] = await db.select().from(schema.notice).where(eq(schema.notice.id, noticeId));
  if (!n) throw new BusinessError("Notice not found");
  return n;
}

export type NoticeOutcome = "sent" | "failed" | "unknown";

/**
 * Record the outcome of the manual send. Only an outstanding intent can be
 * completed, and only once (a second submission is refused with the current
 * state). Recording "sent" is the person's evidence — it is never
 * provider-confirmed delivery.
 */
export async function recordNoticeOutcome(
  db: DbOrTx,
  actor: Actor,
  input: { noticeId: string; outcome: NoticeOutcome; sentVia: string; evidence: string; recipientEmail?: string | null },
) {
  const pre = await loadNotice(db, input.noticeId);
  authorize(actor, "notice.record_outcome", { marketId: pre.marketId });
  if (pre.state !== "intended" && pre.state !== "manual_pending") throw new StaleStateError(`This notice is already ${pre.state}; the outcome was recorded once.`);
  if (!input.sentVia.trim()) throw new BusinessError("Say how it was sent (e.g. Gmail from ops@…)", { field: "sentVia" });
  if (!input.evidence.trim()) throw new BusinessError("Evidence is required (message id, timestamp, or what failed)", { field: "evidence" });
  return withTx(db, async (tx) => {
    const recipientEmail = input.recipientEmail?.trim().toLowerCase() || pre.recipientEmail;
    if (input.outcome === "sent" && !recipientEmail) throw new BusinessError("A recipient email is required to record a send", { field: "recipientEmail" });
    const [row] = await tx
      .update(schema.notice)
      .set({
        state: input.outcome,
        recipientEmail,
        intendedSender: "manual",
        sentVia: input.sentVia.trim(),
        outcomeNote: input.evidence.trim(),
        outcomeRecordedAt: new Date(),
        outcomeRecordedByEmployeeId: actor.employeeId,
        evidence: { recordedBy: actor.employeeId, via: input.sentVia.trim(), note: input.evidence.trim(), providerConfirmed: false },
        updatedAt: new Date(),
      })
      .where(and(eq(schema.notice.id, input.noticeId), inArray(schema.notice.state, ["intended", "manual_pending"])))
      .returning();
    if (!row) throw new StaleStateError(`This notice is already ${pre.state}; the outcome was recorded once.`);
    await recordAudit(tx, actor, {
      action: `notice.${input.outcome}`,
      subjectType: "notice",
      subjectId: row.id,
      prior: { state: pre.state },
      current: { state: row.state, recipientEmail: row.recipientEmail, sentVia: row.sentVia },
      reason: input.evidence,
      marketId: pre.marketId,
    });
    await resolveByDedupeKeys(tx, actor, [`notice_no_recipient:${row.id}`, `notice_failed:${row.id}`], `Outcome recorded: ${input.outcome}`);
    if (input.outcome !== "sent") {
      await openException(tx, actor, {
        category: "notice_failed",
        title: `${NOTICE_PURPOSE_LABEL[row.purpose] ?? row.purpose} ${input.outcome === "failed" ? "failed to send" : "has an unknown outcome"}`,
        cause: input.evidence,
        marketId: row.marketId,
        locationId: row.locationId,
        ownerRole: "admin",
        nextAction: input.outcome === "failed" ? "Fix the recipient/cause and re-issue a new version of the notice." : "Establish whether the message reached the recipient before re-sending (avoid duplicates).",
        dedupeKey: `notice_failed:${row.id}`,
        links: [{ subjectType: "notice", subjectId: row.id }, { subjectType: row.subjectType, subjectId: row.subjectId }],
      });
    }
    return row;
  });
}

/**
 * Withdraw every still-unsent notice for a subject whose cause has gone (e.g. an
 * "order received" notice for an order cancelled before anyone sent it). The rows
 * are marked superseded with the reason — never deleted — so the queue stops
 * asking a person to send something that is no longer true.
 */
export async function withdrawPendingNotices(db: DbOrTx, actor: Actor, input: { subjectType: string; subjectId: string; reason: string }) {
  return withTx(db, async (tx) => {
    const rows = await tx
      .update(schema.notice)
      .set({ state: "superseded", outcomeNote: `Withdrawn before sending: ${input.reason}`, updatedAt: new Date() })
      .where(and(eq(schema.notice.subjectType, input.subjectType), eq(schema.notice.subjectId, input.subjectId), inArray(schema.notice.state, ["intended", "manual_pending"])))
      .returning();
    for (const row of rows) {
      await recordAudit(tx, actor, {
        action: "notice.withdrawn",
        subjectType: "notice",
        subjectId: row.id,
        prior: { state: "pending" },
        current: { state: row.state },
        reason: input.reason,
        marketId: row.marketId,
      });
      await resolveByDedupeKeys(tx, actor, [`notice_no_recipient:${row.id}`], `Notice withdrawn: ${input.reason}`);
    }
    return rows;
  });
}

/** Deliberately issue a new version (e.g. after a failure or a recipient change); the old one is superseded, never rewritten. */
export async function reissueNotice(db: DbOrTx, actor: Actor, noticeId: string, input: { recipientEmail?: string | null; recipientContactId?: string | null; reason: string }) {
  const pre = await loadNotice(db, noticeId);
  authorize(actor, "notice.record_outcome", { marketId: pre.marketId });
  if (!input.reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  return withTx(db, async (tx) => {
    if (pre.state === "manual_pending" || pre.state === "intended") {
      await tx.update(schema.notice).set({ state: "superseded", outcomeNote: `Superseded: ${input.reason}`, updatedAt: new Date() }).where(eq(schema.notice.id, pre.id));
      await resolveByDedupeKeys(tx, actor, [`notice_no_recipient:${pre.id}`], "Superseded by a new version");
    }
    const [latest] = await tx
      .select({ version: schema.notice.version })
      .from(schema.notice)
      .where(and(eq(schema.notice.purpose, pre.purpose), eq(schema.notice.subjectType, pre.subjectType), eq(schema.notice.subjectId, pre.subjectId)))
      .orderBy(desc(schema.notice.version))
      .limit(1);
    const version = (latest?.version ?? pre.version) + 1;
    const created = await createNoticeIntent(tx, actor, {
      purpose: pre.purpose as NoticePurpose,
      subjectType: pre.subjectType as "order" | "customer_location",
      subjectId: pre.subjectId,
      marketId: pre.marketId,
      locationId: pre.locationId,
      recipientEmail: input.recipientEmail === undefined ? pre.recipientEmail : input.recipientEmail,
      recipientContactId: input.recipientContactId === undefined ? pre.recipientContactId : input.recipientContactId,
      content: (pre.content ?? { summary: "" }) as NoticeContent,
      version,
      supersedesNoticeId: pre.id,
    });
    await recordAudit(tx, actor, { action: "notice.reissue", subjectType: "notice", subjectId: created.notice.id, prior: { supersedes: pre.id, version: pre.version }, current: { version }, reason: input.reason, marketId: pre.marketId });
    return created.notice;
  });
}

/** Permission-scoped notice list for the manual-process work queue. */
export async function listNotices(db: DbOrTx, actor: Actor, opts: { states?: string[]; subjectType?: string; subjectId?: string; locationId?: string; limit?: number } = {}) {
  const scope = marketScopeFor(actor, ["owner", "admin", "accounting", "sales"]);
  const conds = [];
  if (actor.kind !== "system" && !actor.grants.some((g) => g.role === "owner") && scope !== "all") {
    if (scope.length === 0) return [];
    conds.push(inArray(schema.notice.marketId, scope));
  }
  if (opts.states?.length) conds.push(inArray(schema.notice.state, opts.states as never));
  if (opts.subjectType && opts.subjectId) conds.push(and(eq(schema.notice.subjectType, opts.subjectType), eq(schema.notice.subjectId, opts.subjectId))!);
  if (opts.locationId) conds.push(eq(schema.notice.locationId, opts.locationId));
  return db
    .select({ n: schema.notice, loc: schema.customerLocation })
    .from(schema.notice)
    .leftJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.notice.locationId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.notice.createdAt))
    .limit(opts.limit ?? 100);
}

/** Subject link for a notice (order number / account name) without exposing anything else. */
export async function noticeSubjectLabel(db: DbOrTx, n: { subjectType: string; subjectId: string }) {
  if (n.subjectType === "order") {
    const [o] = await db.select({ orderNumber: schema.order.orderNumber }).from(schema.order).where(eq(schema.order.id, n.subjectId));
    return { label: o?.orderNumber ?? "order", href: `/orders/${n.subjectId}` };
  }
  const [l] = await db.select({ tradeName: schema.customerLocation.tradeName }).from(schema.customerLocation).where(eq(schema.customerLocation.id, n.subjectId));
  return { label: l?.tradeName ?? "account", href: `/locations/${n.subjectId}` };
}
