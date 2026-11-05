import Link from "next/link";
import { WarehouseStockTable } from "@/components/stock";
import { Button, Card, Code, Empty, FilterBar, Page, Select, Table, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { marketScopeFor, type Role } from "@/lib/authz/actor";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { isEmptyStock, stockByLocation, stockGrid, type StockFigures } from "@/lib/domain/allocation/onhand";
import { skuLabel } from "@/lib/domain/catalog/label";
import { listSkus } from "@/lib/domain/catalog/service";
import { BRAND_CODES, recentLots } from "@/lib/domain/lots/service";
import { listWarehouses, visibleMarkets } from "@/lib/domain/markets/service";
import { originLabel } from "@/lib/domain/origins/service";

/** Who reads stock here: the office and Sales, as on Lots (lot.view). */
const STOCK_ROLES: Role[] = ["owner", "admin", "accounting", "sales"];
const KIND_ORDER: Record<string, number> = { brewery: 0, warehouse: 1, cold_storage: 2 };
const KIND_LABEL: Record<string, string> = { brewery: "brewery", warehouse: "warehouse", cold_storage: "cold storage" };

const th = "sticky top-0 z-[1] border-b border-rule bg-ground px-2 py-[5px] align-bottom font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2";

/** Available in bold; under it, smaller, the figures that differ from it (on hand, reserved, short, in transit, unavailable). */
function StockCell({ f }: { f: StockFigures | null }) {
  if (!f) return null;
  const notes: string[] = [];
  if (f.onHandQty !== f.availableQty) notes.push(`${f.onHandQty} on hand`);
  if (f.reservedQty) notes.push(`${f.reservedQty} reserved`);
  if (f.deficitQty) notes.push(`${f.deficitQty} short`);
  if (f.inTransitQty) notes.push(`${f.inTransitQty} in transit`);
  if (f.unavailableQty) notes.push(`${f.unavailableQty} unavailable`);
  return (
    <span className="block text-right tabular-nums">
      <strong className="font-semibold text-ink">{f.availableQty}</strong>
      {notes.length ? <span className="block whitespace-nowrap text-[11px] leading-4 text-ink-3">{notes.join(", ")}</span> : null}
    </span>
  );
}

/**
 * Stock on hand: every location with a stock position across the top, SKUs down the side, available in each cell.
 * The figures come from the same computation as Markets & stock (warehouseAvailability). ?location= shows one
 * location's full table; ?market= narrows the locations; ?skus=all lists SKUs with no stock anywhere too.
 */
export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("lot.view");
  const sp = await searchParams;
  const marketId = param(sp, "market");
  const allSkus = param(sp, "skus") === "all";
  const locationId = param(sp, "location");
  const d = await getDb();
  const [markets, warehouses, skus] = await Promise.all([visibleMarkets(d, actor, STOCK_ROLES), listWarehouses(d), listSkus(d)]);
  const marketIds = new Set(markets.map((m) => m.id));
  const seesAll = marketScopeFor(actor, STOCK_ROLES) === "all" || actor.grants.some((g) => g.role === "owner");
  // Origins without a market (Prost, Round Table, Real Ale) show to people who see every market.
  const visible = warehouses.filter((w) => (w.marketId ? marketIds.has(w.marketId) : seesAll));
  const inScope = (marketId ? visible.filter((w) => w.marketId === marketId) : visible).sort(
    (a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || originLabel(a).localeCompare(originLabel(b)),
  );
  const marketCode = new Map(markets.map((m) => [m.id, m.code]));
  const skuById = new Map(skus.map((s) => [s.id, s]));
  const skuName = (id: string) => {
    const s = skuById.get(id);
    return s ? `${skuLabel(s)} (${s.code})` : id;
  };
  const brandName = new Map(BRAND_CODES.map((b) => [b.code, b.name]));
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ market: marketId, skus: allSkus ? "all" : undefined, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/stock?${s}` : "/stock";
  };
  const placeLabel = (w: (typeof warehouses)[number]) => [w.marketId ? marketCode.get(w.marketId) : "no market", KIND_LABEL[w.kind] ?? w.kind, w.active ? null : "inactive"].filter(Boolean).join(", ");
  const actions = (
    <>
      <Button href="/lots" variant="secondary" small>
        Lots
      </Button>
      {can(actor, "stock.record") ? (
        <Button href="/admin/markets" variant="secondary" small>
          Markets &amp; stock
        </Button>
      ) : null}
    </>
  );

  // One location: the same table as its card on Markets & stock, and the lots packaged there.
  const detail = locationId ? visible.find((w) => w.id === locationId) : undefined;
  if (detail) {
    const [located] = await stockByLocation(d, [detail]);
    const lots = detail.kind === "brewery" ? await recentLots(d, { facilityWarehouseIds: [detail.id], limit: 10 }) : [];
    return (
      <Page title="Stock on hand" subtitle={`${originLabel(detail)}, ${placeLabel(detail)}. Available is on hand less what open orders and confirmed shipments hold; in transit becomes available once received.`} actions={actions}>
        <p className="text-sm">
          <Link href={qs({})} className="text-navy hover:underline">
            All locations
          </Link>
          {can(actor, "stock.record") ? (
            <>
              <span className="text-ink-3"> · </span>
              <Link href={`/admin/markets#stock-${detail.id}`} className="text-navy hover:underline">
                Record stock evidence or a transfer
              </Link>
            </>
          ) : null}
        </p>
        <Card title={`Stock: ${originLabel(detail)}${detail.marketId ? ` (${marketCode.get(detail.marketId) ?? ""})` : ""}`}>
          {located ? <WarehouseStockTable rows={located.rows} skuName={skuName} /> : <Empty>No stock recorded here yet.</Empty>}
        </Card>
        {detail.kind === "brewery" ? <RecentLots lots={lots} originName={() => originLabel(detail)} brandName={brandName} title="Recent lots packaged here" /> : null}
      </Page>
    );
  }

  const located = await stockByLocation(d, inScope);
  // An inactive origin earns a column only while it still holds something.
  const locations = located.filter((l) => l.warehouse.active || l.rows.some((r) => !isEmptyStock(r)));
  const heldSomewhere = new Set(locations.flatMap((l) => l.rows.filter((r) => !isEmptyStock(r)).map((r) => r.skuId)));
  const skuRows = skus.filter((s) => !s.archivedAt || heldSomewhere.has(s.id));
  const grid = stockGrid(skuRows, locations);
  const rows = allSkus ? grid : grid.filter((r) => r.total);
  const lots = await recentLots(d, { facilityWarehouseIds: inScope.map((w) => w.id), limit: 10 });
  const originById = new Map(warehouses.map((w) => [w.id, w]));

  return (
    <Page title="Stock on hand" subtitle="Available to sell at each location: on hand less what open orders and confirmed shipments hold. Units in transit count once received. Open a location for its full table." actions={actions}>
      <FilterBar>
        <Select name="market" defaultValue={marketId ?? ""} aria-label="Market">
          <option value="">All markets</option>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Select name="skus" defaultValue={allSkus ? "all" : ""} aria-label="Which SKUs">
          <option value="">Only SKUs with stock</option>
          <option value="all">Every active SKU</option>
        </Select>
        <Button variant="secondary" small>
          Filter
        </Button>
        <span className="ml-auto text-xs text-ink-3">
          {locations.length} location{locations.length === 1 ? "" : "s"}, {rows.length} SKU{rows.length === 1 ? "" : "s"}
        </span>
      </FilterBar>

      {locations.length === 0 ? (
        <Empty>No stock recorded at any location{marketId ? " in this market" : ""} yet.</Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full border-collapse text-[13px] leading-5">
            <caption className="sr-only">Stock on hand by SKU and location</caption>
            <thead>
              <tr>
                <th scope="col" className={`${th} sticky left-0 z-[2] min-w-[10rem] pl-0 text-left`}>
                  SKU
                </th>
                {locations.map(({ warehouse: w }) => (
                  <th key={w.id} scope="col" className={`${th} min-w-[7.5rem] text-right`}>
                    <Link href={qs({ location: w.id })} className="text-navy hover:underline">
                      {originLabel(w)}
                    </Link>
                    <span className="block font-sans text-[10.5px] font-normal normal-case tracking-normal text-ink-3">{placeLabel(w)}</span>
                  </th>
                ))}
                <th scope="col" className={`${th} min-w-[6rem] pr-0 text-right`}>
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={locations.length + 2} className="py-5 text-ink-2">
                    No SKU has stock at these locations.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.sku.id} className="border-b border-rule-soft align-top hover:bg-hover">
                    <th scope="row" className="sticky left-0 bg-ground py-[5px] pr-2 text-left font-normal">
                      <span className="block">
                        {skuLabel(r.sku)}
                        {r.sku.archivedAt ? <span className="text-ink-3"> (archived)</span> : null}
                      </span>
                      <Code className="text-ink-3">{r.sku.code}</Code>
                    </th>
                    {r.cells.map((c, i) => (
                      <td key={locations[i].warehouse.id} className="px-2 py-[5px]">
                        <StockCell f={c} />
                      </td>
                    ))}
                    <td className="py-[5px] pl-2">
                      <StockCell f={r.total} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <RecentLots lots={lots} originName={(id) => originLabel(originById.get(id))} brandName={brandName} title="Recent lots" />
    </Page>
  );
}

function RecentLots({ lots, originName, brandName, title }: { lots: Awaited<ReturnType<typeof recentLots>>; originName: (warehouseId: string) => string; brandName: Map<string, string>; title: string }) {
  return (
    <Card title={title}>
      <Table
        caption={title}
        head={["Lot", "Brewery", "Brand", "Packaged", "Quantities packaged"]}
        widths={[LIST_WIDTHS.code, "13rem", "11rem", LIST_WIDTHS.date, undefined]}
        empty="No lots packaged yet."
        rows={lots.map(({ lot, quantities }) => [
          <Link key="l" href={`/lots/${lot.id}`} className="text-navy hover:underline">
            <Code>{lot.lotCode}</Code>
          </Link>,
          originName(lot.facilityWarehouseId),
          `${lot.brandCode} ${brandName.get(lot.brandCode) ?? ""}`.trim(),
          <span key="d" className="whitespace-nowrap">
            {fmtDay(lot.packagingDate)}
          </span>,
          !lot.quantitiesKnown ? (
            <span key="q" className="text-ink-3">
              not yet known
            </span>
          ) : quantities.length ? (
            <span key="q" className="tabular-nums">
              {quantities.map((q, i) => (
                <span key={q.skuId} className="whitespace-nowrap">
                  {i ? ", " : ""}
                  <Code>{q.code}</Code> {q.qty}
                </span>
              ))}
            </span>
          ) : (
            "—"
          ),
        ])}
      />
    </Card>
  );
}
