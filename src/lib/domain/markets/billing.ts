/**
 * Market billing rules (decisions 7.4, 3.10, 2.1): terms days, keg deposit per account kind, cash on delivery and the
 * region sub-list. Blank account overrides inherit these; a future market (Texas) may be COD.
 */
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { BusinessError } from "@/lib/errors";

export interface MarketBillingPatch {
  termsDays?: number;
  retailKegDepositCents?: number;
  distributorKegDepositCents?: number;
  cod?: boolean;
  regionList?: string[] | null;
  /** Optional route days (R2-4), as weekday names; shown when the office schedules, never enforced. */
  routeDays?: string[] | null;
}

export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function wholeNumber(value: number | undefined, field: string, label: string) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) throw new BusinessError(`${label} must be a whole number of zero or more`, { field });
}

export async function updateMarketBilling(db: DbOrTx, actor: Actor, marketId: string, patch: MarketBillingPatch) {
  authorize(actor, "market.manage", { marketId });
  const [prior] = await db.select().from(schema.market).where(eq(schema.market.id, marketId));
  if (!prior) throw new BusinessError("Market not found");
  wholeNumber(patch.termsDays, "termsDays", "Terms (days)");
  wholeNumber(patch.retailKegDepositCents, "retailKegDepositCents", "Retail keg deposit");
  wholeNumber(patch.distributorKegDepositCents, "distributorKegDepositCents", "Distributor keg deposit");
  const set: Partial<typeof schema.market.$inferInsert> = {};
  if (patch.termsDays !== undefined) set.termsDays = patch.termsDays;
  if (patch.retailKegDepositCents !== undefined) set.retailKegDepositCents = patch.retailKegDepositCents;
  if (patch.distributorKegDepositCents !== undefined) set.distributorKegDepositCents = patch.distributorKegDepositCents;
  if (patch.cod !== undefined) set.cod = patch.cod;
  if (patch.regionList !== undefined) {
    const regions = Array.from(new Set((patch.regionList ?? []).map((r) => r.trim()).filter(Boolean)));
    set.regionList = regions.length ? regions : null;
  }
  if (patch.routeDays !== undefined) {
    const days = (patch.routeDays ?? []).map((d) => d.trim()).filter(Boolean);
    const bad = days.find((d) => !(WEEKDAY_NAMES as readonly string[]).includes(d));
    if (bad) throw new BusinessError(`Route days are weekday names (${WEEKDAY_NAMES.join(", ")}); "${bad}" is not one`, { field: "routeDays" });
    const ordered = WEEKDAY_NAMES.filter((d) => days.includes(d));
    set.routeDays = ordered.length ? [...ordered] : null;
  }
  if (Object.keys(set).length === 0) throw new BusinessError("Nothing to change");
  const [row] = await db.update(schema.market).set(set).where(eq(schema.market.id, marketId)).returning();
  await recordAudit(db, actor, {
    action: "market.billing",
    subjectType: "market",
    subjectId: marketId,
    prior: Object.fromEntries(Object.keys(set).map((k) => [k, (prior as Record<string, unknown>)[k]])),
    current: set,
    marketId,
  });
  return row;
}
