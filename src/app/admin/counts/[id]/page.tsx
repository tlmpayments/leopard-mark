import { notFound } from "next/navigation";
import { Button, Card, Flash, KV, Notice, Page, StatusBadge, Table, fmtDate, fmtDay } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { getCountSession } from "@/lib/domain/counts/service";
import { warehouseAvailability } from "@/lib/domain/allocation/service";
import { applyCountSessionAction } from "../actions";

export default async function CountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const d = await getDb();
  const detail = /^[0-9a-f-]{36}$/i.test(id) ? await getCountSession(d, id) : null;
  if (!detail) notFound();
  const { session, lines, warehouse } = detail;
  await requireAction("count.record", warehouse?.marketId ?? null);
  const flash = await flashFrom(searchParams);
  const positions = await warehouseAvailability(d, session.warehouseId);
  const totals = new Map<string, number>();
  for (const { l } of lines) totals.set(l.skuId, (totals.get(l.skuId) ?? 0) + l.qty);

  return (
    <Page
      title={`Count ${fmtDay(session.countedOn)} at ${warehouse?.name ?? "origin"}`}
      subtitle={
        <span className="flex items-center gap-2">
          <StatusBadge value={session.status} />
          {session.countedBy ? <span>counted by {session.countedBy}</span> : null}
        </span>
      }
      actions={
        <Button href="/admin/counts" variant="secondary">
          All counts
        </Button>
      }
    >
      <Flash {...flash} />
      <Card title="Sheet">
        <KV items={[["Origin", warehouse ? `${warehouse.originCode ? warehouse.originCode + " · " : ""}${warehouse.name}` : "—"], ["Counted on", fmtDay(session.countedOn)], ["Counted by", session.countedBy], ["Note", session.note], ["Entered", fmtDate(session.createdAt)], ["Applied", session.appliedAt ? fmtDate(session.appliedAt) : "not yet"]]} />
      </Card>
      <Card title="Lines">
        <Table caption="Count lines" head={["SKU", "Product", "Lot code", "Counted"]} rows={lines.map(({ l, sku }) => [<span key="c" className="font-mono text-xs">{sku.code}</span>, `${sku.brand} ${sku.name}`, l.lotCode ?? "—", String(l.qty)])} />
      </Card>
      <Card title={session.status === "draft" ? "What applying will do" : "Totals applied"}>
        <Table
          caption="Per SKU totals against the current position"
          head={["SKU", "Counted total", "On hand now", "Change"]}
          rows={Array.from(totals.entries()).map(([skuId, qty]) => {
            const sku = lines.find((x) => x.l.skuId === skuId)?.sku;
            const pos = positions.find((p) => p.skuId === skuId);
            const onHand = pos?.onHandQty ?? 0;
            return [sku?.code ?? skuId, String(qty), String(onHand), session.status === "draft" ? `${qty - onHand >= 0 ? "+" : ""}${qty - onHand}` : "applied"];
          })}
        />
        {session.status === "draft" ? (
          <form action={applyCountSessionAction} className="mt-3">
            <input type="hidden" name="sessionId" value={session.id} />
            <Button>Apply count</Button>
            <p className="mt-1 text-xs text-muted">One count movement per SKU brings on hand to the counted total; waiting demand is re-filled oldest first when stock increases. Applying is recorded once and audited (9.8).</p>
          </form>
        ) : (
          <Notice tone="good">Applied {fmtDate(session.appliedAt)}.</Notice>
        )}
      </Card>
    </Page>
  );
}
