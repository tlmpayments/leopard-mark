/**
 * Mailboxes connected one at a time (owner, Nov 4 2026): the Owner signs in to orders@ and operations@ once; the
 * portal keeps an encrypted refresh token per mailbox and can reach no other mailbox. Covers the token at rest, which
 * scopes each mailbox needs, Owner-only connect and disconnect, refreshing, and mail waiting when a mailbox is not
 * connected.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { sendEmail } from "@/lib/integrations/gmail/adapter";
import {
  GMAIL_SCOPE_READ,
  GMAIL_SCOPE_SEND,
  MailboxNotConnectedError,
  companyMailboxes,
  disconnectMailbox,
  getMailboxConnection,
  mailboxAccessToken,
  openToken,
  saveMailboxConnection,
  sealToken,
} from "@/lib/integrations/gmail/connection";
import { ProviderUnavailableError } from "@/lib/jobs/queue";
import { createTestDb } from "../support/db";
import { buildFixture, type Fixture } from "../support/fixtures";

let db: Db;
let close: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "GOCSPX-test";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  await close();
});

describe("mailbox connections", () => {
  it("keeps the refresh token encrypted, never as written", () => {
    const sealed = sealToken("1//refresh-token-value");
    expect(sealed).not.toContain("refresh-token-value");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(openToken(sealed)).toBe("1//refresh-token-value");
    expect(sealToken("same")).not.toBe(sealToken("same")); // a fresh nonce each time
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect(() => openToken(tampered)).toThrow();
  });

  it("gives orders@ read and send, and operations@ send only", async () => {
    const boxes = companyMailboxes(await getCompanySettings(db));
    const orders = boxes.find((b) => b.mailbox === "orders@theleopardmark.com")!;
    const ops = boxes.find((b) => b.mailbox === "operations@theleopardmark.com")!;
    expect(orders.scopes.sort()).toEqual([GMAIL_SCOPE_READ, GMAIL_SCOPE_SEND].sort());
    expect(ops.scopes).toEqual([GMAIL_SCOPE_SEND]);
  });

  it("only the Owner connects or disconnects a mailbox", async () => {
    await expect(saveMailboxConnection(db, f.admin, { mailbox: "orders@theleopardmark.com", refreshToken: "x", scopes: [GMAIL_SCOPE_READ] })).rejects.toThrow();
    await saveMailboxConnection(db, f.owner, { mailbox: "Orders@TheLeopardMark.com", refreshToken: "1//orders", scopes: [GMAIL_SCOPE_READ, GMAIL_SCOPE_SEND] });
    const conn = await getMailboxConnection(db, "orders@theleopardmark.com");
    expect(conn?.scopes).toContain(GMAIL_SCOPE_SEND);
    expect(conn?.refreshTokenEnc).not.toContain("1//orders");
    await expect(disconnectMailbox(db, f.admin, "orders@theleopardmark.com", "test")).rejects.toThrow();
  });

  it("refreshes an access token from the saved sign-in, and asks for a reconnect when Google refuses it", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: String(init.body) });
      return new Response(JSON.stringify({ access_token: "ya29.token", expires_in: 3600 }), { status: 200 });
    });
    expect(await mailboxAccessToken(db, "orders@theleopardmark.com", GMAIL_SCOPE_READ)).toBe("ya29.token");
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].body).toContain("grant_type=refresh_token");
    expect(calls[0].body).toContain("refresh_token=1%2F%2Forders");
    // Cached: no second call within the hour.
    await mailboxAccessToken(db, "orders@theleopardmark.com", GMAIL_SCOPE_SEND);
    expect(calls.length).toBe(1);

    // A mailbox connected without send cannot send, even with a valid sign-in.
    await saveMailboxConnection(db, f.owner, { mailbox: "operations@theleopardmark.com", refreshToken: "1//ops", scopes: [GMAIL_SCOPE_READ] });
    await expect(mailboxAccessToken(db, "operations@theleopardmark.com", GMAIL_SCOPE_SEND)).rejects.toThrow(/without permission to send/);

    // Google refuses the saved sign-in: the connection says so and the work waits instead of failing.
    await saveMailboxConnection(db, f.owner, { mailbox: "operations@theleopardmark.com", refreshToken: "1//ops", scopes: [GMAIL_SCOPE_SEND] });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const err = await mailboxAccessToken(db, "operations@theleopardmark.com", GMAIL_SCOPE_SEND).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect(String(err.message)).toMatch(/connects it again/);
    const [row] = await db.select().from(schema.mailboxConnection).where((await import("drizzle-orm")).eq(schema.mailboxConnection.mailbox, "operations@theleopardmark.com"));
    expect(row.lastError).toMatch(/no longer accepts/);
  });

  it("an email from a mailbox nobody connected waits; disconnecting revokes with Google and stops use", async () => {
    const err = await sendEmail(db, { from: "billing@theleopardmark.com", to: ["a@example.test"], subject: "x", text: "y" }).catch((e) => e);
    expect(err).toBeInstanceOf(MailboxNotConnectedError);
    expect(err).toBeInstanceOf(ProviderUnavailableError);

    const revokes: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      revokes.push(String(url));
      return new Response("", { status: 200 });
    });
    const r = await disconnectMailbox(db, f.owner, "orders@theleopardmark.com", "rotating access");
    expect(r.revoked).toBe(true);
    expect(revokes[0]).toBe("https://oauth2.googleapis.com/revoke");
    expect(await getMailboxConnection(db, "orders@theleopardmark.com")).toBeNull();
    await expect(mailboxAccessToken(db, "orders@theleopardmark.com", GMAIL_SCOPE_READ)).rejects.toBeInstanceOf(MailboxNotConnectedError);
  });
});
