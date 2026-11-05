/**
 * Round 4 reports: California sales by format (for the state beer return) and the sample write-off (no-charge goods at
 * cost). Both read the invoices the portal issued, by invoice date, and come out as plain rows and plain CSV.
 */
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { marketScopeFor, type Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { BARRELS_PER_UNIT } from "@/lib/domain/lots/service";
import { csvLine } from "@/lib/domain/collection/reports";

export const FORMAT_LABEL: Record<string, string> = { case_12oz_can: "Cases, 12 oz cans", case_24oz_can: "Cases, 24 oz cans", keg_half: "1/2 bbl kegs", keg_sixtel: "1/6 bbl kegs" };
export const FORMAT_ORDER = ["keg_half", "keg_sixtel", "case_12oz_can", "case_24oz_can"];

/** California markets by their code or name (NorCal, SoCal, the demo's NC and LA); the page lets the office pick others. */
export function isCaliforniaMarket(m: { code: string; name: string }): boolean {
  return /norcal|socal|california|\bca\b/i.test(`${m.code} ${m.name}`) || /^(NC|LA)$/i.test(m.code);
}

export interface FormatRow {
  month: string;
  packageKind: string;
  units: number;
  barrels: number;
  revenueCents: number;
  invoices: number;
}

async function scopeConds(db: DbOrTx, actor: Actor, marketIds: string[] | null) {
  const scope = marketScopeFor(actor, ["owner", "admin", "accounting", "sales"]);
  let ids = marketIds;
  if (actor.kind !== "system" && !actor.grants.some((g) => g.role === "owner") && scope !== "all") {
    ids = ids ? ids.filter((id) => scope.includes(id)) : scope;
    if (!ids.length) ids = ["00000000-0000-0000-0000-000000000000"];
  }
  return ids;
}

/** Charged beer sold into the chosen markets by month and package format, with barrels, from issued or paid INV invoices. */
export async function salesByFormat(db: DbOrTx, actor: Actor, input: { from: string; to: string; marketIds?: string[] | null }) {
  const ids = await scopeConds(db, actor, input.marketIds ?? null);
  const conds = [inArray(schema.invoice.status, ["issued", "processing", "paid"]), eq(schema.invoice.series, "INV"), eq(schema.invoice.legacy, false), gte(schema.invoice.invoiceDate, input.from), lt(schema.invoice.invoiceDate, input.to), eq(schema.invoiceLine.kind, "beer")];
  if (ids) conds.push(inArray(schema.invoice.marketId, ids));
  const rows = await db
    .select({ month: sql<string>`to_char(${schema.invoice.invoiceDate}::date, 'YYYY-MM')`, packageKind: schema.sku.packageKind, units: sql<number>`sum(${schema.invoiceLine.qty})::int`, revenue: sql<number>`sum(${schema.invoiceLine.lineTotalCents})::int`, invoices: sql<number>`count(distinct ${schema.invoice.id})::int` })
    .from(schema.invoiceLine)
    .innerJoin(schema.invoice, eq(schema.invoice.id, schema.invoiceLine.invoiceId))
    .innerJoin(schema.sku, eq(schema.sku.id, schema.invoiceLine.skuId))
    .where(and(...conds))
    .groupBy(sql`to_char(${schema.invoice.invoiceDate}::date, 'YYYY-MM')`, schema.sku.packageKind)
    .orderBy(sql`1`, schema.sku.packageKind);
  const out: FormatRow[] = rows.map((r) => ({ month: r.month, packageKind: r.packageKind, units: r.units, barrels: r.units * (BARRELS_PER_UNIT[r.packageKind] ?? 0), revenueCents: r.revenue, invoices: r.invoices }));
  const totals = { units: out.reduce((s, r) => s + r.units, 0), barrels: out.reduce((s, r) => s + r.barrels, 0), revenueCents: out.reduce((s, r) => s + r.revenueCents, 0) };
  return { rows: out, totals };
}

export function salesByFormatCsv(r: Awaited<ReturnType<typeof salesByFormat>>, input: { from: string; to: string; marketLabel: string }): string {
  const lines = [csvLine(["California sales by format", input.marketLabel, `${input.from} to ${input.to} (invoice dates, end exclusive)`]), csvLine(["Month", "Format", "Units", "Barrels", "Revenue", "Invoices"])];
  for (const row of r.rows) lines.push(csvLine([row.month, FORMAT_LABEL[row.packageKind] ?? row.packageKind, row.units, row.barrels.toFixed(4), (row.revenueCents / 100).toFixed(2), row.invoices]));
  lines.push(csvLine(["Total", "", r.totals.units, r.totals.barrels.toFixed(4), (r.totals.revenueCents / 100).toFixed(2), ""]));
  return lines.join("\n") + "\n";
}

export interface WriteOffRow {
  month: string;
  recipient: string;
  recipientKind: string;
  packageKind: string;
  units: number;
  barrels: number;
  costCents: number | null;
  invoices: number;
}

/** No-charge goods (NC invoices: samples to the samples house or a rep's address, other no-charge orders) at unit cost, by month and recipient. */
export async function sampleWriteOff(db: DbOrTx, actor: Actor, input: { from: string; to: string; marketIds?: string[] | null }) {
  const ids = await scopeConds(db, actor, input.marketIds ?? null);
  const conds = [inArray(schema.invoice.status, ["issued", "processing", "paid"]), eq(schema.invoice.series, "NC"), eq(schema.invoice.legacy, false), gte(schema.invoice.invoiceDate, input.from), lt(schema.invoice.invoiceDate, input.to), eq(schema.invoiceLine.kind, "beer")];
  if (ids) conds.push(inArray(schema.invoice.marketId, ids));
  const rows = await db
    .select({ month: sql<string>`to_char(${schema.invoice.invoiceDate}::date, 'YYYY-MM')`, recipient: schema.customerLocation.tradeName, recipientKind: schema.customerLocation.kind, packageKind: schema.sku.packageKind, units: sql<number>`sum(${schema.invoiceLine.qty})::int`, cost: sql<number | null>`sum(${schema.invoiceLine.qty} * ${schema.sku.unitCostCents})::int`, costKnown: sql<boolean>`bool_and(${schema.sku.unitCostCents} is not null)`, invoices: sql<number>`count(distinct ${schema.invoice.id})::int` })
    .from(schema.invoiceLine)
    .innerJoin(schema.invoice, eq(schema.invoice.id, schema.invoiceLine.invoiceId))
    .innerJoin(schema.sku, eq(schema.sku.id, schema.invoiceLine.skuId))
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.invoice.locationId))
    .where(and(...conds))
    .groupBy(sql`to_char(${schema.invoice.invoiceDate}::date, 'YYYY-MM')`, schema.customerLocation.tradeName, schema.customerLocation.kind, schema.sku.packageKind)
    .orderBy(sql`1`, schema.customerLocation.tradeName, schema.sku.packageKind);
  const out: WriteOffRow[] = rows.map((r) => ({ month: r.month, recipient: r.recipient, recipientKind: r.recipientKind, packageKind: r.packageKind, units: r.units, barrels: r.units * (BARRELS_PER_UNIT[r.packageKind] ?? 0), costCents: r.costKnown ? r.cost : null, invoices: r.invoices }));
  const totals = { units: out.reduce((s, r) => s + r.units, 0), barrels: out.reduce((s, r) => s + r.barrels, 0), costCents: out.reduce((s, r) => s + (r.costCents ?? 0), 0), costUnknown: out.some((r) => r.costCents === null) };
  return { rows: out, totals };
}

export function sampleWriteOffCsv(r: Awaited<ReturnType<typeof sampleWriteOff>>, input: { from: string; to: string }): string {
  const lines = [csvLine(["Sample write-off (no-charge goods at unit cost)", `${input.from} to ${input.to} (invoice dates, end exclusive)`]), csvLine(["Month", "Recipient", "Kind", "Format", "Units", "Barrels", "Cost", "Invoices"])];
  for (const row of r.rows) lines.push(csvLine([row.month, row.recipient, row.recipientKind, FORMAT_LABEL[row.packageKind] ?? row.packageKind, row.units, row.barrels.toFixed(4), row.costCents === null ? "cost not set" : (row.costCents / 100).toFixed(2), row.invoices]));
  lines.push(csvLine(["Total", "", "", "", r.totals.units, r.totals.barrels.toFixed(4), (r.totals.costCents / 100).toFixed(2) + (r.totals.costUnknown ? " (some SKUs have no cost)" : ""), ""]));
  return lines.join("\n") + "\n";
}

export async function listMarketsForReports(db: DbOrTx) {
  return db.select({ id: schema.market.id, code: schema.market.code, name: schema.market.name }).from(schema.market).where(eq(schema.market.active, true)).orderBy(schema.market.code);
}
