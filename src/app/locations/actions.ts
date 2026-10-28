"use server";

import { opt, runAction, str } from "@/lib/actions/helpers";
import {
  addContact,
  assignCurrentRep,
  createLocation,
  decideBillingEmailChange,
  editOperational,
  endContact,
  flagSuspectedDuplicate,
  recordLicenseDecision,
  requestBillingEmailChange,
  setLocationStatus,
  setWarehouseOverride,
  updateContact,
  type LicenseState,
  type LocationStatus,
} from "@/lib/domain/customers/service";
import { createHold, grantOverride, resolveHold, withdrawOverride, type HoldKind } from "@/lib/domain/holds/service";
import { clearPayerContact, recordDirectRevocation, requestPaymentSetup, setPayerContact } from "@/lib/domain/payment/service";
import { BusinessError } from "@/lib/errors";
import { runFormAction, type FormState } from "@/lib/actions/helpers";
import { createStandingArrangement, setStandingState } from "@/lib/domain/standing/service";
import { createHostedSetupSession } from "@/lib/integrations/stripe/adapter";
import { baseUrl } from "@/lib/env";

export async function createLocationAction(form: FormData) {
  return runAction("/locations/new", async ({ db, actor }) => {
    const sameBilling = str(form, "billingSame") === "on";
    const { location, similar } = await createLocation(db, actor, {
      marketId: str(form, "marketId"),
      tradeName: str(form, "tradeName"),
      legalName: opt(form, "legalName"),
      deliveryAddress: { line1: str(form, "d_line1"), line2: opt(form, "d_line2"), city: str(form, "d_city"), state: str(form, "d_state"), postalCode: str(form, "d_postal") },
      billingAddress: sameBilling ? { sameAsDelivery: true, line1: "", city: "", state: "", postalCode: "" } : { line1: str(form, "b_line1"), line2: opt(form, "b_line2"), city: str(form, "b_city"), state: str(form, "b_state"), postalCode: str(form, "b_postal") },
      buyer: { name: str(form, "buyerName"), email: opt(form, "buyerEmail"), phone: opt(form, "buyerPhone") },
      ap: str(form, "apName") || str(form, "apEmail") ? { name: str(form, "apName") || "Accounts payable", email: opt(form, "apEmail") } : null,
      deliveryInstructions: opt(form, "deliveryInstructions"),
      receivingRestrictions: opt(form, "receivingRestrictions"),
    });
    const warn = similar.length ? ` (${similar.length} similar name${similar.length > 1 ? "s" : ""} in this market — warning only)` : "";
    return { ok: `Account created${warn}`, redirectTo: `/locations/${location.id}` };
  });
}

/** Client-form variant for the new-account form (useActionState): typed values survive validation errors (UX-03). */
export async function createLocationFormAction(_prev: FormState, form: FormData): Promise<FormState> {
  return runFormAction(form, async ({ db, actor }) => {
    const required = (key: string, label: string) => {
      if (!str(form, key)) throw new BusinessError(`${label} is required`, { field: key });
      return str(form, key);
    };
    const sameBilling = str(form, "billingSame") !== "off";
    const marketId = required("marketId", "Market");
    const tradeName = required("tradeName", "Trade name");
    const line1 = required("d_line1", "Delivery street");
    const city = required("d_city", "Delivery city");
    const state = required("d_state", "Delivery state");
    const postal = required("d_postal", "Delivery ZIP");
    const buyerName = required("buyerName", "Buyer name");
    const buyerEmail = opt(form, "buyerEmail");
    if (buyerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyerEmail)) throw new BusinessError("Buyer email must be a valid address", { field: "buyerEmail" });
    const apEmail = opt(form, "apEmail");
    if (apEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(apEmail)) throw new BusinessError("AP email must be a valid address", { field: "apEmail" });
    const { location, similar } = await createLocation(db, actor, {
      marketId,
      tradeName,
      legalName: opt(form, "legalName"),
      deliveryAddress: { line1, line2: opt(form, "d_line2"), city, state, postalCode: postal },
      billingAddress: sameBilling ? { sameAsDelivery: true, line1: "", city: "", state: "", postalCode: "" } : { line1: required("b_line1", "Billing street"), line2: opt(form, "b_line2"), city: required("b_city", "Billing city"), state: required("b_state", "Billing state"), postalCode: required("b_postal", "Billing ZIP") },
      buyer: { name: buyerName, email: buyerEmail, phone: opt(form, "buyerPhone") },
      ap: str(form, "apName") || apEmail ? { name: str(form, "apName") || "Accounts payable", email: apEmail } : null,
      deliveryInstructions: opt(form, "deliveryInstructions"),
      receivingRestrictions: opt(form, "receivingRestrictions"),
    });
    const warn = similar.length ? ` (${similar.length} similar name${similar.length > 1 ? "s" : ""} in this market — warning only)` : "";
    return { ok: `Account created${warn}`, redirectTo: `/locations/${location.id}` };
  });
}

export async function addContactAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await addContact(db, actor, { locationId: id, role: str(form, "role") as "buyer" | "ap" | "receiving" | "other", name: str(form, "name"), email: opt(form, "email"), phone: opt(form, "phone") });
    return "Contact added";
  });
}

export async function updateContactAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await updateContact(db, actor, { locationId: id, locationContactId: str(form, "locationContactId"), name: str(form, "name") || undefined, phone: opt(form, "phone"), email: form.has("email") ? opt(form, "email") : undefined });
    return "Contact updated";
  });
}

export async function endContactAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await endContact(db, actor, { locationId: id, locationContactId: str(form, "locationContactId"), reason: str(form, "reason") || "removed" });
    return "Contact removed from this account (history kept)";
  });
}

export async function clearPayerAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await clearPayerContact(db, actor, id, str(form, "reason") || "revoked");
    return "Payer authority revoked; setup paths are closed until re-assigned";
  });
}

export async function editOperationalAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await editOperational(db, actor, id, { tradeName: str(form, "tradeName") || undefined, legalName: opt(form, "legalName"), deliveryInstructions: opt(form, "deliveryInstructions"), receivingRestrictions: opt(form, "receivingRestrictions") }, opt(form, "reason") ?? undefined);
    return "Operational details updated (audited)";
  });
}

export async function requestBillingEmailAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await requestBillingEmailChange(db, actor, { locationId: id, requestedEmail: str(form, "email") });
    return "Billing-email change requested — awaiting Admin approval";
  });
}

export async function decideBillingEmailAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    const decision = str(form, "decision") === "approved" ? "approved" : "rejected";
    await decideBillingEmailChange(db, actor, str(form, "requestId"), decision, opt(form, "note") ?? undefined);
    return `Billing-email change ${decision}`;
  });
}

export async function licenseDecisionAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await recordLicenseDecision(db, actor, { locationId: id, state: str(form, "state") as LicenseState, licenseNumber: opt(form, "licenseNumber"), licenseType: opt(form, "licenseType"), evidence: opt(form, "evidence"), note: opt(form, "note") });
    return "License decision recorded";
  });
}

export async function requestSetupAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    const r = await requestPaymentSetup(db, actor, id, opt(form, "payerContactId"));
    return r.noticeReused ? "Setup already requested: the pending invitation is unchanged (send it and record the outcome)" : "Setup requested: Stripe customer association queued; invitation recorded for the manual sender (D32)";
  });
}

export async function hostedSetupLinkAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await createHostedSetupSession(db, actor, id, `${baseUrl()}/locations/${id}`);
    return { ok: "Hosted setup link created; it is shown once under Payment relationship for the manual invitation (expires per Stripe)." };
  });
}

export async function setPayerAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await setPayerContact(db, actor, id, str(form, "contactId"), opt(form, "sharedPayerNote") ?? undefined);
    return "Payer authority recorded";
  });
}

export async function directRevocationAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await recordDirectRevocation(db, actor, id, str(form, "evidence"));
    return "Direct revocation recorded — new debits prohibited immediately";
  });
}

export async function createHoldAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await createHold(db, actor, { locationId: id, kind: str(form, "kind") as HoldKind, cause: str(form, "cause") });
    return "Hold recorded (orders remain capturable)";
  });
}

export async function resolveHoldAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await resolveHold(db, actor, str(form, "holdId"), str(form, "resolution"));
    return "Hold cause resolved";
  });
}

export async function overrideAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await grantOverride(db, actor, { locationId: id, holdId: str(form, "holdId"), scope: str(form, "scope"), orderId: opt(form, "orderId"), reason: str(form, "reason") });
    return "Override granted (audited). The financial fact is unchanged.";
  });
}

export async function withdrawOverrideAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await withdrawOverride(db, actor, str(form, "overrideId"), str(form, "reason") || "withdrawn");
    return "Override withdrawn";
  });
}

export async function assignRepAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await assignCurrentRep(db, actor, id, str(form, "employeeId"), str(form, "reason") || "reassigned");
    return "Current rep updated; originating and historical ownership preserved";
  });
}

export async function warehouseOverrideAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await setWarehouseOverride(db, actor, id, opt(form, "warehouseId"), str(form, "reason") || "warehouse override");
    return "Warehouse assignment updated";
  });
}

export async function statusAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await setLocationStatus(db, actor, id, str(form, "status") as LocationStatus, str(form, "reason"));
    return "Status updated";
  });
}

export async function duplicateAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await flagSuspectedDuplicate(db, actor, id, str(form, "otherLocationId"), str(form, "note") || "suspected duplicate");
    return "Suspected duplicate case opened (no data deleted)";
  });
}

export async function createStandingAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    const lines: Array<{ skuId: string; qty: number }> = [];
    for (const [k, v] of form.entries()) {
      if (k.startsWith("qty:") && typeof v === "string" && v.trim()) {
        const qty = Number(v);
        if (qty > 0) lines.push({ skuId: k.slice(4), qty });
      }
    }
    await createStandingArrangement(db, actor, { locationId: id, lines, authorizationNote: str(form, "authorizationNote"), requestedCadence: opt(form, "requestedCadence") });
    return "Standing arrangement captured. Generation stays inactive until D13 is selected.";
  });
}

export async function standingStateAction(form: FormData) {
  const id = str(form, "locationId");
  return runAction(`/locations/${id}`, async ({ db, actor }) => {
    await setStandingState(db, actor, str(form, "arrangementId"), str(form, "state") as "defined" | "paused" | "ended", str(form, "reason") || "");
    return "Standing arrangement updated";
  });
}

