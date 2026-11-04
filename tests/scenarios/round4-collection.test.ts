/**
 * Round 4: the approval queue, Stripe as the money ledger (customers, bank setup, mirrored invoices, the due-date
 * debit, returns, credit notes, out-of-band payments, reconciliation, payouts, the one-time match with the ACH app),
 * the processing state and the overdue sweep, the business-day calendar, and the Finance reports. Stripe is the
 * in-memory fake; every event it would send is delivered to the webhook receiver.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { SYSTEM_ACTOR } from "@/lib/authz/actor";
import { sweepOverdueInvoices } from "@/lib/domain/alerts/service";
import { approvalsForSubject, approveItem, listApprovals, recordManualSend, rejectItem, requestApproval } from "@/lib/domain/approvals/service";
import { setupLinkFor } from "@/lib/domain/approvals/email";
import {
  arAging,
  chaseUnfinishedSetups,
  cfoExportCsv,
  confirmCustomerMatch,
  debitEligibility,
  importStripeCustomersForMatching,
  importStripeInvoicesForMatching,
  isBusinessDay,
  linkStripeInvoice,
  listCustomerMatches,
  listInvoiceMatches,
  listPayoutsWithDetail,
  nextBusinessDayOnOrAfter,
  paymentsForInvoice,
  reconcileWithStripe,
  recordPaymentReceived,
  requestBankSetupLink,
  requestInvoiceEmail,
  requestInvoiceMirror,
  requestRePresent,
  scheduleDueDateDebits,
  syncPayouts,
} from "@/lib/domain/collection";
import { setMarketPrice } from "@/lib/domain/catalog/service";
import { getLocation } from "@/lib/domain/customers/service";
import { setCollectionSwitches, updateAccountShipping } from "@/lib/domain/customers/shipping";
import { getInvoice, issueCreditMemo, markInvoicePaid, voidInvoice } from "@/lib/domain/invoices/service";
import { recordPackagingReport } from "@/lib/domain/lots/service";
import { updateOrigin } from "@/lib/domain/origins/service";
import { submitOrder } from "@/lib/domain/orders/service";
import { setPayerContact } from "@/lib/domain/payment/service";
import { updateCompanySettings } from "@/lib/domain/settings/service";
import { confirmShipment, deliverShipment, getShipment } from "@/lib/domain/shipments/service";
import { checkStripeConnection, receiveStripeWebhook } from "@/lib/integrations/stripe/adapter";
import { useFakeStripe } from "@/lib/integrations/stripe/gateway";
import type { FakeStripe } from "@/lib/integrations/stripe/fake";
import { runDueJobs } from "@/lib/jobs/queue";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

let db: Db;
let close: () => Promise<void>;
let f: Fixture;
let fake: FakeStripe;
let bar: typeof schema.customerLocation.$inferSelect;
let distributor: typeof schema.customerLocation.$inferSelect;
const savedKey = process.env.STRIPE_SECRET_KEY;

/** Deliver every event the fake produced to the portal, as Stripe would. */
async function pump() {
  for (const e of fake.drainEvents()) await receiveStripeWebhook(db, JSON.stringify(e), "fake");
}

/** An order delivered in full: returns the issued invoice. */
async function deliveredInvoice(locationId: string, lines: Array<{ skuId: string; qty: number }>, dates = { scheduled: "2026-11-10", actual: "2026-11-10" }) {
  const res = await submitOrder(db, f.admin, { locationId, source: "phone", lines, shortfallDecision: "ship_available", shortfallReason: "test" });
  const confirmed = await confirmShipment(db, f.admin, res.shipment!.id, { scheduledDate: dates.scheduled });
  await deliverShipment(db, f.admin, confirmed.id, { actualDate: dates.actual });
  const s = (await getShipment(db, confirmed.id))!;
  return (await getInvoice(db, s.invoices[0].id))!.invoice;
}

beforeAll(async () => {
  delete process.env.STRIPE_SECRET_KEY;
  fake = useFakeStripe();
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
  await updateOrigin(db, f.owner, f.warehouse.id, { originCode: "EBB", kind: "brewery", lotFacilityCode: "01" });
  await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", packagingDate: "2026-10-07", runCode: "1", quantities: [{ skuId: f.skus.cantinescaSixtel.id, qty: 200 }, { skuId: f.skus.cantinescaCase.id, qty: 400 }] });
  bar = (await makeLocation(db, f.sales, f.market.id, "Collection Bar", { ap: { name: "Pat Payables", email: "ap@collectionbar.example.test" } })).location;
  await updateAccountShipping(db, f.admin, bar.id, { payBy: "stripe", depositMode: "none" });
  distributor = (await makeLocation(db, f.sales, f.market.id, "Tracked Distributing", { ap: { name: "AP Tracked", email: "ap@tracked.example.test" } })).location;
  await updateAccountShipping(db, f.admin, distributor.id, { kind: "distributor", payBy: "check", depositMode: "none" });
  for (const [skuId, cents] of [[f.skus.cantinescaCase.id, 2196], [f.skus.cantinescaSixtel.id, 6840]] as const) {
    await setMarketPrice(db, f.admin, { marketId: f.market.id, skuId, tier: "distributor", priceCents: cents });
  }
  const ap = (await getLocation(db, bar.id))!.contacts.find((c) => c.contactRole === "ap")!;
  await setPayerContact(db, f.accounting, bar.id, ap.contactId);
  const check = await checkStripeConnection(db);
  expect(check.ok).toBe(true);
  await updateCompanySettings(db, f.owner, { stripeMirrorInvoices: true });
});
afterAll(async () => {
  if (savedKey !== undefined) process.env.STRIPE_SECRET_KEY = savedKey;
  await close();
});

describe("Business days", () => {
  it("a due date on a Saturday, Sunday or bank holiday debits on the next business day", () => {
    expect(nextBusinessDayOnOrAfter("2026-11-07")).toBe("2026-11-09"); // Saturday to Monday
    expect(nextBusinessDayOnOrAfter("2026-11-08")).toBe("2026-11-09"); // Sunday to Monday
    expect(nextBusinessDayOnOrAfter("2026-11-26")).toBe("2026-11-27"); // Thanksgiving to Friday
    expect(nextBusinessDayOnOrAfter("2026-12-25")).toBe("2026-12-28"); // Christmas (Friday) to Monday
    expect(nextBusinessDayOnOrAfter("2027-07-05")).toBe("2027-07-06"); // July 4 2027 is a Sunday, observed Monday
    expect(isBusinessDay("2026-11-10")).toBe(true);
  });
});

describe("The approval queue", () => {
  it("an item waits, a person approves or rejects it, and a manual email is recorded with evidence", async () => {
    const r = await requestApproval(db, f.admin, { kind: "email", purpose: "custom", sender: "orders@", title: "Hello to a customer", payload: { to: ["buyer@example.test"], subject: "Hi", body: "Text" }, subjectType: "customer_location", subjectId: bar.id, locationId: bar.id, marketId: bar.marketId, dedupeKey: "test:hello" });
    expect(r.created).toBe(true);
    expect(r.item.state).toBe("pending");
    const again = await requestApproval(db, f.admin, { kind: "email", purpose: "custom", sender: "orders@", title: "Hello again", payload: {}, subjectType: "customer_location", subjectId: bar.id, dedupeKey: "test:hello" });
    expect(again.created).toBe(false);
    // Sales cannot decide.
    await expect(approveItem(db, f.sales, r.item.id)).rejects.toThrow();
    // Approved with the send switch off: manual transport, nothing runs, a person records the send.
    const approved = await approveItem(db, f.accounting, r.item.id, "fine");
    expect(approved.transport).toBe("manual");
    await runDueJobs(db);
    const sent = await recordManualSend(db, f.accounting, r.item.id, { outcome: "sent", sentVia: "Gmail from orders@", evidence: "msg-1" });
    expect(sent.state).toBe("done");
    const r2 = await requestApproval(db, f.admin, { kind: "email", purpose: "custom", sender: "orders@", title: "Second", payload: { to: ["x@example.test"], subject: "s", body: "b" }, subjectType: "customer_location", subjectId: bar.id });
    const rejected = await rejectItem(db, f.admin, r2.item.id, "not needed");
    expect(rejected.state).toBe("rejected");
    await expect(rejectItem(db, f.admin, r2.item.id, "again")).rejects.toThrow(/already/);
    const list = await listApprovals(db, f.admin, { states: ["done", "rejected"] });
    expect(list.map((x) => x.item.id)).toEqual(expect.arrayContaining([r.item.id, r2.item.id]));
  });
});

describe("Bank setup through Stripe's hosted page (B1 to B4, B6, B8)", () => {
  it("the setup email is queued, the link is generated when sent, the bank arrives by webhook and becomes the default", async () => {
    const r = await requestBankSetupLink(db, f.accounting, bar.id);
    expect(r.item.kind).toBe("email");
    expect(r.item.purpose).toBe("payment_setup_link");
    const cust = await db.select().from(schema.providerReference).where(and(eq(schema.providerReference.subjectId, bar.id), eq(schema.providerReference.providerObject, "customer")));
    expect(cust[0].providerId).toMatch(/^cus_fake/);
    expect(fake.customers.get(cust[0].providerId!)!.metadata.fv_location_id).toBe(bar.id);
    // Generated for a hand-sent email: a Stripe-hosted URL, bearer, never stored in the payload.
    const url = await setupLinkFor(db, r.item);
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.test/);
    expect(JSON.stringify(r.item.payload)).not.toContain("checkout.stripe.test");
    await recordManualSend(db, f.accounting, r.item.id, { outcome: "sent", sentVia: "Gmail from orders@", evidence: "msg-2" });
    const [rel0] = await db.select().from(schema.paymentRelationship).where(and(eq(schema.paymentRelationship.locationId, bar.id), eq(schema.paymentRelationship.current, true)));
    expect(rel0.setupLinkSentAt).not.toBeNull();
    const session = [...fake.sessions.values()][0];
    fake.completeSetup(session.id, { bankName: "Wells Fargo", last4: "4242", instant: true });
    await pump();
    const [rel] = await db.select().from(schema.paymentRelationship).where(and(eq(schema.paymentRelationship.locationId, bar.id), eq(schema.paymentRelationship.current, true)));
    expect(rel.verificationState).toBe("verified");
    expect(rel.bankLast4).toBe("4242");
    expect(rel.setupState).toBe("method_usable");
    expect(rel.paymentMethodId).toMatch(/^pm_fake/);
    expect(rel.mandateId).toMatch(/^mandate_fake/);
    expect(fake.customers.get(cust[0].providerId!)!.defaultPaymentMethod).toBe(rel.paymentMethodId);
    // Nothing to chase once the bank is on file.
    expect((await chaseUnfinishedSetups(db, new Date("2026-12-01T00:00:00Z"))).opened).toBe(0);
  });

  it("a setup not finished for days opens a chase case; a removed bank revokes and flags", async () => {
    const other = (await makeLocation(db, f.sales, f.market.id, "Slow Setup Bistro", { ap: { name: "Slow AP", email: "ap@slowsetup.example.test" } })).location;
    await updateAccountShipping(db, f.admin, other.id, { payBy: "stripe" });
    const ap = (await getLocation(db, other.id))!.contacts.find((c) => c.contactRole === "ap")!;
    await setPayerContact(db, f.accounting, other.id, ap.contactId);
    const r = await requestBankSetupLink(db, f.accounting, other.id);
    await recordManualSend(db, f.accounting, r.item.id, { outcome: "sent", sentVia: "by hand", evidence: "msg-3" });
    const chased = await chaseUnfinishedSetups(db, new Date(Date.now() + 10 * 86_400_000));
    expect(chased.opened).toBe(1);
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `payment_setup_unfinished:${other.id}`));
    expect(c.state).toBe("open");
    // The bar's bank is removed on the Stripe side.
    const [rel] = await db.select().from(schema.paymentRelationship).where(and(eq(schema.paymentRelationship.locationId, bar.id), eq(schema.paymentRelationship.current, true)));
    const pmId = rel.paymentMethodId!;
    fake.detachBank(pmId);
    await pump();
    const [after] = await db.select().from(schema.paymentRelationship).where(eq(schema.paymentRelationship.id, rel.id));
    expect(after.setupState).toBe("revoked");
    const [rev] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `payment_revocation:${bar.id}`));
    expect(rev.state).toBe("open");
    // Connect again for the rest of the file.
    const r2 = await requestBankSetupLink(db, f.accounting, bar.id);
    await setupLinkFor(db, r2.item);
    await recordManualSend(db, f.accounting, r2.item.id, { outcome: "sent", sentVia: "by hand", evidence: "msg-4" });
    const session = [...fake.sessions.values()].at(-1)!;
    fake.completeSetup(session.id, { bankName: "Chase", last4: "9001", instant: true });
    await pump();
    const [again] = await db.select().from(schema.paymentRelationship).where(eq(schema.paymentRelationship.id, rel.id));
    expect(again.setupState).toBe("method_usable");
    expect(again.bankLast4).toBe("9001");
    expect(again.directRevocationAt).toBeNull();
    const [revAfter] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.id, rev.id));
    expect(revAfter.state).toBe("resolved");
  });
});

describe("Invoices into Stripe, the due-date debit, settlement and returns (I1 to I8, P1, P5, S1 to S3)", () => {
  let invoiceId: string;
  it("a delivered invoice is mirrored through an approval item under its own number, with the debit date on the next business day", async () => {
    // Due date lands on a Saturday (Nov 10 + 30 = Dec 10, Thursday) so use Nov 7 + 30 = Dec 7 (Monday)... pick Nov 8 delivery: due Dec 8.
    const inv = await deliveredInvoice(bar.id, [{ skuId: f.skus.cantinescaSixtel.id, qty: 2 }, { skuId: f.skus.cantinescaCase.id, qty: 3 }], { scheduled: "2026-11-05", actual: "2026-11-05" });
    invoiceId = inv.id;
    expect(inv.status).toBe("issued");
    expect(inv.payBy).toBe("stripe");
    expect(inv.dueDate).toBe("2026-12-05"); // a Saturday
    const items = await approvalsForSubject(db, "invoice", inv.id);
    const mirror = items.find((i) => i.kind === "stripe_invoice")!;
    expect(mirror.state).toBe("pending");
    expect(mirror.amountCents).toBe(inv.totalCents);
    await approveItem(db, f.accounting, mirror.id);
    await runDueJobs(db);
    const after = (await getInvoice(db, inv.id))!.invoice;
    expect(after.stripeInvoiceId).toMatch(/^in_fake/);
    expect(after.stripeNumber).toBe(inv.number); // I2: the portal's number
    expect(after.stripeStatus).toBe("open");
    expect(after.hostedInvoiceUrl).toMatch(/^https:\/\/invoice\.stripe\.test/);
    expect(after.collectionState).toBe("scheduled");
    expect(after.debitScheduledOn).toBe("2026-12-07"); // Saturday due date, Monday debit
    const remote = fake.invoices.get(after.stripeInvoiceId!)!;
    expect(remote.total).toBe(inv.totalCents);
    expect(remote.lines.length).toBe(2);
    expect(remote.metadata.fv_invoice_id).toBe(inv.id);
    expect(fake.calls.some((c) => c.method === "finalizeInvoice")).toBe(true);
    // The overdue sweep leaves it alone on the Sunday between the due date and the debit date.
    await pump();
    const swept = await sweepOverdueInvoices(db, SYSTEM_ACTOR, new Date("2026-12-06T20:00:00Z"));
    expect(swept.opened).toBe(0);
  });

  it("the debit waits for approval, runs against the bank on file, moves the invoice to processing, and settles paid with a receipt queued", async () => {
    const before = await scheduleDueDateDebits(db, new Date("2026-12-04T20:00:00Z"));
    expect(before.queued).toBe(0); // not yet
    const r = await scheduleDueDateDebits(db, new Date("2026-12-07T20:00:00Z"));
    expect(r.queued).toBe(1);
    const items = await approvalsForSubject(db, "invoice", invoiceId);
    const debit = items.find((i) => i.kind === "stripe_debit")!;
    expect(debit.state).toBe("pending"); // the account's auto-debit switch is off
    const e = await debitEligibility(db, (await getInvoice(db, invoiceId))!.invoice);
    expect(e.ok).toBe(true);
    await approveItem(db, f.accounting, debit.id);
    await runDueJobs(db);
    let inv = (await getInvoice(db, invoiceId))!.invoice;
    expect(inv.status).toBe("processing");
    expect(inv.collectionState).toBe("processing");
    expect(inv.paymentIntentId).toMatch(/^pi_fake/);
    await pump();
    // While processing: never overdue, never paid by hand, never voided.
    expect((await sweepOverdueInvoices(db, SYSTEM_ACTOR, new Date("2026-12-20T20:00:00Z"))).opened).toBe(0);
    await expect(markInvoicePaid(db, f.accounting, invoiceId, "check arrived")).rejects.toThrow(/in flight/);
    await expect(voidInvoice(db, f.admin, invoiceId, "oops")).rejects.toThrow(/in flight/);
    const aging = await arAging(db, f.owner, "2026-12-20");
    expect(aging.rows.find((row) => row.locationId === bar.id)?.invoices.some((i) => i.id === invoiceId)).toBe(true);
    // Settles four business days later.
    fake.settleDebit(inv.paymentIntentId!);
    await pump();
    inv = (await getInvoice(db, invoiceId))!.invoice;
    expect(inv.status).toBe("paid");
    expect(inv.collectionState).toBe("paid");
    expect(inv.paidVia).toBe("stripe_ach");
    const pays = await paymentsForInvoice(db, invoiceId);
    expect(pays.length).toBe(1);
    expect(pays[0].state).toBe("succeeded");
    const receipt = (await approvalsForSubject(db, "invoice", invoiceId)).find((i) => i.purpose === "payment_receipt");
    expect(receipt?.state).toBe("pending"); // receipts go out, through the queue
  });

  it("a returned debit puts the invoice back to issued with the return code, opens a case, and re-presentment follows the NACHA limits", async () => {
    const inv0 = await deliveredInvoice(bar.id, [{ skuId: f.skus.cantinescaCase.id, qty: 4 }], { scheduled: "2026-11-02", actual: "2026-11-02" });
    const mirror = (await approvalsForSubject(db, "invoice", inv0.id)).find((i) => i.kind === "stripe_invoice")!;
    await approveItem(db, f.accounting, mirror.id);
    await runDueJobs(db);
    await pump();
    await setCollectionSwitches(db, f.admin, bar.id, { autoDebit: true }, "trusted account");
    const r = await scheduleDueDateDebits(db, new Date("2026-12-03T20:00:00Z"));
    expect(r.queued).toBe(1);
    const debit = (await approvalsForSubject(db, "invoice", inv0.id)).find((i) => i.kind === "stripe_debit")!;
    expect(debit.state).toBe("approved"); // auto-debit switch
    expect(debit.autoApproved).toBe(true);
    await runDueJobs(db);
    let inv = (await getInvoice(db, inv0.id))!.invoice;
    expect(inv.status).toBe("processing");
    fake.returnDebit(inv.paymentIntentId!, "R01", "Insufficient funds");
    await pump();
    inv = (await getInvoice(db, inv0.id))!.invoice;
    expect(inv.status).toBe("issued");
    expect(inv.collectionState).toBe("failed");
    expect(inv.failureCode).toBe("R01");
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `payment_returned:${inv0.id}`));
    expect(c.state).toBe("open");
    expect((await paymentsForInvoice(db, inv0.id))[0].state).toBe("failed");
    // Nothing retried on its own; a person re-presents (allowed for R01), and it is a new approval item.
    expect((await scheduleDueDateDebits(db, new Date("2026-12-04T20:00:00Z"))).queued).toBe(0);
    const rp = await requestRePresent(db, f.accounting, inv0.id, "customer confirmed funds");
    expect(rp.item.purpose).toBe("re_present");
    expect(rp.item.state).toBe("pending");
    await approveItem(db, f.accounting, rp.item.id);
    await runDueJobs(db);
    inv = (await getInvoice(db, inv0.id))!.invoice;
    expect(inv.status).toBe("processing");
    fake.returnDebit(inv.paymentIntentId!, "R29", "Corporate customer advises not authorized");
    await pump();
    inv = (await getInvoice(db, inv0.id))!.invoice;
    expect(inv.collectionState).toBe("failed");
    // An authorisation return is never presented again, and the bank is treated as revoked.
    await expect(requestRePresent(db, f.accounting, inv0.id, "try again")).rejects.toThrow(/not authori/);
    const [rel] = await db.select().from(schema.paymentRelationship).where(and(eq(schema.paymentRelationship.locationId, bar.id), eq(schema.paymentRelationship.current, true)));
    expect(rel.setupState).toBe("revoked");
    // Accounting records a check instead: paid, and Stripe is told out of band.
    const paid = await recordPaymentReceived(db, f.accounting, inv0.id, { kind: "check", reference: "1042", receivedOn: "2026-12-08" });
    expect(paid.invoice.status).toBe("paid");
    expect(paid.invoice.collectionState).toBe("out_of_band");
    await runDueJobs(db);
    expect(fake.invoices.get(inv.stripeInvoiceId!)!.status).toBe("paid");
    expect(fake.invoices.get(inv.stripeInvoiceId!)!.paidOutOfBand).toBe(true);
    // Put the bank back for later tests.
    await setCollectionSwitches(db, f.admin, bar.id, { autoDebit: false }, "back to approvals");
    await db.update(schema.paymentRelationship).set({ setupState: "method_usable", directRevocationAt: null, verificationState: "verified" }).where(eq(schema.paymentRelationship.id, rel.id));
  });

  it("a short check payment opens a short-pay case; a distributor invoice is tracked, never debited, and marked paid by hand", async () => {
    const inv = await deliveredInvoice(distributor.id, [{ skuId: f.skus.cantinescaCase.id, qty: 10 }], { scheduled: "2026-11-03", actual: "2026-11-03" });
    // Pays by check: no Stripe copy on its own (the portal PDF is the invoice); a person can still ask for one.
    expect((await approvalsForSubject(db, "invoice", inv.id)).some((i) => i.kind === "stripe_invoice")).toBe(false);
    const asked = await requestInvoiceMirror(db, f.accounting, inv.id, { force: true });
    const mirror = asked!.item;
    await approveItem(db, f.accounting, mirror.id);
    await runDueJobs(db);
    await pump();
    const mirrored = (await getInvoice(db, inv.id))!.invoice;
    expect(mirrored.stripeInvoiceId).toBeTruthy();
    expect(mirrored.collectionState).toBe("none"); // pays by check: never scheduled
    expect(mirrored.debitScheduledOn).toBeNull();
    expect((await scheduleDueDateDebits(db, new Date("2027-01-15T20:00:00Z"))).queued).toBe(0);
    const paid = await recordPaymentReceived(db, f.accounting, inv.id, { kind: "eft", amountCents: inv.totalCents - 500, reference: "MarginEdge 7781" });
    expect(paid.payment.amountCents).toBe(inv.totalCents - 500);
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `short_pay:${inv.id}`));
    expect(c.state).toBe("open");
    await runDueJobs(db);
    expect(fake.invoices.get(mirrored.stripeInvoiceId!)!.status).toBe("paid");
  });

  it("a credit memo becomes a Stripe credit note through the queue; a void voids the Stripe copy; the invoice email is queued with the PDF and the link", async () => {
    const inv = await deliveredInvoice(bar.id, [{ skuId: f.skus.cantinescaCase.id, qty: 5 }], { scheduled: "2026-11-04", actual: "2026-11-04" });
    const mirror = (await approvalsForSubject(db, "invoice", inv.id)).find((i) => i.kind === "stripe_invoice")!;
    await approveItem(db, f.accounting, mirror.id);
    await runDueJobs(db);
    await pump();
    const cm = await issueCreditMemo(db, f.admin, { invoiceId: inv.id, amountCents: 3600, reason: "one case short-dated" });
    const cn = (await approvalsForSubject(db, "credit_memo", cm.id)).find((i) => i.kind === "stripe_credit_note")!;
    expect(cn.state).toBe("pending");
    await approveItem(db, f.accounting, cn.id);
    await runDueJobs(db);
    const [cmAfter] = await db.select().from(schema.creditMemo).where(eq(schema.creditMemo.id, cm.id));
    expect(cmAfter.stripeCreditNoteId).toMatch(/^cn_fake/);
    expect(cmAfter.stripeApplied).toBe("amount_due");
    const stripeInv = (await getInvoice(db, inv.id))!.invoice.stripeInvoiceId!;
    expect(fake.invoices.get(stripeInv)!.amountRemaining).toBe(inv.totalCents - 3600);
    const email = await requestInvoiceEmail(db, f.accounting, inv.id);
    expect(email.item.kind).toBe("email");
    const payload = email.item.payload as { to: string[]; body: string; attachments: Array<{ kind: string }> };
    expect(payload.to.length).toBeGreaterThan(0);
    expect(payload.body).toContain("invoice.stripe.test");
    expect(payload.attachments[0].kind).toBe("invoice_pdf");
    // Void: the Stripe copy follows and anything queued is withdrawn.
    const inv2 = await deliveredInvoice(bar.id, [{ skuId: f.skus.cantinescaCase.id, qty: 1 }], { scheduled: "2026-11-06", actual: "2026-11-06" });
    const m2 = (await approvalsForSubject(db, "invoice", inv2.id)).find((i) => i.kind === "stripe_invoice")!;
    await approveItem(db, f.accounting, m2.id);
    await runDueJobs(db);
    await pump();
    const s2 = (await getInvoice(db, inv2.id))!.invoice.stripeInvoiceId!;
    await requestInvoiceEmail(db, f.accounting, inv2.id);
    await voidInvoice(db, f.admin, inv2.id, "duplicate");
    await runDueJobs(db);
    expect(fake.invoices.get(s2)!.status).toBe("void");
    const left = (await approvalsForSubject(db, "invoice", inv2.id)).filter((i) => i.state === "pending");
    expect(left.length).toBe(0);
  });

  it("the overdue sweep flags an open invoice once its due date and debit date have passed", async () => {
    const inv = await deliveredInvoice(distributor.id, [{ skuId: f.skus.cantinescaCase.id, qty: 2 }], { scheduled: "2026-10-01", actual: "2026-10-01" });
    const swept = await sweepOverdueInvoices(db, SYSTEM_ACTOR, new Date("2026-11-15T20:00:00Z"));
    expect(swept.opened).toBeGreaterThan(0);
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `collections_overdue:${distributor.id}`));
    expect(c.state).toBe("open");
    await recordPaymentReceived(db, f.accounting, inv.id, { kind: "check", reference: "9" });
  });
});

describe("Reconciliation, payouts and the CFO export (S5, S8, R2)", () => {
  it("a Stripe-side change the portal missed opens one case, and a payout ties out to invoice numbers", async () => {
    const inv = await deliveredInvoice(bar.id, [{ skuId: f.skus.cantinescaCase.id, qty: 2 }], { scheduled: "2026-11-09", actual: "2026-11-09" });
    const mirror = (await approvalsForSubject(db, "invoice", inv.id)).find((i) => i.kind === "stripe_invoice")!;
    await approveItem(db, f.accounting, mirror.id);
    await runDueJobs(db);
    await pump();
    const stripeId = (await getInvoice(db, inv.id))!.invoice.stripeInvoiceId!;
    // Someone marks it paid in the dashboard and the webhook is lost.
    fake.invoices.get(stripeId)!.status = "paid";
    fake.invoices.get(stripeId)!.amountRemaining = 0;
    const r = await reconcileWithStripe(db);
    expect(r.mismatches).toBeGreaterThanOrEqual(1);
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `stripe_reconcile:${inv.id}`));
    expect(c.state).toBe("open");
    await recordPaymentReceived(db, f.accounting, inv.id, { kind: "other", note: "paid in Stripe by hand" });
    // Payouts: a settled debit's balance transaction lands in a payout.
    const settled = [...fake.balanceTransactions.values()][0];
    const payout = fake.addPayout({ arrivalDate: "2026-12-11", btIds: [settled.id] });
    await pump();
    await runDueJobs(db);
    const synced = await syncPayouts(db);
    expect(synced.payouts).toBeGreaterThanOrEqual(1);
    const list = await listPayoutsWithDetail(db);
    const mine = list.find((p) => p.payout.payoutId === payout.id)!;
    expect(mine.lines.length).toBe(1);
    expect(mine.lines[0].inv?.number).toBeTruthy();
    expect(mine.lines[0].bt.feeCents).toBeGreaterThan(0);
    const csv = await cfoExportCsv(db, f.owner, "2026-12");
    expect(csv).toContain("Stripe payouts to the bank");
    expect(csv).toContain(payout.id);
    const aging = await arAging(db, f.owner, "2026-12-20");
    expect(aging.total).toBeGreaterThanOrEqual(0);
  });
});

describe("The one-time match with the ACH app (C2)", () => {
  it("customers without a portal id are suggested by email or name and confirmed by a person, who also gets the bank set as default", async () => {
    const shop = (await makeLocation(db, f.sales, f.market.id, "Legacy Bottle Shop", { ap: { name: "Legacy AP", email: "ap@legacybottle.example.test" } })).location;
    await updateAccountShipping(db, f.admin, shop.id, { payBy: "stripe" });
    const ap = (await getLocation(db, shop.id))!.contacts.find((c) => c.contactRole === "ap")!;
    const [contact] = await db.select().from(schema.contact).where(eq(schema.contact.id, ap.contactId));
    fake.addLegacyCustomer({ name: "Legacy Bottle Shop LLC", email: contact.email, bank: { bankName: "BofA", last4: "1111" } });
    const unknown = fake.addLegacyCustomer({ name: "Somebody Else", email: "nobody@example.test" });
    // The ACH app never set a default: clear it to mimic that.
    const legacy = [...fake.customers.values()].find((c) => c.name === "Legacy Bottle Shop LLC")!;
    legacy.defaultPaymentMethod = null;
    const r = await importStripeCustomersForMatching(db, f.admin);
    expect(r.imported).toBeGreaterThanOrEqual(2);
    const matches = await listCustomerMatches(db, { states: ["suggested"] });
    const mine = matches.find((m) => m.match.stripeCustomerId === legacy.id)!;
    expect(mine.match.suggestedLocationId).toBe(shop.id);
    expect(mine.match.suggestedBy).toBe("email");
    expect(matches.find((m) => m.match.stripeCustomerId === unknown.id)!.match.suggestedLocationId).toBeNull();
    await confirmCustomerMatch(db, f.admin, mine.match.id, shop.id);
    const [rel] = await db.select().from(schema.paymentRelationship).where(and(eq(schema.paymentRelationship.locationId, shop.id), eq(schema.paymentRelationship.current, true)));
    expect(rel.bankLast4).toBe("1111");
    expect(rel.verificationState).toBe("verified");
    expect(fake.customers.get(legacy.id)!.defaultPaymentMethod).toMatch(/^pm_fake/);
    expect(fake.customers.get(legacy.id)!.metadata.fv_location_id).toBe(shop.id);
    // An open Stripe invoice made by the ACH app for that customer is matched to the portal invoice with the same total.
    const inv = await deliveredInvoice(shop.id, [{ skuId: f.skus.cantinescaCase.id, qty: 2 }], { scheduled: "2026-11-11", actual: "2026-11-11" });
    const pendingMirror = (await approvalsForSubject(db, "invoice", inv.id)).find((i) => i.kind === "stripe_invoice")!;
    await rejectItem(db, f.admin, pendingMirror.id, "already in Stripe from the ACH app");
    fake.addLegacyInvoice({ customer: legacy.id, number: "ACHAPP-0007", total: inv.totalCents, dueDate: "2026-12-11" });
    const im = await importStripeInvoicesForMatching(db, f.admin);
    expect(im.imported).toBe(1);
    const invMatches = await listInvoiceMatches(db, { states: ["suggested"] });
    expect(invMatches[0].match.suggestedInvoiceId).toBe(inv.id);
    expect(invMatches[0].match.suggestedBy).toBe("amount_and_account");
    await linkStripeInvoice(db, f.admin, invMatches[0].match.id, inv.id);
    const linked = (await getInvoice(db, inv.id))!.invoice;
    expect(linked.stripeNumber).toBe("ACHAPP-0007");
    expect(linked.collectionState).toBe("scheduled");
    expect(linked.debitScheduledOn).toBe("2026-12-11");
  });
});
