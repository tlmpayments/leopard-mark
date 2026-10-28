import "server-only";
import { Google, decodeIdToken, generateCodeVerifier, generateState } from "arctic";
import { cookies } from "next/headers";
import { baseUrl, envPresent, requireEnv } from "@/lib/env";

/**
 * Google authentication (identity assertion only — brief §5). Uses the
 * standard OAuth 2.0 / OpenID Connect authorization-code flow with PKCE.
 * No second identity provider; no internal password/OTP system (brief §54).
 */
export function googleConfigured(): boolean {
  return envPresent("GOOGLE_CLIENT_ID") && envPresent("GOOGLE_CLIENT_SECRET");
}

export function googleRedirectUri(): string {
  return `${baseUrl()}/api/auth/google/callback`;
}

function client(): Google {
  return new Google(requireEnv("GOOGLE_CLIENT_ID"), requireEnv("GOOGLE_CLIENT_SECRET"), googleRedirectUri());
}

const STATE_COOKIE = "fv_oauth_state";
const VERIFIER_COOKIE = "fv_oauth_verifier";

export async function beginGoogleSignIn(): Promise<URL> {
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = client().createAuthorizationURL(state, verifier, ["openid", "email", "profile"]);
  const hd = process.env.GOOGLE_ALLOWED_HD;
  if (hd) url.searchParams.set("hd", hd);
  url.searchParams.set("prompt", "select_account");
  const store = await cookies();
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 };
  store.set(STATE_COOKIE, state, opts);
  store.set(VERIFIER_COOKIE, verifier, opts);
  return url;
}

export interface GoogleAssertion {
  subject: string;
  email: string;
  emailVerified: boolean;
  hostedDomain: string | null;
  name: string | null;
}

export async function completeGoogleSignIn(code: string, state: string): Promise<GoogleAssertion> {
  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;
  const verifier = store.get(VERIFIER_COOKIE)?.value;
  store.delete(STATE_COOKIE);
  store.delete(VERIFIER_COOKIE);
  if (!expectedState || !verifier || expectedState !== state) {
    throw new Error("Sign-in state mismatch; please try again.");
  }
  const tokens = await client().validateAuthorizationCode(code, verifier);
  const claims = decodeIdToken(tokens.idToken()) as Record<string, unknown>;
  const subject = String(claims.sub ?? "");
  const email = String(claims.email ?? "").toLowerCase();
  if (!subject || !email) throw new Error("Google did not return a usable identity.");
  const hd = typeof claims.hd === "string" ? claims.hd : null;
  const allowedHd = process.env.GOOGLE_ALLOWED_HD;
  if (allowedHd && hd !== allowedHd) {
    throw new Error("This Google account is not in the company Workspace domain.");
  }
  return {
    subject,
    email,
    emailVerified: claims.email_verified === true,
    hostedDomain: hd,
    name: typeof claims.name === "string" ? claims.name : null,
  };
}
