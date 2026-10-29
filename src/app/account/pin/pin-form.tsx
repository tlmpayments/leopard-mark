"use client";

import { useActionState } from "react";
import { Button, Card, Field, Input } from "@/components/ui";
import type { FormState } from "@/lib/actions/helpers";

export function PinForm({ action, first }: { action: (prev: FormState, form: FormData) => Promise<FormState>; first: boolean }) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const err = (k: string) => state.fieldErrors?.[k];
  return (
    <form action={formAction} className="space-y-4">
      {state.error ? (
        <div data-flash="error" role="alert" className=" bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </div>
      ) : null}
      <Card title={first ? "Choose your PIN" : "Change your PIN"}>
        <div className="grid gap-3">
          <Field label={first ? "Temporary PIN you signed in with" : "Current PIN"} error={err("currentPin")}>
            <Input name="currentPin" type="password" inputMode="numeric" autoComplete="current-password" required aria-invalid={err("currentPin") ? true : undefined} />
          </Field>
          <Field label="New PIN" hint="6 to 12 digits; not one repeated digit, a straight run, or a repeated pair." error={err("newPin")}>
            <Input name="newPin" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}" required aria-invalid={err("newPin") ? true : undefined} />
          </Field>
          <Field label="New PIN again" error={err("confirmPin")}>
            <Input name="confirmPin" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6,12}" required aria-invalid={err("confirmPin") ? true : undefined} />
          </Field>
        </div>
        <div className="mt-4">
          <Button>{first ? "Save PIN and continue" : "Change PIN"}</Button>
        </div>
      </Card>
    </form>
  );
}
