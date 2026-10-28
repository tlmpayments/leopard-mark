import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Actor } from "@/lib/authz/actor";
import { can } from "@/lib/authz/authorize";
import type { Action } from "@/lib/authz/actions";
import { getDb } from "@/lib/db/client";
import { loadActorForSession } from "@/lib/domain/employees/service";
import { demoModeEnabled } from "@/lib/env";
import { readSession } from "./session";

/**
 * Current actor for this request. Re-reads enabled state and grants on every
 * request so that an internal disable takes effect on the very next action of
 * an already-signed-in employee (brief §5, AT62). Cached per request only.
 *
 * DEVELOPMENT DEMO MODE: with no session cookie the local user is the demo
 * Owner. This replaces only the identity assertion (Google) — the internal
 * employee record, its enabled state and its grants are still what authorize
 * every action, exactly as in production.
 */
export const currentActor = cache(async (): Promise<Actor | null> => {
  const session = await readSession();
  // The session names an employee AND the identity row it signed in with; both must still be
  // current (enabled employee, identity not retired/reassigned) on every request (AT61/AT62, REV-17).
  if (session) return loadActorForSession(await getDb(), session.employeeId, session.identityId, session.kind);
  if (demoModeEnabled()) {
    const { demoOwnerEmployeeId } = await import("@/lib/demo/owner");
    const ownerId = await demoOwnerEmployeeId(await getDb());
    if (ownerId) {
      const { loadActor } = await import("@/lib/domain/employees/service");
      return loadActor(await getDb(), ownerId, "dev_fixture");
    }
  }
  return null;
});

export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect("/sign-in?reason=session");
  return actor;
}

export async function requireAction(action: Action, marketId?: string | null): Promise<Actor> {
  const actor = await requireActor();
  if (!can(actor, action, { marketId })) redirect(`/forbidden?action=${encodeURIComponent(action)}`);
  return actor;
}
