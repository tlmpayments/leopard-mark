import { Badge, Button, Card, Field, Flash, Input, Notice, Page, Select, StatusBadge, Table, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { warehouseAvailability } from "@/lib/domain/allocation/service";
import { listSkus } from "@/lib/domain/catalog/service";
import { listWarehouses, visibleMarkets } from "@/lib/domain/markets/service";
import { confirmSellerAction, createMarketAction, createWarehouseAction, stockMovementAction, transferDepartureAction, transferReceiptAction } from "../actions";

export default async function MarketsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("stock.record");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const markets = await visibleMarkets(d, actor, ["owner", "admin"]);
  const marketIds = new Set(markets.map((m) => m.id));
  const [allWarehouses, skus] = await Promise.all([listWarehouses(d), listSkus(d)]);
  const warehouses = allWarehouses.filter((w) => (w.marketId ? marketIds.has(w.marketId) : actor.grants.some((g) => g.role === "owner")));
  const stock = await Promise.all(warehouses.map(async (w) => ({ w, rows: await warehouseAvailability(d, w.id) })));
  const skuName = (id: string) => {
    const s = skus.find((x) => x.id === id);
    return s ? `${s.brand} ${s.name}` : id;
  };
  return (
    <Page title="Markets, warehouses & stock" subtitle="Markets scope catalog/prices, warehouses, numbering and allocation. Global defaults (Net-30, $35 keg deposit, $90 minimum, no Sales price override) are not market-configurable.">
      <Flash {...flash} />
      <Card title="Markets">
        <Table
          head={["Code", "Name", "Timezone", "Next order #", "Seller context (D33)", ""]}
          rows={markets.map((m) => [
            m.code,
            m.name,
            m.timezone,
            `${m.code}-${String(m.orderSeq).padStart(6, "0")}`,
            <StatusBadge key="s" value={m.sellerContextStatus} />,
            m.sellerContextStatus !== "confirmed" && can(actor, "decision.select_production") ? (
              <form key="f" action={confirmSellerAction} className="flex gap-1">
                <input type="hidden" name="marketId" value={m.id} />
                <Input name="note" required placeholder="Seller entity / note" />
                <Button small variant="secondary">Confirm (Owner)</Button>
              </form>
            ) : (
              <span key="n" className="text-xs text-muted">{m.sellerContextNote ?? "Owner confirms before financial activation"}</span>
            ),
          ])}
        />
        {can(actor, "market.manage") ? (
          <form action={createMarketAction} className="mt-3 grid gap-2 sm:grid-cols-4">
            <Input name="code" required placeholder="Code (e.g. LA)" maxLength={6} />
            <Input name="name" required placeholder="Name" />
            <Input name="timezone" placeholder="America/Los_Angeles" />
            <Button small variant="secondary">Add market</Button>
          </form>
        ) : null}
      </Card>
      <Card title="Warehouses">
        <Table
          head={["Market", "Name", "Primary", "Fulfillment contact"]}
          rows={warehouses.map((w) => [markets.find((m) => m.id === w.marketId)?.code ?? "", w.name, w.isPrimary ? <Badge key="p" tone="good">primary</Badge> : "", w.fulfillmentContact ?? "—"])}
        />
        {can(actor, "warehouse.manage") ? (
          <form action={createWarehouseAction} className="mt-3 grid gap-2 sm:grid-cols-5">
            <Select name="marketId" required defaultValue="">
              <option value="" disabled>
                Market…
              </option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code}
                </option>
              ))}
            </Select>
            <Input name="name" required placeholder="Name (e.g. host brewery)" />
            <Input name="fulfillmentContact" placeholder="Fulfillment contact" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isPrimary" /> Primary for market
            </label>
            <Button small variant="secondary">Add warehouse</Button>
          </form>
        ) : null}
        <p className="mt-1 text-xs text-muted">One primary warehouse per market is a permitted starting structure; multiple warehouses are already contemplated (O19).</p>
      </Card>
      {stock.map(({ w, rows }) => (
        <Card key={w.id} title={`Stock — ${w.name} (${markets.find((m) => m.id === w.marketId)?.code})`}>
          <Table
            head={["SKU", "On hand", "Reserved", "Available", "Shortfall", "Unavailable", "In transit", "Evidence"]}
            rows={rows.map((r) => [
              skuName(r.skuId),
              String(r.onHandQty),
              String(r.reservedQty),
              <strong key="a">{r.availableQty}</strong>,
              r.deficitQty > 0 ? <Badge key="d" tone="danger">{r.deficitQty} reserved but not on hand</Badge> : "—",
              String(r.unavailableQty),
              String(r.inTransitQty),
              <span key="e" className="text-xs text-muted">{r.evidenceSource ?? "—"} {r.evidenceAt ? `· ${fmtDate(r.evidenceAt)}` : ""}</span>,
            ])}
          />
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-accent">Record stock evidence</summary>
            <form action={stockMovementAction} className="mt-2 grid gap-2 sm:grid-cols-5">
              <input type="hidden" name="warehouseId" value={w.id} />
              <Select name="skuId" required defaultValue="">
                <option value="" disabled>
                  SKU…
                </option>
                {skus.filter((s) => !s.archivedAt).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.brand} {s.name}
                  </option>
                ))}
              </Select>
              <Select name="kind" defaultValue="receipt" aria-label="Movement kind">
                <option value="opening">Opening count — units counted (adds)</option>
                <option value="receipt">Receipt — units received (adds)</option>
                <option value="adjustment">Physical adjustment — signed (+ found / − missing)</option>
                <option value="damage">Damage — units damaged (removes from sellable)</option>
              </Select>
              <Field label="" htmlFor={`qty-${w.id}`}>
                <Input id={`qty-${w.id}`} name="qty" type="number" required placeholder="Quantity" aria-label="Quantity (damage is entered as a positive count of damaged units)" />
              </Field>
              <Input name="evidence" required placeholder="Evidence / source (required)" aria-label="Evidence" />
              <Button small variant="secondary">Record</Button>
            </form>
            <Notice tone="info">Evidence-backed allocation, not a live WMS (O18). Count cadence/tolerance is D16 (unselected). Damage is entered as the number of damaged units and can never add sellable stock; a count below current reservations is recorded as-is and opens a shortfall case naming the affected orders.</Notice>
          </details>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-accent">Transfer out of this warehouse</summary>
            <form action={transferDepartureAction} className="mt-2 grid gap-2 sm:grid-cols-5">
              <input type="hidden" name="fromWarehouseId" value={w.id} />
              <Select name="toWarehouseId" required defaultValue="">
                <option value="" disabled>
                  Destination…
                </option>
                {warehouses.filter((x) => x.id !== w.id).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
              <Select name="skuId" required defaultValue="">
                <option value="" disabled>
                  SKU…
                </option>
                {skus.filter((s) => !s.archivedAt).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.brand} {s.name}
                  </option>
                ))}
              </Select>
              <Input name="qty" type="number" min={1} required placeholder="Quantity" />
              <Input name="evidence" required placeholder="Departure evidence" />
              <Button small variant="secondary">Depart</Button>
            </form>
            <p className="mt-1 text-xs text-muted">Only unreserved units can leave; they stay in transit (available nowhere) until the destination confirms receipt (R22).</p>
          </details>
          {rows.some((r) => r.inTransitQty > 0) ? (
            <details className="mt-2" open>
              <summary className="cursor-pointer text-sm text-accent">Receive in-transit stock</summary>
              <form action={transferReceiptAction} className="mt-2 grid gap-2 sm:grid-cols-4">
                <input type="hidden" name="toWarehouseId" value={w.id} />
                <Select name="skuId" required defaultValue="">
                  <option value="" disabled>
                    SKU…
                  </option>
                  {rows.filter((r) => r.inTransitQty > 0).map((r) => (
                    <option key={r.skuId} value={r.skuId}>
                      {skuName(r.skuId)} ({r.inTransitQty} in transit)
                    </option>
                  ))}
                </Select>
                <Input name="qty" type="number" min={1} required placeholder="Quantity received" />
                <Input name="evidence" required placeholder="Receipt / count evidence" />
                <Button small variant="secondary">Receive</Button>
              </form>
            </details>
          ) : null}
        </Card>
      ))}
    </Page>
  );
}
