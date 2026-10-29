"use server";

import { opt, runAction, str } from "@/lib/actions/helpers";
import { updateCompanySettings, upsertPosItem, type SettingsPatch } from "@/lib/domain/settings/service";

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
      remitTo: opt(form, "remitTo"),
    };
    await updateCompanySettings(db, actor, patch);
    return "Company settings saved; new documents use them from now on (stored snapshots are unchanged)";
  });
}

export async function upsertPosItemAction(form: FormData) {
  return runAction("/admin/settings", async ({ db, actor }) => {
    await upsertPosItem(db, actor, { code: str(form, "code"), name: str(form, "name"), active: str(form, "active") !== "off" });
    return "POS item saved";
  });
}
