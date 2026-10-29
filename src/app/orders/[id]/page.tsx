import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { NoticeActions } from "@/components/notice-actions";
import { TimelineCard } from "@/components/timeline";
import { ActionPanel, Button, Card, Code, Columns, Empty, Field, Flash, Input, KV, Notice, RecordPage, Select, StateLine, StatusBadge, Struck, Table, Tabs, fmtDate, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { formatCents, marketCatalog, priceTierForKind } from "@/lib/domain/catalog/service";
import { listWarehouses } from "@/lib/domain/markets/service";
import { NOTICE_PURPOSE_LABEL } from "@/lib/domain/notices/service";
import { ORDER_SOURCE_LABEL, getOrder, minimumAppliesTo, type MinimumEvaluation } from "@/lib/domain/orders/service";
import { originLabel } from "@/lib/domain/origins/service";
import { changeDeadline, formatCutoff, nextShipDate, originCutoff } from "@/lib/domain/cutoff/service";
import { evaluateLocationReadiness } from "@/lib/domain/readiness/service";
import { getShipment } from "@/lib/domain/shipments/service";
import { activityTimeline } from "@/lib/domain/timeline/service";
import { releaseReservationAction, requeueReservationAction } from "../../admin/actions";
import { TYPE_LABEL, shipmentNumber, todayIso } from "../../shipments/labels";
import { amendQtyAction, cancelOrderAction, confirmOrderShipmentAction, createShipmentForOrderAction, flagAbnormalAction, reassignWarehouseAction, releaseHoldAction, requestChangeAction } from "../actions";

/** One plain sentence about what the order is doing now and who acts next (UX-04). */
function orderStatusLine(o: NonNullable<Awaited<ReturnType<typeof getOrder>>>, active: { number: string | null; status: string; scheduledDate: string | null } | null, readinessSummary: string, openCases: Array<{ category: string; ownerRole: string | null }>) {
  const ord = o.order;
  if (ord.demandState === "cancelled") return { kind: "info" as const, text: `Cancelled ${ord.cancelledAt ? fmtDate(ord.cancelledAt) : ""}${ord.cancelReason ? `: ${ord.cancelReason}` : ""}. Original quantities are kept as history.` };
  if (ord.demandState === "fulfilled") return { kind: "info" as const, text: "Delivered in full." };
  if (ord.demandState === "held") return { kind: "action_needed" as const, text: `Held: the origin was short when the order came in${ord.shortfallReason ? ` (${ord.shortfallReason})` : ""}. Nothing ships until the office lifts the hold.` };
  const unmet = o.lines.reduce((s, l) => s + l.unmetQty, 0);
  const parts: string[] = [];
  if (active) {
    if (active.status === "draft") parts.push("Shipment drafted; set the scheduled date and confirm to number it and print the BOL.");
    else if (active.status === "delivered") parts.push("Delivered.");
    else parts.push(`${active.number} is ${active.status}${active.scheduledDate ? ` for ${fmtDay(active.scheduledDate)}` : ""}.`);
  } else parts.push("Open; no shipment in play.");
  if (unmet > 0) parts.push(`${unmet} unit(s) stay an open line until stock arrives at the origin.`);
  const change = openCases.find((c) => c.category === "order_change_request");
  if (change) parts.push("A change request is with the office.");
  const minimum = openCases.find((c) => c.category === "below_minimum");
  if (minimum) parts.push("Below (or may be below) the $90 rep minimum.");
  if (readinessSummary !== "Ready for delivery when scheduled.") parts.push(readinessSummary);
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
  const minimumApplies = minimumAppliesTo({ source: o.order.source, noCharge: o.order.noCharge });
  const isAdmin = can(actor, "allocation.resolve", { marketId: o.order.marketId });
  const canRequest = can(actor, "order.request_change", { marketId: o.order.marketId });
  const canConfirm = can(actor, "shipment.confirm", { marketId: o.order.marketId });
  const canManageShipment = can(actor, "shipment.manage", { marketId: o.order.marketId });
  const canSubmit = can(actor, "order.submit", { marketId: o.order.marketId });
  const canNotice = can(actor, "notice.record_outcome", { marketId: o.order.marketId });
  const showNotices = can(actor, "notice.view", { marketId: o.order.marketId });
  const catalog = canRequest ? await marketCatalog(d, o.order.marketId, { tier: priceTierForKind(o.location?.kind) }) : [];
  const remaining = o.lines.reduce((s, l) => s + (l.currentQty - l.deliveredQty), 0);
  const reservations = isAdmin ? await d.select().from(schema.reservation).where(and(inArray(schema.reservation.orderLineId, o.lines.map((l) => l.id)), eq(schema.reservation.state, "reserved"))) : [];
  const merchandise = o.lines.reduce((s, l) => s + l.currentQty * l.unitPriceCentsAtSubmission, 0);
  const kegs = o.lines.reduce((s, l) => s + l.currentQty * l.kegsPerUnit, 0);
  const readiness = await evaluateLocationReadiness(d, o.order.locationId, { orderId: id });
  const openCases = o.exceptions.filter((e) => e.state !== "resolved");
  const warehouses = isAdmin ? (await listWarehouses(d)).filter((w) => w.active) : [];
  const warehouse = o.order.warehouseId ? warehouses.find((w) => w.id === o.order.warehouseId) ?? (await d.select().from(schema.warehouse).where(eq(schema.warehouse.id, o.order.warehouseId)))[0] : null;
  const timeline = await activityTimeline(d, actor, { orderId: id, cursor: param(sp, "before"), kinds: param(sp, "kind") ? [param(sp, "kind") as never] : undefined, limit: 25 });
  const open = o.order.demandState === "submitted" || o.order.demandState === "partially_fulfilled" || o.order.demandState === "held";
  const activeRow = o.shipments.find((s) => s.status !== "voided") ?? null;
  const active = activeRow ? await getShipment(d, activeRow.id) : null;
  const status = orderStatusLine(o, activeRow, readiness.summary, openCases);
  const today = todayIso(tz);
  // Round 3: the origin's cutoff sets the earliest ship date and when changes close (changes later are exceptions).
  const cutoff = await originCutoff(d, activeRow?.originWarehouseId ?? o.order.warehouseId ?? null);
  const nextShip = cutoff ? nextShipDate(cutoff) : today;
  const confirmDefault = o.order.requestedDate && o.order.requestedDate >= nextShip ? o.order.requestedDate : nextShip;
  const shipDate = activeRow?.scheduledDate ?? o.order.requestedDate;
  const deadline = cutoff && shipDate && activeRow?.status !== "delivered" ? changeDeadline(cutoff, shipDate) : null;
  const decidedBy = o.order.shortfallDecidedByEmployeeId ? (await d.select({ name: schema.employee.displayName }).from(schema.employee).where(eq(schema.employee.id, o.order.shortfallDecidedByEmployeeId)))[0]?.name ?? null : null;
  const skuName = new Map(o.lines.map((l) => [l.skuId, `${l.sku.brand} ${l.sku.name}`]));

  const linesTab = (
    <>
      <Table
        caption="Order lines"
        head={["Product", "Ordered", "Current", "Reserved", "Waiting", "Delivered", "Unit price", ""]}
        widths={[undefined, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.money, "14rem"]}
        align={["left", "right", "right", "right", "right", "right", "right", "left"]}
        rows={o.lines.map((l) => [
          <span key="n">
            {l.sku.brand} {l.sku.name}
            <span className="block text-xs text-ink-3">{l.sku.sellingUnit}</span>
          </span>,
          String(l.orderedQty),
          l.cancelledQty ? (
            <span key="c">
              {l.currentQty} <span className="text-xs text-ink-3">({l.cancelledQty} cancelled)</span>
            </span>
          ) : (
            String(l.currentQty)
          ),
          String(l.reservedQty),
          l.unmetQty ? <span key="w" className="font-semibold">{l.unmetQty}</span> : "0",
          String(l.deliveredQty),
          o.order.noCharge ? <span key="p" className="text-ink-3">no charge</span> : formatCents(l.unitPriceCentsAtSubmission),
          <span key="a" className="flex flex-wrap gap-x-3 text-xs">
            {canRequest && open ? (
              <details>
                <summary className="cursor-pointer text-navy">Request change</summary>
                <form action={requestChangeAction} className="mt-1 grid w-72 gap-1.5">
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
                  <Button small variant="secondary">
                    Record request
                  </Button>
                </form>
              </details>
            ) : null}
            {isAdmin && open ? (
              <details>
                <summary className="cursor-pointer text-navy">Amend</summary>
                <form action={amendQtyAction} className="mt-1 grid w-72 gap-1.5">
                  <input type="hidden" name="orderId" value={id} />
                  <input type="hidden" name="orderLineId" value={l.id} />
                  <Input name="newQty" type="number" min={l.deliveredQty} defaultValue={l.currentQty} aria-label="New quantity" />
                  <Input name="reason" required placeholder="Reason" aria-label="Reason" />
                  <Button small variant="secondary">
                    Apply
                  </Button>
                  <span className="text-ink-3">Keeps the place in the queue; refused once the line is on a confirmed shipment.</span>
                </form>
              </details>
            ) : null}
            {isAdmin
              ? reservations
                  .filter((r) => r.orderLineId === l.id)
                  .map((r) =>
                    r.displacedAt ? (
                      <form key={r.id} action={requeueReservationAction} className="flex gap-1">
                        <input type="hidden" name="orderId" value={id} />
                        <input type="hidden" name="reservationId" value={r.id} />
                        <Input name="reason" placeholder="Reason" className="w-32" aria-label="Reason" />
                        <Button small variant="secondary">
                          Re-queue
                        </Button>
                      </form>
                    ) : r.reservedQty > 0 && open && !activeRow ? (
                      <form key={r.id} action={releaseReservationAction} className="flex gap-1">
                        <input type="hidden" name="orderId" value={id} />
                        <input type="hidden" name="reservationId" value={r.id} />
                        <Input name="reason" required placeholder="Who is displaced and why" className="w-40" aria-label="Reason" />
                        <Button small variant="ghost">
                          Release
                        </Button>
                      </form>
                    ) : null,
                  )
              : null}
          </span>,
        ])}
      />
      <dl className="ml-auto mt-3 grid w-80 grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        <dt className="text-ink-2">Merchandise (current demand)</dt>
        <dd className="text-right tabular-nums">{o.order.noCharge ? "no charge" : formatCents(merchandise)}</dd>
        <dt className="text-ink-2">Kegs</dt>
        <dd className="text-right tabular-nums">{kegs}</dd>
        <dt className="text-ink-2">Remaining undelivered</dt>
        <dd className="text-right tabular-nums">{remaining}</dd>
        {minimumApplies && min ? (
          <>
            <dt className="text-ink-2">$90 rep minimum</dt>
            <dd className="text-right">
              <StatusBadge value={min.verdict} />
            </dd>
          </>
        ) : null}
      </dl>
      {!minimumApplies ? <p className="mt-1 text-right text-xs text-ink-3">The $90 minimum applies to rep orders only (R2-6).</p> : null}
      {o.order.noCharge ? <p className="mt-1 text-right text-xs text-ink-3">Samples: prices shown for reference only; the NC invoice carries no charge (R2-27).</p> : null}
    </>
  );

  const changesTab = o.changes.length ? (
    <ul className="divide-y divide-rule-soft text-sm">
      {o.changes.map((c) => (
        <li key={c.id} className="py-1.5">
          <span className="text-xs text-ink-3">{fmtDate(c.at, tz)}</span> {c.kind.replace(/_/g, " ")} {c.priorQty != null ? `${c.priorQty} to ${c.currentQty ?? "?"}` : ""}{" "}
          {c.proposedPriceCents != null && c.priorPriceCents !== c.proposedPriceCents ? (
            <span className="text-xs text-ink-2">
              price {formatCents(c.priorPriceCents)} to {formatCents(c.proposedPriceCents)}
            </span>
          ) : null}{" "}
          <StatusBadge value={c.policyStatus ?? "applied"} /> {c.reason ? <span className="text-ink-2">: {c.reason}</span> : null}
        </li>
      ))}
    </ul>
  ) : (
    <Empty>No changes.</Empty>
  );

  const noticesTab = showNotices ? (
    <>
      {o.notices.length === 0 ? <Empty>None.</Empty> : null}
      <ul className="divide-y divide-rule-soft text-sm">
        {o.notices.map((n) => (
          <li key={n.id} className="py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong className="font-semibold">{NOTICE_PURPOSE_LABEL[n.purpose] ?? n.purpose}</strong> v{n.version} to {n.recipientEmail ?? <span className="text-ink">no recipient email</span>}
              </span>
              <StatusBadge value={n.state} />
            </div>
            {n.outcomeNote ? <p className="text-xs text-ink-3">Outcome: {n.outcomeNote} ({n.sentVia}, {fmtDate(n.outcomeRecordedAt, tz)})</p> : null}
            {canNotice ? <NoticeActions noticeId={n.id} state={n.state} returnTo={`/orders/${id}`} recipientEmail={n.recipientEmail} /> : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-3">A person sends each notice and records the outcome (D32/IG04 unselected).</p>
    </>
  ) : null;

  const shipmentsTab = (
    <Table
      caption="Shipments for this order"
      head={["Number", "Type", "Scheduled", "Delivered", "Status", "Note"]}
      widths={[LIST_WIDTHS.number, LIST_WIDTHS.type, LIST_WIDTHS.date, LIST_WIDTHS.date, LIST_WIDTHS.status, undefined]}
      empty="No shipment yet."
      rows={o.shipments.map((s) => [
        <Link key="n" href={`/shipments/${s.id}`} className="font-display text-navy hover:underline">
          {s.status === "voided" ? <Struck>{shipmentNumber(s)}</Struck> : shipmentNumber(s)}
        </Link>,
        TYPE_LABEL[s.type],
        fmtDay(s.scheduledDate),
        fmtDay(s.actualDate),
        <StatusBadge key="s" value={s.status} />,
        s.status === "voided" ? s.voidReason : s.pickup ? "Will-call" : "",
      ])}
    />
  );

  const tabs = [
    { id: "lines", label: "Lines", count: o.lines.length, content: linesTab },
    { id: "shipments", label: "Shipments", count: o.shipments.length, content: shipmentsTab },
    { id: "changes", label: "Changes", count: o.changes.length, content: changesTab },
    ...(noticesTab ? [{ id: "notices", label: "Notices", count: o.notices.length, content: noticesTab }] : []),
    { id: "activity", label: "Activity", content: <TimelineCard result={timeline} basePath={`/orders/${id}`} kind={param(sp, "kind")} tz={tz} /> },
  ];

  return (
    <RecordPage
      number={o.order.orderNumber}
      status={<StatusBadge value={o.order.demandState} />}
      meta={
        <>
          <Link href={`/locations/${o.order.locationId}`} className="text-navy hover:underline">
            {o.location?.tradeName}
          </Link>
          <span className="text-ink-3">{o.market?.code}</span>
          <span>{ORDER_SOURCE_LABEL[o.order.source] ?? o.order.source}</span>
          <span className="text-ink-3">{fmtDate(o.order.submittedAt, tz)}</span>
          {o.order.noCharge ? <span>No charge (samples)</span> : null}
          {o.order.pickup ? <span>Will-call</span> : null}
          {o.order.poNumbers?.length ? <span>PO {o.order.poNumbers.join(", ")}</span> : null}
          {o.order.abnormalFlag ? <span className="text-ink">Flagged: {o.order.abnormalReason}</span> : null}
        </>
      }
      actions={
        <>
          {active && activeRow?.status === "draft" && canConfirm ? (
            <ActionPanel label="Confirm shipment" variant="primary">
              <form action={confirmOrderShipmentAction} className="space-y-2">
                <input type="hidden" name="orderId" value={id} />
                <input type="hidden" name="shipmentId" value={active.shipment.id} />
                <Field label="Scheduled date" hint="Numbers the shipment, allocates stock and stores the BOL and picking ticket (R2-3).">
                  <Input name="scheduledDate" type="date" required defaultValue={confirmDefault} />
                </Field>
                <Button small>Confirm</Button>
              </form>
            </ActionPanel>
          ) : null}
          {active && activeRow && activeRow.status !== "draft" && activeRow.status !== "voided" ? (
            <>
              <Button href={`/shipments/${active.shipment.id}/documents/bol`} variant="secondary">
                BOL PDF
              </Button>
              <Button href={`/shipments/${active.shipment.id}/documents/picking_ticket`} variant="secondary">
                Picking ticket
              </Button>
            </>
          ) : null}
          {o.order.demandState === "held" && canSubmit ? (
            <ActionPanel label="Lift hold" variant="primary">
              <form action={releaseHoldAction} className="space-y-2">
                <input type="hidden" name="orderId" value={id} />
                <Field label="Reason (required)" hint="Ships what is on hand now; the rest stays an open line.">
                  <Input name="reason" required />
                </Field>
                <Button small>Lift hold</Button>
              </form>
            </ActionPanel>
          ) : null}
          {open && o.order.demandState !== "held" && !activeRow && canManageShipment ? (
            <form action={createShipmentForOrderAction}>
              <input type="hidden" name="orderId" value={id} />
              <Button small variant="secondary">
                Create shipment
              </Button>
            </form>
          ) : null}
          {canSubmit && o.location?.status !== "closed" ? (
            <Button href={`/orders/new?locationId=${o.order.locationId}&repeat=${id}`} variant="secondary">
              Repeat
            </Button>
          ) : null}
          {can(actor, "order.flag_abnormal", { marketId: o.order.marketId }) && !o.order.abnormalFlag && open ? (
            <ActionPanel label="Flag" variant="secondary">
              <form action={flagAbnormalAction} className="space-y-2">
                <input type="hidden" name="orderId" value={id} />
                <Field label="Why? (flagged, not rejected)">
                  <Input name="reason" required />
                </Field>
                <Button small variant="secondary">
                  Flag
                </Button>
              </form>
            </ActionPanel>
          ) : null}
          {isAdmin && remaining > 0 && open ? (
            <ActionPanel label="Cancel" variant="danger">
              <form action={cancelOrderAction} className="space-y-2">
                <input type="hidden" name="orderId" value={id} />
                <Field label="Reason (required)" hint={activeRow && activeRow.status !== "draft" ? `Void ${activeRow.number} first; cancelling the order is a choice on the void.` : "Cancels the undelivered demand; a draft shipment goes with it."}>
                  <Input name="reason" required />
                </Field>
                <Button small variant="danger">
                  Cancel remaining
                </Button>
              </form>
            </ActionPanel>
          ) : null}
        </>
      }
    >
      <Flash {...flash} />
      {deadline && open ? (
        deadline.passed ? (
          <Notice tone="warn">
            The cutoff for {activeRow?.number ?? "this order"} has passed{deadline.time ? ` (${formatCutoff(deadline.time)} Pacific on ${fmtDay(deadline.date)})` : ""}. Changes now are exceptions and are logged; cancelling is still allowed.
          </Notice>
        ) : (
          <Notice tone="info">
            Changes to {activeRow?.number ?? "this order"} close {deadline.time ? `at ${formatCutoff(deadline.time)} Pacific ` : ""}on {fmtDay(deadline.date)}, the origin&apos;s cutoff. Cancelling is allowed any time.
          </Notice>
        )
      ) : null}
      <StateLine kind={status.kind}>{status.text}</StateLine>
      {openCases.length ? (
        <ul className="space-y-1 text-sm">
          {openCases.map((e) => (
            <li key={e.id}>
              <Link href={`/admin/exceptions/${e.id}`} className="text-navy hover:underline">
                {e.title}
              </Link>{" "}
              <span className="text-xs text-ink-3">
                {e.ownerRole ? `${e.ownerRole} acts next` : "unassigned"}
                {e.waitingParty ? `, waiting on ${e.waitingParty}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Columns>
        <Card title="Order">
          <KV
            items={[
              ["Account", <Link key="l" href={`/locations/${o.order.locationId}`} className="text-navy hover:underline">{o.location?.tradeName}</Link>],
              ["Source", ORDER_SOURCE_LABEL[o.order.source] ?? o.order.source],
              ["Requested date", o.order.requestedDate ? fmtDay(o.order.requestedDate) : "none"],
              ["Ships from", originLabel(warehouse)],
              ["PO numbers", o.order.poNumbers?.length ? o.order.poNumbers.join(", ") : "—"],
              ["Charge", o.order.noCharge ? "No charge (samples, NC invoice)" : "Posted prices"],
              ["Fulfilment", o.order.pickup ? "Will-call at the origin" : "Delivery"],
              ["Notes", o.order.notes ?? "—"],
              [
                "Shortfall decision",
                o.order.shortfallDecision ? (
                  <span key="sd">
                    {o.order.shortfallDecision === "hold" ? "Held" : "Shipped what was on hand"}
                    {o.order.shortfallReason ? `: ${o.order.shortfallReason}` : ""}
                    <span className="block text-xs text-ink-3">
                      {decidedBy ?? "—"}, {fmtDate(o.order.shortfallDecidedAt, tz)}
                    </span>
                  </span>
                ) : (
                  "none needed"
                ),
              ],
              ["Cancelled", o.order.cancelledAt ? `${fmtDate(o.order.cancelledAt, tz)}: ${o.order.cancelReason}` : "no"],
            ]}
          />
          {isAdmin && open && !activeRow ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-navy">Reassign this order to another origin</summary>
              <form action={reassignWarehouseAction} className="mt-2 space-y-2">
                <input type="hidden" name="orderId" value={id} />
                <Select name="warehouseId" required defaultValue="" aria-label="Origin">
                  <option value="" disabled>
                    Choose the origin
                  </option>
                  {warehouses
                    .filter((w) => w.id !== o.order.warehouseId)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {originLabel(w)}
                        {w.marketId !== o.order.marketId ? " (other market)" : ""}
                      </option>
                    ))}
                </Select>
                <Input name="reason" required placeholder="Reason" aria-label="Reason" />
                <Button small variant="secondary">
                  Reassign
                </Button>
                <p className="text-xs text-ink-3">Moves this order&apos;s reservations only; the account&apos;s default origin is set on the account page.</p>
              </form>
            </details>
          ) : null}
        </Card>
        <Card title="Shipment">
          {o.order.demandState === "held" ? (
            <Notice tone="warn" title="Held.">
              No shipment is drafted while the order is held. Lift the hold to ship what is on hand.
            </Notice>
          ) : active && activeRow ? (
            <>
              <KV
                items={[
                  [
                    "Number",
                    <Link key="n" href={`/shipments/${active.shipment.id}`} className="font-display text-navy hover:underline">
                      {shipmentNumber(active.shipment)}
                    </Link>,
                  ],
                  ["Status", <StatusBadge key="s" value={active.shipment.status} />],
                  ["Type", `${active.shipment.type} ${TYPE_LABEL[active.shipment.type]}${active.shipment.pickup ? ", will-call" : ""}`],
                  ["Scheduled", active.shipment.scheduledDate ? fmtDay(active.shipment.scheduledDate) : "set at confirmation"],
                  ["Delivered", active.shipment.actualDate ? fmtDay(active.shipment.actualDate) : "—"],
                  ["Origin", originLabel(active.origin)],
                ]}
              />
              <Table
                caption="Shipment lines"
                head={["Product", "Lot", "Qty", "Delivered"]}
                widths={[undefined, LIST_WIDTHS.number, LIST_WIDTHS.qty, LIST_WIDTHS.qty]}
                align={["left", "left", "right", "right"]}
                empty="No lines."
                rows={active.lines.map(({ line: l, sku, pos }) => [
                  l.skuId ? skuName.get(l.skuId) ?? (sku ? `${sku.brand} ${sku.name}` : "—") : pos?.name ?? "—",
                  l.lotCode ? <Code key="c">{l.lotCode}</Code> : <span key="c" className="text-ink-3">choose on the shipment</span>,
                  String(l.qty),
                  l.deliveredQty !== null ? String(l.deliveredQty) : "—",
                ])}
              />
              {activeRow.status === "draft" ? <p className="mt-2 text-xs text-ink-3">Lots were prefilled from what is on hand at the origin, oldest first; change them on the shipment before confirming.</p> : null}
            </>
          ) : (
            <Empty>{open ? "No shipment in play. Create one from what is reserved." : "No shipment."}</Empty>
          )}
          {o.visits.length ? <p className="mt-2 text-xs text-ink-3">Delivery attempts recorded: {o.visits.length}.</p> : null}
        </Card>
      </Columns>
      <Tabs tabs={tabs} />
      {!isAdmin && remaining > 0 && open ? <Notice tone="info">Cancellation authority by stage is an open Owner decision (D10): Sales records a change request; the office cancels undelivered demand.</Notice> : null}
    </RecordPage>
  );
}
