import Link from "next/link";
import { Card, Flash, Page, StatusBadge, fmtDate } from "@/components/ui";
import { WorkQueue } from "@/components/work-queue";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { commandCenter } from "@/lib/domain/commandcenter/service";

/**
 * Exceptions (R2-36): the former Command center folded in. The counts across the top, then the work queue, then the
 * holds and recent orders the back office keeps an eye on. Resolve the cause and every dependent view follows.
 */
export default async function ExceptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("exception.view");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const manages = can(actor, "exception.manage") || can(actor, "allocation.resolve");
  const cc = manages ? await commandCenter(d, actor) : null;
  const tiles: Array<[string, number, string]> = cc
    ? [
        ["Open cases", cc.openCases, "/admin/exceptions"],
        ["Waiting on someone", cc.waitingCases, "/admin/exceptions?state=waiting_only"],
        ["Review date reached", cc.dueCases, "/admin/exceptions?state=due"],
        ["Notices to send", cc.aging.noticesPending, "/admin/notices"],
        ["Units waiting for stock", cc.aging.unmetUnits, "/admin/exceptions?category=allocation_shortage"],
        ["Open orders", cc.aging.openOrders, "/orders?state=open"],
        ["Provider work waiting", cc.aging.providerHandoffsPending, "/integrations"],
      ]
    : [];
  return (
    <Page title="Exceptions">
      <Flash {...flash} />
      {cc ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-rule pb-4 sm:grid-cols-4 lg:grid-cols-7">
          {tiles.map(([label, n, href]) => (
            <div key={label}>
              <dt className="font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2">{label}</dt>
              <dd>
                <Link href={href} className="font-display text-2xl font-bold tabular-nums text-navy hover:underline">
                  {n}
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <WorkQueue db={d} actor={actor} basePath="/admin/exceptions" title="Open cases" params={{ category: param(sp, "category"), owner: param(sp, "owner"), state: param(sp, "state"), market: param(sp, "market"), locationId: param(sp, "locationId") }} />
      {cc ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <Card title="Active holds">
            {cc.holds.length === 0 ? <p className="text-sm text-ink-2">No active holds.</p> : null}
            <ul className="divide-y divide-rule-soft text-sm">
              {cc.holds.map(({ h, loc }) => (
                <li key={h.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/locations/${loc.id}`} className="hover:text-navy">
                    {loc.tradeName}: {h.cause}
                  </Link>
                  <span className="text-xs text-ink-2">{h.kind.replace("_", " ")}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Recent orders">
            <ul className="divide-y divide-rule-soft text-sm">
              {cc.recentOrders.map(({ o, loc }) => (
                <li key={o.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`/orders/${o.id}`} className="hover:text-navy">
                    <span className="font-display">{o.orderNumber}</span> {loc.tradeName} <span className="text-xs text-ink-3">{fmtDate(o.submittedAt)}</span>
                  </Link>
                  <StatusBadge value={o.demandState} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}
      {cc ? (
        <p className="text-xs text-ink-3">
          Not yet built: {cc.notBuilt.map((n) => `${n.label} (phase ${n.phase})`).join("; ")}. Shown as not built rather than as zero, so an absent number is never mistaken for a clean state. Jobs: {cc.jobs.waiting} waiting, {cc.jobs.queued} queued (Integrations).
        </p>
      ) : null}
    </Page>
  );
}
