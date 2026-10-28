import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { getLocation, recordLicenseDecision } from "@/lib/domain/customers/service";
import { createHold, resolveHold } from "@/lib/domain/holds/service";
import { convertIntakeToOrder, markIntakeIncomplete, recordIntakeRequest, rejectIntake } from "@/lib/domain/intake/service";
import { listNotices, recordNoticeOutcome, reissueNotice } from "@/lib/domain/notices/service";
import { cancelUndeliveredDemand, getOrder, submitOrder } from "@/lib/domain/orders/service";
import { requestPaymentSetup, setPayerContact } from "@/lib/domain/payment/service";
import { evaluateLocationReadiness } from "@/lib/domain/readiness/service";
import { StaleStateError } from "@/lib/errors";
import { credentialFingerprint, providerStatuses, recordConnectionCheck } from "@/lib/integrations/registry";
import { customerReference, customerReferenceStatus, verifiedStripeAccount } from "@/lib/integrations/stripe/adapter";
import { LEASE_MS, ProviderUnavailableError, enqueueJob, registerJobHandler, resumeWaitingJobs, runDueJobs } from "@/lib/jobs/queue";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

/**
 * REV-12 (AC19), REV-13 (AC20), REV-14 (AC21), §4.7 (AC22), REV-15 (AC23),
 * REV-18 (AC27), §4.8 (AC29), UX-06 (AC30). No external API is called: the
 * Stripe key values used here are placeholders that never leave the process,
 * and the handler waits before any network call whenever the account is not
 * verified.
 */
let db: Db;
let close: () => Promise<void>;
let f: Fixture;
const env = process.env as Record<string, string | undefined>;
const savedKey = env.STRIPE_SECRET_KEY;
const savedOr = env.OPTIMOROUTE_API_KEY;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
});
afterAll(async () => close());
afterEach(() => {
  if (savedKey === undefined) delete env.STRIPE_SECRET_KEY;
  else env.STRIPE_SECRET_KEY = savedKey;
  if (savedOr === undefined) delete env.OPTIMOROUTE_API_KEY;
  else env.OPTIMOROUTE_API_KEY = savedOr;
});

async function payerReadyLocation(name: string) {
  const { location } = await makeLocation(db, f.sales, f.market.id, name);
  const ap = (await getLocation(db, location.id))!.contacts.find((c) => c.contactRole === "ap")!;
  await setPayerContact(db, f.accounting, location.id, ap.contactId, "shared AP explicitly authorized for the test");
  return location;
}

describe("REV-12 / AC19 — credentials alone never mean connected", () => {
  it("a dummy OptimoRoute key leaves a boundary-only provider NOT IMPLEMENTED; Stripe with a key but no check is 'untested'; a failed check is 'failed'; a changed key is 'stale'", async () => {
    env.OPTIMOROUTE_API_KEY = "placeholder-not-a-real-key";
    let statuses = await providerStatuses(db);
    const or = statuses.find((s) => s.provider === "optimoroute")!;
    expect(or.credentialsPresent).toBe(true);
    expect(or.state).toBe("not_implemented");
    expect(or.connection).toBe("not_applicable");
    expect(or.headline).toMatch(/Boundary only/);
    // Stripe: key present, no check.
    env.STRIPE_SECRET_KEY = "sk_test_placeholder_1";
    statuses = await providerStatuses(db);
    let stripe = statuses.find((s) => s.provider === "stripe")!;
    expect(stripe.state).toBe("implemented_not_connected");
    expect(stripe.connection).toBe("no_check");
    // Failed check.
    await recordConnectionCheck(db, "stripe", { ok: false, environment: "test", detail: { error: "invalid api key" } });
    stripe = (await providerStatuses(db)).find((s) => s.provider === "stripe")!;
    expect(stripe.connection).toBe("failed");
    expect(stripe.state).toBe("implemented_not_connected");
    // Successful check binds account + fingerprint → connected test mode, capability unproven.
    await recordConnectionCheck(db, "stripe", { ok: true, environment: "test", accountId: "acct_A", credentialFingerprint: credentialFingerprint(env.STRIPE_SECRET_KEY), detail: {} });
    stripe = (await providerStatuses(db)).find((s) => s.provider === "stripe")!;
    expect(stripe.connection).toBe("ok");
    expect(stripe.state).toBe("connected_test_mode");
    expect(stripe.capability).toBe("unproven");
    expect(stripe.activation).toBe("not_activated");
    // A gate row edited by hand does not make it live: activation is a separate recorded act.
    await db.update(schema.capabilityGate).set({ status: "demonstrated" }).where(eq(schema.capabilityGate.provider, "stripe"));
    stripe = (await providerStatuses(db)).find((s) => s.provider === "stripe")!;
    expect(stripe.capability).toBe("demonstrated");
    expect(stripe.activation).toBe("not_activated");
    expect(stripe.state).toBe("connected_test_mode");
    await db.update(schema.capabilityGate).set({ status: "unproven" }).where(eq(schema.capabilityGate.provider, "stripe"));
    // Stale prior success: the key changed.
    env.STRIPE_SECRET_KEY = "sk_test_placeholder_2";
    stripe = (await providerStatuses(db)).find((s) => s.provider === "stripe")!;
    expect(stripe.connection).toBe("stale");
    expect(stripe.state).toBe("implemented_not_connected");
    expect(await verifiedStripeAccount(db)).toBeNull();
    // Live key with a test-mode success recorded → mode mismatch → not verified.
    env.STRIPE_SECRET_KEY = "sk_live_placeholder";
    expect(await verifiedStripeAccount(db)).toBeNull();
    // Later failed check after success → failed.
    env.STRIPE_SECRET_KEY = "sk_test_placeholder_1";
    await recordConnectionCheck(db, "stripe", { ok: false, environment: "test", detail: { error: "timeout" } });
    stripe = (await providerStatuses(db)).find((s) => s.provider === "stripe")!;
    expect(stripe.connection).toBe("failed");
    expect(await verifiedStripeAccount(db)).toBeNull();
    await db.delete(schema.providerConnection).where(eq(schema.providerConnection.provider, "stripe"));
  });
});

describe("REV-13 / AC20 — provider references bound to account and mode", () => {
  it("a test reference is invisible under a live key; a different account never reuses it; key rotation for the same verified account keeps it", async () => {
    const loc = await payerReadyLocation("Bound Bar");
    env.STRIPE_SECRET_KEY = "sk_test_k1";
    await recordConnectionCheck(db, "stripe", { ok: true, environment: "test", accountId: "acct_A", credentialFingerprint: credentialFingerprint("sk_test_k1"), detail: {} });
    const r = await requestPaymentSetup(db, f.accounting, loc.id);
    void r;
    // Simulate the established customer for acct_A / test (what the handler would record after the provider call).
    const binding = (await verifiedStripeAccount(db))!;
    const pending = (await customerReference(db, loc.id, binding))!;
    await db.update(schema.providerReference).set({ providerId: "cus_A1", status: "established", providerAccountId: "acct_A" }).where(eq(schema.providerReference.id, pending.id));
    expect((await customerReference(db, loc.id, binding))?.providerId).toBe("cus_A1");
    // Live key: no verified binding → nothing established is usable; lookup returns null (fail closed).
    env.STRIPE_SECRET_KEY = "sk_live_k";
    expect(await verifiedStripeAccount(db)).toBeNull();
    expect(await customerReference(db, loc.id, null)).toBeNull();
    // Verified LIVE account: still no test reference reused; a new pending reference would be created in live mode.
    await recordConnectionCheck(db, "stripe", { ok: true, environment: "live", accountId: "acct_A", credentialFingerprint: credentialFingerprint("sk_live_k"), detail: {} });
    const live = (await verifiedStripeAccount(db))!;
    expect(live.environment).toBe("live");
    expect(await customerReference(db, loc.id, live)).toBeNull();
    // Same mode, different company account: the acct_A reference is not returned for acct_B.
    env.STRIPE_SECRET_KEY = "sk_test_k_other";
    await recordConnectionCheck(db, "stripe", { ok: true, environment: "test", accountId: "acct_B", credentialFingerprint: credentialFingerprint("sk_test_k_other"), detail: {} });
    const other = (await verifiedStripeAccount(db))!;
    expect(other.accountId).toBe("acct_B");
    expect(await customerReference(db, loc.id, other)).toBeNull();
    const status = await customerReferenceStatus(db, loc.id);
    expect(status.usable).toBeNull();
    expect(status.others.some((o) => o.why === "different Stripe account")).toBe(true);
    // Legitimate rotation for acct_A: new key, same account, same mode → association preserved, no duplicate.
    env.STRIPE_SECRET_KEY = "sk_test_k2";
    await recordConnectionCheck(db, "stripe", { ok: true, environment: "test", accountId: "acct_A", credentialFingerprint: credentialFingerprint("sk_test_k2"), detail: {} });
    const rotated = (await verifiedStripeAccount(db))!;
    expect((await customerReference(db, loc.id, rotated))?.providerId).toBe("cus_A1");
    const again = await requestPaymentSetup(db, f.accounting, loc.id);
    expect(again.noticeReused).toBe(true);
    const refs = await db.select().from(schema.providerReference).where(and(eq(schema.providerReference.subjectId, loc.id), eq(schema.providerReference.providerObject, "customer")));
    expect(refs.filter((x) => x.providerId === "cus_A1")).toHaveLength(1);
    await db.delete(schema.providerConnection).where(eq(schema.providerConnection.provider, "stripe"));
  });
});

describe("REV-14 / AC21 — disconnected provider work waits and resumes", () => {
  it("request setup with no key → job WAITING (not done); configure key + successful check → resumes once with no duplicate notice", async () => {
    delete env.STRIPE_SECRET_KEY;
    const loc = await payerReadyLocation("Waiting Wine Bar");
    await requestPaymentSetup(db, f.accounting, loc.id);
    let results = await runDueJobs(db, { limit: 20 });
    const mine = results.find((r) => r.kind === "stripe.customer.ensure");
    expect(mine?.outcome).toBe("waiting");
    let [job] = await db.select().from(schema.job).where(and(eq(schema.job.kind, "stripe.customer.ensure"), eq(schema.job.dedupeKey, `stripe.customer.ensure:${loc.id}`)));
    expect(job.status).toBe("waiting");
    expect(job.waitingReason).toMatch(/NOT CONNECTED/);
    expect(job.attempts).toBe(0); // waiting is not a failed attempt
    // Another run without a key: stays waiting, no retry storm, no exception.
    results = await runDueJobs(db, { limit: 20 });
    expect(results.find((r) => r.id === job.id)).toBeUndefined();
    expect(await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `job_failed:${job.id}`))).toHaveLength(0);
    // Key configured but account not verified → still waiting with the reason (no provider call is attempted).
    env.STRIPE_SECRET_KEY = "sk_test_wait";
    expect(await resumeWaitingJobs(db)).toBe(0);
    // Successful check → resumed; the job runs. It would now call Stripe, which this test cannot do, so we stop at "queued".
    await recordConnectionCheck(db, "stripe", { ok: true, environment: "test", accountId: "acct_W", credentialFingerprint: credentialFingerprint("sk_test_wait"), detail: {} });
    expect(await resumeWaitingJobs(db)).toBeGreaterThanOrEqual(1);
    [job] = await db.select().from(schema.job).where(eq(schema.job.id, job.id));
    expect(job.status).toBe("queued");
    expect(job.waitingReason).toBeNull();
    // A second resume finds nothing (once).
    expect(await resumeWaitingJobs(db)).toBe(0);
    // The invitation intent was not duplicated by any of this.
    expect((await db.select().from(schema.notice).where(and(eq(schema.notice.subjectId, loc.id), eq(schema.notice.purpose, "payment_setup_invitation")))).length).toBe(1);
    await db.update(schema.job).set({ status: "done" }).where(eq(schema.job.kind, "stripe.customer.ensure")); // park so later runs never call Stripe
    await db.delete(schema.providerConnection).where(eq(schema.providerConnection.provider, "stripe"));
  });
});

describe("§4.7 / AC22 — claim fencing and bounded attempts", () => {
  it("a late worker cannot complete a reclaimed job; repeated worker death ends in failed + owned case; unknown outcome is stated", async () => {
    let runs = 0;
    registerJobHandler("test.fenced", { run: async () => void runs++ });
    const q = await enqueueJob(db, "test.fenced", {}, { maxAttempts: 2 });
    // Worker 1 claims and "dies" (we simulate by marking the lease old).
    await db.update(schema.job).set({ status: "running", lockedAt: new Date(Date.now() - LEASE_MS - 1000), lockedBy: "w1", claimToken: "11111111-1111-1111-1111-111111111111", attempts: 1 }).where(eq(schema.job.id, q.job.id));
    // Worker 2 reclaims and completes it.
    const r2 = await runDueJobs(db, { workerId: "w2" });
    expect(r2.find((r) => r.id === q.job.id)?.outcome).toBe("done");
    // Late worker 1 tries to write its outcome with the OLD token → 0 rows, state untouched.
    const late = await db.update(schema.job).set({ status: "failed", lastError: "late" }).where(and(eq(schema.job.id, q.job.id), eq(schema.job.status, "running"), eq(schema.job.claimToken, "11111111-1111-1111-1111-111111111111"))).returning();
    expect(late).toHaveLength(0);
    expect((await db.select().from(schema.job).where(eq(schema.job.id, q.job.id)))[0].status).toBe("done");
    expect(runs).toBe(1);
    // Repeated death: attempts exhausted on reclaim → failed, case opened, outcome unknown.
    const q2 = await enqueueJob(db, "test.fenced", { x: 1 }, { maxAttempts: 2 });
    await db.update(schema.job).set({ status: "running", lockedAt: new Date(Date.now() - LEASE_MS - 1000), lockedBy: "w1", claimToken: "22222222-2222-2222-2222-222222222222", attempts: 2 }).where(eq(schema.job.id, q2.job.id));
    await runDueJobs(db, { workerId: "w3" });
    const [dead] = await db.select().from(schema.job).where(eq(schema.job.id, q2.job.id));
    expect(dead.status).toBe("failed");
    expect(dead.lastError).toMatch(/unknown/);
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `job_failed:${q2.job.id}`));
    expect(c.cause).toMatch(/UNKNOWN/);
    // A ProviderUnavailableError never burns an attempt.
    registerJobHandler("test.unavailable", { run: async () => { throw new ProviderUnavailableError("provider down"); }, ready: () => false });
    const q3 = await enqueueJob(db, "test.unavailable", {}, { maxAttempts: 1 });
    const r3 = await runDueJobs(db);
    expect(r3.find((r) => r.id === q3.job.id)?.outcome).toBe("waiting");
    expect((await db.select().from(schema.job).where(eq(schema.job.id, q3.job.id)))[0].attempts).toBe(0);
  });
});

describe("REV-15 / AC23 — one intake, one order", () => {
  it("convert, stale 'incomplete', convert again → refused; convert to another location refused; source state atomic", async () => {
    const a = (await makeLocation(db, f.sales, f.market.id, "Intake A")).location;
    const b = (await makeLocation(db, f.sales, f.market.id, "Intake B")).location;
    const req = await recordIntakeRequest(db, f.admin, { fromEmail: "buyer@x.test", subject: "order", body: "3 cases please", marketId: f.market.id });
    const first = await convertIntakeToOrder(db, f.admin, { intakeId: req.id, locationId: a.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 3 }] });
    await expect(markIntakeIncomplete(db, f.admin, req.id, "which beer?")).rejects.toBeInstanceOf(StaleStateError);
    await expect(convertIntakeToOrder(db, f.admin, { intakeId: req.id, locationId: b.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 3 }] })).rejects.toThrow(new RegExp(`already converted to ${first.order.orderNumber}`));
    await expect(rejectIntake(db, f.admin, req.id, "spam")).rejects.toBeInstanceOf(StaleStateError);
    const orders = await db.select().from(schema.order).where(eq(schema.order.intakeRequestId, req.id));
    expect(orders).toHaveLength(1);
    const [row] = await db.select().from(schema.orderIntakeRequest).where(eq(schema.orderIntakeRequest.id, req.id));
    expect(row.state).toBe("converted");
    expect(row.orderId).toBe(first.order.id);
    expect(row.locationId).toBe(a.id);
    // Interruption between order creation and source update cannot happen outside one transaction; the DB also refuses a second order for the intake.
    await expect(db.insert(schema.order).values({ marketId: f.market.id, locationId: b.id, orderNumber: "X-1", source: "email", intakeRequestId: req.id })).rejects.toThrow();
    // Incomplete then convert is the legitimate path.
    const req2 = await recordIntakeRequest(db, f.admin, { fromEmail: "buyer@y.test", subject: "?", body: "some beer", marketId: f.market.id });
    await markIntakeIncomplete(db, f.admin, req2.id, "which product and how many?");
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `email_intake:${req2.id}`));
    expect(c.state).toBe("waiting");
    await convertIntakeToOrder(db, f.admin, { intakeId: req2.id, locationId: a.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] });
    expect((await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.id, c.id)))[0].state).toBe("resolved");
  });
});

describe("REV-18 / AC27 — manual notices are a real workflow", () => {
  it("pending → sent with evidence (once); failed → owned follow-up; missing recipient owned; re-issue supersedes; no automatic sender", async () => {
    const loc = await payerReadyLocation("Notice Nook");
    await recordLicenseDecision(db, f.admin, { locationId: loc.id, state: "verified", licenseNumber: "L", evidence: "e" });
    const o = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 3 }] });
    const [n] = await db.select().from(schema.notice).where(and(eq(schema.notice.subjectType, "order"), eq(schema.notice.subjectId, o.order.id)));
    expect(n.state).toBe("manual_pending");
    expect(n.intendedSender).toBe("unselected");
    expect(n.recipientEmail).toMatch(/@/);
    expect((n.content as { subject: string }).subject).toMatch(o.order.orderNumber);
    // Sales cannot record outcomes; Accounting can; once.
    await expect(recordNoticeOutcome(db, f.sales, { noticeId: n.id, outcome: "sent", sentVia: "gmail", evidence: "x" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(recordNoticeOutcome(db, f.accounting, { noticeId: n.id, outcome: "sent", sentVia: "", evidence: "x" })).rejects.toThrow(/how it was sent/);
    const sent = await recordNoticeOutcome(db, f.accounting, { noticeId: n.id, outcome: "sent", sentVia: "Gmail ops@ (manual)", evidence: "msg id <abc>" });
    expect(sent.state).toBe("sent");
    expect(sent.intendedSender).toBe("manual");
    expect((sent.evidence as { providerConfirmed: boolean }).providerConfirmed).toBe(false);
    await expect(recordNoticeOutcome(db, f.accounting, { noticeId: n.id, outcome: "sent", sentVia: "again", evidence: "x" })).rejects.toBeInstanceOf(StaleStateError);
    // Duplicate request for the same purpose/subject returns the same pending intent (setup invitation).
    await requestPaymentSetup(db, f.accounting, loc.id);
    const again = await requestPaymentSetup(db, f.accounting, loc.id);
    expect(again.noticeReused).toBe(true);
    // Failed outcome → owned follow-up; re-issue creates v2 and supersedes nothing pending (v1 is failed), old snapshot retained.
    const inv = again.notice;
    await recordNoticeOutcome(db, f.accounting, { noticeId: inv.id, outcome: "failed", sentVia: "Gmail", evidence: "bounced: mailbox full" });
    expect(await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `notice_failed:${inv.id}`))).toHaveLength(1);
    const v2 = await reissueNotice(db, f.accounting, inv.id, { recipientEmail: "payer2@example.test", reason: "corrected address" });
    expect(v2.version).toBe(2);
    expect(v2.recipientEmail).toBe("payer2@example.test");
    expect((await db.select().from(schema.notice).where(eq(schema.notice.id, inv.id)))[0].recipientEmail).toBe("ap@shared-ap.example.test");
    // Missing recipient → owned case for Sales.
    const bare = (await makeLocation(db, f.sales, f.market.id, "No Email Bar", { buyer: { name: "No Mail" }, ap: null })).location;
    await recordLicenseDecision(db, f.admin, { locationId: bare.id, state: "verified", licenseNumber: "L", evidence: "e" });
    const o2 = await submitOrder(db, f.sales, { locationId: bare.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] });
    const [n2] = await db.select().from(schema.notice).where(eq(schema.notice.subjectId, o2.order.id));
    expect(n2.recipientEmail).toBeNull();
    const [nc] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `notice_no_recipient:${n2.id}`));
    expect(nc.ownerRole).toBe("sales");
    await expect(recordNoticeOutcome(db, f.accounting, { noticeId: n2.id, outcome: "sent", sentVia: "gmail", evidence: "x" })).rejects.toThrow(/recipient email is required/);
    // Permission-scoped list: NC Sales sees NC notices; MA Sales sees none of them.
    expect((await listNotices(db, f.sales, { states: ["manual_pending"] })).length).toBeGreaterThan(0);
    expect(await listNotices(db, f.sales2, { states: ["manual_pending"] })).toHaveLength(0);
    // No automatic sender exists: nothing ever moves to sent without a person recording it.
    const auto = await db.select().from(schema.notice).where(and(eq(schema.notice.state, "sent"), eq(schema.notice.intendedSender, "gmail")));
    expect(auto).toHaveLength(0);
  });

  it("cancelling an order before its 'order received' notice was sent withdraws the pending notice (kept as superseded, never deleted) and its missing-recipient case", async () => {
    const bare = (await makeLocation(db, f.sales, f.market.id, "Withdrawn Notice Bar", { buyer: { name: "No Mail" }, ap: null })).location;
    await recordLicenseDecision(db, f.admin, { locationId: bare.id, state: "verified", licenseNumber: "L", evidence: "e" });
    const o = await submitOrder(db, f.sales, { locationId: bare.id, lines: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] });
    const [pending] = await db.select().from(schema.notice).where(eq(schema.notice.subjectId, o.order.id));
    expect(pending.state).toBe("manual_pending");
    await cancelUndeliveredDemand(db, f.admin, o.order.id, "customer withdrew");
    const [after] = await db.select().from(schema.notice).where(eq(schema.notice.id, pending.id));
    expect(after.state).toBe("superseded");
    expect(after.outcomeNote).toMatch(/cancelled before the notice was sent/);
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `notice_no_recipient:${pending.id}`));
    expect(c.state).toBe("resolved");
    // Nothing pending for a cancelled order; recording an outcome on it is refused as stale.
    expect(await listNotices(db, f.accounting, { states: ["manual_pending", "intended"], subjectType: "order", subjectId: o.order.id })).toHaveLength(0);
    await expect(recordNoticeOutcome(db, f.accounting, { noticeId: pending.id, outcome: "sent", sentVia: "gmail", evidence: "x" })).rejects.toBeInstanceOf(StaleStateError);
  });
});

describe("§4.8 / AC29 / AC30 — incidents, targeted resolution, repeated follow-through", () => {
  it("resolving one of two holds keeps the other blocker; repeated evaluation is idempotent; a case links its consequences", async () => {
    const loc = (await makeLocation(db, f.sales, f.market.id, "Two Holds")).location;
    await recordLicenseDecision(db, f.admin, { locationId: loc.id, state: "verified", licenseNumber: "L", evidence: "e" });
    const h1 = await createHold(db, f.admin, { locationId: loc.id, kind: "compliance", cause: "door unconfirmed" });
    const h2 = await createHold(db, f.admin, { locationId: loc.id, kind: "admin_manual", cause: "owner asked to pause" });
    let r = await evaluateLocationReadiness(db, loc.id);
    expect(r.conditions.filter((c) => c.code.startsWith("hold:")).map((c) => c.status)).toEqual(["blocked", "blocked"]);
    await resolveHold(db, f.admin, h1.id, "door confirmed");
    r = await evaluateLocationReadiness(db, loc.id);
    expect(r.conditions.filter((c) => c.code.startsWith("hold:"))).toHaveLength(1);
    expect(r.releasable).toBe(false);
    expect(r.summary).toMatch(/owner asked to pause/);
    expect((await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `hold:${h1.id}`)))[0].state).toBe("resolved");
    expect((await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `hold:${h2.id}`)))[0].state).toBe("open");
    // Resolving the same hold again has no second effect.
    expect((await resolveHold(db, f.admin, h1.id, "again")).active).toBe(false);
    expect((await db.select().from(schema.auditEvent).where(and(eq(schema.auditEvent.action, "hold.resolve"), eq(schema.auditEvent.subjectId, loc.id)))).length).toBe(1);
    // Stock follow-through repeated: receipts refill exactly the waiting demand, once per logical effect.
    const short = await submitOrder(db, f.sales, { locationId: loc.id, lines: [{ skuId: f.skus.sunlightHalf.id, qty: 25 }] });
    expect(short.lines[0].unmetQty).toBeGreaterThan(0);
    const { recordStockMovement } = await import("@/lib/domain/allocation/service");
    await recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: f.skus.sunlightHalf.id, kind: "receipt", qtyDelta: 100, evidence: "delivery" });
    await recordStockMovement(db, f.admin, { warehouseId: f.warehouse.id, skuId: f.skus.sunlightHalf.id, kind: "receipt", qtyDelta: 1, evidence: "delivery 2" });
    const filled = await getOrder(db, short.order.id);
    expect(filled?.lines[0].unmetQty).toBe(0);
    expect(filled?.lines[0].reservedQty).toBe(25);
    const shortageCase = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `allocation_shortage:${short.order.id}`));
    expect(shortageCase).toHaveLength(1);
    expect(shortageCase[0].state).toBe("resolved");
  });
});
