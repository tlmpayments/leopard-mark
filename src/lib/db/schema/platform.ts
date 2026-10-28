/**
 * Platform schema — people/authority, audit, decisions (policy register),
 * exceptions, jobs, provider references/events/gates and notice intents.
 *
 * Business meaning (brief §6): these are the "People and authority" and
 * "Control and communication" subject groups. Nothing here is a provider's
 * truth; provider facts live behind provider_reference / provider_event
 * as non-authoritative mirrors (brief §4).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
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

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Exactly five roles (brief §5). No other application role may be added. */
export const roleEnum = pgEnum("role", [
  "owner",
  "admin",
  "accounting",
  "sales",
  "driver_service",
]);

export const actorKindEnum = pgEnum("actor_kind", [
  "employee",
  "system",
  "provider",
  "dev_fixture",
]);

/** Status labels from brief §2.2. */
export const decisionRegisterEnum = pgEnum("decision_register", [
  "D",
  "SD",
  "T",
  "IG",
]);

export const decisionStatusEnum = pgEnum("decision_status", [
  "unselected",
  "selected",
]);

export const selectionKindEnum = pgEnum("selection_kind", [
  "production",
  "test",
]);

export const exceptionStateEnum = pgEnum("exception_state", [
  "open",
  "acknowledged",
  "assigned",
  "waiting",
  "resolved",
]);

/**
 * Job states (text, not a Postgres enum, so that new states can ship in one
 * transactional migration): queued | running | done | failed | waiting.
 * `waiting` = provider/capability unavailable — durable, resumed when the
 * provider becomes usable (REV-14).
 */
export const JOB_STATUSES = ["queued", "running", "done", "failed", "waiting"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const providerEnum = pgEnum("provider", [
  "stripe",
  "optimoroute",
  "google_identity",
  "gmail",
  "google_address",
  "slack",
  "qbo",
]);

/** Build-versus-activate states (brief, Integration Commissioning). */
export const integrationStateEnum = pgEnum("integration_state", [
  "not_implemented",
  "implemented_not_connected",
  "connected_test_mode",
  "connected_capability_unverified",
  "accepted_for_live_use",
  "live_degraded_or_disconnected",
]);

export const gateClassificationEnum = pgEnum("gate_classification", [
  "must_work_before_initial_field_use",
  "can_use_temporary_control",
  "optional_enhancement",
  "scoped_acceptance",
]);

export const gateStatusEnum = pgEnum("gate_status", [
  "unproven",
  "demonstrated",
  "temporary_control_approved",
  "not_applicable_yet",
]);

export const noticeStateEnum = pgEnum("notice_state", [
  "intended",
  "manual_pending",
  "sent",
  "failed",
  "unknown",
  "superseded",
]);

export const noticeSenderEnum = pgEnum("notice_sender", [
  "unselected",
  "gmail",
  "stripe_native",
  "manual",
]);

// ---------------------------------------------------------------------------
// People and authority
// ---------------------------------------------------------------------------

/**
 * Stable internal business/audit identity. Survives Google email/account
 * rename. `enabled=false` is the internal effective disablement that stops
 * existing-session business use on the very next request (brief §5, AT62).
 */
export const employee = pgTable("employee", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  disabledByEmployeeId: uuid("disabled_by_employee_id"),
  disableReason: text("disable_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Sign-in identity: the company email the person signs in with (email + PIN),
 * optionally bound to a Google `sub` when Google sign-in is configured. One
 * employee may have several identity rows over time (email rename); an email
 * re-used by a different person gets a new row and a different employee (AT61).
 */
export const employeeIdentity = pgTable(
  "employee_identity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.id),
    googleSubject: text("google_subject"),
    email: text("email").notNull(),
    current: boolean("current").notNull().default(true),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Why the identity ended: rename | retired | reassigned (REV-17). */
    endedReason: text("ended_reason"),
    endedByEmployeeId: uuid("ended_by_employee_id"),
  },
  (t) => [
    /** A Google subject binds to at most one CURRENT identity; ended rows keep their subject as history (REV-17). */
    uniqueIndex("employee_identity_subject_uq")
      .on(t.googleSubject)
      .where(sql.raw(`google_subject is not null and current = true`)),
    uniqueIndex("employee_identity_current_email_uq")
      .on(t.email)
      .where(sql.raw(`current = true`)),
    uniqueIndex("employee_identity_current_employee_uq")
      .on(t.employeeId)
      .where(sql.raw(`current = true`)),
    index("employee_identity_email_idx").on(t.email),
  ],
);

/**
 * Sign-in credential: a PIN chosen by the person (or a temporary one set by
 * an Owner/Admin that must be changed at first sign-in). Only a scrypt hash
 * is stored. One CURRENT credential per employee; a reset ends the old row
 * (history kept) and every session issued against it stops. Failed attempts
 * and lockouts live here so the same rule applies on every instance.
 */
export const employeeCredential = pgTable(
  "employee_credential",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.id),
    pinHash: text("pin_hash").notNull(),
    current: boolean("current").notNull().default(true),
    /** True when an Owner/Admin set a temporary PIN: the person must choose their own before any business use. */
    mustChange: boolean("must_change").notNull().default(true),
    setAt: timestamp("set_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    setByEmployeeId: uuid("set_by_employee_id"),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Why the credential ended: changed | reset | offboarded (REV-17 style history). */
    endedReason: text("ended_reason"),
    endedByEmployeeId: uuid("ended_by_employee_id"),
  },
  (t) => [
    uniqueIndex("employee_credential_current_uq")
      .on(t.employeeId)
      .where(sql.raw(`current = true`)),
    index("employee_credential_employee_idx").on(t.employeeId),
  ],
);

/**
 * Internal business authorization. marketId NULL = every market for that role.
 * Revocation is a new fact (revokedAt), never a delete: stale enablement
 * events cannot restore revoked access.
 */
export const roleGrant = pgTable(
  "role_grant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.id),
    role: roleEnum("role").notNull(),
    marketId: uuid("market_id"),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    grantedByEmployeeId: uuid("granted_by_employee_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByEmployeeId: uuid("revoked_by_employee_id"),
    revokeReason: text("revoke_reason"),
  },
  (t) => [index("role_grant_employee_idx").on(t.employeeId)],
);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Brief §43: actor, time, affected item, action, prior/new values, reason. */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorKind: actorKindEnum("actor_kind").notNull(),
    actorEmployeeId: uuid("actor_employee_id"),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    prior: jsonb("prior"),
    current: jsonb("current"),
    reason: text("reason"),
    correlationId: text("correlation_id"),
    marketId: uuid("market_id"),
  },
  (t) => [
    index("audit_subject_idx").on(t.subjectType, t.subjectId),
    index("audit_at_idx").on(t.at),
  ],
);

// ---------------------------------------------------------------------------
// Decision register (D / SD / T / IG) — brief §52
// ---------------------------------------------------------------------------

/**
 * Every open decision is preserved with question, scope and owner. Status
 * `unselected` is a distinct business meaning — not "off", zero or a vendor
 * default (brief §2.2). Production selections are recorded with scope and
 * effective date; test selections never count as production policy.
 */
export const decision = pgTable("decision", {
  id: text("id").primaryKey(), // e.g. "D01", "SD02", "T06", "IG03"
  register: decisionRegisterEnum("register").notNull(),
  title: text("title").notNull(),
  question: text("question").notNull(),
  confirmedBehavior: text("confirmed_behavior").notNull(),
  safeSupport: text("safe_support").notNull(),
  keepInactive: text("keep_inactive").notNull(),
  accountable: text("accountable").notNull(),
  status: decisionStatusEnum("status").notNull().default("unselected"),
  /** Structured keys the code may consult when a selection exists. */
  selectionSchema: jsonb("selection_schema").$type<Record<string, string>>(),
});

export const decisionSelection = pgTable(
  "decision_selection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    decisionId: text("decision_id")
      .notNull()
      .references(() => decision.id),
    kind: selectionKindEnum("kind").notNull(),
    selection: jsonb("selection").$type<Record<string, unknown>>().notNull(),
    /** Human description of the scope (e.g. "NC market only"). */
    scope: text("scope").notNull(),
    /** Structured scope: market ids the selection applies to; NULL = every market. */
    marketIds: jsonb("market_ids").$type<string[] | null>(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    recordedByEmployeeId: uuid("recorded_by_employee_id"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    /** Explicit withdrawal provenance (a superseded selection stays as history). */
    withdrawnByEmployeeId: uuid("withdrawn_by_employee_id"),
    withdrawnReason: text("withdrawn_reason"),
    note: text("note"),
  },
  (t) => [index("decision_selection_decision_idx").on(t.decisionId)],
);

// ---------------------------------------------------------------------------
// Exceptions (one incident, linked consequences) — brief §41
// ---------------------------------------------------------------------------

export const exceptionCase = pgTable(
  "exception_case",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    category: text("category").notNull(), // e.g. allocation_shortage, license_unverified, billing_email_change, duplicate_suspected, abnormal_order, provider_handoff_unknown, ...
    title: text("title").notNull(),
    cause: text("cause"),
    marketId: uuid("market_id"),
    locationId: uuid("location_id"),
    state: exceptionStateEnum("state").notNull().default("open"),
    /** Severity is D27 (unselected); stored only when a person sets it. */
    severity: text("severity"),
    ownerRole: roleEnum("owner_role"),
    ownerEmployeeId: uuid("owner_employee_id"),
    nextAction: text("next_action"),
    waitingParty: text("waiting_party"),
    reviewAt: timestamp("review_at", { withTimezone: true }),
    parentCaseId: uuid("parent_case_id"),
    /** Idempotency: one incident per cause key while open. */
    dedupeKey: text("dedupe_key"),
    resolution: text("resolution"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByEmployeeId: uuid("resolved_by_employee_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("exception_state_idx").on(t.state),
    index("exception_location_idx").on(t.locationId),
    uniqueIndex("exception_dedupe_open_uq")
      .on(t.dedupeKey)
      .where(sqlOpenDedupe()),
  ],
);

export const exceptionLink = pgTable(
  "exception_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => exceptionCase.id),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    relation: text("relation"),
  },
  (t) => [index("exception_link_subject_idx").on(t.subjectType, t.subjectId)],
);

export const exceptionNote = pgTable("exception_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseId: uuid("case_id")
    .notNull()
    .references(() => exceptionCase.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorEmployeeId: uuid("actor_employee_id"),
  actorKind: actorKindEnum("actor_kind").notNull().default("employee"),
  kind: text("kind").notNull().default("note"), // note | state_change | assignment | evidence
  body: text("body").notNull(),
  data: jsonb("data"),
});

// ---------------------------------------------------------------------------
// Jobs (Postgres-backed queue; Vercel cron drains it) — technical choice
// ---------------------------------------------------------------------------

export const job = pgTable(
  "job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    /** Fencing token: only the worker holding the current token may complete/fail the job (§4.7). */
    claimToken: uuid("claim_token"),
    lastError: text("last_error"),
    /** Why the job is `waiting` (provider not connected, capability unproven). */
    waitingReason: text("waiting_reason"),
    /** One intended effect per business event: duplicate enqueues collapse. */
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("job_status_run_at_idx").on(t.status, t.runAt),
    uniqueIndex("job_dedupe_active_uq")
      .on(t.dedupeKey)
      .where(sql.raw(`dedupe_key is not null and status in ('queued','running','waiting')`)),
  ],
);

// ---------------------------------------------------------------------------
// Provider references, events, connection state and gates — brief §4, §49
// ---------------------------------------------------------------------------

/** Non-authoritative mirror of a provider object tied to an internal subject. */
export const providerReference = pgTable(
  "provider_reference",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: providerEnum("provider").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    providerObject: text("provider_object").notNull(), // e.g. "customer"
    providerId: text("provider_id"), // null while creation is pending/unknown
    environment: text("environment").notNull().default("test"), // test | live
    /** The company provider account the reference belongs to (e.g. Stripe acct_…); null until verified (REV-13). */
    providerAccountId: text("provider_account_id"),
    status: text("status").notNull().default("pending"), // pending | unknown | established | failed | stale
    evidence: jsonb("evidence"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("provider_reference_subject_idx").on(t.subjectType, t.subjectId),
    uniqueIndex("provider_reference_provider_id_uq").on(
      t.provider,
      t.environment,
      t.providerAccountId,
      t.providerObject,
      t.providerId,
    ),
    uniqueIndex("provider_reference_pending_uq")
      .on(t.provider, t.environment, t.subjectType, t.subjectId, t.providerObject)
      .where(sql.raw(`provider_id is null`)),
  ],
);

/** Idempotent record of incoming provider events (webhooks / polls). */
export const providerEvent = pgTable(
  "provider_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: providerEnum("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    payload: jsonb("payload"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    outcome: text("outcome"), // applied | duplicate | ignored | failed | deferred
    signatureVerified: boolean("signature_verified").notNull().default(false),
  },
  (t) => [uniqueIndex("provider_event_uq").on(t.provider, t.eventId)],
);

/** Recorded (not computed) connection status and last check evidence. */
export const providerConnection = pgTable("provider_connection", {
  provider: providerEnum("provider").primaryKey(),
  state: integrationStateEnum("state").notNull().default("not_implemented"),
  environment: text("environment"), // test | live | null
  /** Provider-side account identity established by the last successful check (REV-12/13). */
  accountId: text("account_id"),
  /** Non-secret fingerprint of the credential the last check used; a different credential makes the check stale. */
  credentialFingerprint: text("credential_fingerprint"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  detail: jsonb("detail"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Capability acceptance gates (brief §49): business outcome must be demonstrated before reliance. */
export const capabilityGate = pgTable("capability_gate", {
  id: text("id").primaryKey(), // e.g. "OR_ACTUALS", "STRIPE_HOSTED_SETUP", "ACCESS_DISABLE"
  provider: providerEnum("provider"),
  name: text("name").notNull(),
  classification: gateClassificationEnum("classification").notNull(),
  requiredDemonstration: text("required_demonstration").notNull(),
  permittedControl: text("permitted_control"),
  phase: integer("phase").notNull(),
  status: gateStatusEnum("status").notNull().default("unproven"),
  evidence: text("evidence"),
  recordedByEmployeeId: uuid("recorded_by_employee_id"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Notice intents (brief §42) — recorded intent/version/outcome; sender unselected
// ---------------------------------------------------------------------------

export const notice = pgTable(
  "notice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: text("purpose").notNull(), // order_received | delivery_scheduled | ...
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    version: integer("version").notNull().default(1),
    recipientEmail: text("recipient_email"),
    recipientContactId: uuid("recipient_contact_id"),
    intendedSender: noticeSenderEnum("intended_sender").notNull().default("unselected"),
    state: noticeStateEnum("state").notNull().default("intended"),
    content: jsonb("content"),
    evidence: jsonb("evidence"),
    /** One pending intent per business purpose/subject/version (REV-18). */
    dedupeKey: text("dedupe_key"),
    /** Market for permission scoping. */
    marketId: uuid("market_id"),
    locationId: uuid("location_id"),
    /** Manual-process outcome: who recorded the send/failure, when, how (never inferred). */
    outcomeRecordedAt: timestamp("outcome_recorded_at", { withTimezone: true }),
    outcomeRecordedByEmployeeId: uuid("outcome_recorded_by_employee_id"),
    sentVia: text("sent_via"),
    outcomeNote: text("outcome_note"),
    supersedesNoticeId: uuid("supersedes_notice_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notice_subject_idx").on(t.subjectType, t.subjectId),
    index("notice_state_idx").on(t.state),
    uniqueIndex("notice_pending_dedupe_uq")
      .on(t.dedupeKey)
      .where(sql.raw(`dedupe_key is not null and state in ('intended','manual_pending')`)),
  ],
);

// ---------------------------------------------------------------------------
// helpers for partial indexes
// ---------------------------------------------------------------------------

function sqlOpenDedupe() {
  return sql.raw(`dedupe_key is not null and state <> 'resolved'`);
}
