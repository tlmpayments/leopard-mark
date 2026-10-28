import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { marketScopeFor, type Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DbOrTx } from "@/lib/db/types";
import { listOpenExceptions } from "@/lib/exceptions/service";
import { lte } from "drizzle-orm";
import { jobSummary } from "@/lib/jobs/queue";

/**
 * Admin command center (brief §41): routine work and exceptions over the same
 * records. Aging work shown: incomplete verification/setup, unallocated /
 * unscheduled demand, pending approvals, failed/unknown notices, open
 * provider handoffs. Phase 2–4 categories (residuals, delivered-not-invoiced,
 * collections, keg discrepancies, service due) appear once those phases
 * write records; they are listed as "not yet built" rather than as zero.
 */
export async function commandCenter(db: DbOrTx, actor: Actor) {
  const scope = marketScopeFor(actor, ["owner", "admin", "accounting"]);
  const isOwner = actor.grants.some((g) => g.role === "owner");
  const marketIds: "all" | string[] = isOwner ? "all" : scope;
  const marketCond = (col: AnyPgColumn) =>
    marketIds === "all" ? undefined : marketIds.length ? inArray(col, marketIds) : eq(col, "00000000-0000-0000-0000-000000000000");

  const exceptions = await listOpenExceptions(db, { marketIds });
  const byCategory = new Map<string, number>();
  for (const e of exceptions) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);

  const [{ unverified }] = await db
    .select({ unverified: sql<number>`count(*)::int` })
    .from(schema.licenseVerification)
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.licenseVerification.locationId))
    .where(and(eq(schema.licenseVerification.current, true), inArray(schema.licenseVerification.state, ["unverified", "pending_review"]), eq(schema.customerLocation.status, "active"), marketCond(schema.customerLocation.marketId)));

  const [{ setupPending }] = await db
    .select({ setupPending: sql<number>`count(*)::int` })
    .from(schema.paymentRelationship)
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.paymentRelationship.locationId))
    .where(and(eq(schema.paymentRelationship.current, true), ne(schema.paymentRelationship.setupState, "method_usable"), eq(schema.customerLocation.status, "active"), marketCond(schema.customerLocation.marketId)));

  const [{ openOrders }] = await db
    .select({ openOrders: sql<number>`count(*)::int` })
    .from(schema.order)
    .where(and(inArray(schema.order.demandState, ["submitted", "partially_fulfilled"]), marketCond(schema.order.marketId)));

  const [{ unmetUnits }] = await db
    .select({ unmetUnits: sql<number>`coalesce(sum(${schema.reservation.unmetQty}),0)::int` })
    .from(schema.reservation)
    .innerJoin(schema.orderLine, eq(schema.orderLine.id, schema.reservation.orderLineId))
    .innerJoin(schema.order, eq(schema.order.id, schema.orderLine.orderId))
    .where(and(eq(schema.reservation.state, "reserved"), marketCond(schema.order.marketId)));

  const [{ pendingBilling }] = await db
    .select({ pendingBilling: sql<number>`count(*)::int` })
    .from(schema.billingEmailChangeRequest)
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.billingEmailChangeRequest.locationId))
    .where(and(eq(schema.billingEmailChangeRequest.state, "pending"), marketCond(schema.customerLocation.marketId)));

  const [{ noticesPending }] = await db
    .select({ noticesPending: sql<number>`count(*)::int` })
    .from(schema.notice)
    .where(and(inArray(schema.notice.state, ["manual_pending", "failed", "unknown"]), marketCond(schema.notice.marketId)));

  const [{ providerPending }] = await db
    .select({ providerPending: sql<number>`count(*)::int` })
    .from(schema.job)
    .where(inArray(schema.job.status, ["waiting", "failed"]));
  const waitingCases = exceptions.filter((e) => e.state === "waiting").length;
  const dueCases = exceptions.filter((e) => e.reviewAt && e.reviewAt <= new Date()).length;
  void lte;

  const recentOrders = await db
    .select({ o: schema.order, loc: schema.customerLocation })
    .from(schema.order)
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.order.locationId))
    .where(marketCond(schema.order.marketId))
    .orderBy(desc(schema.order.submittedAt))
    .limit(8);

  const holds = await db
    .select({ h: schema.hold, loc: schema.customerLocation })
    .from(schema.hold)
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.hold.locationId))
    .where(and(eq(schema.hold.active, true), marketCond(schema.customerLocation.marketId)))
    .limit(20);

  const jobs = await jobSummary(db);

  return {
    marketIds,
    exceptions,
    openCases: exceptions.length,
    waitingCases,
    dueCases,
    byCategory: Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]),
    aging: {
      unverifiedLocations: unverified,
      paymentSetupPending: setupPending,
      openOrders,
      unmetUnits,
      pendingBillingEmailApprovals: pendingBilling,
      noticesPending,
      providerHandoffsPending: providerPending,
    },
    notBuilt: [
      { label: "Unscheduled demand / route planning", phase: 2 },
      { label: "Partial / failed residuals", phase: 2 },
      { label: "Delivered-not-invoiced", phase: 3 },
      { label: "Collections / unmatched money", phase: 3 },
      { label: "Keg return discrepancies (secondary)", phase: 4 },
      { label: "Service due", phase: 4 },
    ],
    recentOrders,
    holds,
    jobs,
  };
}
