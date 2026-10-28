import Link from "next/link";
import { Badge, Button, Card, Input, Page, Select, StatusBadge } from "@/components/ui";
import { param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { listLocations } from "@/lib/domain/customers/service";
import { visibleMarkets } from "@/lib/domain/markets/service";

const PAGE = 50;

export default async function LocationsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("location.view");
  const sp = await searchParams;
  const q = param(sp, "q");
  const marketId = param(sp, "market");
  const status = param(sp, "status");
  const page = Math.max(1, Number(param(sp, "page") ?? 1) || 1);
  const d = await getDb();
  const markets = await visibleMarkets(d, actor, ["owner", "admin", "accounting", "sales"]);
  const rows = await listLocations(d, actor, { q, marketId, status, limit: PAGE + 1, offset: (page - 1) * PAGE, withAddress: true });
  const hasMore = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const link = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (marketId) u.set("market", marketId);
    if (status) u.set("status", status);
    u.set("page", String(p));
    return `/locations?${u.toString()}`;
  };
  return (
    <Page title="Accounts" subtitle="Each licensed location is separate: its own history, invoices, credits, kegs and payment authority." actions={can(actor, "location.create") ? <Button href="/locations/new">New account</Button> : null}>
      <form className="grid gap-2 sm:grid-cols-4" role="search">
        <Input name="q" placeholder="Name, street or city" defaultValue={q ?? ""} aria-label="Search accounts" className="sm:col-span-2" />
        <Select name="market" defaultValue={marketId ?? ""} aria-label="Market">
          <option value="">All markets</option>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Select name="status" defaultValue={status ?? ""} aria-label="Status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="closed">Closed</option>
          </Select>
          <Button variant="secondary">Filter</Button>
        </div>
      </form>
      <Card>
        {shown.length === 0 ? (
          <p className="text-sm text-muted">No accounts match.</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map(({ loc, market, address }) => (
              <li key={loc.id}>
                <Link href={`/locations/${loc.id}`} className="flex min-h-12 items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{loc.tradeName}</span>
                    <span className="block text-xs text-muted">{address ? `${address.line1}, ${address.city}` : "no address"}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <Badge>{market.code}</Badge>
                    <StatusBadge value={loc.status} />
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
