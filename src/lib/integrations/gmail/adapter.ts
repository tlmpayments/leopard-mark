import { SignJWT, importPKCS8 } from "jose";
import type { DbOrTx } from "@/lib/db/types";
import { credentialFingerprint, recordConnectionCheck } from "../registry";

/**
 * Gmail through a Google Workspace service account with domain-wide delegation (Round 4). Two uses, both narrow:
 *   - read the orders@ mailbox into Email intake (scope gmail.readonly), nothing is ever written to that mailbox;
 *   - send an APPROVED email as orders@ or operations@ (scope gmail.send), only while the company switch
 *     `sendEmailAutomatically` is on. The portal never sends anything a person has not approved.
 *
 * Credentials: GOOGLE_SERVICE_ACCOUNT_KEY holds the service account's JSON key (client_email + private_key), pasted into
 * Vercel by the Owner. The Workspace admin authorises the service account's client id for the two scopes. The
 * mailbox addresses live in company settings; the key is never printed or logged.
 */

export const GMAIL_SCOPE_READ = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SCOPE_SEND = "https://www.googleapis.com/auth/gmail.send";

interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) return { clientEmail: parsed.client_email, privateKey: parsed.private_key.replace(/\\n/g, "\n") };
    } catch {
      return null;
    }
  }
  const email = process.env.GOOGLE_SA_CLIENT_EMAIL;
  const key = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (email && key) return { clientEmail: email, privateKey: key.replace(/\\n/g, "\n") };
  return null;
}

export function gmailConfigured(): boolean {
  return serviceAccount() !== null || Boolean(testTransport);
}

export function gmailFingerprint(): string | null {
  const sa = serviceAccount();
  return sa ? credentialFingerprint(sa.privateKey) : testTransport ? "test-transport" : null;
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

/** An access token for the delegated mailbox user and scope, cached until shortly before it expires. */
async function accessToken(subject: string, scope: string): Promise<string> {
  const sa = serviceAccount();
  if (!sa) throw new GmailNotConnectedError();
  const key = `${subject}|${scope}`;
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const pk = await importPKCS8(sa.privateKey, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ scope })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.clientEmail)
    .setSubject(subject)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(pk);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  tokens.set(key, { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

export class GmailNotConnectedError extends Error {
  constructor(message = "Gmail is not connected: GOOGLE_SERVICE_ACCOUNT_KEY is not configured.") {
    super(message);
    this.name = "GmailNotConnectedError";
  }
}

async function gmailFetch<T>(mailbox: string, scope: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(mailbox, scope);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(mailbox)}/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Gmail ${init.method ?? "GET"} ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Reading (intake)
// ---------------------------------------------------------------------------

export interface GmailHeader {
  name: string;
  value: string;
}
export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  historyId?: string;
  internalDate?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailPart;
}

export interface ParsedMessage {
  id: string;
  threadId: string;
  receivedAt: Date;
  from: string | null;
  fromName: string | null;
  to: string | null;
  subject: string | null;
  text: string;
  attachments: Array<{ attachmentId: string; filename: string; mime: string | null; size: number }>;
}

export async function listMessages(mailbox: string, opts: { q?: string; maxResults?: number; pageToken?: string | null } = {}) {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  params.set("maxResults", String(opts.maxResults ?? 25));
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  return gmailFetch<{ messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string; resultSizeEstimate?: number }>(mailbox, GMAIL_SCOPE_READ, `messages?${params}`);
}

export async function getMessage(mailbox: string, id: string): Promise<GmailMessage> {
  return gmailFetch<GmailMessage>(mailbox, GMAIL_SCOPE_READ, `messages/${id}?format=full`);
}

export async function getAttachment(mailbox: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const r = await gmailFetch<{ data?: string; size?: number }>(mailbox, GMAIL_SCOPE_READ, `messages/${messageId}/attachments/${attachmentId}`);
  return Buffer.from((r.data ?? "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export async function getProfile(mailbox: string) {
  return gmailFetch<{ emailAddress: string; messagesTotal: number; historyId: string }>(mailbox, GMAIL_SCOPE_READ, "profile");
}

function decodeBody(data?: string): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function header(headers: GmailHeader[] | undefined, name: string): string | null {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

/** Strip tags from an HTML body well enough to read an order. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The sender's bare address and display name from a From header. */
export function parseAddress(value: string | null): { email: string | null; name: string | null } {
  if (!value) return { email: null, name: null };
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (m) return { email: m[2].trim().toLowerCase(), name: m[1].trim() || null };
  const bare = value.trim();
  return { email: /@/.test(bare) ? bare.toLowerCase() : null, name: /@/.test(bare) ? null : bare };
}

/** Flatten a Gmail message into what the intake needs: addresses, subject, readable text and attachment references. */
export function parseMessage(m: GmailMessage): ParsedMessage {
  const headers = m.payload?.headers ?? [];
  let text = "";
  let html = "";
  const attachments: ParsedMessage["attachments"] = [];
  const walk = (p: GmailPart | undefined) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) {
      attachments.push({ attachmentId: p.body.attachmentId, filename: p.filename, mime: p.mimeType ?? null, size: p.body.size ?? 0 });
    } else if (p.mimeType === "text/plain" && p.body?.data) {
      text += decodeBody(p.body.data) + "\n";
    } else if (p.mimeType === "text/html" && p.body?.data) {
      html += decodeBody(p.body.data);
    }
    for (const c of p.parts ?? []) walk(c);
  };
  walk(m.payload);
  const from = parseAddress(header(headers, "from"));
  return {
    id: m.id,
    threadId: m.threadId,
    receivedAt: m.internalDate ? new Date(Number(m.internalDate)) : new Date(),
    from: from.email,
    fromName: from.name,
    to: header(headers, "to"),
    subject: header(headers, "subject"),
    text: (text.trim() || htmlToText(html) || m.snippet || "").trim(),
    attachments,
  };
}

// ---------------------------------------------------------------------------
// Sending (approved email only)
// ---------------------------------------------------------------------------

export interface OutgoingEmail {
  from: string;
  to: string[];
  cc?: string[];
  replyTo?: string | null;
  subject: string;
  text: string;
  attachments?: Array<{ filename: string; mime: string; data: Buffer }>;
}

/** RFC 2822 message with a multipart/mixed body when there are attachments. */
export function buildMime(e: OutgoingEmail): string {
  const boundary = `fv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const headers = [`From: ${e.from}`, `To: ${e.to.join(", ")}`, ...(e.cc?.length ? [`Cc: ${e.cc.join(", ")}`] : []), ...(e.replyTo ? [`Reply-To: ${e.replyTo}`] : []), `Subject: ${encodeHeader(e.subject)}`, "MIME-Version: 1.0"];
  if (!e.attachments?.length) {
    return [...headers, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", e.text].join("\r\n");
  }
  const parts = [`--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", e.text];
  for (const a of e.attachments) {
    parts.push(`--${boundary}`, `Content-Type: ${a.mime}; name="${a.filename}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${a.filename}"`, "", a.data.toString("base64").replace(/(.{76})/g, "$1\r\n"));
  }
  parts.push(`--${boundary}--`);
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

function encodeHeader(v: string): string {
  return /^[\x20-\x7E]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

export interface SendResult {
  id: string;
  threadId: string | null;
}

/** Tests install a transport that captures sends instead of calling Google. Never on a deployment. */
let testTransport: ((e: OutgoingEmail) => Promise<SendResult>) | null = null;
export function setGmailTestTransport(fn: ((e: OutgoingEmail) => Promise<SendResult>) | null) {
  testTransport = fn;
}

export async function sendEmail(e: OutgoingEmail): Promise<SendResult> {
  if (testTransport) return testTransport(e);
  const raw = Buffer.from(buildMime(e), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const r = await gmailFetch<{ id: string; threadId?: string }>(e.from, GMAIL_SCOPE_SEND, "messages/send", { method: "POST", body: JSON.stringify({ raw }) });
  return { id: r.id, threadId: r.threadId ?? null };
}

/** Connectivity check for the Integrations screen: the delegated mailbox's profile, nothing else. */
export async function checkGmailConnection(db: DbOrTx, mailbox: string): Promise<{ ok: boolean; detail: Record<string, unknown> }> {
  if (!gmailConfigured()) {
    await recordConnectionCheck(db, "gmail", { ok: false, environment: null, detail: { reason: "GOOGLE_SERVICE_ACCOUNT_KEY missing" } });
    return { ok: false, detail: { reason: "GOOGLE_SERVICE_ACCOUNT_KEY missing" } };
  }
  try {
    const p = testTransport ? { emailAddress: mailbox, messagesTotal: 0, historyId: "0" } : await getProfile(mailbox);
    const detail = { mailbox: p.emailAddress, messagesTotal: p.messagesTotal };
    await recordConnectionCheck(db, "gmail", { ok: true, environment: "live", accountId: p.emailAddress, credentialFingerprint: gmailFingerprint(), detail });
    return { ok: true, detail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordConnectionCheck(db, "gmail", { ok: false, environment: "live", detail: { error: message } });
    return { ok: false, detail: { error: message } };
  }
}
