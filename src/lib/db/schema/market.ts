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
  /** Shipment delivered: stock leaves the origin (SHIPMENTS_SPEC §2). */
  "shipment_out",
  /** Physical count applied: brings on hand to the counted total (8.1). */
  "count",
  /** Packaging run recorded: packaged units go on hand at the brewery (R2-21). */
  "packaging",
]);

/** Origin kinds (2.4, 2.2): a brewery is also a lot facility; warehouses and cold storage hold stock only. */
export const originKindEnum = pgEnum("origin_kind", ["brewery", "warehouse", "cold_storage"]);

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
  /** Billing rules are a market rule, not a global one (7.4, 3.10). */
  termsDays: integer("terms_days").notNull().default(30),
  retailKegDepositCents: integer("retail_keg_deposit_cents").notNull().default(3500),
  distributorKegDepositCents: integer("distributor_keg_deposit_cents").notNull().default(0),
  /** Cash on delivery market (a future Texas rule); false everywhere today. */
  cod: boolean("cod").notNull().default(false),
  /** Sheet regions become a sub-list under the market (2.1). */
  regionList: text("region_list").array(),
  /** Optional route days for the market (R2-4), e.g. ["Tue", "Thu"]; none required. */
  routeDays: text("route_days").array(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Origins: warehouses, cold storage and host breweries (2.2, 2.4). A brewery is
 * also a lot facility (lot_facility_code 01–07). An origin may exist without a
 * market (Prost, Real Ale) — market_id is nullable since 0004_shipments.
 */
export const warehouse = pgTable(
  "warehouse",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id").references(() => market.id),
    name: text("name").notNull(),
    addressText: text("address_text"),
    /** One primary warehouse per market is a permitted starting structure (O19). */
    isPrimary: boolean("is_primary").notNull().default(false),
    /** Existing fulfillment partner contact; no new warehouse role (R23). */
    fulfillmentContact: text("fulfillment_contact"),
    active: boolean("active").notNull().default(true),
    /** Three-letter BOL origin code (EBB, EWD, WLA, RAD, BWD, PRO, RTB, ALE, JAB, REA). Required to confirm a shipment. */
    originCode: text("origin_code").unique(),
    /** Two-digit lot facility code for breweries (01 East Brother … 07 Real Ale). */
    lotFacilityCode: text("lot_facility_code"),
    kind: originKindEnum("kind").notNull().default("warehouse"),
    appointmentRequired: boolean("appointment_required"),
    loadingDock: boolean("loading_dock"),
    liftgateRequired: boolean("liftgate_required"),
    /** Free-form hours by weekday, e.g. {"Mon":"8am-4pm"}; optional (2.11). */
    hours: jsonb("hours").$type<Record<string, string>>(),
    shippingContactName: text("shipping_contact_name"),
    shippingContactEmail: text("shipping_contact_email"),
    shippingContactPhone: text("shipping_contact_phone"),
    /** End-of-day pull sheet recipient and local send time, HH:MM (R2-29); used only when the company switch is on. */
    pullSheetEmail: text("pull_sheet_email"),
    pullSheetSendTime: text("pull_sheet_send_time"),
    /**
     * Round 3: the latest local time (HH:MM, market time zone, Pacific when the origin has no market) an order can reach
     * this origin for a shipment `leadDays` later. Balmuth 14:30, Express Wine Delivery 15:30, Radford 12:00 Pacific
     * the day before. Orders may change until then; cancelling is allowed any time.
     */
    orderCutoff: text("order_cutoff"),
    leadDays: integer("lead_days").notNull().default(1),
    /** Days this origin delivers or releases, e.g. ["Tue", "Thu"]; empty means any weekday. */
    deliveryDays: text("delivery_days").array(),
    /** Beer may stay this many days after packaging before it must move (Jack's Abby: 10); a warning opens three days before. */
    maxDaysOnHand: integer("max_days_on_hand"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    addressCity: text("address_city"),
    addressState: text("address_state"),
    addressPostalCode: text("address_postal_code"),
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
  /** UPCs and pallet fraction print on the distributor template and size the pallet count (3.7). */
  upcCase: text("upc_case"),
  upcRetail: text("upc_retail"),
  upcUnit: text("upc_unit"),
  palletFraction: numeric("pallet_fraction", { precision: 6, scale: 4 }),
  /** Position 4 of the code: recipe variant (C Clasico, 0 base recipe) (3.1). */
  recipeVariant: text("recipe_variant"),
  /** Internal lot age / best-by per package class; null until the owner supplies day counts (4.8). Never printed. */
  shelfLifeDays: integer("shelf_life_days"),
  /** Round 3: unit cost, so samples and other no-charge goods count toward the spend on an account. Never printed. */
  unitCostCents: integer("unit_cost_cents"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Legacy and dotted codes resolve to the active SKU; searchable, never selectable (3.3, 1.7). */
export const skuAlias = pgTable("sku_alias", {
  alias: text("alias").primaryKey(),
  skuId: uuid("sku_id")
    .notNull()
    .references(() => sku.id),
  note: text("note"),
});

/**
 * POS items ship on a line without a lot or a ledger effect (3.6, 8.8). Round 3: a POS item may carry a price (charged
 * on the invoice) and always may carry a unit cost (counted toward the spend on the account); no price means no charge.
 */
export const posItem = pgTable("pos_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  priceCents: integer("price_cents"),
  unitCostCents: integer("unit_cost_cents"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Per-account price exception with a reason and approval (3.9, 7.10). */
export const priceOverride = pgTable(
  "price_override",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id").notNull(),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id),
    priceCents: integer("price_cents").notNull(),
    reason: text("reason").notNull(),
    approvedByEmployeeId: uuid("approved_by_employee_id"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdByEmployeeId: uuid("created_by_employee_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("price_override_lookup_idx").on(t.locationId, t.skuId, t.effectiveFrom)],
);

/** Price tiers (R2-41): within a market, distributors pay one price and retailers another. */
export const PRICE_TIERS = ["retail", "distributor"] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];

/** Fixed market price per SKU and tier with effective dating; history is retained. */
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
    /** retail | distributor (R2-41). */
    tier: text("tier").$type<PriceTier>().notNull().default("retail"),
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
 * Freight lanes (R2-52): what the carrier charges per pallet from Radford or Jack's Abby to a destination, by pallet
 * count. One pallet pays the minimum; 2 to 4 and 5 to 8 pallets pay the per-pallet tier; above 8 is a flat truckload.
 * Passed through at cost, plus the fuel surcharge percentage on its own line.
 */
export const freightLane = pgTable("freight_lane", {
  code: text("code").primaryKey(), // e.g. CT, EASTERN_MA
  name: text("name").notNull(),
  minCents: integer("min_cents").notNull(),
  tier2to4Cents: integer("tier_2_4_cents").notNull(),
  tier5to8Cents: integer("tier_5_8_cents").notNull(),
  truckloadCents: integer("truckload_cents").notNull(),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    /** Lot the movement concerns, when known (traceability first; per-lot balances later — 4.1). */
    lotId: uuid("lot_id"),
    shipmentId: uuid("shipment_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_movement_lookup_idx").on(t.warehouseId, t.skuId, t.at)],
);
