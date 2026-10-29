/**
 * Shipments (docs/SHIPMENTS_SPEC.md §2 and §3; owner decisions 5.1 to 5.13, 2.6, 4.6, 6.7).
 *
 * The shipment record carries the number, the dates, the account, the lots, and drives the documents, the invoice,
 * the ledger movement and the keg balance. Numbers are assigned once, at confirmation, from a per-origin, per-scheduled-
 * date counter and never change; a void keeps the number; a regenerated document carries a revision mark.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { authorize } from "@/lib/authz/authorize";
import { marketScopeFor, type Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import { type DbOrTx, type Tx, withTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { openException } from "@/lib/exceptions/service";
import { availability, lockPosition } from "@/lib/domain/allocation/service";
import { currentPrice } from "@/lib/domain/catalog/service";
import { originAddressLines } from "@/lib/domain/origins/service";
import { yymmdd } from "@/lib/domain/lots/service";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { createDraftInvoiceForShipment, issueInvoiceForShipment, voidDraftInvoicesForShipment } from "@/lib/domain/invoices/service";
import { recordKegEventForShipment } from "@/lib/domain/kegs/service";
import { renderPdf } from "@/lib/documents/render";
import type { ShipmentSnapshot, SnapshotLine } from "@/lib/documents/types";

export type Shipment = typeof schema.shipment.$inferSelect;
export type ShipmentLine = typeof schema.shipmentLine.$inferSelect;
export type ShipmentType = (typeof schema.shipmentTypeEnum.enumValues)[number];
export type ShipmentStatus = (typeof schema.shipmentStatusEnum.enumValues)[number];
export type ShipmentTemplate = (typeof schema.shipmentTemplateEnum.enumValues)[number];

export const SHIPMENT_VIEW_ROLES = ["owner", "admin", "accounting", "sales", "driver_service"] as const;

export interface ShipmentHeaderInput {
  type: ShipmentType;
  originWarehouseId: string;
  destinationLocationId?: string | null;
  destinationWarehouseId?: string | null;
  destinationText?: string | null;
  pickup?: boolean;
  scheduledDate: string; // YYYY-MM-DD
  poNumbers?: string[] | null;
  appointment?: string | null;
  carrier?: string | null;
  carrierPhone?: string | null;
  sealNumber?: string | null;
  trailerNumber?: string | null;
  palletCount?: number | null;
  palletBuild?: string | null;
  freightClass?: string | null;
  deliveryWindow?: string | null;
  receivingInstructions?: string | null;
  notes?: string | null;
  overrideReason?: string | null;
  driverEmployeeId?: string | null;
  orderIds?: string[] | null;
}

export interface ShipmentLineInput {
  skuId?: string | null;
  posItemId?: string | null;
  lotId?: string | null;
  qty: number;
  lotReason?: string | null;
}

const EDITABLE_AFTER_CONFIRMATION: ReadonlyArray<keyof ShipmentHeaderInput> = [
  "poNumbers",
  "appointment",
  "carrier",
  "carrierPhone",
  "sealNumber",
  "trailerNumber",
  "palletCount",
  "palletBuild",
  "freightClass",
  "deliveryWindow",
  "receivingInstructions",
  "notes",
  "driverEmployeeId",
  "scheduledDate",
];

function isoDate(d: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BusinessError("Date must be YYYY-MM-DD", { field });
  return d;
}

async function loadDestination(db: DbOrTx, locationId: string) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Destination account not found", { field: "destinationLocationId" });
  return loc;
}

function templateFor(type: ShipmentType, destinationKind: string | null): ShipmentTemplate {
  if (type === "T") return "transfer";
  if (destinationKind === "distributor" || destinationKind === "warehouse" || destinationKind === "host") return "distributor";
  return "retail";
}

/** Market used for scoping: the destination account's market, else the origin's market (5.7). */
async function scopingMarket(db: DbOrTx, originWarehouseId: string, destinationLocationId: string | null | undefined): Promise<string | null> {
  if (destinationLocationId) {
    const loc = await loadDestination(db, destinationLocationId);
    return loc.marketId;
  }
  const [origin] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, originWarehouseId));
  return origin?.marketId ?? null;
}

async function validateHeader(db: DbOrTx, input: ShipmentHeaderInput) {
  const [origin] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, input.originWarehouseId));
  if (!origin) throw new BusinessError("Origin not found", { field: "originWarehouseId" });
  if (!origin.active) throw new BusinessError(`${origin.name} is inactive`, { field: "originWarehouseId" });
  isoDate(input.scheduledDate, "scheduledDate");
  let destinationKind: string | null = null;
  if (input.type === "T") {
    if (!input.destinationWarehouseId) throw new BusinessError("A transfer needs a destination origin (warehouse or brewery)", { field: "destinationWarehouseId" });
    if (input.destinationWarehouseId === input.originWarehouseId) throw new BusinessError("Origin and destination must differ", { field: "destinationWarehouseId" });
    const [dest] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, input.destinationWarehouseId));
    if (!dest) throw new BusinessError("Destination origin not found", { field: "destinationWarehouseId" });
  } else if (input.type === "D") {
    if (!input.destinationLocationId) throw new BusinessError("A delivery needs a destination account", { field: "destinationLocationId" });
    const loc = await loadDestination(db, input.destinationLocationId);
    destinationKind = loc.kind;
  } else {
    if (!input.destinationLocationId && !input.destinationText?.trim()) throw new BusinessError("A sample shipment needs an account or a free-text destination (person or event)", { field: "destinationText" });
    if (input.destinationLocationId) destinationKind = (await loadDestination(db, input.destinationLocationId)).kind;
  }
  if (input.palletCount != null && (!Number.isInteger(input.palletCount) || input.palletCount < 0)) throw new BusinessError("Pallet count must be a whole number", { field: "palletCount" });
  return { origin, template: templateFor(input.type, destinationKind) };
}

function cleanLines(lines: ShipmentLineInput[]): ShipmentLineInput[] {
  const out: ShipmentLineInput[] = [];
  for (const l of lines) {
    if (!l.skuId && !l.posItemId) throw new BusinessError("Each line needs a SKU or a POS item", { field: "lines" });
    if (l.skuId && l.posItemId) throw new BusinessError("A line is either a SKU or a POS item, not both", { field: "lines" });
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new BusinessError("Quantities must be positive whole numbers", { field: "lines" });
    out.push({ skuId: l.skuId ?? null, posItemId: l.posItemId ?? null, lotId: l.skuId ? (l.lotId ?? null) : null, qty: l.qty, lotReason: l.lotReason?.trim() || null });
  }
  return out;
}

async function writeLines(tx: Tx, shipmentId: string, lines: ShipmentLineInput[]) {
  await tx.delete(schema.shipmentLine).where(eq(schema.shipmentLine.shipmentId, shipmentId));
  let n = 0;
  for (const l of lines) {
    n += 1;
    let weight: string | null = null;
    let lotCode: string | null = null;
    if (l.skuId) {
      const [s] = await tx.select().from(schema.sku).where(eq(schema.sku.id, l.skuId));
      if (!s) throw new BusinessError("SKU not found", { field: "lines" });
      if (s.archivedAt) throw new BusinessError(`${s.code} is archived and cannot ship (3.4)`, { field: "lines" });
      if (s.weightLb) weight = (Number(s.weightLb) * l.qty).toFixed(2);
    }
    if (l.posItemId) {
      const [p] = await tx.select().from(schema.posItem).where(eq(schema.posItem.id, l.posItemId));
      if (!p) throw new BusinessError("POS item not found", { field: "lines" });
    }
    if (l.lotId) {
      const [lot] = await tx.select().from(schema.lot).where(eq(schema.lot.id, l.lotId));
      if (!lot) throw new BusinessError("Lot not found", { field: "lines" });
      if (lot.legacyCode) throw new BusinessError(`Lot ${lot.lotCode} is history only and cannot be selected (1.7)`, { field: "lines" });
      lotCode = lot.lotCode;
    }
    await tx.insert(schema.shipmentLine).values({ shipmentId, lineNo: n, skuId: l.skuId ?? null, posItemId: l.posItemId ?? null, lotId: l.lotId ?? null, lotCode, qty: l.qty, weightLb: weight, lotReason: l.lotReason ?? null });
  }
}

// ---------------------------------------------------------------------------
// Create / edit (draft, and logistics fields after confirmation)
// ---------------------------------------------------------------------------

export async function createShipment(db: DbOrTx, actor: Actor, header: ShipmentHeaderInput, lines: ShipmentLineInput[] = []) {
  const marketId = await scopingMarket(db, header.originWarehouseId, header.destinationLocationId);
  authorize(actor, "shipment.manage", { marketId });
  const { template } = await validateHeader(db, header);
  const clean = cleanLines(lines);
  return withTx(db, async (tx) => {
    const [row] = await tx
      .insert(schema.shipment)
      .values({
        type: header.type,
        originWarehouseId: header.originWarehouseId,
        destinationLocationId: header.destinationLocationId ?? null,
        destinationWarehouseId: header.destinationWarehouseId ?? null,
        destinationText: header.destinationText?.trim() || null,
        pickup: header.pickup ?? false,
        template,
        scheduledDate: header.scheduledDate,
        poNumbers: header.poNumbers?.map((p) => p.trim()).filter(Boolean) ?? null,
        appointment: header.appointment ?? null,
        carrier: header.carrier ?? null,
        carrierPhone: header.carrierPhone ?? null,
        sealNumber: header.sealNumber ?? null,
        trailerNumber: header.trailerNumber ?? null,
        palletCount: header.palletCount ?? null,
        palletBuild: header.palletBuild ?? null,
        freightClass: header.freightClass ?? null,
        deliveryWindow: header.deliveryWindow ?? null,
        receivingInstructions: header.receivingInstructions ?? null,
        notes: header.notes ?? null,
        overrideReason: header.overrideReason?.trim() || null,
        driverEmployeeId: header.driverEmployeeId ?? null,
        marketId,
        createdByEmployeeId: actor.employeeId,
      })
      .returning();
    await writeLines(tx, row.id, clean);
    for (const oid of header.orderIds ?? []) await tx.insert(schema.shipmentOrder).values({ shipmentId: row.id, orderId: oid }).onConflictDoNothing();
    await recordAudit(tx, actor, { action: "shipment.create", subjectType: "shipment", subjectId: row.id, current: { ...header, lines: clean }, marketId });
    return row;
  });
}

export async function updateShipmentHeader(db: DbOrTx, actor: Actor, shipmentId: string, patch: Partial<ShipmentHeaderInput>) {
  const prior = await mustLoad(db, shipmentId);
  authorize(actor, "shipment.manage", { marketId: prior.marketId });
  if (prior.status === "delivered" || prior.status === "voided") throw new BusinessError(`A ${prior.status} shipment cannot be edited`);
  if (prior.legacy) throw new BusinessError("Imported history cannot be edited");
  const merged: ShipmentHeaderInput = {
    type: patch.type ?? prior.type,
    originWarehouseId: patch.originWarehouseId ?? prior.originWarehouseId,
    destinationLocationId: patch.destinationLocationId === undefined ? prior.destinationLocationId : patch.destinationLocationId,
    destinationWarehouseId: patch.destinationWarehouseId === undefined ? prior.destinationWarehouseId : patch.destinationWarehouseId,
    destinationText: patch.destinationText === undefined ? prior.destinationText : patch.destinationText,
    pickup: patch.pickup ?? prior.pickup,
    scheduledDate: patch.scheduledDate ?? prior.scheduledDate,
    poNumbers: patch.poNumbers === undefined ? prior.poNumbers : patch.poNumbers,
    appointment: patch.appointment === undefined ? prior.appointment : patch.appointment,
    carrier: patch.carrier === undefined ? prior.carrier : patch.carrier,
    carrierPhone: patch.carrierPhone === undefined ? prior.carrierPhone : patch.carrierPhone,
    sealNumber: patch.sealNumber === undefined ? prior.sealNumber : patch.sealNumber,
    trailerNumber: patch.trailerNumber === undefined ? prior.trailerNumber : patch.trailerNumber,
    palletCount: patch.palletCount === undefined ? prior.palletCount : patch.palletCount,
    palletBuild: patch.palletBuild === undefined ? prior.palletBuild : patch.palletBuild,
    freightClass: patch.freightClass === undefined ? prior.freightClass : patch.freightClass,
    deliveryWindow: patch.deliveryWindow === undefined ? prior.deliveryWindow : patch.deliveryWindow,
    receivingInstructions: patch.receivingInstructions === undefined ? prior.receivingInstructions : patch.receivingInstructions,
    notes: patch.notes === undefined ? prior.notes : patch.notes,
    overrideReason: patch.overrideReason === undefined ? prior.overrideReason : patch.overrideReason,
    driverEmployeeId: patch.driverEmployeeId === undefined ? prior.driverEmployeeId : patch.driverEmployeeId,
  };
  if (prior.status !== "draft") {
    const changed = (Object.keys(patch) as Array<keyof ShipmentHeaderInput>).filter((k) => patch[k] !== undefined && !EDITABLE_AFTER_CONFIRMATION.includes(k));
    if (changed.length) throw new BusinessError(`After confirmation only logistics fields can change (not ${changed.join(", ")}); void and re-create to change the route`);
  }
  const { template } = await validateHeader(db, merged);
  const marketId = await scopingMarket(db, merged.originWarehouseId, merged.destinationLocationId);
  return withTx(db, async (tx) => {
    const [row] = await tx
      .update(schema.shipment)
      .set({
        type: merged.type,
        originWarehouseId: merged.originWarehouseId,
        destinationLocationId: merged.destinationLocationId ?? null,
        destinationWarehouseId: merged.destinationWarehouseId ?? null,
        destinationText: merged.destinationText?.trim() || null,
        pickup: merged.pickup ?? false,
        template,
        scheduledDate: merged.scheduledDate,
        poNumbers: merged.poNumbers?.map((p) => p.trim()).filter(Boolean) ?? null,
        appointment: merged.appointment ?? null,
        carrier: merged.carrier ?? null,
        carrierPhone: merged.carrierPhone ?? null,
        sealNumber: merged.sealNumber ?? null,
        trailerNumber: merged.trailerNumber ?? null,
        palletCount: merged.palletCount ?? null,
        palletBuild: merged.palletBuild ?? null,
        freightClass: merged.freightClass ?? null,
        deliveryWindow: merged.deliveryWindow ?? null,
        receivingInstructions: merged.receivingInstructions ?? null,
        notes: merged.notes ?? null,
        overrideReason: merged.overrideReason?.trim() || null,
        driverEmployeeId: merged.driverEmployeeId ?? null,
        marketId,
        updatedAt: new Date(),
      })
      .where(eq(schema.shipment.id, shipmentId))
      .returning();
    await recordAudit(tx, actor, { action: "shipment.update", subjectType: "shipment", subjectId: shipmentId, prior: pick(prior, Object.keys(patch)), current: patch, marketId });
    if (prior.status !== "draft") await regenerateDocuments(tx, actor, shipmentId, "Header edited after confirmation");
    return row;
  });
}

/** Replace the lines. Draft: free. Confirmed or staged: re-allocates and bumps the revision (5.4). */
export async function replaceShipmentLines(db: DbOrTx, actor: Actor, shipmentId: string, lines: ShipmentLineInput[]) {
  const prior = await mustLoad(db, shipmentId);
  authorize(actor, "shipment.manage", { marketId: prior.marketId });
  if (!["draft", "confirmed", "staged"].includes(prior.status)) throw new BusinessError(`Lines cannot change once a shipment is ${prior.status}`);
  if (prior.legacy) throw new BusinessError("Imported history cannot be edited");
  const clean = cleanLines(lines);
  return withTx(db, async (tx) => {
    const before = await tx.select().from(schema.shipmentLine).where(eq(schema.shipmentLine.shipmentId, shipmentId));
    await writeLines(tx, shipmentId, clean);
    if (prior.status !== "draft") {
      await checkConfirmable(tx, prior, clean);
      await releaseAllocations(tx, shipmentId, "Lines replaced");
      await allocate(tx, actor, prior);
      await capturePrices(tx, prior);
      await regenerateDocuments(tx, actor, shipmentId, "Lines edited after confirmation");
    }
    await recordAudit(tx, actor, { action: "shipment.lines", subjectType: "shipment", subjectId: shipmentId, prior: before.map((l) => ({ skuId: l.skuId, posItemId: l.posItemId, lotCode: l.lotCode, qty: l.qty })), current: clean, marketId: prior.marketId });
    return mustLoad(tx, shipmentId);
  });
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

async function mustLoad(db: DbOrTx, id: string): Promise<Shipment> {
  const [row] = await db.select().from(schema.shipment).where(eq(schema.shipment.id, id));
  if (!row) throw new BusinessError("Shipment not found");
  return row;
}

// ---------------------------------------------------------------------------
// Confirmation: validations, numbering, allocation, prices, documents, invoice draft
// ---------------------------------------------------------------------------

async function checkConfirmable(db: DbOrTx, s: Shipment, lines: ShipmentLineInput[] | ShipmentLine[]) {
  const [origin] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, s.originWarehouseId));
  if (!origin) throw new BusinessError("Origin not found");
  if (!origin.originCode) throw new BusinessError(`${origin.name} has no origin code; set one (for example EBB) on the origin before confirming (2.2)`);
  if (lines.length === 0) throw new BusinessError("Add at least one line before confirming");
  for (const l of lines) {
    if (l.skuId && !l.lotId) throw new BusinessError("Every beer line needs a lot chosen from the list before confirmation (4.1)");
    if (l.lotId) {
      const [lot] = await db.select().from(schema.lot).where(eq(schema.lot.id, l.lotId));
      if (lot && !lot.quantitiesKnown && !l.lotReason) {
        throw new BusinessError(`Lot ${lot.lotCode} has no confirmed quantities; give a reason on the line to ship it anyway (4.6)`);
      }
    }
  }
  if (s.type === "D" && s.destinationLocationId) {
    const dest = await loadDestination(db, s.destinationLocationId);
    if (dest.servedByLocationId && dest.kind !== "distributor" && !s.overrideReason) {
      const [dist] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, dest.servedByLocationId));
      throw new BusinessError(`${dest.tradeName} is served by ${dist?.tradeName ?? "a distributor"}; a direct shipment needs an override reason (2.6)`);
    }
  }
  return origin;
}

async function nextNumber(tx: Tx, originCode: string, type: ShipmentType, originWarehouseId: string, scheduledDate: string): Promise<string> {
  const [row] = await tx
    .insert(schema.bolCounter)
    .values({ originWarehouseId, scheduledDate, lastSeq: 1 })
    .onConflictDoUpdate({ target: [schema.bolCounter.originWarehouseId, schema.bolCounter.scheduledDate], set: { lastSeq: sql`${schema.bolCounter.lastSeq} + 1` } })
    .returning({ lastSeq: schema.bolCounter.lastSeq });
  return `${originCode}-${type}-${yymmdd(scheduledDate)}-${String(row.lastSeq).padStart(3, "0")}`;
}

async function allocate(tx: Tx, actor: Actor, s: Shipment) {
  const lines = await tx.select().from(schema.shipmentLine).where(eq(schema.shipmentLine.shipmentId, s.id));
  const bySku = new Map<string, number>();
  for (const l of lines) if (l.skuId) bySku.set(l.skuId, (bySku.get(l.skuId) ?? 0) + l.qty);
  for (const [skuId, qty] of bySku) {
    await lockPosition(tx, s.originWarehouseId, skuId);
    const avail = await availability(tx, s.originWarehouseId, skuId);
    await tx.insert(schema.shipmentAllocation).values({ shipmentId: s.id, warehouseId: s.originWarehouseId, skuId, qty });
    if (avail.availableQty < qty) {
      const [sku] = await tx.select().from(schema.sku).where(eq(schema.sku.id, skuId));
      const [origin] = await tx.select().from(schema.warehouse).where(eq(schema.warehouse.id, s.originWarehouseId));
      await openException(tx, actor, {
        category: "shipment_stock_shortfall",
        title: `Shipment ${s.number ?? "(draft)"}: ${qty} × ${sku?.code ?? skuId} allocated at ${origin?.name ?? "origin"} with only ${avail.availableQty} available on record`,
        cause: `On hand ${avail.onHandQty}, already reserved or allocated ${avail.reservedQty}. Stock evidence may be missing until a count is applied (8.1).`,
        marketId: s.marketId,
        ownerRole: "admin",
        nextAction: "Apply a physical count for the origin, or correct the shipment lines.",
        dedupeKey: `shipment_stock_shortfall:${s.id}:${skuId}`,
        links: [{ subjectType: "shipment", subjectId: s.id }],
      });
    }
  }
}

async function releaseAllocations(tx: Tx, shipmentId: string, reason: string) {
  await tx
    .update(schema.shipmentAllocation)
    .set({ releasedAt: new Date(), releaseReason: reason })
    .where(and(eq(schema.shipmentAllocation.shipmentId, shipmentId), isNull(schema.shipmentAllocation.releasedAt)));
}

/** Prices are captured at confirmation (account override, else market list); samples and transfers carry none (7.3). */
async function capturePrices(tx: Tx, s: Shipment) {
  const lines = await tx.select().from(schema.shipmentLine).where(eq(schema.shipmentLine.shipmentId, s.id));
  for (const l of lines) {
    let price: number | null = null;
    if (l.skuId && s.type === "D" && s.destinationLocationId) {
      const dest = await loadDestination(tx, s.destinationLocationId);
      const override = await tx
        .select()
        .from(schema.priceOverride)
        .where(and(eq(schema.priceOverride.locationId, dest.id), eq(schema.priceOverride.skuId, l.skuId), isNull(schema.priceOverride.effectiveTo)))
        .orderBy(desc(schema.priceOverride.effectiveFrom))
        .limit(1);
      if (override[0]) price = override[0].priceCents;
      else {
        const mp = await currentPrice(tx, dest.marketId, l.skuId);
        price = mp?.priceCents ?? null;
      }
    } else if (l.skuId && s.type === "S") {
      price = 0;
    }
    await tx.update(schema.shipmentLine).set({ unitPriceCents: price }).where(eq(schema.shipmentLine.id, l.id));
  }
}

export async function confirmShipment(db: DbOrTx, actor: Actor, shipmentId: string) {
  const prior = await mustLoad(db, shipmentId);
  authorize(actor, "shipment.confirm", { marketId: prior.marketId });
  if (prior.status !== "draft") throw new StaleStateError(`Shipment is already ${prior.status}`);
  if (prior.legacy) throw new BusinessError("Imported history cannot be confirmed");
  return withTx(db, async (tx) => {
    const lines = await tx.select().from(schema.shipmentLine).where(eq(schema.shipmentLine.shipmentId, shipmentId));
    const origin = await checkConfirmable(tx, prior, lines);
    const number = await nextNumber(tx, origin.originCode!, prior.type, prior.originWarehouseId, prior.scheduledDate);
    const [row] = await tx
      .update(schema.shipment)
      .set({ number, status: "confirmed", confirmedAt: new Date(), confirmedByEmployeeId: actor.employeeId, updatedAt: new Date() })
      .where(and(eq(schema.shipment.id, shipmentId), eq(schema.shipment.status, "draft")))
      .returning();
    if (!row) throw new StaleStateError("Shipment was confirmed by someone else a moment ago");
    await allocate(tx, actor, row);
    await capturePrices(tx, row);
    for (const l of lines) {
      if (l.lotId && l.lotReason) {
        const [lot] = await tx.select().from(schema.lot).where(eq(schema.lot.id, l.lotId));
        if (lot && !lot.quantitiesKnown) {
          await openException(tx, actor, {
            category: "lot_quantities_unconfirmed",
            title: `Lot ${lot.lotCode}: quantities not yet confirmed by the host`,
            cause: `Shipped on ${number} with reason: ${l.lotReason}`,
            marketId: row.marketId,
            ownerRole: "admin",
            nextAction: "Ask the host for the packaging sheet and confirm quantities on the lot.",
            dedupeKey: `lot_quantities_unconfirmed:${lot.id}`,
            links: [{ subjectType: "lot", subjectId: lot.id }, { subjectType: "shipment", subjectId: row.id }],
          });
        }
      }
    }
    if ((row.type === "D" || row.type === "S") && row.destinationLocationId) {
      await createDraftInvoiceForShipment(tx, actor, row.id);
    }
    await storeDocuments(tx, actor, row.id, ["bol", "picking_ticket"]);
    await recordAudit(tx, actor, { action: "shipment.confirm", subjectType: "shipment", subjectId: row.id, prior: { status: "draft" }, current: { status: "confirmed", number }, marketId: row.marketId });
    return mustLoad(tx, row.id);
  });
}

// ---------------------------------------------------------------------------
// Staged / out / delivered / voided / received
// ---------------------------------------------------------------------------

export async function stageShipment(db: DbOrTx, actor: Actor, shipmentId: string) {
  return transition(db, actor, shipmentId, ["confirmed"], "staged", "shipment.manage");
}

export async function markShipmentOut(db: DbOrTx, actor: Actor, shipmentId: string) {
  return transition(db, actor, shipmentId, ["confirmed", "staged"], "out", "shipment.manage");
}

async function transition(db: DbOrTx, actor: Actor, shipmentId: string, from: ShipmentStatus[], to: ShipmentStatus, action: "shipment.manage") {
  const prior = await mustLoad(db, shipmentId);
  authorize(actor, action, { marketId: prior.marketId });
  if (!from.includes(prior.status)) throw new StaleStateError(`Shipment is ${prior.status}; it cannot move to ${to}`);
  const [row] = await db.update(schema.shipment).set({ status: to, updatedAt: new Date() }).where(and(eq(schema.shipment.id, shipmentId), inArray(schema.shipment.status, from))).returning();
  if (!row) throw new StaleStateError("Shipment changed a moment ago");
  await recordAudit(db, actor, { action: `shipment.${to}`, subjectType: "shipment", subjectId: shipmentId, prior: { status: prior.status }, current: { status: to }, marketId: prior.marketId });
  return row;
}

export interface DeliverInput {
  actualDate: string; // YYYY-MM-DD
  kegPickup?: { halfIn: number; sixtelIn: number } | null;
  note?: string | null;
}

/**
 * The office sets the actual date (5.11): allocations are consumed, `shipment_out` movements are written per line
 * (transfers: `transfer_out` plus in-transit at the destination), the keg event is recorded, and the invoice is issued
 * dated the actual date (7.4). The number never changes when the actual date differs from the scheduled date.
 */
export async function deliverShipment(db: DbOrTx, actor: Actor, shipmentId: string, input: DeliverInput) {
  const prior = await mustLoad(db, shipmentId);
  authorize(actor, "shipment.deliver", { marketId: prior.marketId });
  if (!["confirmed", "staged", "out"].includes(prior.status)) throw new StaleStateError(`Shipment is ${prior.status}; only a confirmed, staged or out shipment can be delivered`);
  isoDate(input.actualDate, "actualDate");
  if (input.kegPickup) {
    for (const v of [input.kegPickup.halfIn, input.kegPickup.sixtelIn]) if (!Number.isInteger(v) || v < 0) throw new BusinessError("Empty keg counts must be whole numbers", { field: "kegPickup" });
  }
  return withTx(db, async (tx) => {
    const lines = await tx.select().from(schema.shipmentLine).where(eq(schema.shipmentLine.shipmentId, shipmentId));
    const bySku = new Map<string, { qty: number; lotIds: Array<{ lotId: string | null; qty: number }> }>();
    for (const l of lines) {
      if (!l.skuId) continue;
      const e = bySku.get(l.skuId) ?? { qty: 0, lotIds: [] };
      e.qty += l.qty;
      e.lotIds.push({ lotId: l.lotId, qty: l.qty });
      bySku.set(l.skuId, e);
    }
    const sortedSkus = Array.from(bySku.keys()).sort();
    for (const skuId of sortedSkus) {
      const e = bySku.get(skuId)!;
      const pos = await lockPosition(tx, prior.originWarehouseId, skuId);
      const newOnHand = pos.onHandQty - e.qty;
      if (newOnHand < 0) {
        const [sku] = await tx.select().from(schema.sku).where(eq(schema.sku.id, skuId));
        await openException(tx, actor, {
          category: "allocation_discrepancy",
          title: `Delivered ${e.qty} × ${sku?.code ?? skuId} on ${prior.number} with only ${pos.onHandQty} on record at the origin`,
          cause: "Stock evidence is missing or stale; the on-hand position was floored at zero. Apply a physical count (8.1).",
          marketId: prior.marketId,
          ownerRole: "admin",
          nextAction: "Apply a count for the origin so the ledger matches the floor.",
          dedupeKey: `shipment_delivery_shortfall:${prior.id}:${skuId}`,
          links: [{ subjectType: "shipment", subjectId: prior.id }],
        });
      }
      await tx.update(schema.stockPosition).set({ onHandQty: Math.max(0, newOnHand), updatedAt: new Date() }).where(eq(schema.stockPosition.id, pos.id));
      for (const part of e.lotIds) {
        await tx.insert(schema.stockMovement).values({
          warehouseId: prior.originWarehouseId,
          skuId,
          kind: prior.type === "T" ? "transfer_out" : "shipment_out",
          qtyDelta: -part.qty,
          referenceType: "shipment",
          referenceId: prior.id,
          evidence: `${prior.number} delivered ${input.actualDate}`,
          actorEmployeeId: actor.employeeId,
          lotId: part.lotId,
          shipmentId: prior.id,
        });
      }
      if (prior.type === "T" && prior.destinationWarehouseId) {
        const dest = await lockPosition(tx, prior.destinationWarehouseId, skuId);
        await tx.update(schema.stockPosition).set({ inTransitQty: dest.inTransitQty + e.qty, updatedAt: new Date() }).where(eq(schema.stockPosition.id, dest.id));
      }
    }
    await releaseAllocations(tx, shipmentId, "Delivered");
    const [row] = await tx
      .update(schema.shipment)
      .set({ status: "delivered", actualDate: input.actualDate, deliveredAt: new Date(), deliveredByEmployeeId: actor.employeeId, updatedAt: new Date(), notes: input.note ? `${prior.notes ? prior.notes + "\n" : ""}${input.note}` : prior.notes })
      .where(and(eq(schema.shipment.id, shipmentId), inArray(schema.shipment.status, ["confirmed", "staged", "out"])))
      .returning();
    if (!row) throw new StaleStateError("Shipment changed a moment ago");
    if (input.kegPickup) {
      await tx.insert(schema.shipmentKegPickup).values({ shipmentId, halfIn: input.kegPickup.halfIn, sixtelIn: input.kegPickup.sixtelIn }).onConflictDoUpdate({ target: schema.shipmentKegPickup.shipmentId, set: { halfIn: input.kegPickup.halfIn, sixtelIn: input.kegPickup.sixtelIn } });
    }
    if ((row.type === "D" || row.type === "S") && row.destinationLocationId) {
      await recordKegEventForShipment(tx, actor, row.id);
      await issueInvoiceForShipment(tx, actor, row.id, input.actualDate);
    }
    await recordAudit(tx, actor, { action: "shipment.deliver", subjectType: "shipment", subjectId: shipmentId, prior: { status: prior.status }, current: { status: "delivered", actualDate: input.actualDate, kegPickup: input.kegPickup ?? null }, marketId: prior.marketId });
    return mustLoad(tx, shipmentId);
  });
}

/** Void keeps the number as a permanent gap (5.4); allocations are released; a draft invoice is voided. */
export async function voidShipment(db: DbOrTx, actor: Actor, shipmentId: string, reason: string) {
  const prior = await mustLoad(db, shipmentId);
  authorize(actor, "shipment.void", { marketId: prior.marketId });
  if (prior.status === "delivered") throw new BusinessError("A delivered shipment cannot be voided; record a correction instead");
  if (prior.status === "voided") throw new StaleStateError("Shipment is already voided");
  if (!reason.trim()) throw new BusinessError("A reason is required to void", { field: "reason" });
  return withTx(db, async (tx) => {
    await releaseAllocations(tx, shipmentId, `Voided: ${reason.trim()}`);
    const [row] = await tx
      .update(schema.shipment)
      .set({ status: "voided", voidedAt: new Date(), voidedByEmployeeId: actor.employeeId, voidReason: reason.trim(), updatedAt: new Date() })
      .where(and(eq(schema.shipment.id, shipmentId), sql`${schema.shipment.status} <> 'delivered' and ${schema.shipment.status} <> 'voided'`))
      .returning();
    if (!row) throw new StaleStateError("Shipment changed a moment ago");
    await voidDraftInvoicesForShipment(tx, actor, shipmentId, `Shipment voided: ${reason.trim()}`);
    if (row.number) await storeDocuments(tx, actor, shipmentId, ["bol"], { bumpRevision: true });
    await recordAudit(tx, actor, { action: "shipment.void", subjectType: "shipment", subjectId: shipmentId, prior: { status: prior.status }, current: { status: "voided", number: row.number }, reason: reason.trim(), marketId: prior.marketId });
    return row;
  });
}

export interface ReceiveInput {
  receivedOn: string;
  lines: Array<{ skuId: string; qtyReceived: number }>;
  note?: string | null;
}

/** Receiving confirmation for a delivered transfer (5.8): in transit becomes on hand; a short or over count raises an exception. */
export async function receiveTransfer(db: DbOrTx, actor: Actor, shipmentId: string, input: ReceiveInput) {
  const prior = await mustLoad(db, shipmentId);
  if (prior.type !== "T" || !prior.destinationWarehouseId) throw new BusinessError("Only transfers are received");
  const [dest] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, prior.destinationWarehouseId));
  authorize(actor, "shipment.receive", { marketId: dest?.marketId ?? prior.marketId });
  if (prior.status !== "delivered") throw new StaleStateError("A transfer is received after it has been delivered");
  isoDate(input.receivedOn, "receivedOn");
  const [existing] = await db.select().from(schema.shipmentReceipt).where(eq(schema.shipmentReceipt.shipmentId, shipmentId));
  if (existing) throw new StaleStateError("This transfer was already received (a replayed receipt has no second effect)");
  return withTx(db, async (tx) => {
    const lines = await tx.select().from(schema.shipmentLine).where(eq(schema.shipmentLine.shipmentId, shipmentId));
    const expected = new Map<string, number>();
    for (const l of lines) if (l.skuId) expected.set(l.skuId, (expected.get(l.skuId) ?? 0) + l.qty);
    const received = new Map<string, number>();
    for (const r of input.lines) {
      if (!Number.isInteger(r.qtyReceived) || r.qtyReceived < 0) throw new BusinessError("Received quantities must be whole numbers of zero or more", { field: "lines" });
      received.set(r.skuId, (received.get(r.skuId) ?? 0) + r.qtyReceived);
    }
    const [receipt] = await tx
      .insert(schema.shipmentReceipt)
      .values({ shipmentId, receivedOn: input.receivedOn, receivedByEmployeeId: actor.employeeId, discrepancyNote: input.note ?? null })
      .returning();
    const discrepancies: string[] = [];
    for (const skuId of new Set([...expected.keys(), ...received.keys()])) {
      const exp = expected.get(skuId) ?? 0;
      const got = received.get(skuId) ?? 0;
      await tx.insert(schema.shipmentReceiptLine).values({ receiptId: receipt.id, skuId, qtyExpected: exp, qtyReceived: got });
      const pos = await lockPosition(tx, prior.destinationWarehouseId!, skuId);
      await tx
        .update(schema.stockPosition)
        .set({ inTransitQty: Math.max(0, pos.inTransitQty - exp), onHandQty: pos.onHandQty + got, evidenceSource: `Receipt of ${prior.number}`, evidenceAt: new Date(), confirmedByEmployeeId: actor.employeeId, updatedAt: new Date() })
        .where(eq(schema.stockPosition.id, pos.id));
      if (got > 0) {
        await tx.insert(schema.stockMovement).values({ warehouseId: prior.destinationWarehouseId!, skuId, kind: "transfer_in", qtyDelta: got, referenceType: "shipment", referenceId: prior.id, evidence: `${prior.number} received ${input.receivedOn}`, actorEmployeeId: actor.employeeId, shipmentId: prior.id });
      }
      if (got !== exp) {
        const [sku] = await tx.select().from(schema.sku).where(eq(schema.sku.id, skuId));
        discrepancies.push(`${sku?.code ?? skuId}: expected ${exp}, received ${got}`);
      }
    }
    if (discrepancies.length) {
      await openException(tx, actor, {
        category: "receiving_discrepancy",
        title: `Transfer ${prior.number}: received counts differ from the BOL`,
        cause: discrepancies.join("; ") + (input.note ? `. Note: ${input.note}` : ""),
        marketId: dest?.marketId ?? prior.marketId,
        ownerRole: "admin",
        nextAction: "Reconcile with the origin and the carrier; adjust stock with a reason once settled.",
        dedupeKey: `receiving_discrepancy:${prior.id}`,
        links: [{ subjectType: "shipment", subjectId: prior.id }],
      });
    }
    await recordAudit(tx, actor, { action: "shipment.receive", subjectType: "shipment", subjectId: shipmentId, current: { receivedOn: input.receivedOn, lines: input.lines, discrepancies }, marketId: dest?.marketId ?? prior.marketId });
    return { receipt, discrepancies };
  });
}

// ---------------------------------------------------------------------------
// Documents: snapshot + PDF stored at confirmation; regenerated with a revision mark (6.7)
// ---------------------------------------------------------------------------

async function regenerateDocuments(tx: Tx, actor: Actor, shipmentId: string, reason: string) {
  const s = await mustLoad(tx, shipmentId);
  if (!s.number) return;
  await storeDocuments(tx, actor, shipmentId, ["bol", "picking_ticket"], { bumpRevision: true });
  await recordAudit(tx, actor, { action: "shipment.documents_regenerated", subjectType: "shipment", subjectId: shipmentId, current: { revision: s.revision + 1 }, reason, marketId: s.marketId });
}

export async function storeDocuments(tx: Tx, actor: Actor, shipmentId: string, kinds: Array<"bol" | "picking_ticket" | "pull_sheet">, opts: { bumpRevision?: boolean } = {}) {
  let s = await mustLoad(tx, shipmentId);
  if (opts.bumpRevision) {
    [s] = await tx.update(schema.shipment).set({ revision: s.revision + 1, updatedAt: new Date() }).where(eq(schema.shipment.id, shipmentId)).returning();
  }
  const out = [];
  for (const kind of kinds) {
    const snapshot = await buildShipmentSnapshot(tx, shipmentId, kind, actor.displayName);
    let pdf: Buffer | null = null;
    try {
      pdf = await renderPdf(snapshot);
    } catch (err) {
      await recordAudit(tx, actor, { action: "document.render_failed", subjectType: "shipment", subjectId: shipmentId, current: { kind, error: err instanceof Error ? err.message : String(err) }, marketId: s.marketId });
    }
    const [doc] = await tx
      .insert(schema.shipmentDocument)
      .values({ shipmentId, kind, revision: s.revision, number: s.number, snapshot, pdf, createdByEmployeeId: actor.employeeId })
      .returning({ id: schema.shipmentDocument.id, kind: schema.shipmentDocument.kind, revision: schema.shipmentDocument.revision });
    out.push(doc);
  }
  return out;
}

/** Owner or Admin asks for a fresh copy (same number, next revision) (5.4, 6.7). */
export async function regenerateShipmentDocuments(db: DbOrTx, actor: Actor, shipmentId: string, reason: string) {
  const s = await mustLoad(db, shipmentId);
  authorize(actor, "shipment.manage", { marketId: s.marketId });
  if (!s.number) throw new BusinessError("Documents exist from confirmation onward");
  if (!reason.trim()) throw new BusinessError("Say why the document is being regenerated", { field: "reason" });
  return withTx(db, (tx) => regenerateDocuments(tx, actor, shipmentId, reason.trim()));
}

export async function latestDocument(db: DbOrTx, shipmentId: string, kind: "bol" | "picking_ticket" | "pull_sheet") {
  const [row] = await db
    .select()
    .from(schema.shipmentDocument)
    .where(and(eq(schema.shipmentDocument.shipmentId, shipmentId), eq(schema.shipmentDocument.kind, kind)))
    .orderBy(desc(schema.shipmentDocument.revision), desc(schema.shipmentDocument.createdAt))
    .limit(1);
  return row ?? null;
}

export async function listDocuments(db: DbOrTx, shipmentId: string) {
  return db
    .select({ id: schema.shipmentDocument.id, kind: schema.shipmentDocument.kind, revision: schema.shipmentDocument.revision, number: schema.shipmentDocument.number, createdAt: schema.shipmentDocument.createdAt, hasPdf: sql<boolean>`${schema.shipmentDocument.pdf} is not null` })
    .from(schema.shipmentDocument)
    .where(eq(schema.shipmentDocument.shipmentId, shipmentId))
    .orderBy(desc(schema.shipmentDocument.createdAt));
}

function kegSize(packageKind: string): "half" | "sixtel" | null {
  if (packageKind === "keg_half") return "half";
  if (packageKind === "keg_sixtel") return "sixtel";
  return null;
}

async function partyForLocation(db: DbOrTx, locationId: string) {
  const loc = await loadDestination(db, locationId);
  const addr = await db
    .select({ a: schema.address })
    .from(schema.locationAddress)
    .innerJoin(schema.address, eq(schema.address.id, schema.locationAddress.addressId))
    .where(and(eq(schema.locationAddress.locationId, locationId), eq(schema.locationAddress.kind, "delivery"), eq(schema.locationAddress.current, true)))
    .limit(1);
  const [lic] = await db.select().from(schema.licenseVerification).where(and(eq(schema.licenseVerification.locationId, locationId), eq(schema.licenseVerification.current, true)));
  const contact = await db
    .select({ c: schema.contact })
    .from(schema.locationContact)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
    .where(and(eq(schema.locationContact.locationId, locationId), eq(schema.locationContact.contactRole, "buyer"), eq(schema.locationContact.current, true)))
    .limit(1);
  const a = addr[0]?.a;
  return {
    loc,
    party: {
      name: loc.tradeName,
      legalName: loc.legalName,
      lines: a ? [a.line1, a.line2 ?? "", `${a.city}, ${a.state} ${a.postalCode}`].filter((l) => l && l.trim()) : [],
      license: lic?.licenseNumber ?? null,
      contact: contact[0]?.c.name ?? null,
      phone: contact[0]?.c.phone ?? null,
    },
  };
}

export async function buildShipmentSnapshot(db: DbOrTx, shipmentId: string, kind: "bol" | "picking_ticket" | "pull_sheet", generatedBy: string): Promise<ShipmentSnapshot> {
  const s = await mustLoad(db, shipmentId);
  const settings = await getCompanySettings(db);
  const [origin] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, s.originWarehouseId));
  if (!origin) throw new BusinessError("Origin not found");
  let shipTo: ShipmentSnapshot["shipTo"];
  if (s.destinationLocationId) shipTo = (await partyForLocation(db, s.destinationLocationId)).party;
  else if (s.destinationWarehouseId) {
    const [dw] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, s.destinationWarehouseId));
    shipTo = { name: dw?.name ?? "Destination", lines: dw ? originAddressLines(dw) : [], contact: dw?.shippingContactName ?? null, phone: dw?.shippingContactPhone ?? null };
  } else shipTo = { name: s.destinationText ?? "—", lines: [] };
  const rawLines = await db
    .select({ l: schema.shipmentLine, sku: schema.sku, pos: schema.posItem })
    .from(schema.shipmentLine)
    .leftJoin(schema.sku, eq(schema.sku.id, schema.shipmentLine.skuId))
    .leftJoin(schema.posItem, eq(schema.posItem.id, schema.shipmentLine.posItemId))
    .where(eq(schema.shipmentLine.shipmentId, shipmentId))
    .orderBy(asc(schema.shipmentLine.lineNo));
  const lines: SnapshotLine[] = rawLines.map(({ l, sku, pos }) => {
    const isKeg = Boolean(sku && sku.kegsPerUnit > 0);
    const unitWeight = sku?.weightLb ? Number(sku.weightLb) : null;
    return {
      lineNo: l.lineNo,
      skuCode: sku?.code ?? pos?.code ?? null,
      description: sku ? `${sku.brand} ${sku.name}` : (pos?.name ?? "—"),
      packageLabel: sku?.sellingUnit ?? "each",
      upcCase: sku?.upcCase ?? null,
      lotCode: l.lotCode,
      qty: l.qty,
      unitWeightLb: unitWeight,
      totalWeightLb: unitWeight != null ? Math.round(unitWeight * l.qty * 100) / 100 : null,
      isKeg,
      kegSize: sku ? kegSize(sku.packageKind) : null,
      isPos: Boolean(pos),
      unitPriceCents: l.unitPriceCents,
    };
  });
  const totals = lines.reduce(
    (t, l) => {
      if (l.isPos) t.units += l.qty;
      else if (l.isKeg) {
        t.kegs += l.qty;
        if (l.kegSize === "half") t.halfKegs += l.qty;
        if (l.kegSize === "sixtel") t.sixtelKegs += l.qty;
      } else t.cases += l.qty;
      t.weightLb += l.totalWeightLb ?? 0;
      return t;
    },
    { kegs: 0, cases: 0, units: 0, weightLb: 0, halfKegs: 0, sixtelKegs: 0 },
  );
  totals.weightLb = Math.round(totals.weightLb * 100) / 100;
  const [pickup] = await db.select().from(schema.shipmentKegPickup).where(eq(schema.shipmentKegPickup.shipmentId, shipmentId));
  const officeLines = [settings.officeLine1, settings.officeLine2, [settings.officeCity, [settings.officeState, settings.officePostalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter((l): l is string => Boolean(l && l.trim()));
  return {
    version: 1,
    kind,
    template: s.template,
    number: s.number,
    revision: s.revision,
    status: s.status,
    voided: s.status === "voided",
    type: s.type,
    pickup: s.pickup,
    scheduledDate: s.scheduledDate,
    actualDate: s.actualDate,
    shipper: { legalName: settings.legalName, dba: settings.dba, lines: officeLines, arEmail: settings.arEmail, phone: settings.officePhone },
    shipFrom: { name: origin.name, lines: originAddressLines(origin), originCode: origin.originCode, contact: origin.shippingContactName, phone: origin.shippingContactPhone },
    shipTo,
    poNumbers: s.poNumbers ?? [],
    appointment: s.appointment,
    carrier: s.carrier,
    carrierPhone: s.carrierPhone,
    sealNumber: s.sealNumber,
    trailerNumber: s.trailerNumber,
    palletCount: s.palletCount,
    palletBuild: s.palletBuild,
    freightClass: s.freightClass,
    nmfc: s.template === "distributor" || s.template === "transfer" ? { keg: settings.nmfcKeg, can: settings.nmfcCan, status: settings.nmfcStatus } : null,
    deliveryWindow: s.deliveryWindow,
    receivingInstructions: s.receivingInstructions,
    notes: s.notes,
    lines,
    totals,
    kegPickup: pickup ? { halfIn: pickup.halfIn, sixtelIn: pickup.sixtelIn } : s.template === "retail" ? { halfIn: 0, sixtelIn: 0 } : null,
    footer: s.template === "retail" ? settings.retailFooter : s.template === "distributor" ? settings.distributorFooter : null,
    fixedLines: s.template === "retail" ? [] : (settings.fixedLines ?? []),
    generatedAt: new Date().toISOString(),
    generatedBy,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ShipmentFilter {
  originWarehouseId?: string;
  status?: ShipmentStatus;
  type?: ShipmentType;
  dateFrom?: string;
  dateTo?: string;
  destinationLocationId?: string;
  q?: string;
  includeLegacy?: boolean;
  limit?: number;
  offset?: number;
}

export async function listShipments(db: DbOrTx, actor: Actor, f: ShipmentFilter = {}) {
  const scope = marketScopeFor(actor, [...SHIPMENT_VIEW_ROLES]);
  const conds = [];
  if (actor.kind !== "system" && !actor.grants.some((g) => g.role === "owner") && scope !== "all") {
    if (scope.length === 0) return [];
    conds.push(inArray(schema.shipment.marketId, scope));
  }
  if (actor.grants.length && actor.grants.every((g) => g.role === "driver_service") && actor.employeeId) {
    conds.push(eq(schema.shipment.driverEmployeeId, actor.employeeId));
  }
  if (f.originWarehouseId) conds.push(eq(schema.shipment.originWarehouseId, f.originWarehouseId));
  if (f.status) conds.push(eq(schema.shipment.status, f.status));
  if (f.type) conds.push(eq(schema.shipment.type, f.type));
  if (f.destinationLocationId) conds.push(eq(schema.shipment.destinationLocationId, f.destinationLocationId));
  if (f.dateFrom) conds.push(sql`${schema.shipment.scheduledDate} >= ${f.dateFrom}`);
  if (f.dateTo) conds.push(sql`${schema.shipment.scheduledDate} <= ${f.dateTo}`);
  if (!f.includeLegacy) conds.push(eq(schema.shipment.legacy, false));
  if (f.q) conds.push(sql`(${schema.shipment.number} ilike ${"%" + f.q + "%"} or ${schema.shipment.destinationText} ilike ${"%" + f.q + "%"})`);
  return db
    .select({ s: schema.shipment, origin: schema.warehouse, destination: schema.customerLocation })
    .from(schema.shipment)
    .innerJoin(schema.warehouse, eq(schema.warehouse.id, schema.shipment.originWarehouseId))
    .leftJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.shipment.destinationLocationId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.shipment.scheduledDate), desc(schema.shipment.createdAt))
    .limit(f.limit ?? 200)
    .offset(f.offset ?? 0);
}

export async function getShipment(db: DbOrTx, shipmentId: string) {
  const [s] = await db.select().from(schema.shipment).where(eq(schema.shipment.id, shipmentId));
  if (!s) return null;
  const [origin] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, s.originWarehouseId));
  const [destination] = s.destinationLocationId ? await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, s.destinationLocationId)) : [];
  const [destinationWarehouse] = s.destinationWarehouseId ? await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, s.destinationWarehouseId)) : [];
  const lines = await db
    .select({ line: schema.shipmentLine, sku: schema.sku, pos: schema.posItem, lot: schema.lot })
    .from(schema.shipmentLine)
    .leftJoin(schema.sku, eq(schema.sku.id, schema.shipmentLine.skuId))
    .leftJoin(schema.posItem, eq(schema.posItem.id, schema.shipmentLine.posItemId))
    .leftJoin(schema.lot, eq(schema.lot.id, schema.shipmentLine.lotId))
    .where(eq(schema.shipmentLine.shipmentId, shipmentId))
    .orderBy(asc(schema.shipmentLine.lineNo));
  const allocations = await db.select().from(schema.shipmentAllocation).where(and(eq(schema.shipmentAllocation.shipmentId, shipmentId), isNull(schema.shipmentAllocation.releasedAt)));
  const documents = await listDocuments(db, shipmentId);
  const invoices = await db
    .select({ inv: schema.invoice })
    .from(schema.invoiceShipment)
    .innerJoin(schema.invoice, eq(schema.invoice.id, schema.invoiceShipment.invoiceId))
    .where(eq(schema.invoiceShipment.shipmentId, shipmentId));
  const [pickup] = await db.select().from(schema.shipmentKegPickup).where(eq(schema.shipmentKegPickup.shipmentId, shipmentId));
  const [receipt] = await db.select().from(schema.shipmentReceipt).where(eq(schema.shipmentReceipt.shipmentId, shipmentId));
  const orders = await db
    .select({ o: schema.order })
    .from(schema.shipmentOrder)
    .innerJoin(schema.order, eq(schema.order.id, schema.shipmentOrder.orderId))
    .where(eq(schema.shipmentOrder.shipmentId, shipmentId));
  return { shipment: s, origin: origin ?? null, destination: destination ?? null, destinationWarehouse: destinationWarehouse ?? null, lines, allocations, documents, invoices: invoices.map((i) => i.inv), kegPickup: pickup ?? null, receipt: receipt ?? null, orders: orders.map((o) => o.o) };
}

/** The warehouse's master pull for an origin and scheduled date (5.2): aggregated by SKU and lot, plus the stops. */
export async function pullSheet(db: DbOrTx, actor: Actor, originWarehouseId: string, scheduledDate: string) {
  const [origin] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, originWarehouseId));
  if (!origin) throw new BusinessError("Origin not found");
  authorize(actor, "shipment.view", { marketId: origin.marketId });
  const shipments = await db
    .select({ s: schema.shipment, destination: schema.customerLocation })
    .from(schema.shipment)
    .leftJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.shipment.destinationLocationId))
    .where(and(eq(schema.shipment.originWarehouseId, originWarehouseId), eq(schema.shipment.scheduledDate, scheduledDate), inArray(schema.shipment.status, ["confirmed", "staged", "out", "delivered"]), eq(schema.shipment.legacy, false)))
    .orderBy(asc(schema.shipment.number));
  const ids = shipments.map((r) => r.s.id);
  const lines = ids.length
    ? await db
        .select({ l: schema.shipmentLine, sku: schema.sku, pos: schema.posItem })
        .from(schema.shipmentLine)
        .leftJoin(schema.sku, eq(schema.sku.id, schema.shipmentLine.skuId))
        .leftJoin(schema.posItem, eq(schema.posItem.id, schema.shipmentLine.posItemId))
        .where(inArray(schema.shipmentLine.shipmentId, ids))
    : [];
  const agg = new Map<string, { skuCode: string; description: string; lotCode: string | null; qty: number }>();
  for (const { l, sku, pos } of lines) {
    const key = `${sku?.code ?? pos?.code ?? "?"}|${l.lotCode ?? ""}`;
    const e = agg.get(key) ?? { skuCode: sku?.code ?? pos?.code ?? "?", description: sku ? `${sku.brand} ${sku.name}` : (pos?.name ?? "—"), lotCode: l.lotCode, qty: 0 };
    e.qty += l.qty;
    agg.set(key, e);
  }
  return {
    origin,
    scheduledDate,
    stops: shipments.map((r) => ({ shipment: r.s, destinationName: r.destination?.tradeName ?? r.s.destinationText ?? "—", lines: lines.filter((x) => x.l.shipmentId === r.s.id).map(({ l, sku, pos }) => ({ skuCode: sku?.code ?? pos?.code ?? "?", lotCode: l.lotCode, qty: l.qty })) })),
    aggregate: Array.from(agg.values()).sort((a, b) => a.skuCode.localeCompare(b.skuCode) || (a.lotCode ?? "").localeCompare(b.lotCode ?? "")),
  };
}
