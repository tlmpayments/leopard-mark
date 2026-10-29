"use server";

import { opt, runAction, str } from "@/lib/actions/helpers";
import { createBatch, setBatchStatus, type BatchStatus } from "@/lib/domain/lots/service";

export async function createBatchAction(form: FormData) {
  return runAction("/batches/new", async ({ db, actor }) => {
    const b = await createBatch(db, actor, {
      facilityWarehouseId: str(form, "facilityWarehouseId"),
      brandCode: str(form, "brandCode"),
      batchNumber: str(form, "batchNumber"),
      brewDate: opt(form, "brewDate"),
      vesselSize: opt(form, "vesselSize"),
      status: (opt(form, "status") as BatchStatus | null) ?? "scheduled",
      breweryBatchNumber: opt(form, "breweryBatchNumber"),
      notes: opt(form, "notes"),
    });
    return { ok: `Batch ${b.batchNumber} recorded`, redirectTo: `/batches?focus=${b.id}` };
  });
}

export async function setBatchStatusAction(form: FormData) {
  const id = str(form, "batchId");
  return runAction(`/batches?focus=${id}`, async ({ db, actor }) => {
    await setBatchStatus(db, actor, id, str(form, "status") as BatchStatus, opt(form, "reason"), str(form, "on"));
    return "Batch status updated";
  });
}
