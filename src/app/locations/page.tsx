import Link from "next/link";
import { inArray } from "drizzle-orm";
import { Button, FilterBar, Input, Page, Select, StatusBadge, Table } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { listLocations } from "@/lib/domain/customers/service";
import { ACCOUNT_KIND_LABEL, PAY_BY_LABEL, type AccountKind, type PayBy } from "@/lib/domain/customers/shipping";
import { visibleMarkets } from "@/lib/domain/markets/service";

const PAGE = 50;

/**
 * Accounts (R2-31, R2-32): Active by default, Closed on request; hosts and warehouses are origins and never appear here;
 * served-by shows as a label and a filter. Samples recipients (the samples house, reps' home addresses) stay out of
 * the list and are reached from the order screen.
 */
export default async function LocationsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("location.view");
  const sp = await searchParams;
  const q = param(sp, "q");
  const marketId = param(sp, "market");
  const status = param(sp, "status") ?? "active";
  const servedBy = param(sp, "served");
  const page = Math.max(1, Number(param(sp, "page") ?? 1) || 1);
  const d = await getDb();
  const markets = await visibleMarkets(d, actor, ["owner", "admin", "accounting", "sales"]);
  const rows = await listLocations(d, actor, { q, marketId, status: status === "all" ? undefined : status, servedBy: servedBy === "direct" || servedBy === "distributor" ? servedBy : undefined, limit: PAGE + 1, offset: (page - 1) * PAGE, withAddress: true });
  const hasMore = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const servedIds = Array.from(new Set(shown.map((r) => r.loc.servedByLocationId).filter((x): x is string => Boolean(x))));
  const distributors = servedIds.length ? await d.select({ id: schema.customerLocation.id, tradeName: schema.customerLocation.tradeName }).from(schema.customerLocation).where(inArray(schema.customerLocation.id, servedIds)) : [];
  const distName = new Map(distributors.map((x) => [x.id, x.tradeName]));
  const link = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (marketId) u.set("market", marketId);
    u.set("status", status);
    if (servedBy) u.set("served", servedBy);
    u.set("page", String(p));
    return `/locations?${u.toString()}`;
  };
  return (
    <Page title="Accounts" actions={can(actor, "location.create") ? <Button href="/locations/new">New account</Button> : null}>
      <FilterBar role="search">
        <Input name="q" placeholder="Name, street or city" defaultValue={q ?? ""} aria-label="Search accounts" className="w-64" />
        <Select name="market" defaultValue={marketId ?? ""} aria-label="Market">
          <option value="">All markets</option>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.code} {m.name}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status} aria-label="Status">
          <option value="active">Active</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </Select>
        <Select name="served" defaultValue={servedBy ?? ""} aria-label="Served by">
          <option value="">Direct and distributor</option>
          <option value="direct">Served direct</option>
          <option value="distributor">Served by a distributor</option>
        </Select>
        <Button variant="secondary" small>
          Filter
        </Button>
      </FilterBar>
      <Table
        caption="Accounts"
        head={["Account", "City", "Market", "Kind", "Served by", "Pays by", "Status"]}
        widths={[undefined, "10rem", "5rem", "7rem", "12rem", "6rem", LIST_WIDTHS.status]}
        empty="No accounts match."
        rows={shown.map(({ loc, market, address }) => [
          <Link key="n" href={`/locations/${loc.id}`} className="text-navy hover:underline">
            {loc.tradeName}
            {address ? <span className="block text-xs text-ink-3">{address.line1}</span> : <span className="block text-xs text-ink-3">no delivery address</span>}
          </Link>,
          address?.city ?? "—",
          market.code,
          ACCOUNT_KIND_LABEL[loc.kind as AccountKind] ?? loc.kind,
          loc.servedByLocationId ? (
            <Link key="s" href={`/locations/${loc.servedByLocationId}`} className="hover:text-navy">
              {distName.get(loc.servedByLocationId) ?? "Distributor"}
            </Link>
          ) : (
            <span key="s" className="text-ink-3">
              Direct
            </span>
          ),
          loc.payBy ? PAY_BY_LABEL[loc.payBy as PayBy] ?? loc.payBy : "—",
          <StatusBadge key="st" value={loc.status} />,
        ])}
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
