/**
 * Invoices in Stripe (Round 4, I1 to I9, S4, S6, P3). The portal invoice stays the official one. When the company
 * switch is on, every issued INV is mirrored into Stripe under its own number through an approval item; the Stripe
 * copy is what the due-date debit collects against and what the hosted "pay online" page shows. Checks, EFT and
 * Fintech remittances are recorded by Accounting and marked paid out of band in Stripe, so Stripe's receivables stay
 * whole without anyone being debited.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { SYSTEM_ACTOR, type Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db, DbOrTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { openException } from "@/lib/exceptions/service";
import { gateway, stripeConfigured, verifiedStripeAccount } from "@/lib/integrations/stripe/adapter";
import type { GwInvoiceLineInput } from "@/lib/integrations/stripe/gateway";
import { ProviderUnavailableError, enqueueJob, registerJobHandler } from "@/lib/jobs/queue";
import { formatCents } from "@/lib/domain/catalog/service";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { registerApprovalExecutor, requestApproval, withdrawItemsForSubject, type ApprovalItem, type EmailPayload } from "@/lib/domain/approvals/service";
import { nextBusinessDayOnOrAfter } from "./calendar";
import { ensureStripeCustomer } from "./customers";
import { skuLabel } from "@/lib/domain/catalog/label";

export const JOB_PAID_OUT_OF_BAND = "stripe.invoice.paid_out_of_band";
export const JOB_VOID_MIRROR = "stripe.invoice.void";

export type Payment = typeof schema.payment.$inferSelect;

export const PAYMENT_KIND_LABEL: Record<schema.PaymentKind, string> = {
  stripe_ach: "ACH debit (Stripe)",
  stripe_card: "Card (Stripe)",
  check: "Check",
  eft: "EFT / wire",
  fintech: "Fintech",
  other: "Other",
  refund: "Refund",
};

export const COLLECTION_STATE_LABEL: Record<string, string> = {
  none: "Not in collection",
  scheduled: "Debit scheduled",
  processing: "Payment processing",
  paid: "Paid",
  failed: "Debit returned",
  disputed: "Disputed",
  out_of_band: "Paid outside Stripe",
  uncollectible: "Uncollectible",
};

async function loadInvoice(db: DbOrTx, invoiceId: string) {
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
  if (!inv) throw new BusinessError("Invoice not found");
  return inv;
}

/** Whether this invoice is one Stripe should hold: a charged INV to an account, not legacy. */
export function mirrorable(inv: typeof schema.invoice.$inferSelect): boolean {
  return inv.series === "INV" && !inv.legacy && Boolean(inv.locationId) && inv.totalCents > 0 && (inv.status === "issued" || inv.status === "processing" || inv.status === "paid");
}

/**
 * Queue the Stripe copy of an issued invoice (I1). Called from invoice issue when the company switch is on; also from
 * the invoice page for one invoice. Returns null when nothing is queued (switch off, Stripe not configured, not an INV).
 */
export async function requestInvoiceMirror(db: DbOrTx, actor: Actor, invoiceId: string, opts: { force?: boolean } = {}) {
  const inv = await loadInvoice(db, invoiceId);
  if (!mirrorable(inv)) return null;
  if (inv.stripeInvoiceId) return null;
  if (!stripeConfigured()) return null;
  const settings = await getCompanySettings(db);
  if (!settings.stripeMirrorInvoices && !opts.force) return null;
  // Only accounts that pay through Stripe get a copy on their own (the Owner's default: Fintech and check accounts
  // get the portal PDF); a person can still mirror one deliberately from the invoice page.
  if (inv.payBy !== "stripe" && !opts.force) return null;
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, inv.locationId!));
  const r = await requestApproval(db, actor, {
    kind: "stripe_invoice",
    purpose: "invoice_mirror",
    sender: "stripe",
    title: `${inv.number} into Stripe for ${loc?.tradeName ?? "account"} (${formatCents(inv.totalCents)})`,
    summary: `Due ${inv.dueDate ?? "on terms"}; pays by ${inv.payBy ?? "not set"}. Creates the Stripe invoice under the portal's number; nothing is emailed by Stripe.`,
    payload: { invoiceId: inv.id, number: inv.number },
    amountCents: inv.totalCents,
    subjectType: "invoice",
    subjectId: inv.id,
    marketId: inv.marketId,
    locationId: inv.locationId,
    dedupeKey: `stripe_invoice:${inv.id}`,
  });
  return r;
}

function lineInputs(lines: Array<typeof schema.invoiceLine.$inferSelect>, skus: Map<string, typeof schema.sku.$inferSelect>): GwInvoiceLineInput[] {
  const out: GwInvoiceLineInput[] = [];
  for (const l of lines) {
    if (l.kind === "info" || l.qty === 0) continue;
    const sku = l.skuId ? skus.get(l.skuId) : null;
    const productName = sku ? skuLabel(sku) : l.kind === "deposit" ? "Keg deposit" : l.kind === "freight" ? "Freight" : l.kind === "pos" ? l.description.replace(/ \(no charge\)$/, "") : l.description;
    // Stripe's invoice has no lot column, so the lot rides in the line text (owner, Nov 4).
    out.push({ description: l.lotCode ? `${l.description}, lot ${l.lotCode}` : l.description, quantity: l.qty, unitAmount: l.unitPriceCents, productName, metadata: { fv_line_kind: l.kind, ...(l.skuId ? { fv_sku_id: l.skuId } : {}), ...(sku?.code ? { fv_sku: sku.code } : {}), ...(l.lotCode ? { fv_lot: l.lotCode } : {}) } });
  }
  return out;
}

function unixNoon(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T12:00:00Z`) / 1000);
}

/** The effect of an approved `stripe_invoice` item: create, add the lines, finalise, record what Stripe handed back. */
registerApprovalExecutor("stripe_invoice", async (db: Db, item: ApprovalItem) => {
  const invoiceId = String(item.payload.invoiceId ?? "");
  const inv = await loadInvoice(db, invoiceId);
  if (inv.stripeInvoiceId) return { stripeInvoiceId: inv.stripeInvoiceId, alreadyMirrored: true };
  if (!mirrorable(inv)) throw new Error(`${inv.number ?? inv.id} is ${inv.status}; only an issued, charged INV is mirrored`);
  const binding = await verifiedStripeAccount(db);
  if (!binding) throw new ProviderUnavailableError("Stripe account not verified for the configured credential; run the connectivity check on the Integrations screen");
  const customerId = await ensureStripeCustomer(db, SYSTEM_ACTOR, inv.locationId!);
  if (!customerId) throw new ProviderUnavailableError("The Stripe customer for this account is still being established");
  const gw = gateway();
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, inv.locationId!));
  const lines = await db.select().from(schema.invoiceLine).where(eq(schema.invoiceLine.invoiceId, inv.id)).orderBy(schema.invoiceLine.lineNo);
  const skuIds = lines.map((l) => l.skuId).filter((x): x is string => Boolean(x));
  const skus = new Map((skuIds.length ? await db.select().from(schema.sku).where(inArray(schema.sku.id, skuIds)) : []).map((s) => [s.id, s]));
  const links = await db.select().from(schema.invoiceShipment).where(eq(schema.invoiceShipment.invoiceId, inv.id));
  const shipments = links.length ? await db.select().from(schema.shipment).where(inArray(schema.shipment.id, links.map((l) => l.shipmentId))) : [];
  const customFields: Array<{ name: string; value: string }> = [];
  const pos = Array.from(new Set(shipments.flatMap((s) => s.poNumbers ?? [])));
  if (pos.length) customFields.push({ name: "PO", value: pos.join(", ").slice(0, 140) });
  const bols = shipments.map((s) => s.number).filter((n): n is string => Boolean(n));
  if (bols.length) customFields.push({ name: "BOL", value: bols.join(", ").slice(0, 140) });
  if (loc?.legacyAccountId) customFields.push({ name: "Account", value: loc.legacyAccountId });
  customFields.push({ name: "Terms", value: `Net ${inv.termsDays ?? 30}` });
  const dueIso = inv.dueDate ?? inv.invoiceDate ?? new Date().toISOString().slice(0, 10);
  const metadata: Record<string, string> = { fv_invoice_id: inv.id, fv_invoice_number: inv.number ?? "", fv_location_id: inv.locationId!, fv_market_id: inv.marketId ?? "", fv_pay_by: inv.payBy ?? "", fv_shipments: bols.join(",").slice(0, 400), fv_env: binding.environment };
  const settings = await getCompanySettings(db);
  const base = { customer: customerId, dueDate: unixNoon(dueIso), metadata, customFields, description: inv.fobWording ? `${inv.fobWording}.` : null, footer: `${settings.dba}. Billing questions and remittances: ${settings.arEmail}.${settings.ordersEmail ? ` To reorder: ${settings.ordersEmail}.` : ""}` };
  let created;
  let numberNote: string | null = null;
  try {
    created = await gw.createInvoice({ ...base, number: inv.number }, `fv-inv-${binding.environment}-${inv.id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/number/i.test(msg)) throw err;
    // I2 fallback: Stripe refused the portal's number; the number stays in metadata and the memo, and a case says so.
    numberNote = msg;
    created = await gw.createInvoice({ ...base, number: null, description: `${base.description ? base.description + " " : ""}Portal invoice ${inv.number}.` }, `fv-inv-nonum-${binding.environment}-${inv.id}`);
  }
  await gw.addInvoiceLines(created.id, lineInputs(lines, skus), `fv-inv-lines-${binding.environment}-${inv.id}`);
  const finalised = await gw.finalizeInvoice(created.id, `fv-inv-final-${binding.environment}-${inv.id}`);
  const debitOn = inv.payBy === "stripe" ? nextBusinessDayOnOrAfter(dueIso) : null;
  await db
    .update(schema.invoice)
    .set({
      stripeInvoiceId: finalised.id,
      stripeNumber: finalised.number,
      stripeStatus: finalised.status,
      hostedInvoiceUrl: finalised.hostedInvoiceUrl,
      stripePdfUrl: finalised.invoicePdf,
      mirroredAt: new Date(),
      mirrorError: numberNote,
      debitScheduledOn: inv.status === "paid" ? null : debitOn,
      collectionState: inv.status === "paid" ? inv.collectionState : inv.payBy === "stripe" ? "scheduled" : inv.collectionState,
      updatedAt: new Date(),
    })
    .where(eq(schema.invoice.id, inv.id));
  await recordAudit(db, SYSTEM_ACTOR, { action: "invoice.mirrored", subjectType: "invoice", subjectId: inv.id, current: { stripeInvoiceId: finalised.id, stripeNumber: finalised.number, total: finalised.total, debitScheduledOn: debitOn, numberFallback: Boolean(numberNote) }, marketId: inv.marketId });
  if (finalised.total !== inv.totalCents) {
    await openException(db, SYSTEM_ACTOR, {
      category: "stripe_mismatch",
      title: `${inv.number}: Stripe total ${formatCents(finalised.total)} differs from the portal's ${formatCents(inv.totalCents)}`,
      cause: "The Stripe copy was created from the portal lines but its total does not match; nothing is debited until this is understood.",
      marketId: inv.marketId,
      locationId: inv.locationId,
      ownerRole: "accounting",
      nextAction: "Compare the lines in Stripe with the portal invoice; void the Stripe copy and mirror again if the lines were wrong.",
      dedupeKey: `stripe_mismatch:${inv.id}`,
      links: [{ subjectType: "invoice", subjectId: inv.id }],
    });
  }
  if (numberNote) {
    await openException(db, SYSTEM_ACTOR, {
      category: "stripe_number_fallback",
      title: `${inv.number}: Stripe would not take the portal's number`,
      cause: `${numberNote}. The Stripe copy is ${finalised.number}; the portal number is in its memo and metadata.`,
      marketId: inv.marketId,
      locationId: inv.locationId,
      ownerRole: "accounting",
      nextAction: "Check the account's invoice numbering settings in the Stripe dashboard (question 3 of the Stripe plan).",
      dedupeKey: `stripe_number_fallback:${inv.id}`,
      links: [{ subjectType: "invoice", subjectId: inv.id }],
    });
  }
  // Paid in the portal before the copy existed (a check that arrived early): tell Stripe straight away.
  if (inv.status === "paid") await enqueueJob(db, JOB_PAID_OUT_OF_BAND, { invoiceId: inv.id }, { dedupeKey: `${JOB_PAID_OUT_OF_BAND}:${inv.id}`, maxAttempts: 3 });
  return { stripeInvoiceId: finalised.id, stripeNumber: finalised.number, hostedInvoiceUrl: finalised.hostedInvoiceUrl, total: finalised.total, debitScheduledOn: debitOn, numberFallback: Boolean(numberNote) };
});

/**
 * Accounting records a payment that arrived outside Stripe (a check, an EFT, a Fintech remittance) (S4). The invoice is
 * paid in the portal and, when it has a Stripe copy, marked paid out of band there, so no debit ever runs for it.
 */
export async function recordPaymentReceived(
  db: DbOrTx,
  actor: Actor,
  invoiceId: string,
  input: { kind: "check" | "eft" | "fintech" | "other"; amountCents?: number | null; reference?: string | null; note?: string | null; receivedOn?: string | null },
) {
  const inv = await loadInvoice(db, invoiceId);
  authorize(actor, "invoice.issue", { marketId: inv.marketId });
  if (inv.status === "processing") throw new BusinessError(`${inv.number} has a debit in flight (about four business days); wait for Stripe's result before recording another payment`);
  if (inv.status !== "issued") throw new StaleStateError(`Only an issued invoice can be marked paid (this one is ${inv.status})`);
  if (input.receivedOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.receivedOn)) throw new BusinessError("Date must be YYYY-MM-DD", { field: "receivedOn" });
  const credited = await db.select({ total: schema.creditMemo.amountCents }).from(schema.creditMemo).where(and(eq(schema.creditMemo.invoiceId, inv.id), eq(schema.creditMemo.status, "issued")));
  const net = inv.totalCents - credited.reduce((s, c) => s + c.total, 0);
  const amount = input.amountCents ?? net;
  if (!Number.isInteger(amount) || amount <= 0) throw new BusinessError("Enter the amount received", { field: "amount" });
  const occurredAt = input.receivedOn ? new Date(`${input.receivedOn}T12:00:00Z`) : new Date();
  const [pay] = await db
    .insert(schema.payment)
    .values({ invoiceId: inv.id, locationId: inv.locationId, marketId: inv.marketId, kind: input.kind, amountCents: amount, state: "succeeded", reference: input.reference?.trim() || null, note: input.note?.trim() || null, occurredAt, settledAt: occurredAt, recordedByEmployeeId: actor.employeeId })
    .returning();
  const shortBy = net - amount;
  const noteLine = `${PAYMENT_KIND_LABEL[input.kind]}${input.reference ? ` ${input.reference.trim()}` : ""} received${input.receivedOn ? ` ${input.receivedOn}` : ""}${shortBy > 0 ? ` (short by ${formatCents(shortBy)})` : shortBy < 0 ? ` (over by ${formatCents(-shortBy)})` : ""}${input.note ? `: ${input.note.trim()}` : ""}`;
  const [row] = await db
    .update(schema.invoice)
    .set({ status: "paid", paidAt: occurredAt, paidVia: input.kind, paidReference: input.reference?.trim() || null, collectionState: "out_of_band", debitScheduledOn: null, notes: `${inv.notes ? inv.notes + "\n" : ""}${noteLine}`, updatedAt: new Date() })
    .where(and(eq(schema.invoice.id, inv.id), eq(schema.invoice.status, "issued")))
    .returning();
  if (!row) throw new StaleStateError("The invoice changed a moment ago; reload");
  await recordAudit(db, actor, { action: "invoice.paid", subjectType: "invoice", subjectId: inv.id, prior: { status: "issued" }, current: { status: "paid", kind: input.kind, amountCents: amount, reference: input.reference ?? null, paymentId: pay.id, shortBy }, marketId: inv.marketId });
  await withdrawItemsForSubject(db, actor, { subjectType: "invoice", subjectId: inv.id, kinds: ["stripe_debit"], reason: `Paid by ${PAYMENT_KIND_LABEL[input.kind]}` });
  if (shortBy !== 0) {
    await openException(db, actor, {
      category: shortBy > 0 ? "short_pay" : "over_pay",
      title: `${inv.number}: paid ${formatCents(amount)} against ${formatCents(net)}`,
      cause: shortBy > 0 ? `Short by ${formatCents(shortBy)}. Decide whether to credit the difference (a credit memo with a reason) or chase it.` : `Over by ${formatCents(-shortBy)}. Decide whether to credit it against the next invoice or refund it.`,
      marketId: inv.marketId,
      locationId: inv.locationId,
      ownerRole: "accounting",
      nextAction: shortBy > 0 ? "Issue a credit memo for the difference or follow up with the account; never silently." : "Record the credit against the next invoice or arrange a refund with the Owner.",
      dedupeKey: `${shortBy > 0 ? "short_pay" : "over_pay"}:${inv.id}`,
      links: [{ subjectType: "invoice", subjectId: inv.id }],
    });
  }
  if (row.stripeInvoiceId) await enqueueJob(db, JOB_PAID_OUT_OF_BAND, { invoiceId: inv.id }, { dedupeKey: `${JOB_PAID_OUT_OF_BAND}:${inv.id}`, maxAttempts: 3 });
  return { invoice: row, payment: pay };
}

registerJobHandler(JOB_PAID_OUT_OF_BAND, {
  ready: async (db) => stripeConfigured() && (await verifiedStripeAccount(db)) !== null,
  run: async (db: Db, payload) => {
    const inv = await loadInvoice(db, String(payload.invoiceId ?? ""));
    if (!inv.stripeInvoiceId) return;
    const binding = await verifiedStripeAccount(db);
    if (!binding) throw new ProviderUnavailableError("Stripe account not verified; marking paid out of band resumes after the connectivity check");
    const gw = gateway();
    const current = await gw.retrieveInvoice(inv.stripeInvoiceId);
    if (!current) return;
    if (current.status === "paid" || current.status === "void") {
      await db.update(schema.invoice).set({ stripeStatus: current.status, updatedAt: new Date() }).where(eq(schema.invoice.id, inv.id));
      return;
    }
    const paid = await gw.payInvoice(inv.stripeInvoiceId, { paidOutOfBand: true }, `fv-oob-${binding.environment}-${inv.id}`);
    await db.update(schema.invoice).set({ stripeStatus: paid.status, updatedAt: new Date() }).where(eq(schema.invoice.id, inv.id));
    await recordAudit(db, SYSTEM_ACTOR, { action: "invoice.stripe_paid_out_of_band", subjectType: "invoice", subjectId: inv.id, current: { stripeInvoiceId: inv.stripeInvoiceId, stripeStatus: paid.status }, marketId: inv.marketId });
  },
});

/** The portal voided an invoice that has a Stripe copy (I8): void the copy too (automatic; a mirror of a portal fact). */
export async function queueVoidMirror(db: DbOrTx, invoiceId: string) {
  const inv = await loadInvoice(db, invoiceId);
  if (!inv.stripeInvoiceId) return null;
  return enqueueJob(db, JOB_VOID_MIRROR, { invoiceId }, { dedupeKey: `${JOB_VOID_MIRROR}:${invoiceId}`, maxAttempts: 3 });
}

registerJobHandler(JOB_VOID_MIRROR, {
  ready: async (db) => stripeConfigured() && (await verifiedStripeAccount(db)) !== null,
  run: async (db: Db, payload) => {
    const inv = await loadInvoice(db, String(payload.invoiceId ?? ""));
    if (!inv.stripeInvoiceId) return;
    const binding = await verifiedStripeAccount(db);
    if (!binding) throw new ProviderUnavailableError("Stripe account not verified; the void resumes after the connectivity check");
    const gw = gateway();
    const current = await gw.retrieveInvoice(inv.stripeInvoiceId);
    if (!current || current.status === "void") {
      await db.update(schema.invoice).set({ stripeStatus: "void", updatedAt: new Date() }).where(eq(schema.invoice.id, inv.id));
      return;
    }
    if (current.status === "paid") {
      await openException(db, SYSTEM_ACTOR, {
        category: "stripe_mismatch",
        title: `${inv.number} was voided in the portal but is paid in Stripe`,
        cause: "A paid Stripe invoice cannot be voided. The payment must be refunded or credited deliberately.",
        marketId: inv.marketId,
        locationId: inv.locationId,
        ownerRole: "accounting",
        nextAction: "Decide with the Owner: refund in Stripe, or issue a credit note against the next invoice.",
        dedupeKey: `stripe_mismatch:${inv.id}`,
        links: [{ subjectType: "invoice", subjectId: inv.id }],
      });
      return;
    }
    const voided = await gw.voidInvoice(inv.stripeInvoiceId);
    await db.update(schema.invoice).set({ stripeStatus: voided.status, collectionState: "none", debitScheduledOn: null, updatedAt: new Date() }).where(eq(schema.invoice.id, inv.id));
    await recordAudit(db, SYSTEM_ACTOR, { action: "invoice.stripe_voided", subjectType: "invoice", subjectId: inv.id, current: { stripeInvoiceId: inv.stripeInvoiceId }, marketId: inv.marketId });
  },
});

/** Recipients for anything about an invoice: the account's contacts who receive invoices (AP first). */
export async function invoiceRecipients(db: DbOrTx, locationId: string): Promise<string[]> {
  const rows = await db
    .select({ email: schema.contact.email, role: schema.locationContact.contactRole })
    .from(schema.locationContact)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
    .where(and(eq(schema.locationContact.locationId, locationId), eq(schema.locationContact.current, true), eq(schema.locationContact.receivesInvoices, true)));
  const emails = rows.sort((a, b) => (a.role === "ap" ? -1 : 0) - (b.role === "ap" ? -1 : 0)).map((r) => r.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e));
  return Array.from(new Set(emails));
}

/** Queue the invoice email to the customer (from orders@): the portal's PDF attached, the Stripe pay-online link when there is one (I6, P3). */
export async function requestInvoiceEmail(db: DbOrTx, actor: Actor, invoiceId: string, opts: { to?: string[] | null; note?: string | null } = {}) {
  const inv = await loadInvoice(db, invoiceId);
  authorize(actor, "invoice.issue", { marketId: inv.marketId });
  if (inv.status !== "issued" && inv.status !== "processing" && inv.status !== "paid") throw new BusinessError(`Only an issued invoice is sent (${inv.number ?? "this one"} is ${inv.status})`);
  if (!inv.locationId) throw new BusinessError("The invoice has no account");
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, inv.locationId));
  const settings = await getCompanySettings(db);
  const to = opts.to?.length ? opts.to : await invoiceRecipients(db, inv.locationId);
  if (!to.length) throw new BusinessError("No contact on this account receives invoices; add an AP contact with an email first");
  const payload: EmailPayload = {
    to,
    subject: `${settings.dba} invoice ${inv.number} for ${loc?.tradeName ?? "your account"}`,
    body: [
      `Hello,`,
      "",
      `Attached is invoice ${inv.number} for ${formatCents(inv.totalCents)}, dated ${inv.invoiceDate ?? ""}, due ${inv.dueDate ?? "on terms"} (Net ${inv.termsDays ?? 30}).`,
      ...(inv.payBy === "stripe" && inv.debitScheduledOn ? ["", `Per your ACH authorisation the amount due will be debited on ${inv.debitScheduledOn}.`] : []),
      ...(inv.hostedInvoiceUrl ? ["", `View or pay online: ${inv.hostedInvoiceUrl}`] : []),
      ...(opts.note?.trim() ? ["", opts.note.trim()] : []),
      "",
      "Thank you,",
      settings.dba,
      settings.customerSenderAddress,
    ].join("\n"),
    attachments: [{ kind: "invoice_pdf", invoiceId: inv.id }],
  };
  return requestApproval(db, actor, {
    kind: "email",
    purpose: "invoice_email",
    sender: "orders@",
    title: `Invoice ${inv.number} to ${loc?.tradeName ?? "account"} (${formatCents(inv.totalCents)})`,
    summary: `To ${to.join(", ")}; PDF attached${inv.hostedInvoiceUrl ? ", pay-online link included" : ""}.`,
    payload: payload as unknown as Record<string, unknown>,
    amountCents: inv.totalCents,
    subjectType: "invoice",
    subjectId: inv.id,
    marketId: inv.marketId,
    locationId: inv.locationId,
    dedupeKey: `invoice_email:${inv.id}`,
  });
}

/** A payment receipt for the customer, queued for approval like everything else (Owner, Nov 4: receipts go out, through the queue). */
export async function requestPaymentReceipt(db: DbOrTx, invoiceId: string, payment: Payment) {
  const inv = await loadInvoice(db, invoiceId);
  if (!inv.locationId) return null;
  const to = await invoiceRecipients(db, inv.locationId);
  if (!to.length) return null;
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, inv.locationId));
  const settings = await getCompanySettings(db);
  const payload: EmailPayload = {
    to,
    subject: `${settings.dba}: payment received for invoice ${inv.number}`,
    body: [`Hello,`, "", `We received ${formatCents(payment.amountCents)} for invoice ${inv.number} (${PAYMENT_KIND_LABEL[payment.kind]}${payment.reference ? `, ${payment.reference}` : ""}). Thank you.`, "", settings.dba, settings.customerSenderAddress].join("\n"),
  };
  return requestApproval(db, SYSTEM_ACTOR, {
    kind: "email",
    purpose: "payment_receipt",
    sender: "orders@",
    title: `Receipt for ${inv.number} to ${loc?.tradeName ?? "account"} (${formatCents(payment.amountCents)})`,
    summary: `To ${to.join(", ")}.`,
    payload: payload as unknown as Record<string, unknown>,
    amountCents: payment.amountCents,
    subjectType: "invoice",
    subjectId: inv.id,
    marketId: inv.marketId,
    locationId: inv.locationId,
    dedupeKey: `payment_receipt:${payment.id}`,
  });
}

export async function paymentsForInvoice(db: DbOrTx, invoiceId: string) {
  return db.select().from(schema.payment).where(eq(schema.payment.invoiceId, invoiceId)).orderBy(desc(schema.payment.occurredAt));
}

export async function paymentsForLocation(db: DbOrTx, locationId: string, limit = 50) {
  return db
    .select({ p: schema.payment, inv: schema.invoice })
    .from(schema.payment)
    .leftJoin(schema.invoice, eq(schema.invoice.id, schema.payment.invoiceId))
    .where(eq(schema.payment.locationId, locationId))
    .orderBy(desc(schema.payment.occurredAt))
    .limit(limit);
}
