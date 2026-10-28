import { and, eq, ne } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { withTx, type DbOrTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { openException } from "@/lib/exceptions/service";
import { requestStripeCustomerAssociation } from "@/lib/integrations/stripe/adapter";
import { createNoticeIntent } from "../notices/service";

/**
 * Payment relationship readiness (brief §9, §11). Phase 1 keeps the
 * location-specific relationship, the setup invitation intent and direct
 * customer revocation. Collection, attempts and holds from provider outcomes
 * are phase 3.
 *
 * Payer authority (O04, D06/D08, REV-08/AC17): the AP contact is where
 * invoices go; the PAYER is the person intentionally authorized by
 * Admin/Accounting to set up and authorize payment for THIS location. Shared
 * AP details, shared contacts or a parent never imply payer authority. Every
 * setup path (invitation, hosted session) requires the same intentional
 * assignment.
 */

async function currentRelationship(db: DbOrTx, locationId: string) {
  const [rel] = await db
    .select()
    .from(schema.paymentRelationship)
    .where(and(eq(schema.paymentRelationship.locationId, locationId), eq(schema.paymentRelationship.current, true)))
    .limit(1);
  if (!rel) throw new BusinessError("Payment relationship row missing for location");
  return rel;
}

export interface PayerAuthority {
  contactId: string;
  name: string;
  email: string | null;
  shared: boolean;
}

/**
 * The location's currently authorized payer, or an explanation of what is
 * missing. Authority = the relationship names the contact AND the contact's
 * current association with THIS location carries mayAuthorizePayment AND,
 * when that contact pays for other locations too, the sharing was explicitly
 * authorized.
 */
export async function authorizedPayer(db: DbOrTx, locationId: string): Promise<{ ok: true; payer: PayerAuthority } | { ok: false; reason: string }> {
  const rel = await currentRelationship(db, locationId);
  if (!rel.payerContactId) return { ok: false, reason: "No payer has been assigned for this location. Admin/Accounting must assign payer authority intentionally (it is never inherited from the AP contact)." };
  const [assoc] = await db
    .select({ lc: schema.locationContact, c: schema.contact })
    .from(schema.locationContact)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
    .where(and(eq(schema.locationContact.locationId, locationId), eq(schema.locationContact.contactId, rel.payerContactId), eq(schema.locationContact.current, true)))
    .limit(1);
  if (!assoc) return { ok: false, reason: "The assigned payer is no longer a current contact of this location. Assign payer authority again." };
  if (!assoc.lc.mayAuthorizePayment) return { ok: false, reason: "The assigned contact's payment authority for this location was revoked. Assign payer authority again." };
  const others = await db
    .select({ id: schema.paymentRelationship.id })
    .from(schema.paymentRelationship)
    .where(and(eq(schema.paymentRelationship.payerContactId, rel.payerContactId), eq(schema.paymentRelationship.current, true), ne(schema.paymentRelationship.id, rel.id)));
  const shared = others.length > 0;
  if (shared && !rel.sharedPayerAuthorized) return { ok: false, reason: "This contact pays for another location; shared payer authority must be explicitly authorized with a note (O04)." };
  return { ok: true, payer: { contactId: assoc.c.id, name: assoc.c.name, email: assoc.c.email, shared } };
}

/**
 * Request hosted ACH setup: associates the Stripe customer (queued provider
 * call) and records the invitation as a notice intent for the AUTHORIZED
 * payer. Refused until payer authority has been assigned. Sender allocation
 * is D32/IG04 → recorded as manual-pending. Repeating the request reuses the
 * pending invitation rather than inserting another one.
 */
export async function requestPaymentSetup(db: DbOrTx, actor: Actor, locationId: string, payerContactId?: string | null) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "payment.request_setup", { marketId: loc.marketId });
  if (loc.status === "closed") throw new BusinessError("The location is closed; no new payment setup.");
  return withTx(db, async (tx) => {
    const rel = await currentRelationship(tx, locationId);
    if (payerContactId && payerContactId !== rel.payerContactId) {
      throw new BusinessError("That contact is not this location's assigned payer. Assign payer authority first (an explicit, audited act), then request setup.", { field: "payerContactId", code: "payer_not_authorized" });
    }
    const auth = await authorizedPayer(tx, locationId);
    if (!auth.ok) throw new BusinessError(auth.reason, { code: "payer_not_authorized" });
    await requestStripeCustomerAssociation(tx, actor, locationId);
    const [row] = await tx
      .update(schema.paymentRelationship)
      .set({
        channel: rel.channel === "unselected" ? "stripe_ach" : rel.channel,
        setupState: rel.setupState === "not_requested" ? "requested" : rel.setupState,
        setupRequestedAt: rel.setupRequestedAt ?? new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentRelationship.id, rel.id))
      .returning();
    const notice = await createNoticeIntent(tx, actor, {
      purpose: "payment_setup_invitation",
      subjectType: "customer_location",
      subjectId: locationId,
      marketId: loc.marketId,
      locationId,
      recipientEmail: auth.payer.email,
      recipientContactId: auth.payer.contactId,
      content: {
        subject: `${loc.tradeName}: set up ACH payment with Familiar Ventures`,
        summary: `Invite ${auth.payer.name} (authorized payer for ${loc.tradeName}) to complete Stripe-hosted ACH setup. Bank details are entered only on Stripe's hosted page; the hosted link is issued separately by Accounting once the Stripe customer is established. Gmail never collects bank details.`,
      },
    });
    await recordAudit(tx, actor, {
      action: "payment.request_setup",
      subjectType: "customer_location",
      subjectId: locationId,
      prior: { channel: rel.channel, setupState: rel.setupState },
      current: { channel: row.channel, setupState: row.setupState, payerContactId: auth.payer.contactId, noticeId: notice.notice.id, noticeReused: !notice.created },
      marketId: loc.marketId,
    });
    await openException(tx, actor, {
      category: "payment_setup_pending",
      title: `ACH setup pending — ${loc.tradeName}`,
      cause: "Setup invitation intended; hosted setup not yet completed. First delivery may proceed (O09); second delivery depends on D01.",
      marketId: loc.marketId,
      locationId,
      ownerRole: "accounting",
      nextAction: "Send the invitation through the authorized manual process and record the outcome on the notice; follow up with the payer.",
      dedupeKey: `payment_setup_pending:${locationId}`,
      links: [
        { subjectType: "customer_location", subjectId: locationId },
        { subjectType: "notice", subjectId: notice.notice.id },
      ],
    });
    return { relationship: row, notice: notice.notice, noticeReused: !notice.created };
  });
}

/** Direct customer revocation received internally: new debits prohibited immediately (brief §11). */
export async function recordDirectRevocation(db: DbOrTx, actor: Actor, locationId: string, evidence: string) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "payment.record_direct_revocation", { marketId: loc.marketId });
  if (!evidence.trim()) throw new BusinessError("Evidence of the customer's instruction is required", { field: "evidence" });
  const rel = await currentRelationship(db, locationId);
  if (rel.directRevocationAt) throw new StaleStateError(`A direct revocation is already recorded (${rel.directRevocationAt.toISOString().slice(0, 10)}).`);
  const [row] = await db
    .update(schema.paymentRelationship)
    .set({ directRevocationAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.paymentRelationship.id, rel.id))
    .returning();
  await recordAudit(db, actor, {
    action: "payment.direct_revocation",
    subjectType: "customer_location",
    subjectId: locationId,
    prior: { directRevocationAt: rel.directRevocationAt },
    current: { directRevocationAt: row.directRevocationAt },
    reason: evidence,
    marketId: loc.marketId,
  });
  await openException(db, actor, {
    category: "payment_revocation",
    title: `Customer revoked payment authorization — ${loc.tradeName}`,
    cause: evidence,
    marketId: loc.marketId,
    locationId,
    ownerRole: "accounting",
    nextAction: "Stop new debits (effective now); coordinate Stripe follow-through; preserve in-flight attempts and determine actual outcome (J07).",
    dedupeKey: `payment_revocation:${locationId}`,
    links: [{ subjectType: "customer_location", subjectId: locationId }],
  });
  return row;
}

/**
 * Set the intentional payer authority for a location (D06/D08 keep approval
 * rules open; this records an explicit Admin/Accounting act with audit). The
 * contact must be a CURRENT contact of THIS location; a contact that already
 * pays for another location needs an explicit shared-payer note.
 */
export async function setPayerContact(db: DbOrTx, actor: Actor, locationId: string, contactId: string, sharedPayerNote?: string) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "payment.request_setup", { marketId: loc.marketId });
  return withTx(db, async (tx) => {
    const rel = await currentRelationship(tx, locationId);
    const [assoc] = await tx
      .select()
      .from(schema.locationContact)
      .where(and(eq(schema.locationContact.locationId, locationId), eq(schema.locationContact.contactId, contactId), eq(schema.locationContact.current, true)))
      .limit(1);
    if (!assoc) throw new BusinessError("Payer authority can only be given to a current contact of this location. Add the person as a contact first.", { field: "contactId", code: "payer_not_authorized" });
    // Shared payer across locations must be explicit (O04).
    const otherUse = await tx
      .select({ id: schema.paymentRelationship.id })
      .from(schema.paymentRelationship)
      .where(and(eq(schema.paymentRelationship.payerContactId, contactId), eq(schema.paymentRelationship.current, true), ne(schema.paymentRelationship.id, rel.id)));
    const shared = otherUse.length > 0;
    if (shared && !sharedPayerNote?.trim()) {
      throw new BusinessError("This contact already acts as payer for another location. Shared payer authority must be explicitly authorized with a note (O04).", { field: "sharedPayerNote" });
    }
    // Only one contact carries payment authority for the location at a time.
    if (rel.payerContactId && rel.payerContactId !== contactId) {
      await tx
        .update(schema.locationContact)
        .set({ mayAuthorizePayment: false })
        .where(and(eq(schema.locationContact.locationId, locationId), eq(schema.locationContact.contactId, rel.payerContactId), eq(schema.locationContact.current, true)));
    }
    const [row] = await tx
      .update(schema.paymentRelationship)
      .set({ payerContactId: contactId, sharedPayerAuthorized: shared, sharedPayerNote: shared ? sharedPayerNote?.trim() : null, payerAssignedAt: new Date(), payerAssignedByEmployeeId: actor.employeeId, updatedAt: new Date() })
      .where(eq(schema.paymentRelationship.id, rel.id))
      .returning();
    await tx.update(schema.locationContact).set({ mayAuthorizePayment: true }).where(eq(schema.locationContact.id, assoc.id));
    await recordAudit(tx, actor, {
      action: "payment.set_payer",
      subjectType: "customer_location",
      subjectId: locationId,
      prior: { payerContactId: rel.payerContactId },
      current: { payerContactId: contactId, sharedPayerAuthorized: shared },
      reason: sharedPayerNote ?? null,
      marketId: loc.marketId,
    });
    return row;
  });
}

/** Revoke the location's payer authority (a change in authority stops every setup path until re-assigned). */
export async function clearPayerContact(db: DbOrTx, actor: Actor, locationId: string, reason: string) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "payment.request_setup", { marketId: loc.marketId });
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  return withTx(db, async (tx) => {
    const rel = await currentRelationship(tx, locationId);
    if (!rel.payerContactId) throw new StaleStateError("No payer is assigned.");
    await tx
      .update(schema.locationContact)
      .set({ mayAuthorizePayment: false })
      .where(and(eq(schema.locationContact.locationId, locationId), eq(schema.locationContact.contactId, rel.payerContactId), eq(schema.locationContact.current, true)));
    const [row] = await tx
      .update(schema.paymentRelationship)
      .set({ payerContactId: null, sharedPayerAuthorized: false, sharedPayerNote: null, payerAssignedAt: null, payerAssignedByEmployeeId: null, updatedAt: new Date() })
      .where(eq(schema.paymentRelationship.id, rel.id))
      .returning();
    await recordAudit(tx, actor, { action: "payment.clear_payer", subjectType: "customer_location", subjectId: locationId, prior: { payerContactId: rel.payerContactId }, current: { payerContactId: null }, reason, marketId: loc.marketId });
    return row;
  });
}
