"use client";

import { useActionState, useState } from "react";
import { Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import type { FormState } from "@/lib/actions/helpers";

export interface LocationFormProps {
  markets: Array<{ id: string; name: string; code: string }>;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
}

/** New-account form (UX-01/UX-03): minimal entry, values preserved on error, field-level errors, no re-typing of a billing address that equals delivery. */
export function LocationForm({ markets, action }: LocationFormProps) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const v = (k: string, fallback = "") => state.values?.[k] ?? fallback;
  const err = (k: string) => state.fieldErrors?.[k];
  const [billingSame, setBillingSame] = useState(state.values ? state.values.billingSame !== "off" : true);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="billingSame" value={billingSame ? "on" : "off"} />
      {state.error && !Object.keys(state.fieldErrors ?? {}).length ? (
        <div data-flash="error" role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      ) : state.error ? (
        <div data-flash="error" role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          Please fix the highlighted field. Everything you typed is still here.
        </div>
      ) : null}
      <Card title="Location">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Market" error={err("marketId")}>
            <Select name="marketId" required defaultValue={v("marketId", markets.length === 1 ? markets[0].id : "")} aria-invalid={err("marketId") ? true : undefined}>
              <option value="" disabled>
                Choose…
              </option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.code})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Trade name" hint="Identical names can be legitimate; you may see a warning, never a block." error={err("tradeName")}>
            <Input name="tradeName" required autoComplete="organization" defaultValue={v("tradeName")} aria-invalid={err("tradeName") ? true : undefined} />
          </Field>
          <Field label="Legal name (optional)" hint="May be enriched internally later.">
            <Input name="legalName" defaultValue={v("legalName")} />
          </Field>
        </div>
      </Card>
      <Card title="Delivery address">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Street" error={err("d_line1")}>
            <Input name="d_line1" required autoComplete="address-line1" defaultValue={v("d_line1")} aria-invalid={err("d_line1") ? true : undefined} />
          </Field>
          <Field label="Suite / unit">
            <Input name="d_line2" autoComplete="address-line2" defaultValue={v("d_line2")} />
          </Field>
          <Field label="City" error={err("d_city")}>
            <Input name="d_city" required autoComplete="address-level2" defaultValue={v("d_city")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State" error={err("d_state")}>
              <Input name="d_state" required maxLength={2} autoComplete="address-level1" defaultValue={v("d_state")} />
            </Field>
            <Field label="ZIP" error={err("d_postal")}>
              <Input name="d_postal" required inputMode="numeric" autoComplete="postal-code" defaultValue={v("d_postal")} />
            </Field>
          </div>
        </div>
        <Field label="Delivery instructions" hint="Receiving hours, door, contact on arrival.">
          <Textarea name="deliveryInstructions" rows={2} defaultValue={v("deliveryInstructions")} />
        </Field>
        <Field label="Receiving restrictions (independently confirmed)">
          <Input name="receivingRestrictions" placeholder="e.g. no deliveries Mondays; truck access rear alley only" defaultValue={v("receivingRestrictions")} />
        </Field>
      </Card>
      <Card title="Billing address">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={billingSame} onChange={(e) => setBillingSame(e.target.checked)} className="h-5 w-5" /> Same as delivery address
        </label>
        {!billingSame ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Street" error={err("b_line1")}>
              <Input name="b_line1" defaultValue={v("b_line1")} />
            </Field>
            <Field label="Suite / unit">
              <Input name="b_line2" defaultValue={v("b_line2")} />
            </Field>
            <Field label="City" error={err("b_city")}>
              <Input name="b_city" defaultValue={v("b_city")} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="State" error={err("b_state")}>
                <Input name="b_state" maxLength={2} defaultValue={v("b_state")} />
              </Field>
              <Field label="ZIP" error={err("b_postal")}>
                <Input name="b_postal" defaultValue={v("b_postal")} />
              </Field>
            </div>
          </div>
        ) : null}
      </Card>
      <Card title="Contacts">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Buyer name" error={err("buyerName")}>
            <Input name="buyerName" required autoComplete="name" defaultValue={v("buyerName")} aria-invalid={err("buyerName") ? true : undefined} />
          </Field>
          <Field label="Buyer email" error={err("buyerEmail")}>
            <Input name="buyerEmail" type="email" autoComplete="email" defaultValue={v("buyerEmail")} aria-invalid={err("buyerEmail") ? true : undefined} />
          </Field>
          <Field label="Buyer phone">
            <Input name="buyerPhone" type="tel" autoComplete="tel" defaultValue={v("buyerPhone")} />
          </Field>
          <div />
          <Field label="AP name (optional)" hint="Identical name + email reuses the existing person record.">
            <Input name="apName" defaultValue={v("apName")} />
          </Field>
          <Field label="AP email (optional)" hint="Later changes require Admin approval." error={err("apEmail")}>
            <Input name="apEmail" type="email" defaultValue={v("apEmail")} aria-invalid={err("apEmail") ? true : undefined} />
          </Field>
        </div>
        <Notice tone="info">Legal/provider fields are not needed for a first sale. A shared AP contact never pools payment authority, credits, kegs or history across locations.</Notice>
      </Card>
      <Button>Create account</Button>
    </form>
  );
}
