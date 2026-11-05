"use server";

import { opt, runAction, str } from "@/lib/actions/helpers";
import { authorize } from "@/lib/authz/authorize";
import { issueCreditMemo, issueInvoice, markInvoicePaid, voidCreditMemo, voidInvoice } from "@/lib/domain/invoices/service";
import { formatCents } from "@/lib/domain/catalog/service";
import { PAYMENT_KIND_LABEL, recordPaymentReceived, requestInvoiceEmail, requestInvoiceMirror, requestRePresent } from "@/lib/domain/collection";
import { splitList } from "../shipments/labels";

export async function issueInvoiceAction(form: FormData) {
  const id = str(form, "invoiceId");
  return runAction(`/invoices/${id}`, async ({ db, actor }) => {
    const inv = await issueInvoice(db, actor, id, str(form, "invoiceDate"));
    return `Issued ${inv.number} for ${formatCents(inv.totalCents)}, due ${inv.dueDate}`;
  });
}

export async function voidInvoiceAction(form: FormData) {
  const id = str(form, "invoiceId");
  return runAction(`/invoices/${id}`, async ({ db, actor }) => {
    await voidInvoice(db, actor, id, str(form, "reason"));
    return "Invoice voided";
  });
}

export async function markPaidAction(form: FormData) {
  const id = str(form, "invoiceId");
  return runAction(`/invoices/${id}`, async ({ db, actor }) => {
    await markInvoicePaid(db, actor, id, str(form, "note"));
    return "Marked paid (collection stays manual while 7.5 is open)";
  });
}

export async function issueCreditMemoAction(form: FormData) {
  const id = str(form, "invoiceId");
  return runAction(`/invoices/${id}`, async ({ db, actor }) => {
    const amountCents = Math.round(Number(str(form, "amount")) * 100);
    const cm = await issueCreditMemo(db, actor, { invoiceId: id, amountCents, reason: str(form, "reason"), memoDate: str(form, "memoDate") || undefined });
    return `Issued ${cm.number} for ${formatCents(cm.amountCents)}`;
  });
}

export async function voidCreditMemoAction(form: FormData) {
  const id = str(form, "invoiceId");
  return runAction(`/invoices/${id}`, async ({ db, actor }) => {
    const cm = await voidCreditMemo(db, actor, str(form, "creditMemoId"), str(form, "reason"));
    return `${cm.number} voided`;
  });
}

// ---------------------------------------------------------------------------
// Round 4: Stripe as the money ledger
// ---------------------------------------------------------------------------

export async function recordPaymentReceivedAction(form: FormData) {
  const id = str(form, "invoiceId");
  return runAction(`/invoices/${id}`, async ({ db, actor }) => {
    const kindText = str(form, "kind");
    const kind = kindText === "check" || kindText === "eft" || kindText === "fintech" ? kindText : "other";
    const amountText = opt(form, "amount");
    const r = await recordPaymentReceived(db, actor, id, { kind, amountCents: amountText ? Math.round(Number(amountText) * 100) : null, reference: opt(form, "reference"), note: opt(form, "note"), receivedOn: opt(form, "receivedOn") });
    return `${r.invoice.number} paid: ${PAYMENT_KIND_LABEL[kind]} ${formatCents(r.payment.amountCents)}${r.invoice.stripeInvoiceId ? "; Stripe is told it was paid outside Stripe" : ""}`;
  });
}

export async function mirrorInvoiceAction(form: FormData) {
  const id = str(form, "invoiceId");
  return runAction(`/invoices/${id}`, async ({ db, actor }) => {
    authorize(actor, "invoice.issue");
    const r = await requestInvoiceMirror(db, actor, id, { force: true });
    if (!r) return "Nothing to mirror: the invoice is not a charged INV, is already in Stripe, or Stripe is not connected";
    return r.item.state === "approved" ? "Queued for Stripe (approved by company policy); the copy appears here once it runs" : "Queued; approve it on the Approvals screen";
  });
}

export async function emailInvoiceAction(form: FormData) {
  const id = str(form, "invoiceId");
  return runAction(`/invoices/${id}`, async ({ db, actor }) => {
    const to = splitList(str(form, "to"));
    const r = await requestInvoiceEmail(db, actor, id, { to: to.length ? to : null, note: opt(form, "note") });
    return r.created ? "Invoice email queued for approval (Approvals screen)" : "An invoice email is already waiting for approval";
  });
}

export async function rePresentAction(form: FormData) {
  const id = str(form, "invoiceId");
  return runAction(`/invoices/${id}`, async ({ db, actor }) => {
    await requestRePresent(db, actor, id, str(form, "reason"));
    return "Re-presentment queued for approval";
  });
}
