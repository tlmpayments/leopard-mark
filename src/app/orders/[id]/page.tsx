import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { NoticeActions } from "@/components/notice-actions";
import { TimelineCard } from "@/components/timeline";
import { Badge, Button, Card, Field, Flash, Input, KV, Notice, Page, Select, StateLine, StatusBadge, fmtDate, fmtDay } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { KEG_DEPOSIT_CENTS, formatCents, marketCatalog } from "@/lib/domain/catalog/service";
import { listWarehouses } from "@/lib/domain/markets/service";
import { NOTICE_PURPOSE_LABEL } from "@/lib/domain/notices/service";
import { getOrder, type MinimumEvaluation } from "@/lib/domain/orders/service";
import { evaluateLocationReadiness } from "@/lib/domain/readiness/service";
import { activityTimeline } from "@/lib/domain/timeline/service";
import { releaseReservationAction, requeueReservationAction } from "../../admin/actions";
import { amendQtyAction, cancelOrderAction, flagAbnormalAction, reassignWarehouseAction, requestChangeAction } from "../actions";

/** One plain sentence about what the order is doing now and who acts next (UX-04). */
function orderStatusLine(o: NonNullable<Awaited<ReturnType<typeof getOrder>>>, readinessSummary: string, openCases: Array<{ category: string; ownerRole: string | null }>) {
  const ord = o.order;
  if (ord.demandState === "cancelled") return { kind: "info" as const, text: `Cancelled ${ord.cancelledAt ? fmtDate(ord.cancelledAt) : ""}${ord.cancelReason ? ` — ${ord.cancelReason}` : ""}. Original quantities are kept as history.` };
  if (ord.demandState === "fulfilled") return { kind: "info" as const, text: "Delivered in full." };
  const unmet = o.lines.reduce((s, l) => s + l.unmetQty, 0);
  const remaining = o.lines.reduce((s, l) => s + (l.currentQty - l.deliveredQty), 0);
  const parts: string[] = [];
  parts.push(`Order recorded${ord.demandState === "partially_fulfilled" ? " and partly delivered" : ""}.`);
  if (unmet > 0) parts.push(`${unmet} unit(s) are waiting for stock — Admin is handling the shortage.`);
  else if (remaining > 0) parts.push(`${remaining} unit(s) are reserved.`);
  const change = openCases.find((c) => c.category === "order_change_request");
  if (change) parts.push("A change request is with Admin.");
  const minimum = openCases.find((c) => c.category === "below_minimum");
  if (minimum) parts.push("It is below (or may be below) the $90 minimum — Admin decides how to consolidate or release.");
  parts.push(readinessSummary === "Ready for delivery when scheduled." ? "Delivery can be scheduled (phase 2)." : readinessSummary);
  return { kind: unmet > 0 || minimum || change ? ("action_needed" as const) : ("info" as const), text: parts.join(" ") };
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const actor = await requireAction("order.view");
  const d = await getDb();
  const o = await getOrder(d, id);
  if (!o || !can(actor, "order.view", { marketId: o.order.marketId })) notFound();
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const tz = o.market?.timezone ?? "America/Los_Angeles";
  const min = o.order.minimumEvaluation as MinimumEvaluation | null;
  const isAdmin = can(actor, "allocation.resolve", { marketId: o.order.marketId });
  const canRequest = can(actor, "order.request_change", { marketId: o.order.marketId });
  const canNotice = can(actor, "notice.record_outcome", { marketId: o.order.marketId });
  const showNotices = can(actor, "notice.view", { marketId: o.order.marketId });
  const catalog = canRequest ? await marketCatalog(d, o.order.marketId) : [];
  const remaining = o.lines.reduce((s, l) => s + (l.currentQty - l.deliveredQty), 0);
  const reservations = isAdmin ? await d.select().from(schema.reservation).where(and(inArray(schema.reservation.orderLineId, o.lines.map((l) => l.id)), eq(schema.reservation.state, "reserved"))) : [];
  const merchandise = o.lines.reduce((s, l) => s + l.currentQty * l.unitPriceCentsAtSubmission, 0);
  const kegs = o.lines.reduce((s, l) => s + l.currentQty * l.kegsPerUnit, 0);
  const readiness = await evaluateLocationReadiness(d, o.order.locationId, { orderId: id });
  const openCases = o.exceptions.filter((e) => e.state !== "resolved");
  const status = orderStatusLine(o, readiness.summary, openCases);
  const warehouses = isAdmin ? (await listWarehouses(d)).filter((w) => w.active) : [];
  const warehouse = o.order.warehouseId ? warehouses.find((w) => w.id === o.order.warehouseId) ?? (await d.select().from(schema.warehouse).where(eq(schema.warehouse.id, o.order.warehouseId)))[0] : null;
  const timeline = await activityTimeline(d, actor, { orderId: id, cursor: param(sp, "before"), kinds: param(sp, "kind") ? [param(sp, "kind") as never] : undefined, limit: 25 });
  const open = o.order.demandState !== "cancelled" && o.order.demandState !== "fulfilled";

  return (
    <Page
      title={o.order.orderNumber}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Link href={`/locations/${o.order.locationId}`} className="underline">
            {o.location?.tradeName}
          </Link>
          <Badge>{o.market?.code}</Badge>
          <StatusBadge value={o.order.demandState} />
          {o.order.abnormalFlag ? <Badge tone="warn">flagged: {o.order.abnormalReason}</Badge> : null}
        </span>
      }
      actions={can(actor, "order.submit", { marketId: o.order.marketId }) && o.location?.status !== "closed" ? <Button href={`/orders/new?locationId=${o.order.locationId}&repeat=${id}`} variant="secondary">Repeat this order</Button> : null}
    >
      <Flash {...flash} />
      <Card title="Right now">
        <StateLine kind={status.kind}>{status.text}</StateLine>
        {openCases.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {openCases.map((e) => (
              <li key={e.id}>
                <Link href={`/admin/exceptions/${e.id}`} className="underline">
                  {e.title}
                </Link>{" "}
                <span className="text-xs text-muted">
                  — {e.ownerRole ? `${e.ownerRole} acts next` : "unassigned"}
                  {e.waitingParty ? `, waiting on ${e.waitingParty}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title="Demand">
        <ul className="divide-y divide-line">
          {o.lines.map((l) => (
            <li key={l.id} className="py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {l.sku.brand} {l.sku.name}
                </span>
                <span>
                  {formatCents(l.unitPriceCentsAtSubmission)} / {l.sku.sellingUnit}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-xs">
                <Badge>ordered {l.orderedQty}</Badge>
                <Badge>current {l.currentQty}</Badge>
                {l.cancelledQty ? <Badge tone="danger">cancelled {l.cancelledQty}</Badge> : null}
                <Badge tone={l.reservedQty === l.currentQty - l.deliveredQty ? "good" : "warn"}>reserved {l.reservedQty}</Badge>
                {l.unmetQty ? <Badge tone="warn">waiting for stock {l.unmetQty}</Badge> : null}
                <Badge>delivered {l.deliveredQty}</Badge>
              </div>
              {canRequest && open ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-accent">Request change</summary>
                  <form action={requestChangeAction} className="mt-1 grid gap-2 sm:grid-cols-4">
                    <input type="hidden" name="orderId" value={id} />
                    <input type="hidden" name="orderLineId" value={l.id} />
                    <Select name="kind" defaultValue="amend_qty" aria-label="Change kind">
                      <option value="amend_qty">Change quantity</option>
                      <option value="substitution_request">Substitute product</option>
                    </Select>
                    <Input name="requestedQty" type="number" min={0} placeholder="New qty" aria-label="Requested quantity" />
                    <Select name="substituteSkuId" defaultValue="" aria-label="Substitute product">
                      <option value="">(substitute product)</option>
                      {catalog
                        .filter((c) => c.orderable)
                        .map((c) => (
                          <option key={c.sku.id} value={c.sku.id}>
                            {c.sku.name}
                          </option>
                        ))}
                    </Select>
                    <Input name="reason" required placeholder="Reason" aria-label="Reason" />
                    <div className="sm:col-span-4">
                      <Button small variant="secondary">Record request</Button>
                      <span className="ml-2 text-xs text-muted">Goes to Admin; nothing changes silently (amendment and price rules D10/D12 are unselected).</span>
                    </div>
                  </form>
                </details>
              ) : null}
              {isAdmin
                ? reservations
                    .filter((r) => r.orderLineId === l.id)
                    .map((r) => (
                      <div key={r.id} className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        {r.displacedAt ? (
                          <form action={requeueReservationAction} className="flex gap-1">
                            <input type="hidden" name="orderId" value={id} />
                            <input type="hidden" name="reservationId" value={r.id} />
                            <Input name="reason" placeholder="Reason" className="max-w-[12rem]" aria-label="Reason" />
                            <Button small variant="secondary">Re-queue displaced demand</Button>
                            <span className="text-muted">displaced: {r.displacementNote}</span>
                          </form>
                        ) : r.reservedQty > 0 && open ? (
                          <form action={releaseReservationAction} className="flex gap-1">
                            <input type="hidden" name="orderId" value={id} />
                            <input type="hidden" name="reservationId" value={r.id} />
                            <Input name="reason" required placeholder="Who is displaced and why" className="max-w-[16rem]" aria-label="Reason" />
                            <Button small variant="ghost">Release reserved units</Button>
                          </form>
                        ) : null}
                      </div>
                    ))
                : null}
              {isAdmin && open ? (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-accent">Admin: amend quantity (before commitment)</summary>
                  <form action={amendQtyAction} className="mt-1 flex flex-wrap gap-2">
                    <input type="hidden" name="orderId" value={id} />
                    <input type="hidden" name="orderLineId" value={l.id} />
                    <Input name="newQty" type="number" min={l.deliveredQty} defaultValue={l.currentQty} className="w-24" aria-label="New quantity" />
                    <Input name="reason" required placeholder="Reason" className="max-w-xs" aria-label="Reason" />
                    <Button small variant="secondary">Apply</Button>
                  </form>
                  <p className="text-xs text-muted">Keeps this order&apos;s place in the queue. Refused when added units would need a price decision (D12) or the line is loaded.</p>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <KV
            items={[
              ["Merchandise (current demand)", formatCents(merchandise)],
              ["Keg deposits", `${kegs} × ${formatCents(KEG_DEPOSIT_CENTS)} = ${formatCents(kegs * KEG_DEPOSIT_CENTS)}`],
              [
                "$90 minimum at submission",
                min ? (
                  <span key="m">
                    <StatusBadge value={min.verdict} /> <span className="text-xs text-muted">basis: {min.basis === "unselected" ? "Owner decision D11 pending" : min.basis.replace(/_/g, " ")}</span>
                  </span>
                ) : (
                  "—"
                ),
              ],
              ["Remaining undelivered units", String(remaining)],
            ]}
          />
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Order facts">
          <KV
            items={[
              ["Source", o.order.source],
              ["Submitted", fmtDate(o.order.submittedAt, tz)],
              ["Requested date", o.order.requestedDate ? `${fmtDay(o.order.requestedDate)} (a request, never a promise)` : "none"],
              ["Notes", o.order.notes],
              ["Serving warehouse", warehouse?.name ?? "—"],
              ["Cancelled", o.order.cancelledAt ? `${fmtDate(o.order.cancelledAt, tz)} — ${o.order.cancelReason}` : "no"],
            ]}
          />
          {isAdmin && open ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-accent">Reassign THIS order to another warehouse</summary>
              <form action={reassignWarehouseAction} className="mt-2 space-y-2">
                <input type="hidden" name="orderId" value={id} />
                <Select name="warehouseId" required defaultValue="" aria-label="Warehouse">
                  <option value="" disabled>
                    Choose warehouse…
                  </option>
                  {warehouses
                    .filter((w) => w.id !== o.order.warehouseId)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                        {w.marketId !== o.order.marketId ? " (other market)" : ""}
                      </option>
                    ))}
                </Select>
                <Input name="reason" required placeholder="Reason" aria-label="Reason" />
                <Button small variant="secondary">Reassign existing order</Button>
                <p className="text-xs text-muted">Moves this order&apos;s reservations only; the account&apos;s default for future orders is set on the account page. Loaded work is refused and handed to a reconciliation task. Market, seller and prices stay as they are.</p>
              </form>
            </details>
          ) : null}
        </Card>
        <Card title="Fulfilment, documents, money (phases 2–3)">
          <KV
            items={[
              ["Delivery attempts", o.visits.length ? String(o.visits.length) : "none — scheduling/BOL/POD arrive with phase 2"],
              ["Invoice", "none — Stripe delivery-day invoicing arrives with phase 3"],
              ["Due date", "actual delivery + 30 calendar days (set from the delivery fact)"],
            ]}
          />
        </Card>
      </div>

      {o.changes.length ? (
        <Card title="Change history">
          <ul className="divide-y divide-line text-sm">
            {o.changes.map((c) => (
              <li key={c.id} className="py-1.5">
                <span className="text-xs text-muted">{fmtDate(c.at, tz)}</span> · {c.kind.replace(/_/g, " ")} {c.priorQty != null ? `${c.priorQty} → ${c.currentQty ?? "?"}` : ""}{" "}
                {c.proposedPriceCents != null && c.priorPriceCents !== c.proposedPriceCents ? (
                  <Badge tone="warn">
                    price {formatCents(c.priorPriceCents)} → {formatCents(c.proposedPriceCents)}
                  </Badge>
                ) : null}{" "}
                <StatusBadge value={c.policyStatus ?? "applied"} /> {c.reason ? <span className="text-muted">— {c.reason}</span> : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {showNotices ? (
        <Card title="Customer notices">
          {o.notices.length === 0 ? <p className="text-sm text-muted">None.</p> : null}
          <ul className="divide-y divide-line text-sm">
            {o.notices.map((n) => (
              <li key={n.id} className="py-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>{NOTICE_PURPOSE_LABEL[n.purpose] ?? n.purpose}</strong> v{n.version} → {n.recipientEmail ?? <span className="text-danger">no recipient email</span>}
                  </span>
                  <StatusBadge value={n.state} />
                </div>
                {n.outcomeNote ? <p className="text-xs text-muted">Outcome: {n.outcomeNote} ({n.sentVia}, {fmtDate(n.outcomeRecordedAt, tz)})</p> : null}
                {canNotice ? <NoticeActions noticeId={n.id} state={n.state} returnTo={`/orders/${id}`} recipientEmail={n.recipientEmail} /> : null}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-muted">Sender allocation (D32/IG04) is unselected: a person sends each notice and records the outcome. Recording &quot;sent&quot; is staff evidence, not provider-confirmed delivery.</p>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-4">
        {isAdmin && remaining > 0 && open ? (
          <form action={cancelOrderAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="orderId" value={id} />
            <Field label="Cancel undelivered demand">
              <Input name="reason" required placeholder="Reason" />
            </Field>
            <Button small variant="danger">Cancel remaining</Button>
          </form>
        ) : null}
        {can(actor, "order.flag_abnormal", { marketId: o.order.marketId }) && !o.order.abnormalFlag && open ? (
          <form action={flagAbnormalAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="orderId" value={id} />
            <Field label="Flag as abnormal (not rejected)">
              <Input name="reason" required placeholder="Why?" />
            </Field>
            <Button small variant="secondary">Flag</Button>
          </form>
        ) : null}
      </div>
      {!isAdmin && remaining > 0 && open ? <Notice tone="info">Cancellation authority by stage is an open Owner decision (D10): Sales records a change request; Admin cancels undelivered demand.</Notice> : null}

      <TimelineCard result={timeline} basePath={`/orders/${id}`} kind={param(sp, "kind")} tz={tz} />
    </Page>
  );
}
