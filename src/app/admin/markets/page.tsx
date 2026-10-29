import { Badge, Button, Card, Field, Flash, Input, Notice, Page, Select, StatusBadge, Table, Textarea, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { warehouseAvailability } from "@/lib/domain/allocation/service";
import { listSkus, formatCents } from "@/lib/domain/catalog/service";
import { listWarehouses, visibleMarkets } from "@/lib/domain/markets/service";
import { confirmSellerAction, createMarketAction, createWarehouseAction, stockMovementAction, transferDepartureAction, transferReceiptAction } from "../actions";
import { createOriginAction, updateMarketBillingAction, updateOriginAction } from "./origins-actions";
import { ORIGIN_KIND_LABEL, WEEKDAYS } from "./origins-fields";

export default async function MarketsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("stock.record");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const markets = await visibleMarkets(d, actor, ["owner", "admin"]);
  const marketIds = new Set(markets.map((m) => m.id));
  const [allWarehouses, skus] = await Promise.all([listWarehouses(d), listSkus(d)]);
  const warehouses = allWarehouses.filter((w) => (w.marketId ? marketIds.has(w.marketId) : actor.grants.some((g) => g.role === "owner")));
  const stock = await Promise.all(warehouses.map(async (w) => ({ w, rows: await warehouseAvailability(d, w.id) })));
  const canOrigins = can(actor, "warehouse.manage");
  const canBilling = can(actor, "market.manage");
  const triStateValue = (v: boolean | null | undefined) => (v === true ? "yes" : v === false ? "no" : "");
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

      {canBilling ? (
        <Card title="Market billing rules (7.4, 3.10, 2.1)">
          <Table
            head={["Market", "Terms", "Retail keg deposit", "Distributor keg deposit", "COD", "Regions"]}
            rows={markets.map((m) => [m.code, `Net ${m.termsDays}`, formatCents(m.retailKegDepositCents), formatCents(m.distributorKegDepositCents), m.cod ? "yes" : "no", m.regionList?.length ? m.regionList.join(", ") : "—"])}
          />
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {markets.map((m) => (
              <details key={m.id} className="border-t border-rule pt-2">
                <summary className="cursor-pointer text-sm">
                  Edit {m.code} · {m.name}
                </summary>
                <form action={updateMarketBillingAction} className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="marketId" value={m.id} />
                  <Field label="Terms (days)" hint="Blank account overrides inherit this.">
                    <Input name="termsDays" type="number" min={0} step={1} required defaultValue={m.termsDays} />
                  </Field>
                  <Field label="Cash on delivery">
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" name="cod" defaultChecked={m.cod} /> COD market
                    </label>
                  </Field>
                  <Field label="Retail keg deposit (USD per keg)">
                    <Input name="retailKegDeposit" type="number" min={0} step="0.01" defaultValue={(m.retailKegDepositCents / 100).toFixed(2)} />
                  </Field>
                  <Field label="Distributor keg deposit (USD per keg)" hint="Zero: distributors remit to MicroStar.">
                    <Input name="distributorKegDeposit" type="number" min={0} step="0.01" defaultValue={(m.distributorKegDepositCents / 100).toFixed(2)} />
                  </Field>
                  <Field label="Regions (one per line)" hint="Sheet regions become a sub-list under the market.">
                    <Textarea name="regionList" rows={3} defaultValue={(m.regionList ?? []).join("\n")} />
                  </Field>
                  <div className="flex items-end">
                    <Button small variant="secondary">
                      Save billing rules
                    </Button>
                  </div>
                </form>
              </details>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="Origins (breweries, warehouses, cold storage) · 2.2, 2.11">
        <Table
          head={["Code", "Name", "Kind", "Lot facility", "Market", "Active", "Appointment / dock / liftgate", "Shipping contact"]}
          rows={warehouses.map((w) => [
            <span key="c" className="font-mono">
              {w.originCode ?? <Badge tone="warn">no code</Badge>}
            </span>,
            <span key="n">
              {w.name} {w.isPrimary ? <Badge tone="good">primary</Badge> : null}
            </span>,
            ORIGIN_KIND_LABEL[w.kind] ?? w.kind,
            w.lotFacilityCode ?? "—",
            w.marketId ? (markets.find((m) => m.id === w.marketId)?.code ?? "") : <span key="m" className="text-xs text-muted">none</span>,
            w.active ? "yes" : "no",
            [w.appointmentRequired, w.loadingDock, w.liftgateRequired].map((v) => (v === true ? "yes" : v === false ? "no" : "?")).join(" / "),
            [w.shippingContactName, w.shippingContactPhone].filter(Boolean).join(" · ") || "—",
          ])}
        />
        <p className="mt-1 text-xs text-muted">An origin needs a three-letter code before a shipment from it can be confirmed; a brewery needs a two-digit lot facility code before a packaging run can be recorded. An origin may exist without a market (Prost, Real Ale). Dock, liftgate, appointment and hours are optional (2.11).</p>
        {canOrigins ? (
          <>
            <div className="mt-3 grid gap-3">
              {warehouses.map((w) => (
                <details key={w.id} className="border-t border-rule pt-2">
                  <summary className="cursor-pointer text-sm">
                    Edit {w.originCode ? `${w.originCode} · ` : ""}
                    {w.name}
                  </summary>
                  <form action={updateOriginAction} className="mt-2 grid gap-2 sm:grid-cols-3">
                    <input type="hidden" name="originId" value={w.id} />
                    <Field label="Name">
                      <Input name="name" required defaultValue={w.name} />
                    </Field>
                    <Field label="Origin code (3 letters)">
                      <Input name="originCode" maxLength={3} defaultValue={w.originCode ?? ""} className="uppercase" />
                    </Field>
                    <Field label="Lot facility code (2 digits, breweries)">
                      <Input name="lotFacilityCode" maxLength={2} defaultValue={w.lotFacilityCode ?? ""} />
                    </Field>
                    <Field label="Kind">
                      <Select name="kind" defaultValue={w.kind}>
                        {Object.entries(ORIGIN_KIND_LABEL).map(([k, label]) => (
                          <option key={k} value={k}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Market">
                      <Select name="marketId" defaultValue={w.marketId ?? ""}>
                        <option value="">No market (Prost, Real Ale)</option>
                        {markets.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.code} · {m.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Active">
                        <label className="flex min-h-11 items-center gap-2 text-sm">
                          <input type="checkbox" name="active" defaultChecked={w.active} /> Active
                        </label>
                      </Field>
                      <Field label="Primary">
                        <label className="flex min-h-11 items-center gap-2 text-sm">
                          <input type="checkbox" name="isPrimary" defaultChecked={w.isPrimary} /> Market primary
                        </label>
                      </Field>
                    </div>
                    <Field label="Appointment required">
                      <Select name="appointmentRequired" defaultValue={triStateValue(w.appointmentRequired)}>
                        <option value="">Unknown</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </Select>
                    </Field>
                    <Field label="Loading dock">
                      <Select name="loadingDock" defaultValue={triStateValue(w.loadingDock)}>
                        <option value="">Unknown</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </Select>
                    </Field>
                    <Field label="Liftgate required">
                      <Select name="liftgateRequired" defaultValue={triStateValue(w.liftgateRequired)}>
                        <option value="">Unknown</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </Select>
                    </Field>
                    <div className="sm:col-span-3">
                      <div className="mb-1 text-sm font-medium">Hours (free text per weekday, blank = not stated)</div>
                      <div className="grid gap-2 sm:grid-cols-7">
                        {WEEKDAYS.map((day) => (
                          <Input key={day} name={`hours:${day}`} placeholder={day} defaultValue={w.hours?.[day] ?? ""} aria-label={`${day} hours`} />
                        ))}
                      </div>
                    </div>
                    <Field label="Shipping contact name">
                      <Input name="shippingContactName" defaultValue={w.shippingContactName ?? ""} />
                    </Field>
                    <Field label="Shipping contact email">
                      <Input name="shippingContactEmail" type="email" defaultValue={w.shippingContactEmail ?? ""} />
                    </Field>
                    <Field label="Shipping contact phone">
                      <Input name="shippingContactPhone" defaultValue={w.shippingContactPhone ?? ""} />
                    </Field>
                    <Field label="Address line 1">
                      <Input name="addressLine1" defaultValue={w.addressLine1 ?? ""} />
                    </Field>
                    <Field label="Address line 2">
                      <Input name="addressLine2" defaultValue={w.addressLine2 ?? ""} />
                    </Field>
                    <Field label="City">
                      <Input name="addressCity" defaultValue={w.addressCity ?? ""} />
                    </Field>
                    <Field label="State">
                      <Input name="addressState" maxLength={2} defaultValue={w.addressState ?? ""} className="uppercase" />
                    </Field>
                    <Field label="Postal code">
                      <Input name="addressPostalCode" defaultValue={w.addressPostalCode ?? ""} />
                    </Field>
                    <Field label="Free-text address (fallback for documents)">
                      <Input name="addressText" defaultValue={w.addressText ?? ""} />
                    </Field>
                    <Field label="Fulfillment contact (legacy field)">
                      <Input name="fulfillmentContact" defaultValue={w.fulfillmentContact ?? ""} />
                    </Field>
                    <div className="flex items-end sm:col-span-2">
                      <Button small variant="secondary">
                        Save origin
                      </Button>
                    </div>
                  </form>
                </details>
              ))}
            </div>
            <details className="mt-3 border-t border-rule p-2">
              <summary className="cursor-pointer text-sm text-accent">Add an origin (brewery, warehouse or cold storage; market optional)</summary>
              <form action={createOriginAction} className="mt-2 grid gap-2 sm:grid-cols-6">
                <Input name="name" required placeholder="Name" aria-label="Name" />
                <Select name="kind" defaultValue="brewery" aria-label="Kind">
                  {Object.entries(ORIGIN_KIND_LABEL).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Select name="marketId" defaultValue="" aria-label="Market">
                  <option value="">No market</option>
                  {markets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code}
                    </option>
                  ))}
                </Select>
                <Input name="originCode" maxLength={3} placeholder="Code (EBB)" className="uppercase" aria-label="Origin code" />
                <Input name="lotFacilityCode" maxLength={2} placeholder="Lot code (01)" aria-label="Lot facility code" />
                <Button small variant="secondary">
                  Add origin
                </Button>
              </form>
            </details>
          </>
        ) : null}
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
