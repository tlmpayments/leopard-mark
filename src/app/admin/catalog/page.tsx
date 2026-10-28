import { Badge, Button, Card, Flash, Input, Notice, Page, Select, Table } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { PACKAGE_LABEL, currentPrice, formatCents, listSkus, type PackageKind } from "@/lib/domain/catalog/service";
import { listMarkets } from "@/lib/domain/markets/service";
import { archiveSkuAction, createSkuAction, setPriceAction } from "../actions";

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("catalog.manage");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const [skus, markets] = await Promise.all([listSkus(d), listMarkets(d)]);
  const prices = new Map<string, number | null>();
  for (const s of skus) for (const m of markets) prices.set(`${m.id}:${s.id}`, (await currentPrice(d, m.id, s.id))?.priceCents ?? null);
  return (
    <Page title="Catalog & market prices" subtitle="Internal catalog and market prices are authoritative (U23). Prices are fixed; Sales cannot override. Price history is retained with effective dates.">
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
            ...markets.map((m) => formatCents(prices.get(`${m.id}:${s.id}`))),
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
        <form action={setPriceAction} className="grid gap-2 sm:grid-cols-5">
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
          <Input name="price" type="number" step="0.01" min={0} required placeholder="Price (USD)" />
          <Input name="reason" placeholder="Reason" />
          <Button small variant="secondary">Set price</Button>
        </form>
        <Notice tone="info">Orders keep their price at submission; whether it is committed or repriced later is D12 (unselected). Keg deposit is $35 per keg regardless of package (O28).</Notice>
      </Card>
    </Page>
  );
}
