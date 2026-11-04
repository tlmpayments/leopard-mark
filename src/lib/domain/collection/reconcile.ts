/**
 * Nightly reconciliation (Round 4, S5) and payout matching (S8).
 *
 * Reconciliation compares every open or recently paid portal invoice with its Stripe copy and opens one case per
 * difference, so a missed webhook never hides a payment. Payout matching pulls each payout to the bank and the balance
 * transactions inside it, tying each one to the portal invoice its charge paid, so a bank deposit ties out to invoice
 * numbers and Stripe's fees.
 */
import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { SYSTEM_ACTOR } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { Db, DbOrTx } from "@/lib/db/types";
import { openException, resolveByDedupeKeys } from "@/lib/exceptions/service";
import { gateway, stripeConfigured, verifiedStripeAccount } from "@/lib/integrations/stripe/adapter";
import { ProviderUnavailableError, registerJobHandler } from "@/lib/jobs/queue";
import { formatCents } from "@/lib/domain/catalog/service";

export const JOB_PAYOUTS_SYNC = "stripe.payouts.sync";

export async function reconcileWithStripe(db: DbOrTx, now: Date = new Date()): Promise<{ checked: number; mismatches: number }> {
  if (!stripeConfigured()) return { checked: 0, mismatches: 0 };
  const binding = await verifiedStripeAccount(db);
  if (!binding) return { checked: 0, mismatches: 0 };
  const gw = gateway();
  const since = new Date(now.getTime() - 45 * 86_400_000);
  const rows = await db
    .select()
    .from(schema.invoice)
    .where(and(isNotNull(schema.invoice.stripeInvoiceId), or(inArray(schema.invoice.status, ["issued", "processing"]), and(eq(schema.invoice.status, "paid"), gte(schema.invoice.paidAt, since)))));
  let mismatches = 0;
  const keep = new Set<string>();
  for (const inv of rows) {
    const remote = await gw.retrieveInvoice(inv.stripeInvoiceId!);
    const problems: string[] = [];
    if (!remote) problems.push("the Stripe copy no longer exists");
    else {
      if (remote.status !== inv.stripeStatus) await db.update(schema.invoice).set({ stripeStatus: remote.status, updatedAt: new Date() }).where(eq(schema.invoice.id, inv.id));
      if (remote.status === "paid" && (inv.status === "issued" || inv.status === "processing")) problems.push(`Stripe says paid, the portal says ${inv.status} (${inv.collectionState.replace(/_/g, " ")})`);
      if (remote.status === "open" && inv.status === "paid" && inv.collectionState !== "out_of_band") problems.push("the portal says paid, Stripe says open");
      if (remote.status === "open" && inv.status === "paid" && inv.collectionState === "out_of_band") problems.push("paid outside Stripe in the portal, but the Stripe copy is still open (the out-of-band mark did not reach Stripe)");
      if (remote.status === "void" && inv.status !== "void") problems.push("voided in Stripe, not in the portal");
      if (remote.total !== inv.totalCents) problems.push(`totals differ (Stripe ${formatCents(remote.total)}, portal ${formatCents(inv.totalCents)})`);
    }
    if (problems.length) {
      mismatches += 1;
      const key = `stripe_reconcile:${inv.id}`;
      keep.add(key);
      await openException(db, SYSTEM_ACTOR, {
        category: "stripe_mismatch",
        title: `${inv.number}: portal and Stripe disagree`,
        cause: problems.join("; ") + ".",
        marketId: inv.marketId,
        locationId: inv.locationId,
        ownerRole: "accounting",
        nextAction: "Compare the invoice with Stripe and put the record right where it is wrong; the webhook or the out-of-band mark may have been missed.",
        dedupeKey: key,
        links: [{ subjectType: "invoice", subjectId: inv.id }],
      });
    }
  }
  const open = await db.select({ key: schema.exceptionCase.dedupeKey }).from(schema.exceptionCase).where(and(eq(schema.exceptionCase.category, "stripe_mismatch"), sql`${schema.exceptionCase.dedupeKey} like 'stripe_reconcile:%'`, sql`${schema.exceptionCase.state} <> 'resolved'`));
  const stale = open.map((o) => o.key).filter((k): k is string => Boolean(k) && !keep.has(k!));
  if (stale.length) await resolveByDedupeKeys(db, SYSTEM_ACTOR, stale, "Portal and Stripe agree again");
  return { checked: rows.length, mismatches };
}

/** Pull payouts (newest first, back to the last one stored) and the balance transactions inside each. */
export async function syncPayouts(db: DbOrTx): Promise<{ payouts: number; transactions: number }> {
  if (!stripeConfigured()) return { payouts: 0, transactions: 0 };
  const binding = await verifiedStripeAccount(db);
  if (!binding) throw new ProviderUnavailableError("Stripe account not verified; the payout sync resumes after the connectivity check");
  const gw = gateway();
  const [latest] = await db.select().from(schema.stripePayout).where(eq(schema.stripePayout.environment, binding.environment)).orderBy(desc(schema.stripePayout.stripeCreatedAt)).limit(1);
  const createdAfter = latest?.stripeCreatedAt ? Math.floor(latest.stripeCreatedAt.getTime() / 1000) - 7 * 86400 : null;
  let payouts = 0;
  let transactions = 0;
  let startingAfter: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const r = await gw.listPayouts({ limit: 50, startingAfter, createdAfter });
    for (const p of r.data) {
      await db
        .insert(schema.stripePayout)
        .values({ payoutId: p.id, environment: binding.environment, amountCents: p.amount, currency: p.currency, status: p.status, arrivalDate: new Date(p.arrivalDate * 1000).toISOString().slice(0, 10), stripeCreatedAt: new Date(p.created * 1000), syncedAt: new Date() })
        .onConflictDoUpdate({ target: [schema.stripePayout.environment, schema.stripePayout.payoutId], set: { status: p.status, amountCents: p.amount, syncedAt: new Date() } });
      payouts += 1;
      if (p.status !== "paid" && p.status !== "in_transit") continue;
      const bts = await gw.listBalanceTransactionsForPayout(p.id);
      for (const bt of bts) {
        const stripeInvoiceId = bt.invoiceId;
        const [inv] = stripeInvoiceId ? await db.select({ id: schema.invoice.id }).from(schema.invoice).where(eq(schema.invoice.stripeInvoiceId, stripeInvoiceId)) : [];
        await db
          .insert(schema.stripeBalanceTransaction)
          .values({ btId: bt.id, environment: binding.environment, payoutId: p.id, type: bt.type, amountCents: bt.amount, feeCents: bt.fee, netCents: bt.net, sourceId: bt.source, chargeId: bt.chargeId, stripeInvoiceId, invoiceId: inv?.id ?? null, description: bt.description, stripeCreatedAt: new Date(bt.created * 1000), syncedAt: new Date() })
          .onConflictDoUpdate({ target: [schema.stripeBalanceTransaction.environment, schema.stripeBalanceTransaction.btId], set: { payoutId: p.id, invoiceId: inv?.id ?? null, syncedAt: new Date() } });
        transactions += 1;
      }
    }
    if (!r.hasMore) break;
    startingAfter = r.data[r.data.length - 1]?.id ?? null;
  }
  return { payouts, transactions };
}

registerJobHandler(JOB_PAYOUTS_SYNC, {
  ready: async (db) => stripeConfigured() && (await verifiedStripeAccount(db)) !== null,
  run: async (db: Db) => {
    await syncPayouts(db);
  },
});

/** Payouts with what each one carried, newest first, for the Finance screen and the CSV. */
export async function listPayoutsWithDetail(db: DbOrTx, limit = 50) {
  const payouts = await db.select().from(schema.stripePayout).orderBy(desc(schema.stripePayout.arrivalDate), desc(schema.stripePayout.stripeCreatedAt)).limit(limit);
  if (!payouts.length) return [];
  const bts = await db.select({ bt: schema.stripeBalanceTransaction, inv: schema.invoice, loc: schema.customerLocation }).from(schema.stripeBalanceTransaction).leftJoin(schema.invoice, eq(schema.invoice.id, schema.stripeBalanceTransaction.invoiceId)).leftJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.invoice.locationId)).where(inArray(schema.stripeBalanceTransaction.payoutId, payouts.map((p) => p.payoutId)));
  return payouts.map((p) => ({ payout: p, lines: bts.filter((b) => b.bt.payoutId === p.payoutId) }));
}
