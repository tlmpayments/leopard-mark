/**
 * What an account has cost us in goods given away (Round 3): POS items at their unit cost and sample beer at the
 * SKU's unit cost, over shipments that left (confirmed onward, not voided, not legacy). POS is cost-tracked even
 * when it is also charged on the invoice; the charge is revenue, the cost is still spend on the account.
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";

export interface AccountSpend {
  posUnits: number;
  posCostCents: number;
  sampleUnits: number;
  sampleCostCents: number;
  totalCents: number;
  /** Units shipped whose item has no unit cost yet, so the total understates the spend. */
  uncostedUnits: number;
}

const LEFT = ["confirmed", "staged", "out", "delivered"] as const;

export async function accountSpend(db: DbOrTx, locationId: string, opts: { since?: string } = {}): Promise<AccountSpend> {
  const where = [eq(schema.shipment.destinationLocationId, locationId), inArray(schema.shipment.status, [...LEFT]), eq(schema.shipment.legacy, false)];
  if (opts.since) where.push(gte(schema.shipment.scheduledDate, opts.since));
  const rows = await db
    .select({
      type: schema.shipment.type,
      qty: schema.shipmentLine.qty,
      deliveredQty: schema.shipmentLine.deliveredQty,
      posItemId: schema.shipmentLine.posItemId,
      posCost: schema.posItem.unitCostCents,
      skuId: schema.shipmentLine.skuId,
      skuCost: schema.sku.unitCostCents,
    })
    .from(schema.shipmentLine)
    .innerJoin(schema.shipment, eq(schema.shipment.id, schema.shipmentLine.shipmentId))
    .leftJoin(schema.posItem, eq(schema.posItem.id, schema.shipmentLine.posItemId))
    .leftJoin(schema.sku, eq(schema.sku.id, schema.shipmentLine.skuId))
    .where(and(...where));
  const out: AccountSpend = { posUnits: 0, posCostCents: 0, sampleUnits: 0, sampleCostCents: 0, totalCents: 0, uncostedUnits: 0 };
  for (const r of rows) {
    const qty = r.deliveredQty ?? r.qty;
    if (qty <= 0) continue;
    if (r.posItemId) {
      out.posUnits += qty;
      if (r.posCost == null) out.uncostedUnits += qty;
      else out.posCostCents += qty * r.posCost;
    } else if (r.type === "S" && r.skuId) {
      out.sampleUnits += qty;
      if (r.skuCost == null) out.uncostedUnits += qty;
      else out.sampleCostCents += qty * r.skuCost;
    }
  }
  out.totalCents = out.posCostCents + out.sampleCostCents;
  return out;
}
