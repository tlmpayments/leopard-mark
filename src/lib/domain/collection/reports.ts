/**
 * Receivables ageing (Round 4, S7) and the monthly export for the CFO (R2): plain rows, plain CSV, nothing styled.
 */
import { and, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { marketScopeFor, type Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { PAYMENT_KIND_LABEL } from "./invoices";

export function csvLine(values: Array<string | number | null | undefined>): string {
  return values
    .map((v) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}

export const AGING_BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = { current: "Current", d1_30: "1 to 30", d31_60: "31 to 60", d61_90: "61 to 90", d90_plus: "90 and over" };

export function agingBucket(dueDate: string, asOf: string): AgingBucket {
  const days = Math.round((Date.parse(`${asOf}T12:00:00Z`) - Date.parse(`${dueDate}T12:00:00Z`)) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export interface AgingRow {
  locationId: string;
  tradeName: string;
  kind: string;
  marketCode: string;
  payBy: string | null;
  buckets: Record<AgingBucket, number>;
  total: number;
  invoices: Array<{ id: string; number: string | null; dueDate: string; openCents: number; bucket: AgingBucket; collectionState: string }>;
}

/** Open invoices by account and age as of a date; credits and payments already recorded reduce what is open. */
export async function arAging(db: DbOrTx, actor: Actor, asOf: string, opts: { includeLegacy?: boolean } = {}): Promise<{ rows: AgingRow[]; totals: Record<AgingBucket, number>; total: number }> {
  const scope = marketScopeFor(actor, ["owner", "admin", "accounting"]);
  const conds = [inArray(schema.invoice.status, ["issued", "processing"]), eq(schema.invoice.series, "INV"), sql`${schema.invoice.dueDate} is not null`];
  if (!opts.includeLegacy) conds.push(eq(schema.invoice.legacy, false));
  if (actor.kind !== "system" && !actor.grants.some((g) => g.role === "owner") && scope !== "all") {
    if (scope.length === 0) return { rows: [], totals: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 }, total: 0 };
    conds.push(inArray(schema.invoice.marketId, scope));
  }
  const rows = await db
    .select({ inv: schema.invoice, loc: schema.customerLocation, market: schema.market })
    .from(schema.invoice)
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.invoice.locationId))
    .leftJoin(schema.market, eq(schema.market.id, schema.invoice.marketId))
    .where(and(...conds));
  const ids = rows.map((r) => r.inv.id);
  const credits = ids.length ? await db.select({ invoiceId: schema.creditMemo.invoiceId, total: sql<number>`sum(${schema.creditMemo.amountCents})::int` }).from(schema.creditMemo).where(and(inArray(schema.creditMemo.invoiceId, ids), eq(schema.creditMemo.status, "issued"))).groupBy(schema.creditMemo.invoiceId) : [];
  const paid = ids.length ? await db.select({ invoiceId: schema.payment.invoiceId, total: sql<number>`sum(${schema.payment.amountCents})::int` }).from(schema.payment).where(and(inArray(schema.payment.invoiceId, ids), eq(schema.payment.state, "succeeded"))).groupBy(schema.payment.invoiceId) : [];
  const creditBy = new Map(credits.map((c) => [c.invoiceId, c.total]));
  const paidBy = new Map(paid.map((p) => [p.invoiceId, p.total]));
  const byLoc = new Map<string, AgingRow>();
  const totals: Record<AgingBucket, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  for (const { inv, loc, market } of rows) {
    const open = inv.totalCents - (creditBy.get(inv.id) ?? 0) - (paidBy.get(inv.id) ?? 0);
    if (open <= 0) continue;
    const bucket = agingBucket(inv.dueDate!, asOf);
    const row = byLoc.get(loc.id) ?? { locationId: loc.id, tradeName: loc.tradeName, kind: loc.kind, marketCode: market?.code ?? "", payBy: loc.payBy, buckets: { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 }, total: 0, invoices: [] };
    row.buckets[bucket] += open;
    row.total += open;
    row.invoices.push({ id: inv.id, number: inv.number, dueDate: inv.dueDate!, openCents: open, bucket, collectionState: inv.collectionState });
    totals[bucket] += open;
    byLoc.set(loc.id, row);
  }
  const out = [...byLoc.values()].sort((a, b) => b.total - a.total || a.tradeName.localeCompare(b.tradeName));
  return { rows: out, totals, total: Object.values(totals).reduce((s, v) => s + v, 0) };
}

export function arAgingCsv(r: Awaited<ReturnType<typeof arAging>>, asOf: string): string {
  const money = (c: number) => (c / 100).toFixed(2);
  const lines = [csvLine(["As of", asOf]), csvLine(["Account", "Kind", "Market", "Pays by", "Current", "1 to 30", "31 to 60", "61 to 90", "90 and over", "Total", "Invoices"])];
  for (const row of r.rows) {
    lines.push(csvLine([row.tradeName, row.kind, row.marketCode, row.payBy ?? "", money(row.buckets.current), money(row.buckets.d1_30), money(row.buckets.d31_60), money(row.buckets.d61_90), money(row.buckets.d90_plus), money(row.total), row.invoices.map((i) => `${i.number ?? "draft"} ${i.dueDate} ${money(i.openCents)}`).join("; ")]));
  }
  lines.push(csvLine(["Total", "", "", "", money(r.totals.current), money(r.totals.d1_30), money(r.totals.d31_60), money(r.totals.d61_90), money(r.totals.d90_plus), money(r.total), ""]));
  return lines.join("\n") + "\n";
}

/** The month's invoices, payments, credits, Stripe fees and payouts in one plain CSV with a section per table. */
export async function cfoExportCsv(db: DbOrTx, actor: Actor, month: string): Promise<string> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Month must be YYYY-MM");
  const start = `${month}-01`;
  const endDate = new Date(`${start}T12:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  const end = endDate.toISOString().slice(0, 10);
  const startTs = new Date(`${start}T00:00:00Z`);
  const endTs = new Date(`${end}T00:00:00Z`);
  const scope = marketScopeFor(actor, ["owner", "admin", "accounting"]);
  const scoped = actor.kind !== "system" && !actor.grants.some((g) => g.role === "owner") && scope !== "all" ? (scope.length ? scope : ["00000000-0000-0000-0000-000000000000"]) : null;
  const money = (c: number | null | undefined) => ((c ?? 0) / 100).toFixed(2);
  const lines: string[] = [csvLine(["Leopard Mark Ops export", month])];

  const invConds = [gte(schema.invoice.invoiceDate, start), lt(schema.invoice.invoiceDate, end), eq(schema.invoice.legacy, false), inArray(schema.invoice.status, ["issued", "processing", "paid", "void"])];
  if (scoped) invConds.push(inArray(schema.invoice.marketId, scoped));
  const invoices = await db.select({ inv: schema.invoice, loc: schema.customerLocation, market: schema.market }).from(schema.invoice).leftJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.invoice.locationId)).leftJoin(schema.market, eq(schema.market.id, schema.invoice.marketId)).where(and(...invConds)).orderBy(schema.invoice.number);
  lines.push("", "Invoices", csvLine(["Number", "Series", "Date", "Due", "Account", "Kind", "Market", "Pays by", "Status", "Subtotal", "Deposit", "Freight", "Total", "Paid on", "Paid via", "Reference", "Stripe invoice"]));
  for (const { inv, loc, market } of invoices) {
    lines.push(csvLine([inv.number, inv.series, inv.invoiceDate, inv.dueDate, loc?.tradeName ?? "", loc?.kind ?? "", market?.code ?? "", inv.payBy ?? "", inv.status, money(inv.subtotalCents), money(inv.depositCents), money(inv.freightCents), money(inv.totalCents), inv.paidAt ? inv.paidAt.toISOString().slice(0, 10) : "", inv.paidVia ?? "", inv.paidReference ?? "", inv.stripeNumber ?? inv.stripeInvoiceId ?? ""]));
  }

  const payConds = [gte(schema.payment.occurredAt, startTs), lt(schema.payment.occurredAt, endTs)];
  if (scoped) payConds.push(inArray(schema.payment.marketId, scoped));
  const payments = await db.select({ p: schema.payment, inv: schema.invoice, loc: schema.customerLocation }).from(schema.payment).leftJoin(schema.invoice, eq(schema.invoice.id, schema.payment.invoiceId)).leftJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.payment.locationId)).where(and(...payConds)).orderBy(schema.payment.occurredAt);
  lines.push("", "Payments", csvLine(["Date", "Invoice", "Account", "Kind", "State", "Amount", "Reference", "Settled", "Stripe payment"]));
  for (const { p, inv, loc } of payments) {
    lines.push(csvLine([p.occurredAt.toISOString().slice(0, 10), inv?.number ?? "", loc?.tradeName ?? "", PAYMENT_KIND_LABEL[p.kind], p.state, money(p.amountCents), p.reference ?? "", p.settledAt ? p.settledAt.toISOString().slice(0, 10) : "", p.stripePaymentIntentId ?? ""]));
  }

  const cmConds = [gte(schema.creditMemo.memoDate, start), lt(schema.creditMemo.memoDate, end)];
  if (scoped) cmConds.push(inArray(schema.creditMemo.marketId, scoped));
  const credits = await db.select({ cm: schema.creditMemo, inv: schema.invoice, loc: schema.customerLocation }).from(schema.creditMemo).innerJoin(schema.invoice, eq(schema.invoice.id, schema.creditMemo.invoiceId)).leftJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.creditMemo.locationId)).where(and(...cmConds)).orderBy(schema.creditMemo.number);
  lines.push("", "Credit memos", csvLine(["Number", "Date", "Invoice", "Account", "Amount", "Status", "Reason", "Stripe credit note"]));
  for (const { cm, inv, loc } of credits) lines.push(csvLine([cm.number, cm.memoDate, inv.number, loc?.tradeName ?? "", money(cm.amountCents), cm.status, cm.reason, cm.stripeCreditNoteNumber ?? cm.stripeCreditNoteId ?? ""]));

  const payouts = await db.select().from(schema.stripePayout).where(and(gte(schema.stripePayout.arrivalDate, start), lt(schema.stripePayout.arrivalDate, end))).orderBy(schema.stripePayout.arrivalDate);
  lines.push("", "Stripe payouts to the bank", csvLine(["Arrival", "Payout", "Status", "Amount", "Gross", "Fees", "Invoices"]));
  const btAll = payouts.length ? await db.select({ bt: schema.stripeBalanceTransaction, inv: schema.invoice }).from(schema.stripeBalanceTransaction).leftJoin(schema.invoice, eq(schema.invoice.id, schema.stripeBalanceTransaction.invoiceId)).where(inArray(schema.stripeBalanceTransaction.payoutId, payouts.map((p) => p.payoutId))) : [];
  for (const p of payouts) {
    const mine = btAll.filter((b) => b.bt.payoutId === p.payoutId);
    lines.push(csvLine([p.arrivalDate, p.payoutId, p.status, money(p.amountCents), money(mine.reduce((s, b) => s + b.bt.amountCents, 0)), money(mine.reduce((s, b) => s + b.bt.feeCents, 0)), mine.map((b) => b.inv?.number ?? b.bt.description ?? b.bt.btId).join("; ")]));
  }
  lines.push("", "Stripe fees by transaction", csvLine(["Date", "Payout", "Type", "Invoice", "Gross", "Fee", "Net"]));
  for (const b of btAll) lines.push(csvLine([b.bt.stripeCreatedAt ? b.bt.stripeCreatedAt.toISOString().slice(0, 10) : "", b.bt.payoutId ?? "", b.bt.type, b.inv?.number ?? "", money(b.bt.amountCents), money(b.bt.feeCents), money(b.bt.netCents)]));
  return lines.join("\n") + "\n";
}

/** The office's cash picture for the Finance screen: scheduled, processing, settled this month, returned, next payout. */
export async function moneySummary(db: DbOrTx, actor: Actor, asOf: string) {
  const scope = marketScopeFor(actor, ["owner", "admin", "accounting"]);
  const scoped = actor.kind !== "system" && !actor.grants.some((g) => g.role === "owner") && scope !== "all" ? (scope.length ? scope : ["00000000-0000-0000-0000-000000000000"]) : null;
  const inv = (...more: ReturnType<typeof eq>[]) => and(inArray(schema.invoice.status, ["issued", "processing"]), ...(scoped ? [inArray(schema.invoice.marketId, scoped)] : []), ...more);
  const sum = sql<number>`coalesce(sum(${schema.invoice.totalCents}), 0)::int`;
  const cnt = sql<number>`count(*)::int`;
  const [scheduledToday] = await db.select({ total: sum, n: cnt }).from(schema.invoice).where(and(inv(eq(schema.invoice.collectionState, "scheduled")), lte(schema.invoice.debitScheduledOn, asOf)));
  const [scheduledLater] = await db.select({ total: sum, n: cnt }).from(schema.invoice).where(and(inv(eq(schema.invoice.collectionState, "scheduled")), sql`${schema.invoice.debitScheduledOn} > ${asOf}`));
  const [processing] = await db.select({ total: sum, n: cnt }).from(schema.invoice).where(inv(eq(schema.invoice.collectionState, "processing")));
  const [failed] = await db.select({ total: sum, n: cnt }).from(schema.invoice).where(inv(eq(schema.invoice.collectionState, "failed")));
  const monthStart = `${asOf.slice(0, 7)}-01`;
  const [settled] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.payment.amountCents}), 0)::int`, n: cnt })
    .from(schema.payment)
    .where(and(eq(schema.payment.state, "succeeded"), gte(schema.payment.settledAt, new Date(`${monthStart}T00:00:00Z`)), ...(scoped ? [inArray(schema.payment.marketId, scoped)] : [])));
  const [nextPayout] = await db.select().from(schema.stripePayout).where(inArray(schema.stripePayout.status, ["pending", "in_transit"])).orderBy(desc(schema.stripePayout.arrivalDate)).limit(1);
  const [lastPayout] = await db.select().from(schema.stripePayout).where(eq(schema.stripePayout.status, "paid")).orderBy(desc(schema.stripePayout.arrivalDate)).limit(1);
  return { scheduledToday, scheduledLater, processing, failed, settled, nextPayout: nextPayout ?? null, lastPayout: lastPayout ?? null };
}
