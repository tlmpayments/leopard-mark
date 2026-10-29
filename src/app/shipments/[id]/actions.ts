"use server";

import { num, opt, runAction, str } from "@/lib/actions/helpers";
import {
  confirmShipment,
  deliverShipment,
  markShipmentOut,
  receiveTransfer,
  regenerateShipmentDocuments,
  replaceShipmentLines,
  stageShipment,
  updateShipmentHeader,
  voidShipment,
  type ShipmentLineInput,
} from "@/lib/domain/shipments/service";
import { BusinessError } from "@/lib/errors";
import { logisticsPatchFromForm } from "../form";

const ROWS = 40;

/** Rows are sku:i / pos:i / lot:i / qty:i / reason:i; a row without a SKU, POS item or quantity is ignored. */
function linesFromForm(form: FormData): ShipmentLineInput[] {
  const lines: ShipmentLineInput[] = [];
  for (let i = 0; i < ROWS; i += 1) {
    const skuId = opt(form, `sku:${i}`);
    const posItemId = opt(form, `pos:${i}`);
    const qtyText = opt(form, `qty:${i}`);
    if (!skuId && !posItemId && !qtyText) continue;
    if (!skuId && !posItemId) throw new BusinessError(`Row ${i + 1}: choose a SKU or a POS item`, { field: "lines" });
    if (skuId && posItemId) throw new BusinessError(`Row ${i + 1}: a line is either a SKU or a POS item, not both`, { field: "lines" });
    const qty = Number(qtyText);
    if (!qtyText || !Number.isInteger(qty) || qty <= 0) throw new BusinessError(`Row ${i + 1}: quantity must be a positive whole number`, { field: "lines" });
    lines.push({ skuId, posItemId, lotId: skuId ? opt(form, `lot:${i}`) : null, qty, lotReason: opt(form, `reason:${i}`) });
  }
  return lines;
}

export async function saveLinesAction(form: FormData) {
  const id = str(form, "shipmentId");
  return runAction(`/shipments/${id}`, async ({ db, actor }) => {
    const s = await replaceShipmentLines(db, actor, id, linesFromForm(form));
    return s.status === "draft" ? "Lines saved" : "Lines replaced; stock re-allocated and documents regenerated with the next revision mark";
  });
}

export async function saveLogisticsAction(form: FormData) {
  const id = str(form, "shipmentId");
  return runAction(`/shipments/${id}`, async ({ db, actor }) => {
    const s = await updateShipmentHeader(db, actor, id, logisticsPatchFromForm(form));
    return s.status === "draft" ? "Shipment updated" : "Logistics updated; documents regenerated with the next revision mark";
  });
}

export async function confirmAction(form: FormData) {
  const id = str(form, "shipmentId");
  return runAction(`/shipments/${id}`, async ({ db, actor }) => {
    const s = await confirmShipment(db, actor, id);
    return `Confirmed as ${s.number}; stock allocated, BOL and picking ticket stored${(s.type === "D" || s.type === "S") && s.destinationLocationId ? ", invoice draft created" : ""}`;
  });
}

export async function stageAction(form: FormData) {
  const id = str(form, "shipmentId");
  return runAction(`/shipments/${id}`, async ({ db, actor }) => {
    await stageShipment(db, actor, id);
    return "Marked staged";
  });
}

export async function outAction(form: FormData) {
  const id = str(form, "shipmentId");
  return runAction(`/shipments/${id}`, async ({ db, actor }) => {
    await markShipmentOut(db, actor, id);
    return "Marked out for delivery";
  });
}

export async function deliverAction(form: FormData) {
  const id = str(form, "shipmentId");
  return runAction(`/shipments/${id}`, async ({ db, actor }) => {
    const withPickup = form.has("halfIn") || form.has("sixtelIn");
    const s = await deliverShipment(db, actor, id, {
      actualDate: str(form, "actualDate"),
      kegPickup: withPickup ? { halfIn: opt(form, "halfIn") ? num(form, "halfIn") : 0, sixtelIn: opt(form, "sixtelIn") ? num(form, "sixtelIn") : 0 } : null,
      note: opt(form, "note"),
    });
    return `Delivered ${s.actualDate}; stock depleted at the origin${(s.type === "D" || s.type === "S") && s.destinationLocationId ? ", keg balance and invoice updated" : s.type === "T" ? ", stock in transit at the destination until received" : ""}`;
  });
}

export async function voidAction(form: FormData) {
  const id = str(form, "shipmentId");
  return runAction(`/shipments/${id}`, async ({ db, actor }) => {
    const s = await voidShipment(db, actor, id, str(form, "reason"));
    return s.number ? `Voided; ${s.number} stays as a permanent gap and allocations are released` : "Draft voided";
  });
}

export async function regenerateAction(form: FormData) {
  const id = str(form, "shipmentId");
  return runAction(`/shipments/${id}`, async ({ db, actor }) => {
    await regenerateShipmentDocuments(db, actor, id, str(form, "reason"));
    return "Documents regenerated with the next revision mark";
  });
}

export async function receiveAction(form: FormData) {
  const id = str(form, "shipmentId");
  return runAction(`/shipments/${id}`, async ({ db, actor }) => {
    const lines: Array<{ skuId: string; qtyReceived: number }> = [];
    for (const [k, v] of form.entries()) {
      if (k.startsWith("recv:") && typeof v === "string") {
        const qty = v.trim() === "" ? 0 : Number(v);
        lines.push({ skuId: k.slice(5), qtyReceived: qty });
      }
    }
    const r = await receiveTransfer(db, actor, id, { receivedOn: str(form, "receivedOn"), lines, note: opt(form, "note") });
    return r.discrepancies.length ? `Received with discrepancies (${r.discrepancies.join("; ")}); an exception is open for Admin` : "Received; stock moved from in transit to on hand";
  });
}
