/**
 * Daily sweeps that raise cases for the office (Round 3). They only open or resolve exception cases; nothing is
 * emailed and nothing is blocked.
 *
 * - Overdue invoices: a retail account whose overdue total reaches the collections threshold ($500 by default), and
 *   any distributor with an overdue invoice. Pre-strike (legacy) invoices are left out; those are settled by hand.
 * - Stock aging at an origin: beer that has sat at an origin with a days-on-hand limit (Jack's Abby: beer must leave
 *   within 10 days) for the limit less three days or more.
 */
import { and, eq, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import type { Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { openException, resolveByDedupeKeys } from "@/lib/exceptions/service";
import { addDays, localParts } from "../cutoff/service";
import { formatCents } from "../catalog/service";
import { getCompanySettings } from "../settings/service";

export const AGING_WARN_DAYS_BEFORE = 3;

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86_400_000);
}

export async function sweepOverdueInvoices(db: DbOrTx, actor: Actor, now: Date = new Date()): Promise<{ opened: number; resolved: number }> {
  const today = localParts(now, "America/Los_Angeles").date;
  const settings = await getCompanySettings(db);
  const rows = await db
    .select({ inv: schema.invoice, kind: schema.customerLocation.kind, tradeName: schema.customerLocation.tradeName })
    .from(schema.invoice)
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.invoice.locationId))
    .where(and(eq(schema.invoice.status, "issued"), eq(schema.invoice.legacy, false), eq(schema.invoice.series, "INV"), isNotNull(schema.invoice.dueDate), lt(schema.invoice.dueDate, today)));
  const byLoc = new Map<string, { kind: string; tradeName: string; marketId: string | null; total: number; invoices: Array<typeof schema.invoice.$inferSelect> }>();
  for (const r of rows) {
    const key = r.inv.locationId!;
    const e = byLoc.get(key) ?? { kind: r.kind, tradeName: r.tradeName, marketId: r.inv.marketId, total: 0, invoices: [] };
    e.total += r.inv.totalCents;
    e.invoices.push(r.inv);
    byLoc.set(key, e);
  }
  let opened = 0;
  const keep = new Set<string>();
  for (const [locationId, e] of byLoc) {
    const isDistributor = e.kind === "distributor";
    if (!isDistributor && e.total < settings.collectionsThresholdCents) continue;
    const key = `collections_overdue:${locationId}`;
    keep.add(key);
    const oldest = e.invoices.reduce((a, b) => (a.dueDate! < b.dueDate! ? a : b));
    await openException(db, actor, {
      category: "collections_overdue",
      title: `${e.tradeName}: ${formatCents(e.total)} overdue`,
      cause: `${e.invoices.length} invoice${e.invoices.length === 1 ? "" : "s"} past due (${e.invoices.map((i) => i.number ?? "draft").join(", ")}); the oldest was due ${oldest.dueDate}, ${daysBetween(oldest.dueDate!, today)} days ago.${isDistributor ? " Distributor: any overdue invoice is raised." : ` At or over the ${formatCents(settings.collectionsThresholdCents)} retail threshold.`}`,
      marketId: e.marketId,
      locationId,
      ownerRole: "accounting",
      nextAction: "Follow up with the account; record the payment on the invoice when it arrives.",
      dedupeKey: key,
      links: [{ subjectType: "customer_location", subjectId: locationId }, ...e.invoices.map((i) => ({ subjectType: "invoice", subjectId: i.id }))],
    });
    opened += 1;
  }
  // Accounts no longer over the line resolve their case.
  const open = await db
    .select({ key: schema.exceptionCase.dedupeKey })
    .from(schema.exceptionCase)
    .where(and(eq(schema.exceptionCase.category, "collections_overdue"), ne(schema.exceptionCase.state, "resolved")));
  const stale = open.map((o) => o.key).filter((k): k is string => Boolean(k) && !keep.has(k!));
  if (stale.length) await resolveByDedupeKeys(db, actor, stale, "No longer overdue past the threshold");
  return { opened, resolved: stale.length };
}

/** On-hand quantity per lot at an origin: the stock ledger, or for beer packaged there, packaged less shipped. */
async function lotsOnHandAt(db: DbOrTx, warehouseId: string): Promise<Array<{ lotId: string; lotCode: string; packagingDate: string; onHand: number }>> {
  const out = new Map<string, { lotId: string; lotCode: string; packagingDate: string; onHand: number }>();
  const ledger = await db
    .select({ lotId: schema.stockMovement.lotId, onHand: sql<number>`coalesce(sum(${schema.stockMovement.qtyDelta}), 0)::int` })
    .from(schema.stockMovement)
    .where(and(eq(schema.stockMovement.warehouseId, warehouseId), isNotNull(schema.stockMovement.lotId)))
    .groupBy(schema.stockMovement.lotId);
  const ledgerIds = ledger.filter((r) => r.lotId && r.onHand > 0).map((r) => r.lotId!);
  if (ledgerIds.length) {
    const lots = await db.select().from(schema.lot).where(and(inArray(schema.lot.id, ledgerIds), isNull(schema.lot.legacyCode)));
    for (const l of lots) out.set(l.id, { lotId: l.id, lotCode: l.lotCode, packagingDate: l.packagingDate, onHand: ledger.find((r) => r.lotId === l.id)!.onHand });
  }
  const packaged = await db
    .select({ lot: schema.lot, qty: sql<number>`coalesce(sum(${schema.lotSkuQty.qtyPackaged}), 0)::int` })
    .from(schema.lot)
    .innerJoin(schema.lotSkuQty, eq(schema.lotSkuQty.lotId, schema.lot.id))
    .where(and(eq(schema.lot.facilityWarehouseId, warehouseId), isNull(schema.lot.legacyCode), eq(schema.lot.quantitiesKnown, true)))
    .groupBy(schema.lot.id);
  for (const p of packaged) {
    if (out.has(p.lot.id)) continue;
    const [{ shipped }] = await db
      .select({ shipped: sql<number>`coalesce(sum(${schema.shipmentLine.qty}), 0)::int` })
      .from(schema.shipmentLine)
      .innerJoin(schema.shipment, eq(schema.shipment.id, schema.shipmentLine.shipmentId))
      .where(and(eq(schema.shipmentLine.lotId, p.lot.id), ne(schema.shipment.status, "voided")));
    const onHand = p.qty - shipped;
    if (onHand > 0) out.set(p.lot.id, { lotId: p.lot.id, lotCode: p.lot.lotCode, packagingDate: p.lot.packagingDate, onHand });
  }
  return [...out.values()];
}

export async function sweepOriginStockAging(db: DbOrTx, actor: Actor, now: Date = new Date()): Promise<{ opened: number; resolved: number }> {
  const today = localParts(now, "America/Los_Angeles").date;
  const origins = await db.select().from(schema.warehouse).where(and(eq(schema.warehouse.active, true), isNotNull(schema.warehouse.maxDaysOnHand)));
  let opened = 0;
  const keep = new Set<string>();
  for (const w of origins) {
    const max = w.maxDaysOnHand!;
    for (const l of await lotsOnHandAt(db, w.id)) {
      const age = daysBetween(l.packagingDate, today);
      if (age < max - AGING_WARN_DAYS_BEFORE) continue;
      const key = `origin_stock_aging:${w.id}:${l.lotId}`;
      keep.add(key);
      const leaveBy = addDays(l.packagingDate, max);
      await openException(db, actor, {
        category: "origin_stock_aging",
        title: `${w.originCode ?? w.name}: lot ${l.lotCode} ${age >= max ? "is past" : "is near"} its ${max}-day limit`,
        cause: `${l.onHand} unit${l.onHand === 1 ? "" : "s"} of lot ${l.lotCode} (packaged ${l.packagingDate}) still at ${w.name}, ${age} days on hand. Beer must leave by ${leaveBy}.`,
        marketId: w.marketId,
        ownerRole: "admin",
        nextAction: "Ship it to a distributor or move it to the staging warehouse (Radford) before the limit.",
        dedupeKey: key,
        links: [
          { subjectType: "warehouse", subjectId: w.id },
          { subjectType: "lot", subjectId: l.lotId },
        ],
      });
      opened += 1;
    }
  }
  const open = await db
    .select({ key: schema.exceptionCase.dedupeKey })
    .from(schema.exceptionCase)
    .where(and(eq(schema.exceptionCase.category, "origin_stock_aging"), ne(schema.exceptionCase.state, "resolved")));
  const stale = open.map((o) => o.key).filter((k): k is string => Boolean(k) && !keep.has(k!));
  if (stale.length) await resolveByDedupeKeys(db, actor, stale, "The lot has left the origin");
  return { opened, resolved: stale.length };
}
