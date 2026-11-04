import Stripe from "stripe";
import { envPresent, isDeployment } from "@/lib/env";
import { installFakeStripe, resetFakeStripe, type FakeStripe } from "./fake";

/**
 * The Stripe gateway: the handful of calls the portal makes, behind one interface, so that business code never
 * touches the SDK directly and the scenario tests (and the local demo) can run the whole collection flow against an
 * in-memory fake. On a deployment the gateway is always the real one; the fake is impossible there (same rule as
 * fixture sign-in and demo mode, src/lib/env.ts).
 */

export interface GwAccount {
  id: string;
  country: string | null;
  chargesEnabled: boolean;
}

export interface GwCustomer {
  id: string;
  name: string | null;
  email: string | null;
  created: number;
  metadata: Record<string, string>;
  defaultPaymentMethod: string | null;
}

export interface GwPaymentMethod {
  id: string;
  type: string;
  customer: string | null;
  usBankAccount: { bankName: string | null; last4: string | null } | null;
  card: { brand: string | null; last4: string | null } | null;
}

export interface GwSetupSession {
  id: string;
  url: string | null;
  expiresAt: number;
  setupIntent: string | null;
  status: string | null;
}

export interface GwSetupIntent {
  id: string;
  status: string;
  customer: string | null;
  paymentMethod: string | null;
  mandate: string | null;
  /** e.g. verify_with_microdeposits */
  nextActionType: string | null;
}

export interface GwInvoice {
  id: string;
  number: string | null;
  status: string;
  customer: string;
  total: number;
  amountDue: number;
  amountPaid: number;
  amountRemaining: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  dueDate: number | null;
  paymentIntent: string | null;
  metadata: Record<string, string>;
}

export interface GwInvoiceLineInput {
  description: string;
  quantity: number;
  unitAmount: number;
  productName: string;
  metadata?: Record<string, string>;
}

export interface GwCreditNote {
  id: string;
  number: string | null;
  status: string;
  amount: number;
}

export interface GwPayout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  arrivalDate: number;
  created: number;
}

export interface GwBalanceTransaction {
  id: string;
  type: string;
  amount: number;
  fee: number;
  net: number;
  created: number;
  source: string | null;
  chargeId: string | null;
  invoiceId: string | null;
  description: string | null;
}

export interface GwEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

export interface CreateCustomerParams {
  name: string;
  email?: string | null;
  metadata: Record<string, string>;
  address?: { line1: string; line2?: string | null; city: string; state: string; postalCode: string; country?: string } | null;
}

export interface CreateInvoiceParams {
  customer: string;
  /** The portal's own number (I2). Stripe may refuse a number already used in the account. */
  number?: string | null;
  /** Unix seconds; the due date from the portal's terms (I5). */
  dueDate: number;
  metadata: Record<string, string>;
  customFields: Array<{ name: string; value: string }>;
  description?: string | null;
  footer?: string | null;
}

export interface PayInvoiceOptions {
  paymentMethod?: string;
  mandate?: string | null;
  offSession?: boolean;
  paidOutOfBand?: boolean;
}

export interface CreateCreditNoteParams {
  invoice: string;
  amount: number;
  /** How a credit against a PAID invoice is applied; an open invoice simply owes less. */
  apply: "amount_due" | "customer_balance" | "refund";
  memo: string;
  metadata: Record<string, string>;
}

export interface StripeGateway {
  readonly kind: "real" | "fake";
  retrieveAccount(): Promise<GwAccount>;
  searchCustomers(query: string, limit?: number): Promise<GwCustomer[]>;
  listCustomers(params: { limit: number; startingAfter?: string | null }): Promise<{ data: GwCustomer[]; hasMore: boolean }>;
  createCustomer(params: CreateCustomerParams, idempotencyKey: string): Promise<GwCustomer>;
  updateCustomer(id: string, params: Partial<CreateCustomerParams> & { defaultPaymentMethod?: string | null }): Promise<GwCustomer>;
  retrieveCustomer(id: string): Promise<GwCustomer | null>;
  listPaymentMethods(customer: string, type: "us_bank_account" | "card"): Promise<GwPaymentMethod[]>;
  retrievePaymentMethod(id: string): Promise<GwPaymentMethod | null>;
  createSetupSession(params: { customer: string; paymentMethodTypes: Array<"us_bank_account" | "card">; successUrl: string; cancelUrl: string; metadata: Record<string, string> }): Promise<GwSetupSession>;
  retrieveSetupIntent(id: string): Promise<GwSetupIntent | null>;
  createInvoice(params: CreateInvoiceParams, idempotencyKey: string): Promise<GwInvoice>;
  addInvoiceLines(id: string, lines: GwInvoiceLineInput[], idempotencyKey: string): Promise<GwInvoice>;
  finalizeInvoice(id: string, idempotencyKey: string): Promise<GwInvoice>;
  retrieveInvoice(id: string): Promise<GwInvoice | null>;
  payInvoice(id: string, opts: PayInvoiceOptions, idempotencyKey: string): Promise<GwInvoice>;
  voidInvoice(id: string): Promise<GwInvoice>;
  /** Metadata on an invoice the portal did not create, once a person has tied it to a portal invoice. */
  updateInvoiceMetadata(id: string, metadata: Record<string, string>): Promise<GwInvoice>;
  createCreditNote(params: CreateCreditNoteParams, idempotencyKey: string): Promise<GwCreditNote>;
  /** Invoices in the account (for the one-time match of invoices the portal did not create). */
  listInvoices(params: { limit: number; startingAfter?: string | null; status?: "open" | "paid" | "draft" | "void" | "uncollectible" | null; customer?: string | null }): Promise<{ data: GwInvoice[]; hasMore: boolean }>;
  listPayouts(params: { limit: number; startingAfter?: string | null; createdAfter?: number | null }): Promise<{ data: GwPayout[]; hasMore: boolean }>;
  listBalanceTransactionsForPayout(payoutId: string): Promise<GwBalanceTransaction[]>;
  constructEvent(rawBody: string, signature: string, secret: string): GwEvent;
}

// ---------------------------------------------------------------------------
// Real gateway (the stripe SDK)
// ---------------------------------------------------------------------------

function meta(m: Stripe.Metadata | null | undefined): Record<string, string> {
  return m ? Object.fromEntries(Object.entries(m).map(([k, v]) => [k, String(v)])) : {};
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

function customerOf(c: Stripe.Customer | Stripe.DeletedCustomer): GwCustomer {
  if ("deleted" in c && c.deleted) return { id: c.id, name: null, email: null, created: 0, metadata: {}, defaultPaymentMethod: null };
  const cust = c as Stripe.Customer;
  return { id: cust.id, name: cust.name ?? null, email: cust.email ?? null, created: cust.created, metadata: meta(cust.metadata), defaultPaymentMethod: idOf(cust.invoice_settings?.default_payment_method) };
}

function paymentMethodOf(pm: Stripe.PaymentMethod): GwPaymentMethod {
  return {
    id: pm.id,
    type: pm.type,
    customer: idOf(pm.customer),
    usBankAccount: pm.us_bank_account ? { bankName: pm.us_bank_account.bank_name ?? null, last4: pm.us_bank_account.last4 ?? null } : null,
    card: pm.card ? { brand: pm.card.brand ?? null, last4: pm.card.last4 ?? null } : null,
  };
}

function invoiceOf(inv: Stripe.Invoice): GwInvoice {
  const pi = (inv as unknown as { payment_intent?: string | { id: string } | null }).payment_intent;
  const payments = (inv as unknown as { payments?: { data?: Array<{ payment?: { payment_intent?: string | { id: string } | null } }> } }).payments?.data ?? [];
  const fromPayments = payments.map((p) => idOf(p.payment?.payment_intent ?? null)).find((x) => x) ?? null;
  return {
    id: inv.id!,
    number: inv.number ?? null,
    status: inv.status ?? "draft",
    customer: idOf(inv.customer) ?? "",
    total: inv.total,
    amountDue: inv.amount_due,
    amountPaid: inv.amount_paid,
    amountRemaining: inv.amount_remaining,
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdf: inv.invoice_pdf ?? null,
    dueDate: inv.due_date ?? null,
    paymentIntent: idOf(pi ?? null) ?? fromPayments,
    metadata: meta(inv.metadata),
  };
}

export class RealStripeGateway implements StripeGateway {
  readonly kind = "real" as const;
  private readonly stripe: Stripe;
  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey);
  }
  async retrieveAccount(): Promise<GwAccount> {
    const a = await this.stripe.accounts.retrieve(null as never);
    return { id: a.id, country: a.country ?? null, chargesEnabled: Boolean(a.charges_enabled) };
  }
  async searchCustomers(query: string, limit = 10) {
    const r = await this.stripe.customers.search({ query, limit });
    return r.data.map(customerOf);
  }
  async listCustomers(params: { limit: number; startingAfter?: string | null }) {
    const r = await this.stripe.customers.list({ limit: params.limit, ...(params.startingAfter ? { starting_after: params.startingAfter } : {}) });
    return { data: r.data.map(customerOf), hasMore: r.has_more };
  }
  async createCustomer(params: CreateCustomerParams, idempotencyKey: string) {
    const c = await this.stripe.customers.create(
      {
        name: params.name,
        email: params.email ?? undefined,
        metadata: params.metadata,
        tax_exempt: "exempt",
        ...(params.address ? { address: { line1: params.address.line1, line2: params.address.line2 ?? undefined, city: params.address.city, state: params.address.state, postal_code: params.address.postalCode, country: params.address.country ?? "US" } } : {}),
      },
      { idempotencyKey },
    );
    return customerOf(c);
  }
  async updateCustomer(id: string, params: Partial<CreateCustomerParams> & { defaultPaymentMethod?: string | null }) {
    const c = await this.stripe.customers.update(id, {
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.email !== undefined ? { email: params.email ?? "" } : {}),
      ...(params.metadata ? { metadata: params.metadata } : {}),
      ...(params.address ? { address: { line1: params.address.line1, line2: params.address.line2 ?? undefined, city: params.address.city, state: params.address.state, postal_code: params.address.postalCode, country: params.address.country ?? "US" } } : {}),
      ...(params.defaultPaymentMethod !== undefined ? { invoice_settings: { default_payment_method: params.defaultPaymentMethod ?? "" } } : {}),
    });
    return customerOf(c);
  }
  async retrieveCustomer(id: string) {
    try {
      return customerOf(await this.stripe.customers.retrieve(id));
    } catch (err) {
      if ((err as { code?: string }).code === "resource_missing") return null;
      throw err;
    }
  }
  async listPaymentMethods(customer: string, type: "us_bank_account" | "card") {
    const r = await this.stripe.paymentMethods.list({ customer, type, limit: 20 });
    return r.data.map(paymentMethodOf);
  }
  async retrievePaymentMethod(id: string) {
    try {
      return paymentMethodOf(await this.stripe.paymentMethods.retrieve(id));
    } catch (err) {
      if ((err as { code?: string }).code === "resource_missing") return null;
      throw err;
    }
  }
  async createSetupSession(params: { customer: string; paymentMethodTypes: Array<"us_bank_account" | "card">; successUrl: string; cancelUrl: string; metadata: Record<string, string> }) {
    const s = await this.stripe.checkout.sessions.create({
      mode: "setup",
      customer: params.customer,
      payment_method_types: params.paymentMethodTypes,
      // Instant verification through the customer's bank login, with the two test deposits as the fallback (B5). The
      // `balances` permission is asked for at setup so a balance check before a debit is possible later (banks linked
      // without it would have to reconnect).
      payment_method_options: params.paymentMethodTypes.includes("us_bank_account") ? { us_bank_account: { verification_method: "automatic", financial_connections: { permissions: ["payment_method", "balances"] } } } : undefined,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
    });
    return { id: s.id, url: s.url ?? null, expiresAt: s.expires_at, setupIntent: idOf(s.setup_intent), status: s.status ?? null };
  }
  async retrieveSetupIntent(id: string) {
    try {
      const si = await this.stripe.setupIntents.retrieve(id);
      return { id: si.id, status: si.status, customer: idOf(si.customer), paymentMethod: idOf(si.payment_method), mandate: idOf(si.mandate), nextActionType: si.next_action?.type ?? null };
    } catch (err) {
      if ((err as { code?: string }).code === "resource_missing") return null;
      throw err;
    }
  }
  async createInvoice(params: CreateInvoiceParams, idempotencyKey: string) {
    const inv = await this.stripe.invoices.create(
      {
        customer: params.customer,
        collection_method: "send_invoice",
        due_date: params.dueDate,
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        ...(params.number ? { number: params.number } : {}),
        metadata: params.metadata,
        custom_fields: params.customFields.length ? params.customFields.slice(0, 4) : undefined,
        description: params.description ?? undefined,
        footer: params.footer ?? undefined,
      },
      { idempotencyKey },
    );
    return invoiceOf(inv);
  }
  async addInvoiceLines(id: string, lines: GwInvoiceLineInput[], idempotencyKey: string) {
    const inv = await this.stripe.invoices.addLines(
      id,
      {
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          price_data: { currency: "usd", unit_amount: l.unitAmount, product_data: { name: l.productName }, tax_behavior: "exclusive" },
          metadata: l.metadata,
        })),
      },
      { idempotencyKey },
    );
    return invoiceOf(inv);
  }
  async finalizeInvoice(id: string, idempotencyKey: string) {
    return invoiceOf(await this.stripe.invoices.finalizeInvoice(id, { auto_advance: false }, { idempotencyKey }));
  }
  async retrieveInvoice(id: string) {
    try {
      return invoiceOf(await this.stripe.invoices.retrieve(id, { expand: ["payments"] }));
    } catch (err) {
      if ((err as { code?: string }).code === "resource_missing") return null;
      throw err;
    }
  }
  async payInvoice(id: string, opts: PayInvoiceOptions, idempotencyKey: string) {
    const inv = await this.stripe.invoices.pay(
      id,
      {
        ...(opts.paidOutOfBand ? { paid_out_of_band: true } : {}),
        ...(opts.paymentMethod ? { payment_method: opts.paymentMethod } : {}),
        ...(opts.mandate ? { mandate: opts.mandate } : {}),
        ...(opts.offSession !== undefined ? { off_session: opts.offSession } : {}),
        expand: ["payments"],
      },
      { idempotencyKey },
    );
    return invoiceOf(inv);
  }
  async voidInvoice(id: string) {
    return invoiceOf(await this.stripe.invoices.voidInvoice(id));
  }
  async updateInvoiceMetadata(id: string, metadata: Record<string, string>) {
    return invoiceOf(await this.stripe.invoices.update(id, { metadata }));
  }
  async createCreditNote(params: CreateCreditNoteParams, idempotencyKey: string) {
    const cn = await this.stripe.creditNotes.create(
      {
        invoice: params.invoice,
        amount: params.amount,
        memo: params.memo,
        metadata: params.metadata,
        ...(params.apply === "customer_balance" ? { credit_amount: params.amount } : params.apply === "refund" ? { refund_amount: params.amount } : {}),
      },
      { idempotencyKey },
    );
    return { id: cn.id, number: cn.number ?? null, status: cn.status, amount: cn.amount };
  }
  async listInvoices(params: { limit: number; startingAfter?: string | null; status?: "open" | "paid" | "draft" | "void" | "uncollectible" | null; customer?: string | null }) {
    const r = await this.stripe.invoices.list({ limit: params.limit, ...(params.startingAfter ? { starting_after: params.startingAfter } : {}), ...(params.status ? { status: params.status } : {}), ...(params.customer ? { customer: params.customer } : {}) });
    return { data: r.data.map(invoiceOf), hasMore: r.has_more };
  }
  async listPayouts(params: { limit: number; startingAfter?: string | null; createdAfter?: number | null }) {
    const r = await this.stripe.payouts.list({ limit: params.limit, ...(params.startingAfter ? { starting_after: params.startingAfter } : {}), ...(params.createdAfter ? { created: { gte: params.createdAfter } } : {}) });
    return { data: r.data.map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, status: p.status, arrivalDate: p.arrival_date, created: p.created })), hasMore: r.has_more };
  }
  async listBalanceTransactionsForPayout(payoutId: string) {
    const out: GwBalanceTransaction[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < 50; page += 1) {
      const r = await this.stripe.balanceTransactions.list({ payout: payoutId, limit: 100, expand: ["data.source"], ...(startingAfter ? { starting_after: startingAfter } : {}) });
      for (const bt of r.data) {
        const src = bt.source as Stripe.BalanceTransaction["source"];
        const charge = src && typeof src === "object" && "object" in src && src.object === "charge" ? (src as Stripe.Charge) : null;
        const chargeInvoice = charge ? idOf((charge as unknown as { invoice?: string | { id: string } | null }).invoice ?? null) : null;
        out.push({ id: bt.id, type: bt.type, amount: bt.amount, fee: bt.fee, net: bt.net, created: bt.created, source: idOf(src as never), chargeId: charge?.id ?? null, invoiceId: chargeInvoice, description: bt.description ?? null });
      }
      if (!r.has_more) break;
      startingAfter = r.data[r.data.length - 1]?.id;
    }
    return out;
  }
  constructEvent(rawBody: string, signature: string, secret: string): GwEvent {
    const e = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    return { id: e.id, type: e.type, created: e.created, livemode: e.livemode, data: { object: e.data.object as unknown as Record<string, unknown> } };
  }
}

// ---------------------------------------------------------------------------
// Selection: real on any deployment; the fake only locally (demo or tests) and only when asked for.
// ---------------------------------------------------------------------------

let override: StripeGateway | null = null;
let real: { key: string; gw: RealStripeGateway } | null = null;

/** Tests (and the local demo) install the in-memory gateway here. Refused on a deployment. */
export function setStripeGateway(gw: StripeGateway | null) {
  if (gw && isDeployment()) throw new Error("A fake Stripe gateway can never be installed on a deployment");
  override = gw;
}

/** The local demo (scripts/demo.mjs) asks for the fake with FV_STRIPE_FAKE=true; a deployment never gets one. */
export function fakeStripeRequested(): boolean {
  return !isDeployment() && process.env.FV_STRIPE_FAKE === "true";
}

export function stripeGatewayMode(): "real" | "fake" | "off" {
  if (override) return override.kind;
  if (envPresent("STRIPE_SECRET_KEY")) return "real";
  if (fakeStripeRequested()) return "fake";
  return "off";
}

export function currentStripeGateway(): StripeGateway | null {
  if (override) return override;
  const key = process.env.STRIPE_SECRET_KEY;
  if (key && key.trim()) {
    if (!real || real.key !== key) real = { key, gw: new RealStripeGateway(key) };
    return real.gw;
  }
  if (fakeStripeRequested()) {
    override = installFakeStripe();
    return override;
  }
  return null;
}

/** Tests: a fresh in-memory Stripe installed as the gateway. Refused on a deployment. */
export function useFakeStripe(): FakeStripe {
  const fake = resetFakeStripe();
  setStripeGateway(fake);
  return fake;
}
