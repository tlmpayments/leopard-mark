import Link from "next/link";
import { Badge, Button, Card, Input, Select, StatusBadge, ago, fmtDate } from "@/components/ui";
import type { Actor, Role } from "@/lib/authz/actor";
import { ROLE_LABEL, marketScopeFor } from "@/lib/authz/actor";
import type { DbOrTx } from "@/lib/db/types";
import * as schema from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { linksForCases, listOpenExceptions, type ExceptionFilter } from "@/lib/exceptions/service";

export const CATEGORY_LABEL: Record<string, string> = {
  license_unverified: "License verification",
  allocation_shortage: "Stock shortage",
  allocation_discrepancy: "Stock shortfall vs reservations",
  below_minimum: "Below $90 minimum",
  abnormal_order: "Abnormal order",
  order_change_request: "Change request",
  hold: "Delivery hold",
  closure_review: "Closure run-off review",
  billing_email_change: "Billing-email approval",
  payment_setup_pending: "Payment setup pending",
  payment_revocation: "Payment authorization revoked",
  duplicate_suspected: "Suspected duplicate",
  email_intake: "Email order to review",
  notice_no_recipient: "Notice has no recipient",
  notice_failed: "Notice failed / unknown",
  standing_review: "Standing order review",
  standing_policy_incomplete: "Standing order: policy incomplete",
  standing_skipped: "Standing order skipped",
  standing_generation_failed: "Standing order failed",
  custody_reconciliation: "Custody to reconcile",
  provider_handoff_failed: "Provider job failed",
  payment_setup_missing: "Payment setup before second delivery",
  freight_below_minimum: "Below the freight pallet minimum",
  order_change_after_cutoff: "Changed after the cutoff",
  collections_overdue: "Overdue invoices",
  origin_stock_aging: "Stock aging at origin",
};

export interface QueueParams {
  category?: string;
  owner?: string;
  state?: string;
  market?: string;
  locationId?: string;
}

export function queueScope(actor: Actor): "all" | string[] {
  return actor.grants.some((g) => g.role === "owner") ? "all" : marketScopeFor(actor, ["admin", "accounting", "sales"]);
}

/**
 * Actionable work queue (UX-02): each row explains the problem, the affected
 * account/orders, the owner, the next action, the waiting party and age /
 * review date, and links straight to the record. Counts come from the same
 * query as the rows, within the actor's authority.
 */
export async function WorkQueue({ db, actor, params, basePath, title = "Work queue" }: { db: DbOrTx; actor: Actor; params: QueueParams; basePath: string; title?: string }) {
  const scope = queueScope(actor);
  const marketIds: "all" | string[] = params.market ? (scope === "all" || scope.includes(params.market) ? [params.market] : []) : scope;
  const filter: ExceptionFilter = {
    marketIds,
    category: params.category || undefined,
    ownerRole: (params.owner as Role) || undefined,
    state: (params.state as ExceptionFilter["state"]) || undefined,
    locationId: params.locationId,
    limit: 300,
  };
  const rows = await listOpenExceptions(db, filter);
  const links = await linksForCases(db, rows.map((r) => r.id));
  const locIds = Array.from(new Set(rows.map((r) => r.locationId).filter((x): x is string => Boolean(x))));
  const locs = locIds.length ? await db.select({ id: schema.customerLocation.id, tradeName: schema.customerLocation.tradeName }).from(schema.customerLocation).where(inArray(schema.customerLocation.id, locIds)) : [];
  const ownerIds = Array.from(new Set(rows.map((r) => r.ownerEmployeeId).filter((x): x is string => Boolean(x))));
  const owners = ownerIds.length ? await db.select({ id: schema.employee.id, displayName: schema.employee.displayName }).from(schema.employee).where(inArray(schema.employee.id, ownerIds)) : [];
  const markets = await db.select().from(schema.market).orderBy(schema.market.code);
  const visibleMarkets = scope === "all" ? markets : markets.filter((m) => scope.includes(m.id));
  const categories = Array.from(new Set(rows.map((r) => r.category))).sort();
  const now = new Date();
  // Group children under their parent when both are in the list (one incident, linked consequences).
  const byParent = new Map<string, typeof rows>();
  for (const r of rows) if (r.parentCaseId && rows.some((p) => p.id === r.parentCaseId)) byParent.set(r.parentCaseId, [...(byParent.get(r.parentCaseId) ?? []), r]);
  const top = rows.filter((r) => !(r.parentCaseId && rows.some((p) => p.id === r.parentCaseId)));
  return (
    <Card title={`${title} (${rows.length})`}>
      <form className="mb-3 grid gap-2 sm:grid-cols-5" role="search" action={basePath}>
        {params.locationId ? <input type="hidden" name="locationId" value={params.locationId} /> : null}
        <Select name="category" defaultValue={params.category ?? ""} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABEL)
            .filter(([k]) => categories.includes(k) || k === params.category)
            .map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
        </Select>
        <Select name="owner" defaultValue={params.owner ?? ""} aria-label="Owner role">
          <option value="">Any owner</option>
          {(["owner", "admin", "accounting", "sales", "driver_service"] as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
        <Select name="state" defaultValue={params.state ?? ""} aria-label="State">
          <option value="">Any state</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="assigned">Assigned</option>
          <option value="waiting_only">Waiting on someone</option>
          <option value="due">Review date reached</option>
        </Select>
        <Select name="market" defaultValue={params.market ?? ""} aria-label="Market">
          <option value="">All my markets</option>
          {visibleMarkets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Button variant="secondary" small>
            Filter
          </Button>
          {params.category || params.owner || params.state || params.market ? (
            <Button href={basePath} variant="ghost" small>
              Clear
            </Button>
          ) : null}
        </div>
        <Input type="hidden" name="_" value="" className="hidden" aria-hidden="true" />
      </form>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing needs attention{params.category || params.owner || params.state || params.market ? " for this filter" : " in your markets"}. Later-phase work (routing, invoicing, kegs, service) is not built yet, so its absence here is not a clean bill of health — see &quot;Not yet built&quot;.</p>
      ) : (
        <ul className="divide-y divide-line">
          {top.map((e) => {
            const loc = locs.find((l) => l.id === e.locationId);
            const orderLinks = (links.get(e.id) ?? []).filter((l) => l.subjectType === "order");
            const children = byParent.get(e.id) ?? [];
            const ownerName = owners.find((o) => o.id === e.ownerEmployeeId)?.displayName;
            return (
              <li key={e.id} className="py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/admin/exceptions/${e.id}`} className="text-sm font-medium hover:underline">
                      {e.title}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted">
                      <Badge>{CATEGORY_LABEL[e.category] ?? e.category.replace(/_/g, " ")}</Badge>{" "}
                      {loc ? (
                        <>
                          <Link href={`/locations/${loc.id}`} className="underline">
                            {loc.tradeName}
                          </Link>{" "}
                        </>
                      ) : null}
                      {orderLinks.length ? (
                        <>
                          · affects{" "}
                          {orderLinks.map((l, i) => (
                            <span key={l.id}>
                              {i ? ", " : ""}
                              <Link href={l.href!} className="underline">
                                {l.label}
                              </Link>
                            </span>
                          ))}
                        </>
                      ) : null}
                    </div>
                    {e.nextAction ? <p className="mt-0.5 text-xs">Next: {e.nextAction}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
                    <StatusBadge value={e.state} />
                    <span>
                      {e.ownerRole ? `${ROLE_LABEL[e.ownerRole]}${ownerName ? ` · ${ownerName}` : ""}` : "unassigned"}
                      {e.waitingParty ? ` · waiting on ${e.waitingParty}` : ""}
                    </span>
                    <span>
                      {ago(e.createdAt, now)} old{e.reviewAt ? ` · review ${fmtDate(e.reviewAt)}` : ""}
                    </span>
                  </div>
                </div>
                {children.length ? (
                  <ul className="ml-4 mt-1 border-l border-line pl-3 text-xs">
                    {children.map((c) => (
                      <li key={c.id}>
                        <Link href={`/admin/exceptions/${c.id}`} className="hover:underline">
                          ↳ {c.title}
                        </Link>{" "}
                        <StatusBadge value={c.state} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
