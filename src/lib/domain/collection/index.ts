/**
 * Stripe as the money ledger (Round 4). Importing this module registers the approval executors, the job handlers and
 * the invoice hooks; every entry point that runs jobs or issues invoices imports it once.
 */
import "./customers";
import "./invoices";
import "./debits";
import "./credits";
import "./reconcile";
import "@/lib/domain/approvals/email";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { enqueueJob } from "@/lib/jobs/queue";
import { onApprovalDone, withdrawItemsForSubject } from "@/lib/domain/approvals/service";
import { invoiceHooks } from "@/lib/domain/invoices/service";
import { requestCreditNoteMirror } from "./credits";
import { JOB_PAID_OUT_OF_BAND, queueVoidMirror, requestInvoiceMirror } from "./invoices";
import { markSetupLinkSent } from "./setup";

let registered = false;
export function registerCollectionHooks() {
  if (registered) return;
  registered = true;
  // An issued invoice with final figures goes into Stripe when the company switch is on (I1).
  invoiceHooks.finalised.push(async (db, actor, inv) => {
    await requestInvoiceMirror(db, actor, inv.id);
  });
  // A voided invoice: its Stripe copy is voided (I8) and anything queued for it is withdrawn.
  invoiceHooks.voided.push(async (db, actor, inv) => {
    await withdrawItemsForSubject(db, actor, { subjectType: "invoice", subjectId: inv.id, reason: `${inv.number ?? "invoice"} voided` });
    await queueVoidMirror(db, inv.id);
  });
  // Marked paid by hand (the legacy button): Stripe is told it was paid outside Stripe (S4).
  invoiceHooks.paidByHand.push(async (db, actor, inv) => {
    await withdrawItemsForSubject(db, actor, { subjectType: "invoice", subjectId: inv.id, kinds: ["stripe_debit"], reason: "Paid by hand" });
    if (inv.stripeInvoiceId) await enqueueJob(db, JOB_PAID_OUT_OF_BAND, { invoiceId: inv.id }, { dedupeKey: `${JOB_PAID_OUT_OF_BAND}:${inv.id}`, maxAttempts: 3 });
  });
  // A credit memo against a mirrored invoice becomes a Stripe credit note through the queue (I7).
  invoiceHooks.creditIssued.push(async (db, actor, cm) => {
    await requestCreditNoteMirror(db, actor, cm.id);
  });
  invoiceHooks.creditVoided.push(async (db, actor, cm) => {
    await withdrawItemsForSubject(db, actor, { subjectType: "credit_memo", subjectId: cm.id, reason: `${cm.number} voided` });
  });
  // When a bank setup email has gone (by Gmail or by hand), the chase clock starts (B6).
  onApprovalDone(async (db, actor, item) => {
    if (item.kind === "email" && item.purpose === "payment_setup_link" && item.locationId) await markSetupLinkSent(db, item.locationId);
    if (item.kind === "email" && item.purpose === "invoice_email") {
      const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, item.subjectId));
      if (inv) await db.update(schema.invoice).set({ notes: `${inv.notes ? inv.notes + "\n" : ""}Invoice emailed ${new Date().toISOString().slice(0, 10)}${item.transport === "manual" ? " (by hand)" : ""}`, updatedAt: new Date() }).where(eq(schema.invoice.id, inv.id));
    }
  });
}

registerCollectionHooks();

export * from "./calendar";
export * from "./customers";
export * from "./setup";
export * from "./invoices";
export * from "./debits";
export * from "./credits";
export * from "./webhooks";
export * from "./reconcile";
export * from "./reports";
