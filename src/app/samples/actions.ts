"use server";

import { num, opt, runAction, str } from "@/lib/actions/helpers";
import { correctSampleWithdrawal, recordSampleWithdrawal, returnSample } from "@/lib/domain/samples/service";

export async function recordSampleAction(form: FormData) {
  return runAction("/samples", async ({ db, actor }) => {
    await recordSampleWithdrawal(db, actor, { marketId: str(form, "marketId"), skuId: str(form, "skuId"), qty: num(form, "qty"), withdrawnOn: str(form, "withdrawnOn"), repEmployeeId: opt(form, "repEmployeeId"), notes: opt(form, "notes") });
    return "Sample recorded; allocation consumed once";
  });
}

export async function correctSampleAction(form: FormData) {
  return runAction("/samples", async ({ db, actor }) => {
    await correctSampleWithdrawal(db, actor, str(form, "sampleId"), num(form, "qty"), str(form, "reason"));
    return "Sample corrected with history";
  });
}

export async function returnSampleAction(form: FormData) {
  return runAction("/samples", async ({ db, actor }) => {
    await returnSample(db, actor, str(form, "sampleId"), str(form, "condition") === "damaged" ? "damaged" : "sellable", str(form, "evidence"));
    return "Sample return recorded";
  });
}
