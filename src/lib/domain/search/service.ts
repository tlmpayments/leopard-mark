import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { marketScopeFor, type Actor } from "@/lib/authz/actor";
import { can } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/lib/db/types";
import { escapeLike } from "../customers/service";

/**
 * Search within current permissions (brief §44): trade name, address, email,
 * order number, rep, SKU, market. Every result respects the same role and
 * market rules as its destination page (REV-11, UX-09): Driver/Service gets
 * no accounts, orders or contacts; Sales only its markets; product hits
 * link to the permitted read-only product view, never the Admin catalog.
 * Locations are distinguished by address and market so identical names are
 * not confused.
 */
export interface SearchHit {
  kind: "location" | "order" | "contact" | "sku";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

export async function search(db: DbOrTx, actor: Actor, q: string): Promise<SearchHit[]> {
  const needle = q.trim();
  if (needle.length < 2) return [];
  const like = `%${escapeLike(needle)}%`;
  const isOwner = actor.kind === "system" || actor.grants.some((g) => g.role === "owner");
  const hits: SearchHit[] = [];

  const scopeCond = (roles: Parameters<typeof marketScopeFor>[1], col: AnyPgColumn) => {
    if (isOwner) return { ok: true, cond: undefined };
    const scope = marketScopeFor(actor, roles);
    if (scope === "all") return { ok: true, cond: undefined };
    if (scope.length === 0) return { ok: false, cond: undefined };
    return { ok: true, cond: inArray(col, scope) };
  };

  const locScope = can(actor, "location.view") ? scopeCond(["owner", "admin", "accounting", "sales"], schema.customerLocation.marketId) : { ok: false, cond: undefined };
  if (locScope.ok) {
    const locations = await db
      .select({ loc: schema.customerLocation, market: schema.market, a: schema.address })
      .from(schema.customerLocation)
      .innerJoin(schema.market, eq(schema.market.id, schema.customerLocation.marketId))
      .leftJoin(schema.locationAddress, and(eq(schema.locationAddress.locationId, schema.customerLocation.id), eq(schema.locationAddress.kind, "delivery"), eq(schema.locationAddress.current, true)))
      .leftJoin(schema.address, eq(schema.address.id, schema.locationAddress.addressId))
      .where(and(or(ilike(schema.customerLocation.tradeName, like), ilike(schema.customerLocation.legalName, like), ilike(schema.address.line1, like), ilike(schema.address.city, like), ilike(schema.address.postalCode, like)), locScope.cond))
      .limit(15);
    for (const l of locations) {
      if (hits.some((h) => h.kind === "location" && h.id === l.loc.id)) continue;
      hits.push({ kind: "location", id: l.loc.id, title: l.loc.tradeName, subtitle: `${l.a ? `${l.a.line1}, ${l.a.city}` : "no address"} · ${l.market.code} · ${l.loc.status}`, href: `/locations/${l.loc.id}` });
    }
    const contacts = await db
      .select({ c: schema.contact, loc: schema.customerLocation, market: schema.market })
      .from(schema.locationContact)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
      .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.locationContact.locationId))
      .innerJoin(schema.market, eq(schema.market.id, schema.customerLocation.marketId))
      .where(and(eq(schema.locationContact.current, true), or(ilike(schema.contact.email, like), ilike(schema.contact.name, like)), locScope.cond))
      .limit(10);
    for (const c of contacts) hits.push({ kind: "contact", id: `${c.loc.id}:${c.c.id}`, title: `${c.c.name}${c.c.email ? ` <${c.c.email}>` : ""}`, subtitle: `${c.loc.tradeName} · ${c.market.code}`, href: `/locations/${c.loc.id}` });
  }

  const orderScope = can(actor, "order.view") ? scopeCond(["owner", "admin", "accounting", "sales"], schema.order.marketId) : { ok: false, cond: undefined };
  if (orderScope.ok) {
    const orders = await db
      .select({ o: schema.order, loc: schema.customerLocation })
      .from(schema.order)
      .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.order.locationId))
      .where(and(ilike(schema.order.orderNumber, like), orderScope.cond))
      .orderBy(desc(schema.order.submittedAt))
      .limit(10);
    for (const o of orders) hits.push({ kind: "order", id: o.o.id, title: o.o.orderNumber, subtitle: `${o.loc.tradeName} · ${o.o.demandState.replace(/_/g, " ")}`, href: `/orders/${o.o.id}` });
  }

  if (can(actor, "catalog.view")) {
    const skus = await db.select().from(schema.sku).where(or(ilike(schema.sku.code, like), ilike(schema.sku.name, like), ilike(schema.sku.brand, like))).limit(10);
    for (const s of skus) hits.push({ kind: "sku", id: s.id, title: `${s.brand} ${s.name}`, subtitle: `${s.code}${s.archivedAt ? " · archived" : ""}`, href: `/products` });
  }
  return hits;
}
