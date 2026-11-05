"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button, Card, Code, Field, Input, Notice, Select, Textarea, fmtDay } from "@/components/ui";
import type { FormState } from "@/lib/actions/helpers";

export interface PackagingFormBatch {
  id: string;
  /** "B01CNT26004 · EBB East Brother · CNT Cantinesca · 30 bbl · brewed Oct 1, 2026", built on the server. */
  label: string;
  facilityId: string;
  facilityLabel: string;
  brandCode: string;
  brandLabel: string;
  /** The batch already has a lot: this report adds a packaging day to it (R2-21). */
  lot: { lotCode: string; lastPackagedOn: string } | null;
}

export interface PackagingFormSku {
  id: string;
  code: string;
  label: string;
  sellingUnit: string;
  /** Brand codes the SKU belongs to (brandCodeForSku, or the brand's name), worked out on the server. */
  brandCodes: string[];
}

export interface PackagingFormProps {
  facilities: Array<{ id: string; label: string }>;
  brands: Array<{ code: string; name: string }>;
  batches: PackagingFormBatch[];
  skus: PackagingFormSku[];
  initialFacilityId: string;
  initialBatchId: string;
  defaultBrand: string;
  today: string;
  action: (prev: FormState, form: FormData) => Promise<FormState>;
}

const th = "border-b border-rule py-1 pr-2 text-left font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2";
const submitClass = "inline-flex h-9 items-center justify-center whitespace-nowrap bg-navy px-4 text-sm font-medium text-paper transition hover:opacity-90 disabled:opacity-40";

/**
 * The packaging report (4.4), batch first: a chosen batch brings its facility and brand (shown, not asked again);
 * without a batch the facility and brand are chosen and the facility narrows the batch list. The quantities table
 * lists the brand's SKUs only. The run digit is automatic unless one is typed. The form is submitted without a
 * reset, so a refusal keeps everything as typed.
 */
export function PackagingForm(props: PackagingFormProps) {
  const [state, formAction, pending] = useActionState(props.action, {} as FormState);
  const [batchId, setBatchId] = useState(props.batches.some((b) => b.id === props.initialBatchId) ? props.initialBatchId : "");
  const [facilityId, setFacilityId] = useState(props.initialFacilityId);
  const [brandCode, setBrandCode] = useState(props.defaultBrand);
  const [qty, setQty] = useState<Record<string, string>>({});

  const batch = props.batches.find((b) => b.id === batchId) ?? null;
  const brand = batch?.brandCode ?? brandCode;
  // A facility chosen without a batch narrows the list; once a batch is chosen every batch is offered again.
  const listed = !batch && facilityId ? props.batches.filter((b) => b.facilityId === facilityId) : props.batches;
  const fresh = listed.filter((b) => !b.lot);
  const packaged = listed.filter((b) => b.lot);
  const brandSkus = props.skus.filter((s) => s.brandCodes.includes(brand));
  const shownSkus = brandSkus.length ? brandSkus : props.skus;
  const brandName = batch?.brandLabel ?? `${brand} ${props.brands.find((b) => b.code === brand)?.name ?? ""}`.trim();
  const err = state.fieldErrors ?? {};

  function chooseBatch(id: string) {
    const b = props.batches.find((x) => x.id === id);
    // Keep the selects in step (when they offer the batch's values), so clearing the batch again leaves them chosen.
    if (b && props.facilities.some((o) => o.id === b.facilityId)) setFacilityId(b.facilityId);
    if (b && props.brands.some((x) => x.code === b.brandCode)) setBrandCode(b.brandCode);
    setBatchId(id);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8" aria-describedby={state.error ? "form-error" : undefined}>
      {state.error ? (
        <div id="form-error" data-flash="error" role="alert" className="border-l-2 border-ink py-1 pl-3 text-sm text-ink">
          <strong className="font-semibold">Not done. </strong>
          {state.error}
        </div>
      ) : null}
      <Card title="Run">
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Field label="Batch" hint="Choose the batch first: its brewery and brand fill in. A batch already packaged adds this day to its lot (R2-21). Packaged total and loss show against the batch size (R2-22)." error={err.batchId}>
              <Select name="batchId" value={batchId} onChange={(e) => chooseBatch(e.target.value)}>
                <option value="">No batch (choose the facility and brand below)</option>
                {fresh.length ? (
                  <optgroup label="Not yet packaged">
                    {fresh.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {packaged.length ? (
                  <optgroup label="Already packaged (adds a packaging day to its lot)">
                    {packaged.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </Select>
            </Field>
            {!batch && facilityId && listed.length === 0 ? <p className="mt-1 text-xs text-ink-3">No batch in progress or recently complete at this facility.</p> : null}
          </div>
          {batch ? (
            <>
              <input type="hidden" name="facilityWarehouseId" value={batch.facilityId} />
              <input type="hidden" name="brandCode" value={batch.brandCode} />
              <Field label="Facility (brewery)" hint="From the batch.">
                <div className="flex h-9 items-center text-sm text-ink">{batch.facilityLabel}</div>
              </Field>
              <Field label="Brand" hint="From the batch.">
                <div className="flex h-9 items-center text-sm text-ink">{batch.brandLabel}</div>
              </Field>
            </>
          ) : (
            <>
              <Field label="Facility (brewery)" hint="Only breweries package; the facility's two-digit lot code leads the lot code. Narrows the batch list." error={err.facilityWarehouseId}>
                <Select name="facilityWarehouseId" required value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
                  <option value="" disabled>
                    Facility
                  </option>
                  {props.facilities.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Brand" error={err.brandCode}>
                <Select name="brandCode" required value={brandCode} onChange={(e) => setBrandCode(e.target.value)}>
                  {props.brands.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.code} {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <div className="grid grid-cols-[1fr_6rem] gap-x-3">
            <Field label={batch?.lot ? "Packaged on" : "Packaging date"} hint={batch?.lot ? "Not before the lot's first day." : "The first day of the run (R2-21); a later day on the same batch adds to its lot."} error={err.packagingDate}>
              <Input name="packagingDate" type="date" required defaultValue={props.today} />
            </Field>
            {batch?.lot ? (
              <Field label="Run" hint="Kept from the lot.">
                <div className="flex h-9 items-center">
                  <Code>{batch.lot.lotCode.slice(-1)}</Code>
                </div>
              </Field>
            ) : (
              <Field label="Run" hint="Blank: next free digit.">
                {/* A taken digit's message (with the next free digit) is in the banner above; the column is too narrow for it. */}
                <Input name="runCode" maxLength={1} placeholder="Auto" className="text-center uppercase" aria-describedby="run-hint" aria-invalid={err.runCode ? true : undefined} />
              </Field>
            )}
          </div>
          {batch?.lot ? null : (
            <Field label="Quantities" hint="Opens an exception until the host confirms (4.6).">
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" name="quantitiesUnknown" /> Not yet known
              </label>
            </Field>
          )}
        </div>
        {batch?.lot ? (
          <div className="mt-4">
            <Notice tone="info" title={`Adds a day to lot ${batch.lot.lotCode}.`}>
              This batch was packaged before (last on {fmtDay(batch.lot.lastPackagedOn)}). The quantities below are added to that lot and go on hand at the brewery; the lot keeps its code.
            </Notice>
          </div>
        ) : (
          <p id="run-hint" className="mt-3 text-xs text-ink-3">
            Leave Run blank and the next free digit for the facility, brand and date is used. Type a digit only to match the host&apos;s sheet; one digit per brew.
          </p>
        )}
      </Card>

      <Card title={`Quantities packaged per SKU: ${brandName}`}>
        <table className="w-full text-[13px] leading-5">
          <thead>
            <tr>
              <th scope="col" className={th}>
                SKU
              </th>
              <th scope="col" className={th}>
                Description
              </th>
              <th scope="col" className={th}>
                Selling unit
              </th>
              <th scope="col" className={`w-28 ${th} pr-0 text-right`}>
                Qty packaged
              </th>
            </tr>
          </thead>
          <tbody>
            {shownSkus.map((s) => (
              <tr key={s.id} className="border-b border-rule-soft hover:bg-hover">
                <td className="py-1 pr-2 align-middle">
                  <Code>{s.code}</Code>
                </td>
                <td className="py-1 pr-2 align-middle">{s.label}</td>
                <td className="py-1 pr-2 align-middle text-ink-2">{s.sellingUnit}</td>
                <td className="py-1 text-right align-middle">
                  <Input
                    name={`qty:${s.id}`}
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    className="h-8 w-24 text-right"
                    aria-label={`${s.code} quantity`}
                    value={qty[s.id] ?? ""}
                    onChange={(e) => setQty((q) => ({ ...q, [s.id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-3">
          {brandSkus.length ? "Only this brand's SKUs are listed; blank means not in this run. A lot normally holds several SKUs (4.3)." : "No active SKU is coded for this brand, so every active SKU is listed; blank means not in this run."}
        </p>
        {err.quantities ? (
          <p className="mt-1 text-xs text-ink" role="alert">
            {err.quantities}
          </p>
        ) : null}
      </Card>

      <Card title="Notes">
        <Textarea name="notes" rows={2} placeholder="Host's sheet reference, Ekos flag, anything the warehouse should know" />
      </Card>

      <div className="flex items-center gap-2 border-t border-rule pt-4">
        <button type="submit" disabled={pending} aria-busy={pending} className={submitClass}>
          {pending ? "Working" : "Record lot"}
        </button>
        <Button href="/lots" variant="ghost">
          Cancel
        </Button>
      </div>
    </form>
  );
}
