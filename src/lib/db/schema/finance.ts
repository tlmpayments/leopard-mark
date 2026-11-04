/**
 * Round 4: the approval queue for everything that leaves the company, Stripe collection (payments, payouts, the
 * one-time customer match with the ACH app) and the orders@ mailbox intake.
 *
 * Business meaning: nothing goes out on its own. Every email, Stripe invoice, debit or credit note is an
 * `approval_item` a person approves; the effect runs afterwards, from the job queue, and its result is written back
 * on the item. Stripe stays the money ledger: `payment` rows mirror what Stripe reports (or what Accounting records
 * by hand for checks, EFT and Fintech), never the other way round.
 */
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { customerLocation } from "./customer";
import { market } from "./market";
import { orderIntakeRequest } from "./order";
import { bytea, invoice } from "./shipments";

export const APPROVAL_KINDS = ["email", "stripe_invoice", "stripe_debit", "stripe_credit_note"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const APPROVAL_STATES = ["pending", "approved", "executing", "done", "failed", "rejected", "withdrawn"] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

/**
 * One external action waiting for a person. `payload` carries what the effect needs (an email's recipients, subject,
 * body and attached documents; an invoice or credit memo id; a debit's invoice, amount and date). `result` carries what
 * came back (a Gmail message id, Stripe ids, the hosted link). Rejected and withdrawn items stay on record.
 */
export const approvalItem = pgTable(
  "approval_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<ApprovalKind>().notNull(),
    /** Why it exists: invoice_email | payment_setup_link | pull_sheet | payment_receipt | reminder | order_received | invoice_mirror | due_date_debit | re_present | credit_note | custom */
    purpose: text("purpose").notNull(),
    /** Who sends it: orders@ for anything a customer sees, operations@ for warehouses and dispatchers, stripe for money. */
    sender: text("sender").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    amountCents: integer("amount_cents"),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    marketId: uuid("market_id").references(() => market.id),
    locationId: uuid("location_id").references(() => customerLocation.id),
    state: text("state").$type<ApprovalState>().notNull().default("pending"),
    /** How an approved email leaves: auto (Gmail API) or manual (a person sends it and records the outcome). */
    transport: text("transport").$type<"auto" | "manual">(),
    /** One active item per business effect; a rejected or done item does not block a new one. */
    dedupeKey: text("dedupe_key"),
    requestedByEmployeeId: uuid("requested_by_employee_id"),
    autoApproved: boolean("auto_approved").notNull().default(false),
    decidedByEmployeeId: uuid("decided_by_employee_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    result: jsonb("result").$type<Record<string, unknown>>(),
    lastError: text("last_error"),
    jobId: uuid("job_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("approval_item_state_idx").on(t.state, t.createdAt),
    index("approval_item_subject_idx").on(t.subjectType, t.subjectId),
    uniqueIndex("approval_item_active_dedupe_uq")
      .on(t.dedupeKey)
      .where(sql.raw(`dedupe_key is not null and state in ('pending','approved','executing')`)),
  ],
);

export const PAYMENT_KINDS = ["stripe_ach", "stripe_card", "check", "eft", "fintech", "other", "refund"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export const PAYMENT_STATES = ["scheduled", "processing", "succeeded", "failed", "disputed", "refunded", "cancelled"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

/** A payment against an invoice: a Stripe debit or card payment as Stripe reports it, or a check, EFT or Fintech remittance Accounting records. */
export const payment = pgTable(
  "payment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invoiceId: uuid("invoice_id").references(() => invoice.id),
    locationId: uuid("location_id").references(() => customerLocation.id),
    marketId: uuid("market_id").references(() => market.id),
    kind: text("kind").$type<PaymentKind>().notNull(),
    amountCents: integer("amount_cents").notNull(),
    state: text("state").$type<PaymentState>().notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeChargeId: text("stripe_charge_id"),
    stripeRefundId: text("stripe_refund_id"),
    /** Stripe's decline or return code (an ACH return such as insufficient funds) and its message. */
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    /** Check number, remittance id, Fintech reference. */
    reference: text("reference"),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    recordedByEmployeeId: uuid("recorded_by_employee_id"),
    approvalItemId: uuid("approval_item_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payment_invoice_idx").on(t.invoiceId),
    index("payment_location_idx").on(t.locationId, t.occurredAt),
    uniqueIndex("payment_intent_uq").on(t.stripePaymentIntentId).where(sql.raw(`stripe_payment_intent_id is not null`)),
  ],
);

/** The one-time match of the ACH app's Stripe customers to portal accounts (C2): suggested by email, then by name, confirmed by a person. */
export const stripeCustomerMatch = pgTable(
  "stripe_customer_match",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    environment: text("environment").notNull().default("live"),
    name: text("name"),
    email: text("email"),
    stripeCreatedAt: timestamp("stripe_created_at", { withTimezone: true }),
    bankName: text("bank_name"),
    bankLast4: text("bank_last4"),
    hasDefaultBank: boolean("has_default_bank").notNull().default(false),
    suggestedLocationId: uuid("suggested_location_id"),
    /** email | name | null */
    suggestedBy: text("suggested_by"),
    state: text("state").$type<"suggested" | "confirmed" | "dismissed">().notNull().default("suggested"),
    confirmedLocationId: uuid("confirmed_location_id"),
    decidedByEmployeeId: uuid("decided_by_employee_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    note: text("note"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stripe_customer_match_uq").on(t.environment, t.stripeCustomerId)],
);

/**
 * Open Stripe invoices the portal did not create (the ACH app's charge-retailer route, Black Cat invoices made by hand in
 * the dashboard), found by the C2 import. A person ties each to its portal invoice, or marks it as handled in Stripe.
 */
export const stripeInvoiceMatch = pgTable(
  "stripe_invoice_match",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stripeInvoiceId: text("stripe_invoice_id").notNull(),
    environment: text("environment").notNull().default("live"),
    stripeNumber: text("stripe_number"),
    stripeCustomerId: text("stripe_customer_id"),
    customerName: text("customer_name"),
    status: text("status").notNull(),
    totalCents: integer("total_cents").notNull(),
    amountRemainingCents: integer("amount_remaining_cents").notNull(),
    dueDate: date("due_date"),
    stripeCreatedAt: timestamp("stripe_created_at", { withTimezone: true }),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    /** The portal account the Stripe customer is (or was matched to), when known. */
    locationId: uuid("location_id"),
    suggestedInvoiceId: uuid("suggested_invoice_id"),
    /** amount_and_account | amount | null */
    suggestedBy: text("suggested_by"),
    state: text("state").$type<"suggested" | "linked" | "dismissed">().notNull().default("suggested"),
    linkedInvoiceId: uuid("linked_invoice_id"),
    decidedByEmployeeId: uuid("decided_by_employee_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    note: text("note"),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stripe_invoice_match_uq").on(t.environment, t.stripeInvoiceId)],
);

/** A Stripe payout to the bank, as Stripe reports it (S8). */
export const stripePayout = pgTable(
  "stripe_payout",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    payoutId: text("payout_id").notNull(),
    environment: text("environment").notNull().default("live"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    status: text("status").notNull(),
    arrivalDate: date("arrival_date"),
    stripeCreatedAt: timestamp("stripe_created_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stripe_payout_uq").on(t.environment, t.payoutId)],
);

/** The balance transactions inside a payout, each tied to the portal invoice its charge paid when the metadata says so. */
export const stripeBalanceTransaction = pgTable(
  "stripe_balance_transaction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    btId: text("bt_id").notNull(),
    environment: text("environment").notNull().default("live"),
    payoutId: text("payout_id"),
    type: text("type").notNull(),
    amountCents: integer("amount_cents").notNull(),
    feeCents: integer("fee_cents").notNull().default(0),
    netCents: integer("net_cents").notNull(),
    sourceId: text("source_id"),
    chargeId: text("charge_id"),
    stripeInvoiceId: text("stripe_invoice_id"),
    invoiceId: uuid("invoice_id").references(() => invoice.id),
    description: text("description"),
    stripeCreatedAt: timestamp("stripe_created_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stripe_balance_transaction_uq").on(t.environment, t.btId), index("stripe_balance_transaction_payout_idx").on(t.payoutId)],
);

/** Where the mailbox poll stands (the orders@ intake). */
export const mailboxSync = pgTable("mailbox_sync", {
  mailbox: text("mailbox").primaryKey(),
  historyId: text("history_id"),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  lastError: text("last_error"),
  messagesSeen: integer("messages_seen").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** An attachment kept with an intake email (a PDF purchase order, an order-form workbook), with the text pulled from it. */
export const intakeAttachment = pgTable(
  "intake_attachment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    intakeId: uuid("intake_id")
      .notNull()
      .references(() => orderIntakeRequest.id),
    filename: text("filename").notNull(),
    mime: text("mime"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    data: bytea("data"),
    textExtract: text("text_extract"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("intake_attachment_intake_idx").on(t.intakeId)],
);
