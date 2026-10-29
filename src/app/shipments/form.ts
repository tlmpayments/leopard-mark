import { opt, str } from "@/lib/actions/helpers";
import type { ShipmentHeaderInput, ShipmentType } from "@/lib/domain/shipments/service";
import { BusinessError } from "@/lib/errors";
import { splitList } from "./labels";

/** Header fields of the create form, parsed; the service validates the business rules. */
export function headerFromForm(form: FormData): ShipmentHeaderInput {
  const type = str(form, "type") as ShipmentType;
  if (!["D", "T", "S"].includes(type)) throw new BusinessError("Choose a shipment type (D, T or S)", { field: "type" });
  const palletCount = opt(form, "palletCount");
  const po = opt(form, "poNumbers");
  return {
    type,
    originWarehouseId: str(form, "originWarehouseId"),
    destinationLocationId: type === "T" ? null : opt(form, "destinationLocationId"),
    destinationWarehouseId: type === "T" ? opt(form, "destinationWarehouseId") : null,
    destinationText: type === "S" ? opt(form, "destinationText") : null,
    pickup: str(form, "pickup") === "on",
    scheduledDate: str(form, "scheduledDate"),
    poNumbers: po ? splitList(po) : null,
    appointment: opt(form, "appointment"),
    carrier: opt(form, "carrier"),
    carrierPhone: opt(form, "carrierPhone"),
    sealNumber: opt(form, "sealNumber"),
    trailerNumber: opt(form, "trailerNumber"),
    palletCount: palletCount ? Number(palletCount) : null,
    palletBuild: opt(form, "palletBuild"),
    freightClass: opt(form, "freightClass"),
    deliveryWindow: opt(form, "deliveryWindow"),
    receivingInstructions: opt(form, "receivingInstructions"),
    notes: opt(form, "notes"),
    overrideReason: opt(form, "overrideReason"),
    driverEmployeeId: opt(form, "driverEmployeeId"),
    orderIds: form.getAll("orderIds").filter((v): v is string => typeof v === "string" && v.length > 0),
  };
}

/**
 * Logistics patch for an existing shipment: only the fields present in the form are sent, so a confirmed shipment
 * never receives a key outside EDITABLE_AFTER_CONFIRMATION (the service refuses those).
 */
export function logisticsPatchFromForm(form: FormData): Partial<ShipmentHeaderInput> {
  const patch: Partial<ShipmentHeaderInput> = {};
  const text = (key: keyof ShipmentHeaderInput & string) => {
    if (form.has(key)) (patch as Record<string, unknown>)[key] = opt(form, key);
  };
  for (const k of ["appointment", "carrier", "carrierPhone", "sealNumber", "trailerNumber", "palletBuild", "freightClass", "deliveryWindow", "receivingInstructions", "notes", "driverEmployeeId", "overrideReason", "destinationText"] as const) text(k);
  if (form.has("poNumbers")) {
    const po = opt(form, "poNumbers");
    patch.poNumbers = po ? splitList(po) : null;
  }
  if (form.has("palletCount")) {
    const pc = opt(form, "palletCount");
    patch.palletCount = pc ? Number(pc) : null;
  }
  if (form.has("scheduledDate")) patch.scheduledDate = str(form, "scheduledDate");
  if (form.has("pickupField")) patch.pickup = str(form, "pickup") === "on";
  return patch;
}
