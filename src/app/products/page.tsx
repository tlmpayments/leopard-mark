import { Badge, Card, Page, Table } from "@/components/ui";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { PACKAGE_LABEL, formatCents, marketCatalog } from "@/lib/domain/catalog/service";
import { visibleMarkets } from "@/lib/domain/markets/service";

/** Read-only product view for everyone who orders or executes (UX-09): prices per market, orderability, no Admin controls. */
export default async function ProductsPage() {
  const actor = await requireAction("catalog.view");
  const d = await getDb();
  const markets = await visibleMarkets(d, actor);
  const catalogs = await Promise.all(markets.map(async (m) => ({ market: m, items: await marketCatalog(d, m.id) })));
  return (
    <Page title="Products" subtitle="Fixed market prices; Sales cannot override. Archived products stay visible in history only.">
      {catalogs.map(({ market, items }) => (
        <Card key={market.id} title={`${market.name} (${market.code})`}>
          <Table
            head={["Product", "Package", "Selling unit", "Price", "Orderable"]}
            rows={items.map((c) => [
              <span key="n" className="font-medium">
                {c.sku.brand} {c.sku.name}
              </span>,
              PACKAGE_LABEL[c.sku.packageKind],
              c.sku.sellingUnit,
              c.priceCents !== null ? formatCents(c.priceCents) : <span className="text-muted">no price</span>,
              c.orderable ? <Badge key="y" tone="good">yes</Badge> : <Badge key="n2" tone="warn">{c.reason ?? "no"}</Badge>,
            ])}
          />
        </Card>
      ))}
    </Page>
  );
}
