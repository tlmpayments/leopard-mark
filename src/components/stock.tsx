import type { StockRow } from "@/lib/domain/allocation/onhand";
import { Badge, Table, fmtDate } from "./ui";

/** One location's stock, a row per SKU: the table on Markets & stock and on a location's Stock on hand page. */
export function WarehouseStockTable({ rows, skuName }: { rows: StockRow[]; skuName: (skuId: string) => string }) {
  return (
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
  );
}
