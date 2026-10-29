import Link from "next/link";
import { Badge, Button, Card, Flash, Page, StateLine, StatusBadge, fmtDate } from "@/components/ui";
import { queueScope } from "@/components/work-queue";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireActor } from "@/lib/auth/current";
import { ROLE_LABEL, actorRoles } from "@/lib/authz/actor";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { listLocations } from "@/lib/domain/customers/service";
import { listNotices } from "@/lib/domain/notices/service";
import { listOrders } from "@/lib/domain/orders/service";
import { listOpenExceptions } from "@/lib/exceptions/service";

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor();
  const flash = await flashFrom(searchParams);
  const roles = actorRoles(actor);
  const d = await getDb();
  const isField = roles.length === 1 && roles[0] === "driver_service";
  const orders = can(actor, "order.view") ? await listOrders(d, actor, { limit: 6 }) : [];
  const locations = can(actor, "location.view") && roles.includes("sales") ? await listLocations(d, actor, { limit: 8 }) : [];
  const myCases = can(actor, "exception.view") ? await listOpenExceptions(d, { marketIds: queueScope(actor), limit: 8 }) : [];
  const forMe = myCases.filter((e) => (e.ownerRole ? roles.includes(e.ownerRole) : can(actor, "exception.manage")));
  const notices = can(actor, "notice.record_outcome") ? await listNotices(d, actor, { states: ["manual_pending", "failed", "unknown"], limit: 5 }) : [];
  return (
    <Page
      title={`Hello, ${actor.displayName.split(" ")[0]}`}
      subtitle={roles.map((r) => ROLE_LABEL[r]).join(" · ")}
      actions={
        <>
          {can(actor, "location.create") ? <Button href="/locations/new">New account</Button> : null}
          {can(actor, "order.submit") ? (
            <Button href="/orders/new" variant="secondary">
              New order
            </Button>
          ) : null}
          {can(actor, "shipment.manage") ? (
            <Button href="/shipments/new" variant="secondary">
              New shipment
            </Button>
          ) : can(actor, "shipment.view") ? (
            <Button href="/shipments" variant="secondary">
              Shipments
            </Button>
          ) : null}
          {can(actor, "lot.view") && !isField ? (
            <Button href="/lots" variant="ghost">
              Lots
            </Button>
          ) : null}
        </>
      }
    >
      <Flash {...flash} />
      {isField ? (
        <Card title="Today">
          <StateLine kind="provider_unavailable">Nothing is assigned to you. Route assignment and field capture are not built in this revision (phase 2).</StateLine>
        </Card>
      ) : null}
      {forMe.length ? (
        <Card title="Needs your attention">
          <ul className="divide-y divide-line">
            {forMe.slice(0, 6).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <Link href={`/admin/exceptions/${e.id}`} className="block truncate text-sm hover:underline">
                    {e.title}
                  </Link>
                  {e.nextAction ? <span className="block truncate text-xs text-muted">Next: {e.nextAction}</span> : null}
                </span>
                <StatusBadge value={e.state} />
              </li>
            ))}
          </ul>
          {can(actor, "exception.manage") ? (
            <div className="mt-2 text-right">
              <Link href="/admin" className="text-sm text-accent hover:underline">
                Open the command center
              </Link>
            </div>
          ) : null}
        </Card>
      ) : null}
      {notices.length ? (
        <Card title="Notices to send (manual process)">
          <ul className="divide-y divide-line text-sm">
            {notices.map(({ n, loc }) => (
              <li key={n.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/admin/notices?focus=${n.id}`} className="hover:underline">
                  {n.purpose.replace(/_/g, " ")} · {loc?.tradeName ?? ""}
                </Link>
                <StatusBadge value={n.state} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {can(actor, "order.view") ? (
        <Card title="Recent orders">
          {orders.length === 0 ? (
            <p className="text-sm text-muted">No orders yet in your markets.</p>
          ) : (
            <ul className="divide-y divide-line">
              {orders.map(({ order, location }) => (
                <li key={order.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link href={`/orders/${order.id}`} className="block truncate text-sm font-medium hover:underline">
                      {order.orderNumber} · {location.tradeName}
                    </Link>
                    <span className="text-xs text-muted">
                      {order.source} · {fmtDate(order.submittedAt)}
                    </span>
                  </div>
                  <StatusBadge value={order.demandState} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      {locations.length ? (
        <Card title="My accounts">
          <ul className="divide-y divide-line">
            {locations.map(({ loc, market, address }) => (
              <li key={loc.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/locations/${loc.id}`} className="min-w-0 text-sm hover:underline">
                  {loc.tradeName}
                  <span className="block text-xs text-muted">{address ? `${address.line1}, ${address.city}` : ""}</span>
                </Link>
                <Badge>{market.code}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Page>
  );
}
