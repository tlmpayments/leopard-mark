import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { envPresent, isDeployment } from "@/lib/env";
import { BusinessError } from "@/lib/errors";
import { ProviderUnavailableError } from "@/lib/jobs/queue";

/**
 * Company mailboxes connected one at a time (owner, Nov 4 2026). The Owner signs in to a mailbox once through the
 * portal's Google client (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, the same Internal client as staff sign-in);
 * Google returns a refresh token for that mailbox and the scopes granted, nothing else. No key can read any other
 * mailbox on the domain. The token is stored encrypted and is never shown, logged or exported.
 */

export const GMAIL_SCOPE_READ = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SCOPE_SEND = "https://www.googleapis.com/auth/gmail.send";

export const SCOPE_LABEL: Record<string, string> = {
  [GMAIL_SCOPE_READ]: "read",
  [GMAIL_SCOPE_SEND]: "send",
};

export type MailboxConnection = typeof schema.mailboxConnection.$inferSelect;

export class MailboxNotConnectedError extends ProviderUnavailableError {
  constructor(mailbox: string, detail?: string) {
    super(detail ?? `${mailbox} is not connected. The Owner connects it on the Integrations screen (Connect mailbox); until then this waits.`);
    this.name = "MailboxNotConnectedError";
  }
}

/** The Google client the portal signs in through; mailboxes are connected with it. */
export function googleClientConfigured(): boolean {
  return envPresent("GOOGLE_CLIENT_ID") && envPresent("GOOGLE_CLIENT_SECRET");
}

// ---------------------------------------------------------------------------
// The refresh token at rest: AES-256-GCM with a key derived from SESSION_SECRET
// ---------------------------------------------------------------------------

function sealingKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !secret.trim()) {
    if (isDeployment()) throw new Error("SESSION_SECRET is required to keep a mailbox connection");
    return createHash("sha256").update("fv-local-only-mailbox-key").digest();
  }
  return Buffer.from(hkdfSync("sha256", secret, "fv-mailbox-connection", "gmail refresh token", 32));
}

export function sealToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function openToken(sealed: string): string {
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unreadable mailbox token");
  const decipher = createDecipheriv("aes-256-gcm", sealingKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// Which scopes each mailbox needs
// ---------------------------------------------------------------------------

type MailboxSettings = Pick<typeof schema.companySettings.$inferSelect, "intakeMailboxAddress" | "customerSenderAddress" | "operationsSenderAddress">;

/** orders@ is read for intake and sends customer email; operations@ only sends BOLs. */
export function scopesFor(settings: MailboxSettings, mailbox: string): string[] {
  const m = mailbox.trim().toLowerCase();
  const scopes = new Set<string>();
  if (m === settings.intakeMailboxAddress.toLowerCase()) scopes.add(GMAIL_SCOPE_READ);
  if (m === settings.customerSenderAddress.toLowerCase() || m === settings.operationsSenderAddress.toLowerCase()) scopes.add(GMAIL_SCOPE_SEND);
  return [...scopes];
}

/** The mailboxes the company settings name, with what each needs. */
export function companyMailboxes(settings: MailboxSettings): Array<{ mailbox: string; scopes: string[]; purpose: string }> {
  const out = new Map<string, { mailbox: string; scopes: string[]; purpose: string[] }>();
  const add = (mailbox: string, purpose: string) => {
    const m = mailbox.trim().toLowerCase();
    if (!m) return;
    const e = out.get(m) ?? { mailbox: m, scopes: scopesFor(settings, m), purpose: [] };
    e.purpose.push(purpose);
    out.set(m, e);
  };
  add(settings.intakeMailboxAddress, "order emails read into intake");
  add(settings.customerSenderAddress, "approved customer email");
  add(settings.operationsSenderAddress, "approved BOLs to warehouses");
  return [...out.values()].map((e) => ({ mailbox: e.mailbox, scopes: e.scopes, purpose: e.purpose.join("; ") }));
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export async function getMailboxConnection(db: DbOrTx, mailbox: string): Promise<MailboxConnection | null> {
  const [row] = await db
    .select()
    .from(schema.mailboxConnection)
    .where(and(eq(schema.mailboxConnection.mailbox, mailbox.trim().toLowerCase()), isNull(schema.mailboxConnection.disconnectedAt), isNotNull(schema.mailboxConnection.refreshTokenEnc)));
  return row ?? null;
}

export async function listMailboxConnections(db: DbOrTx): Promise<MailboxConnection[]> {
  return db.select().from(schema.mailboxConnection);
}

/** Owner only: keep the refresh token Google returned for the mailbox the Owner just signed in to. */
export async function saveMailboxConnection(db: DbOrTx, actor: Actor, input: { mailbox: string; refreshToken: string; scopes: string[] }) {
  authorize(actor, "settings.manage");
  const mailbox = input.mailbox.trim().toLowerCase();
  if (!input.refreshToken) throw new BusinessError("Google did not return a lasting sign-in; connect the mailbox again");
  const now = new Date();
  const values = { mailbox, scopes: input.scopes, refreshTokenEnc: sealToken(input.refreshToken), connectedByEmployeeId: actor.employeeId ?? null, connectedAt: now, lastError: null, disconnectedAt: null, updatedAt: now };
  await db.insert(schema.mailboxConnection).values(values).onConflictDoUpdate({ target: schema.mailboxConnection.mailbox, set: values });
  accessTokens.delete(mailbox);
  await recordAudit(db, actor, { action: "gmail.mailbox_connected", subjectType: "mailbox", subjectId: mailbox, current: { scopes: input.scopes.map((s) => SCOPE_LABEL[s] ?? s) } });
}

/** Owner only: revoke the mailbox's sign-in with Google and forget it here. */
export async function disconnectMailbox(db: DbOrTx, actor: Actor, mailbox: string, reason: string) {
  authorize(actor, "settings.manage");
  const m = mailbox.trim().toLowerCase();
  const conn = await getMailboxConnection(db, m);
  if (!conn) throw new BusinessError(`${m} is not connected`);
  let revoked = false;
  try {
    const res = await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: openToken(conn.refreshTokenEnc!) }) });
    revoked = res.ok;
  } catch {
    revoked = false;
  }
  const now = new Date();
  await db.update(schema.mailboxConnection).set({ refreshTokenEnc: null, disconnectedAt: now, updatedAt: now }).where(eq(schema.mailboxConnection.mailbox, m));
  accessTokens.delete(m);
  await recordAudit(db, actor, { action: "gmail.mailbox_disconnected", subjectType: "mailbox", subjectId: m, current: { revokedWithGoogle: revoked }, reason: reason.trim() || null });
  return { revoked };
}

const accessTokens = new Map<string, { token: string; expiresAt: number }>();

/** A short-lived access token for a connected mailbox, refreshed from its saved sign-in when needed. */
export async function mailboxAccessToken(db: DbOrTx, mailbox: string, scope: string): Promise<string> {
  const m = mailbox.trim().toLowerCase();
  const conn = await getMailboxConnection(db, m);
  if (!conn) throw new MailboxNotConnectedError(m);
  if (!conn.scopes.includes(scope)) {
    throw new MailboxNotConnectedError(m, `${m} was connected without permission to ${SCOPE_LABEL[scope] ?? scope}. The Owner connects it again on the Integrations screen.`);
  }
  const cached = accessTokens.get(m);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  if (!googleClientConfigured()) throw new MailboxNotConnectedError(m, "The Google client (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET) is not configured; mail waits.");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: openToken(conn.refreshTokenEnc!) }),
  });
  const now = new Date();
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    const refused = /invalid_grant/.test(body);
    const message = refused ? `Google no longer accepts the saved sign-in for ${m} (revoked, password changed or expired). The Owner connects it again on the Integrations screen.` : `Google token refresh failed (${res.status}): ${body}`;
    await db.update(schema.mailboxConnection).set({ lastError: message, updatedAt: now }).where(eq(schema.mailboxConnection.mailbox, m));
    throw refused ? new MailboxNotConnectedError(m, message) : new Error(message);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  accessTokens.set(m, { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 });
  await db.update(schema.mailboxConnection).set({ lastUsedAt: now, lastError: null, updatedAt: now }).where(eq(schema.mailboxConnection.mailbox, m));
  return body.access_token;
}
