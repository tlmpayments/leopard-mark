import "server-only";
import { Google, decodeIdToken, generateCodeVerifier, generateState } from "arctic";
import { cookies } from "next/headers";
import { baseUrl, requireEnv } from "@/lib/env";

/**
 * Connecting one company mailbox (owner, Nov 4 2026): the Owner clicks Connect mailbox, Google asks them to sign in to
 * that mailbox and to allow exactly the scopes it needs, and the callback keeps the lasting sign-in Google returns.
 * Same Internal Google client as staff sign-in, with its own return address, which must be listed under the client's
 * Authorized redirect URIs in Google Cloud.
 */

const STATE_COOKIE = "fv_mailbox_state";
const VERIFIER_COOKIE = "fv_mailbox_verifier";
const MAILBOX_COOKIE = "fv_mailbox_target";

export function mailboxRedirectUri(): string {
  return `${baseUrl()}/api/integrations/gmail/callback`;
}

function client(): Google {
  return new Google(requireEnv("GOOGLE_CLIENT_ID"), requireEnv("GOOGLE_CLIENT_SECRET"), mailboxRedirectUri());
}

export async function beginMailboxConnect(mailbox: string, scopes: string[]): Promise<URL> {
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = client().createAuthorizationURL(state, verifier, ["openid", "email", ...scopes]);
  // offline + consent: Google returns a refresh token every time, so a reconnect always replaces the old one.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("login_hint", mailbox);
  const hd = process.env.GOOGLE_ALLOWED_HD;
  if (hd) url.searchParams.set("hd", hd);
  const store = await cookies();
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 };
  store.set(STATE_COOKIE, state, opts);
  store.set(VERIFIER_COOKIE, verifier, opts);
  store.set(MAILBOX_COOKIE, mailbox, opts);
  return url;
}

export interface MailboxGrant {
  /** The mailbox Google signed in, from the ID token; must be the one the Owner asked to connect. */
  mailbox: string;
  requested: string;
  refreshToken: string;
  scopes: string[];
}

export async function completeMailboxConnect(code: string, state: string): Promise<MailboxGrant> {
  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;
  const verifier = store.get(VERIFIER_COOKIE)?.value;
  const requested = store.get(MAILBOX_COOKIE)?.value ?? "";
  store.delete(STATE_COOKIE);
  store.delete(VERIFIER_COOKIE);
  store.delete(MAILBOX_COOKIE);
  if (!expectedState || !verifier || expectedState !== state || !requested) throw new Error("The connection request expired or did not match; start again from Integrations.");
  const tokens = await client().validateAuthorizationCode(code, verifier);
  const claims = decodeIdToken(tokens.idToken()) as Record<string, unknown>;
  const mailbox = String(claims.email ?? "").toLowerCase();
  if (!mailbox) throw new Error("Google did not say which mailbox signed in.");
  if (!tokens.hasRefreshToken()) throw new Error("Google did not return a lasting sign-in; start again from Integrations.");
  return { mailbox, requested: requested.toLowerCase(), refreshToken: tokens.refreshToken(), scopes: tokens.scopes() };
}
