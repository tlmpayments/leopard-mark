/**
 * Credit memos into Stripe (Round 4, I7). A portal credit memo against a mirrored invoice becomes a Stripe credit note
 * through an approval item. Before payment the note lowers what Stripe collects; after payment it credits the
 * customer's balance for the next invoice. A cash refund is never automatic: the Owner asks for it on the memo.
 */
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { SYSTEM_ACTOR, type Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { Db, DbOrTx } from "@/lib/db/types";
import { gateway, stripeConfigured, verifiedStripeAccount } from "@/lib/integrations/stripe/adapter";
import { ProviderUnavailableError } from "@/lib/jobs/queue";
import { formatCents } from "@/lib/domain/catalog/service";
import { registerApprovalExecutor, requestApproval, type ApprovalItem } from "@/lib/domain/approvals/service";

/** Queue the Stripe credit note for a credit memo whose invoice has a Stripe copy. Null when there is nothing to mirror. */
export async function requestCreditNoteMirror(db: DbOrTx, actor: Actor, creditMemoId: string, opts: { refund?: boolean } = {}) {
  const [cm] = await db.select().from(schema.creditMemo).where(eq(schema.creditMemo.id, creditMemoId));
  if (!cm || cm.status !== "issued" || cm.stripeCreditNoteId) return null;
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, cm.invoiceId));
  if (!inv?.stripeInvoiceId || !stripeConfigured()) return null;
  const apply = inv.status === "paid" ? (opts.refund ? "refund" : "customer_balance") : "amount_due";
  return requestApproval(db, actor, {
    kind: "stripe_credit_note",
    purpose: "credit_note",
    sender: "stripe",
    title: `${cm.number} (${formatCents(cm.amountCents)}) against ${inv.number} into Stripe`,
    summary: apply === "amount_due" ? "Lowers what Stripe collects for the open invoice." : apply === "refund" ? "Refunds the paid amount to the customer's bank (Owner's decision)." : "Credits the customer's Stripe balance for the next invoice.",
    payload: { creditMemoId: cm.id, invoiceId: inv.id, apply, amountCents: cm.amountCents },
    amountCents: cm.amountCents,
    subjectType: "credit_memo",
    subjectId: cm.id,
    marketId: cm.marketId,
    locationId: cm.locationId,
    dedupeKey: `stripe_credit_note:${cm.id}`,
  });
}

registerApprovalExecutor("stripe_credit_note", async (db: Db, item: ApprovalItem) => {
  const [cm] = await db.select().from(schema.creditMemo).where(eq(schema.creditMemo.id, String(item.payload.creditMemoId ?? "")));
  if (!cm) throw new Error("Credit memo not found");
  if (cm.stripeCreditNoteId) return { stripeCreditNoteId: cm.stripeCreditNoteId, alreadyMirrored: true };
  if (cm.status !== "issued") throw new Error(`${cm.number} is ${cm.status}`);
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, cm.invoiceId));
  if (!inv?.stripeInvoiceId) throw new Error("The invoice has no Stripe copy");
  const binding = await verifiedStripeAccount(db);
  if (!binding) throw new ProviderUnavailableError("Stripe account not verified; the credit note resumes after the connectivity check");
  const gw = gateway();
  const current = await gw.retrieveInvoice(inv.stripeInvoiceId);
  if (!current) throw new Error("The Stripe invoice no longer exists");
  const apply = (current.status === "paid" ? (item.payload.apply === "refund" ? "refund" : "customer_balance") : "amount_due") as "amount_due" | "customer_balance" | "refund";
  const cn = await gw.createCreditNote({ invoice: inv.stripeInvoiceId, amount: cm.amountCents, apply, memo: `${cm.number}: ${cm.reason}`, metadata: { fv_credit_memo_id: cm.id, fv_credit_memo: cm.number, fv_invoice_id: inv.id, fv_invoice_number: inv.number ?? "" } }, `fv-cn-${binding.environment}-${cm.id}`);
  await db.update(schema.creditMemo).set({ stripeCreditNoteId: cn.id, stripeCreditNoteNumber: cn.number, stripeApplied: apply, mirroredAt: new Date() }).where(eq(schema.creditMemo.id, cm.id));
  await recordAudit(db, SYSTEM_ACTOR, { action: "credit.mirrored", subjectType: "credit_memo", subjectId: cm.id, current: { stripeCreditNoteId: cn.id, number: cn.number, apply }, marketId: cm.marketId });
  return { stripeCreditNoteId: cn.id, number: cn.number, apply };
});
