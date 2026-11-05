/**
 * Stock on hand across locations: one row per SKU, one column per location that has a stock position. Every figure
 * comes from warehouseAvailability, the same computation as the per-warehouse stock on Markets & stock, so there is
 * one definition of available (on hand minus reserved and allocated, never below zero).
 */
import type * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { warehouseAvailability } from "./service";

export type StockRow = Awaited<ReturnType<typeof warehouseAvailability>>[number];
type Warehouse = typeof schema.warehouse.$inferSelect;

export interface StockFigures {
  onHandQty: number;
  reservedQty: number;
  availableQty: number;
  /** Reserved beyond what is on hand (a recorded shortfall). */
  deficitQty: number;
  inTransitQty: number;
  unavailableQty: number;
}

export interface StockLocation {
  warehouse: Warehouse;
  rows: StockRow[];
}

export interface StockGridRow<S> {
  sku: S;
  /** One per location, in the order given; null where the location holds nothing of the SKU. */
  cells: Array<StockFigures | null>;
  total: StockFigures | null;
}

/** The locations given that have at least one stock position, each with its rows from warehouseAvailability. */
export async function stockByLocation(db: DbOrTx, warehouses: Warehouse[]): Promise<StockLocation[]> {
  const stock = await Promise.all(warehouses.map(async (w) => ({ warehouse: w, rows: await warehouseAvailability(db, w.id) })));
  return stock.filter((s) => s.rows.length > 0);
}

/** Nothing on hand, reserved, in transit or set aside: shown as a blank cell, not a row of zeros. */
export function isEmptyStock(f: StockFigures | null | undefined): boolean {
  return !f || (f.onHandQty === 0 && f.reservedQty === 0 && f.inTransitQty === 0 && f.unavailableQty === 0);
}

function figures(r: StockRow): StockFigures {
  return { onHandQty: r.onHandQty, reservedQty: r.reservedQty, availableQty: r.availableQty, deficitQty: r.deficitQty, inTransitQty: r.inTransitQty, unavailableQty: r.unavailableQty };
}

function sum(cells: StockFigures[]): StockFigures {
  const t: StockFigures = { onHandQty: 0, reservedQty: 0, availableQty: 0, deficitQty: 0, inTransitQty: 0, unavailableQty: 0 };
  for (const c of cells) {
    t.onHandQty += c.onHandQty;
    t.reservedQty += c.reservedQty;
    t.availableQty += c.availableQty;
    t.deficitQty += c.deficitQty;
    t.inTransitQty += c.inTransitQty;
    t.unavailableQty += c.unavailableQty;
  }
  return t;
}

/** SKUs down the side, locations across, a total per SKU (the sum of the locations shown). Empty cells are null. */
export function stockGrid<S extends { id: string }>(skus: S[], locations: StockLocation[]): Array<StockGridRow<S>> {
  const bySku = locations.map((l) => new Map(l.rows.map((r) => [r.skuId, r])));
  return skus.map((sku) => {
    const cells = bySku.map((m) => {
      const r = m.get(sku.id);
      const f = r ? figures(r) : null;
      return isEmptyStock(f) ? null : f;
    });
    const filled = cells.filter((c): c is StockFigures => c !== null);
    return { sku, cells, total: filled.length ? sum(filled) : null };
  });
}
