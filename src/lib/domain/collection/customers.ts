/**
 * Stripe customers for portal accounts (Round 4, C1 to C4 and the one-time match C2).
 *
 * A portal account gets its Stripe customer the first time it needs one (a setup link, its first mirrored invoice),
 * never at account creation, so prospects stay out of Stripe. The portal is the source of truth for name, billing
 * email and address and pushes changes; the customer carries the portal's identifiers in metadata. Customers the ACH
 * app made before the portal are matched to accounts once, by billing email then by name, and a person confirms each.
 */
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { SYSTEM_ACTOR, type Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db, DbOrTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { ProviderUnavailableError, enqueueJob, registerJobHandler } from "@/lib/jobs/queue";
import { customerDetails, customerReference, gateway, linkExistingStripeCustomer, requestStripeCustomerAssociation, stripeConfigured, verifiedStripeAccount } from "@/lib/integrations/stripe/adapter";

export const JOB_CUSTOMER_SYNC = "stripe.customer.sync";

/**
 * Make sure the location has a Stripe customer in the verified account, creating it now when Stripe is reachable.
 * Returns the customer id, or null when Stripe is not connected (the association is queued and resumes later).
 */
export async function ensureStripeCustomer(db: DbOrTx, actor: Actor, locationId: string): Promise<string | null> {
  const binding = await verifiedStripeAccount(db);
  const existing = binding ? await customerReference(db, locationId, binding) : null;
  if (existing?.providerId) return existing.providerId;
  await requestStripeCustomerAssociation(db, actor, locationId, { authorized: true });
  if (!binding) return null;
  // Create it now rather than waiting for the cron: the caller usually needs the id in the same breath.
  const ref = await customerReference(db, locationId, binding);
  if (!ref || ref.providerId) return ref?.providerId ?? null;
  const details = await customerDetails(db, locationId);
  const gw = gateway();
  const found = await gw.searchCustomers(`metadata['fv_location_id']:'${locationId}'`, 1);
  const customer = found[0] ?? (await gw.createCustomer({ name: details.name, email: details.email, metadata: details.metadata, address: details.address }, `fv-customer-${binding.environment}-${binding.accountId}-${locationId}`));
  const now = new Date();
  await db
    .update(schema.providerReference)
    .set({ providerId: customer.id, status: "established", providerAccountId: binding.accountId, evidence: { recovered: Boolean(found[0]), created: customer.created, accountId: binding.accountId }, lastCheckedAt: now, updatedAt: now })
    .where(and(eq(schema.providerReference.id, ref.id), isNull(schema.providerReference.providerId)));
  await recordAudit(db, actor, { action: "stripe.customer.established", subjectType: "customer_location", subjectId: locationId, current: { stripeCustomerId: customer.id, recovered: Boolean(found[0]), accountId: binding.accountId }, marketId: details.loc.marketId });
  return customer.id;
}

/** Queue a push of the portal's name, billing email and address to the Stripe customer (C4). No-op without a customer. */
export async function queueCustomerSync(db: DbOrTx, locationId: string) {
  const binding = await verifiedStripeAccount(db);
  const ref = binding ? await customerReference(db, locationId, binding) : null;
  if (!ref?.providerId) return null;
  return enqueueJob(db, JOB_CUSTOMER_SYNC, { locationId }, { dedupeKey: `${JOB_CUSTOMER_SYNC}:${locationId}`, maxAttempts: 3 });
}

registerJobHandler(JOB_CUSTOMER_SYNC, {
  ready: async (db) => stripeConfigured() && (await verifiedStripeAccount(db)) !== null,
  run: async (db: Db, payload) => {
    const locationId = String(payload.locationId ?? "");
    const binding = await verifiedStripeAccount(db);
    if (!binding) throw new ProviderUnavailableError("Stripe account not verified; the customer sync resumes after the connectivity check");
    const ref = await customerReference(db, locationId, binding);
    if (!ref?.providerId) return;
    const details = await customerDetails(db, locationId);
    await gateway().updateCustomer(ref.providerId, { name: details.name, email: details.email, metadata: details.metadata, address: details.address });
    await recordAudit(db, SYSTEM_ACTOR, { action: "stripe.customer.synced", subjectType: "customer_location", subjectId: locationId, current: { stripeCustomerId: ref.providerId, name: details.name, email: details.email }, marketId: details.loc.marketId });
  },
});

// ---------------------------------------------------------------------------
// The one-time match of the ACH app's customers (C2)
// ---------------------------------------------------------------------------

function normalise(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|llc|inc|co|company|corp|corporation|ltd|dba|a)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull every Stripe customer that carries no portal id and suggest the account it belongs to: an exact billing-email
 * match first, then a trade-name or legal-name match. Nothing is linked here; a person confirms each row.
 */
export async function importStripeCustomersForMatching(db: DbOrTx, actor: Actor) {
  authorize(actor, "integration.manage");
  const binding = await verifiedStripeAccount(db);
  if (!binding) throw new BusinessError("Stripe account is not verified for the configured credential; run the connectivity check first.");
  const gw = gateway();
  const linked = new Set(
    (await db.select({ id: schema.providerReference.providerId }).from(schema.providerReference).where(and(eq(schema.providerReference.provider, "stripe"), eq(schema.providerReference.providerObject, "customer"), eq(schema.providerReference.environment, binding.environment), eq(schema.providerReference.providerAccountId, binding.accountId)))).map((r) => r.id).filter((x): x is string => Boolean(x)),
  );
  const locations = await db.select().from(schema.customerLocation).where(inArray(schema.customerLocation.kind, ["retail", "distributor", "individual"]));
  const emails = await db
    .select({ locationId: schema.locationContact.locationId, email: schema.contact.email })
    .from(schema.locationContact)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
    .where(and(eq(schema.locationContact.current, true), sql`${schema.contact.email} is not null`));
  const byEmail = new Map<string, Set<string>>();
  for (const e of emails) {
    const k = e.email!.trim().toLowerCase();
    if (!byEmail.has(k)) byEmail.set(k, new Set());
    byEmail.get(k)!.add(e.locationId);
  }
  const byName = new Map<string, Set<string>>();
  for (const l of locations) {
    for (const n of [normalise(l.tradeName), normalise(l.legalName)]) {
      if (!n) continue;
      if (!byName.has(n)) byName.set(n, new Set());
      byName.get(n)!.add(l.id);
    }
  }
  let imported = 0;
  let suggested = 0;
  let startingAfter: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const r = await gw.listCustomers({ limit: 100, startingAfter });
    for (const c of r.data) {
      if (c.metadata.fv_location_id || linked.has(c.id)) continue;
      let suggestedLocationId: string | null = null;
      let suggestedBy: string | null = null;
      const emailHits = c.email ? byEmail.get(c.email.trim().toLowerCase()) : undefined;
      if (emailHits && emailHits.size === 1) {
        suggestedLocationId = [...emailHits][0];
        suggestedBy = "email";
      } else {
        const nameHits = byName.get(normalise(c.name));
        if (nameHits && nameHits.size === 1) {
          suggestedLocationId = [...nameHits][0];
          suggestedBy = "name";
        }
      }
      let bank: { bankName: string | null; last4: string | null } | null = null;
      if (c.defaultPaymentMethod) {
        const pm = await gw.retrievePaymentMethod(c.defaultPaymentMethod);
        bank = pm?.usBankAccount ?? null;
      }
      const [existing] = await db.select().from(schema.stripeCustomerMatch).where(and(eq(schema.stripeCustomerMatch.environment, binding.environment), eq(schema.stripeCustomerMatch.stripeCustomerId, c.id)));
      if (existing) {
        if (existing.state === "suggested") {
          await db.update(schema.stripeCustomerMatch).set({ name: c.name, email: c.email, bankName: bank?.bankName ?? null, bankLast4: bank?.last4 ?? null, hasDefaultBank: Boolean(c.defaultPaymentMethod), suggestedLocationId, suggestedBy, updatedAt: new Date() }).where(eq(schema.stripeCustomerMatch.id, existing.id));
        }
        continue;
      }
      await db.insert(schema.stripeCustomerMatch).values({ stripeCustomerId: c.id, environment: binding.environment, name: c.name, email: c.email, stripeCreatedAt: c.created ? new Date(c.created * 1000) : null, bankName: bank?.bankName ?? null, bankLast4: bank?.last4 ?? null, hasDefaultBank: Boolean(c.defaultPaymentMethod), suggestedLocationId, suggestedBy });
      imported += 1;
      if (suggestedLocationId) suggested += 1;
    }
    if (!r.hasMore) break;
    startingAfter = r.data[r.data.length - 1]?.id ?? null;
  }
  await recordAudit(db, actor, { action: "stripe.match.import", subjectType: "provider", subjectId: "stripe", current: { imported, suggested, accountId: binding.accountId } });
  return { imported, suggested };
}

export async function listCustomerMatches(db: DbOrTx, opts: { states?: Array<"suggested" | "confirmed" | "dismissed"> } = {}) {
  const conds = opts.states?.length ? [inArray(schema.stripeCustomerMatch.state, opts.states)] : [];
  const rows = await db.select().from(schema.stripeCustomerMatch).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.stripeCustomerMatch.importedAt));
  const ids = Array.from(new Set(rows.flatMap((r) => [r.suggestedLocationId, r.confirmedLocationId]).filter((x): x is string => Boolean(x))));
  const locs = ids.length ? await db.select({ id: schema.customerLocation.id, tradeName: schema.customerLocation.tradeName, kind: schema.customerLocation.kind }).from(schema.customerLocation).where(inArray(schema.customerLocation.id, ids)) : [];
  const byId = new Map(locs.map((l) => [l.id, l]));
  return rows.map((r) => ({ match: r, suggested: r.suggestedLocationId ? byId.get(r.suggestedLocationId) ?? null : null, confirmed: r.confirmedLocationId ? byId.get(r.confirmedLocationId) ?? null : null }));
}

/**
 * A person confirms which account a Stripe customer belongs to: the reference is linked, the portal's identifiers are
 * written onto the customer, and its default bank (if any) is recorded on the payment relationship (B2, B4).
 */
export async function confirmCustomerMatch(db: DbOrTx, actor: Actor, matchId: string, locationId: string, note?: string | null) {
  authorize(actor, "integration.manage");
  const [m] = await db.select().from(schema.stripeCustomerMatch).where(eq(schema.stripeCustomerMatch.id, matchId));
  if (!m) throw new BusinessError("Match not found");
  if (m.state !== "suggested") throw new StaleStateError(`This customer was already ${m.state}`);
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new BusinessError("Account not found", { field: "locationId" });
  await linkExistingStripeCustomer(db, actor, locationId, m.stripeCustomerId, { matchedBy: m.suggestedBy, matchId: m.id, stripeName: m.name, stripeEmail: m.email });
  const details = await customerDetails(db, locationId);
  const gw = gateway();
  await gw.updateCustomer(m.stripeCustomerId, { metadata: details.metadata });
  // The bank on file (B2 to B4). The ACH app never set a default payment method (its webhook secret was never configured),
  // so a customer with exactly one bank gets it as the default now; several banks go to a person.
  const customer = await gw.retrieveCustomer(m.stripeCustomerId);
  let pmId = customer?.defaultPaymentMethod ?? null;
  if (!pmId) {
    const banks = await gw.listPaymentMethods(m.stripeCustomerId, "us_bank_account");
    if (banks.length === 1) {
      pmId = banks[0].id;
      await gw.updateCustomer(m.stripeCustomerId, { defaultPaymentMethod: pmId });
    } else if (banks.length > 1) {
      const { openException } = await import("@/lib/exceptions/service");
      await openException(db, actor, {
        category: "payment_setup_pending",
        title: `${loc.tradeName}: ${banks.length} banks on the Stripe customer, none set as default`,
        cause: `Stripe customer ${m.stripeCustomerId} carries ${banks.map((b) => `${b.usBankAccount?.bankName ?? "bank"} ending ${b.usBankAccount?.last4 ?? "????"}`).join(", ")}. The portal will not guess which one the account pays from.`,
        marketId: loc.marketId,
        locationId,
        ownerRole: "accounting",
        nextAction: "Set the default payment method on the customer in the Stripe dashboard, or send a fresh setup link.",
        dedupeKey: `payment_setup_pending:${locationId}`,
        links: [{ subjectType: "customer_location", subjectId: locationId }],
      });
    }
  }
  if (pmId) {
    const pm = await gw.retrievePaymentMethod(pmId);
    if (pm?.usBankAccount) {
      const { recordBankOnFile } = await import("./setup");
      await recordBankOnFile(db, actor, locationId, { paymentMethodId: pm.id, bankName: pm.usBankAccount.bankName, last4: pm.usBankAccount.last4, mandateId: null, verified: true, source: "ach_app" });
      await db.update(schema.paymentRelationship).set({ defaultSetAt: new Date() }).where(and(eq(schema.paymentRelationship.locationId, locationId), eq(schema.paymentRelationship.current, true)));
    }
  }
  const [row] = await db
    .update(schema.stripeCustomerMatch)
    .set({ state: "confirmed", confirmedLocationId: locationId, decidedByEmployeeId: actor.employeeId, decidedAt: new Date(), note: note?.trim() || null, updatedAt: new Date() })
    .where(eq(schema.stripeCustomerMatch.id, matchId))
    .returning();
  await recordAudit(db, actor, { action: "stripe.match.confirmed", subjectType: "customer_location", subjectId: locationId, current: { stripeCustomerId: m.stripeCustomerId, matchedBy: m.suggestedBy }, reason: note ?? null, marketId: loc.marketId });
  return row;
}

export async function dismissCustomerMatch(db: DbOrTx, actor: Actor, matchId: string, note: string) {
  authorize(actor, "integration.manage");
  if (!note.trim()) throw new BusinessError("Say why this customer is not one of our accounts", { field: "note" });
  const [row] = await db
    .update(schema.stripeCustomerMatch)
    .set({ state: "dismissed", decidedByEmployeeId: actor.employeeId, decidedAt: new Date(), note: note.trim(), updatedAt: new Date() })
    .where(and(eq(schema.stripeCustomerMatch.id, matchId), eq(schema.stripeCustomerMatch.state, "suggested")))
    .returning();
  if (!row) throw new StaleStateError("This customer was already decided");
  await recordAudit(db, actor, { action: "stripe.match.dismissed", subjectType: "provider", subjectId: "stripe", current: { stripeCustomerId: row.stripeCustomerId }, reason: note.trim() });
  return row;
}

/** Accounts that could be a match for the review screen's picker: active retail and distributor accounts, by name. */
export async function matchCandidates(db: DbOrTx) {
  return db
    .select({ id: schema.customerLocation.id, tradeName: schema.customerLocation.tradeName, kind: schema.customerLocation.kind, legacyAccountId: schema.customerLocation.legacyAccountId })
    .from(schema.customerLocation)
    .where(and(inArray(schema.customerLocation.kind, ["retail", "distributor"]), or(eq(schema.customerLocation.status, "active"), eq(schema.customerLocation.status, "closed"))))
    .orderBy(schema.customerLocation.tradeName);
}

// ---------------------------------------------------------------------------
// Open Stripe invoices the portal did not create (C2 for invoices)
// ---------------------------------------------------------------------------

/**
 * The ACH app's charge-retailer route made charge_automatically invoices, and Black Cat's invoices were made by hand in
 * the dashboard. Pull every open Stripe invoice (and those paid in the last 90 days) without a portal id and suggest the
 * portal invoice it is: same account and same total first, same total alone second. A person links or dismisses each.
 */
export async function importStripeInvoicesForMatching(db: DbOrTx, actor: Actor) {
  authorize(actor, "integration.manage");
  const binding = await verifiedStripeAccount(db);
  if (!binding) throw new BusinessError("Stripe account is not verified for the configured credential; run the connectivity check first.");
  const gw = gateway();
  const known = new Set((await db.select({ id: schema.invoice.stripeInvoiceId }).from(schema.invoice).where(isNotNull(schema.invoice.stripeInvoiceId))).map((r) => r.id!));
  const refs = await db
    .select({ subjectId: schema.providerReference.subjectId, providerId: schema.providerReference.providerId })
    .from(schema.providerReference)
    .where(and(eq(schema.providerReference.provider, "stripe"), eq(schema.providerReference.providerObject, "customer"), eq(schema.providerReference.status, "established"), eq(schema.providerReference.environment, binding.environment), eq(schema.providerReference.providerAccountId, binding.accountId)));
  const locationByCustomer = new Map(refs.filter((r) => r.providerId).map((r) => [r.providerId!, r.subjectId]));
  const candidates = await db.select().from(schema.invoice).where(and(inArray(schema.invoice.status, ["issued", "processing"]), isNull(schema.invoice.stripeInvoiceId), eq(schema.invoice.series, "INV")));
  let imported = 0;
  let suggested = 0;
  const since = Math.floor(Date.now() / 1000) - 90 * 86400;
  for (const status of ["open", "paid"] as const) {
    let startingAfter: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const r = await gw.listInvoices({ limit: 100, startingAfter, status });
      for (const inv of r.data) {
        if (inv.metadata.fv_invoice_id || known.has(inv.id)) continue;
        if (status === "paid" && inv.dueDate && inv.dueDate < since) continue;
        const locationId = locationByCustomer.get(inv.customer) ?? null;
        let suggestedInvoiceId: string | null = null;
        let suggestedBy: string | null = null;
        const sameAmount = candidates.filter((c) => c.totalCents === inv.total);
        const sameAccount = locationId ? sameAmount.filter((c) => c.locationId === locationId) : [];
        if (sameAccount.length === 1) {
          suggestedInvoiceId = sameAccount[0].id;
          suggestedBy = "amount_and_account";
        } else if (sameAmount.length === 1) {
          suggestedInvoiceId = sameAmount[0].id;
          suggestedBy = "amount";
        }
        const customer = await gw.retrieveCustomer(inv.customer);
        const values = { stripeInvoiceId: inv.id, environment: binding.environment, stripeNumber: inv.number, stripeCustomerId: inv.customer, customerName: customer?.name ?? null, status: inv.status, totalCents: inv.total, amountRemainingCents: inv.amountRemaining, dueDate: inv.dueDate ? new Date(inv.dueDate * 1000).toISOString().slice(0, 10) : null, hostedInvoiceUrl: inv.hostedInvoiceUrl, locationId, suggestedInvoiceId, suggestedBy, updatedAt: new Date() };
        const inserted = await db.insert(schema.stripeInvoiceMatch).values(values).onConflictDoNothing().returning({ id: schema.stripeInvoiceMatch.id });
        if (inserted.length) {
          imported += 1;
          if (suggestedInvoiceId) suggested += 1;
        } else {
          await db.update(schema.stripeInvoiceMatch).set({ status: inv.status, amountRemainingCents: inv.amountRemaining, locationId, suggestedInvoiceId, suggestedBy, updatedAt: new Date() }).where(and(eq(schema.stripeInvoiceMatch.environment, binding.environment), eq(schema.stripeInvoiceMatch.stripeInvoiceId, inv.id), eq(schema.stripeInvoiceMatch.state, "suggested")));
        }
      }
      if (!r.hasMore) break;
      startingAfter = r.data[r.data.length - 1]?.id ?? null;
    }
  }
  await recordAudit(db, actor, { action: "stripe.invoice_match.import", subjectType: "provider", subjectId: "stripe", current: { imported, suggested, accountId: binding.accountId } });
  return { imported, suggested };
}

export async function listInvoiceMatches(db: DbOrTx, opts: { states?: Array<"suggested" | "linked" | "dismissed"> } = {}) {
  const conds = opts.states?.length ? [inArray(schema.stripeInvoiceMatch.state, opts.states)] : [];
  const rows = await db.select().from(schema.stripeInvoiceMatch).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.stripeInvoiceMatch.importedAt));
  const invIds = Array.from(new Set(rows.flatMap((r) => [r.suggestedInvoiceId, r.linkedInvoiceId]).filter((x): x is string => Boolean(x))));
  const invs = invIds.length ? await db.select({ id: schema.invoice.id, number: schema.invoice.number, totalCents: schema.invoice.totalCents, locationId: schema.invoice.locationId, status: schema.invoice.status }).from(schema.invoice).where(inArray(schema.invoice.id, invIds)) : [];
  const locIds = Array.from(new Set([...rows.map((r) => r.locationId), ...invs.map((i) => i.locationId)].filter((x): x is string => Boolean(x))));
  const locs = locIds.length ? await db.select({ id: schema.customerLocation.id, tradeName: schema.customerLocation.tradeName }).from(schema.customerLocation).where(inArray(schema.customerLocation.id, locIds)) : [];
  const invBy = new Map(invs.map((i) => [i.id, i]));
  const locBy = new Map(locs.map((l) => [l.id, l]));
  return rows.map((r) => ({ match: r, location: r.locationId ? locBy.get(r.locationId) ?? null : null, suggested: r.suggestedInvoiceId ? invBy.get(r.suggestedInvoiceId) ?? null : null, linked: r.linkedInvoiceId ? invBy.get(r.linkedInvoiceId) ?? null : null }));
}

/** Portal invoices a Stripe invoice could be linked to: issued or processing, charged, not yet in Stripe. */
export async function invoiceLinkCandidates(db: DbOrTx) {
  return db
    .select({ id: schema.invoice.id, number: schema.invoice.number, totalCents: schema.invoice.totalCents, locationId: schema.invoice.locationId, tradeName: schema.customerLocation.tradeName, invoiceDate: schema.invoice.invoiceDate })
    .from(schema.invoice)
    .leftJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.invoice.locationId))
    .where(and(inArray(schema.invoice.status, ["issued", "processing"]), isNull(schema.invoice.stripeInvoiceId), eq(schema.invoice.series, "INV")))
    .orderBy(desc(schema.invoice.invoiceDate));
}

/**
 * A person ties a Stripe invoice to its portal invoice: the portal invoice takes the Stripe copy (id, number, link,
 * state), the Stripe invoice takes the portal's identifiers, and if Stripe already shows it paid the portal follows.
 */
export async function linkStripeInvoice(db: DbOrTx, actor: Actor, matchId: string, invoiceId: string, note?: string | null) {
  authorize(actor, "integration.manage");
  const [m] = await db.select().from(schema.stripeInvoiceMatch).where(eq(schema.stripeInvoiceMatch.id, matchId));
  if (!m) throw new BusinessError("Match not found");
  if (m.state !== "suggested") throw new StaleStateError(`This Stripe invoice was already ${m.state}`);
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
  if (!inv) throw new BusinessError("Portal invoice not found", { field: "invoiceId" });
  if (inv.stripeInvoiceId) throw new BusinessError(`${inv.number} already has Stripe copy ${inv.stripeInvoiceId}`);
  if (inv.totalCents !== m.totalCents) throw new BusinessError(`Totals differ: ${inv.number} is ${(inv.totalCents / 100).toFixed(2)}, the Stripe invoice ${(m.totalCents / 100).toFixed(2)}; credit or correct one of them first`);
  if (m.locationId && inv.locationId && m.locationId !== inv.locationId) throw new BusinessError("The Stripe customer belongs to a different account than this invoice");
  const gw = gateway();
  const remote = await gw.retrieveInvoice(m.stripeInvoiceId);
  if (!remote) throw new BusinessError("The Stripe invoice no longer exists");
  await gw.updateInvoiceMetadata(m.stripeInvoiceId, { fv_invoice_id: inv.id, fv_invoice_number: inv.number ?? "", fv_location_id: inv.locationId ?? "", fv_linked_by: "match" });
  const { nextBusinessDayOnOrAfter } = await import("./calendar");
  const now = new Date();
  const paidRemote = remote.status === "paid";
  await db
    .update(schema.invoice)
    .set({
      stripeInvoiceId: remote.id,
      stripeNumber: remote.number,
      stripeStatus: remote.status,
      hostedInvoiceUrl: remote.hostedInvoiceUrl,
      stripePdfUrl: remote.invoicePdf,
      mirroredAt: now,
      mirrorError: remote.number && remote.number !== inv.number ? "Linked to an invoice made outside the portal; Stripe's number differs" : null,
      ...(paidRemote && inv.status !== "paid" ? { status: "paid" as const, paidAt: now, paidVia: "stripe_ach", collectionState: "paid", debitScheduledOn: null } : {}),
      ...(!paidRemote && inv.payBy === "stripe" && inv.status === "issued" ? { collectionState: "scheduled", debitScheduledOn: nextBusinessDayOnOrAfter(inv.dueDate ?? now.toISOString().slice(0, 10)) } : {}),
      updatedAt: now,
    })
    .where(eq(schema.invoice.id, inv.id));
  if (paidRemote && inv.status !== "paid") {
    await db.insert(schema.payment).values({ invoiceId: inv.id, locationId: inv.locationId, marketId: inv.marketId, kind: "stripe_ach", amountCents: remote.amountPaid || inv.totalCents, state: "succeeded", stripePaymentIntentId: remote.paymentIntent, occurredAt: now, settledAt: now, recordedByEmployeeId: actor.employeeId, note: "Paid in Stripe before the invoice was linked" }).onConflictDoNothing();
  }
  const [row] = await db
    .update(schema.stripeInvoiceMatch)
    .set({ state: "linked", linkedInvoiceId: inv.id, decidedByEmployeeId: actor.employeeId, decidedAt: now, note: note?.trim() || null, updatedAt: now })
    .where(eq(schema.stripeInvoiceMatch.id, matchId))
    .returning();
  await recordAudit(db, actor, { action: "invoice.stripe_linked", subjectType: "invoice", subjectId: inv.id, current: { stripeInvoiceId: remote.id, stripeNumber: remote.number, stripeStatus: remote.status, paidRemote }, reason: note ?? null, marketId: inv.marketId });
  return row;
}

export async function dismissInvoiceMatch(db: DbOrTx, actor: Actor, matchId: string, note: string) {
  authorize(actor, "integration.manage");
  if (!note.trim()) throw new BusinessError("Say why this Stripe invoice needs no portal invoice (handled in Stripe, a test, a duplicate)", { field: "note" });
  const [row] = await db
    .update(schema.stripeInvoiceMatch)
    .set({ state: "dismissed", decidedByEmployeeId: actor.employeeId, decidedAt: new Date(), note: note.trim(), updatedAt: new Date() })
    .where(and(eq(schema.stripeInvoiceMatch.id, matchId), eq(schema.stripeInvoiceMatch.state, "suggested")))
    .returning();
  if (!row) throw new StaleStateError("This Stripe invoice was already decided");
  await recordAudit(db, actor, { action: "stripe.invoice_match.dismissed", subjectType: "provider", subjectId: "stripe", current: { stripeInvoiceId: row.stripeInvoiceId }, reason: note.trim() });
  return row;
}
