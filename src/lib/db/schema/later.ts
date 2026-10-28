/**
 * PHASES 2–4 SKELETON — bounded business records referenced by phase 1
 * (readiness/first-delivery evidence, invoice obligation existence, keg
 * custody balance display, cleaning clock display). No phase 2–4 workflow is
 * built in this repository revision; see docs/IMPLEMENTATION_STATUS.md.
 *
 * These tables preserve the independent state dimensions of brief §6 so that
 * phase 1 views can show "not yet delivered", "no invoice obligation", "no
 * custody" truthfully rather than inventing status. They are deliberately
 * minimal and will be extended — not replaced — when the phase is built.
 */
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { customerLocation } from "./customer";
import { order } from "./order";

/** A delivery attempt/visit (phase 2). Only "accepted" visits count as receipt. */
export const deliveryVisitOutcomeEnum = pgEnum("delivery_visit_outcome", [
  "planned",
  "accepted", // some merchandise accepted (full or partial)
  "failed", // zero merchandise accepted
  "unknown", // outcome not established
]);

export const deliveryVisit = pgTable(
  "delivery_visit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => customerLocation.id),
    /** Actual local delivery date (commercial clock, R54). */
    deliveryDate: text("delivery_date"),
    outcome: deliveryVisitOutcomeEnum("outcome").notNull().default("planned"),
    /** Total merchandise accepted at this visit in cents (phase 2 computes). */
    acceptedMerchandiseCents: integer("accepted_merchandise_cents"),
    acceptedKegCount: integer("accepted_keg_count"),
    evidence: jsonb("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("delivery_visit_location_idx").on(t.locationId)],
);

/** Which order lines a visit fulfilled and with what accepted quantity (phase 2). */
export const deliveryVisitLine = pgTable("delivery_visit_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id")
    .notNull()
    .references(() => deliveryVisit.id),
  orderId: uuid("order_id")
    .notNull()
    .references(() => order.id),
  orderLineId: uuid("order_line_id").notNull(),
  plannedQty: integer("planned_qty").notNull(),
  acceptedQty: integer("accepted_qty"),
  refusedQty: integer("refused_qty"),
  damagedQty: integer("damaged_qty"),
  notAttemptedQty: integer("not_attempted_qty"),
  reason: text("reason"),
});

/**
 * Internal delivery-derived commercial invoice obligation (phase 3). Stripe
 * owns the issued invoice/number/balance; this row is the internal
 * instruction and its reconciliation, never a second issuer.
 */
export const invoiceObligation = pgTable("invoice_obligation", {
  id: uuid("id").primaryKey().defaultRandom(),
  visitId: uuid("visit_id")
    .notNull()
    .references(() => deliveryVisit.id),
  locationId: uuid("location_id")
    .notNull()
    .references(() => customerLocation.id),
  deliveryDate: text("delivery_date").notNull(),
  /** delivery + 30 calendar days (U03) — computed from actual delivery date. */
  dueDate: text("due_date").notNull(),
  merchandiseCents: integer("merchandise_cents").notNull(),
  depositCents: integer("deposit_cents").notNull(),
  state: text("state").notNull().default("pending_issue"), // pending_issue | issue_requested | issued | unknown
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Count-based keg custody movement per location (phase 4). */
export const kegMovement = pgTable(
  "keg_movement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => customerLocation.id),
    visitId: uuid("visit_id"),
    kind: text("kind").notNull(), // delivered | picked_up | opening | adjustment
    count: integer("count").notNull(), // positive numbers; kind gives direction
    attributedCount: integer("attributed_count"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    evidence: text("evidence"),
  },
  (t) => [index("keg_movement_location_idx").on(t.locationId)],
);

/** Location cleaning clock and obligations (phase 4, D26 unselected). */
export const cleaningObligation = pgTable("cleaning_obligation", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => customerLocation.id),
  applicable: text("applicable").notNull().default("unknown"), // unknown | yes | no
  lastCompletedOn: text("last_completed_on"),
  note: text("note"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
