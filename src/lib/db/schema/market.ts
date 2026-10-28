/**
 * Market, warehouse, catalog, market prices and evidence-backed stock.
 *
 * Markets scope catalog/prices, warehouses, users, numbering, allocations and
 * Slack routing (brief §8). Global confirmed defaults (Net-30, $35 keg
 * deposit, $90 minimum, no Sales price override) are NOT market-configurable.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const packageEnum = pgEnum("package_kind", [
  "case_12oz_can",
  "case_24oz_can",
  "keg_sixtel",
  "keg_half",
]);

export const stockMovementKindEnum = pgEnum("stock_movement_kind", [
  "opening",
  "receipt",
  "sample_withdrawal",
  "sample_return",
  "adjustment",
  "transfer_out",
  "transfer_in",
  "damage",
  "load",
  "route_return",
]);

export const market = pgTable("market", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(), // e.g. "NC", "LA", "MA"
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Los_Angeles"),
  active: boolean("active").notNull().default(true),
  /** Next sequence value for market-unique order numbering (T06 technical). */
  orderSeq: integer("order_seq").notNull().default(1),
  /**
   * D33: seller/invoicing entity and applicability are unconfirmed until the
   * owner confirms them. Financial activation of a market checks this.
   */
  sellerContextStatus: text("seller_context_status")
    .notNull()
    .default("unconfirmed"), // unconfirmed | confirmed
  sellerContextNote: text("seller_context_note"),
  /** IG07: Slack destinations remain unselected until chosen. */
  slackRouting: jsonb("slack_routing").$type<Record<string, string>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const warehouse = pgTable(
  "warehouse",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => market.id),
    name: text("name").notNull(),
    addressText: text("address_text"),
    /** One primary warehouse per market is a permitted starting structure (O19). */
    isPrimary: boolean("is_primary").notNull().default(false),
    /** Existing fulfillment partner contact; no new warehouse role (R23). */
    fulfillmentContact: text("fulfillment_contact"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("warehouse_market_idx").on(t.marketId)],
);

/** Internal catalog SKU / selling unit — the master (U23). */
export const sku = pgTable("sku", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  brand: text("brand").notNull(),
  packageKind: packageEnum("package_kind").notNull(),
  /** Human-readable selling unit, e.g. "case (24 × 12 oz)", "1/6 bbl keg". */
  sellingUnit: text("selling_unit").notNull(),
  /** Count-based keg deposit: kegs per selling unit (0 for cans). */
  kegsPerUnit: integer("kegs_per_unit").notNull().default(0),
  weightLb: numeric("weight_lb", { precision: 8, scale: 2 }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Fixed market price per SKU with effective dating; history is retained. */
export const marketPrice = pgTable(
  "market_price",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => market.id),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id),
    priceCents: integer("price_cents").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdByEmployeeId: uuid("created_by_employee_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("market_price_lookup_idx").on(t.marketId, t.skuId, t.effectiveFrom)],
);

/**
 * Evidence-backed on-hand position per warehouse/SKU. This is an
 * allocation/available-to-sell input (O18), not a live WMS. Availability =
 * onHand − active reservations (see order.ts).
 */
export const stockPosition = pgTable(
  "stock_position",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouse.id),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id),
    onHandQty: integer("on_hand_qty").notNull().default(0),
    /** Unavailable/damaged/pending-inspection are kept separate (brief §16). */
    unavailableQty: integer("unavailable_qty").notNull().default(0),
    pendingInspectionQty: integer("pending_inspection_qty").notNull().default(0),
    /** In transit to this warehouse (not available until received). */
    inTransitQty: integer("in_transit_qty").notNull().default(0),
    evidenceSource: text("evidence_source"),
    evidenceAt: timestamp("evidence_at", { withTimezone: true }),
    confirmedByEmployeeId: uuid("confirmed_by_employee_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_position_uq").on(t.warehouseId, t.skuId),
    /** Physical counts are never negative; a shortfall against reservations is recorded as a discrepancy, not a negative count. */
    check("stock_position_qty_chk", sql`on_hand_qty >= 0 and unavailable_qty >= 0 and pending_inspection_qty >= 0 and in_transit_qty >= 0`),
  ],
);

export const stockMovement = pgTable(
  "stock_movement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouse.id),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id),
    kind: stockMovementKindEnum("kind").notNull(),
    /** Signed change to on-hand; negative for withdrawals. */
    qtyDelta: integer("qty_delta").notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    evidence: text("evidence"),
    actorEmployeeId: uuid("actor_employee_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_movement_lookup_idx").on(t.warehouseId, t.skuId, t.at)],
);
