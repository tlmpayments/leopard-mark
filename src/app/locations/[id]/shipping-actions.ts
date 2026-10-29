"use server";

import { num, opt, runAction, str } from "@/lib/actions/helpers";
import { setPriceOverride } from "@/lib/domain/catalog/service";
import { updateAccountShipping, type AccountKind, type DepositMode, type Fulfilment } from "@/lib/domain/customers/shipping";

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
    });
    return "Shipping and billing attributes saved";
  });
}

export async function setPriceOverrideAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await setPriceOverride(db, actor, { locationId: id, skuId: str(form, "skuId"), priceCents: Math.round(num(form, "price") * 100), reason: str(form, "reason") });
    return "Price exception recorded with your approval; it applies to shipments confirmed from now on";
  });
}
