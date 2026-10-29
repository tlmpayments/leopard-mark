"use server";

import { num, opt, runAction, str } from "@/lib/actions/helpers";
import { endPriceOverride, setPriceOverride } from "@/lib/domain/catalog/service";
import { updateAccountShipping, type AccountKind, type DepositMode, type Fulfilment, type PayBy } from "@/lib/domain/customers/shipping";

export async function updateAccountShippingAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    const terms = opt(form, "termsDaysOverride");
    const deposit = opt(form, "depositOverride");
    const appt = str(form, "appointmentRequired");
    await updateAccountShipping(db, actor, id, {
      kind: str(form, "kind") as AccountKind,
      servedByLocationId: opt(form, "servedByLocationId"),
      legacyAccountId: opt(form, "legacyAccountId"),
      region: opt(form, "region"),
      termsDaysOverride: terms ? Number(terms) : null,
      depositMode: str(form, "depositMode") as DepositMode,
      depositCentsOverride: deposit ? Math.round(Number(deposit) * 100) : null,
      fulfilment: str(form, "fulfilment") as Fulfilment,
      appointmentRequired: appt === "yes" ? true : appt === "no" ? false : null,
      palletRule: opt(form, "palletRule"),
      receivingRequirements: opt(form, "receivingRequirements"),
      firstDeliveryOn: opt(form, "firstDeliveryOn"),
      payBy: (opt(form, "payBy") as PayBy | null) ?? null,
      invoiceOnReceipt: form.get("invoiceOnReceipt") === "on",
    });
    return "Shipping and billing attributes saved";
  });
}

/** The floating keg deposit on file (R2-13): taken once on the first order, settled on the last. */
export async function updateDepositOnFileAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    const taken = opt(form, "depositTaken");
    await updateAccountShipping(db, actor, id, {
      depositTakenCents: taken ? Math.round(Number(taken) * 100) : null,
      depositTakenOn: opt(form, "depositTakenOn"),
      depositSettledOn: opt(form, "depositSettledOn"),
      depositSettlementNote: opt(form, "depositSettlementNote"),
    });
    return "Deposit on file updated";
  });
}

export async function endPriceOverrideAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await endPriceOverride(db, actor, str(form, "overrideId"), str(form, "reason"));
    return "Price exception ended; the posted price applies from now";
  });
}

export async function setPriceOverrideAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await setPriceOverride(db, actor, { locationId: id, skuId: str(form, "skuId"), priceCents: Math.round(num(form, "price") * 100), reason: str(form, "reason"), endsOn: str(form, "endsOn") });
    return "Price exception recorded with your approval and end date; it applies to shipments confirmed from now on";
  });
}
