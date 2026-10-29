import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { NoticeActions } from "@/components/notice-actions";
import { TimelineCard } from "@/components/timeline";
import { Badge, Button, Card, Empty, Field, Flash, Input, KV, Notice, Page, Select, StateLine, StatusBadge, Textarea, fmtDate, fmtDay } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { formatCents, listPriceOverrides, marketCatalog } from "@/lib/domain/catalog/service";
import { findSimilarLocations, getLocation, listLocations } from "@/lib/domain/customers/service";
import { ACCOUNT_KIND_LABEL, DEPOSIT_MODE_LABEL, PAY_BY_LABEL, type PayBy } from "@/lib/domain/customers/shipping";
import { listEmployees } from "@/lib/domain/employees/service";
import { kegBalances } from "@/lib/domain/kegs/service";
import { listWarehouses } from "@/lib/domain/markets/service";
import { listShipments } from "@/lib/domain/shipments/service";
import { shipmentNumber } from "../../shipments/labels";
import { endPriceOverrideAction, setPriceOverrideAction, updateAccountShippingAction, updateDepositOnFileAction } from "./shipping-actions";
import { NOTICE_PURPOSE_LABEL, listNotices } from "@/lib/domain/notices/service";
import { listOrders } from "@/lib/domain/orders/service";
import { authorizedPayer } from "@/lib/domain/payment/service";
import { evaluateLocationReadiness } from "@/lib/domain/readiness/service";
import { listStandingForLocation } from "@/lib/domain/standing/service";
import { activityTimeline } from "@/lib/domain/timeline/service";
import { linksForCases, listOpenExceptions } from "@/lib/exceptions/service";
import { customerReferenceStatus, stripeConfigured } from "@/lib/integrations/stripe/adapter";
import {
  addContactAction,
  assignRepAction,
  clearPayerAction,
  createHoldAction,
  createStandingAction,
  decideBillingEmailAction,
  directRevocationAction,
  duplicateAction,
  editOperationalAction,
  endContactAction,
  hostedSetupLinkAction,
  licenseDecisionAction,
  overrideAction,
  requestBillingEmailAction,
  requestSetupAction,
  resolveHoldAction,
  setPayerAction,
  standingStateAction,
  statusAction,
  updateContactAction,
  warehouseOverrideAction,
  withdrawOverrideAction,
} from "../actions";

function liveSetupUrl(evidence: { url?: string; expires_at?: number } | null): string | null {
  if (!evidence?.url || !evidence.expires_at) return null;
  return evidence.expires_at * 1000 > Date.now() ? evidence.url : null;
}

const CATEGORY_LABEL: Record<string, string> = {
  license_unverified: "License verification",
  allocation_shortage: "Stock shortage",
  allocation_discrepancy: "Stock shortfall",
  below_minimum: "Below $90 minimum",
  abnormal_order: "Abnormal order",
  order_change_request: "Change request",
  hold: "Delivery hold",
  closure_review: "Closure run-off review",
  billing_email_change: "Billing-email approval",
  payment_setup_pending: "Payment setup",
  payment_revocation: "Payment authorization revoked",
  duplicate_suspected: "Suspected duplicate",
  email_intake: "Email order to review",
  notice_no_recipient: "Notice has no recipient",
  notice_failed: "Notice failed",
  standing_review: "Standing order review",
  standing_policy_incomplete: "Standing order policy incomplete",
  standing_skipped: "Standing order skipped",
  standing_generation_failed: "Standing order failed",
  custody_reconciliation: "Custody to reconcile",
  provider_handoff_failed: "Provider job failed",
};

export default async function LocationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const actor = await requireAction("location.view");
  const d = await getDb();
  const detail = await getLocation(d, id);
  if (!detail) notFound();
  const { location: loc, market } = detail;
  if (!can(actor, "location.view", { marketId: loc.marketId })) notFound();
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const tz = market?.timezone ?? "America/Los_Angeles";
  const kind = param(sp, "kind");
  const [readiness, orders, standing, exceptions, catalog, stripeRefs, similar, timeline, notices, payerAuth] = await Promise.all([
    evaluateLocationReadiness(d, id),
    listOrders(d, actor, { locationId: id, limit: 20 }),
    listStandingForLocation(d, id),
    listOpenExceptions(d, { locationId: id }),
    marketCatalog(d, loc.marketId),
    customerReferenceStatus(d, id),
    findSimilarLocations(d, loc.marketId, loc.tradeName),
    activityTimeline(d, actor, { locationId: id, cursor: param(sp, "before"), kinds: kind ? [kind as never] : undefined, limit: 25 }),
    can(actor, "notice.view", { marketId: loc.marketId }) ? listNotices(d, actor, { locationId: id, limit: 20 }) : Promise.resolve([]),
    authorizedPayer(d, id),
  ]);
  const caseLinks = await linksForCases(d, exceptions.map((e) => e.id));
  const isAdmin = can(actor, "license.verify", { marketId: loc.marketId });
  const isFinance = can(actor, "payment.view", { marketId: loc.marketId });
  const canEdit = can(actor, "location.edit_operational", { marketId: loc.marketId });
  const canOrder = can(actor, "order.submit", { marketId: loc.marketId }) && loc.status !== "closed";
  const canNotice = can(actor, "notice.record_outcome", { marketId: loc.marketId });
  const employees = isAdmin ? await listEmployees(d) : [];
  const warehouses = isAdmin ? await listWarehouses(d) : [];
  const others = similar.filter((s) => s.id !== id);
  const kegMovements = await d.select().from(schema.kegMovement).where(eq(schema.kegMovement.locationId, id));
  const setupSessions = isFinance
    ? await d
        .select()
        .from(schema.providerReference)
        .where(and(eq(schema.providerReference.subjectId, id), eq(schema.providerReference.providerObject, "checkout_setup_session")))
        .orderBy(desc(schema.providerReference.createdAt))
        .limit(1)
    : [];
  const setupUrlLive = liveSetupUrl((setupSessions[0]?.evidence ?? null) as { url?: string; expires_at?: number } | null);
  const canRename = can(actor, "location.lifecycle", { marketId: loc.marketId });
  const [cleaning] = await d.select().from(schema.cleaningObligation).where(eq(schema.cleaningObligation.locationId, id));
  const buyer = detail.contacts.find((c) => c.contactRole === "buyer") ?? detail.contacts.find((c) => c.mayOrder);
  const rep = detail.location.currentRepEmployeeId ? (await d.select({ displayName: schema.employee.displayName }).from(schema.employee).where(eq(schema.employee.id, detail.location.currentRepEmployeeId)))[0] : null;
  const openOrders = orders.filter((o) => o.order.demandState === "submitted" || o.order.demandState === "partially_fulfilled");
  const lastOrder = orders.find((o) => o.order.demandState !== "cancelled");
  const pendingNotices = notices.filter((n) => n.n.state === "manual_pending" || n.n.state === "failed" || n.n.state === "unknown");
  // Shipping & billing (SHIPMENTS_SPEC 2.4 to 2.6, 3.9, 3.10, 7.4): served-by, deposit mode, price exceptions, keg balance, shipments.
  const canShipping = can(actor, "location.lifecycle", { marketId: loc.marketId });
  const canPrice = can(actor, "price.manage", { marketId: loc.marketId });
  const canShipView = can(actor, "shipment.view", { marketId: loc.marketId });
  const canShipManage = can(actor, "shipment.manage", { marketId: loc.marketId });
  const [servedBy] = loc.servedByLocationId ? await d.select({ id: schema.customerLocation.id, tradeName: schema.customerLocation.tradeName }).from(schema.customerLocation).where(eq(schema.customerLocation.id, loc.servedByLocationId)) : [];
  const distributors = canShipping ? (await listLocations(d, actor, { marketId: loc.marketId })).filter((l) => l.loc.kind === "distributor" && l.loc.id !== id) : [];
  const priceOverrides = await listPriceOverrides(d, id);
  const [kegBalance] = can(actor, "keg.view", { marketId: loc.marketId }) ? await kegBalances(d, actor, { locationId: id }) : [];
  const recentShipments = canShipView ? await listShipments(d, actor, { destinationLocationId: id, limit: 8 }) : [];

  return (
    <Page
      title={loc.tradeName}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span>{detail.delivery ? `${detail.delivery.line1}, ${detail.delivery.city}, ${detail.delivery.state} ${detail.delivery.postalCode}` : "no delivery address"}</span>
          <Badge>{market?.code}</Badge>
          <StatusBadge value={loc.status} />
        </span>
      }
      actions={
        <>
          {canOrder ? <Button href={`/orders/new?locationId=${id}`}>New order</Button> : null}
          {canOrder && lastOrder ? (
            <Button href={`/orders/new?locationId=${id}&repeat=${lastOrder.order.id}`} variant="secondary">
              Repeat {lastOrder.order.orderNumber}
            </Button>
          ) : null}
          {canShipManage && loc.status !== "closed" ? (
            <Button href={`/shipments/new?locationId=${id}`} variant="secondary">
              New shipment
            </Button>
          ) : null}
        </>
      }
    >
      <Flash {...flash} />
      {others.length ? (
        <Notice tone="warn" title="Similar trade names in this market:">
          {others.map((o) => (
            <Link key={o.id} href={`/locations/${o.id}`} className="mr-2 underline">
              {o.tradeName}
            </Link>
          ))}
          — warning only; identical names can be legitimate.
        </Notice>
      ) : null}

      {/* ---------------- What this account can do now ---------------- */}
      <Card title="Right now">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Who</div>
            <div className="text-sm">
              {buyer ? (
                <>
                  {buyer.contact.name}
                  {buyer.contact.email ? <span className="block text-xs text-muted">{buyer.contact.email}</span> : null}
                  {buyer.contact.phone ? <span className="block text-xs text-muted">{buyer.contact.phone}</span> : null}
                </>
              ) : (
                "no buyer contact"
              )}
              <span className="block text-xs text-muted">Rep: {rep?.displayName ?? "unassigned"}</span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Orders</div>
            <div className="text-sm">
              {openOrders.length ? (
                <>
                  {openOrders.length} open — {openOrders.slice(0, 3).map((o, i) => (
                    <span key={o.order.id}>
                      {i ? ", " : ""}
                      <Link href={`/orders/${o.order.id}`} className="underline">
                        {o.order.orderNumber}
                      </Link>
                    </span>
                  ))}
                </>
              ) : (
                "no open orders"
              )}
              {lastOrder ? <span className="block text-xs text-muted">Last: {lastOrder.order.orderNumber} · {fmtDate(lastOrder.order.submittedAt, tz)}</span> : null}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Delivery readiness</div>
            <div className="text-sm">
              {readiness.summary}
              <span className="block text-xs text-muted">{readiness.isFirstDelivery ? "No accepted delivery yet." : `${readiness.acceptedDeliveries} accepted delivery(ies).`}</span>
            </div>
          </div>
        </div>
        {exceptions.length || pendingNotices.length ? (
          <div className="mt-3 space-y-1 border-t border-line pt-3">
            <div className="text-xs uppercase tracking-wide text-muted">Waiting on</div>
            {exceptions.map((e) => (
              <StateLine key={e.id} kind={e.category === "provider_handoff_failed" ? "provider_unavailable" : e.state === "waiting" ? "info" : "action_needed"}>
                <Link href={`/admin/exceptions/${e.id}`} className="underline">
                  {CATEGORY_LABEL[e.category] ?? e.category.replace(/_/g, " ")}
                </Link>
                {e.ownerRole ? <> — {e.ownerRole === "owner" ? "Owner" : e.ownerRole === "driver_service" ? "Driver/Service" : e.ownerRole[0].toUpperCase() + e.ownerRole.slice(1)} acts next</> : null}
                {e.waitingParty ? <> (waiting on {e.waitingParty})</> : null}
                {e.nextAction ? <span className="block text-xs text-muted">{e.nextAction}</span> : null}
                {(caseLinks.get(e.id) ?? []).filter((l) => l.subjectType === "order").length ? (
                  <span className="block text-xs text-muted">
                    Affects{" "}
                    {(caseLinks.get(e.id) ?? [])
                      .filter((l) => l.subjectType === "order")
                      .map((l, i) => (
                        <span key={l.id}>
                          {i ? ", " : ""}
                          <Link href={l.href!} className="underline">
                            {l.label}
                          </Link>
                        </span>
                      ))}
                  </span>
                ) : null}
              </StateLine>
            ))}
            {pendingNotices.map((n) => (
              <StateLine key={n.n.id} kind="action_needed">
                {NOTICE_PURPOSE_LABEL[n.n.purpose] ?? n.n.purpose} {n.n.state === "manual_pending" ? "needs to be sent" : `is ${n.n.state}`} — {canNotice ? "Accounting/Admin records the outcome below." : "Accounting/Admin sends it through the manual process."}
              </StateLine>
            ))}
          </div>
        ) : (
          <p className="mt-3 border-t border-line pt-3 text-sm text-muted">Nothing is waiting on anyone for this account.</p>
        )}
      </Card>

      <Card title="Delivery readiness — detail">
        <ul className="space-y-2">
          {readiness.conditions.map((c) => (
            <li key={c.code} className="flex flex-col gap-1 border-t border-rule pt-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <span className="text-sm font-medium">{c.label}</span>
                <p className="text-sm">{c.plain}</p>
                {c.detail ? <p className="text-xs text-muted">{c.detail}</p> : null}
              </div>
              <span className="flex shrink-0 gap-1">
                <StatusBadge value={c.status} />
                {c.decisionId && can(actor, "decision.view") ? (
                  <Link href={`/owner/decisions/${c.decisionId}`}>
                    <Badge tone="info">{c.decisionId}</Badge>
                  </Link>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Readiness is permission to hand over merchandise; it never blocks order capture. Scheduling and release themselves arrive with phase 2.</p>
      </Card>

      <Card title="Orders">
        {orders.length === 0 ? (
          <Empty>No orders yet.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {orders.map(({ order }) => (
              <li key={order.id} className="flex items-center justify-between py-2 text-sm">
                <Link href={`/orders/${order.id}`} className="hover:underline">
                  {order.orderNumber} <span className="text-xs text-muted">· {order.source} · {fmtDate(order.submittedAt, tz)}</span>
                </Link>
                <span className="flex gap-1">
                  {order.abnormalFlag ? <Badge tone="warn">flagged</Badge> : null}
                  <StatusBadge value={order.demandState} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {orders.length >= 20 ? (
          <Link href={`/orders?locationId=${id}`} className="mt-2 block text-sm text-accent hover:underline">
            All orders for this account
          </Link>
        ) : null}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Contacts & authority">
          <ul className="divide-y divide-line">
            {detail.contacts.map((c) => (
              <li key={c.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{c.contact.name}</span>
                  <Badge>{c.contactRole}</Badge>
                </div>
                <div className="text-xs text-muted">
                  {c.contact.email ?? "no email"} {c.contact.phone ? `· ${c.contact.phone}` : ""}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.mayOrder ? <Badge tone="good">may order</Badge> : null}
                  {c.receivesInvoices ? <Badge tone="good">receives invoices</Badge> : null}
                  {c.mayAuthorizePayment ? <Badge tone="good">payer authority</Badge> : null}
                </div>
                {canEdit ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-accent">Edit</summary>
                    <form action={updateContactAction} className="mt-1 grid gap-2 sm:grid-cols-3">
                      <input type="hidden" name="locationId" value={id} />
                      <input type="hidden" name="locationContactId" value={c.id} />
                      <Input name="name" defaultValue={c.contact.name} aria-label="Name" />
                      <Input name="phone" defaultValue={c.contact.phone ?? ""} placeholder="Phone" aria-label="Phone" />
                      {c.receivesInvoices ? <span className="self-center text-xs text-muted">Billing email changes via request below.</span> : <Input name="email" type="email" defaultValue={c.contact.email ?? ""} placeholder="Email" aria-label="Email" />}
                      <div className="flex gap-2 sm:col-span-3">
                        <Button small variant="secondary">Save</Button>
                      </div>
                    </form>
                    {!c.receivesInvoices && !c.mayAuthorizePayment ? (
                      <form action={endContactAction} className="mt-1">
                        <input type="hidden" name="locationId" value={id} />
                        <input type="hidden" name="locationContactId" value={c.id} />
                        <input type="hidden" name="reason" value="no longer at this location" />
                        <Button small variant="ghost">Remove from account</Button>
                      </form>
                    ) : null}
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
          {canEdit ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-accent">Add contact</summary>
              <form action={addContactAction} className="mt-2 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="locationId" value={id} />
                <Field label="Name">
                  <Input name="name" required />
                </Field>
                <Field label="Role">
                  <Select name="role" defaultValue="receiving">
                    <option value="buyer">Buyer (may order)</option>
                    <option value="receiving">Receiving</option>
                    <option value="other">Other</option>
                    {detail.contacts.some((c) => c.contactRole === "ap") ? null : <option value="ap">Accounts payable (receives invoices)</option>}
                  </Select>
                </Field>
                <Field label="Email">
                  <Input name="email" type="email" />
                </Field>
                <Field label="Phone">
                  <Input name="phone" />
                </Field>
                <div className="sm:col-span-2">
                  <Button small variant="secondary">Add</Button>
                  <span className="ml-2 text-xs text-muted">Contacts never gain payment authority here; Accounting assigns that deliberately.</span>
                </div>
              </form>
            </details>
          ) : null}
          {detail.pendingBillingRequests.length ? (
            <div className="mt-2 space-y-2">
              {detail.pendingBillingRequests.map((r) => (
                <div key={r.id} className=" bg-warn-soft p-2 text-sm">
                  Billing-email change to <strong>{r.requestedEmail}</strong> awaiting Admin approval.
                  {isAdmin ? (
                    <form action={decideBillingEmailAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="locationId" value={id} />
                      <input type="hidden" name="requestId" value={r.id} />
                      <Input name="note" placeholder="Note (optional)" className="max-w-xs" aria-label="Decision note" />
                      <Button small name="decision" value="approved">
                        Approve
                      </Button>
                      <Button small variant="secondary" name="decision" value="rejected">
                        Reject
                      </Button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {can(actor, "location.request_billing_email_change", { marketId: loc.marketId }) ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-accent">Request billing-email change</summary>
              <form action={requestBillingEmailAction} className="mt-2 flex gap-2">
                <input type="hidden" name="locationId" value={id} />
                <Input name="email" type="email" required placeholder="new-ap@customer.com" aria-label="New billing email" />
                <Button small variant="secondary">Request</Button>
              </form>
              <p className="mt-1 text-xs text-muted">Requires Admin approval (O06). Past notice recipients are never rewritten; payer authority is separate.</p>
            </details>
          ) : null}
        </Card>
        <Card title="Addresses & instructions">
          <KV
            items={[
              ["Delivery", detail.delivery ? `${detail.delivery.line1}${detail.delivery.line2 ? ", " + detail.delivery.line2 : ""}, ${detail.delivery.city}, ${detail.delivery.state} ${detail.delivery.postalCode}` : "—"],
              ["Billing", detail.billing ? (detail.billing.id === detail.delivery?.id ? "Same as delivery" : `${detail.billing.line1}, ${detail.billing.city}, ${detail.billing.state} ${detail.billing.postalCode}`) : "—"],
              ["Delivery instructions", loc.deliveryInstructions],
              ["Receiving restrictions", loc.receivingRestrictions],
              ["Legal name", loc.legalName],
              ["Parent", detail.parent ? `${detail.parent.name} (no pooled authority)` : "—"],
            ]}
          />
          {canEdit ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-accent">Edit instructions{canRename ? " / names" : ""}</summary>
              <form action={editOperationalAction} className="mt-2 grid gap-2">
                <input type="hidden" name="locationId" value={id} />
                {canRename ? (
                  <>
                    <Field label="Trade name (material change — reason required)">
                      <Input name="tradeName" defaultValue={loc.tradeName} />
                    </Field>
                    <Field label="Legal name">
                      <Input name="legalName" defaultValue={loc.legalName ?? ""} />
                    </Field>
                  </>
                ) : (
                  <>
                    <input type="hidden" name="tradeName" value={loc.tradeName} />
                    <input type="hidden" name="legalName" value={loc.legalName ?? ""} />
                  </>
                )}
                <Field label="Delivery instructions">
                  <Textarea name="deliveryInstructions" rows={2} defaultValue={loc.deliveryInstructions ?? ""} />
                </Field>
                <Field label="Receiving restrictions">
                  <Textarea name="receivingRestrictions" rows={2} defaultValue={loc.receivingRestrictions ?? ""} />
                </Field>
                <Field label="Reason (material edits are audited)">
                  <Input name="reason" />
                </Field>
                <div>
                  <Button small>Save</Button>
                </div>
              </form>
            </details>
          ) : null}
          <p className="mt-2 text-xs text-muted">A move, a new operator or a change of licensed premises is a material change (D07/D08): review with Admin rather than editing the address in place. Google address assessment is advisory only and not connected (IG05).</p>
        </Card>
      </div>

      {notices.length && can(actor, "notice.view", { marketId: loc.marketId }) ? (
        <Card title="Customer notices (manual single-sender process)">
          <ul className="divide-y divide-line text-sm">
            {notices.map(({ n }) => (
              <li key={n.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>{NOTICE_PURPOSE_LABEL[n.purpose] ?? n.purpose}</strong> v{n.version} to {n.recipientEmail ?? <span className="text-danger">no recipient email</span>}
                  </span>
                  <StatusBadge value={n.state} />
                </div>
                <p className="text-xs text-muted">{(n.content as { summary?: string } | null)?.summary}</p>
                {n.outcomeNote ? <p className="text-xs text-muted">Outcome: {n.outcomeNote} ({n.sentVia}, {fmtDate(n.outcomeRecordedAt, tz)})</p> : null}
                {canNotice ? <NoticeActions noticeId={n.id} state={n.state} returnTo={`/locations/${id}`} recipientEmail={n.recipientEmail} /> : null}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">Sender allocation (D32/IG04) is unselected: a person sends each notice and records the outcome here. Recording &quot;sent&quot; is staff evidence, not provider-confirmed delivery.</p>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="License / serviceability">
          <KV
            items={[
              ["Decision", <StatusBadge key="s" value={detail.license?.state ?? "unverified"} />],
              ["License #", detail.license?.licenseNumber],
              ["Type", detail.license?.licenseType],
              ["Evidence", detail.license?.evidence],
              ["Decided", detail.license?.decidedAt ? fmtDate(detail.license.decidedAt, tz) : "—"],
            ]}
          />
          {isAdmin ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-accent">Record decision</summary>
              <form action={licenseDecisionAction} className="mt-2 space-y-2">
                <input type="hidden" name="locationId" value={id} />
                <Field label="State">
                  <Select name="state" defaultValue="verified">
                    <option value="pending_review">Pending review</option>
                    <option value="verified">Verified</option>
                    <option value="rejected">Rejected</option>
                    <option value="not_applicable">Not applicable (only where the effective D02 policy says so)</option>
                  </Select>
                </Field>
                <Field label="License number">
                  <Input name="licenseNumber" />
                </Field>
                <Field label="License type">
                  <Input name="licenseType" placeholder="e.g. ABC Type 47" />
                </Field>
                <Field label="Evidence" hint="Verified requires a number or evidence — no false verified status (D02).">
                  <Input name="evidence" placeholder="e.g. ABC lookup 2026-09-17" />
                </Field>
                <Field label="Note">
                  <Input name="note" />
                </Field>
                <Button small>Save decision</Button>
              </form>
            </details>
          ) : null}
        </Card>
        <Card title="Payment relationship (Stripe)">
          {isFinance ? (
            <>
              <KV
                items={[
                  ["Channel", <StatusBadge key="c" value={detail.payment?.channel ?? "unselected"} />],
                  ["Setup", <StatusBadge key="s" value={detail.payment?.setupState ?? "not_requested"} />],
                  [
                    "Stripe customer",
                    stripeRefs.usable ? (
                      stripeRefs.usable.providerId ? (
                        <code key="p" className="text-xs">
                          {stripeRefs.usable.providerId}
                        </code>
                      ) : (
                        <span key="p">
                          <StatusBadge value={stripeRefs.usable.status} /> <span className="text-xs text-muted">{(stripeRefs.usable.evidence as { reason?: string } | null)?.reason ?? "queued"}</span>
                        </span>
                      )
                    ) : (
                      "not requested"
                    ),
                  ],
                  ["Payer", payerAuth.ok ? `${payerAuth.payer.name}${payerAuth.payer.shared ? " (shared, explicitly authorized)" : ""}` : <span key="np" className="text-warn">{payerAuth.reason}</span>],
                  ["Direct revocation", detail.payment?.directRevocationAt ? fmtDate(detail.payment.directRevocationAt, tz) : "none"],
                ]}
              />
              {stripeRefs.others.length ? (
                <p className="mt-1 text-xs text-muted">Other Stripe references on file (not usable now): {stripeRefs.others.map((o) => `${o.providerId ?? "pending"} — ${o.why}`).join("; ")}.</p>
              ) : null}
              <p className="mt-2 text-xs text-muted">Stripe owns credentials/mandates; only masked status is retained. Collection, attempts and payment-failure holds arrive with phase 3.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <form action={requestSetupAction}>
                  <input type="hidden" name="locationId" value={id} />
                  <Button small variant="secondary" disabled={!payerAuth.ok}>
                    Request ACH setup
                  </Button>
                </form>
                {stripeConfigured() && stripeRefs.usable?.providerId && payerAuth.ok ? (
                  <form action={hostedSetupLinkAction}>
                    <input type="hidden" name="locationId" value={id} />
                    <Button small variant="secondary">Create hosted setup link</Button>
                  </form>
                ) : null}
              </div>
              {!payerAuth.ok ? <p className="mt-1 text-xs text-warn">Assign payer authority first — setup cannot be requested for an unassigned payer.</p> : null}
              {setupUrlLive ? (
                <div className="mt-2 bg-info-soft p-2 text-xs">
                  <strong>Hosted setup link for the authorized payer</strong> (bearer link — send only through the approved single-sender process; expires per Stripe):
                  <div className="mt-1 break-all font-mono">{setupUrlLive}</div>
                </div>
              ) : null}
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-accent">Assign payer authority</summary>
                <form action={setPayerAction} className="mt-2 space-y-2">
                  <input type="hidden" name="locationId" value={id} />
                  <Select name="contactId" required defaultValue="" aria-label="Payer contact">
                    <option value="" disabled>
                      Choose a current contact…
                    </option>
                    {detail.contacts.map((c) => (
                      <option key={c.contactId} value={c.contactId}>
                        {c.contact.name} ({c.contactRole})
                      </option>
                    ))}
                  </Select>
                  <Input name="sharedPayerNote" placeholder="Required if this person already pays for another location" aria-label="Shared payer note" />
                  <div className="flex gap-2">
                    <Button small variant="secondary">Assign</Button>
                  </div>
                  <p className="text-xs text-muted">Payer authority is never inherited from the AP contact or a parent (O04/D08).</p>
                </form>
                {detail.payment?.payerContactId ? (
                  <form action={clearPayerAction} className="mt-1">
                    <input type="hidden" name="locationId" value={id} />
                    <input type="hidden" name="reason" value="authority revoked by Accounting" />
                    <Button small variant="ghost">Revoke current payer</Button>
                  </form>
                ) : null}
              </details>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-danger">Record direct customer revocation</summary>
                <form action={directRevocationAction} className="mt-2 space-y-2">
                  <input type="hidden" name="locationId" value={id} />
                  <Input name="evidence" required placeholder="Evidence (email/call reference)" aria-label="Revocation evidence" />
                  <Button small variant="danger">Prohibit new debits now</Button>
                </form>
              </details>
            </>
          ) : (
            <KV items={[["Setup", <StatusBadge key="s" value={detail.payment?.setupState ?? "not_requested"} />], ["Action owner", "Admin / Accounting"]]} />
          )}
        </Card>
      </div>

      <Card title="Holds & overrides">
        {detail.holds.length === 0 ? <p className="text-sm text-muted">No active holds.</p> : null}
        <ul className="space-y-2">
          {detail.holds.map((h) => (
            <li key={h.id} className="border-t border-rule pt-2 text-sm">
              <div className="flex items-center justify-between">
                <span>
                  <Badge tone="danger">{h.kind.replace("_", " ")}</Badge> {h.cause}
                </span>
                <span className="text-xs text-muted">{fmtDate(h.createdAt, tz)}</span>
              </div>
              {isAdmin && h.kind !== "payment_failure" ? (
                <form action={resolveHoldAction} className="mt-2 flex gap-2">
                  <input type="hidden" name="locationId" value={id} />
                  <input type="hidden" name="holdId" value={h.id} />
                  <Input name="resolution" required placeholder="How was the cause resolved?" aria-label="Resolution" />
                  <Button small variant="secondary">Resolve cause</Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {detail.overrides.length ? (
          <ul className="mt-2 space-y-1">
            {detail.overrides.map((o) => (
              <li key={o.id} className="flex items-center justify-between bg-info-soft p-2 text-sm">
                <span>
                  Override ({o.scope}): {o.reason} — by {o.grantedByRole}
                </span>
                {isAdmin ? (
                  <form action={withdrawOverrideAction}>
                    <input type="hidden" name="locationId" value={id} />
                    <input type="hidden" name="overrideId" value={o.id} />
                    <input type="hidden" name="reason" value="withdrawn by Admin" />
                    <Button small variant="ghost">Withdraw</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {isAdmin ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <details>
              <summary className="cursor-pointer text-sm text-accent">Add hold</summary>
              <form action={createHoldAction} className="mt-2 space-y-2">
                <input type="hidden" name="locationId" value={id} />
                <Select name="kind" defaultValue="compliance" aria-label="Hold kind">
                  <option value="compliance">Compliance</option>
                  <option value="readiness">Readiness</option>
                  <option value="admin_manual">Admin manual</option>
                </Select>
                <Input name="cause" required placeholder="Cause" aria-label="Cause" />
                <Button small variant="secondary">Record hold</Button>
                <p className="text-xs text-muted">Payment-failure holds come only from definitive Stripe evidence (phase 3).</p>
              </form>
            </details>
            <details>
              <summary className="cursor-pointer text-sm text-accent">Grant audited override</summary>
              <form action={overrideAction} className="mt-2 space-y-2">
                <input type="hidden" name="locationId" value={id} />
                <Select name="holdId" required defaultValue="" aria-label="Hold">
                  <option value="" disabled>
                    Which hold? (one per override)
                  </option>
                  {detail.holds.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.kind}: {h.cause}
                    </option>
                  ))}
                </Select>
                <Select name="orderId" defaultValue="" aria-label="Order scope">
                  <option value="">Any delivery at this location</option>
                  {orders
                    .filter((o) => o.order.demandState !== "cancelled")
                    .map((o) => (
                      <option key={o.order.id} value={o.order.id}>
                        Only order {o.order.orderNumber}
                      </option>
                    ))}
                </Select>
                <Input name="scope" required placeholder="Scope, e.g. order NC-000012 delivery" aria-label="Scope" />
                <Input name="reason" required placeholder="Reason" aria-label="Reason" />
                <Button small variant="secondary">Grant</Button>
                <p className="text-xs text-muted">Covers only the named hold, never a hold created later. Duration/expiry is D03 (unselected) — no automatic expiry.</p>
              </form>
            </details>
          </div>
        ) : null}
      </Card>

      <Card title="Standing arrangements">
        {standing.length === 0 ? <p className="text-sm text-muted">None.</p> : null}
        <ul className="space-y-2">
          {standing.map(({ arrangement, lines, occurrences }) => (
            <li key={arrangement.id} className="border-t border-rule pt-2 text-sm">
              <div className="flex items-center justify-between">
                <span>
                  {lines.map((l) => `${l.sku.name} × ${l.l.qty}`).join(", ")} {arrangement.requestedCadence ? <span className="text-muted">· asked: {arrangement.requestedCadence}</span> : null}
                </span>
                <StatusBadge value={arrangement.state} />
              </div>
              <p className="text-xs text-muted">
                Authorization: {arrangement.authorizationNote}. Occurrences: {occurrences.length ? occurrences.map((o) => `${o.cycleKey} ${o.outcome.replace(/_/g, " ")}`).join(", ") : "none"}. Generation is inactive until D13 is selected for this market.
              </p>
              {can(actor, "standing.manage", { marketId: loc.marketId }) ? (
                <form action={standingStateAction} className="mt-1 flex gap-2">
                  <input type="hidden" name="locationId" value={id} />
                  <input type="hidden" name="arrangementId" value={arrangement.id} />
                  <input type="hidden" name="reason" value="changed on account page" />
                  {arrangement.state !== "paused" ? (
                    <Button small variant="ghost" name="state" value="paused">
                      Pause
                    </Button>
                  ) : (
                    <Button small variant="ghost" name="state" value="defined">
                      Resume
                    </Button>
                  )}
                  <Button small variant="ghost" name="state" value="ended">
                    End
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {can(actor, "standing.manage", { marketId: loc.marketId }) && loc.status === "active" ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-accent">Add standing arrangement</summary>
            <form action={createStandingAction} className="mt-2 space-y-2">
              <input type="hidden" name="locationId" value={id} />
              <div className="grid gap-2 sm:grid-cols-2">
                {catalog
                  .filter((c) => c.orderable)
                  .map((c) => (
                    <label key={c.sku.id} className="flex items-center justify-between gap-2 border-b border-rule-soft py-1">
                      <span className="text-sm">{c.sku.name}</span>
                      <Input name={`qty:${c.sku.id}`} type="number" min={0} inputMode="numeric" className="w-20" placeholder="0" />
                    </label>
                  ))}
              </div>
              <Input name="requestedCadence" placeholder="Cadence as the customer expressed it (e.g. every two weeks)" aria-label="Requested cadence" />
              <Input name="authorizationNote" required placeholder="Who authorized it and how (required)" aria-label="Authorization" />
              <Button small variant="secondary">Capture arrangement</Button>
              <p className="text-xs text-muted">Internal demand only; never a Stripe Subscription (U22).</p>
            </form>
          </details>
        ) : null}
      </Card>

      <Card title="Shipping & billing">
        <KV
          items={[
            ["Account kind", ACCOUNT_KIND_LABEL[loc.kind] ?? loc.kind],
            ["Served by", servedBy ? <Link key="sb" href={`/locations/${servedBy.id}`} className="underline">{servedBy.tradeName}</Link> : "Direct"],
            ["Legacy id", loc.legacyAccountId],
            ["Region", loc.region],
            ["Fulfilment", loc.fulfilment === "pickup" ? "Pickup at the origin (will-call)" : "Delivery"],
            ["Appointment required", loc.appointmentRequired === true ? "Yes" : loc.appointmentRequired === false ? "No" : "Unknown"],
            ["Deposit mode", `${DEPOSIT_MODE_LABEL[loc.depositMode] ?? loc.depositMode}${loc.depositCentsOverride != null ? `, ${formatCents(loc.depositCentsOverride)} per keg` : ""}`],
            [
              "Deposit on file",
              loc.depositTakenCents != null ? `${formatCents(loc.depositTakenCents)} taken ${loc.depositTakenOn ? fmtDay(loc.depositTakenOn) : ""}${loc.depositSettledOn ? `, settled ${fmtDay(loc.depositSettledOn)}${loc.depositSettlementNote ? ` (${loc.depositSettlementNote})` : ""}` : ", open"}` : loc.depositMode === "floating" ? "none recorded yet (R2-13)" : "—",
            ],
            ["Terms", loc.termsDaysOverride != null ? `Net ${loc.termsDaysOverride} (account override)` : `Market rule (Net ${market?.termsDays ?? 30})`],
            ["Pays by", loc.payBy ? PAY_BY_LABEL[loc.payBy as PayBy] ?? loc.payBy : "not set"],
            ["Invoice on receipt", loc.invoiceOnReceipt ? "Yes: the invoice travels in the delivery pack" : "No"],
            ["Pallet rule", loc.palletRule],
            ["Receiving requirements", loc.receivingRequirements],
            ["First delivery", loc.firstDeliveryOn ? fmtDay(loc.firstDeliveryOn) : "—"],
            [
              "Keg balance",
              kegBalance ? (
                <Link key="kb" href={`/kegs/${id}`} className="underline">
                  {kegBalance.halfBalance} × 1/2 bbl, {kegBalance.sixtelBalance} × 1/6 bbl out
                </Link>
              ) : (
                <Link key="kb" href={`/kegs/${id}`} className="underline">
                  none recorded
                </Link>
              ),
            ],
          ]}
        />
        {loc.servedByLocationId && loc.kind !== "distributor" ? <p className="mt-2 text-xs text-warn">A direct shipment to this account needs an override reason at confirmation (2.6).</p> : null}
        {canShipping ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-accent">Edit shipping and billing attributes (Admin)</summary>
            <form action={updateAccountShippingAction} className="mt-2 grid gap-2 sm:grid-cols-3">
              <input type="hidden" name="locationId" value={id} />
              <Field label="Account kind">
                <Select name="kind" defaultValue={loc.kind}>
                  {Object.entries(ACCOUNT_KIND_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Served by" hint="Distributor accounts in this market; blank = direct.">
                <Select name="servedByLocationId" defaultValue={loc.servedByLocationId ?? ""}>
                  <option value="">Direct</option>
                  {distributors.map((l) => (
                    <option key={l.loc.id} value={l.loc.id}>
                      {l.loc.tradeName}
                    </option>
                  ))}
                  {loc.servedByLocationId && !distributors.some((l) => l.loc.id === loc.servedByLocationId) && servedBy ? <option value={servedBy.id}>{servedBy.tradeName}</option> : null}
                </Select>
              </Field>
              <Field label="Legacy ACC- id">
                <Input name="legacyAccountId" defaultValue={loc.legacyAccountId ?? ""} />
              </Field>
              <Field label="Region" hint={market?.regionList?.length ? `Market regions: ${market.regionList.join(", ")}` : "Free text; the market has no region list yet."}>
                <Input name="region" defaultValue={loc.region ?? ""} list={`regions-${id}`} />
                {market?.regionList?.length ? (
                  <datalist id={`regions-${id}`}>
                    {market.regionList.map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                ) : null}
              </Field>
              <Field label="Fulfilment">
                <Select name="fulfilment" defaultValue={loc.fulfilment}>
                  <option value="delivery">Delivery</option>
                  <option value="pickup">Pickup at the origin</option>
                </Select>
              </Field>
              <Field label="Appointment required">
                <Select name="appointmentRequired" defaultValue={loc.appointmentRequired === true ? "yes" : loc.appointmentRequired === false ? "no" : ""}>
                  <option value="">Unknown</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              </Field>
              <Field label="Deposit mode (3.10)">
                <Select name="depositMode" defaultValue={loc.depositMode}>
                  {Object.entries(DEPOSIT_MODE_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Deposit per keg override (USD)" hint="Blank = market rate.">
                <Input name="depositOverride" type="number" min={0} step="0.01" defaultValue={loc.depositCentsOverride != null ? (loc.depositCentsOverride / 100).toFixed(2) : ""} />
              </Field>
              <Field label="Terms override (days)" hint="Blank inherits the market rule (7.4).">
                <Input name="termsDaysOverride" type="number" min={0} step={1} defaultValue={loc.termsDaysOverride ?? ""} />
              </Field>
              <Field label="Pallet rule">
                <Input name="palletRule" defaultValue={loc.palletRule ?? ""} placeholder="e.g. 48 x 40 GMA, max 56 in" />
              </Field>
              <Field label="Receiving requirements">
                <Input name="receivingRequirements" defaultValue={loc.receivingRequirements ?? ""} />
              </Field>
              <Field label="First delivery on">
                <Input name="firstDeliveryOn" type="date" defaultValue={loc.firstDeliveryOn ?? ""} />
              </Field>
              <Field label="Pays by (R2-12)" hint="Copied onto each invoice at issue; collection stays manual.">
                <Select name="payBy" defaultValue={loc.payBy ?? ""}>
                  <option value="">Not set</option>
                  {Object.entries(PAY_BY_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Invoice on receipt (R2-30)" hint="Off by default; on adds the invoice to the delivery pack.">
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input type="checkbox" name="invoiceOnReceipt" defaultChecked={loc.invoiceOnReceipt} /> Print the invoice with the BOL
                </label>
              </Field>
              <div className="sm:col-span-3">
                <Button small>Save</Button>
              </div>
            </form>
          </details>
        ) : null}
        {canShipping && (loc.depositMode === "floating" || loc.depositTakenCents != null) ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-accent">Floating deposit on file (R2-13)</summary>
            <form action={updateDepositOnFileAction} className="mt-2 grid gap-2 sm:grid-cols-4">
              <input type="hidden" name="locationId" value={id} />
              <Field label="Deposit taken (USD)">
                <Input name="depositTaken" type="number" min={0} step="0.01" defaultValue={loc.depositTakenCents != null ? (loc.depositTakenCents / 100).toFixed(2) : ""} />
              </Field>
              <Field label="Taken on">
                <Input name="depositTakenOn" type="date" defaultValue={loc.depositTakenOn ?? ""} />
              </Field>
              <Field label="Settled on" hint="On the last order; leave blank while kegs are out.">
                <Input name="depositSettledOn" type="date" defaultValue={loc.depositSettledOn ?? ""} />
              </Field>
              <Field label="Settlement note">
                <Input name="depositSettlementNote" defaultValue={loc.depositSettlementNote ?? ""} placeholder="e.g. refunded by check 1182" />
              </Field>
              <div className="sm:col-span-4">
                <Button small>Save deposit</Button>
                <span className="ml-2 text-xs text-ink-3">One deposit per account, never per-keg lines; kegs out and empties back are counted on the Kegs page.</span>
              </div>
            </form>
          </details>
        ) : null}
        <div className="mt-3 border-t border-line pt-3">
          <div className="text-xs uppercase tracking-wide text-muted">Price exceptions (3.9, 7.10)</div>
          {priceOverrides.length === 0 ? (
            <p className="text-sm text-muted">None; the market price list applies.</p>
          ) : (
            <ul className="text-sm">
              {priceOverrides.map(({ o, sku }) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    <span className="font-mono text-xs">{sku.code}</span> {sku.brand} {sku.name}: <strong>{formatCents(o.priceCents)}</strong>{" "}
                    <span className="text-xs text-muted">
                      {o.reason}, since {fmtDate(o.effectiveFrom, tz)}
                      {o.effectiveTo ? `, until ${fmtDate(o.effectiveTo, tz)}` : ""}
                    </span>
                  </span>
                  {canPrice ? (
                    <form action={endPriceOverrideAction} className="flex items-center gap-1">
                      <input type="hidden" name="locationId" value={id} />
                      <input type="hidden" name="overrideId" value={o.id} />
                      <Input name="reason" required placeholder="Reason" className="w-36" aria-label="Reason" />
                      <Button small variant="ghost">
                        End now
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canPrice ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-accent">Set a price exception</summary>
              <form action={setPriceOverrideAction} className="mt-2 grid gap-2 sm:grid-cols-4">
                <input type="hidden" name="locationId" value={id} />
                <Select name="skuId" required defaultValue="" aria-label="SKU">
                  <option value="" disabled>
                    SKU…
                  </option>
                  {catalog.map((c) => (
                    <option key={c.sku.id} value={c.sku.id}>
                      {c.sku.code} — {c.sku.brand} {c.sku.name} ({formatCents(c.priceCents)})
                    </option>
                  ))}
                </Select>
                <Input name="price" type="number" step="0.01" min={0} required placeholder="Price (USD)" aria-label="Price" />
                <Input name="reason" required placeholder="Reason (required)" aria-label="Reason" />
                <Input name="endsOn" type="date" required aria-label="Ends on" />
                <Button small variant="secondary">
                  Set exception
                </Button>
              </form>
              <p className="mt-1 text-xs text-muted">Owner or back office only, with a reason and an end date (R2-16); replaces any open exception for the SKU.</p>
            </details>
          ) : null}
        </div>
        {canShipView ? (
          <div className="mt-3 border-t border-line pt-3">
            <div className="text-xs uppercase tracking-wide text-muted">Recent shipments</div>
            {recentShipments.length === 0 ? (
              <p className="text-sm text-muted">No shipments yet.</p>
            ) : (
              <ul className="text-sm">
                {recentShipments.map(({ s }) => (
                  <li key={s.id} className="flex items-center justify-between py-1">
                    <Link href={`/shipments/${s.id}`} className="underline">
                      {shipmentNumber(s)} <span className="text-xs text-muted">· {s.type} · {fmtDay(s.scheduledDate)}</span>
                    </Link>
                    <StatusBadge value={s.status} />
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/shipments?destination=${id}`} className="mt-1 block text-sm text-accent hover:underline">
              All shipments for this account
            </Link>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Kegs (phase 4)">
          <KV items={[["Recorded custody movements", String(kegMovements.length)], ["Outstanding count", kegMovements.length ? "see phase 4" : "no custody recorded"]]} />
          <p className="mt-1 text-xs text-muted">$35 deposit per keg, count-based. Custody, returns and credits arrive with phase 4.</p>
        </Card>
        <Card title="Cleaning / service (phase 4)">
          <KV items={[["Applicable", cleaning?.applicable ?? "unknown"], ["Last completed", fmtDay(cleaning?.lastCompletedOn)]]} />
          <p className="mt-1 text-xs text-muted">Roughly biweekly with the next delivery; baseline/scope is D26 (unselected).</p>
        </Card>
      </div>

      {isAdmin ? (
        <Card title="Admin: ownership, default warehouse, lifecycle">
          <div className="grid gap-3 sm:grid-cols-3">
            <form action={assignRepAction} className="space-y-1">
              <input type="hidden" name="locationId" value={id} />
              <Field label="Current rep" hint={`Originating: ${employees.find((e) => e.id === loc.originatingRepEmployeeId)?.displayName ?? "—"} (history kept)`}>
                <Select name="employeeId" defaultValue={loc.currentRepEmployeeId ?? ""}>
                  {employees
                    .filter((e) => e.id === loc.currentRepEmployeeId || (e.enabled && e.grants.some((g) => g.role === "sales" || g.role === "admin" || g.role === "owner")))
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.displayName}
                        {!e.enabled ? " (disabled)" : ""}
                      </option>
                    ))}
                </Select>
              </Field>
              <Input name="reason" placeholder="Reason" aria-label="Reason" />
              <Button small variant="secondary">Assign</Button>
            </form>
            <form action={warehouseOverrideAction} className="space-y-1">
              <input type="hidden" name="locationId" value={id} />
              <Field label="Default warehouse for FUTURE orders" hint="Existing orders are not moved — reassign those on the order page. Market/seller/prices unchanged.">
                <Select name="warehouseId" defaultValue={loc.warehouseOverrideId ?? ""}>
                  <option value="">Market primary</option>
                  {warehouses
                    .filter((w) => w.active)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                        {w.marketId !== loc.marketId ? " (other market)" : ""}
                      </option>
                    ))}
                </Select>
              </Field>
              <Input name="reason" placeholder="Reason" aria-label="Reason" />
              <Button small variant="secondary">Set default</Button>
            </form>
            <form action={statusAction} className="space-y-1">
              <input type="hidden" name="locationId" value={id} />
              <Field label="Status" hint="Active or Closed (R2-31). Closure keeps every obligation, credit, custody and audit; run-off review opens (J31).">
                <Select name="status" defaultValue={loc.status === "inactive" ? "closed" : loc.status}>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </Select>
              </Field>
              <Input name="reason" required placeholder="Reason (required)" aria-label="Reason" />
              <Button small variant="secondary">Update</Button>
            </form>
          </div>
          {others.length ? (
            <form action={duplicateAction} className="mt-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="locationId" value={id} />
              <Field label="Flag suspected duplicate of">
                <Select name="otherLocationId">
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.tradeName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Input name="note" placeholder="Why?" className="max-w-xs" aria-label="Note" />
              <Button small variant="secondary">Open case</Button>
            </form>
          ) : null}
        </Card>
      ) : null}

      <TimelineCard result={timeline} basePath={`/locations/${id}`} kind={kind} tz={tz} />
    </Page>
  );
}
