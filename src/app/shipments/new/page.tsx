import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { Button, Card, Field, Flash, Input, Notice, Page, Select, Textarea } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { listLocations } from "@/lib/domain/customers/service";
import { visibleMarkets } from "@/lib/domain/markets/service";
import { listOrders } from "@/lib/domain/orders/service";
import { listOrigins } from "@/lib/domain/origins/service";
import { SHIPMENT_TYPES, TYPE_LABEL, todayIso } from "../labels";
import { createShipmentAction } from "./actions";

const KIND_LABEL: Record<string, string> = { retail: "retail", distributor: "distributor", warehouse: "warehouse", host: "host", internal: "Familiar Ventures", individual: "individual" };

export default async function NewShipmentPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("shipment.manage");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const typeParam = param(sp, "type");
  const type: "D" | "T" | "S" = typeParam === "T" || typeParam === "S" ? typeParam : "D";
  const locationId = param(sp, "locationId");
  const q = param(sp, "q");
  const d = await getDb();
  const [origins, markets, allLocations] = await Promise.all([listOrigins(d), visibleMarkets(d, actor, ["owner", "admin"]), listLocations(d, actor, { withAddress: true })]);
  const sortedOrigins = [...origins].sort((a, b) => (a.originCode ? 0 : 1) - (b.originCode ? 0 : 1) || a.name.localeCompare(b.name));
  const nameOf = new Map(allLocations.map((l) => [l.loc.id, l.loc.tradeName]));
  const needle = q?.toLowerCase();
  const locations = allLocations.filter((l) => l.loc.status !== "closed" && (!needle || l.loc.tradeName.toLowerCase().includes(needle) || (l.address?.city ?? "").toLowerCase().includes(needle) || l.loc.id === locationId));
  const drivers = Array.from(
    new Map(
      (
        await d
          .select({ id: schema.employee.id, displayName: schema.employee.displayName })
          .from(schema.roleGrant)
          .innerJoin(schema.employee, eq(schema.employee.id, schema.roleGrant.employeeId))
          .where(and(eq(schema.roleGrant.role, "driver_service"), isNull(schema.roleGrant.revokedAt), eq(schema.employee.enabled, true)))
      ).map((r) => [r.id, r]),
    ).values(),
  ).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const prefilled = locationId ? allLocations.find((l) => l.loc.id === locationId) : null;
  const openOrders = locationId ? await listOrders(d, actor, { locationId, state: "open", limit: 25 }) : [];
  const today = todayIso();

  return (
    <Page title="New shipment" subtitle="A draft first: lines are added on the shipment page, and the number is assigned at confirmation (5.3).">
      <Flash {...flash} />
      <form className="flex flex-wrap items-end gap-2" role="search">
        <input type="hidden" name="type" value={type} />
        {locationId ? <input type="hidden" name="locationId" value={locationId} /> : null}
        <Field label="Narrow the account list">
          <Input name="q" defaultValue={q ?? ""} placeholder="Trade name or city" />
        </Field>
        <Button variant="secondary" small>
          Narrow
        </Button>
        <span className="text-xs text-muted">
          Type:{" "}
          {SHIPMENT_TYPES.map((t) => (
            <Link key={t} href={`/shipments/new?type=${t}${locationId ? `&locationId=${locationId}` : ""}`} className={`mr-2 underline ${t === type ? "font-semibold" : ""}`}>
              {t} {TYPE_LABEL[t]}
            </Link>
          ))}
        </span>
      </form>

      <form action={createShipmentAction} className="space-y-4">
        <Card title="Route">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type" hint="D delivery (will-call pickup is D with the pickup box ticked), T transfer between origins, S samples (NC invoice, never charged). Switch with the links above.">
              <input type="hidden" name="type" value={type} />
              <div className="flex min-h-11 items-center text-sm font-medium">
                {type} · {TYPE_LABEL[type]}
              </div>
            </Field>
            <Field label="Origin" hint="Origins with a code can be confirmed; a code is required for the number (2.2).">
              <Select name="originWarehouseId" required defaultValue={prefilled?.loc.warehouseOverrideId ?? ""}>
                <option value="" disabled>
                  Origin…
                </option>
                {sortedOrigins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.originCode ? `${o.originCode} · ` : "(no code) · "}
                    {o.name}
                    {o.kind === "brewery" ? " · brewery" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={type === "T" ? "Destination account (not used for a transfer)" : "Destination account"} hint="Kind and served-by in brackets. A direct shipment to a distributor-served account needs an override reason (2.6).">
              <Select name="destinationLocationId" defaultValue={locationId ?? ""} disabled={type === "T"}>
                <option value="">{type === "S" ? "No account (person or event below)" : "Account…"}</option>
                {markets.map((m) => {
                  const inMarket = locations.filter((l) => l.loc.marketId === m.id);
                  if (!inMarket.length) return null;
                  return (
                    <optgroup key={m.id} label={m.name}>
                      {inMarket.map(({ loc, address }) => (
                        <option key={loc.id} value={loc.id}>
                          {loc.tradeName}
                          {address ? ` · ${address.city}` : ""} ({KIND_LABEL[loc.kind] ?? loc.kind}
                          {loc.servedByLocationId ? `, served by ${nameOf.get(loc.servedByLocationId) ?? "distributor"}` : ""}
                          {loc.status === "inactive" ? ", inactive" : ""})
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </Select>
            </Field>
            {type === "T" ? (
              <Field label="Destination origin (transfer)">
                <Select name="destinationWarehouseId" required defaultValue="">
                  <option value="" disabled>
                    Origin…
                  </option>
                  {sortedOrigins.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.originCode ? `${o.originCode} · ` : ""}
                      {o.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : type === "S" ? (
              <Field label="Or a person / event (samples without an account)">
                <Input name="destinationText" placeholder="e.g. Beer festival, Oakland, booth 12" />
              </Field>
            ) : (
              <Field label="Will-call" hint="Legacy P documents are deliveries picked up at the origin (5.5).">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="pickup" defaultChecked={prefilled?.loc.fulfilment === "pickup"} /> Picked up at the origin
                </label>
              </Field>
            )}
            {type === "S" ? (
              <Field label="Will-call">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input type="checkbox" name="pickup" /> Picked up at the origin
                </label>
              </Field>
            ) : null}
            <Field label="Scheduled date" hint="The number uses origin and scheduled date; moving the actual date later never renumbers (5.12).">
              <Input name="scheduledDate" type="date" required defaultValue={today} />
            </Field>
            <Field label="Driver" hint="Employees with a Driver / Service grant; the driver sees only assigned stops.">
              <Select name="driverEmployeeId" defaultValue="">
                <option value="">Unassigned</option>
                {drivers.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Override reason" hint="Required when the account is served by a distributor and this shipment goes direct (2.6).">
              <Input name="overrideReason" placeholder="e.g. Distributor out of stock; owner approved direct drop" />
            </Field>
          </div>
          {prefilled?.loc.servedByLocationId && prefilled.loc.kind !== "distributor" ? (
            <Notice tone="warn" title="Served account:">
              {prefilled.loc.tradeName} is served by {nameOf.get(prefilled.loc.servedByLocationId) ?? "a distributor"}. A direct delivery needs an override reason before confirmation.
            </Notice>
          ) : null}
          {openOrders.length ? (
            <div className="mt-3">
              <div className="mb-1 text-sm font-medium">Link open orders (optional)</div>
              <div className="grid gap-1 sm:grid-cols-2">
                {openOrders.map(({ order }) => (
                  <label key={order.id} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1 text-sm">
                    <input type="checkbox" name="orderIds" value={order.id} /> {order.orderNumber}
                    <span className="text-xs text-muted">{order.demandState.replace(/_/g, " ")}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        <Card title="Logistics (all optional; editable after confirmation)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="PO numbers" hint="Comma separated; one shipment can cover several POs (5.2).">
              <Input name="poNumbers" placeholder="PO-1234, PO-1235" />
            </Field>
            <Field label="Appointment">
              <Input name="appointment" placeholder="e.g. Tue 10:00 to 11:00, dock 4" />
            </Field>
            <Field label="Carrier">
              <Input name="carrier" />
            </Field>
            <Field label="Carrier phone">
              <Input name="carrierPhone" />
            </Field>
            <Field label="Seal number">
              <Input name="sealNumber" />
            </Field>
            <Field label="Trailer number">
              <Input name="trailerNumber" />
            </Field>
            <Field label="Pallet count" hint="Computed from pallet fractions when blank; editable (5.9).">
              <Input name="palletCount" type="number" min={0} step={1} />
            </Field>
            <Field label="Pallet build">
              <Input name="palletBuild" placeholder="e.g. 2 pallets: 40 cs each, kegs loose" />
            </Field>
            <Field label="Freight class">
              <Input name="freightClass" placeholder="e.g. 65" />
            </Field>
            <Field label="Delivery window (retail)">
              <Input name="deliveryWindow" placeholder="e.g. before 2 pm" />
            </Field>
            <Field label="Receiving instructions (retail)">
              <Textarea name="receivingInstructions" rows={2} />
            </Field>
            <Field label="Notes">
              <Textarea name="notes" rows={2} />
            </Field>
          </div>
        </Card>
        <div className="flex gap-2">
          <Button>Create draft</Button>
          <Button href="/shipments" variant="secondary">
            Cancel
          </Button>
        </div>
      </form>
    </Page>
  );
}
