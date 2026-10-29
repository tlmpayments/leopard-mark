"use server";

import { num, opt, runAction, str } from "@/lib/actions/helpers";
import { updateCompanySettings, upsertFreightLane, upsertPosItem, type SettingsPatch } from "@/lib/domain/settings/service";

/** "$1,234.50" or "1234.5" to cents; blank is null. */
function cents(form: FormData, key: string): number | null {
  const raw = str(form, key).replace(/[$,\s]/g, "");
  if (!raw) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
}

export async function updateSettingsAction(form: FormData) {
  return runAction("/admin/settings", async ({ db, actor }) => {
    const patch: SettingsPatch = {
      legalName: str(form, "legalName"),
      dba: str(form, "dba"),
      officeLine1: opt(form, "officeLine1"),
      officeLine2: opt(form, "officeLine2"),
      officeCity: opt(form, "officeCity"),
      officeState: opt(form, "officeState"),
      officePostalCode: opt(form, "officePostalCode"),
      officePhone: opt(form, "officePhone"),
      arEmail: str(form, "arEmail"),
      retailFooter: opt(form, "retailFooter"),
      distributorFooter: opt(form, "distributorFooter"),
      fixedLines: str(form, "fixedLines")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
      nmfcKeg: opt(form, "nmfcKeg"),
      nmfcCan: opt(form, "nmfcCan"),
      nmfcStatus: str(form, "nmfcStatus") === "approved" ? "approved" : "proposed",
      markingConvention: opt(form, "markingConvention"),
      printRemitTo: str(form, "printRemitTo") === "on",
      autoSendPullSheets: str(form, "autoSendPullSheets") === "on",
      remitTo: opt(form, "remitTo"),
      fuelSurchargePct: opt(form, "fuelSurchargePct") ? String(num(form, "fuelSurchargePct")) : "0",
      collectionsThresholdCents: cents(form, "collectionsThreshold") ?? 0,
    };
    await updateCompanySettings(db, actor, patch);
    return "Company settings saved; new documents use them from now on (stored snapshots are unchanged)";
  });
}

export async function upsertPosItemAction(form: FormData) {
  return runAction("/admin/settings", async ({ db, actor }) => {
    await upsertPosItem(db, actor, { code: str(form, "code"), name: str(form, "name"), active: str(form, "active") !== "off", priceCents: cents(form, "price"), unitCostCents: cents(form, "unitCost") });
    return "POS item saved";
  });
}

export async function upsertFreightLaneAction(form: FormData) {
  return runAction("/admin/settings", async ({ db, actor }) => {
    const rate = (k: string) => cents(form, k) ?? NaN;
    await upsertFreightLane(db, actor, {
      code: str(form, "code"),
      name: str(form, "name"),
      minCents: rate("min"),
      tier2to4Cents: rate("tier2to4"),
      tier5to8Cents: rate("tier5to8"),
      truckloadCents: rate("truckload"),
      active: str(form, "active") !== "off",
    });
    return "Freight lane saved; new distributor invoices use it from now on";
  });
}
