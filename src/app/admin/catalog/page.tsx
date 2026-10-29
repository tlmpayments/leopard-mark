import { Badge, Button, Card, Field, Flash, Input, Notice, Page, Select, Table } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { PACKAGE_LABEL, PRICE_TIER_LABEL, currentPrice, formatCents, listSkuAliases, listSkus, type PackageKind } from "@/lib/domain/catalog/service";
import { listMarkets } from "@/lib/domain/markets/service";
import { archiveSkuAction, createSkuAction, setPriceAction } from "../actions";
import { updateSkuDetailsAction, upsertSkuAliasAction } from "./actions";

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("catalog.manage");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const [skus, markets, aliases] = await Promise.all([listSkus(d), listMarkets(d), listSkuAliases(d)]);
  const skuCode = new Map(skus.map((s) => [s.id, s.code]));
  const prices = new Map<string, number | null>();
  for (const s of skus)
    for (const m of markets)
      for (const tier of ["retail", "distributor"] as const) prices.set(`${m.id}:${s.id}:${tier}`, (await currentPrice(d, m.id, s.id, new Date(), tier))?.priceCents ?? null);
  const priceCell = (marketId: string, skuId: string) => {
    const r = prices.get(`${marketId}:${skuId}:retail`);
    const dist = prices.get(`${marketId}:${skuId}:distributor`);
    if (r == null && dist == null) return "—";
    return (
      <span className="whitespace-nowrap">
        {r != null ? formatCents(r) : "—"}
        {dist != null ? <span className="text-muted"> · Dist {formatCents(dist)}</span> : null}
      </span>
    );
  };
  return (
    <Page title="Catalog & market prices" subtitle="Internal catalog and market prices are authoritative (U23). Each market has a retail price and a distributor price (R2-41); Sales cannot override. Price history is retained with effective dates.">
      <Flash {...flash} />
      <Card title="SKUs">
        <Table
          head={["Code", "Product", "Package", "Selling unit", "Kegs/unit", ...markets.map((m) => `${m.code} price`), ""]}
          rows={skus.map((s) => [
            s.code,
            <span key="n">
              {s.brand} {s.name} {s.archivedAt ? <Badge tone="danger">archived</Badge> : null}
            </span>,
            PACKAGE_LABEL[s.packageKind as PackageKind],
            s.sellingUnit,
            String(s.kegsPerUnit),
            ...markets.map((m) => priceCell(m.id, s.id)),
            !s.archivedAt && can(actor, "catalog.manage") ? (
              <form key="a" action={archiveSkuAction}>
                <input type="hidden" name="skuId" value={s.id} />
                <input type="hidden" name="reason" value="archived from catalog page" />
                <Button small variant="ghost">Archive</Button>
              </form>
            ) : (
              ""
            ),
          ])}
        />
        <form action={createSkuAction} className="mt-3 grid gap-2 sm:grid-cols-6">
          <Input name="code" required placeholder="Code" />
          <Input name="brand" required placeholder="Brand" />
          <Input name="name" required placeholder="Name" />
          <Select name="packageKind" defaultValue="case_12oz_can">
            {(Object.keys(PACKAGE_LABEL) as PackageKind[]).map((k) => (
              <option key={k} value={k}>
                {PACKAGE_LABEL[k]}
              </option>
            ))}
          </Select>
          <Input name="sellingUnit" required placeholder="Selling unit (e.g. case 24×12oz)" />
          <Button small variant="secondary">Add SKU</Button>
        </form>
      </Card>
      <Card title="Set a market price">
        <form action={setPriceAction} className="grid gap-2 sm:grid-cols-6">
          <Select name="marketId" required defaultValue="">
            <option value="" disabled>
              Market…
            </option>
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
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
          <Select name="tier" required defaultValue="retail" aria-label="Price tier">
            {(["retail", "distributor"] as const).map((t) => (
              <option key={t} value={t}>
                {PRICE_TIER_LABEL[t]}
              </option>
            ))}
          </Select>
          <Input name="price" type="number" step="0.01" min={0} required placeholder="Price (USD)" />
          <Input name="reason" placeholder="Reason" />
          <Button small variant="secondary">Set price</Button>
        </form>
        <Notice tone="info">Distributor accounts are priced from the distributor price and every other account from the retail price; a distributor with no distributor price set cannot be ordered for. Orders keep their price at submission. Keg deposits apply to self-distribution accounts only.</Notice>
      </Card>
      <Card title="SKU details for documents (3.1, 3.7, 3.8, 4.8)">
        <p className="mb-2 text-xs text-muted">Codes are immutable once referenced (3.2). Case UPC prints on the distributor template; the pallet fraction sizes the computed pallet count; weight prints per line; shelf life is internal only and stays blank until the owner supplies day counts.</p>
        <ul className="divide-y divide-line">
          {skus.map((s) => (
            <li key={s.id} id={`sku-${s.id}`} className="py-2">
              <details>
                <summary className="cursor-pointer text-sm">
                  <span className="font-mono text-xs">{s.code}</span> {s.brand} {s.name}
                  {s.archivedAt ? <Badge tone="danger"> archived</Badge> : null}
                  <span className="ml-2 text-xs text-muted">
                    {s.weightLb ? `${s.weightLb} lb` : "no weight"} · {s.upcCase ? `case UPC ${s.upcCase}` : "no case UPC"} · {s.palletFraction ? `pallet fraction ${s.palletFraction}` : "no pallet fraction"}
                    {s.recipeVariant ? ` · variant ${s.recipeVariant}` : ""}
                    {s.shelfLifeDays != null ? ` · ${s.shelfLifeDays} days` : ""}
                  </span>
                </summary>
                <form action={updateSkuDetailsAction} className="mt-2 grid gap-2 sm:grid-cols-4">
                  <input type="hidden" name="skuId" value={s.id} />
                  <Field label="Weight (lb per unit)">
                    <Input name="weightLb" type="number" step="0.01" min={0} defaultValue={s.weightLb ?? ""} />
                  </Field>
                  <Field label="Case UPC">
                    <Input name="upcCase" defaultValue={s.upcCase ?? ""} inputMode="numeric" />
                  </Field>
                  <Field label="Retail UPC">
                    <Input name="upcRetail" defaultValue={s.upcRetail ?? ""} inputMode="numeric" />
                  </Field>
                  <Field label="Unit UPC">
                    <Input name="upcUnit" defaultValue={s.upcUnit ?? ""} inputMode="numeric" />
                  </Field>
                  <Field label="Pallet fraction" hint="Share of a pallet per selling unit, e.g. 0.0125">
                    <Input name="palletFraction" type="number" step="0.0001" min={0} max={1} defaultValue={s.palletFraction ?? ""} />
                  </Field>
                  <Field label="Recipe variant (code position 4)" hint="C Clasico, 0 base recipe">
                    <Input name="recipeVariant" maxLength={1} defaultValue={s.recipeVariant ?? ""} className="uppercase" />
                  </Field>
                  <Field label="Shelf life (days, internal)">
                    <Input name="shelfLifeDays" type="number" min={0} step={1} defaultValue={s.shelfLifeDays ?? ""} />
                  </Field>
                  <Field label="Unit cost (USD, internal)" hint="Counts samples toward the spend on an account">
                    <Input name="unitCost" type="number" step="0.01" min={0} defaultValue={s.unitCostCents != null ? (s.unitCostCents / 100).toFixed(2) : ""} />
                  </Field>
                  <div className="flex items-end">
                    <Button small variant="secondary">
                      Save details
                    </Button>
                  </div>
                </form>
              </details>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Legacy codes (aliases, 3.3)" id="aliases">
        <Table caption="SKU aliases" head={["Alias", "Resolves to", "Note"]} rows={aliases.map((a) => [<span key="a" className="font-mono text-xs">{a.alias}</span>, skuCode.get(a.skuId) ?? a.skuId, a.note ?? "—"])} />
        <form action={upsertSkuAliasAction} className="mt-3 grid gap-2 sm:grid-cols-4">
          <Input name="alias" required placeholder="Legacy or dotted code" className="uppercase" aria-label="Alias" />
          <Select name="skuId" required defaultValue="" aria-label="Active SKU">
            <option value="" disabled>
              Resolves to SKU…
            </option>
            {skus.filter((s) => !s.archivedAt).map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.brand} {s.name}
              </option>
            ))}
          </Select>
          <Input name="note" placeholder="Note (optional)" aria-label="Note" />
          <Button small variant="secondary">
            Add alias
          </Button>
        </form>
        <p className="mt-1 text-xs text-muted">Aliases are searchable and used by the import; they are never selectable on a shipment line (3.3, 1.7). Re-adding an alias moves it to the chosen SKU.</p>
      </Card>
    </Page>
  );
}
