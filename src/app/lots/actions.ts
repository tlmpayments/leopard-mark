"use server";

import { type FormState, opt, runAction, runFormAction, str } from "@/lib/actions/helpers";
import { addPackagingDay, confirmLotQuantities, recordPackagingReportOutcome } from "@/lib/domain/lots/service";

/** qty:<skuId> inputs; blank means the SKU was not packaged in this run and is left off the report. */
function quantitiesFrom(form: FormData): Array<{ skuId: string; qty: number }> {
  const out: Array<{ skuId: string; qty: number }> = [];
  for (const [k, v] of form.entries()) {
    if (k.startsWith("qty:") && typeof v === "string" && v.trim() !== "") out.push({ skuId: k.slice(4), qty: Number(v) });
  }
  return out;
}

/**
 * The packaging report form (client, useActionState): a refusal comes back with everything typed kept; success opens
 * the lot. With a batch, the facility and brand come from the batch; a blank run takes the next free digit.
 */
export async function recordPackagingReportAction(_prev: FormState, form: FormData): Promise<FormState> {
  return runFormAction(form, async ({ db, actor }) => {
    const unknown = str(form, "quantitiesUnknown") === "on";
    const { lot, addedDay } = await recordPackagingReportOutcome(db, actor, {
      facilityWarehouseId: opt(form, "facilityWarehouseId"),
      brandCode: opt(form, "brandCode"),
      packagingDate: str(form, "packagingDate"),
      runCode: opt(form, "runCode"),
      batchId: opt(form, "batchId"),
      quantities: unknown ? [] : quantitiesFrom(form),
      notes: opt(form, "notes"),
      quantitiesKnown: !unknown,
    });
    const ok = addedDay ? `Packaging day added to lot ${lot.lotCode}; totals and stock updated` : `Lot ${lot.lotCode} recorded${unknown ? "; quantities to confirm with the host" : ""}`;
    return { ok, redirectTo: `/lots/${lot.id}` };
  });
}

/** Packaging that ran over into a second day (R2-21): quantities added to the same lot, dated the day they were packaged. */
export async function addPackagingDayAction(form: FormData) {
  const id = str(form, "lotId");
  return runAction(`/lots/${id}`, async ({ db, actor }) => {
    const lot = await addPackagingDay(db, actor, id, { packagedOn: str(form, "packagedOn"), quantities: quantitiesFrom(form), note: opt(form, "note") });
    return `Packaging day added to ${lot.lotCode}; totals and stock updated`;
  });
}

export async function confirmLotQuantitiesAction(form: FormData) {
  const id = str(form, "lotId");
  return runAction(`/lots/${id}`, async ({ db, actor }) => {
    await confirmLotQuantities(db, actor, id, quantitiesFrom(form), opt(form, "note") ?? undefined);
    return "Quantities confirmed; the open exception (if any) is resolved";
  });
}
