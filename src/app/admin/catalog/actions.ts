"use server";

import { opt, runAction, str } from "@/lib/actions/helpers";
import { updateSkuDetails, upsertSkuAlias } from "@/lib/domain/catalog/service";
import { BusinessError } from "@/lib/errors";

export async function updateSkuDetailsAction(form: FormData) {
  const skuId = str(form, "skuId");
  return runAction("/admin/catalog", async ({ db, actor }) => {
    const shelf = opt(form, "shelfLifeDays");
    const pallet = opt(form, "palletFraction");
    if (shelf && (!Number.isInteger(Number(shelf)) || Number(shelf) < 0)) throw new BusinessError("Shelf life is a whole number of days", { field: "shelfLifeDays" });
    if (pallet && !(Number(pallet) > 0 && Number(pallet) <= 1)) throw new BusinessError("Pallet fraction is the share of a pallet one selling unit takes (0 to 1, for example 0.0125 for 80 cases per pallet)", { field: "palletFraction" });
    const weight = opt(form, "weightLb");
    if (weight && !(Number(weight) >= 0)) throw new BusinessError("Weight must be a number of pounds", { field: "weightLb" });
    await updateSkuDetails(db, actor, skuId, {
      weightLb: weight,
      upcCase: opt(form, "upcCase"),
      upcRetail: opt(form, "upcRetail"),
      upcUnit: opt(form, "upcUnit"),
      palletFraction: pallet ? String(Number(pallet)) : null,
      recipeVariant: opt(form, "recipeVariant"),
      shelfLifeDays: shelf ? Number(shelf) : null,
    });
    return "SKU details saved";
  });
}

export async function upsertSkuAliasAction(form: FormData) {
  return runAction("/admin/catalog", async ({ db, actor }) => {
    const alias = str(form, "alias");
    if (!alias) throw new BusinessError("Alias code is required", { field: "alias" });
    await upsertSkuAlias(db, actor, alias, str(form, "skuId"), opt(form, "note") ?? undefined);
    return `Alias ${alias.toUpperCase()} now resolves to the chosen SKU (searchable, never selectable)`;
  });
}
