"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { safeErrorMessage, type FormState } from "@/lib/actions/helpers";
import { currentActor } from "@/lib/auth/current";
import { createSession, readSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { changeOwnPin } from "@/lib/domain/employees/credentials";
import { BusinessError } from "@/lib/errors";

/**
 * Change the signed-in person's PIN. PIN values are never echoed back into
 * form state, URLs or flashes; on success the session is re-issued against
 * the new credential (every other session for this person stops).
 */
export async function changePinAction(_prev: FormState, form: FormData): Promise<FormState> {
  const actor = await currentActor();
  const session = await readSession();
  if (!actor || !session) redirect("/sign-in?reason=session");
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  try {
    const row = await changeOwnPin(await getDb(), actor, { currentPin: str("currentPin"), newPin: str("newPin"), confirmPin: str("confirmPin") });
    await createSession({ employeeId: session.employeeId, identityId: session.identityId, kind: session.kind, credentialId: row.id });
  } catch (err) {
    const safe = safeErrorMessage(err);
    const field = err instanceof BusinessError ? err.field : undefined;
    return { error: safe.message, fieldErrors: field ? { [field]: safe.message } : undefined };
  }
  revalidatePath("/", "layout");
  redirect("/?ok=PIN+changed.+Other+sessions+for+your+account+were+signed+out.");
}
