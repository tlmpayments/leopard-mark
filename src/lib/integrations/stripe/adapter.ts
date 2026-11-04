import { and, desc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { SYSTEM_ACTOR, type Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db, DbOrTx } from "@/lib/db/types";
import { envPresent } from "@/lib/env";
import { BusinessError } from "@/lib/errors";
import { ProviderUnavailableError, enqueueJob, registerJobHandler, resumeWaitingJobs } from "@/lib/jobs/queue";
import { credentialFingerprint, recordConnectionCheck } from "../registry";
import { currentStripeGateway, stripeGatewayMode, type StripeGateway } from "./gateway";

/**
 * Stripe adapter — the bounded integration module (brief §11, Integration Commissioning).
 *
 * Round 4 makes Stripe the money ledger (the Stripe plan, Nov 4, 2026): one Stripe customer per licensed location,
 * the hosted ACH setup session, invoices mirrored under the portal's number, the due-date debit, credit notes, and
 * paid / failed / disputed flowing back by webhook. Business meaning lives in `src/lib/domain/collection`; this module
 * keeps the account binding, the connectivity check, the customer association job and the webhook receiver.
 *
 * Authority: Stripe owns credentials/mandates/invoice numbers it issues/payment outcomes/balance. The portal keeps
 * the customer id as a non-spendable mirror plus status evidence. No Connect (U25), no Tax (U21), no Subscriptions.
 *
 * Account/environment binding (REV-13, AC20): every reference and every queued effect is bound to the Stripe ACCOUNT
 * and MODE (test/live) that a successful connectivity check established with the currently configured credential.
 * Until the account is verified the adapter fails closed (work waits; nothing is created against an unknown account).
 */

export function stripeConfigured(): boolean {
  return stripeGatewayMode() !== "off";
}

export function stripeEnvironment(): "test" | "live" | null {
  const mode = stripeGatewayMode();
  if (mode === "off") return null;
  if (mode === "fake") return "test";
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return /_test_/.test(key) ? "test" : "live";
}

export function stripeFingerprint(): string | null {
  const mode = stripeGatewayMode();
  if (mode === "off") return null;
  if (mode === "fake") return "fake-gateway";
  return credentialFingerprint(process.env.STRIPE_SECRET_KEY);
}

export function gateway(): StripeGateway {
  const gw = currentStripeGateway();
  if (!gw) throw new StripeNotConnectedError();
  return gw;
}

export class StripeNotConnectedError extends BusinessError {
  constructor(message = "Stripe is IMPLEMENTED / NOT CONNECTED: STRIPE_SECRET_KEY is not configured.") {
    super(message, { code: "provider_not_connected" });
    this.name = "StripeNotConnectedError";
  }
}

export interface StripeBinding {
  accountId: string;
  environment: "test" | "live";
}

/**
 * The verified Stripe account for the CURRENT credential: a recorded successful check whose fingerprint matches the
 * configured key and whose mode matches the key. Null = unverified → fail closed.
 */
export async function verifiedStripeAccount(db: DbOrTx): Promise<StripeBinding | null> {
  if (!stripeConfigured()) return null;
  const [rec] = await db.select().from(schema.providerConnection).where(eq(schema.providerConnection.provider, "stripe"));
  if (!rec?.lastSuccessAt || !rec.accountId) return null;
  if (rec.credentialFingerprint !== stripeFingerprint()) return null;
  const env = stripeEnvironment();
  if (!env || rec.environment !== env) return null;
  if (rec.lastCheckedAt && rec.lastCheckedAt > rec.lastSuccessAt) return null; // latest check failed
  return { accountId: rec.accountId, environment: env };
}

/** Connectivity check (never a capability proof). A success binds account + mode + credential fingerprint and resumes waiting work. */
export async function checkStripeConnection(db: DbOrTx): Promise<{ ok: boolean; detail: Record<string, unknown> }> {
  if (!stripeConfigured()) {
    await recordConnectionCheck(db, "stripe", { ok: false, environment: null, detail: { reason: "STRIPE_SECRET_KEY missing" } });
    return { ok: false, detail: { reason: "STRIPE_SECRET_KEY missing" } };
  }
  try {
    const acct = await gateway().retrieveAccount();
    const env = stripeEnvironment();
    const detail = { accountId: acct.id, country: acct.country, chargesEnabled: acct.chargesEnabled, environment: env, webhookSecretPresent: envPresent("STRIPE_WEBHOOK_SECRET") || stripeGatewayMode() === "fake", gateway: stripeGatewayMode() };
    await recordConnectionCheck(db, "stripe", { ok: true, environment: env, accountId: acct.id, credentialFingerprint: stripeFingerprint(), detail });
    await resumeWaitingJobs(db);
    return { ok: true, detail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordConnectionCheck(db, "stripe", { ok: false, environment: stripeEnvironment(), detail: { error: message } });
    return { ok: false, detail: { error: message } };
  }
}

export const JOB_ENSURE_CUSTOMER = "stripe.customer.ensure";

/**
 * Request association of a Stripe customer to a licensed location. Records a pending provider reference and enqueues
 * the provider call. Nothing is simulated: until Stripe confirms, the reference stays `pending`, and if Stripe is not
 * connected the queued work WAITS with that reason visible and resumes once a connectivity check succeeds (REV-14).
 */
export async function requestStripeCustomerAssociation(db: DbOrTx, actor: Actor, locationId: string, opts: { authorized?: boolean } = {}) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Location not found");
  if (!opts.authorized) authorize(actor, "payment.request_setup", { marketId: loc.marketId });
  const binding = await verifiedStripeAccount(db);
  const env = binding?.environment ?? stripeEnvironment() ?? "test";
  const existing = await customerReference(db, locationId, binding);
  if (!existing) {
    // One pending reference per (location, environment): insert-if-absent under the partial unique index.
    await db
      .insert(schema.providerReference)
      .values({ provider: "stripe", subjectType: "customer_location", subjectId: locationId, providerObject: "customer", environment: env, providerAccountId: binding?.accountId ?? null, status: "pending", evidence: binding ? null : { reason: "Stripe IMPLEMENTED / NOT CONNECTED or account not verified — waiting" } })
      .onConflictDoNothing();
  }
  const ref = await customerReference(db, locationId, binding);
  if (!ref) throw new BusinessError("Provider reference could not be established");
  const queued = await enqueueJob(db, JOB_ENSURE_CUSTOMER, { locationId }, { dedupeKey: `${JOB_ENSURE_CUSTOMER}:${locationId}` });
  await recordAudit(db, actor, {
    action: "stripe.customer.request",
    subjectType: "customer_location",
    subjectId: locationId,
    current: { providerReferenceId: ref.id, status: ref.status, environment: ref.environment, accountId: ref.providerAccountId, job: queued.outcome, jobId: queued.job?.id ?? null },
    marketId: loc.marketId,
  });
  return { ref, job: queued };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The one usable customer reference for a location under the given binding: an established row for THIS account and
 * mode wins; otherwise the pending row for this mode that is unbound or bound to this account. References belonging to
 * another mode or another company account are never returned.
 */
export async function customerReference(db: DbOrTx, locationId: string, binding: StripeBinding | null) {
  const env = binding?.environment ?? stripeEnvironment() ?? "test";
  const rows = await db
    .select()
    .from(schema.providerReference)
    .where(and(eq(schema.providerReference.provider, "stripe"), eq(schema.providerReference.subjectType, "customer_location"), eq(schema.providerReference.subjectId, locationId), eq(schema.providerReference.providerObject, "customer"), eq(schema.providerReference.environment, env)))
    .orderBy(desc(schema.providerReference.createdAt));
  if (binding) {
    const established = rows.find((r) => r.providerId && r.status === "established" && r.providerAccountId === binding.accountId);
    if (established) return established;
  }
  return rows.find((r) => !r.providerId && (r.providerAccountId === null || (binding && r.providerAccountId === binding.accountId))) ?? null;
}

/** The established Stripe customer id for a location under the current verified binding, or null. */
export async function stripeCustomerIdFor(db: DbOrTx, locationId: string): Promise<string | null> {
  const binding = await verifiedStripeAccount(db);
  if (!binding) return null;
  const ref = await customerReference(db, locationId, binding);
  return ref?.providerId ?? null;
}

/** Every reference row for a location, annotated with whether it is usable under the current binding (for the account page). */
export async function customerReferenceStatus(db: DbOrTx, locationId: string) {
  const binding = await verifiedStripeAccount(db);
  const usable = await customerReference(db, locationId, binding);
  const rows = await db
    .select()
    .from(schema.providerReference)
    .where(and(eq(schema.providerReference.provider, "stripe"), eq(schema.providerReference.subjectType, "customer_location"), eq(schema.providerReference.subjectId, locationId), eq(schema.providerReference.providerObject, "customer")))
    .orderBy(desc(schema.providerReference.createdAt));
  return {
    binding,
    usable,
    others: rows.filter((r) => r.id !== usable?.id).map((r) => ({ ...r, why: r.providerAccountId && binding && r.providerAccountId !== binding.accountId ? "different Stripe account" : r.environment !== (binding?.environment ?? stripeEnvironment() ?? "test") ? `${r.environment} mode` : r.status === "stale" ? "recorded before account binding; re-verify" : "superseded" })),
  };
}

/**
 * Link an existing Stripe customer (one the ACH app made) to a location under the verified binding (C2). Refuses when
 * the location already has an established customer in this account, or the Stripe customer is already linked elsewhere.
 */
export async function linkExistingStripeCustomer(db: DbOrTx, actor: Actor, locationId: string, stripeCustomerId: string, evidence: Record<string, unknown>) {
  const binding = await verifiedStripeAccount(db);
  if (!binding) throw new StripeNotConnectedError("Stripe account is not verified for the configured credential; run the connectivity check first.");
  const current = await customerReference(db, locationId, binding);
  if (current?.providerId && current.providerId !== stripeCustomerId) throw new BusinessError(`This account already has Stripe customer ${current.providerId}`);
  const [taken] = await db
    .select()
    .from(schema.providerReference)
    .where(and(eq(schema.providerReference.provider, "stripe"), eq(schema.providerReference.providerObject, "customer"), eq(schema.providerReference.providerId, stripeCustomerId), eq(schema.providerReference.environment, binding.environment), eq(schema.providerReference.providerAccountId, binding.accountId)));
  if (taken && taken.subjectId !== locationId) throw new BusinessError(`Stripe customer ${stripeCustomerId} is already linked to another account`);
  if (current?.providerId === stripeCustomerId) return current;
  const now = new Date();
  let row;
  if (current) {
    [row] = await db
      .update(schema.providerReference)
      .set({ providerId: stripeCustomerId, status: "established", providerAccountId: binding.accountId, evidence: { ...evidence, linked: true }, lastCheckedAt: now, updatedAt: now })
      .where(eq(schema.providerReference.id, current.id))
      .returning();
  } else {
    [row] = await db
      .insert(schema.providerReference)
      .values({ provider: "stripe", subjectType: "customer_location", subjectId: locationId, providerObject: "customer", providerId: stripeCustomerId, environment: binding.environment, providerAccountId: binding.accountId, status: "established", evidence: { ...evidence, linked: true }, lastCheckedAt: now })
      .returning();
  }
  await recordAudit(db, actor, { action: "stripe.customer.linked", subjectType: "customer_location", subjectId: locationId, current: { stripeCustomerId, accountId: binding.accountId, ...evidence } });
  return row;
}

/** The customer details the portal pushes to Stripe (C3, C4): name, billing email, address and the portal's identifiers. */
export async function customerDetails(db: DbOrTx, locationId: string) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Location not found");
  const [market] = await db.select().from(schema.market).where(eq(schema.market.id, loc.marketId));
  const ap = await db
    .select({ email: schema.contact.email, name: schema.contact.name })
    .from(schema.locationContact)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
    .where(and(eq(schema.locationContact.locationId, locationId), eq(schema.locationContact.current, true), eq(schema.locationContact.receivesInvoices, true)))
    .limit(1);
  const addrs = await db
    .select({ la: schema.locationAddress, a: schema.address })
    .from(schema.locationAddress)
    .innerJoin(schema.address, eq(schema.address.id, schema.locationAddress.addressId))
    .where(and(eq(schema.locationAddress.locationId, locationId), eq(schema.locationAddress.current, true)));
  const billing = addrs.find((x) => x.la.kind === "billing")?.a ?? addrs.find((x) => x.la.kind === "delivery")?.a ?? null;
  const [lic] = await db.select().from(schema.licenseVerification).where(and(eq(schema.licenseVerification.locationId, locationId), eq(schema.licenseVerification.current, true)));
  const metadata: Record<string, string> = { fv_location_id: locationId, fv_market_id: loc.marketId, fv_market: market?.code ?? "", fv_account: loc.legacyAccountId ?? "", fv_kind: loc.kind, fv_pay_by: loc.payBy ?? "" };
  if (lic?.licenseNumber) metadata.fv_license = lic.licenseNumber;
  return {
    loc,
    name: loc.legalName && loc.legalName !== loc.tradeName ? `${loc.tradeName} (${loc.legalName})` : loc.tradeName,
    email: ap[0]?.email ?? null,
    metadata,
    address: billing ? { line1: billing.line1, line2: billing.line2, city: billing.city, state: billing.state, postalCode: billing.postalCode, country: billing.country } : null,
  };
}

async function ensureCustomerHandler(db: Db, payload: Record<string, unknown>) {
  const locationId = String(payload.locationId);
  if (!UUID_RE.test(locationId)) throw new Error("Invalid location id in job payload");
  if (!stripeConfigured()) throw new ProviderUnavailableError("Stripe IMPLEMENTED / NOT CONNECTED — resumes when STRIPE_SECRET_KEY is configured and the connectivity check succeeds");
  const binding = await verifiedStripeAccount(db);
  if (!binding) throw new ProviderUnavailableError("Stripe account not verified for the configured credential — run the connectivity check on the Integrations screen; the work resumes automatically");
  const ref = await customerReference(db, locationId, binding);
  if (!ref) return;
  if (ref.providerId) return; // one effect: already established for this account/mode
  const details = await customerDetails(db, locationId);
  const gw = gateway();
  // Establish prior effect before creating (J27): search by our stable location id in metadata within THIS account.
  const found = await gw.searchCustomers(`metadata['fv_location_id']:'${locationId}'`, 1);
  let customerId: string;
  let evidence: Record<string, unknown>;
  if (found[0]) {
    customerId = found[0].id;
    evidence = { recovered: true, created: found[0].created, accountId: binding.accountId };
  } else {
    const created = await gw.createCustomer({ name: details.name, email: details.email, metadata: details.metadata, address: details.address }, `fv-customer-${binding.environment}-${binding.accountId}-${locationId}`);
    customerId = created.id;
    evidence = { recovered: false, created: created.created, accountId: binding.accountId };
  }
  await db
    .update(schema.providerReference)
    .set({ providerId: customerId, status: "established", environment: binding.environment, providerAccountId: binding.accountId, evidence, lastCheckedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.providerReference.id, ref.id));
  await recordAudit(db, SYSTEM_ACTOR, { action: "stripe.customer.established", subjectType: "customer_location", subjectId: locationId, current: { stripeCustomerId: customerId, ...evidence }, marketId: details.loc.marketId });
}

registerJobHandler(JOB_ENSURE_CUSTOMER, {
  run: ensureCustomerHandler,
  ready: async (db) => stripeConfigured() && (await verifiedStripeAccount(db)) !== null,
});

/**
 * Hosted ACH setup session (Checkout, mode=setup, us_bank_account; card too when the account allows it, B7). Only
 * callable when connected AND the customer is established in the verified account AND the location has an
 * intentionally authorized payer (REV-08). The internal system never touches bank credentials.
 */
export async function createHostedSetupSession(db: DbOrTx, actor: Actor, locationId: string, returnUrl: string, opts: { authorized?: boolean } = {}) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Location not found");
  if (!opts.authorized) authorize(actor, "payment.request_setup", { marketId: loc.marketId });
  const { authorizedPayer } = await import("@/lib/domain/payment/service");
  const payer = await authorizedPayer(db, locationId);
  if (!payer.ok) throw new BusinessError(payer.reason, { code: "payer_not_authorized" });
  const binding = await verifiedStripeAccount(db);
  if (!binding) throw new StripeNotConnectedError("Stripe account is not verified for the configured credential; run the connectivity check first.");
  const ref = await customerReference(db, locationId, binding);
  if (!ref?.providerId) throw new BusinessError("Stripe customer is not established for this location in the connected account yet.");
  const session = await gateway().createSetupSession({
    customer: ref.providerId,
    paymentMethodTypes: loc.cardAllowed ? ["us_bank_account", "card"] : ["us_bank_account"],
    successUrl: `${returnUrl}?setup=complete`,
    cancelUrl: `${returnUrl}?setup=cancelled`,
    metadata: { fv_location_id: locationId, fv_payer_contact_id: payer.payer.contactId },
  });
  await db.insert(schema.providerReference).values({
    provider: "stripe",
    subjectType: "customer_location",
    subjectId: locationId,
    providerObject: "checkout_setup_session",
    providerId: session.id,
    environment: binding.environment,
    providerAccountId: binding.accountId,
    status: "established",
    // The URL is a bearer credential for the payer: kept server-side, shown once to authorized finance users, never in a query string.
    evidence: { url: session.url, expires_at: session.expiresAt, payerContactId: payer.payer.contactId, setupIntent: session.setupIntent },
  });
  await recordAudit(db, actor, { action: "stripe.hosted_setup.created", subjectType: "customer_location", subjectId: locationId, current: { sessionId: session.id, payerContactId: payer.payer.contactId, card: loc.cardAllowed }, marketId: loc.marketId });
  return { url: session.url, sessionId: session.id, payer: payer.payer };
}

/**
 * Webhook signature verification and idempotent event recording, then the financial consequences (Round 4). A
 * webhook is an observation, never the authority for an internal fact: `applyStripeEvent` updates mirrors and opens
 * cases, and marks the event applied / ignored / failed.
 */
export async function receiveStripeWebhook(db: DbOrTx, rawBody: string, signature: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? (stripeGatewayMode() === "fake" ? "fake" : null);
  if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not configured; webhook refused");
  if (!signature) throw new Error("Missing Stripe-Signature header");
  const event = gateway().constructEvent(rawBody, signature, secret);
  const inserted = await db
    .insert(schema.providerEvent)
    .values({
      provider: "stripe",
      eventId: event.id,
      type: event.type,
      occurredAt: new Date(event.created * 1000),
      payload: { type: event.type, livemode: event.livemode, object: (event.data.object as { id?: string }).id ?? null },
      signatureVerified: true,
      outcome: "deferred",
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return { eventId: event.id, type: event.type, duplicate: true, outcome: "duplicate" as const };
  const { applyStripeEvent } = await import("@/lib/domain/collection/webhooks");
  const outcome = await applyStripeEvent(db, event);
  await db.update(schema.providerEvent).set({ processedAt: new Date(), outcome: outcome.outcome }).where(eq(schema.providerEvent.id, inserted[0].id));
  return { eventId: event.id, type: event.type, duplicate: false, outcome: outcome.outcome };
}
