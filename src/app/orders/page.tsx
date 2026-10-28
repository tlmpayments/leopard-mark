import Link from "next/link";
import { Badge, Button, Card, Page, Select, StatusBadge, fmtDate } from "@/components/ui";
import { param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { visibleMarkets } from "@/lib/domain/markets/service";
import { listOrders } from "@/lib/domain/orders/service";

const PAGE = 50;

export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("order.view");
  const sp = await searchParams;
  const state = param(sp, "state");
  const marketId = param(sp, "market");
  const locationId = param(sp, "locationId");
  const page = Math.max(1, Number(param(sp, "page") ?? 1) || 1);
  const d = await getDb();
  const markets = await visibleMarkets(d, actor, ["owner", "admin", "accounting", "sales"]);
  const rows = await listOrders(d, actor, { state, marketId, locationId, limit: PAGE + 1, offset: (page - 1) * PAGE });
  const hasMore = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const tzFor = (id: string) => markets.find((m) => m.id === id)?.timezone ?? "America/Los_Angeles";
  const link = (p: number) => {
    const u = new URLSearchParams();
    if (state) u.set("state", state);
    if (marketId) u.set("market", marketId);
    if (locationId) u.set("locationId", locationId);
    u.set("page", String(p));
    return `/orders?${u.toString()}`;
  };
  return (
    <Page title="Orders" subtitle="The order is the master reference across operations, documents, money, kegs, service and audit." actions={can(actor, "order.submit") ? <Button href="/orders/new">New order</Button> : null}>
      <form className="flex flex-wrap gap-2" role="search">
        {locationId ? <input type="hidden" name="locationId" value={locationId} /> : null}
        <Select name="state" defaultValue={state ?? ""} aria-label="State" className="max-w-[12rem]">
          <option value="">All orders</option>
          <option value="open">Open (undelivered)</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Select name="market" defaultValue={marketId ?? ""} aria-label="Market" className="max-w-[14rem]">
          <option value="">All markets</option>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary">Filter</Button>
      </form>
      <Card>
        {shown.length === 0 ? (
          <p className="text-sm text-muted">No orders match in your markets.</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map(({ order, location }) => (
              <li key={order.id}>
                <Link href={`/orders/${order.id}`} className="flex min-h-12 items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {order.orderNumber} · {location.tradeName}
                    </span>
                    <span className="text-xs text-muted">
                      {order.source} · {fmtDate(order.submittedAt, tzFor(order.marketId))}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    {order.abnormalFlag ? <Badge tone="warn">flagged</Badge> : null}
                    <StatusBadge value={order.demandState} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {(page > 1 || hasMore) && (
          <nav className="mt-3 flex justify-between text-sm" aria-label="Pagination">
            {page > 1 ? <Link href={link(page - 1)} className="text-accent hover:underline">← Previous</Link> : <span />}
            {hasMore ? <Link href={link(page + 1)} className="text-accent hover:underline">Next →</Link> : <span />}
          </nav>
        )}
      </Card>
    </Page>
  );
}
