/**
 * The due-date debit (Round 4, P1, P5). For accounts that pay by Stripe, each mirrored invoice is debited on its due
 * date (the next business day when the due date falls on a weekend or holiday) with the bank on file. Every debit is an
 * approval item: it waits for a person unless the account's `autoDebit` switch is on. A returned debit is never retried
 * on its own: Stripe can re-present an insufficient-funds ACH return itself (up to twice within 40 days on one-off
 * invoices), so that dashboard setting stays OFF; re-presenting is a new item a person approves here, within the same
 * NACHA limits.
 */
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { SYSTEM_ACTOR, type Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db, DbOrTx } from "@/lib/db/types";
import { BusinessError } from "@/lib/errors";
import { gateway, stripeConfigured, verifiedStripeAccount } from "@/lib/integrations/stripe/adapter";
import { ProviderUnavailableError } from "@/lib/jobs/queue";
import { formatCents } from "@/lib/domain/catalog/service";
import { localParts } from "@/lib/domain/cutoff/service";
import { registerApprovalExecutor, requestApproval, type ApprovalItem } from "@/lib/domain/approvals/service";
import { nextBusinessDayOnOrAfter } from "./calendar";

/** ACH return codes after which the debit must never be re-presented: the account holder said no. */
export const NO_REPRESENT_CODES = new Set(["R05", "R07", "R10", "R11", "R29", "R51", "authorization_revoked", "debit_not_authorized", "payment_method_provider_decline:R29"]);
/** Insufficient or uncollected funds may be re-presented, at most twice (NACHA). */
export const REPRESENT_CODES = new Set(["R01", "R09", "insufficient_funds"]);
export const MAX_REPRESENTMENTS = 2;

export interface DebitEligibility {
  ok: boolean;
  reason?: string;
  paymentMethodId?: string;
  mandateId?: string | null;
  autoDebit?: boolean;
}

/** Whether a debit may run for this invoice right now: mirrored, open, pays by Stripe, a verified bank, no revocation. */
export async function debitEligibility(db: DbOrTx, inv: typeof schema.invoice.$inferSelect): Promise<DebitEligibility> {
  if (inv.status === "processing") return { ok: false, reason: "a debit is already processing" };
  if (inv.status !== "issued") return { ok: false, reason: `invoice is ${inv.status}` };
  if (inv.payBy !== "stripe") return { ok: false, reason: `pays by ${inv.payBy ?? "an unset channel"}, never debited` };
  if (!inv.stripeInvoiceId) return { ok: false, reason: "not mirrored into Stripe yet" };
  if (inv.collectionState === "processing") return { ok: false, reason: "a debit is already processing" };
  if (inv.collectionState === "disputed") return { ok: false, reason: "disputed" };
  if (!inv.locationId) return { ok: false, reason: "no account" };
  const [rel] = await db.select().from(schema.paymentRelationship).where(and(eq(schema.paymentRelationship.locationId, inv.locationId), eq(schema.paymentRelationship.current, true)));
  if (!rel) return { ok: false, reason: "no payment relationship" };
  if (rel.directRevocationAt) return { ok: false, reason: "the customer revoked authorisation" };
  if (rel.setupState === "revoked") return { ok: false, reason: "the bank was removed" };
  if (!rel.paymentMethodId || rel.verificationState !== "verified") return { ok: false, reason: "no verified bank on file" };
  const [loc] = await db.select({ autoDebit: schema.customerLocation.autoDebit }).from(schema.customerLocation).where(eq(schema.customerLocation.id, inv.locationId));
  return { ok: true, paymentMethodId: rel.paymentMethodId, mandateId: rel.mandateId, autoDebit: Boolean(loc?.autoDebit) };
}

/**
 * The hourly sweep: every open, mirrored, pay-by-Stripe invoice whose debit date has arrived gets one debit item.
 * Accounts without a verified bank get a case instead, once per invoice.
 */
export async function scheduleDueDateDebits(db: DbOrTx, now: Date = new Date()): Promise<{ queued: number; blocked: number }> {
  if (!stripeConfigured()) return { queued: 0, blocked: 0 };
  const today = localParts(now, "America/Los_Angeles").date;
  const rows = await db
    .select()
    .from(schema.invoice)
    .where(and(eq(schema.invoice.status, "issued"), eq(schema.invoice.payBy, "stripe"), isNotNull(schema.invoice.stripeInvoiceId), inArray(schema.invoice.collectionState, ["scheduled", "none"]), lte(sql`coalesce(${schema.invoice.debitScheduledOn}, ${schema.invoice.dueDate})`, today)));
  let queued = 0;
  let blocked = 0;
  for (const inv of rows) {
    const e = await debitEligibility(db, inv);
    if (!e.ok) {
      blocked += 1;
      const { openException } = await import("@/lib/exceptions/service");
      await openException(db, SYSTEM_ACTOR, {
        category: "debit_blocked",
        title: `${inv.number}: due-date debit cannot run (${e.reason})`,
        cause: `${formatCents(inv.totalCents)} was due ${inv.dueDate}. ${e.reason}.`,
        marketId: inv.marketId,
        locationId: inv.locationId,
        ownerRole: "accounting",
        nextAction: "Get the bank connected (send a setup link) or collect by check or card; the debit will not run on its own.",
        dedupeKey: `debit_blocked:${inv.id}`,
        links: [{ subjectType: "invoice", subjectId: inv.id }],
      });
      continue;
    }
    const r = await requestDebit(db, SYSTEM_ACTOR, inv, { purpose: "due_date_debit", autoApprove: e.autoDebit ?? false, note: `Due ${inv.dueDate}; debit date ${inv.debitScheduledOn ?? nextBusinessDayOnOrAfter(inv.dueDate ?? today)}.` });
    if (r.created) queued += 1;
  }
  return { queued, blocked };
}

async function amountRemaining(db: DbOrTx, inv: typeof schema.invoice.$inferSelect): Promise<number> {
  const credited = await db.select({ total: schema.creditMemo.amountCents }).from(schema.creditMemo).where(and(eq(schema.creditMemo.invoiceId, inv.id), eq(schema.creditMemo.status, "issued")));
  const paid = await db.select({ total: schema.payment.amountCents }).from(schema.payment).where(and(eq(schema.payment.invoiceId, inv.id), eq(schema.payment.state, "succeeded")));
  return inv.totalCents - credited.reduce((s, c) => s + c.total, 0) - paid.reduce((s, p) => s + p.total, 0);
}

async function requestDebit(db: DbOrTx, actor: Actor, inv: typeof schema.invoice.$inferSelect, o: { purpose: "due_date_debit" | "re_present"; autoApprove: boolean; note: string }) {
  const [loc] = await db.select({ tradeName: schema.customerLocation.tradeName }).from(schema.customerLocation).where(eq(schema.customerLocation.id, inv.locationId!));
  const amount = await amountRemaining(db, inv);
  return requestApproval(db, actor, {
    kind: "stripe_debit",
    purpose: o.purpose,
    sender: "stripe",
    title: `${o.purpose === "re_present" ? "Re-present" : "Debit"} ${formatCents(amount)} for ${inv.number} (${loc?.tradeName ?? "account"})`,
    summary: o.note,
    payload: { invoiceId: inv.id, number: inv.number, amountCents: amount },
    amountCents: amount,
    subjectType: "invoice",
    subjectId: inv.id,
    marketId: inv.marketId,
    locationId: inv.locationId,
    dedupeKey: `stripe_debit:${inv.id}`,
    autoApprove: o.autoApprove,
  });
}

/**
 * A person asks for a returned debit to be presented again (P5). Refused for an authorisation return (the account holder
 * said no) and after two re-presentments of an insufficient-funds return (NACHA). Always a person's decision.
 */
export async function requestRePresent(db: DbOrTx, actor: Actor, invoiceId: string, reason: string) {
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
  if (!inv) throw new BusinessError("Invoice not found");
  authorize(actor, "invoice.issue", { marketId: inv.marketId });
  if (!reason.trim()) throw new BusinessError("Say why the debit is presented again", { field: "reason" });
  if (inv.collectionState !== "failed") throw new BusinessError(`${inv.number} is ${inv.collectionState.replace(/_/g, " ")}; only a returned debit is re-presented`);
  const code = inv.failureCode ?? "";
  if (NO_REPRESENT_CODES.has(code) || /not.?authori[sz]ed|revoked/i.test(inv.failureMessage ?? "")) throw new BusinessError(`The return (${code}) says the account holder did not authorise the debit; it must not be presented again. Contact the account.`);
  const failed = await db.select({ id: schema.payment.id }).from(schema.payment).where(and(eq(schema.payment.invoiceId, inv.id), eq(schema.payment.state, "failed")));
  if (failed.length > MAX_REPRESENTMENTS) throw new BusinessError(`${inv.number} has already been presented ${failed.length} times; NACHA allows two re-presentments. Collect another way.`);
  const e = await debitEligibility(db, { ...inv, collectionState: "scheduled" });
  if (!e.ok) throw new BusinessError(`Cannot re-present: ${e.reason}`);
  const r = await requestDebit(db, actor, inv, { purpose: "re_present", autoApprove: false, note: `Re-presentment ${failed.length} of ${MAX_REPRESENTMENTS}: ${reason.trim()}` });
  await recordAudit(db, actor, { action: "invoice.re_present_requested", subjectType: "invoice", subjectId: inv.id, current: { approvalItemId: r.item.id, attempt: failed.length }, reason: reason.trim(), marketId: inv.marketId });
  return r;
}

/** The effect of an approved debit: pay the Stripe invoice off-session with the bank on file; Stripe reports the result by webhook. */
registerApprovalExecutor("stripe_debit", async (db: Db, item: ApprovalItem) => {
  const invoiceId = String(item.payload.invoiceId ?? "");
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
  if (!inv) throw new Error("Invoice not found");
  if (inv.status === "paid") return { skipped: "already paid" };
  const binding = await verifiedStripeAccount(db);
  if (!binding) throw new ProviderUnavailableError("Stripe account not verified; the debit resumes after the connectivity check");
  const e = await debitEligibility(db, item.purpose === "re_present" ? { ...inv, collectionState: "scheduled" } : inv);
  if (!e.ok) throw new Error(`Debit refused: ${e.reason}`);
  const gw = gateway();
  const current = await gw.retrieveInvoice(inv.stripeInvoiceId!);
  if (!current) throw new Error("The Stripe invoice no longer exists");
  if (current.status === "paid") {
    await db.update(schema.invoice).set({ stripeStatus: "paid", updatedAt: new Date() }).where(eq(schema.invoice.id, inv.id));
    return { skipped: "already paid in Stripe" };
  }
  if (current.status !== "open") throw new Error(`The Stripe invoice is ${current.status}; only an open invoice is debited`);
  const paid = await gw.payInvoice(inv.stripeInvoiceId!, { paymentMethod: e.paymentMethodId!, mandate: e.mandateId ?? null, offSession: true }, `fv-debit-${binding.environment}-${item.id}`);
  const amount = current.amountRemaining;
  const now = new Date();
  await db
    .insert(schema.payment)
    .values({ invoiceId: inv.id, locationId: inv.locationId, marketId: inv.marketId, kind: "stripe_ach", amountCents: amount, state: paid.status === "paid" ? "succeeded" : "processing", stripePaymentIntentId: paid.paymentIntent, occurredAt: now, settledAt: paid.status === "paid" ? now : null, approvalItemId: item.id, note: item.purpose === "re_present" ? "Re-presentment" : "Due-date debit" })
    .onConflictDoNothing();
  // The invoice moves to `processing` while the debit is in flight: still owed, never overdue, nothing else collects it.
  await db
    .update(schema.invoice)
    .set({ status: paid.status === "paid" ? "paid" : "processing", paidAt: paid.status === "paid" ? now : null, paidVia: paid.status === "paid" ? "stripe_ach" : inv.paidVia, collectionState: paid.status === "paid" ? "paid" : "processing", paymentIntentId: paid.paymentIntent, stripeStatus: paid.status, failureCode: null, failureMessage: null, updatedAt: now })
    .where(eq(schema.invoice.id, inv.id));
  await recordAudit(db, SYSTEM_ACTOR, { action: "invoice.debit_sent", subjectType: "invoice", subjectId: inv.id, current: { amountCents: amount, paymentIntentId: paid.paymentIntent, purpose: item.purpose, stripeStatus: paid.status }, marketId: inv.marketId });
  return { paymentIntentId: paid.paymentIntent, amountCents: amount, stripeStatus: paid.status };
});
