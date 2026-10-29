/**
 * Origins: warehouses, cold storage and host breweries (decisions 2.2, 2.3, 2.4, 2.11).
 * An origin may exist without a market (Prost, Real Ale). The three-letter origin code is required to confirm a
 * shipment; the two-digit lot facility code identifies a brewery in lot codes.
 */
import { asc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { authorize } from "@/lib/authz/authorize";
import type { Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { BusinessError } from "@/lib/errors";

export type Origin = typeof schema.warehouse.$inferSelect;
export type OriginKind = (typeof schema.originKindEnum.enumValues)[number];

/** Confirmed origin codes (2.2). Kept here so the import and the UI agree. */
export const ORIGIN_CODES: ReadonlyArray<{ code: string; name: string; kind: OriginKind; lotFacilityCode: string | null }> = [
  { code: "EBB", name: "East Brother Beer", kind: "brewery", lotFacilityCode: "01" },
  { code: "BWD", name: "Beachwood Brewing", kind: "brewery", lotFacilityCode: "02" },
  { code: "PRO", name: "Prost Brewing", kind: "brewery", lotFacilityCode: "03" },
  { code: "RTB", name: "Round Table Brewing", kind: "brewery", lotFacilityCode: "04" },
  { code: "ALE", name: "AleSmith Brewing", kind: "brewery", lotFacilityCode: "05" },
  { code: "JAB", name: "Jack's Abby Brewing", kind: "brewery", lotFacilityCode: "06" },
  { code: "RAL", name: "Real Ale Brewing", kind: "brewery", lotFacilityCode: "07" },
  { code: "EWD", name: "Express Wine Delivery", kind: "warehouse", lotFacilityCode: null },
  { code: "WLA", name: "Balmuth & Co.", kind: "warehouse", lotFacilityCode: null },
  { code: "RAD", name: "Radford Warehouse", kind: "warehouse", lotFacilityCode: null },
];

const CODE_RE = /^[A-Z]{3}$/;
const FACILITY_RE = /^\d{2}$/;

export async function listOrigins(db: DbOrTx, opts: { includeInactive?: boolean } = {}): Promise<Origin[]> {
  const rows = await db.select().from(schema.warehouse).orderBy(asc(schema.warehouse.name));
  return opts.includeInactive ? rows : rows.filter((r) => r.active);
}

export async function getOrigin(db: DbOrTx, id: string): Promise<Origin | null> {
  const [row] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, id));
  return row ?? null;
}

export async function originByCode(db: DbOrTx, code: string): Promise<Origin | null> {
  const [row] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.originCode, code.trim().toUpperCase()));
  return row ?? null;
}

export interface OriginPatch {
  name?: string;
  marketId?: string | null;
  originCode?: string | null;
  lotFacilityCode?: string | null;
  kind?: OriginKind;
  active?: boolean;
  isPrimary?: boolean;
  appointmentRequired?: boolean | null;
  loadingDock?: boolean | null;
  liftgateRequired?: boolean | null;
  hours?: Record<string, string> | null;
  shippingContactName?: string | null;
  shippingContactEmail?: string | null;
  shippingContactPhone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  addressPostalCode?: string | null;
  addressText?: string | null;
  fulfillmentContact?: string | null;
}

/** Admin maintains origins (warehouse.manage). Codes are validated; the primary flag stays unique per market. */
export async function updateOrigin(db: DbOrTx, actor: Actor, id: string, patch: OriginPatch) {
  const prior = await getOrigin(db, id);
  if (!prior) throw new BusinessError("Origin not found");
  authorize(actor, "warehouse.manage", { marketId: patch.marketId ?? prior.marketId });
  const set: Partial<Origin> = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new BusinessError("Name is required", { field: "name" });
    set.name = patch.name.trim();
  }
  if (patch.originCode !== undefined) {
    const code = patch.originCode?.trim().toUpperCase() || null;
    if (code && !CODE_RE.test(code)) throw new BusinessError("Origin code must be three letters (for example EBB)", { field: "originCode" });
    if (code) {
      const clash = await originByCode(db, code);
      if (clash && clash.id !== id) throw new BusinessError(`Origin code ${code} already belongs to ${clash.name}`, { field: "originCode" });
    }
    set.originCode = code;
  }
  if (patch.lotFacilityCode !== undefined) {
    const fc = patch.lotFacilityCode?.trim() || null;
    if (fc && !FACILITY_RE.test(fc)) throw new BusinessError("Lot facility code must be two digits (01 to 99)", { field: "lotFacilityCode" });
    set.lotFacilityCode = fc;
  }
  for (const k of [
    "marketId",
    "kind",
    "active",
    "appointmentRequired",
    "loadingDock",
    "liftgateRequired",
    "hours",
    "shippingContactName",
    "shippingContactEmail",
    "shippingContactPhone",
    "addressLine1",
    "addressLine2",
    "addressCity",
    "addressState",
    "addressPostalCode",
    "addressText",
    "fulfillmentContact",
  ] as const) {
    if (patch[k] !== undefined) (set as Record<string, unknown>)[k] = patch[k];
  }
  if (patch.isPrimary !== undefined) {
    const marketId = patch.marketId ?? prior.marketId;
    if (patch.isPrimary && !marketId) throw new BusinessError("An origin without a market cannot be the market's primary warehouse", { field: "isPrimary" });
    if (patch.isPrimary && marketId) {
      await db.update(schema.warehouse).set({ isPrimary: false }).where(eq(schema.warehouse.marketId, marketId));
    }
    set.isPrimary = patch.isPrimary;
  }
  const [row] = await db.update(schema.warehouse).set(set).where(eq(schema.warehouse.id, id)).returning();
  await recordAudit(db, actor, {
    action: "origin.update",
    subjectType: "warehouse",
    subjectId: id,
    prior: Object.fromEntries(Object.keys(set).map((k) => [k, (prior as Record<string, unknown>)[k]])),
    current: set,
    marketId: row.marketId,
  });
  return row;
}

/** Create a brewery or warehouse origin; market optional (Prost and Real Ale have none today). */
export async function createOrigin(
  db: DbOrTx,
  actor: Actor,
  input: { name: string; kind: OriginKind; marketId?: string | null; originCode?: string | null; lotFacilityCode?: string | null; addressText?: string | null; isPrimary?: boolean },
) {
  authorize(actor, "warehouse.manage", { marketId: input.marketId ?? null });
  if (!input.name.trim()) throw new BusinessError("Name is required", { field: "name" });
  const code = input.originCode?.trim().toUpperCase() || null;
  if (code && !CODE_RE.test(code)) throw new BusinessError("Origin code must be three letters", { field: "originCode" });
  if (code && (await originByCode(db, code))) throw new BusinessError(`Origin code ${code} is already in use`, { field: "originCode" });
  const fc = input.lotFacilityCode?.trim() || null;
  if (fc && !FACILITY_RE.test(fc)) throw new BusinessError("Lot facility code must be two digits", { field: "lotFacilityCode" });
  if (input.isPrimary && input.marketId) await db.update(schema.warehouse).set({ isPrimary: false }).where(eq(schema.warehouse.marketId, input.marketId));
  const [row] = await db
    .insert(schema.warehouse)
    .values({
      name: input.name.trim(),
      kind: input.kind,
      marketId: input.marketId ?? null,
      originCode: code,
      lotFacilityCode: fc,
      addressText: input.addressText ?? null,
      isPrimary: Boolean(input.isPrimary && input.marketId),
    })
    .returning();
  await recordAudit(db, actor, { action: "origin.create", subjectType: "warehouse", subjectId: row.id, current: input, marketId: row.marketId });
  return row;
}

/** Address block for documents: structured fields first, the free-text address as the fallback. */
export function originAddressLines(o: Origin): string[] {
  if (o.addressLine1) {
    const cityLine = [o.addressCity, [o.addressState, o.addressPostalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return [o.addressLine1, o.addressLine2 ?? "", cityLine].filter((l) => l && l.trim());
  }
  return o.addressText ? [o.addressText] : [];
}
