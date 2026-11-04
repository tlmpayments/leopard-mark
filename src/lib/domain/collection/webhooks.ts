/**
 * What Stripe tells the portal (Round 4, S1 to S3, P5, P6, B2 to B4, B8). A webhook is an observation: it updates the
 * mirrors (invoice collection state, payments, the bank on file) and opens cases; it never decides what an invoice says.
 * Every event is recorded once (provider_event) before it is applied; the receiver marks the outcome.
 */
import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { SYSTEM_ACTOR } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { openException, resolveByDedupeKeys } from "@/lib/exceptions/service";
import type { GwEvent } from "@/lib/integrations/stripe/gateway";
import { enqueueJob } from "@/lib/jobs/queue";
import { formatCents } from "@/lib/domain/catalog/service";
import { requestPaymentReceipt } from "./invoices";
import { applyBankRemoved, applySetupIntent } from "./setup";

export interface ApplyOutcome {
  outcome: "applied" | "ignored" | "failed";
  detail?: string;
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && "id" in (v as Obj) ? String((v as Obj).id) : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

async function invoiceForStripe(db: DbOrTx, o: Obj) {
  const meta = (o.metadata ?? {}) as Record<string, string>;
  if (meta.fv_invoice_id) {
    const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, meta.fv_invoice_id));
    if (inv) return inv;
  }
  const id = str(o.id);
  if (!id) return null;
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.stripeInvoiceId, id));
  return inv ?? null;
}

async function invoiceForStripeId(db: DbOrTx, stripeInvoiceId: string | null) {
  if (!stripeInvoiceId) return null;
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.stripeInvoiceId, stripeInvoiceId));
  return inv ?? null;
}

async function locationForCustomer(db: DbOrTx, customerId: string | null, meta: Record<string, string> = {}) {
  if (meta.fv_location_id) return meta.fv_location_id;
  if (!customerId) return null;
  const [ref] = await db
    .select({ subjectId: schema.providerReference.subjectId })
    .from(schema.providerReference)
    .where(and(eq(schema.providerReference.provider, "stripe"), eq(schema.providerReference.providerObject, "customer"), eq(schema.providerReference.providerId, customerId), eq(schema.providerReference.status, "established")));
  return ref?.subjectId ?? null;
}

async function markInvoicePaidFromStripe(db: DbOrTx, inv: typeof schema.invoice.$inferSelect, o: Obj) {
  const outOfBand = o.paid_out_of_band === true || (inv.collectionState === "out_of_band" && inv.status === "paid");
  const now = new Date();
  const pi = str(o.payment_intent) ?? inv.paymentIntentId;
  let payment: typeof schema.payment.$inferSelect | null = null;
  if (!outOfBand) {
    const existing = pi ? await db.select().from(schema.payment).where(eq(schema.payment.stripePaymentIntentId, pi)) : [];
    if (existing[0]) {
      [payment] = await db.update(schema.payment).set({ state: "succeeded", settledAt: now, stripeChargeId: str(o.charge) ?? existing[0].stripeChargeId, updatedAt: now }).where(eq(schema.payment.id, existing[0].id)).returning();
    } else {
      // Paid on the hosted page (a card, or a bank the customer chose there): Stripe is the first to tell us.
      const kind = /card/i.test(String(o.payment_method_types ?? "")) ? "stripe_card" : "stripe_ach";
      [payment] = await db
        .insert(schema.payment)
        .values({ invoiceId: inv.id, locationId: inv.locationId, marketId: inv.marketId, kind, amountCents: num(o.amount_paid) ?? inv.totalCents, state: "succeeded", stripePaymentIntentId: pi, stripeChargeId: str(o.charge), occurredAt: now, settledAt: now, note: "Reported by Stripe" })
        .onConflictDoNothing()
        .returning();
      if (!payment && pi) [payment] = await db.select().from(schema.payment).where(eq(schema.payment.stripePaymentIntentId, pi));
    }
  }
  if (inv.status !== "paid") {
    // issued or processing becomes paid; a void invoice was filtered out by the caller.
    await db
      .update(schema.invoice)
      .set({ status: "paid", paidAt: now, paidVia: payment?.kind ?? inv.paidVia ?? "stripe_ach", collectionState: outOfBand ? "out_of_band" : "paid", stripeStatus: "paid", paymentIntentId: pi, debitScheduledOn: null, failureCode: null, failureMessage: null, updatedAt: now })
      .where(eq(schema.invoice.id, inv.id));
    await recordAudit(db, SYSTEM_ACTOR, { action: "invoice.paid", subjectType: "invoice", subjectId: inv.id, prior: { status: inv.status, collectionState: inv.collectionState }, current: { status: "paid", via: payment?.kind ?? "stripe", paymentIntentId: pi, source: "stripe_webhook" }, marketId: inv.marketId });
  } else {
    await db.update(schema.invoice).set({ stripeStatus: "paid", collectionState: outOfBand ? "out_of_band" : "paid", updatedAt: now }).where(eq(schema.invoice.id, inv.id));
  }
  await resolveByDedupeKeys(db, SYSTEM_ACTOR, [`payment_returned:${inv.id}`, `debit_blocked:${inv.id}`, `collections_overdue:${inv.locationId}`], "Paid in Stripe");
  if (payment && !outOfBand) await requestPaymentReceipt(db, inv.id, payment);
}

async function markPaymentFailed(db: DbOrTx, inv: typeof schema.invoice.$inferSelect, o: Obj, pi: string | null) {
  const err = (o.last_payment_error ?? {}) as Obj;
  const code = String(err.decline_code ?? err.code ?? "payment_failed");
  const message = String(err.message ?? "The bank returned the debit");
  const now = new Date();
  if (pi) {
    const rows = await db.update(schema.payment).set({ state: "failed", failureCode: code, failureMessage: message, updatedAt: now }).where(and(eq(schema.payment.stripePaymentIntentId, pi), eq(schema.payment.state, "processing"))).returning();
    if (!rows.length) {
      const [existing] = await db.select().from(schema.payment).where(eq(schema.payment.stripePaymentIntentId, pi));
      if (!existing) await db.insert(schema.payment).values({ invoiceId: inv.id, locationId: inv.locationId, marketId: inv.marketId, kind: "stripe_ach", amountCents: num(o.amount) ?? inv.totalCents, state: "failed", stripePaymentIntentId: pi, failureCode: code, failureMessage: message, occurredAt: now, note: "Reported by Stripe" }).onConflictDoNothing();
    }
  }
  await db
    .update(schema.invoice)
    .set({ status: inv.status === "processing" ? "issued" : inv.status, collectionState: "failed", failureCode: code, failureMessage: message, failedAt: now, debitScheduledOn: null, updatedAt: now })
    .where(eq(schema.invoice.id, inv.id));
  await recordAudit(db, SYSTEM_ACTOR, { action: "invoice.debit_returned", subjectType: "invoice", subjectId: inv.id, prior: { status: inv.status, collectionState: inv.collectionState }, current: { status: inv.status === "processing" ? "issued" : inv.status, collectionState: "failed", code, message, paymentIntentId: pi }, marketId: inv.marketId });
  const notAuthorised = /R05|R07|R10|R11|R29|R51|not.?authori[sz]ed|revoked/i.test(`${code} ${message}`);
  await openException(db, SYSTEM_ACTOR, {
    category: "payment_returned",
    title: `${inv.number}: debit returned (${code})`,
    cause: `${message}. ${formatCents(inv.totalCents)} stays open; nothing is retried on its own.${notAuthorised ? " The return says the account holder did not authorise it: never re-present; contact the account." : " It may be presented again (twice at most) from the invoice page."}`,
    marketId: inv.marketId,
    locationId: inv.locationId,
    ownerRole: "accounting",
    nextAction: notAuthorised ? "Contact the account; get a new authorisation or collect another way." : "Contact the account, then re-present from the invoice page or collect by check or card.",
    dedupeKey: `payment_returned:${inv.id}`,
    links: [{ subjectType: "invoice", subjectId: inv.id }],
  });
  if (notAuthorised && inv.locationId) await applyBankRemoved(db, { locationId: inv.locationId, paymentMethodId: null, reason: `Debit for ${inv.number} returned ${code}: ${message}` });
}

/** Apply one verified event. Idempotent: the same event twice changes nothing the second time. */
export async function applyStripeEvent(db: DbOrTx, event: GwEvent): Promise<ApplyOutcome> {
  const o = event.data.object as Obj;
  try {
    switch (event.type) {
      case "invoice.paid": {
        const inv = await invoiceForStripe(db, o);
        if (!inv) return { outcome: "ignored", detail: "not a portal invoice" };
        if (inv.status === "void") return { outcome: "ignored", detail: "portal invoice is void" };
        await markInvoicePaidFromStripe(db, inv, o);
        return { outcome: "applied" };
      }
      case "invoice.payment_failed": {
        const inv = await invoiceForStripe(db, o);
        if (!inv) return { outcome: "ignored", detail: "not a portal invoice" };
        await markPaymentFailed(db, inv, o, str(o.payment_intent) ?? inv.paymentIntentId);
        return { outcome: "applied" };
      }
      case "payment_intent.processing": {
        const inv = await invoiceForStripeId(db, str(o.invoice));
        if (!inv) return { outcome: "ignored", detail: "not a portal invoice" };
        const pi = str(o.id);
        await db.insert(schema.payment).values({ invoiceId: inv.id, locationId: inv.locationId, marketId: inv.marketId, kind: "stripe_ach", amountCents: num(o.amount) ?? inv.totalCents, state: "processing", stripePaymentIntentId: pi, occurredAt: new Date(), note: "Reported by Stripe" }).onConflictDoNothing();
        if (inv.status === "issued") await db.update(schema.invoice).set({ status: "processing", collectionState: "processing", paymentIntentId: pi, updatedAt: new Date() }).where(eq(schema.invoice.id, inv.id));
        return { outcome: "applied" };
      }
      case "payment_intent.payment_failed": {
        const inv = await invoiceForStripeId(db, str(o.invoice));
        if (!inv) return { outcome: "ignored", detail: "not a portal invoice" };
        if (inv.collectionState === "failed" && inv.paymentIntentId === str(o.id)) return { outcome: "ignored", detail: "already recorded" };
        await markPaymentFailed(db, inv, o, str(o.id));
        return { outcome: "applied" };
      }
      case "payment_intent.succeeded":
        return { outcome: "ignored", detail: "invoice.paid carries the consequence" };
      case "charge.dispute.created": {
        const pi = str(o.payment_intent);
        const [pay] = pi ? await db.select().from(schema.payment).where(eq(schema.payment.stripePaymentIntentId, pi)) : [];
        const inv = pay?.invoiceId ? (await db.select().from(schema.invoice).where(eq(schema.invoice.id, pay.invoiceId)))[0] : null;
        if (!inv) return { outcome: "ignored", detail: "no portal payment for the disputed charge" };
        await db.update(schema.payment).set({ state: "disputed", updatedAt: new Date() }).where(eq(schema.payment.id, pay.id));
        await db.update(schema.invoice).set({ collectionState: "disputed", updatedAt: new Date() }).where(eq(schema.invoice.id, inv.id));
        await recordAudit(db, SYSTEM_ACTOR, { action: "invoice.disputed", subjectType: "invoice", subjectId: inv.id, current: { disputeId: str(o.id), amount: num(o.amount), reason: o.reason ?? null }, marketId: inv.marketId });
        await openException(db, SYSTEM_ACTOR, {
          category: "payment_dispute",
          title: `${inv.number}: the customer disputes the debit (${formatCents(num(o.amount) ?? pay.amountCents)})`,
          cause: `Stripe dispute ${str(o.id)} (${String(o.reason ?? "no reason given")}). The authorisation on file is the evidence; nothing else is debited for this account until this is settled.`,
          marketId: inv.marketId,
          locationId: inv.locationId,
          ownerRole: "accounting",
          nextAction: "Owner and Daniel: respond in the Stripe dashboard with the mandate evidence, and contact the account.",
          dedupeKey: `payment_dispute:${inv.id}`,
          links: [{ subjectType: "invoice", subjectId: inv.id }],
        });
        return { outcome: "applied" };
      }
      case "charge.refunded": {
        const pi = str(o.payment_intent);
        const [pay] = pi ? await db.select().from(schema.payment).where(eq(schema.payment.stripePaymentIntentId, pi)) : [];
        if (!pay) return { outcome: "ignored", detail: "no portal payment for the refunded charge" };
        await db.update(schema.payment).set({ state: "refunded", updatedAt: new Date() }).where(eq(schema.payment.id, pay.id));
        if (pay.invoiceId) await recordAudit(db, SYSTEM_ACTOR, { action: "invoice.refunded", subjectType: "invoice", subjectId: pay.invoiceId, current: { amountRefunded: num(o.amount_refunded), chargeId: str(o.id) }, marketId: pay.marketId });
        return { outcome: "applied" };
      }
      case "invoice.voided":
      case "invoice.marked_uncollectible": {
        const inv = await invoiceForStripe(db, o);
        if (!inv) return { outcome: "ignored", detail: "not a portal invoice" };
        const status = event.type === "invoice.voided" ? "void" : "uncollectible";
        await db.update(schema.invoice).set({ stripeStatus: status, collectionState: status === "uncollectible" ? "uncollectible" : inv.collectionState, updatedAt: new Date() }).where(eq(schema.invoice.id, inv.id));
        if (status === "void" && inv.status !== "void") {
          await openException(db, SYSTEM_ACTOR, {
            category: "stripe_mismatch",
            title: `${inv.number} was voided in Stripe but is ${inv.status} in the portal`,
            cause: "Someone voided the Stripe copy in the dashboard. The portal invoice is the official one; decide whether to void it too or mirror it again.",
            marketId: inv.marketId,
            locationId: inv.locationId,
            ownerRole: "accounting",
            nextAction: "Void the portal invoice with a reason, or mirror it into Stripe again from the invoice page.",
            dedupeKey: `stripe_mismatch:${inv.id}`,
            links: [{ subjectType: "invoice", subjectId: inv.id }],
          });
        }
        return { outcome: "applied" };
      }
      case "invoice.finalized": {
        const inv = await invoiceForStripe(db, o);
        if (!inv) return { outcome: "ignored", detail: "not a portal invoice" };
        await db.update(schema.invoice).set({ stripeStatus: "open", stripeNumber: str(o.number) ?? inv.stripeNumber, hostedInvoiceUrl: str(o.hosted_invoice_url) ?? inv.hostedInvoiceUrl, stripePdfUrl: str(o.invoice_pdf) ?? inv.stripePdfUrl, updatedAt: new Date() }).where(eq(schema.invoice.id, inv.id));
        return { outcome: "applied" };
      }
      case "checkout.session.completed": {
        if (o.mode !== "setup") return { outcome: "ignored", detail: "not a setup session" };
        const meta = (o.metadata ?? {}) as Record<string, string>;
        const locationId = await locationForCustomer(db, str(o.customer), meta);
        if (!locationId) return { outcome: "ignored", detail: "no portal account for the customer" };
        const setupIntent = str(o.setup_intent);
        if (!setupIntent) return { outcome: "ignored", detail: "no setup intent" };
        const { gateway } = await import("@/lib/integrations/stripe/adapter");
        const si = await gateway().retrieveSetupIntent(setupIntent);
        if (!si) return { outcome: "ignored", detail: "setup intent not found" };
        await applySetupIntent(db, { locationId, setupIntentId: si.id, status: si.status, paymentMethodId: si.paymentMethod, mandateId: si.mandate, nextActionType: si.nextActionType });
        return { outcome: "applied" };
      }
      case "setup_intent.succeeded":
      case "setup_intent.requires_action": {
        const meta = (o.metadata ?? {}) as Record<string, string>;
        const locationId = await locationForCustomer(db, str(o.customer), meta);
        if (!locationId) return { outcome: "ignored", detail: "no portal account for the customer" };
        await applySetupIntent(db, { locationId, setupIntentId: String(o.id), status: String(o.status), paymentMethodId: str(o.payment_method), mandateId: str(o.mandate), nextActionType: ((o.next_action as Obj | null)?.type as string | undefined) ?? null });
        return { outcome: "applied" };
      }
      case "setup_intent.setup_failed": {
        const locationId = await locationForCustomer(db, str(o.customer), (o.metadata ?? {}) as Record<string, string>);
        if (!locationId) return { outcome: "ignored", detail: "no portal account for the customer" };
        const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
        await openException(db, SYSTEM_ACTOR, {
          category: "payment_setup_pending",
          title: `Bank setup failed — ${loc?.tradeName ?? "account"}`,
          cause: String(((o.last_setup_error as Obj | null)?.message as string | undefined) ?? "Stripe reported the setup failed."),
          marketId: loc?.marketId,
          locationId,
          ownerRole: "accounting",
          nextAction: "Send a fresh setup link and tell the payer what went wrong.",
          dedupeKey: `payment_setup_pending:${locationId}`,
          links: [{ subjectType: "customer_location", subjectId: locationId }],
        });
        return { outcome: "applied" };
      }
      case "payment_method.detached": {
        const pmId = str(o.id);
        const [rel] = pmId ? await db.select().from(schema.paymentRelationship).where(and(eq(schema.paymentRelationship.paymentMethodId, pmId), eq(schema.paymentRelationship.current, true))) : [];
        if (!rel) return { outcome: "ignored", detail: "not a bank the portal has on file" };
        await applyBankRemoved(db, { locationId: rel.locationId, paymentMethodId: pmId, reason: "The bank was removed from the customer in Stripe" });
        return { outcome: "applied" };
      }
      case "mandate.updated": {
        if (o.status !== "inactive") return { outcome: "ignored", detail: "mandate still active" };
        const mandateId = str(o.id);
        const [rel] = mandateId ? await db.select().from(schema.paymentRelationship).where(and(eq(schema.paymentRelationship.mandateId, mandateId), eq(schema.paymentRelationship.current, true))) : [];
        if (!rel) return { outcome: "ignored", detail: "not a mandate the portal has on file" };
        await applyBankRemoved(db, { locationId: rel.locationId, paymentMethodId: rel.paymentMethodId, reason: "The ACH authorisation (mandate) became inactive in Stripe" });
        return { outcome: "applied" };
      }
      case "payout.paid":
      case "payout.created":
      case "payout.updated": {
        // Deposit matching (S8): pull the payout and its balance transactions when the cron next runs.
        await enqueueJob(db, "stripe.payouts.sync", { reason: event.type }, { dedupeKey: "stripe.payouts.sync", maxAttempts: 3 });
        return { outcome: "applied" };
      }
      default:
        return { outcome: "ignored", detail: `no consequence for ${event.type}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await openException(db, SYSTEM_ACTOR, {
      category: "stripe_event_failed",
      title: `Stripe event ${event.type} could not be applied`,
      cause: `${message} (event ${event.id}). The portal's mirror may lag Stripe until this is looked at; the nightly reconciliation will also flag any difference.`,
      ownerRole: "accounting",
      nextAction: "Read the event on the Integrations screen and compare the invoice with Stripe.",
      dedupeKey: `stripe_event_failed:${event.id}`,
      links: [{ subjectType: "provider_event", subjectId: event.id }],
    });
    return { outcome: "failed", detail: message };
  }
}
