"use server";

import { num, opt, runAction, str } from "@/lib/actions/helpers";
import {
  confirmShipment,
  correctDelivery,
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

/** Per-line outcome fields delivered:<lineId>, refused:<lineId>, damaged:<lineId>, damageReason:<lineId> (R2-8, R2-9). */
function outcomeLinesFrom(form: FormData) {
  const lines: Array<{ lineId: string; deliveredQty: number; refusedQty: number; damagedQty: number; damageReason: string | null }> = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("delivered:") || typeof v !== "string") continue;
    const lineId = k.slice("delivered:".length);
    const n = (key: string) => {
      const t = str(form, `${key}:${lineId}`);
      if (t === "") return 0;
      const x = Number(t);
      if (!Number.isInteger(x) || x < 0) throw new BusinessError("Quantities are whole numbers of zero or more", { field: `${key}:${lineId}` });
      return x;
    };
    lines.push({ lineId, deliveredQty: n("delivered"), refusedQty: n("refused"), damagedQty: n("damaged"), damageReason: opt(form, `damageReason:${lineId}`) });
  }
  return lines;
}

export async function confirmAction(form: FormData) {
  const id = str(form, "shipmentId");
  return runAction(`/shipments/${id}`, async ({ db, actor }) => {
    const s = await confirmShipment(db, actor, id, { scheduledDate: opt(form, "scheduledDate") });
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
    const perLine = form.has("perLine") ? outcomeLinesFrom(form) : null;
    const s = await deliverShipment(db, actor, id, {
      actualDate: str(form, "actualDate"),
      kegPickup: withPickup ? { halfIn: opt(form, "halfIn") ? num(form, "halfIn") : 0, sixtelIn: opt(form, "sixtelIn") ? num(form, "sixtelIn") : 0 } : null,
      note: opt(form, "note"),
      lines: perLine && perLine.length ? perLine : null,
    });
    const exceptions = perLine?.filter((l) => l.refusedQty || l.damagedQty) ?? [];
    const ok = `${s.number} delivered ${s.actualDate}; stock depleted at the origin for what was kept${exceptions.length ? ` (${exceptions.length} line${exceptions.length === 1 ? "" : "s"} refused or damaged)` : ""}${(s.type === "D" || s.type === "S") && s.destinationLocationId ? ", keg balance and invoice updated" : s.type === "T" ? ", stock in transit at the destination until received" : ""}`;
    const returnTo = str(form, "returnTo");
    return returnTo === "/field" ? { ok, redirectTo: "/field" } : ok;
  });
}

export async function voidAction(form: FormData) {
  const id = str(form, "shipmentId");
  return runAction(`/shipments/${id}`, async ({ db, actor }) => {
    const order = str(form, "order") === "cancel" ? "cancel" : "reopen";
    const s = await voidShipment(db, actor, id, str(form, "reason"), { order });
    return s.number ? `Voided; ${s.number} stays as a permanent gap and stock is released${order === "cancel" ? "; the order is cancelled" : "; the order is open again"}` : "Draft voided";
  });
}

export async function correctDeliveryAction(form: FormData) {
  const id = str(form, "shipmentId");
  return runAction(`/shipments/${id}`, async ({ db, actor }) => {
    await correctDelivery(db, actor, id, { lines: outcomeLinesFrom(form), reason: str(form, "reason") });
    return "Delivery corrected; stock, keg balance and the invoice follow the corrected quantities";
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
