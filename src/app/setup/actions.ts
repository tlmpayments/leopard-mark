"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { safeErrorMessage, type FormState } from "@/lib/actions/helpers";
import { getDb } from "@/lib/db/client";
import { BusinessError } from "@/lib/errors";
import { applyMigrations, provisionFirstOwner, setupTokenMatches } from "@/lib/setup/service";

/**
 * Setup page actions. Each one checks the setup token first; a wrong token is
 * refused after a short delay with no detail. PIN and token values are never
 * echoed back, logged or placed in a URL.
 */
async function guard(form: FormData): Promise<string | null> {
  const token = typeof form.get("token") === "string" ? (form.get("token") as string).trim() : "";
  if (!setupTokenMatches(token)) {
    await new Promise((r) => setTimeout(r, 1500));
    return "Setup token not accepted. It is the CRON_SECRET value configured for this deployment (at least 16 characters).";
  }
  return null;
}

export async function migrateAction(_prev: FormState, form: FormData): Promise<FormState> {
  const refused = await guard(form);
  if (refused) return { error: refused };
  let ok: string;
  try {
    const r = await applyMigrations(await getDb());
    const n = (r.after ?? 0) - (r.before ?? 0);
    ok = n > 0 ? `${n} migration(s) applied; decision register and capability gates seeded.` : "Database already up to date; decision register and capability gates re-checked.";
  } catch (err) {
    return { error: safeErrorMessage(err).message };
  }
  revalidatePath("/setup");
  redirect(`/setup?ok=${encodeURIComponent(ok)}`);
}

export async function ownerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const refused = await guard(form);
  if (refused) return { error: refused };
  const str = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string).trim() : "");
  if (str("pin") !== str("pinAgain")) return { error: "The two entries of the temporary PIN differ.", fieldErrors: { pinAgain: "The two entries differ." }, values: { email: str("email"), name: str("name") } };
  let ok: string;
  try {
    const r = await provisionFirstOwner(await getDb(), { email: str("email"), name: str("name"), pin: str("pin") });
    ok = `Owner ${r.email} provisioned with a temporary PIN. Sign in and choose your own PIN.`;
  } catch (err) {
    const safe = safeErrorMessage(err);
    const field = err instanceof BusinessError ? err.field : undefined;
    return { error: safe.message, fieldErrors: field ? { [field]: safe.message } : undefined, values: { email: str("email"), name: str("name") } };
  }
  revalidatePath("/setup");
  redirect(`/setup?ok=${encodeURIComponent(ok)}`);
}
