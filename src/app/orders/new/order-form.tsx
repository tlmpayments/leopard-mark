"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Badge, Button, Card, Field, Input, Notice, Textarea } from "@/components/ui";
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
  catalog: OrderFormCatalogItem[];
  kegDepositCents: number;
  minimumCents: number;
  /** Selected D11 basis, or null when unselected. */
  minimumBasis: string | null;
  repeatOf: { orderNumber: string; notes: string | null; skipped: Array<{ skuName: string; change: string }> } | null;
  /** Generated once per page render on the server; the server refuses to create a second order for the same key. */
  submissionKey: string;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
}

function cents(n: number) {
  return (n / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * New / repeat order form (UX-03): values survive validation errors, field
 * errors sit next to their fields, totals preview live, the submit button
 * shows progress and blocks double clicks. Replay protection is the server's
 * submission key (generated once per form instance) — not the spinner.
 */
export function OrderForm(props: OrderFormProps) {
  const [state, formAction] = useActionState(props.action, {} as FormState);
  // One key per form instance: minted by the server render (so server and client markup match) and kept across validation errors.
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
  const merchandise = props.catalog.reduce((s, c) => s + (Number(qty[c.skuId]) || 0) * (c.priceCents ?? 0), 0);
  const kegs = props.catalog.reduce((s, c) => s + (Number(qty[c.skuId]) || 0) * c.kegsPerUnit, 0);
  const deposits = kegs * props.kegDepositCents;
  const anyQty = props.catalog.some((c) => (Number(qty[c.skuId]) || 0) > 0);
  const minimumNote = (() => {
    const bases = { merchandise_only: merchandise, merchandise_plus_deposits: merchandise + deposits } as Record<string, number>;
    if (props.minimumBasis && props.minimumBasis in bases) return bases[props.minimumBasis] >= props.minimumCents ? "Meets the $90 minimum." : "Below the $90 minimum — captured and flagged for Admin.";
    const all = Object.values(bases).every((v) => v >= props.minimumCents);
    const none = Object.values(bases).every((v) => v < props.minimumCents);
    if (all) return "Meets the $90 minimum on every basis.";
    if (none) return "Below the $90 minimum — captured and flagged for Admin.";
    return "Whether this meets the $90 minimum depends on an Owner decision (D11 basis) — captured and flagged for Admin.";
  })();

  return (
    <form action={formAction} className="space-y-4" aria-describedby={state.error ? "form-error" : undefined}>
      <input type="hidden" name="locationId" value={props.locationId} />
      <input type="hidden" name="submissionKey" value={submissionKey} />
      {state.error ? (
        <div id="form-error" data-flash="error" role="alert" className=" bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      ) : null}
      {props.repeatOf ? (
        <Notice tone="info" title={`Repeating ${props.repeatOf.orderNumber}.`}>
          This is a preview of a NEW order with today&apos;s prices. Adjust quantities, then place it deliberately. {props.repeatOf.skipped.length ? `Not carried over: ${props.repeatOf.skipped.map((s) => `${s.skuName} (${s.change.replace(/_/g, " ")})`).join(", ")}.` : "Every product is still orderable."}
        </Notice>
      ) : null}
      <Card title="Products (fixed market prices)">
        <ul className="divide-y divide-line">
          {props.catalog.map((c) => {
            const fieldError = state.fieldErrors?.[`qty:${c.skuId}`];
            return (
              <li key={c.skuId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <label htmlFor={`qty-${c.skuId}`} className="block truncate text-sm font-medium">
                    {c.brand} {c.name}
                  </label>
                  <div className="text-xs text-muted">
                    {c.sellingUnit} · {c.priceCents !== null ? cents(c.priceCents) : "no price"}
                    {c.kegsPerUnit ? ` + ${cents(props.kegDepositCents)} deposit/keg` : ""}{" "}
                    {c.previous?.change === "price_changed" ? <Badge tone="warn">price changed from {cents(c.previous.previousPriceCents)}</Badge> : null}
                    {!c.orderable ? <Badge tone="danger">{c.reason}</Badge> : null}
                  </div>
                  {fieldError ? (
                    <div className="text-xs text-danger" role="alert">
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
                  className="w-24"
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
        <div className="mt-3 grid gap-1 text-sm sm:grid-cols-3">
          <div>
            <span className="text-xs uppercase tracking-wide text-muted">Merchandise</span>
            <div>{cents(merchandise)}</div>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-muted">Keg deposits</span>
            <div>
              {kegs} × {cents(props.kegDepositCents)} = {cents(deposits)}
            </div>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide text-muted">$90 minimum</span>
            <div className="text-xs">{anyQty ? minimumNote : "Enter quantities to see."}</div>
          </div>
        </div>
      </Card>
      <Card title="Optional">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Requested date" hint="A request only — never a delivery promise. Admin schedules for route efficiency." error={state.fieldErrors?.requestedDate}>
            <Input name="requestedDate" type="date" defaultValue={state.values?.requestedDate ?? ""} />
          </Field>
          <Field label="Notes" error={state.fieldErrors?.notes}>
            <Textarea name="notes" rows={2} defaultValue={state.values?.notes ?? props.repeatOf?.notes ?? ""} />
          </Field>
        </div>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!anyQty}>{props.repeatOf ? "Place new order" : "Submit order"}</Button>
        <Link href={`/locations/${props.locationId}`} className="inline-flex min-h-11 items-center border border-rule bg-card px-4 py-2.5 text-sm">
          Cancel
        </Link>
      </div>
    </form>
  );
}
