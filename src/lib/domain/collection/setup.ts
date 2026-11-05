/**
 * Bank setup through Stripe's hosted page (Round 4, B1 to B6, B8). The link is created when the approved email runs
 * (or when a person generates it to send by hand), never stored ahead of time; the hosted page collects the bank
 * details, and Stripe tells the portal by webhook what happened. The portal keeps only masked facts: bank name, last
 * four, verification state, the mandate reference.
 */
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { SYSTEM_ACTOR, type Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { baseUrl } from "@/lib/env";
import { BusinessError } from "@/lib/errors";
import { openException, resolveByDedupeKeys } from "@/lib/exceptions/service";
import { gateway, stripeConfigured } from "@/lib/integrations/stripe/adapter";
import { authorizedPayer } from "@/lib/domain/payment/service";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { requestApproval, type EmailPayload } from "@/lib/domain/approvals/service";
import { ensureStripeCustomer } from "./customers";

export const SETUP_CHASE_DAYS = 5;

async function relationship(db: DbOrTx, locationId: string) {
  const [rel] = await db.select().from(schema.paymentRelationship).where(and(eq(schema.paymentRelationship.locationId, locationId), eq(schema.paymentRelationship.current, true)));
  if (!rel) throw new BusinessError("Payment relationship row missing for location");
  return rel;
}

/**
 * Queue the bank setup email to the account's authorised payer (B1). The Stripe customer is created now if needed; the
 * hosted link itself is generated when the email runs (auto) or when a person asks for it to send by hand.
 */
export async function requestBankSetupLink(db: DbOrTx, actor: Actor, locationId: string) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "payment.request_setup", { marketId: loc.marketId });
  if (loc.status === "closed") throw new BusinessError("The location is closed; no new payment setup.");
  if (!stripeConfigured()) throw new BusinessError("Stripe is not connected; the setup link needs the live Stripe account.", { code: "provider_not_connected" });
  const payer = await authorizedPayer(db, locationId);
  if (!payer.ok) throw new BusinessError(payer.reason, { code: "payer_not_authorized" });
  if (!payer.payer.email) throw new BusinessError("The payer has no email address on file; add one to the contact first.");
  await ensureStripeCustomer(db, actor, locationId);
  const settings = await getCompanySettings(db);
  const rel = await relationship(db, locationId);
  const returnUrl = `${baseUrl()}/customer/setup`;
  const payload: EmailPayload = {
    to: [payer.payer.email],
    subject: `${loc.tradeName}: set up ACH payments with ${settings.dba}`,
    body: [
      `Hello ${payer.payer.name},`,
      "",
      `Please connect the bank account that will pay ${settings.dba} invoices for ${loc.tradeName}. The link below opens Stripe's secure page; bank details are entered there and never reach us.`,
      "",
      "{setup_link}",
      "",
      `Invoices are debited on their due date${loc.cardAllowed ? "; a card can be used instead when you prefer" : ""}. Reply to this email with any question.`,
      "",
      settings.dba,
      settings.customerSenderAddress,
    ].join("\n"),
    setupLink: { locationId, returnUrl },
  };
  const r = await requestApproval(db, actor, {
    kind: "email",
    purpose: "payment_setup_link",
    sender: "orders@",
    title: `Bank setup link to ${payer.payer.name} (${loc.tradeName})`,
    summary: `Stripe-hosted ACH setup for ${loc.tradeName}; the link is generated when this is sent.`,
    payload: payload as unknown as Record<string, unknown>,
    subjectType: "customer_location",
    subjectId: locationId,
    marketId: loc.marketId,
    locationId,
    dedupeKey: `payment_setup_link:${locationId}`,
  });
  await db
    .update(schema.paymentRelationship)
    .set({ channel: rel.channel === "unselected" ? "stripe_ach" : rel.channel, setupState: rel.setupState === "not_requested" ? "requested" : rel.setupState, setupRequestedAt: rel.setupRequestedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(schema.paymentRelationship.id, rel.id));
  await recordAudit(db, actor, { action: "payment.setup_link_requested", subjectType: "customer_location", subjectId: locationId, current: { approvalItemId: r.item.id, reused: !r.created, to: payer.payer.email }, marketId: loc.marketId });
  await openException(db, actor, {
    category: "payment_setup_pending",
    title: `ACH setup pending — ${loc.tradeName}`,
    cause: "Setup link queued for approval; the bank is not connected yet. First delivery may proceed (O09); the second-delivery warning applies.",
    marketId: loc.marketId,
    locationId,
    ownerRole: "accounting",
    nextAction: "Approve the setup email on the Approvals screen (or send the link by hand and record it), then follow up with the payer.",
    dedupeKey: `payment_setup_pending:${locationId}`,
    links: [{ subjectType: "customer_location", subjectId: locationId }, { subjectType: "approval_item", subjectId: r.item.id }],
  });
  return r;
}

/** Record that the setup email went (the approval item completed), so the chase sweep knows when to start counting. */
export async function markSetupLinkSent(db: DbOrTx, locationId: string) {
  const rel = await relationship(db, locationId);
  await db.update(schema.paymentRelationship).set({ setupLinkSentAt: new Date(), updatedAt: new Date() }).where(eq(schema.paymentRelationship.id, rel.id));
}

export interface BankOnFileInput {
  paymentMethodId: string;
  bankName: string | null;
  last4: string | null;
  mandateId: string | null;
  verified: boolean;
  source: "hosted_setup" | "ach_app" | "webhook";
}

/**
 * The bank Stripe reports for the account (B2, B4): masked facts only. Sets it as the customer's default (B3) and
 * resolves the pending-setup case when verified.
 */
export async function recordBankOnFile(db: DbOrTx, actor: Actor, locationId: string, input: BankOnFileInput) {
  const rel = await relationship(db, locationId);
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  const now = new Date();
  const [row] = await db
    .update(schema.paymentRelationship)
    .set({
      channel: rel.channel === "unselected" ? "stripe_ach" : rel.channel,
      setupState: input.verified ? "method_usable" : "pending_verification",
      paymentMethodId: input.paymentMethodId,
      bankName: input.bankName,
      bankLast4: input.last4,
      mandateId: input.mandateId ?? rel.mandateId,
      mandateAcceptedAt: input.mandateId ? (rel.mandateId === input.mandateId ? rel.mandateAcceptedAt : now) : rel.mandateAcceptedAt,
      verificationState: input.verified ? "verified" : "pending_microdeposits",
      methodVerifiedAt: input.verified ? now : null,
      directRevocationAt: null,
      lastProviderEvidence: { source: input.source, paymentMethodId: input.paymentMethodId, bankName: input.bankName, last4: input.last4 },
      lastProviderEvidenceAt: now,
      updatedAt: now,
    })
    .where(eq(schema.paymentRelationship.id, rel.id))
    .returning();
  await recordAudit(db, actor, { action: input.verified ? "payment.bank_verified" : "payment.bank_pending", subjectType: "customer_location", subjectId: locationId, prior: { setupState: rel.setupState, bankLast4: rel.bankLast4 }, current: { setupState: row.setupState, bankName: input.bankName, bankLast4: input.last4, source: input.source }, marketId: loc?.marketId });
  if (input.verified) {
    await resolveByDedupeKeys(db, actor, [`payment_setup_pending:${locationId}`, `payment_setup_unfinished:${locationId}`, `payment_setup_missing:${locationId}`, `payment_revocation:${locationId}`], `Bank on file: ${input.bankName ?? "bank"} ending ${input.last4 ?? "????"}`);
  }
  return row;
}

/** Stripe reports the setup intent's outcome (checkout.session.completed, setup_intent.succeeded / requires_action). */
export async function applySetupIntent(db: DbOrTx, input: { locationId: string; setupIntentId: string; status: string; paymentMethodId: string | null; mandateId: string | null; nextActionType: string | null }) {
  const gw = gateway();
  if (!input.paymentMethodId) return;
  const pm = await gw.retrievePaymentMethod(input.paymentMethodId);
  const verified = input.status === "succeeded";
  const bank = pm?.usBankAccount ?? null;
  await recordBankOnFile(db, SYSTEM_ACTOR, input.locationId, { paymentMethodId: input.paymentMethodId, bankName: bank?.bankName ?? (pm?.card ? `${pm.card.brand ?? "card"} card` : null), last4: bank?.last4 ?? pm?.card?.last4 ?? null, mandateId: input.mandateId, verified, source: "hosted_setup" });
  if (verified) {
    // B3: the new bank becomes the customer's default so debits need no further choice.
    const { stripeCustomerIdFor } = await import("@/lib/integrations/stripe/adapter");
    const customerId = await stripeCustomerIdFor(db, input.locationId);
    if (customerId) {
      await gw.updateCustomer(customerId, { defaultPaymentMethod: input.paymentMethodId });
      const rel = await relationship(db, input.locationId);
      await db.update(schema.paymentRelationship).set({ defaultSetAt: new Date(), updatedAt: new Date() }).where(eq(schema.paymentRelationship.id, rel.id));
    }
  } else if (input.nextActionType === "verify_with_microdeposits") {
    const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
    await openException(db, SYSTEM_ACTOR, {
      category: "payment_setup_pending",
      title: `Bank waiting on test deposits — ${loc?.tradeName ?? "account"}`,
      cause: "The payer entered the bank by routing and account number; Stripe sent two test deposits that the payer must confirm before the bank can be debited.",
      marketId: loc?.marketId,
      locationId: input.locationId,
      ownerRole: "accounting",
      nextAction: "Follow up with the payer in a few days to confirm the deposit amounts on Stripe's page.",
      dedupeKey: `payment_setup_pending:${input.locationId}`,
      links: [{ subjectType: "customer_location", subjectId: input.locationId }],
    });
  }
}

/** The customer's bank was removed or the mandate went inactive (B8): new debits stop, a case opens, the account is flagged. */
export async function applyBankRemoved(db: DbOrTx, input: { locationId: string; paymentMethodId: string | null; reason: string }) {
  const rel = await relationship(db, input.locationId);
  if (input.paymentMethodId && rel.paymentMethodId && rel.paymentMethodId !== input.paymentMethodId) return; // a different method; nothing on file changed
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
  await db
    .update(schema.paymentRelationship)
    .set({ setupState: "revoked", verificationState: "failed", directRevocationAt: new Date(), lastProviderEvidence: { reason: input.reason, paymentMethodId: input.paymentMethodId }, lastProviderEvidenceAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.paymentRelationship.id, rel.id));
  await recordAudit(db, SYSTEM_ACTOR, { action: "payment.bank_removed", subjectType: "customer_location", subjectId: input.locationId, prior: { setupState: rel.setupState, bankLast4: rel.bankLast4 }, current: { setupState: "revoked", reason: input.reason }, marketId: loc?.marketId });
  await openException(db, SYSTEM_ACTOR, {
    category: "payment_revocation",
    title: `Bank removed or authorisation revoked — ${loc?.tradeName ?? "account"}`,
    cause: `${input.reason}. No further debits run for this account until a bank is connected again; in-flight debits keep their outcome.`,
    marketId: loc?.marketId,
    locationId: input.locationId,
    ownerRole: "accounting",
    nextAction: "Contact the account, send a new setup link, and decide whether deliveries wait for payment.",
    dedupeKey: `payment_revocation:${input.locationId}`,
    links: [{ subjectType: "customer_location", subjectId: input.locationId }],
  });
}

/** B6: a setup link sent days ago with no bank on file opens a chase case; resolved when the bank arrives. */
export async function chaseUnfinishedSetups(db: DbOrTx, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - SETUP_CHASE_DAYS * 86_400_000);
  const rows = await db
    .select({ rel: schema.paymentRelationship, loc: schema.customerLocation })
    .from(schema.paymentRelationship)
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.paymentRelationship.locationId))
    .where(and(eq(schema.paymentRelationship.current, true), lt(schema.paymentRelationship.setupLinkSentAt, cutoff), isNull(schema.paymentRelationship.methodVerifiedAt), sql`${schema.paymentRelationship.setupState} in ('requested','pending_verification')`));
  let opened = 0;
  for (const { rel, loc } of rows) {
    const days = Math.floor((now.getTime() - rel.setupLinkSentAt!.getTime()) / 86_400_000);
    await openException(db, SYSTEM_ACTOR, {
      category: "payment_setup_unfinished",
      title: `${loc.tradeName}: bank setup not finished after ${days} days`,
      cause: rel.setupState === "pending_verification" ? "The payer entered the bank but has not confirmed the two test deposits." : "The setup link went out and the payer has not connected a bank.",
      marketId: loc.marketId,
      locationId: loc.id,
      ownerRole: "accounting",
      nextAction: "Call or email the payer; send a fresh link if the old one expired.",
      dedupeKey: `payment_setup_unfinished:${loc.id}`,
      links: [{ subjectType: "customer_location", subjectId: loc.id }],
    });
    opened += 1;
  }
  return { opened };
}

/** What the account page shows (B2): the bank on file, or where setup stands. */
export function describeBank(rel: typeof schema.paymentRelationship.$inferSelect | null | undefined): string {
  if (!rel) return "No bank on file";
  if (rel.setupState === "revoked") return `Bank removed${rel.bankLast4 ? ` (was ending ${rel.bankLast4})` : ""}; new debits stopped`;
  if (rel.verificationState === "verified" && rel.bankLast4) return `${rel.bankName ?? "Bank"} ending ${rel.bankLast4}, verified${rel.methodVerifiedAt ? ` ${rel.methodVerifiedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}`;
  if (rel.verificationState === "pending_microdeposits") return `${rel.bankName ?? "Bank"} ending ${rel.bankLast4 ?? "????"}, waiting on test deposits`;
  if (rel.setupLinkSentAt) return "Setup link sent, waiting on the payer";
  if (rel.setupState === "requested") return "Setup link queued for approval";
  return "No bank on file";
}
