import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import { demoModeEnabled, devAuthBypassEnabled, isProduction } from "@/lib/env";

/**
 * Session cookie: a signed token naming the internal employee, the identity
 * row (email) that signed in and — for PIN sign-ins — the credential it was
 * proven with. It carries NO authority — every request re-reads the
 * employee's enabled state, identity and current grants from the database
 * (see current.ts), which is what makes effective disablement immediate for
 * existing sessions (brief §5, AT62) and ends every session when a PIN is
 * reset or changed.
 *
 * The cookie lifetime is an ordinary technical choice (not a business
 * session policy) and is configurable through SESSION_COOKIE_HOURS.
 */
export const SESSION_COOKIE = "fv_session";

export interface SessionClaims {
  employeeId: string;
  identityId: string;
  kind: "employee" | "dev_fixture";
  /** The employee_credential row proven at sign-in (PIN sign-ins); absent for Google and fixture sessions. */
  credentialId?: string;
  /** The person signed in with a temporary PIN and must choose their own before any business use. */
  mustChangePin?: boolean;
}

function secretKey(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    // Demo mode cannot exist in production (env.ts), so a fixed local secret is acceptable there.
    if (demoModeEnabled()) return new TextEncoder().encode("fv-development-demo-mode-session-secret");
    throw new Error("SESSION_SECRET must be set (>= 16 chars). See .env.example.");
  }
  return new TextEncoder().encode(s);
}

function cookieHours(): number {
  const n = Number(process.env.SESSION_COOKIE_HOURS ?? 12);
  return Number.isFinite(n) && n > 0 ? n : 12;
}

export async function createSession(claims: SessionClaims): Promise<void> {
  const hours = cookieHours();
  const token = await new SignJWT({ eid: claims.employeeId, iid: claims.identityId, k: claims.kind, ...(claims.credentialId ? { cid: claims.credentialId } : {}), ...(claims.mustChangePin ? { mc: true } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${hours}h`)
    .sign(secretKey());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction() || process.env.NODE_ENV === "production",
    path: "/",
    maxAge: hours * 3600,
  });
}

export const readSession = cache(async (): Promise<SessionClaims | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.eid !== "string" || typeof payload.iid !== "string") return null;
    const kind = payload.k === "dev_fixture" ? "dev_fixture" : "employee";
    // A fixture session issued earlier is worthless once the local fixture mode is off (REV-02/AC04):
    // it never authenticates on a deployment or after DEV_AUTH_BYPASS is removed.
    if (kind === "dev_fixture" && !devAuthBypassEnabled()) return null;
    return {
      employeeId: payload.eid,
      identityId: payload.iid,
      kind,
      ...(typeof payload.cid === "string" ? { credentialId: payload.cid } : {}),
      ...(payload.mc === true ? { mustChangePin: true } : {}),
    };
  } catch {
    return null;
  }
});

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
