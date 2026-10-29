/**
 * Shipping and billing attributes of an account (decisions 2.4, 2.6, 1.2, 2.1, 7.4, 3.10, 2.5): kind, served-by
 * distributor, legacy ACC- id, region, terms and deposit overrides, fulfilment, pallet rule and receiving requirements.
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

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  retail: "Retail",
  distributor: "Distributor",
  warehouse: "Warehouse",
  host: "Host brewery",
  internal: "Familiar Ventures (internal)",
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
}

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
