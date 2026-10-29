/**
 * Licensed customer locations, parents, contacts/authority, addresses with
 * provenance, license verification, payment relationship (Stripe association
 * mirror), holds and overrides.
 *
 * Each licensed location remains operationally separate (O04/U01). Parents
 * and shared contacts are optional and never pool authority, licenses,
 * payment relationships, credits, custody or history.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
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
import { market } from "./market";
import { roleEnum } from "./platform";

/** Active or Closed (R2-31). "inactive" stays in the type for history; rows were migrated to closed with a note in 0005. */
export const locationStatusEnum = pgEnum("location_status", [
  "active",
  "inactive",
  "closed",
]);

export const addressKindEnum = pgEnum("address_kind", ["delivery", "billing"]);

export const addressProvenanceEnum = pgEnum("address_provenance", [
  "customer_provided",
  "customer_confirmed",
  "sales_entered",
  "admin_entered",
]);

export const licenseStateEnum = pgEnum("license_state", [
  "unverified",
  "pending_review",
  "verified",
  "rejected",
  "not_applicable",
]);

export const paymentChannelEnum = pgEnum("payment_channel", [
  "unselected",
  "stripe_ach",
  "fintech",
]);

export const setupStateEnum = pgEnum("payment_setup_state", [
  "not_requested",
  "requested",
  "pending_verification",
  "method_usable",
  "unusable",
  "revoked",
  "unknown",
]);

export const holdKindEnum = pgEnum("hold_kind", [
  "payment_failure",
  "compliance",
  "readiness",
  "admin_manual",
]);

/** Account kinds (2.4). Warehouses and hosts are origins too; the account row exists for history and billing. */
export const accountKindEnum = pgEnum("account_kind", [
  "retail",
  "distributor",
  "warehouse",
  "host",
  "internal",
  "individual",
]);

/** Keg deposit treatment for the account (3.10): the market rule, per keg, one floating deposit, or none. */
export const depositModeEnum = pgEnum("deposit_mode", ["market_default", "per_keg", "floating", "none"]);

/** How goods reach the account (2.5): delivered, or picked up at the origin (will-call / distributor pickup). */
export const fulfilmentEnum = pgEnum("fulfilment", ["delivery", "pickup"]);

export const customerParent = pgTable("customer_parent", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customerLocation = pgTable(
  "customer_location",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => market.id),
    tradeName: text("trade_name").notNull(),
    /** May be enriched internally later (O05); never mandatory at creation. */
    legalName: text("legal_name"),
    parentId: uuid("parent_id").references(() => customerParent.id),
    status: locationStatusEnum("status").notNull().default("active"),
    deliveryInstructions: text("delivery_instructions"),
    /** Independently confirmed receiving restrictions (brief §10). */
    receivingRestrictions: text("receiving_restrictions"),
    /** Originating rep never changes; current rep may. History in location_rep_history. */
    originatingRepEmployeeId: uuid("originating_rep_employee_id"),
    currentRepEmployeeId: uuid("current_rep_employee_id"),
    /** Admin warehouse override (O19); NULL = market primary warehouse. */
    warehouseOverrideId: uuid("warehouse_override_id"),
    kind: accountKindEnum("kind").notNull().default("retail"),
    /** Distributor that serves this account; NULL = served direct. A direct shipment to a served account needs an override reason (2.6). */
    servedByLocationId: uuid("served_by_location_id"),
    /** ACC- id from the Sheet, kept as a searchable reference (1.2). */
    legacyAccountId: text("legacy_account_id"),
    /** Sheet region (sub-list under the market, 2.1). */
    region: text("region"),
    /** Blank inherits the market rule (7.4). */
    termsDaysOverride: integer("terms_days_override"),
    depositMode: depositModeEnum("deposit_mode").notNull().default("market_default"),
    depositCentsOverride: integer("deposit_cents_override"),
    fulfilment: fulfilmentEnum("fulfilment").notNull().default("delivery"),
    appointmentRequired: boolean("appointment_required"),
    palletRule: text("pallet_rule"),
    receivingRequirements: text("receiving_requirements"),
    firstDeliveryOn: text("first_delivery_on"),
    /** How the account pays (R2-12): fintech, stripe or check; copied onto each invoice at issue. */
    payBy: text("pay_by"),
    /** When on, the delivery pack carries the invoice with the BOL (R2-30); off by default. */
    invoiceOnReceipt: boolean("invoice_on_receipt").notNull().default(false),
    /** Floating keg deposit (R2-13): the one deposit taken on the first order, settled on the last. */
    depositTakenCents: integer("deposit_taken_cents"),
    depositTakenOn: date("deposit_taken_on"),
    depositSettledOn: date("deposit_settled_on"),
    depositSettlementNote: text("deposit_settlement_note"),
    /** A rep's home address for samples (R2-28): an account of kind individual that belongs to this employee. */
    repEmployeeId: uuid("rep_employee_id"),
    /** The market's samples house account (R2-27): kind internal, no license, no terms. */
    samplesHouse: boolean("samples_house").notNull().default(false),
    createdByEmployeeId: uuid("created_by_employee_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeReason: text("close_reason"),
  },
  (t) => [
    index("customer_location_market_idx").on(t.marketId),
    index("customer_location_trade_name_idx").on(t.tradeName),
  ],
);

export const locationRepHistory = pgTable("location_rep_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => customerLocation.id),
  employeeId: uuid("employee_id").notNull(),
  fromAt: timestamp("from_at", { withTimezone: true }).notNull().defaultNow(),
  toAt: timestamp("to_at", { withTimezone: true }),
  reason: text("reason"),
});

/** Customer-provided / confirmed address facts (independent of provider content). */
export const address = pgTable("address", {
  id: uuid("id").primaryKey().defaultRandom(),
  line1: text("line1").notNull(),
  line2: text("line2"),
  city: text("city").notNull(),
  state: text("state").notNull(),
  postalCode: text("postal_code").notNull(),
  country: text("country").notNull().default("US"),
  provenance: addressProvenanceEnum("provenance").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdByEmployeeId: uuid("created_by_employee_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const locationAddress = pgTable(
  "location_address",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => customerLocation.id),
    addressId: uuid("address_id")
      .notNull()
      .references(() => address.id),
    kind: addressKindEnum("kind").notNull(),
    current: boolean("current").notNull().default(true),
    fromAt: timestamp("from_at", { withTimezone: true }).notNull().defaultNow(),
    toAt: timestamp("to_at", { withTimezone: true }),
  },
  (t) => [index("location_address_idx").on(t.locationId, t.kind, t.current)],
);

/**
 * Google address assessment — ADVISORY provider content (brief §10, IG05).
 * Only a permitted summary is retained; raw response/geocode is not archived
 * and is never forwarded onward without IG05 permission.
 */
export const addressAssessment = pgTable("address_assessment", {
  id: uuid("id").primaryKey().defaultRandom(),
  addressId: uuid("address_id")
    .notNull()
    .references(() => address.id),
  assessedAt: timestamp("assessed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  status: text("status").notNull(), // not_assessed | pending | assessed | failed
  summary: jsonb("summary").$type<{
    verdict?: string;
    confidence?: string;
    normalizedLine?: string;
    note?: string;
  }>(),
  rawRetained: boolean("raw_retained").notNull().default(false),
});

/** Shared person record; authority is per location (R13). */
export const contact = pgTable(
  "contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("contact_email_idx").on(t.email)],
);

export const locationContact = pgTable(
  "location_contact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => customerLocation.id),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contact.id),
    /** buyer | ap | receiving | other */
    contactRole: text("contact_role").notNull(),
    /** Intentional authority flags — shared contact is not broad authority (D08). */
    mayOrder: boolean("may_order").notNull().default(false),
    receivesInvoices: boolean("receives_invoices").notNull().default(false),
    mayAuthorizePayment: boolean("may_authorize_payment").notNull().default(false),
    current: boolean("current").notNull().default(true),
    fromAt: timestamp("from_at", { withTimezone: true }).notNull().defaultNow(),
    toAt: timestamp("to_at", { withTimezone: true }),
  },
  (t) => [index("location_contact_idx").on(t.locationId, t.current)],
);

/** Billing-email changes require Admin approval (O06). */
export const billingEmailChangeRequest = pgTable("billing_email_change_request", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => customerLocation.id),
  requestedEmail: text("requested_email").notNull(),
  priorEmail: text("prior_email"),
  source: text("source").notNull().default("sales"), // sales | gmail_reply | admin
  requestedByEmployeeId: uuid("requested_by_employee_id"),
  requestedAt: timestamp("requested_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  state: text("state").notNull().default("pending"), // pending | approved | rejected
  decidedByEmployeeId: uuid("decided_by_employee_id"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
});

/** Internal license verification decision (O07/D02). */
export const licenseVerification = pgTable(
  "license_verification",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => customerLocation.id),
  licenseNumber: text("license_number"),
  licenseType: text("license_type"),
  evidence: text("evidence"),
  state: licenseStateEnum("state").notNull().default("unverified"),
  current: boolean("current").notNull().default(true),
  decidedByEmployeeId: uuid("decided_by_employee_id"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  },
  (t) => [uniqueIndex("license_verification_current_uq").on(t.locationId).where(sql.raw(`current = true`))],
);

/**
 * Location-specific payment relationship. Stripe owns credentials/mandates;
 * this row keeps only masked reference/status/evidence (brief §11). The
 * `stripe_customer` provider_reference row carries the Stripe id.
 */
export const paymentRelationship = pgTable(
  "payment_relationship",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => customerLocation.id),
  channel: paymentChannelEnum("channel").notNull().default("unselected"),
  setupState: setupStateEnum("setup_state").notNull().default("not_requested"),
  payerContactId: uuid("payer_contact_id"),
  /** An explicitly authorized shared payer must be intentional (O04). */
  sharedPayerAuthorized: boolean("shared_payer_authorized").notNull().default(false),
  sharedPayerNote: text("shared_payer_note"),
  setupRequestedAt: timestamp("setup_requested_at", { withTimezone: true }),
  lastProviderEvidence: jsonb("last_provider_evidence"),
  lastProviderEvidenceAt: timestamp("last_provider_evidence_at", { withTimezone: true }),
  /** Direct customer revocation received internally prohibits new debit immediately. */
  directRevocationAt: timestamp("direct_revocation_at", { withTimezone: true }),
  /** Who assigned payer authority and when (intentional act, never inherited from AP; REV-08). */
  payerAssignedAt: timestamp("payer_assigned_at", { withTimezone: true }),
  payerAssignedByEmployeeId: uuid("payer_assigned_by_employee_id"),
  current: boolean("current").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  },
  (t) => [uniqueIndex("payment_relationship_current_uq").on(t.locationId).where(sql.raw(`current = true`))],
);

/** Causal blockers. Each hold names its cause; clearing resolves only that cause. */
export const hold = pgTable(
  "hold",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id")
      .notNull()
      .references(() => customerLocation.id),
    kind: holdKindEnum("kind").notNull(),
    cause: text("cause").notNull(),
    causeReferenceType: text("cause_reference_type"),
    causeReferenceId: text("cause_reference_id"),
    active: boolean("active").notNull().default(true),
    createdByEmployeeId: uuid("created_by_employee_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolution: text("resolution"),
    resolvedByEmployeeId: uuid("resolved_by_employee_id"),
  },
  (t) => [index("hold_location_active_idx").on(t.locationId, t.active)],
);

/**
 * Admin override: changes delivery permission, not the financial fact or the
 * hold itself (brief §31). Scope/duration/expiry defaults are D03 —
 * unselected — so nothing here expires automatically.
 */
export const holdOverride = pgTable("hold_override", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => customerLocation.id),
  holdId: uuid("hold_id").references(() => hold.id),
  scope: text("scope").notNull(), // free text: named delivery / order reference
  orderId: uuid("order_id"),
  reason: text("reason").notNull(),
  grantedByEmployeeId: uuid("granted_by_employee_id").notNull(),
  grantedByRole: roleEnum("granted_by_role").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  withdrawnByEmployeeId: uuid("withdrawn_by_employee_id"),
});
