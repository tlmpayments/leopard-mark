/**
 * Batches and lots (decisions 4.1 to 4.10, 1.4, 1.7).
 *
 * Lot code = facility (2 digits) + brand (3 letters) + packaging date yymmdd + run (1 character), e.g. 01CNT2610071.
 * Traceability first: every beer line on a shipment names a lot chosen from a list; per-lot stock balances start with
 * the first packaging run entered here (4.1). A lot backfilled from the BOL log has unknown quantities until the host
 * confirms them; using it on a shipment is allowed with a reason (4.6).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { authorize } from "@/lib/authz/authorize";
import type { Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import { type DbOrTx, type Tx, withTx } from "@/lib/db/types";
import { BusinessError } from "@/lib/errors";
import { openException } from "@/lib/exceptions/service";
import { fillUnmetDemand, lockPosition } from "../allocation/service";

export type Lot = typeof schema.lot.$inferSelect;
export type BrewBatch = typeof schema.brewBatch.$inferSelect;
export type BatchStatus = (typeof schema.batchStatusEnum.enumValues)[number];

/** Brand codes used in lot codes and batch numbers. SLG replaces the retired SGB/SGS split (3.1, brief). Pickers show the active ones only (R2-33). */
export const BRAND_CODES: ReadonlyArray<{ code: string; name: string; active: boolean }> = [
  { code: "SLG", name: "Sunlight Groove", active: true },
  { code: "CNT", name: "Cantinesca", active: true },
  { code: "GSP", name: "Giro Splendido", active: false },
  { code: "SGB", name: "Sunlight Groove Bay Area (retired code)", active: false },
  { code: "SGS", name: "Sunlight Groove SoCal (retired code)", active: false },
  { code: "XHZ", name: "Experimental Hazy", active: false },
  { code: "XVN", name: "Experimental Vienna", active: false },
  { code: "XAL", name: "Experimental ALL", active: false },
];

/** What brand pickers and filters offer (R2-33): the two brands in production. Retired and experimental codes stay readable on history. */
export const ACTIVE_BRANDS = BRAND_CODES.filter((b) => b.active);

const LOT_RE = /^(\d{2})([A-Z]{3})(\d{6})([A-Z0-9])$/;

export function yymmdd(d: string): string {
  // d is an ISO date (YYYY-MM-DD)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new BusinessError("Date must be YYYY-MM-DD", { field: "packagingDate" });
  return `${m[1].slice(2)}${m[2]}${m[3]}`;
}

export function composeLotCode(facilityCode: string, brandCode: string, packagingDate: string, runCode: string): string {
  if (!/^\d{2}$/.test(facilityCode)) throw new BusinessError("Facility code must be two digits", { field: "facility" });
  if (!/^[A-Z]{3}$/.test(brandCode)) throw new BusinessError("Brand code must be three letters", { field: "brandCode" });
  if (!/^[A-Z0-9]$/.test(runCode)) throw new BusinessError("Run must be a single digit or letter", { field: "runCode" });
  return `${facilityCode}${brandCode}${yymmdd(packagingDate)}${runCode}`;
}

export function parseLotCode(code: string): { facilityCode: string; brandCode: string; packagingDate: string; runCode: string } | null {
  const m = LOT_RE.exec(code.trim().toUpperCase());
  if (!m) return null;
  const yy = m[3].slice(0, 2);
  const mm = m[3].slice(2, 4);
  const dd = m[3].slice(4, 6);
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { facilityCode: m[1], brandCode: m[2], packagingDate: `20${yy}-${mm}-${dd}`, runCode: m[4] };
}

// ---------------------------------------------------------------------------
// Batches (4.2, 4.10)
// ---------------------------------------------------------------------------

export async function createBatch(
  db: DbOrTx,
  actor: Actor,
  input: { facilityWarehouseId: string; brandCode: string; batchNumber?: string | null; brewDate?: string | null; barrels?: number | string | null; vesselSize?: string | null; status?: BatchStatus; breweryBatchNumber?: string | null; notes?: string | null; source?: "imported" | "entered" },
) {
  authorize(actor, "lot.manage");
  const [facility] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, input.facilityWarehouseId));
  if (!facility) throw new BusinessError("Facility not found");
  if (facility.kind !== "brewery") throw new BusinessError(`${facility.name} is not a brewery; batches are brewed at a lot facility`, { field: "facilityWarehouseId" });
  const brandCode = input.brandCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(brandCode)) throw new BusinessError("Brand code must be three letters", { field: "brandCode" });
  if (input.brewDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.brewDate)) throw new BusinessError("Brew date must be YYYY-MM-DD", { field: "brewDate" });
  let barrels: string | null = null;
  if (input.barrels !== undefined && input.barrels !== null && input.barrels !== "") {
    const n = Number(input.barrels);
    if (!Number.isFinite(n) || n <= 0) throw new BusinessError("Batch size is in barrels, more than zero", { field: "barrels" });
    barrels = n.toFixed(2);
  }
  // R2-26: the number follows the brewery's convention, B + facility + brand + yy + sequence, when none is typed.
  const year = (input.brewDate ?? new Date().toISOString().slice(0, 10)).slice(0, 4);
  let batchNumber = input.batchNumber?.trim().toUpperCase() ?? "";
  if (!batchNumber) {
    if (!facility.lotFacilityCode) throw new BusinessError(`${facility.name} has no lot facility code yet (Admin: Markets & stock)`, { field: "facilityWarehouseId" });
    const prefix = `B${facility.lotFacilityCode}${brandCode}${year.slice(2)}`;
    const existing = await db.select({ n: schema.brewBatch.batchNumber }).from(schema.brewBatch).where(sql`${schema.brewBatch.batchNumber} like ${prefix + "%"}`);
    const seq = existing.reduce((m, r) => Math.max(m, Number(r.n.slice(prefix.length)) || 0), 0) + 1;
    batchNumber = `${prefix}${String(seq).padStart(3, "0")}`;
  }
  const [row] = await db
    .insert(schema.brewBatch)
    .values({
      facilityWarehouseId: input.facilityWarehouseId,
      brandCode,
      batchNumber,
      brewDate: input.brewDate ?? null,
      barrels,
      vesselSize: input.vesselSize ?? null,
      status: input.status ?? "scheduled",
      breweryBatchNumber: input.breweryBatchNumber ?? null,
      notes: input.notes ?? null,
      source: input.source ?? "entered",
      createdByEmployeeId: actor.employeeId,
    })
    .onConflictDoNothing({ target: schema.brewBatch.batchNumber })
    .returning();
  if (!row) throw new BusinessError(`Batch ${batchNumber} already exists`, { field: "batchNumber" });
  await recordAudit(db, actor, { action: "batch.create", subjectType: "brew_batch", subjectId: row.id, current: input, marketId: facility.marketId });
  return row;
}

/** Status with reason and date; destroyed and cancelled batches keep the record (4.10). */
export async function setBatchStatus(db: DbOrTx, actor: Actor, batchId: string, status: BatchStatus, reason: string | null, on: string) {
  authorize(actor, "lot.manage");
  const [prior] = await db.select().from(schema.brewBatch).where(eq(schema.brewBatch.id, batchId));
  if (!prior) throw new BusinessError("Batch not found");
  if ((status === "destroyed" || status === "cancelled") && !reason?.trim()) throw new BusinessError("A reason is required when a batch is destroyed or cancelled", { field: "reason" });
  const [row] = await db
    .update(schema.brewBatch)
    .set({ status, statusReason: reason?.trim() || null, statusChangedOn: on })
    .where(eq(schema.brewBatch.id, batchId))
    .returning();
  await recordAudit(db, actor, { action: "batch.status", subjectType: "brew_batch", subjectId: batchId, prior: { status: prior.status }, current: { status, reason, on } });
  return row;
}

export async function listBatches(db: DbOrTx, opts: { facilityWarehouseId?: string } = {}) {
  const q = db.select().from(schema.brewBatch).orderBy(desc(schema.brewBatch.brewDate), asc(schema.brewBatch.batchNumber));
  return opts.facilityWarehouseId ? q.where(eq(schema.brewBatch.facilityWarehouseId, opts.facilityWarehouseId)) : q;
}

// ---------------------------------------------------------------------------
// Lots (4.1, 4.3, 4.4, 4.5 open, 4.6, 4.9)
// ---------------------------------------------------------------------------

export interface PackagingReportInput {
  facilityWarehouseId: string;
  brandCode: string;
  packagingDate: string; // YYYY-MM-DD
  runCode: string; // one digit; letters only for experimental variants
  batchId?: string | null;
  quantities: Array<{ skuId: string; qty: number }>;
  notes?: string | null;
  source?: "packaging_report" | "production_tab" | "bol_log_backfill";
  quantitiesKnown?: boolean;
  legacyCode?: string | null;
}

/** Barrels per selling unit, for the packaged total and loss shown on the packaging report (R2-22). One barrel is 31 gallons. */
export const BARRELS_PER_UNIT: Record<string, number> = {
  case_12oz_can: (24 * 12) / (31 * 128), // 2.25 gal
  case_24oz_can: (12 * 24) / (31 * 128), // 2.25 gal
  keg_sixtel: 1 / 6,
  keg_half: 0.5,
};

/**
 * Packaged units go on hand at the brewery (R2-21): the inbound movement is posted per SKU quantity, lot attached, so
 * on hand rises before any transfer. Internal kind: never written from the stock form.
 */
async function postPackagingStock(tx: Tx, actor: Actor, input: { warehouseId: string; skuId: string; qty: number; lotId: string; lotCode: string; packagedOn: string }) {
  if (input.qty <= 0) return;
  const pos = await lockPosition(tx, input.warehouseId, input.skuId);
  const next = pos.onHandQty + input.qty;
  await tx
    .update(schema.stockPosition)
    .set({ onHandQty: next, evidenceSource: `Packaging report ${input.lotCode} (${input.packagedOn})`, evidenceAt: new Date(), confirmedByEmployeeId: actor.employeeId, updatedAt: new Date() })
    .where(eq(schema.stockPosition.id, pos.id));
  await tx.insert(schema.stockMovement).values({
    warehouseId: input.warehouseId,
    skuId: input.skuId,
    kind: "packaging",
    qtyDelta: input.qty,
    evidence: `Packaging report ${input.lotCode} (${input.packagedOn})`,
    referenceType: "lot",
    referenceId: input.lotId,
    actorEmployeeId: actor.employeeId,
    lotId: input.lotId,
  });
  await recordAudit(tx, actor, { action: "stock.movement", subjectType: "stock_position", subjectId: pos.id, prior: { onHandQty: pos.onHandQty }, current: { onHandQty: next, kind: "packaging", qtyDelta: input.qty, lotCode: input.lotCode } });
  await fillUnmetDemand(tx, actor, input.warehouseId, input.skuId);
}

/** Add quantities to a lot's running totals and keep one entry per SKU per packaging day (R2-21). */
async function addLotQuantities(tx: Tx, actor: Actor, l: Lot, packagedOn: string, quantities: Array<{ skuId: string; qty: number }>, note: string | null, postStock: boolean) {
  const seen = new Set<string>();
  for (const q of quantities) {
    if (seen.has(q.skuId)) throw new BusinessError("Each SKU appears once per packaging day", { field: "quantities" });
    seen.add(q.skuId);
    if (!Number.isInteger(q.qty) || q.qty < 0) throw new BusinessError("Quantities must be whole numbers of zero or more", { field: "quantities" });
    if (q.qty === 0) continue;
    await tx
      .insert(schema.lotSkuQty)
      .values({ lotId: l.id, skuId: q.skuId, qtyPackaged: q.qty })
      .onConflictDoUpdate({ target: [schema.lotSkuQty.lotId, schema.lotSkuQty.skuId], set: { qtyPackaged: sql`${schema.lotSkuQty.qtyPackaged} + ${q.qty}` } });
    await tx.insert(schema.lotPackagingEntry).values({ lotId: l.id, packagedOn, skuId: q.skuId, qty: q.qty, note, recordedByEmployeeId: actor.employeeId });
    if (postStock) await postPackagingStock(tx, actor, { warehouseId: l.facilityWarehouseId, skuId: q.skuId, qty: q.qty, lotId: l.id, lotCode: l.lotCode, packagedOn });
  }
}

/**
 * The one-page packaging report (4.4): the office enters what the host reports; the lot code is computed, never typed.
 * A lot almost always holds several SKUs (4.3). One lot per batch (R2-21): when the chosen batch already has a lot,
 * the quantities are added to that lot as a later packaging day and the lot keeps its first day's code; the run digit
 * changes only for a different brew. Packaged units go on hand at the brewery (R2-21).
 */
export async function recordPackagingReport(db: DbOrTx, actor: Actor, input: PackagingReportInput) {
  authorize(actor, "lot.manage");
  const [facility] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, input.facilityWarehouseId));
  if (!facility) throw new BusinessError("Facility not found");
  if (!facility.lotFacilityCode) throw new BusinessError(`${facility.name} has no lot facility code; set it on the origin before recording a packaging run`, { field: "facilityWarehouseId" });
  const brandCode = input.brandCode.trim().toUpperCase();
  const runCode = input.runCode.trim().toUpperCase();
  isoPackagingDate(input.packagingDate);
  const quantitiesKnown = input.quantitiesKnown ?? true;
  if (quantitiesKnown && input.quantities.length === 0) throw new BusinessError("Enter the quantities packaged per SKU (or mark quantities as not yet known)", { field: "quantities" });
  for (const q of input.quantities) {
    if (!Number.isInteger(q.qty) || q.qty < 0) throw new BusinessError("Quantities must be whole numbers of zero or more", { field: "quantities" });
  }
  let batch: BrewBatch | null = null;
  if (input.batchId) {
    const [b] = await db.select().from(schema.brewBatch).where(eq(schema.brewBatch.id, input.batchId));
    if (!b) throw new BusinessError("Batch not found", { field: "batchId" });
    if (b.facilityWarehouseId !== input.facilityWarehouseId) throw new BusinessError("The batch was brewed at a different facility", { field: "batchId" });
    batch = b;
  }
  const source = input.source ?? "packaging_report";
  const postStock = source === "packaging_report" && quantitiesKnown;
  return withTx(db, async (tx) => {
    if (batch) {
      const [existingForBatch] = await tx.select().from(schema.lot).where(and(eq(schema.lot.batchId, batch.id), isNull(schema.lot.legacyCode))).orderBy(asc(schema.lot.packagingDate)).limit(1);
      if (existingForBatch) {
        if (input.packagingDate < existingForBatch.packagingDate) throw new BusinessError(`Lot ${existingForBatch.lotCode} is dated ${existingForBatch.packagingDate}; a later packaging day cannot be earlier than the first`, { field: "packagingDate" });
        await addLotQuantities(tx, actor, existingForBatch, input.packagingDate, input.quantities, input.notes ?? null, postStock);
        if (input.notes) await tx.update(schema.lot).set({ notes: `${existingForBatch.notes ? existingForBatch.notes + "\n" : ""}${input.notes}` }).where(eq(schema.lot.id, existingForBatch.id));
        await recordAudit(tx, actor, { action: "lot.packaging_day", subjectType: "lot", subjectId: existingForBatch.id, current: { lotCode: existingForBatch.lotCode, packagedOn: input.packagingDate, quantities: input.quantities, batch: batch.batchNumber }, marketId: facility.marketId });
        return mustLoadLot(tx, existingForBatch.id);
      }
    }
    const lotCode = composeLotCode(facility.lotFacilityCode!, brandCode, input.packagingDate, runCode);
    const [existing] = await tx.select().from(schema.lot).where(eq(schema.lot.lotCode, lotCode));
    if (existing) throw new BusinessError(`Lot ${lotCode} already exists; use the next run digit for a different brew on the same day`, { field: "runCode" });
    const [row] = await tx
      .insert(schema.lot)
      .values({
        lotCode,
        facilityWarehouseId: input.facilityWarehouseId,
        brandCode,
        packagingDate: input.packagingDate,
        runCode,
        batchId: batch?.id ?? null,
        quantitiesKnown,
        source,
        legacyCode: input.legacyCode ?? null,
        notes: input.notes ?? null,
        createdByEmployeeId: actor.employeeId,
      })
      .returning();
    await addLotQuantities(tx, actor, row, input.packagingDate, input.quantities, null, postStock);
    if (batch) {
      await tx.update(schema.brewBatch).set({ status: "complete", statusChangedOn: input.packagingDate }).where(and(eq(schema.brewBatch.id, batch.id), inArray(schema.brewBatch.status, ["scheduled", "in_progress"])));
    }
    await recordAudit(tx, actor, {
      action: "lot.create",
      subjectType: "lot",
      subjectId: row.id,
      current: { lotCode, facility: facility.name, quantities: input.quantities, quantitiesKnown, source, stockPosted: postStock },
      marketId: facility.marketId,
    });
    if (!quantitiesKnown) {
      await openException(tx, actor, {
        category: "lot_quantities_unconfirmed",
        title: `Lot ${lotCode}: quantities not yet confirmed by the host`,
        cause: "The lot appears on shipments or in the packaging record without packaged quantities per SKU (decision 1.4, 4.6).",
        marketId: facility.marketId,
        ownerRole: "admin",
        nextAction: `Ask ${facility.name} for the packaging sheet and enter quantities on the lot.`,
        dedupeKey: `lot_quantities_unconfirmed:${row.id}`,
        links: [{ subjectType: "lot", subjectId: row.id }],
      });
    }
    return row;
  });
}

function isoPackagingDate(d: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BusinessError("Date must be YYYY-MM-DD", { field: "packagingDate" });
}

async function mustLoadLot(db: DbOrTx, id: string): Promise<Lot> {
  const [l] = await db.select().from(schema.lot).where(eq(schema.lot.id, id));
  if (!l) throw new BusinessError("Lot not found");
  return l;
}

/** A later packaging day on an existing lot (R2-21): quantities are added, the lot keeps its first day's code, stock goes on hand at the brewery. */
export async function addPackagingDay(db: DbOrTx, actor: Actor, lotId: string, input: { packagedOn: string; quantities: Array<{ skuId: string; qty: number }>; note?: string | null }) {
  authorize(actor, "lot.manage");
  const l = await mustLoadLot(db, lotId);
  if (l.legacyCode) throw new BusinessError("A dotted legacy lot is history only (1.7)");
  isoPackagingDate(input.packagedOn);
  if (input.packagedOn < l.packagingDate) throw new BusinessError(`Lot ${l.lotCode} is dated ${l.packagingDate}; a later packaging day cannot be earlier than the first`, { field: "packagedOn" });
  if (!input.quantities.some((q) => q.qty > 0)) throw new BusinessError("Enter at least one quantity packaged on this day", { field: "quantities" });
  const [facility] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, l.facilityWarehouseId));
  return withTx(db, async (tx) => {
    await addLotQuantities(tx, actor, l, input.packagedOn, input.quantities, input.note ?? null, l.source === "packaging_report" && l.quantitiesKnown);
    await recordAudit(tx, actor, { action: "lot.packaging_day", subjectType: "lot", subjectId: l.id, current: { lotCode: l.lotCode, packagedOn: input.packagedOn, quantities: input.quantities, note: input.note ?? null }, marketId: facility?.marketId ?? null });
    return mustLoadLot(tx, l.id);
  });
}

/** Batch size, packaged total and the gap shown as loss (R2-22); nothing is tracked further. */
export async function lotYield(db: DbOrTx, lotId: string): Promise<{ batchBarrels: number | null; packagedBarrels: number; lossBarrels: number | null; packagedUnits: number }> {
  const [l] = await db.select().from(schema.lot).where(eq(schema.lot.id, lotId));
  if (!l) throw new BusinessError("Lot not found");
  const rows = await db
    .select({ qty: schema.lotSkuQty.qtyPackaged, packageKind: schema.sku.packageKind })
    .from(schema.lotSkuQty)
    .innerJoin(schema.sku, eq(schema.sku.id, schema.lotSkuQty.skuId))
    .where(eq(schema.lotSkuQty.lotId, lotId));
  const packagedBarrels = rows.reduce((s, r) => s + r.qty * (BARRELS_PER_UNIT[r.packageKind] ?? 0), 0);
  const packagedUnits = rows.reduce((s, r) => s + r.qty, 0);
  const [batch] = l.batchId ? await db.select().from(schema.brewBatch).where(eq(schema.brewBatch.id, l.batchId)) : [];
  const batchBarrels = batch?.barrels != null ? Number(batch.barrels) : null;
  return { batchBarrels, packagedBarrels: Math.round(packagedBarrels * 100) / 100, lossBarrels: batchBarrels != null ? Math.round((batchBarrels - packagedBarrels) * 100) / 100 : null, packagedUnits };
}

export async function listPackagingEntries(db: DbOrTx, lotId: string) {
  return db
    .select({ entry: schema.lotPackagingEntry, code: schema.sku.code, name: schema.sku.name })
    .from(schema.lotPackagingEntry)
    .innerJoin(schema.sku, eq(schema.sku.id, schema.lotPackagingEntry.skuId))
    .where(eq(schema.lotPackagingEntry.lotId, lotId))
    .orderBy(asc(schema.lotPackagingEntry.packagedOn), asc(schema.sku.code));
}

/**
 * The lot to prefill on a shipment line (R2-1): oldest first among lots with units still on hand at the origin by
 * the ledger (movements carry the lot); at a brewery that has not counted by lot yet, the oldest non-legacy lot of
 * the SKU with packaged units not yet shipped. Null when nothing fits; the office picks.
 */
export async function suggestLot(db: DbOrTx, warehouseId: string, skuId: string): Promise<{ lotId: string; lotCode: string } | null> {
  const byLedger = await db
    .select({ lotId: schema.stockMovement.lotId, onHand: sql<number>`coalesce(sum(${schema.stockMovement.qtyDelta}), 0)::int` })
    .from(schema.stockMovement)
    .where(and(eq(schema.stockMovement.warehouseId, warehouseId), eq(schema.stockMovement.skuId, skuId), sql`${schema.stockMovement.lotId} is not null`))
    .groupBy(schema.stockMovement.lotId);
  const positive = byLedger.filter((r) => r.lotId && r.onHand > 0).map((r) => r.lotId!);
  if (positive.length) {
    const [oldest] = await db
      .select({ id: schema.lot.id, lotCode: schema.lot.lotCode })
      .from(schema.lot)
      .where(and(inArray(schema.lot.id, positive), isNull(schema.lot.legacyCode)))
      .orderBy(asc(schema.lot.packagingDate), asc(schema.lot.lotCode))
      .limit(1);
    if (oldest) return { lotId: oldest.id, lotCode: oldest.lotCode };
  }
  const candidates = await db
    .select({ id: schema.lot.id, lotCode: schema.lot.lotCode, packaged: schema.lotSkuQty.qtyPackaged })
    .from(schema.lotSkuQty)
    .innerJoin(schema.lot, eq(schema.lot.id, schema.lotSkuQty.lotId))
    .where(and(eq(schema.lotSkuQty.skuId, skuId), eq(schema.lot.facilityWarehouseId, warehouseId), isNull(schema.lot.legacyCode), eq(schema.lot.quantitiesKnown, true)))
    .orderBy(asc(schema.lot.packagingDate), asc(schema.lot.lotCode));
  for (const c of candidates) {
    const [{ shipped }] = await db
      .select({ shipped: sql<number>`coalesce(sum(${schema.shipmentLine.qty}), 0)::int` })
      .from(schema.shipmentLine)
      .innerJoin(schema.shipment, eq(schema.shipment.id, schema.shipmentLine.shipmentId))
      .where(and(eq(schema.shipmentLine.lotId, c.id), eq(schema.shipmentLine.skuId, skuId), sql`${schema.shipment.status} <> 'voided'`));
    if (c.packaged - shipped > 0) return { lotId: c.id, lotCode: c.lotCode };
  }
  return null;
}

/** The host confirms quantities for a backfilled lot; the exception resolves (4.6). */
export async function confirmLotQuantities(db: DbOrTx, actor: Actor, lotId: string, quantities: Array<{ skuId: string; qty: number }>, note?: string) {
  authorize(actor, "lot.manage");
  const [l] = await db.select().from(schema.lot).where(eq(schema.lot.id, lotId));
  if (!l) throw new BusinessError("Lot not found");
  if (quantities.length === 0) throw new BusinessError("Enter at least one SKU quantity", { field: "quantities" });
  return withTx(db, async (tx) => {
    await tx.delete(schema.lotSkuQty).where(eq(schema.lotSkuQty.lotId, lotId));
    for (const q of quantities) {
      if (!Number.isInteger(q.qty) || q.qty < 0) throw new BusinessError("Quantities must be whole numbers of zero or more", { field: "quantities" });
      await tx.insert(schema.lotSkuQty).values({ lotId, skuId: q.skuId, qtyPackaged: q.qty });
    }
    const [row] = await tx.update(schema.lot).set({ quantitiesKnown: true, notes: note ? `${l.notes ? l.notes + "\n" : ""}${note}` : l.notes }).where(eq(schema.lot.id, lotId)).returning();
    await recordAudit(tx, actor, { action: "lot.confirm_quantities", subjectType: "lot", subjectId: lotId, prior: { quantitiesKnown: l.quantitiesKnown }, current: { quantities, note } });
    const open = await tx
      .select()
      .from(schema.exceptionCase)
      .where(and(eq(schema.exceptionCase.dedupeKey, `lot_quantities_unconfirmed:${lotId}`), sql`${schema.exceptionCase.state} <> 'resolved'`));
    for (const c of open) {
      await tx.update(schema.exceptionCase).set({ state: "resolved", resolution: "Quantities confirmed by the host", resolvedAt: new Date() }).where(eq(schema.exceptionCase.id, c.id));
    }
    return row;
  });
}

export async function getLot(db: DbOrTx, lotId: string) {
  const [l] = await db.select().from(schema.lot).where(eq(schema.lot.id, lotId));
  if (!l) return null;
  const quantities = await db
    .select({ skuId: schema.lotSkuQty.skuId, qty: schema.lotSkuQty.qtyPackaged, code: schema.sku.code, name: schema.sku.name })
    .from(schema.lotSkuQty)
    .innerJoin(schema.sku, eq(schema.sku.id, schema.lotSkuQty.skuId))
    .where(eq(schema.lotSkuQty.lotId, lotId));
  const [facility] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, l.facilityWarehouseId));
  const [batch] = l.batchId ? await db.select().from(schema.brewBatch).where(eq(schema.brewBatch.id, l.batchId)) : [];
  return { lot: l, quantities, facility: facility ?? null, batch: batch ?? null };
}

export async function lotByCode(db: DbOrTx, code: string) {
  const [l] = await db.select().from(schema.lot).where(eq(schema.lot.lotCode, code.trim().toUpperCase()));
  return l ?? null;
}

export interface LotListOptions {
  facilityWarehouseId?: string;
  brandCode?: string;
  includeLegacy?: boolean;
  limit?: number;
}

export async function listLots(db: DbOrTx, opts: LotListOptions = {}) {
  const conds = [];
  if (opts.facilityWarehouseId) conds.push(eq(schema.lot.facilityWarehouseId, opts.facilityWarehouseId));
  if (opts.brandCode) conds.push(eq(schema.lot.brandCode, opts.brandCode));
  if (!opts.includeLegacy) conds.push(isNull(schema.lot.legacyCode));
  return db
    .select()
    .from(schema.lot)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.lot.packagingDate), asc(schema.lot.lotCode))
    .limit(opts.limit ?? 500);
}

export interface LotPickerOption {
  lotId: string;
  lotCode: string;
  brandCode: string;
  packagingDate: string;
  facilityName: string;
  quantitiesKnown: boolean;
  /** Days since packaging (4.8: internal only, never printed). */
  ageDays: number;
}

/**
 * Lots offered on a shipment line (4.1, 1.7): dotted legacy lots never appear; backfilled lots with unknown
 * quantities appear flagged so the line can carry a reason (4.6). Ordered newest first within a brand.
 */
export async function lotPickerOptions(db: DbOrTx, opts: { brandCode?: string; today?: Date } = {}): Promise<LotPickerOption[]> {
  const rows = await db
    .select({ lot: schema.lot, facilityName: schema.warehouse.name })
    .from(schema.lot)
    .innerJoin(schema.warehouse, eq(schema.warehouse.id, schema.lot.facilityWarehouseId))
    .where(and(isNull(schema.lot.legacyCode), opts.brandCode ? eq(schema.lot.brandCode, opts.brandCode) : undefined))
    .orderBy(desc(schema.lot.packagingDate), asc(schema.lot.lotCode))
    .limit(400);
  const today = opts.today ?? new Date();
  return rows.map((r) => ({
    lotId: r.lot.id,
    lotCode: r.lot.lotCode,
    brandCode: r.lot.brandCode,
    packagingDate: r.lot.packagingDate,
    facilityName: r.facilityName,
    quantitiesKnown: r.lot.quantitiesKnown,
    ageDays: Math.max(0, Math.floor((today.getTime() - new Date(r.lot.packagingDate + "T00:00:00Z").getTime()) / 86_400_000)),
  }));
}

/** Brand code for a SKU: the first three letters of the active 10-character code (SLG, CNT); legacy codes map through aliases. */
export function brandCodeForSku(skuCode: string): string {
  const code = skuCode.trim().toUpperCase();
  const brand = code.slice(0, 3);
  if (brand === "SGB" || brand === "SGS") return "SLG";
  return brand;
}

/** Does this SKU belong to a brand in production (R2-33)? By brand code in the SKU code, or by the brand's name. */
export function skuBrandActive(sku: { code: string; brand: string }): boolean {
  const code = brandCodeForSku(sku.code);
  const name = sku.brand.trim().toLowerCase();
  return ACTIVE_BRANDS.some((b) => b.code === code || b.name.toLowerCase() === name);
}
