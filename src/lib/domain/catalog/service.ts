import { and, desc, eq, isNull, lte, or, gt } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";

/** Global confirmed defaults (brief §8) — not market-configurable. */
export const KEG_DEPOSIT_CENTS = 3500;
export const MINIMUM_DELIVERY_CENTS = 9000;
export const NET_TERMS_DAYS = 30;

export type PackageKind = (typeof schema.packageEnum.enumValues)[number];

export const PACKAGE_LABEL: Record<PackageKind, string> = {
  case_12oz_can: "Case · 12 oz cans",
  case_24oz_can: "Case · 24 oz cans",
  keg_sixtel: "1/6 bbl keg",
  keg_half: "1/2 bbl keg",
};

export async function createSku(
  db: DbOrTx,
  actor: Actor,
  input: { code: string; name: string; brand: string; packageKind: PackageKind; sellingUnit: string; weightLb?: string | null },
) {
  authorize(actor, "catalog.manage");
  const isKeg = input.packageKind === "keg_sixtel" || input.packageKind === "keg_half";
  const [row] = await db
    .insert(schema.sku)
    .values({
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      brand: input.brand.trim(),
      packageKind: input.packageKind,
      sellingUnit: input.sellingUnit.trim(),
      kegsPerUnit: isKeg ? 1 : 0,
      weightLb: input.weightLb ?? null,
    })
    .returning();
  await recordAudit(db, actor, { action: "sku.create", subjectType: "sku", subjectId: row.id, current: { code: row.code, name: row.name } });
  return row;
}

/** Archived SKUs cannot be newly ordered and remain historical (O14). */
export async function archiveSku(db: DbOrTx, actor: Actor, skuId: string, reason: string) {
  authorize(actor, "catalog.manage");
  const [row] = await db.update(schema.sku).set({ archivedAt: new Date() }).where(eq(schema.sku.id, skuId)).returning();
  await recordAudit(db, actor, { action: "sku.archive", subjectType: "sku", subjectId: skuId, prior: { archived: false }, current: { archived: true }, reason });
  return row;
}

/**
 * Set a market price with effective dating. The previous price is closed,
 * not overwritten, so every order keeps its price-at-submission history.
 */
export async function setMarketPrice(
  db: DbOrTx,
  actor: Actor,
  input: { marketId: string; skuId: string; priceCents: number; effectiveFrom?: Date; reason?: string },
) {
  authorize(actor, "price.manage", { marketId: input.marketId });
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) throw new Error("Price must be a non-negative integer number of cents");
  const from = input.effectiveFrom ?? new Date();
  const current = await currentPrice(db, input.marketId, input.skuId, from);
  if (current) {
    await db.update(schema.marketPrice).set({ effectiveTo: from }).where(eq(schema.marketPrice.id, current.id));
  }
  const [row] = await db
    .insert(schema.marketPrice)
    .values({ marketId: input.marketId, skuId: input.skuId, priceCents: input.priceCents, effectiveFrom: from, createdByEmployeeId: actor.employeeId })
    .returning();
  await recordAudit(db, actor, {
    action: "price.set",
    subjectType: "market_price",
    subjectId: row.id,
    prior: current ? { priceCents: current.priceCents } : null,
    current: { priceCents: input.priceCents, effectiveFrom: from.toISOString() },
    reason: input.reason ?? null,
    marketId: input.marketId,
  });
  return row;
}

export async function currentPrice(db: DbOrTx, marketId: string, skuId: string, at: Date = new Date()) {
  const [row] = await db
    .select()
    .from(schema.marketPrice)
    .where(
      and(
        eq(schema.marketPrice.marketId, marketId),
        eq(schema.marketPrice.skuId, skuId),
        lte(schema.marketPrice.effectiveFrom, at),
        or(isNull(schema.marketPrice.effectiveTo), gt(schema.marketPrice.effectiveTo, at)),
      ),
    )
    .orderBy(desc(schema.marketPrice.effectiveFrom))
    .limit(1);
  return row ?? null;
}

export interface CatalogEntry {
  sku: typeof schema.sku.$inferSelect;
  priceCents: number | null;
  marketPriceId: string | null;
  orderable: boolean;
  reason?: string;
}

/** Applicable products and prices for a market (customers never see stock counts). */
export async function marketCatalog(db: DbOrTx, marketId: string, opts: { includeArchived?: boolean } = {}): Promise<CatalogEntry[]> {
  const skus = await db.select().from(schema.sku).orderBy(schema.sku.brand, schema.sku.name);
  const out: CatalogEntry[] = [];
  for (const s of skus) {
    if (s.archivedAt && !opts.includeArchived) continue;
    const price = await currentPrice(db, marketId, s.id);
    const archived = Boolean(s.archivedAt);
    out.push({
      sku: s,
      priceCents: price?.priceCents ?? null,
      marketPriceId: price?.id ?? null,
      orderable: !archived && price !== null,
      reason: archived ? "Archived — historical only" : price === null ? "No price set for this market" : undefined,
    });
  }
  return out;
}

export async function listSkus(db: DbOrTx) {
  return db.select().from(schema.sku).orderBy(schema.sku.brand, schema.sku.name);
}

export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
