"use server";

import { num, opt, runAction, runFormAction, str, type FormState } from "@/lib/actions/helpers";
import { reassignOrderWarehouse } from "@/lib/domain/allocation/service";
import { adminAmendQuantity, cancelUndeliveredDemand, flagAbnormal, requestOrderChange, submitOrder } from "@/lib/domain/orders/service";
import { BusinessError } from "@/lib/errors";

function linesFrom(form: FormData) {
  const lines: Array<{ skuId: string; qty: number }> = [];
  for (const [k, v] of form.entries()) {
    if (k.startsWith("qty:") && typeof v === "string" && v.trim()) {
      const qty = Number(v);
      if (qty > 0) lines.push({ skuId: k.slice(4), qty });
    }
  }
  return lines;
}

export async function submitOrderAction(form: FormData) {
  const locationId = str(form, "locationId");
  return runAction(`/orders/new?locationId=${locationId}`, async ({ db, actor }) => {
    const res = await submitOrder(db, actor, {
      locationId,
      lines: linesFrom(form),
      requestedDate: opt(form, "requestedDate"),
      notes: opt(form, "notes"),
      submissionKey: opt(form, "submissionKey"),
    });
    const notes = [res.replayed ? "already submitted (replay detected)" : "submitted", res.shortage ? "shortage retained for Admin" : null, res.minimum.verdict !== "meets" ? `$90 minimum: ${res.minimum.verdict.replace(/_/g, " ")}` : null].filter(Boolean).join(" · ");
    return { ok: `${res.order.orderNumber} ${notes}`, redirectTo: `/orders/${res.order.id}` };
  });
}

/** Client-form variant (useActionState): keeps typed values and returns field errors instead of redirecting on failure (UX-03). */
export async function submitOrderFormAction(_prev: FormState, form: FormData): Promise<FormState> {
  const locationId = str(form, "locationId");
  return runFormAction(form, async ({ db, actor }) => {
    const lines = linesFrom(form);
    if (!lines.length) throw new BusinessError("Enter a quantity for at least one product", { field: "lines" });
    const requestedDate = opt(form, "requestedDate");
    if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) throw new BusinessError("Requested date must be a calendar date", { field: "requestedDate" });
    const res = await submitOrder(db, actor, { locationId, lines, requestedDate, notes: opt(form, "notes"), submissionKey: opt(form, "submissionKey") });
    const notes = [res.replayed ? "already submitted (replay detected)" : "recorded", res.shortage ? "some units are waiting for stock" : null, res.minimum.verdict !== "meets" ? `$90 minimum: ${res.minimum.verdict.replace(/_/g, " ")}` : null].filter(Boolean).join(" · ");
    return { ok: `${res.order.orderNumber} ${notes}`, redirectTo: `/orders/${res.order.id}` };
  });
}

export async function reassignWarehouseAction(form: FormData) {
  const id = str(form, "orderId");
  return runAction(`/orders/${id}`, async ({ db, actor }) => {
    const r = await reassignOrderWarehouse(db, actor, id, str(form, "warehouseId"), str(form, "reason"));
    return r.shortage ? "Order reassigned; some units are waiting for stock at the new warehouse (retained as demand)" : "Order reassigned and fully reserved at the new warehouse";
  });
}

export async function cancelOrderAction(form: FormData) {
  const id = str(form, "orderId");
  return runAction(`/orders/${id}`, async ({ db, actor }) => {
    await cancelUndeliveredDemand(db, actor, id, str(form, "reason"));
    return "Undelivered demand cancelled; actual receipts (if any) retained";
  });
}

export async function requestChangeAction(form: FormData) {
  const id = str(form, "orderId");
  return runAction(`/orders/${id}`, async ({ db, actor }) => {
    const kind = str(form, "kind") === "substitution_request" ? "substitution_request" : "amend_qty";
    await requestOrderChange(db, actor, { orderLineId: str(form, "orderLineId"), kind, requestedQty: kind === "amend_qty" ? num(form, "requestedQty") : undefined, substituteSkuId: opt(form, "substituteSkuId") ?? undefined, reason: str(form, "reason") });
    return "Change request recorded for Admin (D10/D12 unselected — no silent effect)";
  });
}

export async function amendQtyAction(form: FormData) {
  const id = str(form, "orderId");
  return runAction(`/orders/${id}`, async ({ db, actor }) => {
    await adminAmendQuantity(db, actor, str(form, "orderLineId"), num(form, "newQty"), str(form, "reason"));
    return "Quantity amended with history; reservation adjusted once";
  });
}

export async function flagAbnormalAction(form: FormData) {
  const id = str(form, "orderId");
  return runAction(`/orders/${id}`, async ({ db, actor }) => {
    await flagAbnormal(db, actor, id, str(form, "reason"));
    return "Order flagged (not rejected)";
  });
}
