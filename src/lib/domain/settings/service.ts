/**
 * Company settings (single row), POS items and document counters.
 *
 * Decisions: 6.1 shipper = legal name plus dba; 6.2 one company-address setting editable by the Owner;
 * 6.6 NMFC proposed for sign-off; 4.7 marking convention; 7.9 AR sender, remit-to off by default;
 * 3.6 POS items; 7.1/7.3 INV and NC sequences seeded from the Sheet.
 */
import { eq, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { authorize } from "@/lib/authz/authorize";
import type { Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import { COMPANY_SETTINGS_ID } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { BusinessError } from "@/lib/errors";

export const DEFAULT_SETTINGS = {
  id: COMPANY_SETTINGS_ID,
  legalName: "Familiar Ventures, LLC",
  dba: "The Leopard Mark Brewing Company",
  arEmail: "ar@theleopardmark.com",
  retailFooter: "Keg deposits and case CRV will be collected when applicable. Empty kegs collected are credited to this account's keg balance.",
  distributorFooter: "Keg deposits are remitted by the distributor to MicroStar; CRV, where the state applies it, is remitted by the distributor to the state. Wording to be confirmed against the current distributor document (question 6.4).",
  fixedLines: ["Keep refrigerated. Beer is perishable: store cold at all times."],
  nmfcKeg: "88900 (Beer, in kegs) — proposed, verify before use",
  nmfcCan: "88900 (Beer, canned) — proposed, verify before use",
  nmfcStatus: "proposed",
  markingConvention:
    "Lot code = facility (2 digits) + brand (3 letters) + packaging date (yymmdd) + run (1 character), e.g. 01CNT2610071. " +
    "Print the lot code on the can bottom, on the keg collar and on the case end panel. Date format yymmdd. One run digit per packaging run per day; letters only for experimental variants. Draft for owner approval (question 4.7).",
  printRemitTo: false,
} as const;

/** INV and NC sequences continue from the Sheet: INV26375 and NC26001 were the last numbers issued (7.1, 7.3). */
export const COUNTER_SEEDS: ReadonlyArray<{ series: "INV" | "NC"; year: number; lastSeq: number }> = [
  { series: "INV", year: 2026, lastSeq: 375 },
  { series: "NC", year: 2026, lastSeq: 1 },
];

/** POS items ship without a lot, a price or a ledger effect (3.6). */
export const POS_ITEMS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "TAPHANDLE-STD", name: "Tap handle, standard" },
  { code: "TAPHANDLE-PREM", name: "Tap handle, premium" },
  { code: "GLASS-PINT-CASE", name: "Pint glass, case" },
  { code: "COASTERS", name: "Coasters" },
];

/** Idempotent: run at setup, bootstrap and in test fixtures alongside the decision register and gates. */
export async function seedShipmentDefaults(db: DbOrTx): Promise<void> {
  await db.insert(schema.companySettings).values({ ...DEFAULT_SETTINGS, fixedLines: [...DEFAULT_SETTINGS.fixedLines] }).onConflictDoNothing();
  for (const c of COUNTER_SEEDS) {
    await db.insert(schema.docCounter).values(c).onConflictDoNothing();
  }
  for (const p of POS_ITEMS) {
    await db.insert(schema.posItem).values(p).onConflictDoNothing();
  }
}

export type CompanySettings = typeof schema.companySettings.$inferSelect;

export async function getCompanySettings(db: DbOrTx): Promise<CompanySettings> {
  const [row] = await db.select().from(schema.companySettings).where(eq(schema.companySettings.id, COMPANY_SETTINGS_ID));
  if (row) return row;
  await seedShipmentDefaults(db);
  const [seeded] = await db.select().from(schema.companySettings).where(eq(schema.companySettings.id, COMPANY_SETTINGS_ID));
  return seeded!;
}

export type SettingsPatch = Partial<
  Pick<
    CompanySettings,
    | "legalName"
    | "dba"
    | "officeLine1"
    | "officeLine2"
    | "officeCity"
    | "officeState"
    | "officePostalCode"
    | "officePhone"
    | "arEmail"
    | "retailFooter"
    | "distributorFooter"
    | "fixedLines"
    | "nmfcKeg"
    | "nmfcCan"
    | "nmfcStatus"
    | "markingConvention"
    | "printRemitTo"
    | "remitTo"
    | "autoSendPullSheets"
  >
>;

/** Owner only (6.2). Every change is audited with prior and current values. */
export async function updateCompanySettings(db: DbOrTx, actor: Actor, patch: SettingsPatch) {
  authorize(actor, "settings.manage");
  const prior = await getCompanySettings(db);
  if (patch.legalName !== undefined && !patch.legalName.trim()) throw new BusinessError("Legal name is required", { field: "legalName" });
  if (patch.dba !== undefined && !patch.dba.trim()) throw new BusinessError("DBA is required", { field: "dba" });
  if (patch.nmfcStatus !== undefined && !["proposed", "approved"].includes(patch.nmfcStatus)) throw new BusinessError("NMFC status must be proposed or approved", { field: "nmfcStatus" });
  const [row] = await db
    .update(schema.companySettings)
    .set({ ...patch, updatedByEmployeeId: actor.employeeId, updatedAt: new Date() })
    .where(eq(schema.companySettings.id, COMPANY_SETTINGS_ID))
    .returning();
  await recordAudit(db, actor, {
    action: "settings.update",
    subjectType: "company_settings",
    subjectId: COMPANY_SETTINGS_ID,
    prior: Object.fromEntries(Object.keys(patch).map((k) => [k, (prior as Record<string, unknown>)[k]])),
    current: patch as Record<string, unknown>,
  });
  return row;
}

export async function listPosItems(db: DbOrTx, opts: { includeInactive?: boolean } = {}) {
  const rows = await db.select().from(schema.posItem).orderBy(schema.posItem.name);
  return opts.includeInactive ? rows : rows.filter((r) => r.active);
}

export async function upsertPosItem(db: DbOrTx, actor: Actor, input: { code: string; name: string; active?: boolean }) {
  authorize(actor, "catalog.manage");
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!code || !name) throw new BusinessError("Code and name are required");
  const [row] = await db
    .insert(schema.posItem)
    .values({ code, name, active: input.active ?? true })
    .onConflictDoUpdate({ target: schema.posItem.code, set: { name, active: input.active ?? true } })
    .returning();
  await recordAudit(db, actor, { action: "pos_item.upsert", subjectType: "pos_item", subjectId: row.id, current: { code, name, active: input.active ?? true } });
  return row;
}

/**
 * Next number in a series for a year, atomically. The upsert serialises concurrent callers on the counter row.
 * Format: INV26376 (series + two-digit year + three-digit sequence, widening past 999).
 */
export async function nextDocNumber(db: DbOrTx, series: "INV" | "NC" | "CM", year: number): Promise<string> {
  const [row] = await db
    .insert(schema.docCounter)
    .values({ series, year, lastSeq: 1 })
    .onConflictDoUpdate({ target: [schema.docCounter.series, schema.docCounter.year], set: { lastSeq: sql`${schema.docCounter.lastSeq} + 1` } })
    .returning({ lastSeq: schema.docCounter.lastSeq });
  const yy = String(year % 100).padStart(2, "0");
  return `${series}${yy}${String(row.lastSeq).padStart(3, "0")}`;
}
