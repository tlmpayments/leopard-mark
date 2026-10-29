/**
 * Batches and lots (decisions 4.1 to 4.10, 1.4, 1.7).
 *
 * Lot code = facility (2 digits) + brand (3 letters) + packaging date yymmdd + run (1 character), e.g. 01CNT2610071.
 * Traceability first: every beer line on a shipment names a lot chosen from a list; per-lot stock balances start with
 * the first packaging run entered here (4.1). A lot backfilled from the BOL log has unknown quantities until the host
 * confirms them; using it on a shipment is allowed with a reason (4.6).
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { authorize } from "@/lib/authz/authorize";
import type { Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import { type DbOrTx, withTx } from "@/lib/db/types";
import { BusinessError } from "@/lib/errors";
import { openException } from "@/lib/exceptions/service";

export type Lot = typeof schema.lot.$inferSelect;
export type BrewBatch = typeof schema.brewBatch.$inferSelect;
export type BatchStatus = (typeof schema.batchStatusEnum.enumValues)[number];

/** Brand codes used in lot codes and batch numbers. SLG replaces the retired SGB/SGS split (3.1, brief). */
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
  input: { facilityWarehouseId: string; brandCode: string; batchNumber: string; brewDate?: string | null; vesselSize?: string | null; status?: BatchStatus; breweryBatchNumber?: string | null; notes?: string | null; source?: "imported" | "entered" },
) {
  authorize(actor, "lot.manage");
  const batchNumber = input.batchNumber.trim().toUpperCase();
  if (!batchNumber) throw new BusinessError("Batch number is required", { field: "batchNumber" });
  const [facility] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, input.facilityWarehouseId));
  if (!facility) throw new BusinessError("Facility not found");
  if (facility.kind !== "brewery") throw new BusinessError(`${facility.name} is not a brewery; batches are brewed at a lot facility`, { field: "facilityWarehouseId" });
  const [row] = await db
    .insert(schema.brewBatch)
    .values({
      facilityWarehouseId: input.facilityWarehouseId,
      brandCode: input.brandCode.trim().toUpperCase(),
      batchNumber,
      brewDate: input.brewDate ?? null,
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
  runCode: string; // one digit; letters only for experimental variants (4.5 is open: two-date packaging)
  batchId?: string | null;
  quantities: Array<{ skuId: string; qty: number }>;
  notes?: string | null;
  source?: "packaging_report" | "production_tab" | "bol_log_backfill";
  quantitiesKnown?: boolean;
  legacyCode?: string | null;
}

/**
 * The one-page packaging report (4.4): the office enters what the host reports; the lot code is computed, never typed.
 * A lot almost always holds several SKUs (4.3).
 */
export async function recordPackagingReport(db: DbOrTx, actor: Actor, input: PackagingReportInput) {
  authorize(actor, "lot.manage");
  const [facility] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, input.facilityWarehouseId));
  if (!facility) throw new BusinessError("Facility not found");
  if (!facility.lotFacilityCode) throw new BusinessError(`${facility.name} has no lot facility code; set it on the origin before recording a packaging run`, { field: "facilityWarehouseId" });
  const brandCode = input.brandCode.trim().toUpperCase();
  const runCode = input.runCode.trim().toUpperCase();
  const lotCode = composeLotCode(facility.lotFacilityCode, brandCode, input.packagingDate, runCode);
  const quantitiesKnown = input.quantitiesKnown ?? true;
  if (quantitiesKnown && input.quantities.length === 0) throw new BusinessError("Enter the quantities packaged per SKU (or mark quantities as not yet known)", { field: "quantities" });
  for (const q of input.quantities) {
    if (!Number.isInteger(q.qty) || q.qty < 0) throw new BusinessError("Quantities must be whole numbers of zero or more", { field: "quantities" });
  }
  if (input.batchId) {
    const [b] = await db.select().from(schema.brewBatch).where(eq(schema.brewBatch.id, input.batchId));
    if (!b) throw new BusinessError("Batch not found", { field: "batchId" });
    if (b.facilityWarehouseId !== input.facilityWarehouseId) throw new BusinessError("The batch was brewed at a different facility", { field: "batchId" });
  }
  return withTx(db, async (tx) => {
    const [existing] = await tx.select().from(schema.lot).where(eq(schema.lot.lotCode, lotCode));
    if (existing) throw new BusinessError(`Lot ${lotCode} already exists; use the next run digit for a second run on the same day`, { field: "runCode" });
    const [row] = await tx
      .insert(schema.lot)
      .values({
        lotCode,
        facilityWarehouseId: input.facilityWarehouseId,
        brandCode,
        packagingDate: input.packagingDate,
        runCode,
        batchId: input.batchId ?? null,
        quantitiesKnown,
        source: input.source ?? "packaging_report",
        legacyCode: input.legacyCode ?? null,
        notes: input.notes ?? null,
        createdByEmployeeId: actor.employeeId,
      })
      .returning();
    const seen = new Set<string>();
    for (const q of input.quantities) {
      if (seen.has(q.skuId)) throw new BusinessError("Each SKU appears once on a packaging report", { field: "quantities" });
      seen.add(q.skuId);
      await tx.insert(schema.lotSkuQty).values({ lotId: row.id, skuId: q.skuId, qtyPackaged: q.qty });
    }
    if (input.batchId) {
      await tx.update(schema.brewBatch).set({ status: "complete", statusChangedOn: input.packagingDate }).where(and(eq(schema.brewBatch.id, input.batchId), eq(schema.brewBatch.status, "in_progress")));
    }
    await recordAudit(tx, actor, {
      action: "lot.create",
      subjectType: "lot",
      subjectId: row.id,
      current: { lotCode, facility: facility.name, quantities: input.quantities, quantitiesKnown, source: input.source ?? "packaging_report" },
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
