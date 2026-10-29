import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { Button, Card, Code, Columns, Empty, Field, Flash, Input, KV, Notice, RecordPage, StatusBadge, Table, Tabs, fmtDate, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
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

  const quantitiesTab = (
    <>
      <Table
        head={["SKU", "Product", "Qty"]}
        widths={[LIST_WIDTHS.code, undefined, LIST_WIDTHS.qty]}
        align={["left", "left", "right"]}
        empty="No quantities recorded yet."
        rows={quantities.map((q) => [<Code key="c">{q.code}</Code>, q.name, String(q.qty)])}
      />
      {canManage && !lot.legacyCode ? (
        <details className="mt-4" open={!lot.quantitiesKnown}>
          <summary className="cursor-pointer text-sm text-navy">{lot.quantitiesKnown ? "Correct quantities" : "Confirm quantities from the host's sheet"}</summary>
          <form action={confirmLotQuantitiesAction} className="mt-3 max-w-2xl space-y-3">
            <input type="hidden" name="lotId" value={lot.id} />
            <table className="w-full text-[13px]">
              <tbody>
                {forForm.map((s) => (
                  <tr key={s.id} className="border-b border-rule-soft">
                    <td className="py-1 pr-2">
                      <Code>{s.code}</Code>
                    </td>
                    <td className="py-1 pr-2">
                      {s.brand} {s.name}
                    </td>
                    <td className="w-28 py-1 text-right">
                      <Input name={`qty:${s.id}`} type="number" min={0} step={1} inputMode="numeric" className="h-8 w-24 text-right" defaultValue={qtyOf.get(s.id) ?? ""} aria-label={`${s.code} quantity`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Field label="Note">
              <Input name="note" placeholder="e.g. Host packaging sheet received 2026-10-30" />
            </Field>
            <Button small>Confirm quantities</Button>
            <p className="text-xs text-ink-3">Replaces the quantities on this lot and resolves the open exception (4.6). Blank SKUs are left off.</p>
          </form>
        </details>
      ) : null}
    </>
  );

  const shipmentsTab = (
    <Table
      head={["Shipment", "Type", "Scheduled", "Status", "SKU", "Qty"]}
      widths={[LIST_WIDTHS.number, LIST_WIDTHS.type, LIST_WIDTHS.date, LIST_WIDTHS.status, LIST_WIDTHS.code, LIST_WIDTHS.qty]}
      align={["left", "left", "left", "left", "left", "right"]}
      empty="Not on any shipment yet."
      rows={usedOn.map((u, i) => [
        <Link key={i} href={`/shipments/${u.s.id}`} className="font-medium text-navy hover:underline">
          {shipmentNumber(u.s)}
        </Link>,
        u.s.type,
        fmtDay(u.s.scheduledDate),
        <StatusBadge key="s" value={u.s.status} />,
        u.skuCode ? <Code key="k">{u.skuCode}</Code> : "—",
        String(u.qty),
      ])}
    />
  );

  return (
    <RecordPage
      number={lot.lotCode}
      status={lot.quantitiesKnown ? <span className="font-semibold text-navy">Quantities known</span> : <span className="text-ink-2">Quantities unconfirmed</span>}
      meta={
        <>
          <span>{facility?.name ?? "—"}</span>
          <span>
            {lot.brandCode}
            {brand ? ` ${brand.name}` : ""}
          </span>
          <span>packaged {fmtDay(lot.packagingDate)}</span>
          {lot.legacyCode ? <span className="text-ink-3">history only</span> : null}
        </>
      }
    >
      <Flash {...flash} />
      {lot.legacyCode ? <Notice tone="info">Dotted legacy lot {lot.legacyCode}: imported history, never offered on a shipment line (1.7).</Notice> : null}
      <Columns>
        <Card title="Lot">
          <KV
            items={[
              ["Lot code", <Code key="c">{lot.lotCode}</Code>],
              ["Facility", facility ? `${facility.lotFacilityCode ? facility.lotFacilityCode + " " : ""}${facility.name}` : "—"],
              ["Brand", `${lot.brandCode}${brand ? ` ${brand.name}` : ""}`],
              ["Packaging date", fmtDay(lot.packagingDate)],
              ["Run", lot.runCode],
              ["Source", lot.source.replace(/_/g, " ")],
              ["Batch", batch ? <Link key="b" href={`/batches?focus=${batch.id}`} className="text-navy hover:underline">{batch.batchNumber}</Link> : "—"],
              ["Recorded", fmtDate(lot.createdAt)],
            ]}
          />
        </Card>
        <Card title="Batch and notes">
          {batch ? (
            <KV
              items={[
                ["Batch", batch.batchNumber],
                ["Status", <StatusBadge key="s" value={batch.status} />],
                ["Brewed", batch.brewDate ? fmtDay(batch.brewDate) : "—"],
                ["Vessel", batch.vesselSize ?? "—"],
                ["Brewery batch number", batch.breweryBatchNumber ?? "—"],
              ]}
            />
          ) : (
            <Empty>No batch linked.</Empty>
          )}
          <div className="mt-4 text-sm">
            <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Notes</div>
            <div className="whitespace-pre-line">{lot.notes ?? "—"}</div>
          </div>
        </Card>
      </Columns>
      <Tabs
        tabs={[
          { id: "quantities", label: "Quantities packaged", count: quantities.length, content: quantitiesTab },
          { id: "shipments", label: "Shipments using this lot", count: usedOn.length, content: shipmentsTab },
        ]}
      />
    </RecordPage>
  );
}
