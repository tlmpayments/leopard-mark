/**
 * Shipments, lots, documents, invoices, keg events, counts and company settings.
 *
 * Source: docs/SHIPMENTS_SPEC.md (owner decisions of October 28, 2026). The
 * BOL is a rendered output of a shipment record; the record carries the
 * number, the dates, the account, the lots, and drives the documents, the
 * invoice, the ledger movement and the keg balance.
 */
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { customerLocation } from "./customer";
import { market, posItem, sku, warehouse } from "./market";
import { order } from "./order";

/** Postgres bytea for stored PDFs (6.7). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ---------------------------------------------------------------------------
// Lots (section 4)
// ---------------------------------------------------------------------------

export const batchStatusEnum = pgEnum("batch_status", [
  "scheduled",
  "in_progress",
  "complete",
  "destroyed",
  "cancelled",
]);

export const lotSourceEnum = pgEnum("lot_source", [
  "production_tab",
  "bol_log_backfill",
  "packaging_report",
]);

/** A brew at a host brewery (4.2). Usually yields one lot; two-date packaging rule is open (4.5). */
export const brewBatch = pgTable(
  "brew_batch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityWarehouseId: uuid("facility_warehouse_id")
      .notNull()
      .references(() => warehouse.id),
    brandCode: text("brand_code").notNull(), // SLG, CNT, GSP, XHZ, XVN, XAL
    batchNumber: text("batch_number").notNull().unique(), // B01CNT26001
    brewDate: date("brew_date"),
    vesselSize: text("vessel_size"),
    status: batchStatusEnum("status").notNull().default("scheduled"),
    statusReason: text("status_reason"),
    statusChangedOn: date("status_changed_on"),
    breweryBatchNumber: text("brewery_batch_number"),
    notes: text("notes"),
    source: text("source").notNull().default("entered"), // imported | entered
    createdByEmployeeId: uuid("created_by_employee_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("brew_batch_facility_idx").on(t.facilityWarehouseId, t.brewDate)],
);

/** A packaging run: facility (2) + brand (3) + packaging date yymmdd + run (1), e.g. 01CNT2610071. */
export const lot = pgTable(
  "lot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotCode: text("lot_code").notNull().unique(),
    facilityWarehouseId: uuid("facility_warehouse_id")
      .notNull()
      .references(() => warehouse.id),
    brandCode: text("brand_code").notNull(),
    packagingDate: date("packaging_date").notNull(),
    runCode: text("run_code").notNull(),
    batchId: uuid("batch_id").references(() => brewBatch.id),
    /** False for lots backfilled from the BOL log until the host confirms quantities (1.4, 4.6). */
    quantitiesKnown: boolean("quantities_known").notNull().default(true),
    source: lotSourceEnum("source").notNull().default("packaging_report"),
    /** Dotted legacy code (TLM.EBB.SGB.001): history only, never selectable (1.7). */
    legacyCode: text("legacy_code"),
    notes: text("notes"),
    createdByEmployeeId: uuid("created_by_employee_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lot_facility_idx").on(t.facilityWarehouseId, t.packagingDate)],
);

/** Quantities packaged per SKU in a lot (4.3). */
export const lotSkuQty = pgTable(
  "lot_sku_qty",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => lot.id),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id),
    qtyPackaged: integer("qty_packaged").notNull().default(0),
  },
  (t) => [uniqueIndex("lot_sku_qty_uq").on(t.lotId, t.skuId)],
);

// ---------------------------------------------------------------------------
// Shipments (section 5)
// ---------------------------------------------------------------------------

export const shipmentTypeEnum = pgEnum("shipment_type", ["D", "T", "S"]);
export const shipmentTemplateEnum = pgEnum("shipment_template", ["distributor", "retail", "transfer"]);
export const shipmentStatusEnum = pgEnum("shipment_status", [
  "draft",
  "confirmed",
  "staged",
  "out",
  "delivered",
  "voided",
]);

export const shipment = pgTable(
  "shipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** ORIGIN-TYPE-YYMMDD-SEQ; null while draft; assigned once at confirmation and never changed (5.3, 5.4). */
    number: text("number").unique(),
    type: shipmentTypeEnum("type").notNull(),
    originWarehouseId: uuid("origin_warehouse_id")
      .notNull()
      .references(() => warehouse.id),
    destinationLocationId: uuid("destination_location_id").references(() => customerLocation.id),
    destinationWarehouseId: uuid("destination_warehouse_id").references(() => warehouse.id),
    /** Samples to a person or event, legacy driver loads: free text when no account or origin applies. */
    destinationText: text("destination_text"),
    /** Will-call: picked up at the origin (legacy P) — type stays D (5.5). */
    pickup: boolean("pickup").notNull().default(false),
    template: shipmentTemplateEnum("template").notNull().default("retail"),
    scheduledDate: date("scheduled_date").notNull(),
    actualDate: date("actual_date"),
    status: shipmentStatusEnum("status").notNull().default("draft"),
    poNumbers: text("po_numbers").array(),
    appointment: text("appointment"),
    carrier: text("carrier"),
    carrierPhone: text("carrier_phone"),
    sealNumber: text("seal_number"),
    trailerNumber: text("trailer_number"),
    palletCount: integer("pallet_count"),
    palletBuild: text("pallet_build"),
    freightClass: text("freight_class"),
    deliveryWindow: text("delivery_window"),
    receivingInstructions: text("receiving_instructions"),
    notes: text("notes"),
    /** Required for a direct shipment to a distributor-served account (2.6). */
    overrideReason: text("override_reason"),
    driverEmployeeId: uuid("driver_employee_id"),
    /** Incremented on each document regeneration after confirmation; printed as R<n> (5.4, 6.7). */
    revision: integer("revision").notNull().default(0),
    /** Imported from the BOL Maker Log: history only, no ledger effect (5.13). */
    legacy: boolean("legacy").notNull().default(false),
    legacyPayload: jsonb("legacy_payload"),
    mergedIntoShipmentId: uuid("merged_into_shipment_id"),
    marketId: uuid("market_id").references(() => market.id),
    createdByEmployeeId: uuid("created_by_employee_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedByEmployeeId: uuid("confirmed_by_employee_id"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    deliveredByEmployeeId: uuid("delivered_by_employee_id"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    voidedByEmployeeId: uuid("voided_by_employee_id"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
  },
  (t) => [
    index("shipment_origin_date_idx").on(t.originWarehouseId, t.scheduledDate),
    index("shipment_destination_idx").on(t.destinationLocationId),
    index("shipment_status_idx").on(t.status),
    index("shipment_market_idx").on(t.marketId),
  ],
);

export const shipmentLine = pgTable(
  "shipment_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipment.id),
    lineNo: integer("line_no").notNull(),
    skuId: uuid("sku_id").references(() => sku.id),
    posItemId: uuid("pos_item_id").references(() => posItem.id),
    lotId: uuid("lot_id").references(() => lot.id),
    /** Legacy text when no lot row exists; otherwise mirrors lot.lot_code for printing. */
    lotCode: text("lot_code"),
    qty: integer("qty").notNull(),
    /** Captured at confirmation from the price list or the account override; null for POS and transfers. */
    unitPriceCents: integer("unit_price_cents"),
    weightLb: numeric("weight_lb", { precision: 10, scale: 2 }),
    /** Reason given when the lot's quantities are not yet confirmed (4.6). */
    lotReason: text("lot_reason"),
  },
  (t) => [index("shipment_line_shipment_idx").on(t.shipmentId)],
);

/** PO linkage: one shipment may cover several orders, one order may ship in parts (5.2). */
export const shipmentOrder = pgTable(
  "shipment_order",
  {
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipment.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => order.id),
  },
  (t) => [primaryKey({ columns: [t.shipmentId, t.orderId] })],
);

/** Empties collected at a retail stop (8.4). */
export const shipmentKegPickup = pgTable("shipment_keg_pickup", {
  shipmentId: uuid("shipment_id")
    .primaryKey()
    .references(() => shipment.id),
  halfIn: integer("half_in").notNull().default(0),
  sixtelIn: integer("sixtel_in").notNull().default(0),
});

/** Per-origin, per-scheduled-date sequence; the upsert serialises concurrent confirmations (5.3, 5.12). */
export const bolCounter = pgTable(
  "bol_counter",
  {
    originWarehouseId: uuid("origin_warehouse_id")
      .notNull()
      .references(() => warehouse.id),
    scheduledDate: date("scheduled_date").notNull(),
    lastSeq: integer("last_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.originWarehouseId, t.scheduledDate] })],
);

/** Allocation against origin stock from confirmation until delivery or void. */
export const shipmentAllocation = pgTable(
  "shipment_allocation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipment.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouse.id),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id),
    qty: integer("qty").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shipment_allocation_lookup_idx").on(t.warehouseId, t.skuId, t.releasedAt)],
);

/** Receiving confirmation for a transfer (5.8). */
export const shipmentReceipt = pgTable("shipment_receipt", {
  id: uuid("id").primaryKey().defaultRandom(),
  shipmentId: uuid("shipment_id")
    .notNull()
    .references(() => shipment.id),
  receivedOn: date("received_on").notNull(),
  receivedByEmployeeId: uuid("received_by_employee_id"),
  discrepancyNote: text("discrepancy_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shipmentReceiptLine = pgTable("shipment_receipt_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id")
    .notNull()
    .references(() => shipmentReceipt.id),
  skuId: uuid("sku_id")
    .notNull()
    .references(() => sku.id),
  qtyExpected: integer("qty_expected").notNull(),
  qtyReceived: integer("qty_received").notNull(),
});

export const documentKindEnum = pgEnum("document_kind", [
  "bol",
  "picking_ticket",
  "pickup_pack",
  "pull_sheet",
  "invoice",
]);

/** Snapshot and rendered PDF at a point in time, regenerable under the same number with a revision mark (6.7). */
export const shipmentDocument = pgTable(
  "shipment_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shipmentId: uuid("shipment_id").references(() => shipment.id),
    invoiceId: uuid("invoice_id"),
    kind: documentKindEnum("kind").notNull(),
    revision: integer("revision").notNull().default(0),
    number: text("number"),
    snapshot: jsonb("snapshot").notNull(),
    pdf: bytea("pdf"),
    createdByEmployeeId: uuid("created_by_employee_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shipment_document_idx").on(t.shipmentId, t.kind, t.revision)],
);

// ---------------------------------------------------------------------------
// Counts (8.1, 8.2)
// ---------------------------------------------------------------------------

export const countSession = pgTable("count_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  warehouseId: uuid("warehouse_id")
    .notNull()
    .references(() => warehouse.id),
  countedOn: date("counted_on").notNull(),
  status: text("status").notNull().default("draft"), // draft | applied
  countedBy: text("counted_by"),
  enteredByEmployeeId: uuid("entered_by_employee_id"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  appliedByEmployeeId: uuid("applied_by_employee_id"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const countLine = pgTable(
  "count_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => countSession.id),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id),
    /** Count sheets capture lot codes, not just SKU totals (8.2). */
    lotCode: text("lot_code"),
    qty: integer("qty").notNull(),
  },
  (t) => [index("count_line_session_idx").on(t.sessionId)],
);

// ---------------------------------------------------------------------------
// Kegs (8.4, 8.5)
// ---------------------------------------------------------------------------

export const kegEvent = pgTable(
  "keg_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => customerLocation.id),
    shipmentId: uuid("shipment_id").references(() => shipment.id),
    on: date("on").notNull(),
    kind: text("kind").notNull(), // shipment | pickup | opening | adjustment
    halfOut: integer("half_out").notNull().default(0),
    sixtelOut: integer("sixtel_out").notNull().default(0),
    halfIn: integer("half_in").notNull().default(0),
    sixtelIn: integer("sixtel_in").notNull().default(0),
    note: text("note"),
    recordedByEmployeeId: uuid("recorded_by_employee_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("keg_event_location_idx").on(t.locationId, t.on)],
);

// ---------------------------------------------------------------------------
// Invoices (section 7)
// ---------------------------------------------------------------------------

export const invoiceSeriesEnum = pgEnum("invoice_series", ["INV", "NC"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "issued", "paid", "void"]);

export const invoice = pgTable(
  "invoice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** INV26xxx or NC26xxx; assigned when issued (7.1, 7.3); legacy numbers come from the Sales tab. */
    number: text("number").unique(),
    series: invoiceSeriesEnum("series").notNull().default("INV"),
    locationId: uuid("location_id").references(() => customerLocation.id),
    marketId: uuid("market_id").references(() => market.id),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    legacy: boolean("legacy").notNull().default(false),
    /** The Sheet's status text for imported history (7.6); meanings recorded under question 1.5. */
    legacyStatus: text("legacy_status"),
    legacyPayload: jsonb("legacy_payload"),
    /** Always the actual delivery or pickup date (7.4). */
    invoiceDate: date("invoice_date"),
    dueDate: date("due_date"),
    termsDays: integer("terms_days"),
    /** "FOB brewery or designated warehouse" for distributors; null for retail (7.7). */
    fobWording: text("fob_wording"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    depositCents: integer("deposit_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    notes: text("notes"),
    issuedByEmployeeId: uuid("issued_by_employee_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedByEmployeeId: uuid("voided_by_employee_id"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    createdByEmployeeId: uuid("created_by_employee_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invoice_location_idx").on(t.locationId, t.invoiceDate), index("invoice_status_idx").on(t.status)],
);

export const invoiceLine = pgTable(
  "invoice_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id),
    lineNo: integer("line_no").notNull(),
    kind: text("kind").notNull(), // beer | deposit | pos | info
    shipmentLineId: uuid("shipment_line_id"),
    skuId: uuid("sku_id").references(() => sku.id),
    description: text("description").notNull(),
    lotCode: text("lot_code"),
    qty: integer("qty").notNull().default(0),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    lineTotalCents: integer("line_total_cents").notNull().default(0),
  },
  (t) => [index("invoice_line_invoice_idx").on(t.invoiceId)],
);

export const invoiceShipment = pgTable(
  "invoice_shipment",
  {
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoice.id),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipment.id),
  },
  (t) => [primaryKey({ columns: [t.invoiceId, t.shipmentId] })],
);

/** INV / NC sequences per year, seeded from the Sheet (INV26375, NC26001) so the next are INV26376 and NC26002. */
export const docCounter = pgTable(
  "doc_counter",
  {
    series: text("series").notNull(),
    year: integer("year").notNull(),
    lastSeq: integer("last_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.series, t.year] })],
);

// ---------------------------------------------------------------------------
// Company settings (6.1, 6.2, 6.6, 4.7) — single row
// ---------------------------------------------------------------------------

export const COMPANY_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

export const companySettings = pgTable("company_settings", {
  id: uuid("id").primaryKey(),
  legalName: text("legal_name").notNull().default("Familiar Ventures, LLC"),
  dba: text("dba").notNull().default("The Leopard Mark Brewing Company"),
  officeLine1: text("office_line1"),
  officeLine2: text("office_line2"),
  officeCity: text("office_city"),
  officeState: text("office_state"),
  officePostalCode: text("office_postal_code"),
  officePhone: text("office_phone"),
  arEmail: text("ar_email").notNull().default("ar@theleopardmark.com"),
  /** Printed on the retail delivery receipt only (6.4). */
  retailFooter: text("retail_footer"),
  /** Keg deposit and CRV wording for distributor documents; placeholder until the owner's example arrives (6.4). */
  distributorFooter: text("distributor_footer"),
  /** Fixed lines on freight documents, e.g. keep cold (6.3). */
  fixedLines: text("fixed_lines").array(),
  nmfcKeg: text("nmfc_keg"),
  nmfcCan: text("nmfc_can"),
  nmfcStatus: text("nmfc_status").notNull().default("proposed"), // proposed | approved
  /** Packaging-marking convention printed on the packaging report (4.7). */
  markingConvention: text("marking_convention"),
  /** Print remit-to details on invoices; off by default (7.9). */
  printRemitTo: boolean("print_remit_to").notNull().default(false),
  remitTo: text("remit_to"),
  updatedByEmployeeId: uuid("updated_by_employee_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Imports (section 10)
// ---------------------------------------------------------------------------

export const importRun = pgTable("import_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(), // file name
  status: text("status").notNull().default("dry_run"), // dry_run | applied | discarded
  summary: jsonb("summary").notNull(),
  diff: jsonb("diff").notNull(),
  requestedByEmployeeId: uuid("requested_by_employee_id"),
  appliedByEmployeeId: uuid("applied_by_employee_id"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
