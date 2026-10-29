"use server";

import { num, opt, runAction, runFormAction, str, type FormState } from "@/lib/actions/helpers";
import { reassignOrderWarehouse } from "@/lib/domain/allocation/service";
import {
  ShortfallError,
  adminAmendQuantity,
  cancelUndeliveredDemand,
  createShipmentForOrder,
  flagAbnormal,
  releaseHeldOrder,
  requestOrderChange,
  submitOrder,
  type OrderSource,
  type SubmitOrderResult,
} from "@/lib/domain/orders/service";
import { confirmShipment } from "@/lib/domain/shipments/service";
import { BusinessError } from "@/lib/errors";
import { splitList } from "../shipments/labels";

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

const SOURCES: OrderSource[] = ["phone", "text", "email", "slack", "rep", "po"];

function orderInputFrom(form: FormData) {
  const sourceText = str(form, "source");
  const source = SOURCES.find((s) => s === sourceText);
  if (!source) throw new BusinessError("Say how the order came in (phone, text, email, Slack, rep or PO)", { field: "source" });
  const decisionText = str(form, "shortfallDecision");
  const shortfallDecision: "ship_available" | "hold" | null = decisionText === "ship_available" ? "ship_available" : decisionText === "hold" ? "hold" : null;
  const requestedDate = opt(form, "requestedDate");
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) throw new BusinessError("Requested date must be a calendar date", { field: "requestedDate" });
  return {
    locationId: str(form, "locationId"),
    lines: linesFrom(form),
    requestedDate,
    notes: opt(form, "notes"),
    source,
    submissionKey: opt(form, "submissionKey"),
    noCharge: form.get("noCharge") === "on",
    pickup: form.get("pickup") === "on",
    poNumbers: splitList(str(form, "poNumbers")),
    shortfallDecision,
    shortfallReason: opt(form, "shortfallReason"),
  };
}

function summarise(res: SubmitOrderResult): string {
  const parts = [res.replayed ? "already submitted (replay detected)" : res.held ? "held: the origin is short and nothing ships until the hold is lifted" : "recorded"];
  if (!res.held && res.shipment) parts.push(res.shipment.type === "S" ? "samples shipment drafted" : "delivery drafted");
  if (res.shortage && !res.held) parts.push("the rest stays an open line until stock arrives");
  if (res.minimumApplies && res.minimum.verdict !== "meets") parts.push(`$90 minimum: ${res.minimum.verdict.replace(/_/g, " ")}`);
  return parts.join("; ");
}

export async function submitOrderAction(form: FormData) {
  const locationId = str(form, "locationId");
  return runAction(`/orders/new?locationId=${locationId}`, async ({ db, actor }) => {
    const res = await submitOrder(db, actor, orderInputFrom(form));
    return { ok: `${res.order.orderNumber} ${summarise(res)}`, redirectTo: `/orders/${res.order.id}` };
  });
}

/**
 * The one-screen order (R2-1, UX-03): the office keys the order, the draft shipment is created with it, and with a
 * scheduled date given the shipment is confirmed in the same go. A short origin comes back as a shortfall panel the
 * office answers (R2-5); typed values survive.
 */
export async function submitOrderFormAction(_prev: FormState, form: FormData): Promise<FormState> {
  return runFormAction(form, async ({ db, actor }) => {
    const input = orderInputFrom(form);
    if (!input.lines.length) throw new BusinessError("Enter a quantity for at least one product", { field: "lines" });
    const confirm = str(form, "intent") === "confirm";
    const scheduledDate = opt(form, "scheduledDate");
    if (confirm && !scheduledDate) throw new BusinessError("Set the scheduled date to confirm the shipment (R2-3)", { field: "scheduledDate" });
    let res: SubmitOrderResult;
    try {
      res = await submitOrder(db, actor, input);
    } catch (err) {
      if (err instanceof ShortfallError) return { state: { shortfall: { originName: err.originName, lines: err.lines } } };
      throw err;
    }
    let ok = `${res.order.orderNumber} ${summarise(res)}`;
    if (confirm && res.shipment && !res.replayed) {
      const s = await confirmShipment(db, actor, res.shipment.id, { scheduledDate });
      ok = `${res.order.orderNumber} recorded and ${s.number} confirmed for ${scheduledDate}; BOL and picking ticket ready to print`;
    }
    return { ok, redirectTo: `/orders/${res.order.id}` };
  });
}

/** Confirm the order's draft shipment from the order page with the scheduled date (R2-3). */
export async function confirmOrderShipmentAction(form: FormData) {
  const orderId = str(form, "orderId");
  return runAction(`/orders/${orderId}`, async ({ db, actor }) => {
    const s = await confirmShipment(db, actor, str(form, "shipmentId"), { scheduledDate: str(form, "scheduledDate") });
    return `Confirmed as ${s.number} for ${s.scheduledDate}; stock allocated, BOL and picking ticket stored${s.type !== "T" && s.destinationLocationId ? ", invoice draft created" : ""}`;
  });
}

export async function releaseHoldAction(form: FormData) {
  const orderId = str(form, "orderId");
  return runAction(`/orders/${orderId}`, async ({ db, actor }) => {
    const r = await releaseHeldOrder(db, actor, orderId, str(form, "reason"));
    return r.shipment ? "Hold lifted; a draft shipment carries what is on hand, the rest stays an open line" : "Hold lifted; nothing is on hand yet, so no shipment was drafted";
  });
}

export async function createShipmentForOrderAction(form: FormData) {
  const orderId = str(form, "orderId");
  return runAction(`/orders/${orderId}`, async ({ db, actor }) => {
    await createShipmentForOrder(db, actor, orderId);
    return "Draft shipment created from what is reserved";
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
    return "Change request recorded for Admin (D10/D12 unselected: no silent effect)";
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
