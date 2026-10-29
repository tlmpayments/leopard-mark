"use server";

import { runAction, str } from "@/lib/actions/helpers";
import { issueCreditMemo, issueInvoice, markInvoicePaid, voidCreditMemo, voidInvoice } from "@/lib/domain/invoices/service";
import { formatCents } from "@/lib/domain/catalog/service";

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
