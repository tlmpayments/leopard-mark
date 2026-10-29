import { randomUUID } from "node:crypto";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { Card, Flash, Notice, Page, StateLine } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { KEG_DEPOSIT_CENTS, MINIMUM_DELIVERY_CENTS, marketCatalog } from "@/lib/domain/catalog/service";
import { getLocation, isSamplesRecipient, listLocations, samplesRecipients } from "@/lib/domain/customers/service";
import { skuBrandActive } from "@/lib/domain/lots/service";
import { primaryWarehouse } from "@/lib/domain/markets/service";
import { OFFICE_ORDER_SOURCES, ORDER_SOURCE_LABEL, repeatLastOrderPreview, repeatOrderPreview } from "@/lib/domain/orders/service";
import { originLabel } from "@/lib/domain/origins/service";
import { evaluateLocationReadiness } from "@/lib/domain/readiness/service";
import { getPolicy } from "@/lib/policy/policy";
import { todayIso } from "../../shipments/labels";
import { submitOrderFormAction } from "../actions";
import { AccountPicker } from "./account-picker";
import { OrderForm, type OrderFormCatalogItem } from "./order-form";

/**
 * The office's order screen (R2-1, R2-2): choose the account, then one form for how the order came in, the products,
 * the dates; submitting records the order and drafts its shipment from the market's origin; confirming in the same go
 * numbers the shipment and readies the BOL. Samples (R2-27) use the same screen with the market's samples house or a
 * rep's home address as the account and "no charge" ticked.
 */
export default async function NewOrderPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("order.submit");
  const sp = await searchParams;
  const locationId = param(sp, "locationId") ?? "";
  const repeat = param(sp, "repeat");
  const flash = await flashFrom(searchParams);
  const d = await getDb();

  if (!locationId) {
    const accounts = (await listLocations(d, actor, { withAddress: true, status: "active" })).filter((l) => can(actor, "order.submit", { marketId: l.loc.marketId }));
    const markets = Array.from(new Set(accounts.map((l) => l.loc.marketId)));
    const samples = (await Promise.all(markets.map((m) => samplesRecipients(d, m)))).flat();
    const marketCode = new Map(accounts.map((l) => [l.loc.marketId, l.market.code]));
    const picker = [
      ...accounts.map((l) => ({ id: l.loc.id, tradeName: l.loc.tradeName, address: l.address ? `${l.address.line1}, ${l.address.city}` : "no delivery address yet", marketCode: l.market.code, status: l.loc.status, group: "accounts" as const })),
      ...samples.map((s) => ({ id: s.loc.id, tradeName: s.loc.tradeName, address: s.address ? `${s.address.line1}, ${s.address.city}` : s.loc.samplesHouse ? "market samples house" : "no address yet", marketCode: marketCode.get(s.loc.marketId) ?? "", status: s.loc.status, group: "samples" as const })),
    ];
    return (
      <Page title="New order" subtitle="Step 1 of 2: the account. Samples go to the market's samples house or a rep's home address." wide={false}>
        <Flash {...flash} />
        <Card>
          {picker.length === 0 ? (
            <p className="text-sm text-ink-2">
              No accounts yet.{" "}
              <Link href="/locations/new" className="text-navy underline">
                Create one
              </Link>{" "}
              first.
            </p>
          ) : (
            <AccountPicker locations={picker} />
          )}
        </Card>
      </Page>
    );
  }

  const detail = await getLocation(d, locationId);
  if (!detail || !can(actor, "order.submit", { marketId: detail.location.marketId })) {
    return (
      <Page title="New order">
        <Notice tone="danger">Account not found or outside your market scope.</Notice>
      </Page>
    );
  }
  const loc = detail.location;
  const [catalog, readiness, preview, d11, origin] = await Promise.all([
    marketCatalog(d, loc.marketId),
    evaluateLocationReadiness(d, locationId),
    repeat === "1" ? repeatLastOrderPreview(d, locationId) : repeat ? repeatOrderPreview(d, repeat) : Promise.resolve(null),
    getPolicy<{ value_basis?: string }>(d, "D11", { marketId: loc.marketId }),
    loc.warehouseOverrideId ? d.select().from(schema.warehouse).where(eq(schema.warehouse.id, loc.warehouseOverrideId)).then((r) => r[0] ?? null) : primaryWarehouse(d, loc.marketId),
  ]);
  const source = preview?.sourceOrder && preview.sourceOrder.locationId === locationId ? preview : null;
  const blockers = readiness.conditions.filter((c) => c.status !== "satisfied");
  const items: OrderFormCatalogItem[] = catalog
    .filter((c) => skuBrandActive(c.sku))
    .map((c) => {
      const prev = source?.lines.find((l) => l.skuId === c.sku.id);
      return {
        skuId: c.sku.id,
        brand: c.sku.brand,
        name: c.sku.name,
        sellingUnit: c.sku.sellingUnit,
        priceCents: c.priceCents,
        kegsPerUnit: c.sku.kegsPerUnit,
        orderable: c.orderable,
        reason: c.reason,
        previous: prev ? { qty: prev.qty, previousPriceCents: prev.previousPriceCents, change: prev.change } : undefined,
      };
    });
  const samplesRecipient = isSamplesRecipient(loc);

  return (
    <Page title={source ? `Repeat order for ${loc.tradeName}` : `Order for ${loc.tradeName}`} subtitle={`Step 2 of 2. Ships from ${originLabel(origin)}; the draft shipment is created with the order.`}>
      <Flash {...flash} />
      {loc.status === "closed" ? <Notice tone="danger">This account is closed. Admin must reopen it before new demand is captured.</Notice> : null}
      {!origin ? <Notice tone="danger">This market has no primary warehouse yet (Admin: Markets &amp; stock). The order cannot be shipped until one is set.</Notice> : null}
      {blockers.length && !samplesRecipient ? (
        <Card title="Before the first delivery (the order is still taken)">
          <div className="space-y-1">
            {blockers.map((b) => (
              <StateLine key={b.code} kind={b.kind}>
                {b.plain}
              </StateLine>
            ))}
          </div>
        </Card>
      ) : null}
      <OrderForm
        locationId={locationId}
        tradeName={loc.tradeName}
        originName={originLabel(origin)}
        catalog={items}
        sources={OFFICE_ORDER_SOURCES.map((s) => ({ value: s, label: ORDER_SOURCE_LABEL[s] }))}
        kegDepositCents={KEG_DEPOSIT_CENTS}
        minimumCents={MINIMUM_DELIVERY_CENTS}
        minimumBasis={d11.status === "selected" && typeof d11.selection.value_basis === "string" ? d11.selection.value_basis : null}
        samplesRecipient={samplesRecipient}
        pickupDefault={loc.fulfilment === "pickup"}
        routeDays={detail.market?.routeDays ?? []}
        repeatOf={source ? { orderNumber: source.sourceOrder!.orderNumber, notes: source.sourceOrder!.notes, skipped: source.lines.filter((l) => !l.orderable).map((l) => ({ skuName: l.skuName, change: l.change })) } : null}
        submissionKey={randomUUID()}
        todayIso={todayIso()}
        action={submitOrderFormAction}
      />
    </Page>
  );
}
