import { NextResponse, type NextRequest } from "next/server";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { signInWithPin } from "@/lib/domain/employees/credentials";

/**
 * Email + PIN sign-in. The credential service decides (lockout, disablement,
 * audit); this handler only issues the session and redirects. Refusals never
 * say which part was wrong beyond what the person needs to act on.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const pin = String(form.get("pin") ?? "");
  const back = (reason: string) => {
    const url = new URL("/sign-in", req.url);
    url.searchParams.set("reason", reason);
    if (email) url.searchParams.set("email", email);
    return NextResponse.redirect(url, { status: 303 });
  };
  if (!email || !pin) return back("Enter your company email and PIN.");
  const resolution = await signInWithPin(await getDb(), { email, pin });
  if (resolution.outcome === "refused") {
    if (resolution.reason === "locked") return back(`Too many attempts. Try again in ${Math.max(1, Math.ceil((resolution.retryAfterMs ?? 0) / 60_000))} min.`);
    if (resolution.reason === "disabled") return back("Your access is disabled. Contact an Owner or Admin.");
    return back("Email or PIN not recognised.");
  }
  await createSession({ employeeId: resolution.employeeId, identityId: resolution.identityId, kind: "employee", credentialId: resolution.credentialId, mustChangePin: resolution.mustChange });
  return NextResponse.redirect(new URL(resolution.mustChange ? "/account/pin?first=1" : "/", req.url), { status: 303 });
}
