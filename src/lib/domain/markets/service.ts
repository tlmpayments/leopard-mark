import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor, Role } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import { marketScopeFor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";

export async function createMarket(
  db: DbOrTx,
  actor: Actor,
  input: { code: string; name: string; timezone?: string },
) {
  authorize(actor, "market.manage");
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,6}$/.test(code)) throw new Error("Market code must be 2–6 letters/digits");
  const [row] = await db
    .insert(schema.market)
    .values({ code, name: input.name.trim(), timezone: input.timezone ?? "America/Los_Angeles" })
    .returning();
  await recordAudit(db, actor, { action: "market.create", subjectType: "market", subjectId: row.id, current: { code, name: row.name } });
  await ensureSamplesHouse(db, row);
  return row;
}

/** The samples house name per market, the same rule migration 0005 used for the markets that already existed. */
export function samplesHouseName(market: { code: string; name: string }): string {
  const named: Record<string, string> = { SOCAL: "Samples, SoCal", "NORCAL-SD": "Samples, NorCal", "NORCAL-D": "Samples, NorCal (Distributed)", CT: "Samples, Connecticut", MA: "Samples, Massachusetts" };
  return named[market.code] ?? `Samples, ${market.name}`;
}

/**
 * Every market has one samples house account (R2-27): kind internal, no license, no terms, where samples go when they
 * are not delivered to a rep's home. Created with the market; idempotent, keyed like the migration.
 */
export async function ensureSamplesHouse(db: DbOrTx, market: { id: string; code: string; name: string }) {
  const [existing] = await db.select().from(schema.customerLocation).where(and(eq(schema.customerLocation.marketId, market.id), eq(schema.customerLocation.samplesHouse, true)));
  if (existing) return existing;
  const [row] = await db
    .insert(schema.customerLocation)
    .values({ marketId: market.id, tradeName: samplesHouseName(market), status: "active", kind: "internal", depositMode: "none", termsDaysOverride: 0, samplesHouse: true })
    .returning();
  return row;
}

/** D33: confirm the approved seller context before a market is financially activated. */
export async function confirmSellerContext(db: DbOrTx, actor: Actor, marketId: string, note: string) {
  authorize(actor, "decision.select_production");
  const [prior] = await db.select().from(schema.market).where(eq(schema.market.id, marketId));
  if (!prior) throw new Error("Market not found");
  const [row] = await db
    .update(schema.market)
    .set({ sellerContextStatus: "confirmed", sellerContextNote: note })
    .where(eq(schema.market.id, marketId))
    .returning();
  await recordAudit(db, actor, {
    action: "market.confirm_seller_context",
    subjectType: "market",
    subjectId: marketId,
    prior: { sellerContextStatus: prior.sellerContextStatus },
    current: { sellerContextStatus: "confirmed", note },
    marketId,
  });
  return row;
}

export async function createWarehouse(
  db: DbOrTx,
  actor: Actor,
  input: { marketId: string; name: string; addressText?: string; isPrimary?: boolean; fulfillmentContact?: string },
) {
  authorize(actor, "warehouse.manage", { marketId: input.marketId });
  if (input.isPrimary) {
    await db.update(schema.warehouse).set({ isPrimary: false }).where(eq(schema.warehouse.marketId, input.marketId));
  }
  const [row] = await db
    .insert(schema.warehouse)
    .values({
      marketId: input.marketId,
      name: input.name.trim(),
      addressText: input.addressText ?? null,
      isPrimary: input.isPrimary ?? false,
      fulfillmentContact: input.fulfillmentContact ?? null,
    })
    .returning();
  await recordAudit(db, actor, { action: "warehouse.create", subjectType: "warehouse", subjectId: row.id, current: input, marketId: input.marketId });
  return row;
}

export async function primaryWarehouse(db: DbOrTx, marketId: string) {
  const [row] = await db
    .select()
    .from(schema.warehouse)
    .where(and(eq(schema.warehouse.marketId, marketId), eq(schema.warehouse.isPrimary, true), eq(schema.warehouse.active, true)))
    .limit(1);
  return row ?? null;
}

export async function listMarkets(db: DbOrTx) {
  return db.select().from(schema.market).orderBy(schema.market.code);
}

/** Markets visible to an actor across any of the given roles. */
export async function visibleMarkets(db: DbOrTx, actor: Actor, roles: Role[] = ["owner", "admin", "accounting", "sales", "driver_service"]) {
  const all = await listMarkets(db);
  if (actor.kind === "system" || actor.grants.some((g) => g.role === "owner")) return all;
  const scope = marketScopeFor(actor, roles);
  if (scope === "all") return all;
  return all.filter((m) => scope.includes(m.id));
}

export async function listWarehouses(db: DbOrTx, marketId?: string) {
  const q = db.select().from(schema.warehouse);
  return marketId ? q.where(eq(schema.warehouse.marketId, marketId)) : q;
}
