"use server";

import { runAction, str } from "@/lib/actions/helpers";
import { addShipmentToInvoice, issueInvoice, markInvoicePaid, voidInvoice } from "@/lib/domain/invoices/service";
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

export async function addShipmentAction(form: FormData) {
  const id = str(form, "invoiceId");
  return runAction(`/invoices/${id}`, async ({ db, actor }) => {
    await addShipmentToInvoice(db, actor, id, str(form, "shipmentId"));
    return "Shipment added to this draft; lines and totals recomputed";
  });
}
