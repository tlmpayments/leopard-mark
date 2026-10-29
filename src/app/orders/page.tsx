import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { Button, FilterBar, Page, Select, StatusBadge, Struck, Table, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { visibleMarkets } from "@/lib/domain/markets/service";
import { ORDER_SOURCE_LABEL, listOrders } from "@/lib/domain/orders/service";
import { shipmentNumber } from "../shipments/labels";

const PAGE = 50;

/** Orders: the office's ledger of demand, each with the shipment it became (R2-1). Default view is what is still open. */
export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("order.view");
  const sp = await searchParams;
  const state = param(sp, "state") ?? "open";
  const marketId = param(sp, "market");
  const locationId = param(sp, "locationId");
  const page = Math.max(1, Number(param(sp, "page") ?? 1) || 1);
  const d = await getDb();
  const markets = await visibleMarkets(d, actor, ["owner", "admin", "accounting", "sales"]);
  const rows = await listOrders(d, actor, { state: state === "all" ? undefined : state, marketId, locationId, limit: PAGE + 1, offset: (page - 1) * PAGE });
  const hasMore = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const shipments = shown.length
    ? await d
        .select({ orderId: schema.shipmentOrder.orderId, s: schema.shipment })
        .from(schema.shipmentOrder)
        .innerJoin(schema.shipment, eq(schema.shipment.id, schema.shipmentOrder.shipmentId))
        .where(inArray(schema.shipmentOrder.orderId, shown.map((r) => r.order.id)))
    : [];
  const activeFor = new Map<string, typeof schema.shipment.$inferSelect>();
  for (const r of shipments) if (r.s.status !== "voided" && !activeFor.has(r.orderId)) activeFor.set(r.orderId, r.s);
  const marketCode = new Map(markets.map((m) => [m.id, m.code]));
  const link = (p: number) => {
    const u = new URLSearchParams();
    u.set("state", state);
    if (marketId) u.set("market", marketId);
    if (locationId) u.set("locationId", locationId);
    u.set("page", String(p));
    return `/orders?${u.toString()}`;
  };
  return (
    <Page title="Orders" actions={can(actor, "order.submit") ? <Button href="/orders/new">New order</Button> : null}>
      <FilterBar role="search">
        {locationId ? <input type="hidden" name="locationId" value={locationId} /> : null}
        <Select name="state" defaultValue={state} aria-label="State">
          <option value="open">Open</option>
          <option value="held">Held</option>
          <option value="fulfilled">Delivered</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All</option>
        </Select>
        <Select name="market" defaultValue={marketId ?? ""} aria-label="Market">
          <option value="">All markets</option>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code} {m.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary" small>
          Filter
        </Button>
      </FilterBar>
      <Table
        caption="Orders"
        head={["Order", "Account", "Market", "Source", "Requested", "Shipment", "Scheduled", "Status"]}
        widths={[LIST_WIDTHS.number, undefined, "5rem", "8rem", LIST_WIDTHS.date, LIST_WIDTHS.number, LIST_WIDTHS.date, LIST_WIDTHS.status]}
        empty="No orders match in your markets."
        rows={shown.map(({ order, location }) => {
          const s = activeFor.get(order.id);
          return [
            <Link key="n" href={`/orders/${order.id}`} className="font-display text-navy hover:underline">
              {order.demandState === "cancelled" ? <Struck>{order.orderNumber}</Struck> : order.orderNumber}
            </Link>,
            <span key="a">
              {location.tradeName}
              {order.noCharge ? <span className="ml-1.5 text-xs text-ink-3">samples</span> : null}
              {order.pickup ? <span className="ml-1.5 text-xs text-ink-3">will-call</span> : null}
              {order.abnormalFlag ? <span className="ml-1.5 text-xs text-ink">flagged</span> : null}
            </span>,
            marketCode.get(order.marketId) ?? "",
            ORDER_SOURCE_LABEL[order.source] ?? order.source,
            fmtDay(order.requestedDate),
            s ? (
              <Link key="s" href={`/shipments/${s.id}`} className="font-display text-navy hover:underline">
                {shipmentNumber(s)}
              </Link>
            ) : (
              <span key="s" className="text-ink-3">
                {order.demandState === "held" ? "held" : "—"}
              </span>
            ),
            s?.scheduledDate ? fmtDay(s.scheduledDate) : "—",
            <StatusBadge key="st" value={order.demandState} />,
          ];
        })}
      />
      {(page > 1 || hasMore) && (
        <nav className="flex justify-between text-sm" aria-label="Pagination">
          {page > 1 ? (
            <Link href={link(page - 1)} className="text-navy hover:underline">
              Previous
            </Link>
          ) : (
            <span />
          )}
          {hasMore ? (
            <Link href={link(page + 1)} className="text-navy hover:underline">
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </Page>
  );
}
