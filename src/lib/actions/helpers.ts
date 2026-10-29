import "server-only";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/lib/auth/current";
import type { Actor } from "@/lib/authz/actor";
import { AuthorizationError } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import type { Db } from "@/lib/db/types";
import { BusinessError, isDisplayableError } from "@/lib/errors";

/**
 * Map any thrown error to something safe to show (UX-10, AC36). Expected
 * refusals (business rules, authorization, stale state) are shown verbatim;
 * anything else — database, provider, programming errors — is logged
 * server-side under a short reference and the person sees only that
 * reference. Raw messages never reach a URL, a page or the activity view.
 */
export function safeErrorMessage(err: unknown): { message: string; reference?: string } {
  if (err instanceof AuthorizationError) return { message: `Not permitted: ${err.message.replace(/^Not authorized: /, "")}` };
  if (isDisplayableError(err)) return { message: (err as Error).message };
  const reference = randomBytes(4).toString("hex");
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[fv-ops] technical error ref=${reference} ${detail}`, err instanceof Error ? err.stack : "");
  return { message: `Something went wrong on our side (reference ${reference}). Nothing was changed. Try again, and mention the reference if it persists.`, reference };
}

/**
 * Run a mutation from a server action: resolve the current actor, run it,
 * then redirect back with a flash message. Errors (including authorization
 * refusals) are shown to the person rather than swallowed. Every service
 * call re-checks authorization itself; this is only the UI plumbing.
 */
export async function runAction(
  returnTo: string,
  handler: (ctx: { db: Db; actor: Actor }) => Promise<string | { ok?: string; redirectTo?: string }>,
): Promise<never> {
  const actor = await requireActor();
  let target = returnTo;
  let flash: { ok?: string; error?: string } = {};
  try {
    const result = await handler({ db: await getDb(), actor });
    if (typeof result === "string") flash = { ok: result };
    else {
      flash = { ok: result.ok };
      if (result.redirectTo) target = result.redirectTo;
    }
  } catch (err) {
    flash = { error: safeErrorMessage(err).message };
  }
  revalidatePath("/", "layout");
  const url = new URL(target, "http://local");
  if (flash.error) url.searchParams.set("error", flash.error);
  if (flash.ok) url.searchParams.set("ok", flash.ok);
  redirect(url.pathname + url.search);
}

/**
 * Form-state variant for client forms (useActionState): returns field-level
 * errors and the submitted values so nothing the person typed is lost; on
 * success it redirects.
 */
export interface FormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  ok?: string;
  /** The origin cannot cover the order as typed (R2-5): the form shows the lines and asks for a decision. */
  shortfall?: { originName: string; lines: Array<{ skuId: string; skuName: string; requested: number; available: number; short: number }> };
}

export async function runFormAction(
  form: FormData,
  handler: (ctx: { db: Db; actor: Actor; values: Record<string, string> }) => Promise<{ redirectTo: string; ok?: string } | { state: FormState }>,
): Promise<FormState> {
  const actor = await requireActor();
  let redirectTo: string | null = null;
  let ok: string | undefined;
  const values: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") values[k] = v;
  try {
    const r = await handler({ db: await getDb(), actor, values });
    if ("state" in r) return { ...r.state, values: r.state.values ?? values };
    redirectTo = r.redirectTo;
    ok = r.ok;
  } catch (err) {
    const safe = safeErrorMessage(err);
    const field = err instanceof BusinessError ? err.field : undefined;
    return { error: safe.message, fieldErrors: field ? { [field]: safe.message } : undefined, values };
  }
  revalidatePath("/", "layout");
  const url = new URL(redirectTo, "http://local");
  if (ok) url.searchParams.set("ok", ok);
  redirect(url.pathname + url.search);
}

export function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}
export function num(form: FormData, key: string): number {
  const v = Number(str(form, key));
  return Number.isFinite(v) ? v : NaN;
}
export function opt(form: FormData, key: string): string | null {
  const v = str(form, key);
  return v ? v : null;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function flashFrom(searchParams: SearchParams) {
  const sp = await searchParams;
  return { error: typeof sp.error === "string" ? sp.error : undefined, ok: typeof sp.ok === "string" ? sp.ok : undefined };
}

export function param(sp: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = sp[key];
  return typeof v === "string" && v.length ? v : undefined;
}
