import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { envPresent } from "@/lib/env";

export type Provider = (typeof schema.providerEnum.enumValues)[number];
export type IntegrationState = (typeof schema.integrationStateEnum.enumValues)[number];

export const INTEGRATION_STATE_LABEL: Record<IntegrationState, string> = {
  not_implemented: "NOT IMPLEMENTED",
  implemented_not_connected: "IMPLEMENTED / NOT CONNECTED",
  connected_test_mode: "CONNECTED / TEST MODE",
  connected_capability_unverified: "CONNECTED / CAPABILITY UNVERIFIED",
  accepted_for_live_use: "ACCEPTED FOR LIVE USE",
  live_degraded_or_disconnected: "LIVE / DEGRADED OR DISCONNECTED",
};

export interface ProviderDefinition {
  provider: Provider;
  name: string;
  /** Authority per brief §4 fact map — what this provider owns. */
  owns: string;
  /** What stays internal. */
  internalKeeps: string;
  phase: number;
  /** Build state of the adapter in THIS repository revision. */
  built: "not_implemented" | "boundary_only" | "adapter";
  requiredEnv: string[];
  optionalEnv: string[];
  webhookPath?: string;
  callbackPath?: string;
  scopes?: string[];
  /** Env var whose value identifies the credential (fingerprinted, never stored or shown). */
  credentialEnv?: string;
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    provider: "google_identity",
    name: "Google Identity (optional second sign-in method)",
    owns: "Authenticated Google account assertion — optional; the normal sign-in is company email + PIN, which needs no provider",
    internalKeeps: "Stable employee identity, sign-in credential (PIN hash), role/market grants, enablement, offboarding",
    phase: 1,
    built: "adapter",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    optionalEnv: ["GOOGLE_ALLOWED_HD"],
    callbackPath: "/api/auth/google/callback",
    scopes: ["openid", "email", "profile"],
    credentialEnv: "GOOGLE_CLIENT_SECRET",
  },
  {
    provider: "stripe",
    name: "Stripe (ACH, invoices, credit balance)",
    owns: "Payment credentials/mandates, issued invoice/number/document/balance, payment outcomes, spendable credit balance",
    internalKeeps: "Location/payer authority, delivery-derived obligation and timing, collection permission, causal holds, entitlement",
    phase: 1,
    built: "adapter",
    requiredEnv: ["STRIPE_SECRET_KEY"],
    optionalEnv: ["STRIPE_WEBHOOK_SECRET"],
    webhookPath: "/api/webhooks/stripe",
    credentialEnv: "STRIPE_SECRET_KEY",
  },
  {
    provider: "optimoroute",
    name: "OptimoRoute (routing & field execution)",
    owns: "Route computation, live driver assignment, native observation/POD capture",
    internalKeeps: "Eligible work, released commitment, accepted actuals, residuals, change acknowledgement",
    phase: 2,
    built: "boundary_only",
    requiredEnv: ["OPTIMOROUTE_API_KEY"],
    optionalEnv: [],
    credentialEnv: "OPTIMOROUTE_API_KEY",
  },
  {
    provider: "gmail",
    name: "Gmail (customer notice transport)",
    owns: "Email transport outcome and human reply conversation",
    internalKeeps: "Notice intent/version/recipient, chosen sender, evidence, failure owner",
    phase: 1,
    built: "boundary_only",
    requiredEnv: ["GMAIL_SENDER_ADDRESS", "GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REFRESH_TOKEN"],
    optionalEnv: [],
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    credentialEnv: "GMAIL_OAUTH_REFRESH_TOKEN",
  },
  {
    provider: "google_address",
    name: "Google Address Validation (advisory)",
    owns: "Its own address assessment at that time (advisory)",
    internalKeeps: "Customer-confirmed address facts, serviceability decision, permitted-content use (IG05)",
    phase: 1,
    built: "boundary_only",
    requiredEnv: ["GOOGLE_MAPS_API_KEY"],
    optionalEnv: [],
    credentialEnv: "GOOGLE_MAPS_API_KEY",
  },
  {
    provider: "slack",
    name: "Slack (alerts & summaries)",
    owns: "Communication record only — never business state",
    internalKeeps: "Exception ownership, current status, permanent audit",
    phase: 1,
    built: "boundary_only",
    requiredEnv: ["SLACK_BOT_TOKEN"],
    optionalEnv: ["SLACK_SIGNING_SECRET", "SLACK_DEFAULT_CHANNEL"],
    scopes: ["chat:write"],
    credentialEnv: "SLACK_BOT_TOKEN",
  },
  {
    provider: "qbo",
    name: "QuickBooks Online (general ledger)",
    owns: "Formal GL, accounting records and statements",
    internalKeeps: "Operational/commercial subledger, source detail, one-writer assignment (accountant-selected)",
    phase: 3,
    built: "not_implemented",
    requiredEnv: ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REALM_ID"],
    optionalEnv: [],
    callbackPath: "/api/oauth/qbo/callback",
    credentialEnv: "QBO_CLIENT_SECRET",
  },
];

/** Non-secret fingerprint of a credential value (first 12 hex chars of its SHA-256). */
export function credentialFingerprint(value: string | undefined): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Five separate facts (REV-12 / AC19): build state, credentials present,
 * connection evidence, capability demonstration, activation. None implies
 * the next. A connection is "ok" only from a recorded successful check made
 * with the credential currently configured; a later credential is "stale".
 */
export type ConnectionFact = "not_applicable" | "no_check" | "failed" | "stale" | "ok";
export type CapabilityFact = "not_applicable" | "unproven" | "partially_demonstrated" | "demonstrated";
export type ActivationFact = "not_activated" | "accepted_for_live_use" | "degraded";

export interface ProviderStatus extends ProviderDefinition {
  /** Legacy single label kept for the enum/table; derived from the facts below. */
  state: IntegrationState;
  headline: string;
  environment: "test" | "live" | null;
  credentialsPresent: boolean;
  missingEnv: string[];
  connection: ConnectionFact;
  connectionDetail: string;
  capability: CapabilityFact;
  activation: ActivationFact;
  accountId: string | null;
  recorded: typeof schema.providerConnection.$inferSelect | null;
  gates: Array<typeof schema.capabilityGate.$inferSelect>;
}

/** Compute the build-versus-activate facts for every provider. */
export async function providerStatuses(db: DbOrTx): Promise<ProviderStatus[]> {
  const recorded = await db.select().from(schema.providerConnection);
  const gates = await db.select().from(schema.capabilityGate);
  return PROVIDERS.map((def) => {
    const missingEnv = def.requiredEnv.filter((e) => !envPresent(e));
    const credentialsPresent = missingEnv.length === 0;
    const rec = recorded.find((r) => r.provider === def.provider) ?? null;
    const providerGates = gates.filter((g) => g.provider === def.provider);
    const fp = def.credentialEnv ? credentialFingerprint(process.env[def.credentialEnv]) : null;

    let connection: ConnectionFact;
    let connectionDetail: string;
    if (def.built !== "adapter") {
      connection = "not_applicable";
      connectionDetail = def.built === "boundary_only" ? "Boundary only: no connection code exists in this revision, so credentials cannot make it connected." : "Not implemented.";
    } else if (!credentialsPresent) {
      connection = "no_check";
      connectionDetail = `Credentials missing: ${missingEnv.join(", ")}.`;
    } else if (!rec?.lastSuccessAt) {
      connection = rec?.lastCheckedAt ? "failed" : "no_check";
      connectionDetail = rec?.lastCheckedAt ? `Last check failed${rec.detail && typeof rec.detail === "object" && "error" in rec.detail ? `: ${String((rec.detail as { error?: unknown }).error)}` : ""}.` : "Configured but the connection has not been tested.";
    } else if (rec.credentialFingerprint && fp && rec.credentialFingerprint !== fp) {
      connection = "stale";
      connectionDetail = "The credential changed since the last successful check; re-run the connectivity check.";
    } else if (rec.lastCheckedAt && rec.lastSuccessAt && rec.lastCheckedAt > rec.lastSuccessAt) {
      connection = "failed";
      connectionDetail = "The most recent check failed after an earlier success.";
    } else {
      connection = "ok";
      connectionDetail = `Connection verified${rec.accountId ? ` (account ${rec.accountId})` : ""}.`;
    }

    const required = providerGates.filter((g) => g.classification !== "optional_enhancement");
    const capability: CapabilityFact =
      def.built !== "adapter" || required.length === 0
        ? def.built === "adapter" ? "demonstrated" : "not_applicable"
        : required.every((g) => g.status === "demonstrated" || g.status === "not_applicable_yet")
          ? "demonstrated"
          : required.some((g) => g.status === "demonstrated" || g.status === "temporary_control_approved")
            ? "partially_demonstrated"
            : "unproven";

    // Activation is an explicit recorded act; it only holds while the connection is currently ok.
    const activation: ActivationFact =
      rec?.state === "accepted_for_live_use" ? (connection === "ok" ? "accepted_for_live_use" : "degraded") : rec?.state === "live_degraded_or_disconnected" ? "degraded" : "not_activated";

    const environment: "test" | "live" | null = connection === "ok" || connection === "failed" || connection === "stale" ? ((rec?.environment as "test" | "live" | null) ?? null) : null;

    let state: IntegrationState;
    let headline: string;
    if (def.built === "not_implemented") {
      state = "not_implemented";
      headline = "Not implemented";
    } else if (def.built === "boundary_only") {
      state = "not_implemented";
      headline = credentialsPresent ? "Boundary only — credentials present but nothing can connect" : "Boundary only — not connectable in this revision";
    } else if (activation === "accepted_for_live_use") {
      state = "accepted_for_live_use";
      headline = "Accepted for live use";
    } else if (activation === "degraded") {
      state = "live_degraded_or_disconnected";
      headline = "Live but degraded or disconnected";
    } else if (connection !== "ok") {
      state = "implemented_not_connected";
      headline = !credentialsPresent ? "Implemented — not connected (credentials missing)" : connection === "failed" ? "Implemented — connection check failed" : connection === "stale" ? "Implemented — credential changed, re-check needed" : "Implemented — configured, connection untested";
    } else if (capability !== "demonstrated") {
      state = environment === "live" ? "connected_capability_unverified" : "connected_test_mode";
      headline = `Connected (${environment ?? "test"} mode) — capability ${capability === "unproven" ? "unproven" : "partly demonstrated"}`;
    } else {
      state = environment === "live" ? "connected_capability_unverified" : "connected_test_mode";
      headline = `Connected (${environment ?? "test"} mode) — capability demonstrated, not yet activated`;
    }

    return { ...def, state, headline, environment, credentialsPresent, missingEnv, connection, connectionDetail, capability, activation, accountId: rec?.accountId ?? null, recorded: rec, gates: providerGates };
  });
}

/** Record the outcome of a connectivity check; a success binds account identity and credential fingerprint (REV-13). */
export async function recordConnectionCheck(
  db: DbOrTx,
  provider: Provider,
  input: { ok: boolean; environment: "test" | "live" | null; accountId?: string | null; credentialFingerprint?: string | null; detail: Record<string, unknown> },
) {
  const now = new Date();
  const [existing] = await db.select().from(schema.providerConnection).where(eq(schema.providerConnection.provider, provider));
  const keepsActivation = existing?.state === "accepted_for_live_use" || existing?.state === "live_degraded_or_disconnected";
  const state: IntegrationState = keepsActivation ? (input.ok ? "accepted_for_live_use" : "live_degraded_or_disconnected") : input.ok ? (input.environment === "live" ? "connected_capability_unverified" : "connected_test_mode") : "implemented_not_connected";
  const values = {
    provider,
    state,
    environment: input.environment,
    lastCheckedAt: now,
    detail: input.detail,
    updatedAt: now,
    ...(input.ok ? { lastSuccessAt: now, accountId: input.accountId ?? null, credentialFingerprint: input.credentialFingerprint ?? null } : {}),
  };
  await db.insert(schema.providerConnection).values(values).onConflictDoUpdate({ target: schema.providerConnection.provider, set: values });
}

/** Explicit activation act (Admin with evidence); only meaningful while the connection is verified. */
export async function recordActivation(db: DbOrTx, provider: Provider, accepted: boolean) {
  const [existing] = await db.select().from(schema.providerConnection).where(eq(schema.providerConnection.provider, provider));
  if (!existing) return null;
  const [row] = await db
    .update(schema.providerConnection)
    .set({ state: accepted ? "accepted_for_live_use" : existing.environment === "live" ? "connected_capability_unverified" : "connected_test_mode", updatedAt: new Date() })
    .where(eq(schema.providerConnection.provider, provider))
    .returning();
  return row;
}

export async function getProviderReference(db: DbOrTx, provider: Provider, subjectType: string, subjectId: string, providerObject: string) {
  const rows = await db
    .select()
    .from(schema.providerReference)
    .where(and(eq(schema.providerReference.subjectId, subjectId), eq(schema.providerReference.provider, provider), eq(schema.providerReference.subjectType, subjectType), eq(schema.providerReference.providerObject, providerObject)));
  return rows.find((r) => r.providerId && r.status === "established") ?? rows[0] ?? null;
}
