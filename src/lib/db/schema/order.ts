/**
 * Orders, lines, changes, allocation reservations, samples, standing
 * arrangements and email intake requests.
 *
 * The order is the master transaction reference (O17). Demand, allocation,
 * fulfillment progress, invoice disposition and holds are independent
 * dimensions (brief §6); this module carries demand + allocation only.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { customerLocation } from "./customer";
import { market, sku, warehouse } from "./market";

export const orderSourceEnum = pgEnum("order_source", [
  "sales",
  "email",
  "standing",
  "customer_link", // deferred (phase 5) — value reserved, never produced now
]);

/** Progress dimension only (brief §6); never encodes money or holds. */
export const orderDemandStateEnum = pgEnum("order_demand_state", [
  "submitted",
  "partially_fulfilled",
  "fulfilled",
  "cancelled",
]);

export const reservationStateEnum = pgEnum("reservation_state", [
  "reserved",
  "route_committed",
  "fulfilled",
  "released",
]);

export const standingStateEnum = pgEnum("standing_state", [
  "defined",
  "paused",
  "ended",
]);

export const intakeStateEnum = pgEnum("intake_state", [
  "received",
  "incomplete",
  "converted",
  "rejected",
]);

export const order = pgTable(
  "customer_order",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => market.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => customerLocation.id),
    orderNumber: text("order_number").notNull().unique(),
    source: orderSourceEnum("source").notNull(),
    demandState: orderDemandStateEnum("demand_state").notNull().default("submitted"),
    requestedDate: text("requested_date"), // ISO date; never a promise (O16)
    notes: text("notes"),
    /** Rep at transaction (separate from originating/current rep on the location). */
    repEmployeeId: uuid("rep_employee_id"),
    submittedByEmployeeId: uuid("submitted_by_employee_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Distinguishes replay of one submission from a legitimate repeat order. */
    submissionKey: text("submission_key"),
    /** Hash of the submitted payload: a re-used key with a different payload is refused, not silently accepted (AC12). */
    submissionPayloadHash: text("submission_payload_hash"),
    standingOccurrenceId: uuid("standing_occurrence_id"),
    intakeRequestId: uuid("intake_request_id"),
    /** Warehouse serving this order (market primary unless Admin overrides). */
    warehouseId: uuid("warehouse_id").references(() => warehouse.id),
    /** Flagged, not rejected (O13). Criterion is D09 → only set by a person or a selected policy. */
    abnormalFlag: boolean("abnormal_flag").notNull().default(false),
    abnormalReason: text("abnormal_reason"),
    /** $90 minimum evaluation snapshot; basis remains D11-unselected. */
    minimumEvaluation: jsonb("minimum_evaluation"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    cancelledByEmployeeId: uuid("cancelled_by_employee_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("order_location_idx").on(t.locationId, t.submittedAt),
    index("order_market_idx").on(t.marketId, t.submittedAt),
    uniqueIndex("order_submission_key_uq")
      .on(t.locationId, t.submissionKey)
      .where(sqlSubmissionKeyNotNull()),
    /** One downstream order per email intake (REV-15). */
    uniqueIndex("order_intake_request_uq")
      .on(t.intakeRequestId)
      .where(sql.raw(`intake_request_id is not null`)),
  ],
);

export const orderLine = pgTable(
  "order_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => order.id),
    lineNo: integer("line_no").notNull(),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id),
    /** Original ordered quantity is never overwritten (brief §13). */
    orderedQty: integer("ordered_qty").notNull(),
    /** Current demand after authorized amendments/cancellations. */
    currentQty: integer("current_qty").notNull(),
    cancelledQty: integer("cancelled_qty").notNull().default(0),
    /** Quantity actually accepted at deliveries (phase 2 writes; phase 1 reads). */
    deliveredQty: integer("delivered_qty").notNull().default(0),
    /** Price applicable at submission — retained history; D12 governs commitment. */
    unitPriceCentsAtSubmission: integer("unit_price_cents_at_submission").notNull(),
    marketPriceIdAtSubmission: uuid("market_price_id_at_submission"),
    kegsPerUnit: integer("kegs_per_unit").notNull().default(0),
  },
  (t) => [
    index("order_line_order_idx").on(t.orderId),
    check("order_line_qty_chk", sql`ordered_qty > 0 and current_qty >= 0 and cancelled_qty >= 0 and delivered_qty >= 0 and delivered_qty <= current_qty`),
  ],
);

/** Every material change to a line/order keeps prior/current/reason/actor. */
export const orderLineChange = pgTable("order_line_change", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderLineId: uuid("order_line_id")
    .notNull()
    .references(() => orderLine.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorEmployeeId: uuid("actor_employee_id"),
  kind: text("kind").notNull(), // cancel | amend_qty | price_observed_change | substitution_request
  priorQty: integer("prior_qty"),
  currentQty: integer("current_qty"),
  priorPriceCents: integer("prior_price_cents"),
  proposedPriceCents: integer("proposed_price_cents"),
  reason: text("reason"),
  /** Amendment after commitment is D10/D12 — record request, no silent effect. */
  policyStatus: text("policy_status"), // applied | recorded_unselected_policy
});

/**
 * Allocation reservation. Submission reserves supportable units once;
 * fulfillment consumes the reservation rather than subtracting again (R20).
 */
export const reservation = pgTable(
  "reservation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => orderLine.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouse.id),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id),
    reservedQty: integer("reserved_qty").notNull(),
    /** Demand that could not be supported at submission; retained, never lost (O18). */
    unmetQty: integer("unmet_qty").notNull().default(0),
    state: reservationStateEnum("state").notNull().default("reserved"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releaseReason: text("release_reason"),
    releasedByEmployeeId: uuid("released_by_employee_id"),
    /** D14 displacement: who lost priority and why (recorded only when Admin acts). */
    displacementNote: text("displacement_note"),
    /**
     * Set when Admin released these units. Displaced demand is retained but is
     * NOT automatically re-filled (D14 restored priority is unselected) until
     * Admin explicitly re-queues it.
     */
    displacedAt: timestamp("displaced_at", { withTimezone: true }),
  },
  (t) => [
    index("reservation_wh_sku_state_idx").on(t.warehouseId, t.skuId, t.state),
    index("reservation_line_idx").on(t.orderLineId),
    check("reservation_qty_chk", sql`reserved_qty >= 0 and unmet_qty >= 0`),
  ],
);

/** Sales samples consume the same allocation (O19). */
export const sampleWithdrawal = pgTable(
  "sample_withdrawal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => market.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouse.id),
    repEmployeeId: uuid("rep_employee_id").notNull(),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => sku.id),
    qty: integer("qty").notNull(),
    withdrawnOn: text("withdrawn_on").notNull(), // ISO date (actual date)
    notes: text("notes"),
    state: text("state").notNull().default("withdrawn"), // withdrawn | corrected | returned_sellable | returned_damaged
    correctedOfId: uuid("corrected_of_id"),
    recordedByEmployeeId: uuid("recorded_by_employee_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("sample_market_idx").on(t.marketId, t.withdrawnOn), check("sample_qty_chk", sql`qty >= 0`)],
);

/**
 * Standing arrangement. Cadence/horizon/pause/skip/end/authorization are D13
 * (unselected) — the arrangement is captured, but generation stays inactive
 * unless a selection (production or explicitly labelled test) supplies a
 * cadence. Never a Stripe Subscription (U22).
 */
export const standingArrangement = pgTable("standing_arrangement", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => customerLocation.id),
  state: standingStateEnum("state").notNull().default("defined"),
  /** Customer authorization note (who asked, how) — required content, not policy. */
  authorizationNote: text("authorization_note"),
  /** Desired cadence as expressed by the customer; not an active policy. */
  requestedCadence: text("requested_cadence"),
  createdByEmployeeId: uuid("created_by_employee_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  endReason: text("end_reason"),
});

export const standingArrangementLine = pgTable("standing_arrangement_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  arrangementId: uuid("arrangement_id")
    .notNull()
    .references(() => standingArrangement.id),
  skuId: uuid("sku_id")
    .notNull()
    .references(() => sku.id),
  qty: integer("qty").notNull(),
});

export const standingOccurrence = pgTable(
  "standing_occurrence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arrangementId: uuid("arrangement_id")
      .notNull()
      .references(() => standingArrangement.id),
    /** One occurrence per cycle — duplicates are impossible by construction. */
    cycleKey: text("cycle_key").notNull(),
    orderId: uuid("order_id"),
    outcome: text("outcome").notNull(), // generated | generated_partial | skipped_archived_sku | skipped_closed | skipped_policy | skipped_policy_incomplete | failed
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Which selection authorized generation (production or test id). */
    policySelectionId: uuid("policy_selection_id"),
    /** Skipped lines / failure detail so affected demand stays visible (REV-16). */
    detail: jsonb("detail"),
  },
  (t) => [uniqueIndex("standing_occurrence_uq").on(t.arrangementId, t.cycleKey)],
);

/** Email intake (R14 support). Source message preserved; conversion is a person's act until D09 selects rules. */
export const orderIntakeRequest = pgTable("order_intake_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketId: uuid("market_id").references(() => market.id),
  locationId: uuid("location_id").references(() => customerLocation.id),
  source: text("source").notNull().default("email"),
  sourceReference: text("source_reference"), // Gmail message id when known
  fromEmail: text("from_email"),
  subject: text("subject"),
  body: text("body").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  state: intakeStateEnum("state").notNull().default("received"),
  missingEssentials: text("missing_essentials"),
  orderId: uuid("order_id"),
  handledByEmployeeId: uuid("handled_by_employee_id"),
  handledAt: timestamp("handled_at", { withTimezone: true }),
});

function sqlSubmissionKeyNotNull() {
  return sql.raw(`submission_key is not null`);
}
