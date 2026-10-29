"use server";

import { num, opt, runAction, str } from "@/lib/actions/helpers";
import { updateMarketBilling } from "@/lib/domain/markets/billing";
import { createOrigin, updateOrigin, type OriginKind } from "@/lib/domain/origins/service";
import { BusinessError } from "@/lib/errors";
import { WEEKDAYS } from "./origins-fields";

function triState(form: FormData, key: string): boolean | null {
  const v = str(form, key);
  return v === "yes" ? true : v === "no" ? false : null;
}

function kindFrom(form: FormData): OriginKind {
  const k = str(form, "kind");
  if (k === "brewery" || k === "warehouse" || k === "cold_storage") return k;
  throw new BusinessError("Choose the origin kind (brewery, warehouse or cold storage)", { field: "kind" });
}

export async function updateOriginAction(form: FormData) {
  const id = str(form, "originId");
  return runAction("/admin/markets", async ({ db, actor }) => {
    const hours: Record<string, string> = {};
    for (const day of WEEKDAYS) {
      const v = opt(form, `hours:${day}`);
      if (v) hours[day] = v;
    }
    await updateOrigin(db, actor, id, {
      name: str(form, "name"),
      originCode: opt(form, "originCode"),
      lotFacilityCode: opt(form, "lotFacilityCode"),
      kind: kindFrom(form),
      marketId: opt(form, "marketId"),
      active: str(form, "active") === "on",
      isPrimary: str(form, "isPrimary") === "on",
      appointmentRequired: triState(form, "appointmentRequired"),
      loadingDock: triState(form, "loadingDock"),
      liftgateRequired: triState(form, "liftgateRequired"),
      hours: Object.keys(hours).length ? hours : null,
      shippingContactName: opt(form, "shippingContactName"),
      shippingContactEmail: opt(form, "shippingContactEmail"),
      shippingContactPhone: opt(form, "shippingContactPhone"),
      addressLine1: opt(form, "addressLine1"),
      addressLine2: opt(form, "addressLine2"),
      addressCity: opt(form, "addressCity"),
      addressState: opt(form, "addressState")?.toUpperCase() ?? null,
      addressPostalCode: opt(form, "addressPostalCode"),
      addressText: opt(form, "addressText"),
      fulfillmentContact: opt(form, "fulfillmentContact"),
      pullSheetEmail: opt(form, "pullSheetEmail"),
      pullSheetSendTime: opt(form, "pullSheetSendTime"),
    });
    return "Origin saved";
  });
}

export async function createOriginAction(form: FormData) {
  return runAction("/admin/markets", async ({ db, actor }) => {
    const o = await createOrigin(db, actor, { name: str(form, "name"), kind: kindFrom(form), marketId: opt(form, "marketId"), originCode: opt(form, "originCode"), lotFacilityCode: opt(form, "lotFacilityCode"), addressText: opt(form, "addressText"), isPrimary: str(form, "isPrimary") === "on" });
    return `Origin ${o.name} created; open it below to complete address, hours and contacts`;
  });
}

export async function updateMarketBillingAction(form: FormData) {
  const marketId = str(form, "marketId");
  return runAction("/admin/markets", async ({ db, actor }) => {
    const dollars = (key: string) => (opt(form, key) ? Math.round(num(form, key) * 100) : 0);
    await updateMarketBilling(db, actor, marketId, {
      termsDays: num(form, "termsDays"),
      retailKegDepositCents: dollars("retailKegDeposit"),
      distributorKegDepositCents: dollars("distributorKegDeposit"),
      cod: str(form, "cod") === "on",
      regionList: str(form, "regionList")
        .split(/\r?\n|,/)
        .map((r) => r.trim())
        .filter(Boolean),
      routeDays: form.getAll("routeDays").filter((v): v is string => typeof v === "string"),
    });
    return "Market billing rules saved; blank account overrides inherit them (7.4)";
  });
}
