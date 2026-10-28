"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import type { FormState } from "@/lib/actions/helpers";

type Action = (prev: FormState, form: FormData) => Promise<FormState>;

function Result({ state }: { state: FormState }) {
  if (state.error) return <div data-flash="error" role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</div>;
  return null;
}

export function MigrateForm({ action, pending }: { action: Action; pending: string[] }) {
  const [state, formAction] = useActionState(action, {} as FormState);
  return (
    <form action={formAction} className="space-y-3">
      <Result state={state} />
      <Field label="Setup token (the CRON_SECRET of this deployment)" htmlFor="migrate-token">
        <Input id="migrate-token" name="token" type="password" autoComplete="off" required />
      </Field>
      <Button>{pending.length ? `Apply ${pending.length} pending migration(s)` : "Re-check (nothing pending)"}</Button>
    </form>
  );
}

export function OwnerForm({ action }: { action: Action }) {
  const [state, formAction] = useActionState(action, {} as FormState);
  const err = (k: string) => state.fieldErrors?.[k];
  return (
    <form action={formAction} className="space-y-3">
      <Result state={state} />
      <Field label="Setup token (the CRON_SECRET of this deployment)" htmlFor="owner-token">
        <Input id="owner-token" name="token" type="password" autoComplete="off" required />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Owner's company email" error={err("email")}>
          <Input name="email" type="email" required defaultValue={state.values?.email ?? ""} autoComplete="off" />
        </Field>
        <Field label="Owner's name" error={err("name")}>
          <Input name="name" required defaultValue={state.values?.name ?? ""} autoComplete="off" />
        </Field>
        <Field label="Temporary PIN (6–12 digits)" hint="You will choose your real PIN at first sign-in." error={err("pin")}>
          <Input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6,12}" required autoComplete="off" />
        </Field>
        <Field label="Temporary PIN again" error={err("pinAgain")}>
          <Input name="pinAgain" type="password" inputMode="numeric" pattern="[0-9]{6,12}" required autoComplete="off" />
        </Field>
      </div>
      <Button>Provision the first Owner</Button>
    </form>
  );
}
