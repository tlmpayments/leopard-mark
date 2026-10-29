"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { SubmitButton } from "@/components/client";
import { Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import type { FormState } from "@/lib/actions/helpers";

export interface OrderFormCatalogItem {
  skuId: string;
  brand: string;
  name: string;
  sellingUnit: string;
  priceCents: number | null;
  kegsPerUnit: number;
  orderable: boolean;
  reason?: string;
  /** From the repeat preview, when repeating. */
  previous?: { qty: number; previousPriceCents: number; change: string };
}

export interface OrderFormProps {
  locationId: string;
  tradeName: string;
  /** "CODE Name" of the origin that will ship (R2-34). */
  originName: string;
  catalog: OrderFormCatalogItem[];
  sources: Array<{ value: string; label: string }>;
  kegDepositCents: number;
  minimumCents: number;
  /** Selected D11 basis, or null when unselected. */
  minimumBasis: string | null;
  /** The account is a samples recipient (the market's samples house or a rep's home address): no charge by default. */
  samplesRecipient: boolean;
  /** The account collects at the warehouse (will-call) by default. */
  pickupDefault: boolean;
  /** The market's route days (R2-4), shown as a hint when scheduling; never enforced. */
  routeDays: string[];
  /** Round 3: the origin's next ship date and cutoff, e.g. "WLA can ship next on Wed, Nov 4. Order by 2:30 p.m. Pacific the day before." */
  cutoffHint?: string | null;
  repeatOf: { orderNumber: string; notes: string | null; skipped: Array<{ skuName: string; change: string }> } | null;
  /** Generated once per page render on the server; the server refuses to create a second order for the same key. */
  submissionKey: string;
  todayIso: string;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
}

function cents(n: number) {
  return (n / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const btn = {
  primary: "inline-flex h-9 items-center justify-center whitespace-nowrap bg-navy px-4 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-40",
  secondary: "inline-flex h-9 items-center justify-center whitespace-nowrap border border-rule bg-ground px-4 text-sm font-medium text-navy hover:border-navy disabled:opacity-40",
  danger: "inline-flex h-9 items-center justify-center whitespace-nowrap border border-ink px-4 text-sm font-medium text-ink hover:bg-paper disabled:opacity-40",
};

/**
 * The one-screen order (R2-1, UX-03): account (chosen on the previous step), how it came in, products, dates; submit
 * records the order and drafts its shipment; "Submit and confirm" also confirms the shipment for the scheduled date
 * so the BOL and picking ticket are ready to print. A short origin comes back as a panel (R2-5) with the lines it
 * cannot cover; the office ships what is on hand (with a reason) or holds the order. Typed values survive every
 * round trip; replay protection is the server's submission key, never the spinner.
 */
export function OrderForm(props: OrderFormProps) {
  const [state, formAction] = useActionState(props.action, {} as FormState);
  const submissionKey = state.values?.submissionKey ?? props.submissionKey;
  const initial = useMemo(() => {
    const q: Record<string, string> = {};
    for (const c of props.catalog) {
      const fromState = state.values?.[`qty:${c.skuId}`];
      if (fromState !== undefined) q[c.skuId] = fromState;
      else if (c.previous && c.orderable) q[c.skuId] = String(c.previous.qty);
    }
    return q;
  }, [props.catalog, state.values]);
  const [qty, setQty] = useState<Record<string, string>>(initial);
  const [source, setSource] = useState(state.values?.source ?? props.sources[0]?.value ?? "phone");
  const [noCharge, setNoCharge] = useState(state.values ? state.values.noCharge === "on" : props.samplesRecipient);
  const merchandise = props.catalog.reduce((s, c) => s + (Number(qty[c.skuId]) || 0) * (c.priceCents ?? 0), 0);
  const kegs = props.catalog.reduce((s, c) => s + (Number(qty[c.skuId]) || 0) * c.kegsPerUnit, 0);
  const anyQty = props.catalog.some((c) => (Number(qty[c.skuId]) || 0) > 0);
  const minimumApplies = source === "rep" && !noCharge;
  const minimumNote = (() => {
    const deposits = kegs * props.kegDepositCents;
    const bases = { merchandise_only: merchandise, merchandise_plus_deposits: merchandise + deposits } as Record<string, number>;
    if (props.minimumBasis && props.minimumBasis in bases) return bases[props.minimumBasis] >= props.minimumCents ? "Meets the $90 rep minimum." : "Below the $90 rep minimum; recorded and flagged for the office.";
    const all = Object.values(bases).every((v) => v >= props.minimumCents);
    const none = Object.values(bases).every((v) => v < props.minimumCents);
    if (all) return "Meets the $90 rep minimum.";
    if (none) return "Below the $90 rep minimum; recorded and flagged for the office.";
    return "Whether this meets the $90 rep minimum depends on an Owner decision (D11); recorded and flagged.";
  })();
  const shortfall = state.shortfall ?? null;
  const brands = Array.from(new Set(props.catalog.map((c) => c.brand)));

  return (
    <form action={formAction} className="space-y-5" aria-describedby={state.error ? "form-error" : undefined}>
      <input type="hidden" name="locationId" value={props.locationId} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      {state.error ? (
        <div id="form-error" data-flash="error" role="alert" className="border-l-2 border-ink bg-paper px-3 py-2 text-sm text-ink">
          {state.error}
        </div>
      ) : null}
      {props.repeatOf ? (
        <Notice tone="info" title={`Repeating ${props.repeatOf.orderNumber}.`}>
          A new order at today&apos;s prices. Adjust quantities, then place it deliberately. {props.repeatOf.skipped.length ? `Not carried over: ${props.repeatOf.skipped.map((s) => `${s.skuName} (${s.change.replace(/_/g, " ")})`).join(", ")}.` : "Every product is still orderable."}
        </Notice>
      ) : null}

      {shortfall ? (
        <section aria-labelledby="shortfall-title" className="border border-ink bg-paper p-4" data-testid="shortfall">
          <input type="hidden" name="intent" value={state.values?.intent ?? "submit"} />
          <h2 id="shortfall-title" className="font-display text-base font-bold text-ink">
            {shortfall.originName} cannot cover this order
          </h2>
          <table className="mt-2 w-full max-w-xl text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left font-display text-[10.5px] uppercase tracking-[0.12em] text-ink-2">
                <th className="py-1 pr-2">Product</th>
                <th className="py-1 pr-2 text-right">Asked</th>
                <th className="py-1 pr-2 text-right">On hand</th>
                <th className="py-1 text-right">Short</th>
              </tr>
            </thead>
            <tbody>
              {shortfall.lines.map((l) => (
                <tr key={l.skuId} className="border-b border-rule-soft tabular-nums">
                  <td className="py-1 pr-2">{l.skuName}</td>
                  <td className="py-1 pr-2 text-right">{l.requested}</td>
                  <td className="py-1 pr-2 text-right">{l.available}</td>
                  <td className="py-1 text-right font-semibold">{l.short}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-sm text-ink-2">Submit anyway ships what is on hand now and keeps the rest as an open line on the order. Hold keeps the whole order unconfirmed until stock arrives. Either way your name and reason go on the order (R2-5).</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
            <Field label="Reason" hint="Required to submit short." error={state.fieldErrors?.shortfallReason}>
              <Input name="shortfallReason" defaultValue={state.values?.shortfallReason ?? ""} placeholder="e.g. buyer agreed to take the rest next week" />
            </Field>
            <SubmitButton className={btn.primary} name="shortfallDecision" value="ship_available">
              Submit anyway
            </SubmitButton>
            <SubmitButton className={btn.secondary} name="shortfallDecision" value="hold">
              Hold
            </SubmitButton>
          </div>
        </section>
      ) : null}

      <Card title="How it came in">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <Field label="Source" error={state.fieldErrors?.source}>
            <Select name="source" value={source} onChange={(e) => setSource(e.target.value)}>
              {props.sources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="PO numbers" hint={source === "po" ? "Required for a purchase-order order; printed on the BOL and the invoice." : "Optional; several separated by commas (R2-11)."} error={state.fieldErrors?.poNumbers}>
            <Input name="poNumbers" defaultValue={state.values?.poNumbers ?? ""} placeholder="PO-4471" required={source === "po"} />
          </Field>
          <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="noCharge" checked={noCharge} onChange={(e) => setNoCharge(e.target.checked)} /> No charge (samples): ships as S, invoices on the NC series
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="pickup" defaultChecked={state.values ? state.values.pickup === "on" : props.pickupDefault} /> Will-call: picked up at {props.originName}, no driver
            </label>
          </div>
        </div>
      </Card>

      <Card title={`Products, shipping from ${props.originName}`}>
        {brands.map((brand) => (
          <div key={brand} className="mb-3 last:mb-0">
            <div className="font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2">{brand}</div>
            <ul className="divide-y divide-rule-soft">
              {props.catalog
                .filter((c) => c.brand === brand)
                .map((c) => {
                  const fieldError = state.fieldErrors?.[`qty:${c.skuId}`];
                  return (
                    <li key={c.skuId} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3 py-1.5">
                      <div className="min-w-0">
                        <label htmlFor={`qty-${c.skuId}`} className="block text-sm text-ink">
                          {c.brand} {c.name}
                        </label>
                        <div className="text-xs text-ink-3">
                          {c.sellingUnit}, {c.priceCents !== null ? cents(c.priceCents) : "no price"}
                          {noCharge ? " (no charge)" : ""}
                          {c.previous?.change === "price_changed" ? `, price changed from ${cents(c.previous.previousPriceCents)}` : ""}
                          {!c.orderable ? `, ${c.reason}` : ""}
                        </div>
                        {fieldError ? (
                          <div className="text-xs text-ink" role="alert">
                            {fieldError}
                          </div>
                        ) : null}
                      </div>
                      <Input
                        id={`qty-${c.skuId}`}
                        name={`qty:${c.skuId}`}
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        className="text-right"
                        placeholder="0"
                        value={qty[c.skuId] ?? ""}
                        onChange={(e) => setQty({ ...qty, [c.skuId]: e.target.value })}
                        disabled={!c.orderable}
                        aria-invalid={fieldError ? true : undefined}
                      />
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div>
            <dt className="font-display text-[10.5px] uppercase tracking-[0.12em] text-ink-2">Merchandise</dt>
            <dd className="tabular-nums">{noCharge ? `${cents(0)} (no charge)` : cents(merchandise)}</dd>
          </div>
          <div>
            <dt className="font-display text-[10.5px] uppercase tracking-[0.12em] text-ink-2">Kegs</dt>
            <dd className="tabular-nums">{kegs}</dd>
          </div>
          <div>
            <dt className="font-display text-[10.5px] uppercase tracking-[0.12em] text-ink-2">$90 minimum</dt>
            <dd className="text-xs text-ink-2">{minimumApplies ? (anyQty ? minimumNote : "Enter quantities to see.") : "Not applied to office orders, samples or POS (R2-6)."}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Dates">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <Field label="Requested date" hint="What the account asked for; stays on the order (R2-3)." error={state.fieldErrors?.requestedDate}>
            <Input name="requestedDate" type="date" defaultValue={state.values?.requestedDate ?? ""} />
          </Field>
          <Field label="Scheduled date" hint={`Set it to confirm now; otherwise confirm from the order later.${props.cutoffHint ? ` ${props.cutoffHint}` : props.routeDays.length ? ` Route days: ${props.routeDays.join(", ")}.` : ""}`} error={state.fieldErrors?.scheduledDate}>
            <Input name="scheduledDate" type="date" min={props.todayIso} defaultValue={state.values?.scheduledDate ?? ""} />
          </Field>
          <Field label="Notes" error={state.fieldErrors?.notes}>
            <Textarea name="notes" rows={2} defaultValue={state.values?.notes ?? props.repeatOf?.notes ?? ""} />
          </Field>
        </div>
      </Card>

      {!shortfall ? (
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton className={btn.primary} disabled={!anyQty} name="intent" value="submit">
            {props.repeatOf ? "Place new order" : "Submit order"}
          </SubmitButton>
          <SubmitButton className={btn.secondary} disabled={!anyQty} name="intent" value="confirm">
            Submit and confirm shipment
          </SubmitButton>
          <Link href={`/locations/${props.locationId}`} className="inline-flex h-9 items-center px-3 text-sm text-ink-2 hover:text-navy">
            Cancel
          </Link>
          <span className="text-xs text-ink-3">Submit drafts the shipment from {props.originName}; confirm also numbers it for the scheduled date and prints.</span>
        </div>
      ) : null}
    </form>
  );
}
