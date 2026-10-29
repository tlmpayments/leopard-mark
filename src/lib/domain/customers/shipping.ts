/**
 * Shipping and billing attributes of an account (decisions 2.4, 2.6, 1.2, 2.1, 7.4, 3.10, 2.5): kind, served-by
 * distributor, legacy ACC- id, region, terms and deposit overrides, fulfilment, pallet rule and receiving requirements.
 * Round 2 adds the payment channel (R2-12), invoice on receipt (R2-30) and the floating deposit on file (R2-13).
 * Admin (location.lifecycle) maintains them; every change is audited with prior and current values.
 */
import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { BusinessError } from "@/lib/errors";

export type AccountKind = (typeof schema.accountKindEnum.enumValues)[number];
export type DepositMode = (typeof schema.depositModeEnum.enumValues)[number];
export type Fulfilment = (typeof schema.fulfilmentEnum.enumValues)[number];
export type PayBy = (typeof schema.payByEnum.enumValues)[number];

/** How the account pays (R2-12). Recorded on the account and copied onto each invoice at issue; collection stays manual. */
export const PAY_BY_LABEL: Record<PayBy, string> = {
  fintech: "Fintech",
  stripe: "Stripe",
  check: "Check",
};

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  retail: "Retail",
  distributor: "Distributor",
  warehouse: "Warehouse",
  host: "Host brewery",
  internal: "Internal (house account)",
  individual: "Individual",
};

export const DEPOSIT_MODE_LABEL: Record<DepositMode, string> = {
  market_default: "Market rule",
  per_keg: "Per keg (account amount)",
  floating: "Floating deposit on file",
  none: "No deposit",
};

export interface AccountShippingPatch {
  kind?: AccountKind;
  servedByLocationId?: string | null;
  legacyAccountId?: string | null;
  region?: string | null;
  termsDaysOverride?: number | null;
  depositMode?: DepositMode;
  depositCentsOverride?: number | null;
  fulfilment?: Fulfilment;
  appointmentRequired?: boolean | null;
  palletRule?: string | null;
  receivingRequirements?: string | null;
  firstDeliveryOn?: string | null;
  payBy?: PayBy | null;
  invoiceOnReceipt?: boolean;
  /** Floating deposit on file (R2-13): one deposit taken on the first order, settled on the last. */
  depositTakenCents?: number | null;
  depositTakenOn?: string | null;
  depositSettledOn?: string | null;
  depositSettlementNote?: string | null;
  /** Round 3: the driver may leave the delivery without a signature (printed on the delivery receipt). */
  deliverWithoutSignature?: boolean;
  /** Round 3: notes printed on every invoice to this account (distributor terms, FOB, keg statement). */
  invoiceNotes?: string | null;
  /** Round 3 freight to a distributor: none, a freight lane per pallet plus fuel, or fixed per-unit charges. */
  freightMode?: FreightMode;
  freightLaneCode?: string | null;
  freightPerUnit?: Record<string, number> | null;
  freightMinPallets?: number | null;
}

export type FreightMode = "none" | "lane" | "per_unit";
export const FREIGHT_MODE_LABEL: Record<FreightMode, string> = {
  none: "No freight charged",
  lane: "Freight lane, per pallet plus fuel surcharge",
  per_unit: "Fixed per-unit delivery charge (fuel included)",
};
/** Package kinds a per-unit delivery charge can be set for, with their labels. */
export const PER_UNIT_KINDS: ReadonlyArray<{ kind: string; label: string }> = [
  { kind: "keg_half", label: "1/2 bbl keg" },
  { kind: "keg_sixtel", label: "1/6 bbl keg" },
  { kind: "case_12oz_can", label: "12 oz case" },
  { kind: "case_24oz_can", label: "24 oz case" },
];

export async function updateAccountShipping(db: DbOrTx, actor: Actor, locationId: string, patch: AccountShippingPatch) {
  const [prior] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!prior) throw new BusinessError("Account not found");
  authorize(actor, "location.lifecycle", { marketId: prior.marketId });
  const set: Partial<typeof schema.customerLocation.$inferInsert> = {};
  if (patch.kind !== undefined) {
    if (!schema.accountKindEnum.enumValues.includes(patch.kind)) throw new BusinessError("Unknown account kind", { field: "kind" });
    set.kind = patch.kind;
  }
  if (patch.servedByLocationId !== undefined) {
    if (patch.servedByLocationId) {
      if (patch.servedByLocationId === locationId) throw new BusinessError("An account cannot be served by itself", { field: "servedByLocationId" });
      const [dist] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, patch.servedByLocationId));
      if (!dist) throw new BusinessError("Serving distributor not found", { field: "servedByLocationId" });
      if (dist.kind !== "distributor") throw new BusinessError(`${dist.tradeName} is not a distributor account (2.6)`, { field: "servedByLocationId" });
      if (dist.marketId !== prior.marketId) throw new BusinessError(`${dist.tradeName} is in a different market`, { field: "servedByLocationId" });
    }
    set.servedByLocationId = patch.servedByLocationId;
  }
  if (patch.legacyAccountId !== undefined) set.legacyAccountId = patch.legacyAccountId?.trim() || null;
  if (patch.region !== undefined) set.region = patch.region?.trim() || null;
  if (patch.termsDaysOverride !== undefined) {
    if (patch.termsDaysOverride !== null && (!Number.isInteger(patch.termsDaysOverride) || patch.termsDaysOverride < 0)) throw new BusinessError("Terms override must be a whole number of days", { field: "termsDaysOverride" });
    set.termsDaysOverride = patch.termsDaysOverride;
  }
  if (patch.depositMode !== undefined) {
    if (!schema.depositModeEnum.enumValues.includes(patch.depositMode)) throw new BusinessError("Unknown deposit mode", { field: "depositMode" });
    set.depositMode = patch.depositMode;
  }
  if (patch.depositCentsOverride !== undefined) {
    if (patch.depositCentsOverride !== null && (!Number.isInteger(patch.depositCentsOverride) || patch.depositCentsOverride < 0)) throw new BusinessError("Deposit override must be a whole number of cents", { field: "depositCentsOverride" });
    set.depositCentsOverride = patch.depositCentsOverride;
  }
  if (patch.fulfilment !== undefined) {
    if (!schema.fulfilmentEnum.enumValues.includes(patch.fulfilment)) throw new BusinessError("Fulfilment is delivery or pickup", { field: "fulfilment" });
    set.fulfilment = patch.fulfilment;
  }
  if (patch.appointmentRequired !== undefined) set.appointmentRequired = patch.appointmentRequired;
  if (patch.palletRule !== undefined) set.palletRule = patch.palletRule?.trim() || null;
  if (patch.receivingRequirements !== undefined) set.receivingRequirements = patch.receivingRequirements?.trim() || null;
  if (patch.firstDeliveryOn !== undefined) {
    if (patch.firstDeliveryOn && !/^\d{4}-\d{2}-\d{2}$/.test(patch.firstDeliveryOn)) throw new BusinessError("First delivery date must be YYYY-MM-DD", { field: "firstDeliveryOn" });
    set.firstDeliveryOn = patch.firstDeliveryOn || null;
  }
  if (patch.payBy !== undefined) {
    if (patch.payBy !== null && !schema.payByEnum.enumValues.includes(patch.payBy)) throw new BusinessError("Payment channel is Fintech, Stripe or check", { field: "payBy" });
    set.payBy = patch.payBy;
  }
  if (patch.invoiceOnReceipt !== undefined) set.invoiceOnReceipt = patch.invoiceOnReceipt;
  if (patch.depositTakenCents !== undefined) {
    if (patch.depositTakenCents !== null && (!Number.isInteger(patch.depositTakenCents) || patch.depositTakenCents < 0)) throw new BusinessError("Deposit on file must be a whole number of cents", { field: "depositTakenCents" });
    set.depositTakenCents = patch.depositTakenCents;
  }
  for (const k of ["depositTakenOn", "depositSettledOn"] as const) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BusinessError("Date must be YYYY-MM-DD", { field: k });
    set[k] = v || null;
  }
  if (patch.depositSettlementNote !== undefined) set.depositSettlementNote = patch.depositSettlementNote?.trim() || null;
  if (patch.deliverWithoutSignature !== undefined) set.deliverWithoutSignature = patch.deliverWithoutSignature;
  if (patch.invoiceNotes !== undefined) set.invoiceNotes = patch.invoiceNotes?.trim() || null;
  if (patch.freightMode !== undefined) {
    if (!["none", "lane", "per_unit"].includes(patch.freightMode)) throw new BusinessError("Freight is none, a lane or per unit", { field: "freightMode" });
    set.freightMode = patch.freightMode;
  }
  if (patch.freightLaneCode !== undefined) {
    const code = patch.freightLaneCode?.trim().toUpperCase() || null;
    if (code) {
      const [lane] = await db.select().from(schema.freightLane).where(eq(schema.freightLane.code, code));
      if (!lane) throw new BusinessError(`Freight lane ${code} not found; add it under Settings first`, { field: "freightLaneCode" });
    }
    set.freightLaneCode = code;
  }
  if (patch.freightPerUnit !== undefined) {
    const rates = Object.fromEntries(Object.entries(patch.freightPerUnit ?? {}).filter(([, v]) => v != null && v > 0));
    for (const v of Object.values(rates)) if (!Number.isInteger(v)) throw new BusinessError("Per-unit charges are whole cents", { field: "freightPerUnit" });
    set.freightPerUnit = Object.keys(rates).length ? rates : null;
  }
  if (patch.freightMinPallets !== undefined) {
    const v = patch.freightMinPallets;
    if (v != null && (!Number.isInteger(v) || v < 1 || v > 30)) throw new BusinessError("Minimum pallets is a whole number from 1 to 30", { field: "freightMinPallets" });
    set.freightMinPallets = v ?? null;
  }
  const mode = set.freightMode ?? prior.freightMode;
  if (mode === "lane" && !(set.freightLaneCode !== undefined ? set.freightLaneCode : prior.freightLaneCode)) throw new BusinessError("Choose the freight lane", { field: "freightLaneCode" });
  if (mode === "per_unit" && !(set.freightPerUnit !== undefined ? set.freightPerUnit : prior.freightPerUnit)) throw new BusinessError("Enter at least one per-unit delivery charge", { field: "freightPerUnit" });
  if (set.depositSettledOn && !(set.depositTakenCents ?? prior.depositTakenCents)) throw new BusinessError("Record the deposit taken before settling it", { field: "depositSettledOn" });
  if (Object.keys(set).length === 0) throw new BusinessError("Nothing to change");
  set.updatedAt = new Date();
  const [row] = await db.update(schema.customerLocation).set(set).where(eq(schema.customerLocation.id, locationId)).returning();
  const keys = Object.keys(set).filter((k) => k !== "updatedAt");
  await recordAudit(db, actor, {
    action: "location.shipping",
    subjectType: "customer_location",
    subjectId: locationId,
    prior: Object.fromEntries(keys.map((k) => [k, (prior as Record<string, unknown>)[k]])),
    current: Object.fromEntries(keys.map((k) => [k, (set as Record<string, unknown>)[k]])),
    marketId: prior.marketId,
  });
  return row;
}
