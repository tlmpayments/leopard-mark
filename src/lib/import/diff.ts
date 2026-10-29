/**
 * Dry run (SHIPMENTS_SPEC §5): compare the normalised records with the database and produce, per entity, the rows to
 * create, the rows to update (with the fields that change) and the count of unchanged rows, plus the flagged and
 * excluded lists. The same comparison drives apply.ts, so a second apply finds nothing to do.
 *
 * Field semantics: `owned` fields always follow the workbook; `nonNull` fields follow it only when it carries a value
 * (the import never blanks something the office typed); `fill` fields are set on create and otherwise only when the
 * database has nothing. Records whose natural key (market code, origin code, SKU code, display name, batch number, lot
 * code, document or invoice number) already exists under another id adopt that id, so nothing is doubled.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { ids as schemaIds } from "./ids";
import type { AccountRecord, Excluded, Flag, InvoiceRecord, LotRecord, NormalizedImport, ShipmentRecord } from "./types";

export type Row = Record<string, unknown>;

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export type EntityName = "markets" | "origins" | "employees" | "skus" | "aliases" | "prices" | "accounts" | "batches" | "lots" | "shipments" | "invoices" | "links";

export const ENTITY_LABEL: Record<EntityName, string> = {
  markets: "Markets",
  origins: "Origins",
  employees: "People",
  skus: "SKUs",
  aliases: "SKU aliases",
  prices: "Prices",
  accounts: "Accounts",
  batches: "Batches",
  lots: "Lots",
  shipments: "Legacy shipments",
  invoices: "Legacy invoices",
  links: "Invoice to shipment links",
};

export const ENTITY_ORDER: EntityName[] = ["markets", "origins", "employees", "skus", "aliases", "prices", "accounts", "batches", "lots", "shipments", "invoices", "links"];

export interface ChildOp {
  table: string;
  action: "insert" | "upsert" | "update";
  id?: string;
  row: Row;
  set?: Row;
  /** Unique column for an upsert when it is not `id`. */
  conflictOn?: string[];
}

export interface RowPlan {
  entity: EntityName;
  id: string;
  label: string;
  action: "create" | "update" | "unchanged" | "skip";
  insert?: Row;
  set?: Row;
  changes: FieldChange[];
  children: ChildOp[];
  /** Why a row was skipped (never touched). */
  reason?: string;
  /** For the audit event. */
  marketId?: string | null;
}

export interface EntityReport {
  entity: EntityName;
  label: string;
  creates: Array<{ id: string; label: string; detail?: string }>;
  updates: Array<{ id: string; label: string; changes: FieldChange[] }>;
  skipped: Array<{ id: string; label: string; reason: string }>;
  unchanged: number;
}

export interface ImportReport {
  entities: EntityReport[];
  summary: Record<string, { create: number; update: number; unchanged: number; skipped: number }>;
  totals: { creates: number; updates: number; unchanged: number; skipped: number };
  flags: Flag[];
  excluded: Excluded[];
  missingTabs: string[];
  /** Lots that will carry an open lot_quantities_unconfirmed exception after apply. */
  unconfirmedLots: number;
}

export interface ImportPlan {
  report: ImportReport;
  rows: RowPlan[];
  /** Record id to database id where a natural key already existed. */
  idMap: Record<string, string>;
  /** Lot ids (database ids) with unknown quantities. */
  unconfirmedLotIds: string[];
  /** Database ids of lots that need the exception, with their lot codes and facility market. */
  unconfirmedLots: Array<{ lotId: string; lotCode: string; facilityName: string; marketId: string | null }>;
}

// ---------------------------------------------------------------------------
// Value comparison
// ---------------------------------------------------------------------------

function stable(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(stable);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, stable(o[k])]),
    );
  }
  return v;
}

const NUMBERISH = /^-?\d+(\.\d+)?$/;

export function same(a: unknown, b: unknown): boolean {
  const x = a === undefined ? null : a;
  const y = b === undefined ? null : b;
  if (x === null && y === null) return true;
  if (x === null || y === null) {
    // An empty array and null are the same absence.
    if (Array.isArray(x) && x.length === 0) return true;
    if (Array.isArray(y) && y.length === 0) return true;
    return false;
  }
  if (x instanceof Date || y instanceof Date) return stable(x) === stable(y) || (x instanceof Date && y instanceof Date && x.getTime() === y.getTime()) || (x instanceof Date && typeof y === "string" && x.getTime() === new Date(y).getTime()) || (y instanceof Date && typeof x === "string" && y.getTime() === new Date(x).getTime());
  if ((typeof x === "number" || (typeof x === "string" && NUMBERISH.test(x))) && (typeof y === "number" || (typeof y === "string" && NUMBERISH.test(y)))) {
    return Number(x) === Number(y);
  }
  if (typeof x === "object" || typeof y === "object") return JSON.stringify(stable(x)) === JSON.stringify(stable(y));
  return x === y;
}

interface Spec {
  owned?: Row;
  nonNull?: Row;
  fill?: Row;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Compare an existing row with the desired values; `null` existing means create. */
export function compare(existing: Row | null, spec: Spec): { action: "create" | "update" | "unchanged"; insert: Row; set: Row; changes: FieldChange[] } {
  const insert: Row = {};
  for (const src of [spec.fill, spec.nonNull, spec.owned]) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (src === spec.nonNull && v === null) continue;
      insert[k] = v;
    }
  }
  if (!existing) return { action: "create", insert, set: {}, changes: [] };
  const set: Row = {};
  const changes: FieldChange[] = [];
  const consider = (k: string, v: unknown) => {
    if (!same(existing[k], v)) {
      set[k] = v;
      changes.push({ field: k, from: existing[k] ?? null, to: v ?? null });
    }
  };
  for (const [k, v] of Object.entries(spec.owned ?? {})) consider(k, v);
  for (const [k, v] of Object.entries(spec.nonNull ?? {})) if (!isBlank(v)) consider(k, v);
  for (const [k, v] of Object.entries(spec.fill ?? {})) if (isBlank(existing[k]) && !isBlank(v)) consider(k, v);
  return { action: changes.length ? "update" : "unchanged", insert, set, changes };
}

// ---------------------------------------------------------------------------
// Existing state
// ---------------------------------------------------------------------------

async function chunked<T>(ids: string[], fetch: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 400) out.push(...(await fetch(ids.slice(i, i + 400))));
  return out;
}

type Existing = Awaited<ReturnType<typeof loadExisting>>;

async function loadExisting(db: DbOrTx, n: NormalizedImport) {
  const markets = await db.select().from(schema.market);
  const origins = await db.select().from(schema.warehouse);
  const employees = await db.select().from(schema.employee);
  const grants = await db.select().from(schema.roleGrant).where(isNull(schema.roleGrant.revokedAt));
  const skus = await db.select().from(schema.sku);
  const aliases = await db.select().from(schema.skuAlias);
  const posItems = await db.select().from(schema.posItem);
  const prices = await chunked(n.prices.map((p) => p.id), (part) => db.select().from(schema.marketPrice).where(inArray(schema.marketPrice.id, part)));
  const accountIds = n.accounts.map((a) => a.id);
  const locationsById = await chunked(accountIds, (part) => db.select().from(schema.customerLocation).where(inArray(schema.customerLocation.id, part)));
  const names = Array.from(new Set(n.accounts.map((a) => a.tradeName)));
  const locationsByName = await chunked(names, (part) => db.select().from(schema.customerLocation).where(inArray(schema.customerLocation.tradeName, part)));
  const locations = new Map<string, typeof schema.customerLocation.$inferSelect>();
  for (const l of [...locationsById, ...locationsByName]) locations.set(l.id, l);
  const locIds = Array.from(locations.keys());
  const locationAddresses = await chunked(locIds, (part) => db.select().from(schema.locationAddress).where(and(inArray(schema.locationAddress.locationId, part), eq(schema.locationAddress.current, true))));
  const addresses = await chunked(Array.from(new Set(locationAddresses.map((la) => la.addressId))), (part) => db.select().from(schema.address).where(inArray(schema.address.id, part)));
  const locationContacts = await chunked(locIds, (part) => db.select().from(schema.locationContact).where(and(inArray(schema.locationContact.locationId, part), eq(schema.locationContact.current, true))));
  const contacts = await chunked(Array.from(new Set(locationContacts.map((lc) => lc.contactId))), (part) => db.select().from(schema.contact).where(inArray(schema.contact.id, part)));
  const licenses = await chunked(locIds, (part) => db.select().from(schema.licenseVerification).where(and(inArray(schema.licenseVerification.locationId, part), eq(schema.licenseVerification.current, true))));
  const payments = await chunked(locIds, (part) => db.select().from(schema.paymentRelationship).where(and(inArray(schema.paymentRelationship.locationId, part), eq(schema.paymentRelationship.current, true))));
  const cleanings = await chunked(locIds, (part) => db.select().from(schema.cleaningObligation).where(inArray(schema.cleaningObligation.locationId, part)));
  const batches = await db.select().from(schema.brewBatch);
  const lots = await db.select().from(schema.lot);
  const lotQty = await chunked(lots.map((l) => l.id), (part) => db.select().from(schema.lotSkuQty).where(inArray(schema.lotSkuQty.lotId, part)));
  const shipNumbers = n.shipments.map((s) => s.number);
  const shipmentsByNumber = await chunked(shipNumbers, (part) => db.select().from(schema.shipment).where(inArray(schema.shipment.number, part)));
  const shipmentsById = await chunked(n.shipments.map((s) => s.id), (part) => db.select().from(schema.shipment).where(inArray(schema.shipment.id, part)));
  const shipments = new Map<string, typeof schema.shipment.$inferSelect>();
  for (const s of [...shipmentsById, ...shipmentsByNumber]) shipments.set(s.id, s);
  const shipIds = Array.from(shipments.keys());
  const shipmentLines = await chunked(shipIds, (part) => db.select().from(schema.shipmentLine).where(inArray(schema.shipmentLine.shipmentId, part)));
  const kegPickups = await chunked(shipIds, (part) => db.select().from(schema.shipmentKegPickup).where(inArray(schema.shipmentKegPickup.shipmentId, part)));
  const invoicesByNumber = await chunked(n.invoices.map((i) => i.number), (part) => db.select().from(schema.invoice).where(inArray(schema.invoice.number, part)));
  const invoicesById = await chunked(n.invoices.map((i) => i.id), (part) => db.select().from(schema.invoice).where(inArray(schema.invoice.id, part)));
  const invoices = new Map<string, typeof schema.invoice.$inferSelect>();
  for (const i of [...invoicesById, ...invoicesByNumber]) invoices.set(i.id, i);
  const invIds = Array.from(invoices.keys());
  const invoiceLines = await chunked(invIds, (part) => db.select().from(schema.invoiceLine).where(inArray(schema.invoiceLine.invoiceId, part)));
  const invoiceShipments = await chunked(invIds, (part) => db.select().from(schema.invoiceShipment).where(inArray(schema.invoiceShipment.invoiceId, part)));

  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
  const group = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = key(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return m;
  };
  return {
    markets: byId(markets),
    marketsByCode: new Map(markets.map((m) => [m.code, m.id])),
    origins: byId(origins),
    originsByCode: new Map(origins.filter((o) => o.originCode).map((o) => [o.originCode!, o.id])),
    employees: byId(employees),
    employeesByName: new Map(employees.map((e) => [e.displayName.trim().toLowerCase(), e.id])),
    grants: group(grants, (g) => g.employeeId),
    skus: byId(skus),
    skusByCode: new Map(skus.map((s) => [s.code, s.id])),
    aliases: new Map(aliases.map((a) => [a.alias, a])),
    posItems: new Map(posItems.map((p) => [p.code, p.id])),
    prices: byId(prices),
    locations,
    locationsByName: group(Array.from(locations.values()), (l) => l.tradeName.trim().toLowerCase()),
    locationAddresses: group(locationAddresses, (la) => la.locationId),
    addresses: byId(addresses),
    locationContacts: group(locationContacts, (lc) => lc.locationId),
    contacts: byId(contacts),
    licenses: new Map(licenses.map((l) => [l.locationId, l])),
    payments: new Map(payments.map((p) => [p.locationId, p])),
    cleanings: group(cleanings, (c) => c.locationId),
    batches: byId(batches),
    batchesByNumber: new Map(batches.map((b) => [b.batchNumber, b.id])),
    lots: byId(lots),
    lotsByCode: new Map(lots.map((l) => [l.lotCode, l.id])),
    lotQty: group(lotQty, (q) => q.lotId),
    shipments,
    shipmentsByNumber: new Map(Array.from(shipments.values()).filter((s) => s.number).map((s) => [s.number!, s.id])),
    shipmentLines: group(shipmentLines, (l) => l.shipmentId),
    kegPickups: new Map(kegPickups.map((k) => [k.shipmentId, k])),
    invoices,
    invoicesByNumber: new Map(Array.from(invoices.values()).filter((i) => i.number).map((i) => [i.number!, i.id])),
    invoiceLines: group(invoiceLines, (l) => l.invoiceId),
    invoiceShipments: new Set(invoiceShipments.map((x) => `${x.invoiceId}|${x.shipmentId}`)),
  };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function summarizeLines(lines: Array<{ qty: number; sku?: string | null; pos?: string | null; lot?: string | null }>): string {
  return lines.map((l) => `${l.sku ?? l.pos ?? "?"}${l.lot ? "@" + l.lot : ""}×${l.qty}`).join(", ");
}

export async function planImport(db: DbOrTx, n: NormalizedImport): Promise<ImportPlan> {
  const ex = await loadExisting(db, n);
  const idMap: Record<string, string> = {};
  const rid = (id: string): string => idMap[id] ?? id;
  const ridOrNull = (id: string | null | undefined): string | null => (id ? rid(id) : null);
  const rows: RowPlan[] = [];
  const flags: Flag[] = [...n.flags];
  const flag = (entity: string, key: string, message: string) => {
    if (!flags.some((f) => f.entity === entity && f.key === key && f.message === message)) flags.push({ entity, key, message });
  };

  // --- natural key resolution --------------------------------------------------------------
  for (const m of n.markets) {
    const existing = ex.marketsByCode.get(m.code);
    if (existing && existing !== m.id) idMap[m.id] = existing;
  }
  for (const o of n.origins) {
    const existing = o.originCode ? ex.originsByCode.get(o.originCode) : undefined;
    if (existing && existing !== o.id) idMap[o.id] = existing;
  }
  for (const e of n.employees) {
    const existing = ex.employeesByName.get(e.displayName.trim().toLowerCase());
    if (existing && existing !== e.id) idMap[e.id] = existing;
  }
  for (const s of n.skus) {
    const existing = ex.skusByCode.get(s.code);
    if (existing && existing !== s.id) idMap[s.id] = existing;
  }
  for (const a of n.accounts) {
    if (ex.locations.has(a.id)) continue;
    const sameName = ex.locationsByName.get(a.tradeName.trim().toLowerCase()) ?? [];
    if (sameName.length === 1) idMap[a.id] = sameName[0].id;
  }
  for (const b of n.batches) {
    const existing = ex.batchesByNumber.get(b.batchNumber);
    if (existing && existing !== b.id) idMap[b.id] = existing;
  }
  for (const l of n.lots) {
    const existing = ex.lotsByCode.get(l.lotCode);
    if (existing && existing !== l.id) idMap[l.id] = existing;
  }
  for (const s of n.shipments) {
    const existing = ex.shipmentsByNumber.get(s.number);
    if (existing && existing !== s.id) idMap[s.id] = existing;
  }
  for (const i of n.invoices) {
    const existing = ex.invoicesByNumber.get(i.number);
    if (existing && existing !== i.id) idMap[i.id] = existing;
  }

  // --- markets -------------------------------------------------------------------------------
  for (const m of n.markets) {
    const id = rid(m.id);
    const existing = ex.markets.get(id) ?? null;
    const c = compare(existing as Row | null, { owned: { code: m.code, name: m.name, timezone: m.timezone }, fill: { active: true, regionList: m.regionList.length ? m.regionList : null } });
    rows.push({ entity: "markets", id, label: m.code, action: c.action, insert: { id, ...c.insert }, set: c.set, changes: c.changes, children: [], marketId: id });
  }

  // --- origins -------------------------------------------------------------------------------
  for (const o of n.origins) {
    const id = rid(o.id);
    const existing = ex.origins.get(id) ?? null;
    const c = compare(existing as Row | null, {
      owned: {
        name: o.name,
        marketId: ridOrNull(o.marketId),
        isPrimary: o.isPrimary,
        originCode: o.originCode,
        lotFacilityCode: o.lotFacilityCode,
        kind: o.kind,
        addressText: o.addressText,
        addressLine1: o.addressLine1,
        addressLine2: o.addressLine2,
        addressCity: o.addressCity,
        addressState: o.addressState,
        addressPostalCode: o.addressPostalCode,
      },
      fill: { active: o.active, fulfillmentContact: o.fulfillmentContact, shippingContactEmail: o.shippingContactEmail, shippingContactPhone: o.shippingContactPhone, appointmentRequired: o.appointmentRequired, loadingDock: o.loadingDock, hours: o.hours },
    });
    rows.push({ entity: "origins", id, label: `${o.originCode ? o.originCode + " · " : ""}${o.name}`, action: c.action, insert: { id, ...c.insert }, set: c.set, changes: c.changes, children: [], marketId: ridOrNull(o.marketId) });
  }

  // --- people --------------------------------------------------------------------------------
  for (const e of n.employees) {
    const id = rid(e.id);
    const existing = ex.employees.get(id) ?? null;
    const c = compare(existing as Row | null, { owned: { displayName: e.displayName }, fill: { enabled: e.enabled, disableReason: e.disableReason, disabledAt: e.enabled ? null : new Date() } });
    const children: ChildOp[] = [];
    const have = ex.grants.get(id) ?? [];
    for (const g of e.grants) {
      const marketId = ridOrNull(g.marketId);
      if (have.some((h) => h.role === g.role && (h.marketId ?? null) === marketId)) continue;
      children.push({ table: "role_grant", action: "insert", id: g.id, row: { id: g.id, employeeId: id, role: g.role, marketId } });
      c.changes.push({ field: "grant", from: null, to: `${g.role}${g.marketCode ? " · " + g.marketCode : ""}` });
    }
    const action = c.action === "create" ? "create" : c.changes.length ? "update" : "unchanged";
    rows.push({ entity: "employees", id, label: e.displayName, action, insert: { id, ...c.insert }, set: c.set, changes: c.changes, children });
  }

  // --- skus ----------------------------------------------------------------------------------
  for (const s of n.skus) {
    const id = rid(s.id);
    const existing = ex.skus.get(id) ?? null;
    const c = compare(existing as Row | null, {
      owned: { code: s.code, name: s.name, brand: s.brand, packageKind: s.packageKind, sellingUnit: s.sellingUnit, kegsPerUnit: s.kegsPerUnit },
      nonNull: { recipeVariant: s.recipeVariant },
      fill: { weightLb: s.weightLb, upcCase: s.upcCase, upcRetail: s.upcRetail, upcUnit: s.upcUnit, palletFraction: s.palletFraction, archivedAt: s.archived ? new Date() : null },
    });
    rows.push({ entity: "skus", id, label: `${s.code}${s.archived ? " (archived)" : ""}`, action: c.action, insert: { id, ...c.insert }, set: c.set, changes: c.changes, children: [] });
  }

  // --- aliases -------------------------------------------------------------------------------
  for (const a of n.aliases) {
    const existing = ex.aliases.get(a.alias) ?? null;
    const skuId = rid(a.skuId);
    const c = compare(existing as Row | null, { owned: { skuId }, fill: { note: a.note } });
    rows.push({ entity: "aliases", id: a.alias, label: `${a.alias} = ${a.skuCode}`, action: c.action, insert: { alias: a.alias, ...c.insert }, set: c.set, changes: c.changes, children: [] });
  }

  // --- prices --------------------------------------------------------------------------------
  for (const p of n.prices) {
    const existing = ex.prices.get(p.id) ?? null;
    const c = compare(existing as Row | null, { owned: { priceCents: p.priceCents }, fill: { marketId: rid(p.marketId), skuId: rid(p.skuId), effectiveFrom: new Date(`${p.asOf}T00:00:00Z`) } });
    rows.push({ entity: "prices", id: p.id, label: `${p.marketCode} · ${p.skuCode}`, action: c.action, insert: { id: p.id, ...c.insert }, set: c.set, changes: c.changes, children: [], marketId: rid(p.marketId) });
  }

  // --- accounts ------------------------------------------------------------------------------
  for (const a of n.accounts) rows.push(planAccount(a, ex, rid, ridOrNull, flag));

  // --- batches -------------------------------------------------------------------------------
  for (const b of n.batches) {
    const id = rid(b.id);
    const existing = ex.batches.get(id) ?? null;
    const facility = rid(b.facilityOriginId);
    const c = compare(existing as Row | null, {
      owned: { batchNumber: b.batchNumber, facilityWarehouseId: facility, brandCode: b.brandCode, brewDate: b.brewDate, status: b.status },
      nonNull: { vesselSize: b.vesselSize, statusReason: b.statusReason, statusChangedOn: b.statusChangedOn, breweryBatchNumber: b.breweryBatchNumber, notes: b.notes },
      fill: { source: "imported" },
    });
    rows.push({ entity: "batches", id, label: b.batchNumber, action: c.action, insert: { id, ...c.insert }, set: c.set, changes: c.changes, children: [], marketId: ex.origins.get(facility)?.marketId ?? null });
  }

  // --- lots ----------------------------------------------------------------------------------
  const unconfirmedLots: ImportPlan["unconfirmedLots"] = [];
  for (const l of n.lots) rows.push(planLot(l, ex, rid, ridOrNull, unconfirmedLots));

  // --- shipments -----------------------------------------------------------------------------
  for (const s of n.shipments) rows.push(planShipment(s, ex, rid, ridOrNull, flag));

  // --- invoices ------------------------------------------------------------------------------
  for (const i of n.invoices) rows.push(planInvoice(i, ex, rid, ridOrNull, flag));

  // --- links ---------------------------------------------------------------------------------
  const invoiceByNumber = new Map(n.invoices.map((i) => [i.number, rid(i.id)]));
  const shipmentByNumber = new Map(n.shipments.map((s) => [s.number, rid(s.id)]));
  for (const l of n.links) {
    const invoiceId = invoiceByNumber.get(l.invoiceNumber);
    const shipmentId = shipmentByNumber.get(l.shipmentNumber);
    if (!invoiceId || !shipmentId) continue;
    const skippedParent = rows.find((r) => (r.entity === "invoices" && r.id === invoiceId && r.action === "skip") || (r.entity === "shipments" && r.id === shipmentId && r.action === "skip"));
    const key = `${invoiceId}|${shipmentId}`;
    const label = `${l.invoiceNumber} with ${l.shipmentNumber}`;
    if (skippedParent) rows.push({ entity: "links", id: key, label, action: "skip", changes: [], children: [], reason: "A linked document is not an imported legacy row" });
    else if (ex.invoiceShipments.has(key)) rows.push({ entity: "links", id: key, label, action: "unchanged", changes: [], children: [] });
    else rows.push({ entity: "links", id: key, label, action: "create", insert: { invoiceId, shipmentId }, changes: [], children: [] });
  }

  // --- report --------------------------------------------------------------------------------
  const entities: EntityReport[] = ENTITY_ORDER.map((entity) => ({ entity, label: ENTITY_LABEL[entity], creates: [], updates: [], skipped: [], unchanged: 0 }));
  const byEntity = new Map(entities.map((e) => [e.entity, e]));
  for (const r of rows) {
    const e = byEntity.get(r.entity)!;
    if (r.action === "create") e.creates.push({ id: r.id, label: r.label, detail: r.changes.length ? r.changes.map((c) => `${c.field}: ${String(c.to)}`).join("; ") : undefined });
    else if (r.action === "update") e.updates.push({ id: r.id, label: r.label, changes: r.changes });
    else if (r.action === "skip") e.skipped.push({ id: r.id, label: r.label, reason: r.reason ?? "" });
    else e.unchanged += 1;
  }
  const summary: ImportReport["summary"] = {};
  const totals = { creates: 0, updates: 0, unchanged: 0, skipped: 0 };
  for (const e of entities) {
    summary[e.entity] = { create: e.creates.length, update: e.updates.length, unchanged: e.unchanged, skipped: e.skipped.length };
    totals.creates += e.creates.length;
    totals.updates += e.updates.length;
    totals.unchanged += e.unchanged;
    totals.skipped += e.skipped.length;
  }
  return {
    report: { entities, summary, totals, flags, excluded: n.excluded, missingTabs: n.missingTabs, unconfirmedLots: unconfirmedLots.length },
    rows,
    idMap,
    unconfirmedLotIds: unconfirmedLots.map((u) => u.lotId),
    unconfirmedLots,
  };
}

type Rid = (id: string) => string;
type RidOrNull = (id: string | null | undefined) => string | null;
type FlagFn = (entity: string, key: string, message: string) => void;

function planAccount(a: AccountRecord, ex: Existing, rid: Rid, ridOrNull: RidOrNull, flag: FlagFn): RowPlan {
  const id = rid(a.id);
  const existing = ex.locations.get(id) ?? null;
  const marketId = rid(a.marketId);
  const owned: Row = { tradeName: a.tradeName, marketId, kind: a.kind, termsDaysOverride: a.termsDaysOverride, fulfilment: a.fulfilment };
  if (a.servedByLocationId !== undefined) owned.servedByLocationId = ridOrNull(a.servedByLocationId);
  // Status: active per the decisions, but a location the office closed stays closed.
  if (!existing || existing.status !== "closed") owned.status = a.status;
  else flag("account", a.tradeName, "Closed in fv-ops; the import leaves it closed");
  const c = compare(existing as Row | null, {
    owned,
    nonNull: { legalName: a.legalName, legacyAccountId: a.legacyAccountId, region: a.region, deliveryInstructions: a.deliveryInstructions, receivingRestrictions: a.receivingRestrictions },
    fill: { firstDeliveryOn: a.firstDeliveryOn, originatingRepEmployeeId: ridOrNull(a.originatingRepEmployeeId) },
  });
  const children: ChildOp[] = [];
  const changes = c.changes;
  const addrRows = ex.locationAddresses.get(id) ?? [];
  const contactRows = ex.locationContacts.get(id) ?? [];

  // Delivery address
  const deliveryAddressId = schemaIds.address(id, "delivery");
  if (a.delivery) {
    const current = addrRows.find((r) => r.kind === "delivery");
    const existingAddr = current ? ex.addresses.get(current.addressId) ?? null : null;
    const want = { line1: a.delivery.line1, city: a.delivery.city, state: a.delivery.state || "CA", postalCode: a.delivery.postal };
    const cmp = compare(existingAddr as Row | null, { owned: want });
    if (cmp.action === "create") {
      children.push({ table: "address", action: "insert", id: deliveryAddressId, row: { id: deliveryAddressId, ...want, provenance: "admin_entered" } });
      children.push({ table: "location_address", action: "insert", id: schemaIds.locationAddress(id, "delivery"), row: { id: schemaIds.locationAddress(id, "delivery"), locationId: id, addressId: deliveryAddressId, kind: "delivery" } });
      if (existing) changes.push({ field: "delivery address", from: null, to: `${want.line1}, ${want.city}, ${want.state} ${want.postalCode}` });
    } else if (cmp.action === "update") {
      children.push({ table: "address", action: "update", id: existingAddr!.id as string, row: {}, set: cmp.set });
      for (const ch of cmp.changes) changes.push({ field: `delivery address.${ch.field}`, from: ch.from, to: ch.to });
    }
    // Billing address: its own row when the workbook has one, else the delivery address.
    const billingLink = addrRows.find((r) => r.kind === "billing");
    if (a.billing) {
      const billingId = schemaIds.address(id, "billing");
      const existingBill = billingLink && billingLink.addressId !== (existingAddr?.id ?? deliveryAddressId) ? ex.addresses.get(billingLink.addressId) ?? null : null;
      const wantB = { line1: a.billing.line1, city: a.billing.city, state: a.billing.state || "CA", postalCode: a.billing.postal };
      const cmpB = compare(existingBill as Row | null, { owned: wantB });
      if (cmpB.action === "create") {
        children.push({ table: "address", action: "upsert", id: billingId, row: { id: billingId, ...wantB, provenance: "admin_entered" }, set: wantB });
        if (!billingLink) children.push({ table: "location_address", action: "insert", id: schemaIds.locationAddress(id, "billing"), row: { id: schemaIds.locationAddress(id, "billing"), locationId: id, addressId: billingId, kind: "billing" } });
        else children.push({ table: "location_address", action: "update", id: billingLink.id, row: {}, set: { addressId: billingId } });
        if (existing) changes.push({ field: "billing address", from: null, to: `${wantB.line1}, ${wantB.city}, ${wantB.state} ${wantB.postalCode}` });
      } else if (cmpB.action === "update") {
        children.push({ table: "address", action: "update", id: existingBill!.id as string, row: {}, set: cmpB.set });
        for (const ch of cmpB.changes) changes.push({ field: `billing address.${ch.field}`, from: ch.from, to: ch.to });
      }
    } else if (!billingLink) {
      children.push({ table: "location_address", action: "insert", id: schemaIds.locationAddress(id, "billing"), row: { id: schemaIds.locationAddress(id, "billing"), locationId: id, addressId: existingAddr ? (existingAddr.id as string) : deliveryAddressId, kind: "billing" } });
      if (existing) changes.push({ field: "billing address", from: null, to: "same as delivery" });
    }
  }

  // Contacts
  const buyerLink = contactRows.find((r) => r.contactRole === "buyer");
  if (a.buyer) {
    const existingBuyer = buyerLink ? ex.contacts.get(buyerLink.contactId) ?? null : null;
    const cmp = compare(existingBuyer as Row | null, { nonNull: { name: a.buyer.name, email: a.buyer.email, phone: a.buyer.phone } });
    const contactId = schemaIds.contact(id, "buyer");
    if (cmp.action === "create") {
      children.push({ table: "contact", action: "upsert", id: contactId, row: { id: contactId, name: a.buyer.name, email: a.buyer.email, phone: a.buyer.phone }, set: { name: a.buyer.name, email: a.buyer.email, phone: a.buyer.phone } });
      children.push({ table: "location_contact", action: "insert", id: schemaIds.locationContact(id, "buyer"), row: { id: schemaIds.locationContact(id, "buyer"), locationId: id, contactId, contactRole: "buyer", mayOrder: true, receivesInvoices: !a.apEmail, mayAuthorizePayment: false } });
      if (existing) changes.push({ field: "ordering contact", from: null, to: a.buyer.name });
    } else if (cmp.action === "update") {
      children.push({ table: "contact", action: "update", id: existingBuyer!.id as string, row: {}, set: cmp.set });
      for (const ch of cmp.changes) changes.push({ field: `ordering contact.${ch.field}`, from: ch.from, to: ch.to });
    }
  }
  const apLink = contactRows.find((r) => r.contactRole === "ap");
  if (a.apEmail) {
    const existingAp = apLink ? ex.contacts.get(apLink.contactId) ?? null : null;
    const cmp = compare(existingAp as Row | null, { nonNull: { email: a.apEmail }, fill: { name: "Accounts payable" } });
    const contactId = schemaIds.contact(id, "ap");
    if (cmp.action === "create") {
      children.push({ table: "contact", action: "upsert", id: contactId, row: { id: contactId, name: "Accounts payable", email: a.apEmail, phone: null }, set: { email: a.apEmail } });
      children.push({ table: "location_contact", action: "insert", id: schemaIds.locationContact(id, "ap"), row: { id: schemaIds.locationContact(id, "ap"), locationId: id, contactId, contactRole: "ap", mayOrder: false, receivesInvoices: true, mayAuthorizePayment: false } });
      if (existing) changes.push({ field: "billing contact", from: null, to: a.apEmail });
    } else if (cmp.action === "update") {
      children.push({ table: "contact", action: "update", id: existingAp!.id as string, row: {}, set: cmp.set });
      for (const ch of cmp.changes) changes.push({ field: `billing contact.${ch.field}`, from: ch.from, to: ch.to });
    }
  }

  // License (current row per location), payment relationship (create only), cleaning obligation
  const lic = ex.licenses.get(id) ?? null;
  if (!lic) {
    children.push({ table: "license_verification", action: "insert", id: schemaIds.license(id), row: { id: schemaIds.license(id), locationId: id, licenseNumber: a.license, state: "unverified", note: `Imported from the ${a.sourceTab} tab; not yet verified` } });
    if (existing) changes.push({ field: "license", from: null, to: a.license ?? "(none)" });
  } else if (a.license && isBlankValue(lic.licenseNumber)) {
    children.push({ table: "license_verification", action: "update", id: lic.id, row: {}, set: { licenseNumber: a.license } });
    changes.push({ field: "license", from: lic.licenseNumber, to: a.license });
  }
  if (!ex.payments.get(id)) {
    children.push({ table: "payment_relationship", action: "insert", id: schemaIds.payment(id), row: { id: schemaIds.payment(id), locationId: id, channel: a.channel, setupState: a.setupState, sharedPayerNote: a.payNote } });
    if (existing) changes.push({ field: "payment", from: null, to: a.channel });
  }
  const cleaning = (ex.cleanings.get(id) ?? [])[0] ?? null;
  if (!cleaning) {
    children.push({ table: "cleaning_obligation", action: "insert", id: schemaIds.cleaning(id), row: { id: schemaIds.cleaning(id), locationId: id, applicable: "unknown", lastCompletedOn: a.lastCleaning } });
    if (existing) changes.push({ field: "cleaning", from: null, to: a.lastCleaning ?? "unknown" });
  } else if (a.lastCleaning && !same(cleaning.lastCompletedOn, a.lastCleaning)) {
    children.push({ table: "cleaning_obligation", action: "update", id: cleaning.id, row: {}, set: { lastCompletedOn: a.lastCleaning } });
    changes.push({ field: "last line cleaning", from: cleaning.lastCompletedOn, to: a.lastCleaning });
  }

  const action = c.action === "create" ? "create" : changes.length ? "update" : "unchanged";
  return { entity: "accounts", id, label: a.tradeName, action, insert: { id, ...c.insert }, set: c.set, changes, children, marketId };
}

function isBlankValue(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function planLot(l: LotRecord, ex: Existing, rid: Rid, ridOrNull: RidOrNull, unconfirmed: ImportPlan["unconfirmedLots"]): RowPlan {
  const id = rid(l.id);
  const existing = ex.lots.get(id) ?? null;
  const facility = rid(l.facilityOriginId);
  const owned: Row = { lotCode: l.lotCode, facilityWarehouseId: facility, brandCode: l.brandCode, packagingDate: l.packagingDate, runCode: l.runCode };
  // Quantities become known, never unknown again.
  if (!existing || (!existing.quantitiesKnown && l.quantitiesKnown)) owned.quantitiesKnown = l.quantitiesKnown;
  const c = compare(existing as Row | null, { owned, nonNull: { batchId: ridOrNull(l.batchId), legacyCode: l.legacyCode }, fill: { source: l.source, notes: l.notes } });
  const children: ChildOp[] = [];
  const changes = c.changes;
  if (l.quantitiesKnown) {
    const have = new Map((ex.lotQty.get(id) ?? []).map((q) => [q.skuId, q]));
    for (const q of l.quantities) {
      const skuId = rid(q.skuId);
      const cur = have.get(skuId);
      if (cur && cur.qtyPackaged === q.qty) continue;
      children.push({ table: "lot_sku_qty", action: "upsert", id: q.id, row: { id: q.id, lotId: id, skuId, qtyPackaged: q.qty }, set: { qtyPackaged: q.qty }, conflictOn: ["lotId", "skuId"] });
      if (existing) changes.push({ field: `quantity ${q.skuCode}`, from: cur?.qtyPackaged ?? null, to: q.qty });
    }
  }
  const known = existing ? existing.quantitiesKnown || l.quantitiesKnown : l.quantitiesKnown;
  const facilityRow = ex.origins.get(facility);
  if (!known) unconfirmed.push({ lotId: id, lotCode: l.lotCode, facilityName: facilityRow?.name ?? "the host", marketId: facilityRow?.marketId ?? null });
  const action = c.action === "create" ? "create" : changes.length ? "update" : "unchanged";
  return { entity: "lots", id, label: `${l.lotCode}${l.legacyCode ? ` (${l.legacyCode})` : ""}${l.source === "bol_log_backfill" ? " · backfilled" : ""}`, action, insert: { id, ...c.insert }, set: c.set, changes, children, marketId: facilityRow?.marketId ?? null };
}

function planShipment(s: ShipmentRecord, ex: Existing, rid: Rid, ridOrNull: RidOrNull, flag: FlagFn): RowPlan {
  const id = rid(s.id);
  const existing = ex.shipments.get(id) ?? null;
  const label = `${s.number} · ${s.destinationLabel}`;
  if (existing && !existing.legacy) {
    flag("shipment", s.number, "A shipment with this number exists in fv-ops and is not legacy history; left untouched");
    return { entity: "shipments", id, label, action: "skip", changes: [], children: [], reason: "Not a legacy row" };
  }
  const lineRows = s.lines.map((l) => ({
    id: l.id,
    shipmentId: id,
    lineNo: l.lineNo,
    skuId: ridOrNull(l.skuId),
    posItemId: l.posItemCode ? ex.posItems.get(l.posItemCode) ?? null : null,
    lotId: ridOrNull(l.lotId),
    lotCode: l.lotCode,
    qty: l.qty,
    unitPriceCents: null,
    weightLb: l.weightLb,
  }));
  for (const l of s.lines) if (l.posItemCode && !ex.posItems.get(l.posItemCode)) flag("shipment", s.number, `POS item ${l.posItemCode} is not seeded; the line is imported without an item`);
  const c = compare(existing as Row | null, {
    owned: {
      number: s.number,
      type: s.type,
      originWarehouseId: rid(s.originId),
      destinationLocationId: ridOrNull(s.destinationLocationId),
      destinationWarehouseId: ridOrNull(s.destinationWarehouseId),
      destinationText: s.destinationText,
      pickup: s.pickup,
      template: s.template,
      scheduledDate: s.scheduledDate,
      actualDate: s.actualDate,
      carrier: s.carrier,
      carrierPhone: s.carrierPhone,
      freightClass: s.freightClass,
      palletCount: s.palletCount,
      appointment: s.appointment,
      deliveryWindow: s.deliveryWindow,
      receivingInstructions: s.receivingInstructions,
      notes: s.notes,
      legacy: true,
      legacyPayload: s.legacyPayload,
      mergedIntoShipmentId: ridOrNull(s.mergedIntoShipmentId),
      marketId: ridOrNull(s.marketId),
    },
    fill: { status: "delivered", revision: 0 },
  });
  const children: ChildOp[] = [];
  const changes = c.changes;
  const have = new Map((ex.shipmentLines.get(id) ?? []).map((l) => [l.id, l]));
  let linesChanged = false;
  for (const lr of lineRows) {
    const cur = have.get(lr.id) ?? null;
    const cmp = compare(cur as Row | null, { owned: { lineNo: lr.lineNo, skuId: lr.skuId, posItemId: lr.posItemId, lotId: lr.lotId, lotCode: lr.lotCode, qty: lr.qty, weightLb: lr.weightLb } });
    if (cmp.action === "unchanged") continue;
    linesChanged = true;
    children.push({ table: "shipment_line", action: "upsert", id: lr.id, row: lr, set: cmp.set });
  }
  if (existing && linesChanged) changes.push({ field: "lines", from: summarizeLines((ex.shipmentLines.get(id) ?? []).map((l) => ({ qty: l.qty, sku: l.skuId ? ex.skus.get(l.skuId)?.code : null, lot: l.lotCode }))), to: summarizeLines(s.lines.map((l) => ({ qty: l.qty, sku: l.skuCode, pos: l.posItemCode, lot: l.lotCode }))) });
  if (s.kegPickup && (s.kegPickup.halfIn || s.kegPickup.sixtelIn)) {
    const cur = ex.kegPickups.get(id) ?? null;
    if (!cur || cur.halfIn !== s.kegPickup.halfIn || cur.sixtelIn !== s.kegPickup.sixtelIn) {
      children.push({ table: "shipment_keg_pickup", action: "upsert", id: id, row: { shipmentId: id, halfIn: s.kegPickup.halfIn, sixtelIn: s.kegPickup.sixtelIn }, set: { halfIn: s.kegPickup.halfIn, sixtelIn: s.kegPickup.sixtelIn }, conflictOn: ["shipmentId"] });
      if (existing) changes.push({ field: "empty kegs collected", from: cur ? `${cur.halfIn}/${cur.sixtelIn}` : null, to: `${s.kegPickup.halfIn}/${s.kegPickup.sixtelIn}` });
    }
  }
  const action = c.action === "create" ? "create" : changes.length ? "update" : "unchanged";
  return { entity: "shipments", id, label, action, insert: { id, ...c.insert }, set: c.set, changes, children, marketId: ridOrNull(s.marketId) };
}

function planInvoice(i: InvoiceRecord, ex: Existing, rid: Rid, ridOrNull: RidOrNull, flag: FlagFn): RowPlan {
  const id = rid(i.id);
  const existing = ex.invoices.get(id) ?? null;
  const label = `${i.number} · ${i.customerText || "(no customer)"}`;
  if (existing && !existing.legacy) {
    flag("invoice", i.number, "An invoice with this number exists in fv-ops and is not legacy history; left untouched");
    return { entity: "invoices", id, label, action: "skip", changes: [], children: [], reason: "Not a legacy row" };
  }
  const c = compare(existing as Row | null, {
    owned: { number: i.number, series: i.series, status: i.status, legacy: true, legacyStatus: i.legacyStatus, legacyPayload: i.legacyPayload, invoiceDate: i.invoiceDate, subtotalCents: i.subtotalCents, totalCents: i.totalCents, depositCents: 0 },
    nonNull: { locationId: ridOrNull(i.locationId), marketId: ridOrNull(i.marketId), notes: i.notes },
  });
  const children: ChildOp[] = [];
  const changes = c.changes;
  const have = new Map((ex.invoiceLines.get(id) ?? []).map((l) => [l.id, l]));
  let linesChanged = false;
  for (const l of i.lines) {
    const row = { id: l.id, invoiceId: id, lineNo: l.lineNo, kind: l.kind, skuId: ridOrNull(l.skuId), description: l.description, lotCode: l.lotCode, qty: l.qty, unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents };
    const cur = have.get(l.id) ?? null;
    const cmp = compare(cur as Row | null, { owned: { lineNo: row.lineNo, kind: row.kind, skuId: row.skuId, description: row.description, lotCode: row.lotCode, qty: row.qty, unitPriceCents: row.unitPriceCents, lineTotalCents: row.lineTotalCents } });
    if (cmp.action === "unchanged") continue;
    linesChanged = true;
    children.push({ table: "invoice_line", action: "upsert", id: l.id, row, set: cmp.set });
  }
  if (existing && linesChanged) changes.push({ field: "lines", from: `${(ex.invoiceLines.get(id) ?? []).length} line(s)`, to: `${i.lines.length} line(s): ${summarizeLines(i.lines.map((l) => ({ qty: l.qty, sku: l.skuCode ?? l.description, lot: l.lotCode })))}` });
  const action = c.action === "create" ? "create" : changes.length ? "update" : "unchanged";
  return { entity: "invoices", id, label, action, insert: { id, ...c.insert }, set: c.set, changes, children, marketId: ridOrNull(i.marketId) };
}

