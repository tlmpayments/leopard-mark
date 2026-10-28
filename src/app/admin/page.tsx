import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, Flash, Page, StatusBadge, fmtDate } from "@/components/ui";
import { WorkQueue } from "@/components/work-queue";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireActor } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { commandCenter } from "@/lib/domain/commandcenter/service";

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireActor();
  if (!can(actor, "exception.manage") && !can(actor, "allocation.resolve")) redirect("/forbidden?action=exception.manage");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const cc = await commandCenter(d, actor);
  const tiles: Array<[string, number, string]> = [
    ["Open cases", cc.openCases, "/admin"],
    ["Waiting on someone", cc.waitingCases, "/admin?state=waiting_only"],
    ["Review date reached", cc.dueCases, "/admin?state=due"],
    ["Notices to send", cc.aging.noticesPending, "/admin/notices"],
    ["Units waiting for stock", cc.aging.unmetUnits, "/admin?category=allocation_shortage"],
    ["Open orders", cc.aging.openOrders, "/orders?state=open"],
    ["Provider work waiting", cc.aging.providerHandoffsPending, "/integrations"],
  ];
  return (
    <Page
      title="Command center"
      subtitle="Routine work and exceptions over the same records. Resolve the cause and every dependent view follows; nothing here needs a second acknowledgement."
      actions={
        <>
          <Button href="/admin/intake" variant="secondary">
            Email intake
          </Button>
          <Button href="/admin/notices" variant="secondary">
            Notices
          </Button>
        </>
      }
    >
      <Flash {...flash} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([label, n, href]) => (
          <Link key={label} href={href} className="rounded-xl border border-line bg-card p-3 hover:bg-background">
            <div className="text-2xl font-semibold">{n}</div>
            <div className="text-xs text-muted">{label}</div>
          </Link>
        ))}
      </div>
      <WorkQueue db={d} actor={actor} basePath="/admin" params={{ category: param(sp, "category"), owner: param(sp, "owner"), state: param(sp, "state"), market: param(sp, "market") }} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Active holds">
          {cc.holds.length === 0 ? <p className="text-sm text-muted">No active holds.</p> : null}
          <ul className="divide-y divide-line text-sm">
            {cc.holds.map(({ h, loc }) => (
              <li key={h.id} className="flex items-center justify-between py-1.5">
                <Link href={`/locations/${loc.id}`} className="hover:underline">
                  {loc.tradeName} — {h.cause}
                </Link>
                <Badge tone="danger">{h.kind.replace("_", " ")}</Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Recent orders">
          <ul className="divide-y divide-line text-sm">
            {cc.recentOrders.map(({ o, loc }) => (
              <li key={o.id} className="flex items-center justify-between py-1.5">
                <Link href={`/orders/${o.id}`} className="hover:underline">
                  {o.orderNumber} · {loc.tradeName} <span className="text-xs text-muted">{fmtDate(o.submittedAt)}</span>
                </Link>
                <StatusBadge value={o.demandState} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Not yet built (later phases)">
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {cc.notBuilt.map((n) => (
            <li key={n.label} className="flex items-center justify-between rounded-lg border border-dashed border-line px-2 py-1">
              <span>{n.label}</span>
              <Badge>phase {n.phase}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">Shown as not built rather than as zero, so absence of a number is never mistaken for a clean state.</p>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button href="/admin/markets" variant="secondary">
          Markets, warehouses & stock
        </Button>
        <Button href="/admin/catalog" variant="secondary">
          Catalog & prices
        </Button>
        <Button href="/admin/employees" variant="secondary">
          Employees & access
        </Button>
        <Button href="/integrations" variant="secondary">
          Integrations ({cc.jobs.waiting} waiting, {cc.jobs.queued} queued jobs)
        </Button>
      </div>
    </Page>
  );
}
