import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit/record";
import { completeGoogleSignIn } from "@/lib/auth/google";
import { createSession } from "@/lib/auth/session";
import { SYSTEM_ACTOR } from "@/lib/authz/actor";
import { getDb } from "@/lib/db/client";
import { resolveGoogleSignIn } from "@/lib/domain/employees/service";
import { baseUrl } from "@/lib/env";

/**
 * Google OIDC callback. Google authenticates; only an enabled, provisioned
 * employee is signed in (brief §5). Refusals are audited and explained.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const back = (reason: string) => NextResponse.redirect(new URL(`/sign-in?reason=${encodeURIComponent(reason)}`, baseUrl()));
  if (!code || !state) return back("missing_code");
  try {
    const assertion = await completeGoogleSignIn(code, state);
    const resolution = await resolveGoogleSignIn((await getDb()), assertion);
    if (resolution.outcome === "refused") {
      await recordAudit((await getDb()), SYSTEM_ACTOR, { action: "auth.refused", subjectType: "google_identity", subjectId: assertion.subject, current: { email: assertion.email }, reason: resolution.reason });
      return back(resolution.reason);
    }
    await createSession({ employeeId: resolution.employeeId, identityId: resolution.identityId, kind: "employee" });
    await recordAudit((await getDb()), { kind: "employee", employeeId: resolution.employeeId, displayName: assertion.name ?? assertion.email, email: assertion.email, grants: [] }, { action: "auth.sign_in", subjectType: "employee", subjectId: resolution.employeeId, current: { email: assertion.email } });
    return NextResponse.redirect(new URL("/", baseUrl()));
  } catch (err) {
    return back(err instanceof Error ? err.message : "sign_in_failed");
  }
}
