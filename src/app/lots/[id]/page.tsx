import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { Badge, Button, Card, Field, Flash, Input, KV, Notice, Page, StatusBadge, Table, fmtDate, fmtDay } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { listSkus } from "@/lib/domain/catalog/service";
import { BRAND_CODES, brandCodeForSku, getLot } from "@/lib/domain/lots/service";
import { shipmentNumber } from "../../shipments/labels";
import { confirmLotQuantitiesAction } from "../actions";

export default async function LotPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const actor = await requireAction("lot.view");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const detail = /^[0-9a-f-]{36}$/i.test(id) ? await getLot(d, id) : null;
  if (!detail) notFound();
  const { lot, quantities, facility, batch } = detail;
  const skus = (await listSkus(d)).filter((s) => !s.archivedAt);
  const sameBrand = skus.filter((s) => brandCodeForSku(s.code) === lot.brandCode);
  const forForm = sameBrand.length ? sameBrand : skus;
  const qtyOf = new Map(quantities.map((q) => [q.skuId, q.qty]));
  const usedOn = await d
    .select({ s: schema.shipment, qty: schema.shipmentLine.qty, skuCode: schema.sku.code })
    .from(schema.shipmentLine)
    .innerJoin(schema.shipment, eq(schema.shipment.id, schema.shipmentLine.shipmentId))
    .leftJoin(schema.sku, eq(schema.sku.id, schema.shipmentLine.skuId))
    .where(eq(schema.shipmentLine.lotId, lot.id))
    .orderBy(desc(schema.shipment.scheduledDate))
    .limit(50);
  const canManage = can(actor, "lot.manage");
  const brand = BRAND_CODES.find((b) => b.code === lot.brandCode);

  return (
    <Page
      title={`Lot ${lot.lotCode}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span>
            {facility?.name ?? "—"} · {lot.brandCode}
            {brand ? ` ${brand.name}` : ""} · packaged {fmtDay(lot.packagingDate)}
          </span>
          {lot.quantitiesKnown ? <Badge tone="good">quantities known</Badge> : <Badge tone="warn">quantities unconfirmed</Badge>}
          {lot.legacyCode ? <Badge tone="neutral">history only</Badge> : null}
        </span>
      }
      actions={
        <Button href="/lots" variant="secondary">
          All lots
        </Button>
      }
    >
      <Flash {...flash} />
      {lot.legacyCode ? <Notice tone="info">Dotted legacy lot {lot.legacyCode}: imported history, never offered on a shipment line (1.7).</Notice> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Lot">
          <KV
            items={[
              ["Lot code", <span key="c" className="font-mono">{lot.lotCode}</span>],
              ["Facility", facility ? `${facility.lotFacilityCode ? facility.lotFacilityCode + " · " : ""}${facility.name}` : "—"],
              ["Brand", `${lot.brandCode}${brand ? ` · ${brand.name}` : ""}`],
              ["Packaging date", fmtDay(lot.packagingDate)],
              ["Run", lot.runCode],
              ["Source", lot.source.replace(/_/g, " ")],
              ["Batch", batch ? <Link key="b" href={`/batches?focus=${batch.id}`} className="underline">{batch.batchNumber}</Link> : "—"],
              ["Recorded", fmtDate(lot.createdAt)],
              ["Notes", lot.notes ? <span key="n" className="whitespace-pre-line">{lot.notes}</span> : "—"],
            ]}
          />
          {batch ? (
            <div className="mt-3 border-t border-line pt-3 text-sm">
              <div className="text-xs uppercase tracking-wide text-muted">Batch</div>
              {batch.batchNumber} · <StatusBadge value={batch.status} /> {batch.brewDate ? `· brewed ${fmtDay(batch.brewDate)}` : ""} {batch.vesselSize ? `· ${batch.vesselSize}` : ""}
              {batch.breweryBatchNumber ? <span className="block text-xs text-muted">Brewery batch number: {batch.breweryBatchNumber}</span> : null}
            </div>
          ) : null}
        </Card>
        <Card title="Quantities packaged">
          <Table head={["SKU", "Product", "Qty"]} rows={quantities.map((q) => [<span key="c" className="font-mono text-xs">{q.code}</span>, q.name, String(q.qty)])} />
          {canManage && !lot.legacyCode ? (
            <details className="mt-3" open={!lot.quantitiesKnown}>
              <summary className="cursor-pointer text-sm text-accent">{lot.quantitiesKnown ? "Correct quantities" : "Confirm quantities from the host's sheet"}</summary>
              <form action={confirmLotQuantitiesAction} className="mt-2 space-y-2">
                <input type="hidden" name="lotId" value={lot.id} />
                <div className="grid gap-2">
                  {forForm.map((s) => (
                    <label key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1">
                      <span className="text-sm">
                        <span className="font-mono text-xs">{s.code}</span> {s.brand} {s.name}
                      </span>
                      <Input name={`qty:${s.id}`} type="number" min={0} step={1} inputMode="numeric" className="w-24" defaultValue={qtyOf.get(s.id) ?? ""} aria-label={`${s.code} quantity`} />
                    </label>
                  ))}
                </div>
                <Field label="Note">
                  <Input name="note" placeholder="e.g. Host packaging sheet received 2026-10-30" />
                </Field>
                <Button small>Confirm quantities</Button>
                <p className="text-xs text-muted">Replaces the quantities on this lot and resolves the open exception (4.6). Blank SKUs are left off.</p>
              </form>
            </details>
          ) : null}
        </Card>
      </div>
      <Card title="Shipments using this lot">
        {usedOn.length === 0 ? (
          <p className="text-sm text-muted">Not on any shipment yet.</p>
        ) : (
          <Table
            head={["Shipment", "Type", "Scheduled", "Status", "SKU", "Qty"]}
            rows={usedOn.map((u, i) => [
              <Link key={i} href={`/shipments/${u.s.id}`} className="underline">
                {shipmentNumber(u.s)}
              </Link>,
              u.s.type,
              fmtDay(u.s.scheduledDate),
              <StatusBadge key="s" value={u.s.status} />,
              u.skuCode ?? "—",
              String(u.qty),
            ])}
          />
        )}
      </Card>
    </Page>
  );
}
