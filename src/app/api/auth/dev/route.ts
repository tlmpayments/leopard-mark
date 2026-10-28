import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { createSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { devAuthBypassEnabled } from "@/lib/env";

/**
 * DEV FIXTURE SIGN-IN — a visible test aid for environments without Google
 * credentials. Refused outright in production (see env.ts). It signs in as a
 * seeded employee; every business rule (enabled state, grants) still applies.
 */
export async function POST(req: NextRequest) {
  if (!devAuthBypassEnabled()) return new NextResponse("Not available", { status: 404 });
  const form = await req.formData();
  const employeeId = String(form.get("employeeId") ?? "");
  const db = await getDb();
  const [emp] = await db.select().from(schema.employee).where(eq(schema.employee.id, employeeId)).limit(1);
  const [identity] = await db
    .select()
    .from(schema.employeeIdentity)
    .where(and(eq(schema.employeeIdentity.employeeId, employeeId), eq(schema.employeeIdentity.current, true)))
    .limit(1);
  // Fixture sign-in replaces only the Google assertion: a disabled or retired employee is refused exactly as in production.
  if (!emp || !emp.enabled || !identity) return NextResponse.redirect(new URL("/sign-in?reason=unknown_employee", req.url), { status: 303 });
  await createSession({ employeeId, identityId: identity.id, kind: "dev_fixture" });
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
