"use server";

import { opt, runAction, str } from "@/lib/actions/helpers";
import { confirmCustomerMatch, dismissCustomerMatch, dismissInvoiceMatch, linkStripeInvoice } from "@/lib/domain/collection";

export async function confirmMatchAction(form: FormData) {
  return runAction("/admin/stripe-matches", async ({ db, actor }) => {
    const r = await confirmCustomerMatch(db, actor, str(form, "matchId"), str(form, "locationId"), opt(form, "note"));
    return `Stripe customer ${r.stripeCustomerId} linked to the account; its bank (if any) is on file.`;
  });
}

export async function dismissMatchAction(form: FormData) {
  return runAction("/admin/stripe-matches", async ({ db, actor }) => {
    await dismissCustomerMatch(db, actor, str(form, "matchId"), str(form, "note"));
    return "Dismissed; kept on record.";
  });
}

export async function linkInvoiceMatchAction(form: FormData) {
  return runAction("/admin/stripe-matches", async ({ db, actor }) => {
    const r = await linkStripeInvoice(db, actor, str(form, "matchId"), str(form, "invoiceId"), opt(form, "note"));
    return `Stripe invoice ${r.stripeNumber ?? r.stripeInvoiceId} linked to the portal invoice.`;
  });
}

export async function dismissInvoiceMatchAction(form: FormData) {
  return runAction("/admin/stripe-matches", async ({ db, actor }) => {
    await dismissInvoiceMatch(db, actor, str(form, "matchId"), str(form, "note"));
    return "Dismissed; kept on record.";
  });
}
