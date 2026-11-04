/**
 * The approval queue (Round 4, the Owner's sending rule). Nothing leaves the company on its own: every email, Stripe
 * invoice, debit or credit note is an `approval_item`. A person approves or rejects it; an approved item's effect runs
 * from the job queue and writes its result back. Rejected and withdrawn items stay on record with who and why.
 *
 * Policy: the company switches (`autoApproveStripeInvoices`, `autoApproveCreditNotes`, `autoApproveEmails`) and the
 * per-account `autoDebit` switch approve an item the moment it is created; everything else waits. An approved email
 * leaves through Gmail only while `sendEmailAutomatically` is on; otherwise it is `approved` with manual transport and a
 * person sends it and records the outcome ("invoices are still emailed by hand until the Owner says otherwise").
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { SYSTEM_ACTOR, marketScopeFor, type Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { type Db, type DbOrTx, withTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { openException, resolveByDedupeKeys } from "@/lib/exceptions/service";
import { ProviderUnavailableError, enqueueJob, registerJobHandler } from "@/lib/jobs/queue";
import { getCompanySettings } from "@/lib/domain/settings/service";

export type ApprovalItem = typeof schema.approvalItem.$inferSelect;
export type ApprovalKind = schema.ApprovalKind;
export type ApprovalState = schema.ApprovalState;

export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  email: "Email",
  stripe_invoice: "Stripe invoice",
  stripe_debit: "Debit",
  stripe_credit_note: "Credit note",
};

export const APPROVAL_PURPOSE_LABEL: Record<string, string> = {
  invoice_email: "Invoice to the customer",
  payment_setup_link: "Bank setup link",
  pull_sheet: "Pull sheet to the warehouse",
  payment_receipt: "Payment receipt",
  reminder: "Payment reminder",
  order_received: "Order received",
  invoice_mirror: "Invoice into Stripe",
  due_date_debit: "Due-date debit",
  re_present: "Re-present a returned debit",
  credit_note: "Credit note into Stripe",
  custom: "Message",
};

export const APPROVAL_STATE_LABEL: Record<ApprovalState, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  executing: "Running",
  done: "Done",
  failed: "Failed",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const JOB_APPROVAL_EXECUTE = "approval.execute";

/** What an email item carries. Attachments are references resolved at send time, never bytes in the payload. */
export interface EmailPayload {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  attachments?: Array<{ kind: "invoice_pdf"; invoiceId: string } | { kind: "pull_sheet"; warehouseId: string; date: string } | { kind: "shipment_document"; documentId: string }>;
  /** Filled at execution for a bank setup link: the hosted URL is generated when the item runs, never stored in the payload beforehand. */
  setupLink?: { locationId: string; returnUrl: string };
}

export type ApprovalExecutor = (db: Db, item: ApprovalItem) => Promise<Record<string, unknown>>;

const executors = new Map<string, ApprovalExecutor>();

/** Register the effect for a kind (and optionally a purpose: `kind:purpose` wins over `kind`). */
export function registerApprovalExecutor(key: ApprovalKind | `${ApprovalKind}:${string}`, fn: ApprovalExecutor) {
  executors.set(key, fn);
}

function executorFor(item: ApprovalItem): ApprovalExecutor | null {
  return executors.get(`${item.kind}:${item.purpose}`) ?? executors.get(item.kind) ?? null;
}

export interface RequestApprovalInput {
  kind: ApprovalKind;
  purpose: string;
  sender: string;
  title: string;
  summary?: string | null;
  payload: Record<string, unknown>;
  amountCents?: number | null;
  subjectType: string;
  subjectId: string;
  marketId?: string | null;
  locationId?: string | null;
  dedupeKey?: string | null;
  /** When set, the item is approved on creation whatever the company switches say (the caller established the policy, e.g. the account's auto-debit). */
  autoApprove?: boolean;
}

async function autoApproves(db: DbOrTx, input: RequestApprovalInput): Promise<boolean> {
  if (input.autoApprove !== undefined) return input.autoApprove;
  const s = await getCompanySettings(db);
  switch (input.kind) {
    case "stripe_invoice":
      return s.autoApproveStripeInvoices;
    case "stripe_credit_note":
      return s.autoApproveCreditNotes;
    case "email":
      return s.autoApproveEmails;
    case "stripe_debit":
      return false; // per account, decided by the caller
  }
}

/** How an approved email leaves: through Gmail when the switch is on and Gmail is configured, otherwise by hand. */
export async function emailTransport(db: DbOrTx): Promise<"auto" | "manual"> {
  const s = await getCompanySettings(db);
  if (!s.sendEmailAutomatically) return "manual";
  const { gmailConfigured } = await import("@/lib/integrations/gmail/adapter");
  return gmailConfigured() ? "auto" : "manual";
}

/**
 * Create (or return) the active item for an effect. With a dedupe key, an item that is pending, approved or running for
 * the same key is returned instead of a duplicate. Auto-approved items are queued to run at once.
 */
export async function requestApproval(db: DbOrTx, actor: Actor, input: RequestApprovalInput): Promise<{ item: ApprovalItem; created: boolean }> {
  if (input.dedupeKey) {
    const [existing] = await db
      .select()
      .from(schema.approvalItem)
      .where(and(eq(schema.approvalItem.dedupeKey, input.dedupeKey), inArray(schema.approvalItem.state, ["pending", "approved", "executing"])))
      .limit(1);
    if (existing) return { item: existing, created: false };
  }
  const auto = await autoApproves(db, input);
  return withTx(db, async (tx) => {
    const [row] = await tx
      .insert(schema.approvalItem)
      .values({
        kind: input.kind,
        purpose: input.purpose,
        sender: input.sender,
        title: input.title,
        summary: input.summary ?? null,
        payload: input.payload,
        amountCents: input.amountCents ?? null,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        marketId: input.marketId ?? null,
        locationId: input.locationId ?? null,
        state: "pending",
        dedupeKey: input.dedupeKey ?? null,
        requestedByEmployeeId: actor.employeeId,
        autoApproved: auto,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      const [existing] = await tx.select().from(schema.approvalItem).where(and(eq(schema.approvalItem.dedupeKey, input.dedupeKey!), inArray(schema.approvalItem.state, ["pending", "approved", "executing"]))).limit(1);
      return { item: existing, created: false };
    }
    await recordAudit(tx, actor, { action: "approval.request", subjectType: "approval_item", subjectId: row.id, current: { kind: row.kind, purpose: row.purpose, sender: row.sender, title: row.title, subjectType: row.subjectType, subjectId: row.subjectId, autoApproved: auto }, marketId: row.marketId });
    if (auto) {
      const approved = await approveInternal(tx, actor, row, "Approved automatically by company policy", true);
      return { item: approved, created: true };
    }
    return { item: row, created: true };
  });
}

async function approveInternal(tx: DbOrTx, actor: Actor, item: ApprovalItem, note: string | null, auto: boolean): Promise<ApprovalItem> {
  const transport = item.kind === "email" ? await emailTransport(tx) : "auto";
  const [row] = await tx
    .update(schema.approvalItem)
    .set({ state: "approved", transport, decidedByEmployeeId: auto ? null : actor.employeeId, decidedAt: new Date(), decisionNote: note, lastError: null, updatedAt: new Date() })
    .where(and(eq(schema.approvalItem.id, item.id), inArray(schema.approvalItem.state, ["pending", "failed"])))
    .returning();
  if (!row) throw new StaleStateError(`This item is already ${item.state}; nothing changed.`);
  await recordAudit(tx, actor, { action: auto ? "approval.auto_approved" : "approval.approved", subjectType: "approval_item", subjectId: row.id, prior: { state: item.state }, current: { state: "approved", transport }, reason: note, marketId: row.marketId });
  if (transport === "auto") {
    const q = await enqueueJob(tx, JOB_APPROVAL_EXECUTE, { itemId: row.id }, { dedupeKey: `${JOB_APPROVAL_EXECUTE}:${row.id}`, maxAttempts: 3 });
    await tx.update(schema.approvalItem).set({ jobId: q.job.id }).where(eq(schema.approvalItem.id, row.id));
    row.jobId = q.job.id;
  }
  return row;
}

async function loadItem(db: DbOrTx, itemId: string): Promise<ApprovalItem> {
  const [item] = await db.select().from(schema.approvalItem).where(eq(schema.approvalItem.id, itemId));
  if (!item) throw new BusinessError("Approval item not found");
  return item;
}

/** A person approves a pending (or failed) item; it runs from the job queue, or waits for the manual send. */
export async function approveItem(db: DbOrTx, actor: Actor, itemId: string, note?: string | null) {
  const item = await loadItem(db, itemId);
  authorize(actor, "approval.decide", { marketId: item.marketId });
  if (item.state !== "pending" && item.state !== "failed") throw new StaleStateError(`This item is already ${APPROVAL_STATE_LABEL[item.state].toLowerCase()}.`);
  return withTx(db, (tx) => approveInternal(tx, actor, item, note?.trim() || null, false));
}

export async function rejectItem(db: DbOrTx, actor: Actor, itemId: string, reason: string) {
  const item = await loadItem(db, itemId);
  authorize(actor, "approval.decide", { marketId: item.marketId });
  if (!reason.trim()) throw new BusinessError("Say why it is rejected", { field: "reason" });
  if (item.state !== "pending" && item.state !== "approved" && item.state !== "failed") throw new StaleStateError(`This item is already ${APPROVAL_STATE_LABEL[item.state].toLowerCase()}.`);
  const [row] = await db
    .update(schema.approvalItem)
    .set({ state: "rejected", decidedByEmployeeId: actor.employeeId, decidedAt: new Date(), decisionNote: reason.trim(), updatedAt: new Date() })
    .where(and(eq(schema.approvalItem.id, itemId), inArray(schema.approvalItem.state, ["pending", "approved", "failed"])))
    .returning();
  if (!row) throw new StaleStateError("This item was decided by someone else a moment ago.");
  await recordAudit(db, actor, { action: "approval.rejected", subjectType: "approval_item", subjectId: row.id, prior: { state: item.state }, current: { state: "rejected" }, reason: reason.trim(), marketId: row.marketId });
  await resolveByDedupeKeys(db, actor, [`approval_failed:${row.id}`], "Rejected by a person");
  return row;
}

/** Withdraw every active item for a subject whose cause has gone (a voided invoice, a cancelled order). Never deleted. */
export async function withdrawItemsForSubject(db: DbOrTx, actor: Actor, input: { subjectType: string; subjectId: string; kinds?: ApprovalKind[]; reason: string }) {
  const conds = [eq(schema.approvalItem.subjectType, input.subjectType), eq(schema.approvalItem.subjectId, input.subjectId), inArray(schema.approvalItem.state, ["pending", "approved"])];
  if (input.kinds?.length) conds.push(inArray(schema.approvalItem.kind, input.kinds));
  const rows = await db
    .update(schema.approvalItem)
    .set({ state: "withdrawn", decisionNote: `Withdrawn: ${input.reason}`, decidedAt: new Date(), updatedAt: new Date() })
    .where(and(...conds))
    .returning();
  for (const row of rows) {
    await recordAudit(db, actor, { action: "approval.withdrawn", subjectType: "approval_item", subjectId: row.id, prior: { state: "pending" }, current: { state: "withdrawn" }, reason: input.reason, marketId: row.marketId });
  }
  return rows;
}

/**
 * The manual path for an approved email: a person sent it by hand and records how and the evidence (a message id, a
 * time). Also usable straight from `pending` (approve and record in one act). Recording "sent" is the person's
 * evidence, never provider-confirmed delivery.
 */
export async function recordManualSend(db: DbOrTx, actor: Actor, itemId: string, input: { outcome: "sent" | "failed"; sentVia: string; evidence: string }) {
  const item = await loadItem(db, itemId);
  authorize(actor, "approval.decide", { marketId: item.marketId });
  if (item.kind !== "email") throw new BusinessError("Only an email can be sent by hand; Stripe effects run from the queue");
  if (!input.sentVia.trim()) throw new BusinessError("Say how it was sent (e.g. Gmail from orders@)", { field: "sentVia" });
  if (!input.evidence.trim()) throw new BusinessError("Evidence is required (message id, timestamp, or what failed)", { field: "evidence" });
  if (item.state !== "pending" && item.state !== "approved" && item.state !== "failed") throw new StaleStateError(`This item is already ${APPROVAL_STATE_LABEL[item.state].toLowerCase()}.`);
  return withTx(db, async (tx) => {
    const [row] = await tx
      .update(schema.approvalItem)
      .set({
        state: input.outcome === "sent" ? "done" : "failed",
        transport: "manual",
        decidedByEmployeeId: item.decidedByEmployeeId ?? actor.employeeId,
        decidedAt: item.decidedAt ?? new Date(),
        executedAt: new Date(),
        result: { manual: true, sentVia: input.sentVia.trim(), evidence: input.evidence.trim(), recordedBy: actor.employeeId, providerConfirmed: false },
        lastError: input.outcome === "failed" ? input.evidence.trim() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.approvalItem.id, itemId), inArray(schema.approvalItem.state, ["pending", "approved", "failed"])))
      .returning();
    if (!row) throw new StaleStateError("This item was decided by someone else a moment ago.");
    await recordAudit(tx, actor, { action: input.outcome === "sent" ? "approval.sent_by_hand" : "approval.send_failed", subjectType: "approval_item", subjectId: row.id, prior: { state: item.state }, current: { state: row.state, sentVia: input.sentVia.trim() }, reason: input.evidence.trim(), marketId: row.marketId });
    if (row.state === "done") await afterDone(tx, actor, row);
    return row;
  });
}

const afterDoneHooks: Array<(db: DbOrTx, actor: Actor, item: ApprovalItem) => Promise<void>> = [];
/** Modules register what follows a completed item (e.g. the invoice records when its email went). */
export function onApprovalDone(fn: (db: DbOrTx, actor: Actor, item: ApprovalItem) => Promise<void>) {
  afterDoneHooks.push(fn);
}
async function afterDone(db: DbOrTx, actor: Actor, item: ApprovalItem) {
  for (const h of afterDoneHooks) await h(db, actor, item);
}

/** The job: run the effect of an approved item once. Provider outages make the job wait; other errors fail the item with an owned case. */
registerJobHandler(JOB_APPROVAL_EXECUTE, {
  run: async (db: Db, payload) => {
    const itemId = String(payload.itemId ?? "");
    const [item] = await db.select().from(schema.approvalItem).where(eq(schema.approvalItem.id, itemId));
    if (!item) return;
    if (item.state !== "approved") return; // rejected, withdrawn or already done since
    if (item.transport === "manual") return; // a person sends it
    const run = executorFor(item);
    if (!run) throw new Error(`No executor registered for approval kind ${item.kind} (${item.purpose})`);
    const [claimed] = await db.update(schema.approvalItem).set({ state: "executing", updatedAt: new Date() }).where(and(eq(schema.approvalItem.id, item.id), eq(schema.approvalItem.state, "approved"))).returning();
    if (!claimed) return;
    try {
      const result = await run(db, claimed);
      const [done] = await db.update(schema.approvalItem).set({ state: "done", executedAt: new Date(), result, lastError: null, updatedAt: new Date() }).where(eq(schema.approvalItem.id, item.id)).returning();
      await recordAudit(db, SYSTEM_ACTOR, { action: "approval.executed", subjectType: "approval_item", subjectId: item.id, current: { kind: item.kind, purpose: item.purpose, result }, marketId: item.marketId });
      await resolveByDedupeKeys(db, SYSTEM_ACTOR, [`approval_failed:${item.id}`], "Ran on a later attempt");
      if (done) await afterDone(db, SYSTEM_ACTOR, done);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ProviderUnavailableError) {
        await db.update(schema.approvalItem).set({ state: "approved", lastError: message, updatedAt: new Date() }).where(eq(schema.approvalItem.id, item.id));
        throw err; // the job waits and resumes when the provider is usable
      }
      await db.update(schema.approvalItem).set({ state: "failed", lastError: message, updatedAt: new Date() }).where(eq(schema.approvalItem.id, item.id));
      await recordAudit(db, SYSTEM_ACTOR, { action: "approval.failed", subjectType: "approval_item", subjectId: item.id, current: { error: message }, marketId: item.marketId });
      await openException(db, SYSTEM_ACTOR, {
        category: "approval_failed",
        title: `${APPROVAL_KIND_LABEL[item.kind]} failed: ${item.title}`,
        cause: `${message}. The effect may or may not have happened at the provider; the executor reconciles prior effects before trying again.`,
        marketId: item.marketId,
        locationId: item.locationId,
        ownerRole: item.kind === "email" ? "admin" : "accounting",
        nextAction: "Read the error on the Approvals screen, fix the cause, then approve the item again (Retry).",
        dedupeKey: `approval_failed:${item.id}`,
        links: [{ subjectType: "approval_item", subjectId: item.id }, { subjectType: item.subjectType, subjectId: item.subjectId }],
      });
    }
  },
});

/** Permission-scoped list for the Approvals screen. */
export async function listApprovals(db: DbOrTx, actor: Actor, opts: { states?: ApprovalState[]; kinds?: ApprovalKind[]; locationId?: string; limit?: number } = {}) {
  const scope = marketScopeFor(actor, ["owner", "admin", "accounting"]);
  const conds = [];
  if (actor.kind !== "system" && !actor.grants.some((g) => g.role === "owner") && scope !== "all") {
    if (scope.length === 0) return [];
    conds.push(sql`(${schema.approvalItem.marketId} is null or ${inArray(schema.approvalItem.marketId, scope)})`);
  }
  if (opts.states?.length) conds.push(inArray(schema.approvalItem.state, opts.states));
  if (opts.kinds?.length) conds.push(inArray(schema.approvalItem.kind, opts.kinds));
  if (opts.locationId) conds.push(eq(schema.approvalItem.locationId, opts.locationId));
  return db
    .select({ item: schema.approvalItem, location: schema.customerLocation })
    .from(schema.approvalItem)
    .leftJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.approvalItem.locationId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(sql`case ${schema.approvalItem.state} when 'pending' then 0 when 'failed' then 1 when 'approved' then 2 when 'executing' then 3 else 4 end`), desc(schema.approvalItem.createdAt))
    .limit(opts.limit ?? 200);
}

export async function approvalsForSubject(db: DbOrTx, subjectType: string, subjectId: string) {
  return db.select().from(schema.approvalItem).where(and(eq(schema.approvalItem.subjectType, subjectType), eq(schema.approvalItem.subjectId, subjectId))).orderBy(desc(schema.approvalItem.createdAt));
}

export async function approvalCounts(db: DbOrTx) {
  const rows = await db.select({ state: schema.approvalItem.state, count: sql<number>`count(*)::int` }).from(schema.approvalItem).groupBy(schema.approvalItem.state);
  const out: Record<ApprovalState, number> = { pending: 0, approved: 0, executing: 0, done: 0, failed: 0, rejected: 0, withdrawn: 0 };
  for (const r of rows) out[r.state] = r.count;
  return out;
}

export async function getApproval(db: DbOrTx, itemId: string) {
  const [row] = await db.select({ item: schema.approvalItem, location: schema.customerLocation }).from(schema.approvalItem).leftJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.approvalItem.locationId)).where(eq(schema.approvalItem.id, itemId));
  return row ?? null;
}
