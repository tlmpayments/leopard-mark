import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Card, Flash, Notice, Page, StateLine } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { KEG_DEPOSIT_CENTS, MINIMUM_DELIVERY_CENTS, marketCatalog } from "@/lib/domain/catalog/service";
import { getLocation, listLocations } from "@/lib/domain/customers/service";
import { repeatLastOrderPreview, repeatOrderPreview } from "@/lib/domain/orders/service";
import { evaluateLocationReadiness } from "@/lib/domain/readiness/service";
import { getPolicy } from "@/lib/policy/policy";
import { submitOrderFormAction } from "../actions";
import { AccountPicker } from "./account-picker";
import { OrderForm, type OrderFormCatalogItem } from "./order-form";

/**
 * Sales order flow (O13): account, then SKU, quantity, optional date and notes, then submit.
 * Prices are fixed per market; stock counts are internal and never shown to customers.
 */
export default async function NewOrderPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("order.submit");
  const sp = await searchParams;
  const locationId = param(sp, "locationId") ?? "";
  const repeat = param(sp, "repeat");
  const flash = await flashFrom(searchParams);
  const d = await getDb();

  if (!locationId) {
    const locations = (await listLocations(d, actor, { withAddress: true })).filter((l) => l.loc.status !== "closed" && can(actor, "order.submit", { marketId: l.loc.marketId }));
    return (
      <Page title="New order" subtitle="Step 1 of 2 — choose the account">
        <Flash {...flash} />
        <Card>
          {locations.length === 0 ? (
            <p className="text-sm text-muted">
              No accounts yet. <Link href="/locations/new" className="text-accent underline">Create one</Link> first — no preapproval needed.
            </p>
          ) : (
            <AccountPicker locations={locations.map((l) => ({ id: l.loc.id, tradeName: l.loc.tradeName, address: l.address ? `${l.address.line1}, ${l.address.city}` : "no address", marketCode: l.market.code, status: l.loc.status }))} />
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
  const [catalog, readiness, preview, d11] = await Promise.all([
    marketCatalog(d, detail.location.marketId),
    evaluateLocationReadiness(d, locationId),
    repeat === "1" ? repeatLastOrderPreview(d, locationId) : repeat ? repeatOrderPreview(d, repeat) : Promise.resolve(null),
    getPolicy<{ value_basis?: string }>(d, "D11", { marketId: detail.location.marketId }),
  ]);
  const source = preview?.sourceOrder && preview.sourceOrder.locationId === locationId ? preview : null;
  const blockers = readiness.conditions.filter((c) => c.status !== "satisfied");
  const items: OrderFormCatalogItem[] = catalog.map((c) => {
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

  return (
    <Page title={source ? `Repeat order for ${detail.location.tradeName}` : `Order for ${detail.location.tradeName}`} subtitle="Step 2 of 2 — products and quantities. Submission reserves stock first-come-first-served; delivery is a separate step.">
      <Flash {...flash} />
      {detail.location.status === "closed" ? <Notice tone="danger">This location is closed. Admin must reopen it before new demand is captured.</Notice> : null}
      {blockers.length ? (
        <Card title="Before delivery (orders are still captured)">
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
        tradeName={detail.location.tradeName}
        catalog={items}
        kegDepositCents={KEG_DEPOSIT_CENTS}
        minimumCents={MINIMUM_DELIVERY_CENTS}
        minimumBasis={d11.status === "selected" && typeof d11.selection.value_basis === "string" ? d11.selection.value_basis : null}
        repeatOf={source ? { orderNumber: source.sourceOrder!.orderNumber, notes: source.sourceOrder!.notes, skipped: source.lines.filter((l) => !l.orderable).map((l) => ({ skuName: l.skuName, change: l.change })) } : null}
        submissionKey={randomUUID()}
        action={submitOrderFormAction}
      />
    </Page>
  );
}
