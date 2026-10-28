import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { marketScopeFor, type Actor } from "@/lib/authz/actor";
import { authorize, can } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { withTx, type DbOrTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { openException, resolveByDedupeKeys } from "@/lib/exceptions/service";
import { getPolicy } from "@/lib/policy/policy";

/**
 * Customer locations (brief §7, §9, O04–O07).
 *
 * - Sales creates locations without preapproval or underwriting.
 * - Minimal entry: trade name, delivery/billing addresses, buyer & AP
 *   name/email, delivery instructions. Legal name optional (enriched later).
 * - Identical trade names are legitimate; duplicate detection only warns.
 * - Billing-email changes require Admin approval.
 */

export interface AddressInput {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
  /** "same as delivery" reuse marker for billing (R55). */
  sameAsDelivery?: boolean;
}

export interface ContactInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  /** Reuse an existing contact by id (R55) instead of creating one. */
  existingContactId?: string | null;
}

export interface CreateLocationInput {
  marketId: string;
  tradeName: string;
  legalName?: string | null;
  parentId?: string | null;
  deliveryAddress: AddressInput;
  billingAddress?: AddressInput | null;
  buyer: ContactInput;
  ap?: ContactInput | null;
  deliveryInstructions?: string | null;
  receivingRestrictions?: string | null;
  /** Explicit acknowledgement that a similar-name warning was seen (not required). */
  acknowledgedSimilarNames?: boolean;
}

export interface SimilarLocation {
  id: string;
  tradeName: string;
  marketId: string;
  status: string;
}

/** Escape LIKE/ILIKE wildcards in user input so a name containing % or _ matches literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Warn-only duplicate detection (O06). Never blocks. */
export async function findSimilarLocations(db: DbOrTx, marketId: string, tradeName: string): Promise<SimilarLocation[]> {
  const needle = escapeLike(tradeName.trim());
  if (needle.length < 3) return [];
  return db
    .select({
      id: schema.customerLocation.id,
      tradeName: schema.customerLocation.tradeName,
      marketId: schema.customerLocation.marketId,
      status: schema.customerLocation.status,
    })
    .from(schema.customerLocation)
    .where(and(eq(schema.customerLocation.marketId, marketId), ilike(schema.customerLocation.tradeName, `%${needle}%`)))
    .limit(10);
}

async function upsertContact(db: DbOrTx, input: ContactInput) {
  if (input.existingContactId) {
    const [c] = await db.select().from(schema.contact).where(eq(schema.contact.id, input.existingContactId));
    if (!c) throw new BusinessError("Contact to reuse not found");
    return { contact: c, reused: true };
  }
  const email = input.email?.trim().toLowerCase() || null;
  if (email) {
    // Reuse an identical confirmed contact (same name + email) rather than duplicating it.
    const [existing] = await db
      .select()
      .from(schema.contact)
      .where(and(eq(schema.contact.email, email), ilike(schema.contact.name, input.name.trim())))
      .limit(1);
    if (existing) return { contact: existing, reused: true };
  }
  const [c] = await db
    .insert(schema.contact)
    .values({ name: input.name.trim(), email, phone: input.phone?.trim() || null })
    .returning();
  return { contact: c, reused: false };
}

async function insertAddress(db: DbOrTx, actor: Actor, a: AddressInput) {
  const [row] = await db
    .insert(schema.address)
    .values({
      line1: a.line1.trim(),
      line2: a.line2?.trim() || null,
      city: a.city.trim(),
      state: a.state.trim().toUpperCase(),
      postalCode: a.postalCode.trim(),
      country: a.country ?? "US",
      provenance: can(actor, "location.billing_email.approve") ? "admin_entered" : "sales_entered",
      createdByEmployeeId: actor.employeeId,
    })
    .returning();
  return row;
}

export async function createLocation(db: DbOrTx, actor: Actor, input: CreateLocationInput) {
  authorize(actor, "location.create", { marketId: input.marketId });
  const tradeName = input.tradeName.trim();
  if (!tradeName) throw new BusinessError("Trade name is required");
  if (!input.buyer?.name?.trim() && !input.buyer?.existingContactId) throw new BusinessError("A buyer contact is required");
  return withTx(db, async (tx) => {
    const [market] = await tx.select().from(schema.market).where(eq(schema.market.id, input.marketId));
    if (!market) throw new BusinessError("Market not found");
    const similar = await findSimilarLocations(tx, input.marketId, tradeName);

    const [loc] = await tx
      .insert(schema.customerLocation)
      .values({
        marketId: input.marketId,
        tradeName,
        legalName: input.legalName?.trim() || null,
        parentId: input.parentId ?? null,
        deliveryInstructions: input.deliveryInstructions?.trim() || null,
        receivingRestrictions: input.receivingRestrictions?.trim() || null,
        originatingRepEmployeeId: actor.employeeId,
        currentRepEmployeeId: actor.employeeId,
        createdByEmployeeId: actor.employeeId,
      })
      .returning();
    if (actor.employeeId) {
      await tx.insert(schema.locationRepHistory).values({ locationId: loc.id, employeeId: actor.employeeId, reason: "originating" });
    }

    const delivery = await insertAddress(tx, actor, input.deliveryAddress);
    await tx.insert(schema.locationAddress).values({ locationId: loc.id, addressId: delivery.id, kind: "delivery" });
    const billingSame = !input.billingAddress || input.billingAddress.sameAsDelivery;
    const billing = billingSame ? delivery : await insertAddress(tx, actor, input.billingAddress as AddressInput);
    await tx.insert(schema.locationAddress).values({ locationId: loc.id, addressId: billing.id, kind: "billing" });

    const buyer = await upsertContact(tx, input.buyer);
    await tx.insert(schema.locationContact).values({
      locationId: loc.id,
      contactId: buyer.contact.id,
      contactRole: "buyer",
      mayOrder: true,
      receivesInvoices: !input.ap,
      mayAuthorizePayment: false,
    });
    if (input.ap && (input.ap.name?.trim() || input.ap.existingContactId)) {
      const ap = await upsertContact(tx, input.ap);
      await tx.insert(schema.locationContact).values({
        locationId: loc.id,
        contactId: ap.contact.id,
        contactRole: "ap",
        mayOrder: false,
        receivesInvoices: true,
        mayAuthorizePayment: false, // payer authority is intentional (D06/D08); set by Admin/Accounting
      });
    }

    // Verification and payment readiness start pending; capture proceeds (O07/O09).
    await tx.insert(schema.licenseVerification).values({ locationId: loc.id, state: "unverified" });
    // Payer authority is never inherited from the AP destination (O04/D08, REV-08): Admin/Accounting assigns it deliberately.
    await tx.insert(schema.paymentRelationship).values({ locationId: loc.id, channel: "unselected", setupState: "not_requested", payerContactId: null });
    await tx.insert(schema.cleaningObligation).values({ locationId: loc.id, applicable: "unknown" });

    await recordAudit(tx, actor, {
      action: "location.create",
      subjectType: "customer_location",
      subjectId: loc.id,
      current: { tradeName, marketId: input.marketId, parentId: input.parentId ?? null, similarNamesWarned: similar.length },
      marketId: input.marketId,
    });

    // Aging work for Admin (brief §41): incomplete verification is visible, never blocking capture.
    await openException(tx, actor, {
      category: "license_unverified",
      title: `License verification pending — ${tradeName}`,
      cause: "New location created; company verifies license internally before first delivery where applicable (O07).",
      marketId: input.marketId,
      locationId: loc.id,
      ownerRole: "admin",
      nextAction: "Locate and verify the license; record the decision on the location.",
      dedupeKey: `license_unverified:${loc.id}`,
      links: [{ subjectType: "customer_location", subjectId: loc.id }],
    });

    return { location: loc, similar, buyerReused: buyer.reused };
  });
}

export async function getLocation(db: DbOrTx, locationId: string) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) return null;
  const [market] = await db.select().from(schema.market).where(eq(schema.market.id, loc.marketId));
  const addresses = await db
    .select({ la: schema.locationAddress, a: schema.address })
    .from(schema.locationAddress)
    .innerJoin(schema.address, eq(schema.address.id, schema.locationAddress.addressId))
    .where(and(eq(schema.locationAddress.locationId, locationId), eq(schema.locationAddress.current, true)));
  const contacts = await db
    .select({ lc: schema.locationContact, c: schema.contact })
    .from(schema.locationContact)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
    .where(and(eq(schema.locationContact.locationId, locationId), eq(schema.locationContact.current, true)));
  const [license] = await db
    .select()
    .from(schema.licenseVerification)
    .where(and(eq(schema.licenseVerification.locationId, locationId), eq(schema.licenseVerification.current, true)))
    .orderBy(desc(schema.licenseVerification.createdAt))
    .limit(1);
  const [payment] = await db
    .select()
    .from(schema.paymentRelationship)
    .where(and(eq(schema.paymentRelationship.locationId, locationId), eq(schema.paymentRelationship.current, true)))
    .limit(1);
  const holds = await db.select().from(schema.hold).where(and(eq(schema.hold.locationId, locationId), eq(schema.hold.active, true)));
  const overrides = await db
    .select()
    .from(schema.holdOverride)
    .where(and(eq(schema.holdOverride.locationId, locationId), sql`${schema.holdOverride.withdrawnAt} is null`));
  const parent = loc.parentId ? (await db.select().from(schema.customerParent).where(eq(schema.customerParent.id, loc.parentId)))[0] : null;
  const pendingBillingRequests = await db
    .select()
    .from(schema.billingEmailChangeRequest)
    .where(and(eq(schema.billingEmailChangeRequest.locationId, locationId), eq(schema.billingEmailChangeRequest.state, "pending")));
  return {
    location: loc,
    market,
    parent,
    delivery: addresses.find((x) => x.la.kind === "delivery")?.a ?? null,
    billing: addresses.find((x) => x.la.kind === "billing")?.a ?? null,
    contacts: contacts.map((x) => ({ ...x.lc, contact: x.c })),
    license: license ?? null,
    payment: payment ?? null,
    holds,
    overrides,
    pendingBillingRequests,
  };
}

/** Roles that may list accounts market-wide (Driver/Service sees only assigned execution context — REV-11). */
export const LOCATION_VIEW_ROLES = ["owner", "admin", "accounting", "sales"] as const;

export async function listLocations(
  db: DbOrTx,
  actor: Actor,
  opts: { marketId?: string; q?: string; status?: string; limit?: number; offset?: number; withAddress?: boolean } = {},
) {
  const scope = marketScopeFor(actor, [...LOCATION_VIEW_ROLES]);
  const conds = [];
  if (actor.kind !== "system" && !actor.grants.some((g) => g.role === "owner") && scope !== "all") {
    if (scope.length === 0) return [];
    conds.push(inArray(schema.customerLocation.marketId, scope));
  }
  if (opts.marketId) conds.push(eq(schema.customerLocation.marketId, opts.marketId));
  if (opts.status) conds.push(eq(schema.customerLocation.status, opts.status as never));
  if (opts.q) conds.push(or(ilike(schema.customerLocation.tradeName, `%${escapeLike(opts.q)}%`), ilike(schema.address.line1, `%${escapeLike(opts.q)}%`), ilike(schema.address.city, `%${escapeLike(opts.q)}%`))!);
  const rows = await db
    .select({ loc: schema.customerLocation, market: schema.market, address: schema.address })
    .from(schema.customerLocation)
    .innerJoin(schema.market, eq(schema.market.id, schema.customerLocation.marketId))
    .leftJoin(schema.locationAddress, and(eq(schema.locationAddress.locationId, schema.customerLocation.id), eq(schema.locationAddress.kind, "delivery"), eq(schema.locationAddress.current, true)))
    .leftJoin(schema.address, eq(schema.address.id, schema.locationAddress.addressId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(schema.customerLocation.tradeName, schema.customerLocation.createdAt)
    .limit(opts.limit ?? 500)
    .offset(opts.offset ?? 0);
  return rows;
}

export interface OperationalEditInput {
  deliveryInstructions?: string | null;
  receivingRestrictions?: string | null;
  legalName?: string | null;
  tradeName?: string;
}

/** Sales may edit permitted operational information; material edits are audited (O06). */
export async function editOperational(db: DbOrTx, actor: Actor, locationId: string, input: OperationalEditInput, reason?: string) {
  const [prior] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!prior) throw new BusinessError("Location not found");
  authorize(actor, "location.edit_operational", { marketId: prior.marketId });
  const identityChange = (input.tradeName !== undefined && input.tradeName.trim() && input.tradeName.trim() !== prior.tradeName) || (input.legalName !== undefined && (input.legalName?.trim() || null) !== prior.legalName);
  if (identityChange) {
    // Trade/legal-name changes can mean a new operator or premises (D07): Admin lifecycle authority, with a reason.
    authorize(actor, "location.lifecycle", { marketId: prior.marketId });
    if (!reason?.trim()) throw new BusinessError("A reason is required to change the trade or legal name (D07 material-change review)");
  }
  const set: Partial<typeof schema.customerLocation.$inferInsert> = { updatedAt: new Date() };
  if (input.deliveryInstructions !== undefined) set.deliveryInstructions = input.deliveryInstructions?.trim() || null;
  if (input.receivingRestrictions !== undefined) set.receivingRestrictions = input.receivingRestrictions?.trim() || null;
  if (input.legalName !== undefined) set.legalName = input.legalName?.trim() || null;
  if (input.tradeName !== undefined && input.tradeName.trim()) set.tradeName = input.tradeName.trim();
  const [row] = await db.update(schema.customerLocation).set(set).where(eq(schema.customerLocation.id, locationId)).returning();
  await recordAudit(db, actor, {
    action: "location.edit_operational",
    subjectType: "customer_location",
    subjectId: locationId,
    prior: pick(prior, ["tradeName", "legalName", "deliveryInstructions", "receivingRestrictions"]),
    current: pick(row, ["tradeName", "legalName", "deliveryInstructions", "receivingRestrictions"]),
    reason: reason ?? null,
    marketId: prior.marketId,
  });
  return row;
}

/**
 * Ordinary contact maintenance (O06, UX-01): Sales adds buyer/receiving/other
 * contacts and corrects names/phones. An email that receives invoices is the
 * billing email — changing it goes through the Admin-approved request, never
 * an in-place edit. Payer authority is never granted here.
 */
export async function addContact(
  db: DbOrTx,
  actor: Actor,
  input: { locationId: string; role: "buyer" | "ap" | "receiving" | "other"; name: string; email?: string | null; phone?: string | null; mayOrder?: boolean },
) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "location.edit_operational", { marketId: loc.marketId });
  if (!input.name.trim()) throw new BusinessError("A name is required", { field: "name" });
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BusinessError("A valid email address is required", { field: "email" });
  return withTx(db, async (tx) => {
    const existingAp = await tx
      .select({ id: schema.locationContact.id })
      .from(schema.locationContact)
      .where(and(eq(schema.locationContact.locationId, input.locationId), eq(schema.locationContact.current, true), eq(schema.locationContact.contactRole, "ap")));
    if (input.role === "ap" && existingAp.length) throw new BusinessError("This location already has an AP contact; request a billing-email change instead of adding a second one.", { field: "role" });
    const { contact } = await upsertContact(tx, { name: input.name, email, phone: input.phone ?? null });
    const [dup] = await tx
      .select({ id: schema.locationContact.id })
      .from(schema.locationContact)
      .where(and(eq(schema.locationContact.locationId, input.locationId), eq(schema.locationContact.contactId, contact.id), eq(schema.locationContact.current, true)));
    if (dup) throw new BusinessError("That person is already a contact of this location", { field: "name" });
    const [row] = await tx
      .insert(schema.locationContact)
      .values({ locationId: input.locationId, contactId: contact.id, contactRole: input.role, mayOrder: input.role === "buyer" || Boolean(input.mayOrder), receivesInvoices: input.role === "ap", mayAuthorizePayment: false })
      .returning();
    await recordAudit(tx, actor, { action: "location.contact_add", subjectType: "customer_location", subjectId: input.locationId, current: { contactId: contact.id, role: input.role, name: contact.name }, marketId: loc.marketId });
    return row;
  });
}

export async function updateContact(db: DbOrTx, actor: Actor, input: { locationId: string; locationContactId: string; name?: string; phone?: string | null; email?: string | null }) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "location.edit_operational", { marketId: loc.marketId });
  return withTx(db, async (tx) => {
    const [assoc] = await tx.select().from(schema.locationContact).where(and(eq(schema.locationContact.id, input.locationContactId), eq(schema.locationContact.locationId, input.locationId), eq(schema.locationContact.current, true)));
    if (!assoc) throw new StaleStateError("That contact is no longer current for this location.");
    const [contact] = await tx.select().from(schema.contact).where(eq(schema.contact.id, assoc.contactId));
    const email = input.email === undefined ? undefined : input.email?.trim().toLowerCase() || null;
    if (email !== undefined && email !== contact.email && assoc.receivesInvoices) {
      throw new BusinessError("This contact receives invoices; its email is the billing email and changes through 'Request billing-email change' (Admin approval).", { field: "email", code: "billing_email" });
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BusinessError("A valid email address is required", { field: "email" });
    // A contact record can be shared across locations; edits apply to the person record with audit on this location.
    const set: Partial<typeof schema.contact.$inferInsert> = {};
    if (input.name !== undefined && input.name.trim()) set.name = input.name.trim();
    if (input.phone !== undefined) set.phone = input.phone?.trim() || null;
    if (email !== undefined) set.email = email;
    const [row] = Object.keys(set).length ? await tx.update(schema.contact).set(set).where(eq(schema.contact.id, contact.id)).returning() : [contact];
    await recordAudit(tx, actor, { action: "location.contact_edit", subjectType: "customer_location", subjectId: input.locationId, prior: { name: contact.name, phone: contact.phone, email: contact.email }, current: { name: row.name, phone: row.phone, email: row.email }, marketId: loc.marketId });
    return row;
  });
}

export async function endContact(db: DbOrTx, actor: Actor, input: { locationId: string; locationContactId: string; reason: string }) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "location.edit_operational", { marketId: loc.marketId });
  if (!input.reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  return withTx(db, async (tx) => {
    const [assoc] = await tx.select().from(schema.locationContact).where(and(eq(schema.locationContact.id, input.locationContactId), eq(schema.locationContact.locationId, input.locationId), eq(schema.locationContact.current, true)));
    if (!assoc) throw new StaleStateError("That contact is no longer current for this location.");
    if (assoc.receivesInvoices) throw new BusinessError("The invoice-receiving contact can only be replaced through a billing-email change request.", { code: "billing_email" });
    if (assoc.mayAuthorizePayment) throw new BusinessError("This contact holds payer authority; Accounting must revoke it first.", { code: "payer_not_authorized" });
    await tx.update(schema.locationContact).set({ current: false, toAt: new Date() }).where(eq(schema.locationContact.id, assoc.id));
    await recordAudit(tx, actor, { action: "location.contact_end", subjectType: "customer_location", subjectId: input.locationId, prior: { locationContactId: assoc.id, role: assoc.contactRole }, current: null, reason: input.reason, marketId: loc.marketId });
  });
}

/** Billing-email change: recorded as a request; only Admin approval applies it (O06, AT74). */
export async function requestBillingEmailChange(
  db: DbOrTx,
  actor: Actor,
  input: { locationId: string; requestedEmail: string; source?: "sales" | "gmail_reply" | "admin" },
) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "location.request_billing_email_change", { marketId: loc.marketId });
  const email = input.requestedEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BusinessError("A valid email address is required", { field: "email" });
  const current = await currentBillingEmail(db, input.locationId);
  if (current === email) throw new BusinessError("That is already the current billing email", { field: "email" });
  const [pending] = await db
    .select()
    .from(schema.billingEmailChangeRequest)
    .where(and(eq(schema.billingEmailChangeRequest.locationId, input.locationId), eq(schema.billingEmailChangeRequest.state, "pending"), eq(schema.billingEmailChangeRequest.requestedEmail, email)))
    .limit(1);
  if (pending) return pending;
  const [req] = await db
    .insert(schema.billingEmailChangeRequest)
    .values({ locationId: input.locationId, requestedEmail: email, priorEmail: current, source: input.source ?? "sales", requestedByEmployeeId: actor.employeeId })
    .returning();
  await recordAudit(db, actor, {
    action: "location.billing_email.request",
    subjectType: "customer_location",
    subjectId: input.locationId,
    prior: { billingEmail: current },
    current: { requested: email, state: "pending" },
    marketId: loc.marketId,
  });
  await openException(db, actor, {
    category: "billing_email_change",
    title: `Billing-email change awaiting Admin approval — ${loc.tradeName}`,
    cause: `Requested ${email} (was ${current ?? "none"}) via ${input.source ?? "sales"}`,
    marketId: loc.marketId,
    locationId: loc.id,
    ownerRole: "admin",
    nextAction: "Approve or reject the billing-email change on the location page.",
    dedupeKey: `billing_email_change:${req.id}`,
    links: [{ subjectType: "billing_email_change_request", subjectId: req.id }],
  });
  return req;
}

export async function currentBillingEmail(db: DbOrTx, locationId: string): Promise<string | null> {
  const rows = await db
    .select({ email: schema.contact.email, role: schema.locationContact.contactRole, receives: schema.locationContact.receivesInvoices })
    .from(schema.locationContact)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
    .where(and(eq(schema.locationContact.locationId, locationId), eq(schema.locationContact.current, true), eq(schema.locationContact.receivesInvoices, true)));
  return rows.find((r) => r.role === "ap")?.email ?? rows[0]?.email ?? null;
}

export async function decideBillingEmailChange(
  db: DbOrTx,
  actor: Actor,
  requestId: string,
  decision: "approved" | "rejected",
  note?: string,
) {
  const [pre] = await db.select().from(schema.billingEmailChangeRequest).where(eq(schema.billingEmailChangeRequest.id, requestId));
  if (!pre) throw new BusinessError("Request not found");
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, pre.locationId));
  authorize(actor, "location.billing_email.approve", { marketId: loc?.marketId });
  return withTx(db, async (tx) => {
    // Claim the decision atomically: competing or replayed decisions get one effect (AC28).
    const [req] = await tx
      .update(schema.billingEmailChangeRequest)
      .set({ state: decision, decidedByEmployeeId: actor.employeeId, decidedAt: new Date(), decisionNote: note ?? null })
      .where(and(eq(schema.billingEmailChangeRequest.id, requestId), eq(schema.billingEmailChangeRequest.state, "pending")))
      .returning();
    if (!req) {
      const [now] = await tx.select({ state: schema.billingEmailChangeRequest.state }).from(schema.billingEmailChangeRequest).where(eq(schema.billingEmailChangeRequest.id, requestId));
      throw new StaleStateError(`This request was already ${now?.state}; the decision is recorded once.`);
    }
    if (decision === "approved") {
      // Retire prior invoice-receiving AP association, add the approved one. Past recipients are never rewritten (AT74).
      // Payer authority is NOT redirected: the new AP address receives invoices; who may authorize payment is a separate act (UX-08).
      const existing = await tx
        .select({ lc: schema.locationContact, c: schema.contact })
        .from(schema.locationContact)
        .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
        .where(and(eq(schema.locationContact.locationId, req.locationId), eq(schema.locationContact.current, true), eq(schema.locationContact.contactRole, "ap")));
      for (const e of existing) {
        await tx.update(schema.locationContact).set({ current: false, toAt: new Date() }).where(eq(schema.locationContact.id, e.lc.id));
      }
      const [reuse] = await tx.select().from(schema.contact).where(eq(schema.contact.email, req.requestedEmail)).limit(1);
      const c = reuse ?? (await tx.insert(schema.contact).values({ name: existing[0]?.c.name ?? "Accounts payable", email: req.requestedEmail }).returning())[0];
      await tx.insert(schema.locationContact).values({ locationId: req.locationId, contactId: c.id, contactRole: "ap", receivesInvoices: true, mayAuthorizePayment: false });
      // If the buyer was the invoice recipient by default, the approved AP now receives invoices.
      await tx
        .update(schema.locationContact)
        .set({ receivesInvoices: false })
        .where(and(eq(schema.locationContact.locationId, req.locationId), eq(schema.locationContact.contactRole, "buyer"), eq(schema.locationContact.current, true)));
    }
    await recordAudit(tx, actor, {
      action: `location.billing_email.${decision}`,
      subjectType: "customer_location",
      subjectId: req.locationId,
      prior: { billingEmail: req.priorEmail },
      current: { billingEmail: decision === "approved" ? req.requestedEmail : req.priorEmail, decision },
      reason: note ?? null,
      marketId: loc?.marketId,
    });
    await resolveByDedupeKeys(tx, actor, [`billing_email_change:${requestId}`], `Billing-email change ${decision}`);
    return decision;
  });
}

export type LicenseState = (typeof schema.licenseStateEnum.enumValues)[number];

/**
 * Is license verification required before first delivery in this market?
 * Derived ONLY from the effective D02 selection (market-scoped, dated). With
 * D02 unselected the confirmed behaviour applies: verification is required.
 */
export async function licenseVerificationRequirement(db: DbOrTx, marketId: string, now = new Date()) {
  const d02 = await getPolicy<{ verification_required_markets?: string[] }>(db, "D02", { marketId, now });
  if (d02.status !== "selected" || !Array.isArray(d02.selection.verification_required_markets)) {
    return { required: true as const, basis: "unselected" as const, selectionId: null, kind: null };
  }
  const [market] = await db.select({ code: schema.market.code }).from(schema.market).where(eq(schema.market.id, marketId));
  const required = market ? d02.selection.verification_required_markets.includes(market.code) : true;
  return { required, basis: "D02" as const, selectionId: d02.selectionId, kind: d02.kind };
}

/** Admin records the internal license decision; earlier decisions stay as history (O07/D02). */
export async function recordLicenseDecision(
  db: DbOrTx,
  actor: Actor,
  input: { locationId: string; state: LicenseState; licenseNumber?: string | null; licenseType?: string | null; evidence?: string | null; note?: string | null },
) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "license.verify", { marketId: loc.marketId });
  if (input.state === "verified" && !(input.licenseNumber?.trim() || input.evidence?.trim())) {
    throw new BusinessError("Verified requires a license number or evidence reference — no false verified status (D02)", { field: "evidence" });
  }
  if (input.state === "not_applicable") {
    // A label is not authority (REV-07/AC16): "not applicable" is recorded only where the effective
    // approved D02 selection for THIS market says verification is not required.
    const req = await licenseVerificationRequirement(db, loc.marketId);
    if (req.required) {
      throw new BusinessError(
        req.basis === "unselected"
          ? "License verification cannot be marked not applicable: D02 is unselected, so verification is required in every market (confirmed behaviour). Record verified/rejected/pending instead."
          : "License verification cannot be marked not applicable: the effective D02 selection requires verification in this market.",
        { field: "state", code: "unselected_policy" },
      );
    }
    if (req.kind === "test") throw new BusinessError("Only a production D02 selection can make verification not applicable; the current selection is a labelled TEST selection.", { field: "state" });
  }
  return withTx(db, async (tx) => {
    const [prior] = await tx
      .select()
      .from(schema.licenseVerification)
      .where(and(eq(schema.licenseVerification.locationId, input.locationId), eq(schema.licenseVerification.current, true)))
      .limit(1);
    if (prior) await tx.update(schema.licenseVerification).set({ current: false }).where(eq(schema.licenseVerification.id, prior.id));
    const [row] = await tx
      .insert(schema.licenseVerification)
      .values({
        locationId: input.locationId,
        state: input.state,
        licenseNumber: input.licenseNumber?.trim() || prior?.licenseNumber || null,
        licenseType: input.licenseType?.trim() || prior?.licenseType || null,
        evidence: input.evidence?.trim() || null,
        note: input.note?.trim() || null,
        decidedByEmployeeId: actor.employeeId,
        decidedAt: new Date(),
      })
      .returning();
    await recordAudit(tx, actor, {
      action: "license.decision",
      subjectType: "customer_location",
      subjectId: input.locationId,
      prior: prior ? { state: prior.state, licenseNumber: prior.licenseNumber } : null,
      current: { state: row.state, licenseNumber: row.licenseNumber, evidence: row.evidence },
      reason: input.note ?? null,
      marketId: loc.marketId,
    });
    await reevaluateLicenseCase(tx, actor, input.locationId);
    return row;
  });
}

/**
 * Follow-through (UX-06): keep the location's license case in step with the
 * current decision AND the current D02 policy. Idempotent: dedupe keys make
 * repeated evaluation a no-op.
 */
export async function reevaluateLicenseCase(db: DbOrTx, actor: Actor, locationId: string) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) return;
  const [license] = await db
    .select()
    .from(schema.licenseVerification)
    .where(and(eq(schema.licenseVerification.locationId, locationId), eq(schema.licenseVerification.current, true)))
    .limit(1);
  const req = await licenseVerificationRequirement(db, loc.marketId);
  const satisfied = license?.state === "verified" || (!req.required && req.kind === "production") || license?.state === "rejected";
  const key = `license_unverified:${locationId}`;
  if (satisfied || loc.status === "closed") {
    await resolveByDedupeKeys(db, actor, [key], license?.state === "verified" ? "License verified" : license?.state === "rejected" ? "License rejected (not serviceable)" : !req.required ? "Verification not required in this market under D02" : "Location closed");
    return;
  }
  await openException(db, actor, {
    category: "license_unverified",
    title: `License verification pending — ${loc.tradeName}`,
    cause: license?.state === "not_applicable" ? "Recorded as not applicable, but the effective D02 policy requires verification in this market." : "Company verifies license internally before first delivery where applicable (O07).",
    marketId: loc.marketId,
    locationId,
    ownerRole: "admin",
    nextAction: "Locate and verify the license; record the decision on the location.",
    dedupeKey: key,
    links: [{ subjectType: "customer_location", subjectId: locationId }],
  });
}

/** Policy follow-through for D02 across a market's active locations (called after a D02 selection is recorded or withdrawn). */
export async function reevaluateLicenseCasesForMarkets(db: DbOrTx, actor: Actor, marketIds: string[] | null) {
  const conds = [ne(schema.customerLocation.status, "closed")];
  if (marketIds && marketIds.length) conds.push(inArray(schema.customerLocation.marketId, marketIds));
  const locs = await db.select({ id: schema.customerLocation.id }).from(schema.customerLocation).where(and(...conds));
  for (const l of locs) await reevaluateLicenseCase(db, actor, l.id);
  return locs.length;
}

export async function assignCurrentRep(db: DbOrTx, actor: Actor, locationId: string, employeeId: string, reason: string) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "location.assign_rep", { marketId: loc.marketId });
  return withTx(db, async (tx) => {
    await tx
      .update(schema.locationRepHistory)
      .set({ toAt: new Date() })
      .where(and(eq(schema.locationRepHistory.locationId, locationId), sql`${schema.locationRepHistory.toAt} is null`));
    await tx.insert(schema.locationRepHistory).values({ locationId, employeeId, reason });
    const [row] = await tx.update(schema.customerLocation).set({ currentRepEmployeeId: employeeId, updatedAt: new Date() }).where(eq(schema.customerLocation.id, locationId)).returning();
    await recordAudit(tx, actor, {
      action: "location.assign_rep",
      subjectType: "customer_location",
      subjectId: locationId,
      prior: { currentRepEmployeeId: loc.currentRepEmployeeId },
      current: { currentRepEmployeeId: employeeId },
      reason,
      marketId: loc.marketId,
    });
    return row;
  });
}

export async function setWarehouseOverride(db: DbOrTx, actor: Actor, locationId: string, warehouseId: string | null, reason: string) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "location.warehouse_override", { marketId: loc.marketId });
  if (warehouseId) {
    const [wh] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, warehouseId));
    if (!wh || !wh.active) throw new BusinessError("Warehouse not found or inactive", { field: "warehouseId" });
    // Cross-market fulfilment needs authority over the warehouse's market too — never only the customer's (REV-11, AC02).
    authorize(actor, "location.warehouse_override", { marketId: wh.marketId });
    authorize(actor, "stock.record", { marketId: wh.marketId });
  }
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  if ((loc.warehouseOverrideId ?? null) === (warehouseId ?? null)) throw new StaleStateError("That is already the location's default warehouse.");
  const [row] = await db.update(schema.customerLocation).set({ warehouseOverrideId: warehouseId, updatedAt: new Date() }).where(eq(schema.customerLocation.id, locationId)).returning();
  await recordAudit(db, actor, {
    action: "location.warehouse_override",
    subjectType: "customer_location",
    subjectId: locationId,
    prior: { warehouseOverrideId: loc.warehouseOverrideId },
    current: { warehouseOverrideId: warehouseId },
    reason,
    marketId: loc.marketId,
  });
  return row;
}

export type LocationStatus = (typeof schema.locationStatusEnum.enumValues)[number];

/**
 * Lifecycle: inactive is reversible; closed stops new routine demand. Closure
 * never deletes obligations, credits, custody or audit (brief §7). D07's
 * detailed run-off policy is unselected: closure opens an owned review case
 * instead of applying any automatic disposition.
 */
export async function setLocationStatus(db: DbOrTx, actor: Actor, locationId: string, status: LocationStatus, reason: string) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "location.lifecycle", { marketId: loc.marketId });
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  if (loc.status === status) throw new StaleStateError(`The location is already ${status}.`);
  return withTx(db, async (tx) => {
    const [row] = await tx
      .update(schema.customerLocation)
      .set({ status, updatedAt: new Date(), closedAt: status === "closed" ? new Date() : null, closeReason: status === "closed" ? reason : null })
      .where(and(eq(schema.customerLocation.id, locationId), eq(schema.customerLocation.status, loc.status)))
      .returning();
    if (!row) throw new StaleStateError("The location's status changed while you were editing; reload and try again.");
    await reevaluateLicenseCase(tx, actor, locationId);
    await recordAudit(tx, actor, {
      action: "location.status",
      subjectType: "customer_location",
      subjectId: locationId,
      prior: { status: loc.status },
      current: { status },
      reason,
      marketId: loc.marketId,
    });
    if (status === "closed") {
      const standing = await tx
        .select()
        .from(schema.standingArrangement)
        .where(and(eq(schema.standingArrangement.locationId, locationId), ne(schema.standingArrangement.state, "ended")));
      await openException(tx, actor, {
        category: "closure_review",
        title: `Closure run-off review — ${loc.tradeName}`,
        cause: reason,
        marketId: loc.marketId,
        locationId,
        ownerRole: "accounting",
        nextAction:
          "Review open demand, reservations, standing arrangements, obligations, credits and keg custody (J24/J29–J31). D07 lifecycle policy is unselected — dispose deliberately.",
        dedupeKey: `closure_review:${locationId}`,
        links: [
          { subjectType: "customer_location", subjectId: locationId },
          ...standing.map((s) => ({ subjectType: "standing_arrangement", subjectId: s.id, relation: "needs disposition" })),
        ],
      });
    }
    return row;
  });
}

/** Admin flags a suspected true duplicate for investigation without deleting evidence (AT02). */
export async function flagSuspectedDuplicate(db: DbOrTx, actor: Actor, locationId: string, otherLocationId: string, note: string) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "location.lifecycle", { marketId: loc.marketId });
  const pair = [locationId, otherLocationId].sort().join(":");
  return openException(db, actor, {
    category: "duplicate_suspected",
    title: `Suspected duplicate location — ${loc.tradeName}`,
    cause: note,
    marketId: loc.marketId,
    locationId,
    ownerRole: "admin",
    nextAction: "Validate same real licensed location and billing context; identical name alone is insufficient (J30). D07 governs consolidation.",
    dedupeKey: `duplicate_suspected:${pair}`,
    links: [
      { subjectType: "customer_location", subjectId: locationId },
      { subjectType: "customer_location", subjectId: otherLocationId },
    ],
  });
}

export async function findContactsByEmail(db: DbOrTx, email: string) {
  const e = email.trim().toLowerCase();
  if (!e) return [];
  return db.select().from(schema.contact).where(or(eq(schema.contact.email, e), ilike(schema.contact.email, `${escapeLike(e)}%`))).limit(10);
}

function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}
