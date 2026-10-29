import { Button, Field, Input, Select } from "@/components/ui";
import { recordKegEventAction } from "./actions";

/** Opening balance, adjustment or stand-alone pickup for one account (8.5, 8.7). Server component: a plain form. */
export function KegEventForm({ locations, locationId, returnTo, today }: { locations: Array<{ id: string; label: string }>; locationId?: string; returnTo: string; today: string }) {
  return (
    <form action={recordKegEventAction} className="grid gap-2 sm:grid-cols-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      {locationId ? (
        <input type="hidden" name="locationId" value={locationId} />
      ) : (
        <Field label="Account">
          <Select name="locationId" required defaultValue="">
            <option value="" disabled>
              Account…
            </option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Kind">
        <Select name="kind" defaultValue="opening">
          <option value="opening">Opening balance (cut-over, 8.5)</option>
          <option value="adjustment">Adjustment (reason in the note, 8.7)</option>
          <option value="pickup">Pickup without a shipment</option>
        </Select>
      </Field>
      <Field label="Date">
        <Input name="on" type="date" required defaultValue={today} />
      </Field>
      <Field label="1/2 bbl out (at the account)">
        <Input name="halfOut" type="number" min={0} step={1} placeholder="0" />
      </Field>
      <Field label="1/6 bbl out (at the account)">
        <Input name="sixtelOut" type="number" min={0} step={1} placeholder="0" />
      </Field>
      <Field label="1/2 bbl in (returned)">
        <Input name="halfIn" type="number" min={0} step={1} placeholder="0" />
      </Field>
      <Field label="1/6 bbl in (returned)">
        <Input name="sixtelIn" type="number" min={0} step={1} placeholder="0" />
      </Field>
      <Field label="Note (required)" hint="Who counted, what happened.">
        <Input name="note" required />
      </Field>
      <div className="sm:col-span-4">
        <Button small variant="secondary">
          Record
        </Button>
      </div>
    </form>
  );
}
