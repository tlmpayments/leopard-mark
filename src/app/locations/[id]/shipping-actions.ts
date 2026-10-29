"use server";

import { num, opt, runAction, str } from "@/lib/actions/helpers";
import { endPriceOverride, setPriceOverride } from "@/lib/domain/catalog/service";
import { PER_UNIT_KINDS, updateAccountShipping, type AccountKind, type DepositMode, type FreightMode, type Fulfilment, type PayBy } from "@/lib/domain/customers/shipping";

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
      deliverWithoutSignature: form.get("deliverWithoutSignature") === "on",
    });
    return "Shipping and billing attributes saved";
  });
}

/** Round 3: freight and printed invoice notes for a distributor account. */
export async function updateAccountFreightAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    const perUnit: Record<string, number> = {};
    for (const { kind } of PER_UNIT_KINDS) {
      const raw = str(form, `perUnit:${kind}`).replace(/[$,\s]/g, "");
      if (raw) perUnit[kind] = Math.round(Number(raw) * 100);
    }
    const minPallets = opt(form, "freightMinPallets");
    await updateAccountShipping(db, actor, id, {
      freightMode: (str(form, "freightMode") || "none") as FreightMode,
      freightLaneCode: opt(form, "freightLaneCode"),
      freightPerUnit: Object.keys(perUnit).length ? perUnit : null,
      freightMinPallets: minPallets ? Number(minPallets) : null,
      invoiceNotes: opt(form, "invoiceNotes"),
    });
    return "Freight and invoice notes saved; new invoices use them from now on";
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
