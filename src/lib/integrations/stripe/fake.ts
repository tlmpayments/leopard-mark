import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isDeployment } from "@/lib/env";
import type {
  CreateCreditNoteParams,
  CreateCustomerParams,
  CreateInvoiceParams,
  GwBalanceTransaction,
  GwCreditNote,
  GwCustomer,
  GwEvent,
  GwInvoice,
  GwInvoiceLineInput,
  GwPaymentMethod,
  GwPayout,
  GwSetupIntent,
  GwSetupSession,
  PayInvoiceOptions,
  StripeGateway,
} from "./gateway";

/**
 * In-memory Stripe for the scenario tests and the local demo. It behaves the way the portal relies on Stripe
 * behaving: a bank debit goes to `processing` and settles (or returns) later, a finalised invoice gets a number and a
 * hosted link, a credit note lowers what is due, and every change produces the webhook event Stripe would send, which
 * the test (or the demo) delivers to the portal. Nothing here exists on a deployment.
 */

interface FakeInvoice extends GwInvoice {
  lines: GwInvoiceLineInput[];
  paidOutOfBand: boolean;
  chargeId: string | null;
}

interface FakePaymentIntent {
  id: string;
  invoice: string;
  amount: number;
  status: "processing" | "succeeded" | "requires_payment_method" | "canceled";
  paymentMethod: string;
  lastError: { code: string; decline_code?: string; message: string } | null;
}

export class FakeStripe implements StripeGateway {
  readonly kind = "fake" as const;
  readonly accountId = "acct_fake_leopard";
  private n = 0;
  customers = new Map<string, GwCustomer & { address?: CreateCustomerParams["address"] }>();
  paymentMethods = new Map<string, GwPaymentMethod & { mandate: string | null }>();
  sessions = new Map<string, GwSetupSession & { customer: string; metadata: Record<string, string>; paymentMethodTypes: string[] }>();
  setupIntents = new Map<string, GwSetupIntent>();
  invoices = new Map<string, FakeInvoice>();
  paymentIntents = new Map<string, FakePaymentIntent>();
  creditNotes = new Map<string, GwCreditNote & { invoice: string; apply: string }>();
  payouts = new Map<string, GwPayout>();
  balanceTransactions = new Map<string, GwBalanceTransaction & { payoutId: string | null }>();
  usedNumbers = new Set<string>();
  /** Webhook events in the order Stripe would send them; `drainEvents()` hands them to the portal. */
  events: GwEvent[] = [];
  /** Calls made, for assertions. */
  calls: Array<{ method: string; args: unknown[] }> = [];
  /** Set to make the next call of that method throw (connectivity tests). */
  failNext: Record<string, string> = {};
  /** The local demo keeps the stand-in's objects in a file under .fv-demo so a restart does not lose them (tests: none). */
  private stateFile: string | null = null;

  private id(prefix: string) {
    this.n += 1;
    return `${prefix}_fake_${String(this.n).padStart(4, "0")}`;
  }
  /** Save after every change; the state is small and the demo is local. */
  private persist() {
    if (!this.stateFile) return;
    const m = (x: Map<string, unknown>) => [...x.entries()];
    const data = { n: this.n, customers: m(this.customers), paymentMethods: m(this.paymentMethods), sessions: m(this.sessions), setupIntents: m(this.setupIntents), invoices: m(this.invoices), paymentIntents: m(this.paymentIntents), creditNotes: m(this.creditNotes), payouts: m(this.payouts), balanceTransactions: m(this.balanceTransactions), usedNumbers: [...this.usedNumbers], events: this.events };
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(this.stateFile, JSON.stringify(data));
  }
  /** Bind to a state file, loading what an earlier run left there. */
  attachStateFile(file: string) {
    this.stateFile = file;
    if (!existsSync(file)) return;
    const d = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const load = <T>(target: Map<string, T>, rows: unknown) => {
      target.clear();
      for (const [k, v] of (rows as Array<[string, T]>) ?? []) target.set(k, v);
    };
    this.n = Number(d.n ?? 0);
    load(this.customers, d.customers);
    load(this.paymentMethods, d.paymentMethods);
    load(this.sessions, d.sessions);
    load(this.setupIntents, d.setupIntents);
    load(this.invoices, d.invoices);
    load(this.paymentIntents, d.paymentIntents);
    load(this.creditNotes, d.creditNotes);
    load(this.payouts, d.payouts);
    load(this.balanceTransactions, d.balanceTransactions);
    this.usedNumbers = new Set((d.usedNumbers as string[]) ?? []);
    this.events = (d.events as GwEvent[]) ?? [];
  }
  private now() {
    return Math.floor(Date.now() / 1000);
  }
  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
    const fail = this.failNext[method];
    if (fail) {
      delete this.failNext[method];
      throw new Error(fail);
    }
    // Every API call that changes something ends in a record() or an emit(); saving after each keeps the file current.
    queueMicrotask(() => this.persist());
  }
  private emit(type: string, object: Record<string, unknown>) {
    this.events.push({ id: this.id("evt"), type, created: this.now(), livemode: false, data: { object } });
    queueMicrotask(() => this.persist());
  }
  drainEvents(): GwEvent[] {
    const out = this.events;
    this.events = [];
    this.persist();
    return out;
  }

  async retrieveAccount() {
    this.record("retrieveAccount");
    return { id: this.accountId, country: "US", chargesEnabled: true };
  }
  async searchCustomers(query: string, limit = 10) {
    this.record("searchCustomers", query);
    const m = /metadata\['(\w+)'\]:'([^']+)'/.exec(query);
    const email = /email:'([^']+)'/.exec(query);
    return [...this.customers.values()]
      .filter((c) => (m ? c.metadata[m[1]] === m[2] : email ? (c.email ?? "").toLowerCase() === email[1].toLowerCase() : false))
      .slice(0, limit);
  }
  async listCustomers(params: { limit: number; startingAfter?: string | null }) {
    this.record("listCustomers", params);
    const all = [...this.customers.values()].sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
    const start = params.startingAfter ? all.findIndex((c) => c.id === params.startingAfter) + 1 : 0;
    const data = all.slice(start, start + params.limit);
    return { data, hasMore: start + params.limit < all.length };
  }
  async createCustomer(params: CreateCustomerParams, idempotencyKey: string) {
    this.record("createCustomer", params, idempotencyKey);
    const existing = [...this.customers.values()].find((c) => c.metadata.fv_idempotency === idempotencyKey);
    if (existing) return existing;
    const c = { id: this.id("cus"), name: params.name, email: params.email ?? null, created: this.now(), metadata: { ...params.metadata, fv_idempotency: idempotencyKey }, defaultPaymentMethod: null, address: params.address ?? null };
    this.customers.set(c.id, c);
    return c;
  }
  /** A customer the ACH app made before the portal existed (no portal metadata), for the matching screen. */
  addLegacyCustomer(input: { name: string; email: string | null; bank?: { bankName: string; last4: string } | null; createdDaysAgo?: number }) {
    const c = { id: this.id("cus"), name: input.name, email: input.email, created: this.now() - (input.createdDaysAgo ?? 30) * 86400, metadata: {}, defaultPaymentMethod: null as string | null };
    this.customers.set(c.id, c);
    if (input.bank) {
      const pm = { id: this.id("pm"), type: "us_bank_account", customer: c.id, usBankAccount: { bankName: input.bank.bankName, last4: input.bank.last4 }, card: null, mandate: this.id("mandate") };
      this.paymentMethods.set(pm.id, pm);
      c.defaultPaymentMethod = pm.id;
    }
    this.persist();
    return c;
  }
  async updateCustomer(id: string, params: Partial<CreateCustomerParams> & { defaultPaymentMethod?: string | null }) {
    this.record("updateCustomer", id, params);
    const c = this.customers.get(id);
    if (!c) throw new Error(`No such customer: ${id}`);
    if (params.name !== undefined) c.name = params.name;
    if (params.email !== undefined) c.email = params.email ?? null;
    if (params.metadata) c.metadata = { ...c.metadata, ...params.metadata };
    if (params.address !== undefined) c.address = params.address;
    if (params.defaultPaymentMethod !== undefined) c.defaultPaymentMethod = params.defaultPaymentMethod ?? null;
    return c;
  }
  async retrieveCustomer(id: string) {
    this.record("retrieveCustomer", id);
    return this.customers.get(id) ?? null;
  }
  async listPaymentMethods(customer: string, type: "us_bank_account" | "card") {
    this.record("listPaymentMethods", customer, type);
    return [...this.paymentMethods.values()].filter((p) => p.customer === customer && p.type === type);
  }
  async retrievePaymentMethod(id: string) {
    this.record("retrievePaymentMethod", id);
    return this.paymentMethods.get(id) ?? null;
  }
  async createSetupSession(params: { customer: string; paymentMethodTypes: Array<"us_bank_account" | "card">; successUrl: string; cancelUrl: string; metadata: Record<string, string> }) {
    this.record("createSetupSession", params);
    if (!this.customers.has(params.customer)) throw new Error(`No such customer: ${params.customer}`);
    const si: GwSetupIntent = { id: this.id("seti"), status: "requires_payment_method", customer: params.customer, paymentMethod: null, mandate: null, nextActionType: null };
    this.setupIntents.set(si.id, si);
    const s = { id: this.id("cs"), url: `https://checkout.stripe.test/c/${this.n}`, expiresAt: this.now() + 86400, setupIntent: si.id, status: "open", customer: params.customer, metadata: params.metadata, paymentMethodTypes: params.paymentMethodTypes };
    this.sessions.set(s.id, s);
    return s;
  }
  /** The customer connects a bank on the hosted page: instantly verified, or waiting on two test deposits. */
  completeSetup(sessionId: string, input: { bankName: string; last4: string; instant?: boolean }) {
    const s = this.sessions.get(sessionId);
    if (!s || !s.setupIntent) throw new Error(`No such session: ${sessionId}`);
    const si = this.setupIntents.get(s.setupIntent)!;
    const pm = { id: this.id("pm"), type: "us_bank_account", customer: s.customer, usBankAccount: { bankName: input.bankName, last4: input.last4 }, card: null, mandate: this.id("mandate") };
    this.paymentMethods.set(pm.id, pm);
    si.paymentMethod = pm.id;
    si.mandate = pm.mandate;
    s.status = "complete";
    if (input.instant === false) {
      si.status = "requires_action";
      si.nextActionType = "verify_with_microdeposits";
    } else {
      si.status = "succeeded";
    }
    this.emit("checkout.session.completed", { id: s.id, object: "checkout.session", mode: "setup", customer: s.customer, setup_intent: si.id, metadata: s.metadata, status: "complete" });
    this.emit(si.status === "succeeded" ? "setup_intent.succeeded" : "setup_intent.requires_action", { id: si.id, object: "setup_intent", status: si.status, customer: s.customer, payment_method: pm.id, mandate: pm.mandate, metadata: s.metadata, next_action: si.nextActionType ? { type: si.nextActionType } : null });
    return { setupIntent: si, paymentMethod: pm };
  }
  verifyMicrodeposits(setupIntentId: string) {
    const si = this.setupIntents.get(setupIntentId);
    if (!si) throw new Error(`No such setup intent: ${setupIntentId}`);
    si.status = "succeeded";
    si.nextActionType = null;
    this.emit("setup_intent.succeeded", { id: si.id, object: "setup_intent", status: "succeeded", customer: si.customer, payment_method: si.paymentMethod, mandate: si.mandate, metadata: {} });
  }
  /** The customer removes the bank (or revokes the mandate) on their side. */
  detachBank(paymentMethodId: string) {
    const pm = this.paymentMethods.get(paymentMethodId);
    if (!pm) throw new Error(`No such payment method: ${paymentMethodId}`);
    const customer = pm.customer;
    pm.customer = null;
    for (const c of this.customers.values()) if (c.defaultPaymentMethod === pm.id) c.defaultPaymentMethod = null;
    this.emit("payment_method.detached", { id: pm.id, object: "payment_method", type: pm.type, customer, us_bank_account: pm.usBankAccount ? { bank_name: pm.usBankAccount.bankName, last4: pm.usBankAccount.last4 } : null });
    if (pm.mandate) this.emit("mandate.updated", { id: pm.mandate, object: "mandate", status: "inactive", payment_method: pm.id });
  }
  async retrieveSetupIntent(id: string) {
    this.record("retrieveSetupIntent", id);
    return this.setupIntents.get(id) ?? null;
  }
  async createInvoice(params: CreateInvoiceParams, idempotencyKey: string) {
    this.record("createInvoice", params, idempotencyKey);
    const existing = [...this.invoices.values()].find((i) => i.metadata.fv_idempotency === idempotencyKey);
    if (existing) return existing;
    if (!this.customers.has(params.customer)) throw new Error(`No such customer: ${params.customer}`);
    if (params.number && this.usedNumbers.has(params.number)) throw new Error(`Invoice number ${params.number} is already in use in this account.`);
    const inv: FakeInvoice = {
      id: this.id("in"),
      number: params.number ?? null,
      status: "draft",
      customer: params.customer,
      total: 0,
      amountDue: 0,
      amountPaid: 0,
      amountRemaining: 0,
      hostedInvoiceUrl: null,
      invoicePdf: null,
      dueDate: params.dueDate,
      paymentIntent: null,
      metadata: { ...params.metadata, fv_idempotency: idempotencyKey },
      lines: [],
      paidOutOfBand: false,
      chargeId: null,
    };
    if (params.number) this.usedNumbers.add(params.number);
    this.invoices.set(inv.id, inv);
    return inv;
  }
  async addInvoiceLines(id: string, lines: GwInvoiceLineInput[], idempotencyKey: string) {
    this.record("addInvoiceLines", id, lines, idempotencyKey);
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`No such invoice: ${id}`);
    if (inv.status !== "draft") throw new Error("Lines can only be added to a draft invoice");
    inv.lines.push(...lines);
    inv.total = inv.lines.reduce((s, l) => s + l.quantity * l.unitAmount, 0);
    inv.amountDue = inv.total;
    inv.amountRemaining = inv.total;
    return inv;
  }
  async finalizeInvoice(id: string, idempotencyKey: string) {
    this.record("finalizeInvoice", id, idempotencyKey);
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`No such invoice: ${id}`);
    if (inv.status === "draft") {
      inv.status = "open";
      if (!inv.number) inv.number = `FAKE-${String(this.n).padStart(4, "0")}`;
      inv.hostedInvoiceUrl = `https://invoice.stripe.test/i/${inv.id}`;
      inv.invoicePdf = `https://pay.stripe.test/invoice/${inv.id}/pdf`;
      this.emit("invoice.finalized", this.invoiceEvent(inv));
    }
    return inv;
  }
  async retrieveInvoice(id: string) {
    this.record("retrieveInvoice", id);
    return this.invoices.get(id) ?? null;
  }
  async payInvoice(id: string, opts: PayInvoiceOptions, idempotencyKey: string) {
    this.record("payInvoice", id, opts, idempotencyKey);
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`No such invoice: ${id}`);
    if (inv.status !== "open") throw new Error(`Invoice ${inv.number ?? inv.id} is ${inv.status}, not open`);
    if (opts.paidOutOfBand) {
      inv.status = "paid";
      inv.paidOutOfBand = true;
      inv.amountPaid = inv.amountDue;
      inv.amountRemaining = 0;
      this.emit("invoice.paid", { ...this.invoiceEvent(inv), paid_out_of_band: true });
      return inv;
    }
    if (!opts.paymentMethod) throw new Error("A payment method is required to pay the invoice");
    const pm = this.paymentMethods.get(opts.paymentMethod);
    if (!pm || pm.customer !== inv.customer) throw new Error("The payment method does not belong to the invoice's customer");
    if (inv.paymentIntent && this.paymentIntents.get(inv.paymentIntent)?.status === "processing") return inv;
    const pi: FakePaymentIntent = { id: this.id("pi"), invoice: inv.id, amount: inv.amountRemaining, status: "processing", paymentMethod: pm.id, lastError: null };
    this.paymentIntents.set(pi.id, pi);
    inv.paymentIntent = pi.id;
    this.emit("payment_intent.processing", { id: pi.id, object: "payment_intent", status: "processing", amount: pi.amount, invoice: inv.id, customer: inv.customer, payment_method: pm.id, metadata: {} });
    return inv;
  }
  /** The ACH debit settles: Stripe marks the invoice paid and the money lands in the balance. */
  settleDebit(paymentIntentId: string) {
    const pi = this.paymentIntents.get(paymentIntentId);
    if (!pi) throw new Error(`No such payment intent: ${paymentIntentId}`);
    const inv = this.invoices.get(pi.invoice)!;
    pi.status = "succeeded";
    inv.status = "paid";
    inv.amountPaid += pi.amount;
    inv.amountRemaining = 0;
    inv.chargeId = this.id("ch");
    const fee = Math.min(500, Math.round(pi.amount * 0.008));
    const bt = { id: this.id("txn"), type: "payment", amount: pi.amount, fee, net: pi.amount - fee, created: this.now(), source: inv.chargeId, chargeId: inv.chargeId, invoiceId: inv.id, description: `Payment for invoice ${inv.number}`, payoutId: null as string | null };
    this.balanceTransactions.set(bt.id, bt);
    this.emit("payment_intent.succeeded", { id: pi.id, object: "payment_intent", status: "succeeded", amount: pi.amount, invoice: inv.id, customer: inv.customer, payment_method: pi.paymentMethod, latest_charge: inv.chargeId, metadata: {} });
    this.emit("invoice.paid", { ...this.invoiceEvent(inv), charge: inv.chargeId });
    return bt;
  }
  /** The bank returns the debit (R01 insufficient funds, R29 not authorised, ...). */
  returnDebit(paymentIntentId: string, code: string, message: string) {
    const pi = this.paymentIntents.get(paymentIntentId);
    if (!pi) throw new Error(`No such payment intent: ${paymentIntentId}`);
    const inv = this.invoices.get(pi.invoice)!;
    pi.status = "requires_payment_method";
    pi.lastError = { code: "payment_method_provider_decline", decline_code: code, message };
    this.emit("payment_intent.payment_failed", { id: pi.id, object: "payment_intent", status: pi.status, amount: pi.amount, invoice: inv.id, customer: inv.customer, payment_method: pi.paymentMethod, last_payment_error: pi.lastError, metadata: {} });
    this.emit("invoice.payment_failed", { ...this.invoiceEvent(inv), payment_intent: pi.id, last_payment_error: pi.lastError });
  }
  /** The customer disputes a settled debit as unauthorised. */
  disputeDebit(paymentIntentId: string) {
    const pi = this.paymentIntents.get(paymentIntentId);
    if (!pi) throw new Error(`No such payment intent: ${paymentIntentId}`);
    const inv = this.invoices.get(pi.invoice)!;
    this.emit("charge.dispute.created", { id: this.id("dp"), object: "dispute", charge: inv.chargeId, payment_intent: pi.id, amount: pi.amount, reason: "general", status: "needs_response", metadata: {} });
  }
  async voidInvoice(id: string) {
    this.record("voidInvoice", id);
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`No such invoice: ${id}`);
    if (inv.status === "paid") throw new Error("A paid invoice cannot be voided");
    inv.status = "void";
    this.emit("invoice.voided", this.invoiceEvent(inv));
    return inv;
  }
  async updateInvoiceMetadata(id: string, metadata: Record<string, string>) {
    this.record("updateInvoiceMetadata", id, metadata);
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`No such invoice: ${id}`);
    inv.metadata = { ...inv.metadata, ...metadata };
    return inv;
  }
  async createCreditNote(params: CreateCreditNoteParams, idempotencyKey: string) {
    this.record("createCreditNote", params, idempotencyKey);
    const existing = [...this.creditNotes.values()].find((c) => c.invoice === params.invoice && c.amount === params.amount && (c as unknown as { idem: string }).idem === idempotencyKey);
    if (existing) return existing;
    const inv = this.invoices.get(params.invoice);
    if (!inv) throw new Error(`No such invoice: ${params.invoice}`);
    if (inv.status !== "open" && inv.status !== "paid") throw new Error(`Credit notes need an open or paid invoice (this one is ${inv.status})`);
    if (inv.status === "open" && params.amount > inv.amountRemaining) throw new Error("The credit exceeds the amount remaining");
    if (inv.status === "open") {
      inv.amountDue -= params.amount;
      inv.amountRemaining -= params.amount;
    }
    const cn = Object.assign({ id: this.id("cn"), number: `CN-${String(this.n).padStart(4, "0")}`, status: "issued", amount: params.amount, invoice: params.invoice, apply: params.apply }, { idem: idempotencyKey });
    this.creditNotes.set(cn.id, cn);
    this.emit("credit_note.created", { id: cn.id, object: "credit_note", invoice: params.invoice, amount: params.amount, status: "issued", number: cn.number, metadata: params.metadata });
    return cn;
  }
  /** A payout to the bank that carries the given balance transactions. */
  addPayout(input: { amountCents?: number; arrivalDate: string; btIds: string[]; status?: string }) {
    const bts = input.btIds.map((id) => this.balanceTransactions.get(id)!).filter(Boolean);
    const amount = input.amountCents ?? bts.reduce((s, b) => s + b.net, 0);
    const p = { id: this.id("po"), amount, currency: "usd", status: input.status ?? "paid", arrivalDate: Math.floor(Date.parse(`${input.arrivalDate}T12:00:00Z`) / 1000), created: this.now() };
    this.payouts.set(p.id, p);
    for (const b of bts) b.payoutId = p.id;
    this.emit("payout.paid", { id: p.id, object: "payout", amount, arrival_date: p.arrivalDate, status: p.status });
    return p;
  }
  /** An invoice made outside the portal (the ACH app's charge-retailer route, or by hand in the dashboard). */
  addLegacyInvoice(input: { customer: string; number: string; total: number; status?: "open" | "paid"; dueDate?: string; createdDaysAgo?: number }) {
    const inv: FakeInvoice = {
      id: this.id("in"),
      number: input.number,
      status: input.status ?? "open",
      customer: input.customer,
      total: input.total,
      amountDue: input.total,
      amountPaid: input.status === "paid" ? input.total : 0,
      amountRemaining: input.status === "paid" ? 0 : input.total,
      hostedInvoiceUrl: `https://invoice.stripe.test/i/legacy-${this.n}`,
      invoicePdf: null,
      dueDate: input.dueDate ? Math.floor(Date.parse(`${input.dueDate}T12:00:00Z`) / 1000) : null,
      paymentIntent: null,
      metadata: {},
      lines: [],
      paidOutOfBand: false,
      chargeId: null,
    };
    this.usedNumbers.add(input.number);
    this.invoices.set(inv.id, inv);
    this.persist();
    return inv;
  }
  async listInvoices(params: { limit: number; startingAfter?: string | null; status?: "open" | "paid" | "draft" | "void" | "uncollectible" | null; customer?: string | null }) {
    this.record("listInvoices", params);
    const all = [...this.invoices.values()].filter((i) => (!params.status || i.status === params.status) && (!params.customer || i.customer === params.customer)).sort((a, b) => a.id.localeCompare(b.id));
    const start = params.startingAfter ? all.findIndex((i) => i.id === params.startingAfter) + 1 : 0;
    return { data: all.slice(start, start + params.limit), hasMore: start + params.limit < all.length };
  }
  async listPayouts(params: { limit: number; startingAfter?: string | null; createdAfter?: number | null }) {
    this.record("listPayouts", params);
    const all = [...this.payouts.values()].filter((p) => !params.createdAfter || p.created >= params.createdAfter).sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));
    const start = params.startingAfter ? all.findIndex((p) => p.id === params.startingAfter) + 1 : 0;
    return { data: all.slice(start, start + params.limit), hasMore: start + params.limit < all.length };
  }
  async listBalanceTransactionsForPayout(payoutId: string) {
    this.record("listBalanceTransactionsForPayout", payoutId);
    return [...this.balanceTransactions.values()].filter((b) => b.payoutId === payoutId);
  }
  constructEvent(rawBody: string, signature: string): GwEvent {
    if (signature !== "fake") throw new Error("Bad fake signature");
    return JSON.parse(rawBody) as GwEvent;
  }
  private invoiceEvent(inv: FakeInvoice): Record<string, unknown> {
    return { id: inv.id, object: "invoice", number: inv.number, status: inv.status, customer: inv.customer, total: inv.total, amount_due: inv.amountDue, amount_paid: inv.amountPaid, amount_remaining: inv.amountRemaining, hosted_invoice_url: inv.hostedInvoiceUrl, invoice_pdf: inv.invoicePdf, due_date: inv.dueDate, payment_intent: inv.paymentIntent, metadata: inv.metadata };
  }
}

let installed: FakeStripe | null = null;

/** Install (or return) the process-wide fake. Tests call `resetFakeStripe()` between files. */
export function installFakeStripe(): FakeStripe {
  if (isDeployment()) throw new Error("The fake Stripe gateway can never run on a deployment");
  if (!installed) {
    installed = new FakeStripe();
    // The local demo (scripts/demo.mjs) names a state file so the stand-in survives a restart with its database.
    if (process.env.FV_STRIPE_FAKE_STATE) installed.attachStateFile(process.env.FV_STRIPE_FAKE_STATE);
  }
  return installed;
}

/** A fresh fake (tests call this between files, then install it with `useFakeStripe()` from the gateway module). */
export function resetFakeStripe(): FakeStripe {
  installed = new FakeStripe();
  return installed;
}

export function currentFakeStripe(): FakeStripe | null {
  return installed;
}
