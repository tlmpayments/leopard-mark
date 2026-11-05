/**
 * The orders@ mailbox into Email intake (Round 4). A read-only poll through the mailbox the Owner connected: new messages
 * become intake requests with the original text and attachments kept, and for a known sender a pre-filled draft. The
 * mailbox is never written to and nothing is sent back; any acknowledgement goes through the approval queue.
 */
import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { SYSTEM_ACTOR } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { openException } from "@/lib/exceptions/service";
import { getAttachment, getMessage, gmailConfigured, listMessages, parseMessage, type ParsedMessage } from "@/lib/integrations/gmail/adapter";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { draftFromMessage } from "./parse";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Text from an attachment the parser can read: PDF (purchase orders), xlsx (order forms), csv and plain text. */
export async function extractAttachmentText(filename: string, mime: string | null, data: Buffer): Promise<string | null> {
  const lower = filename.toLowerCase();
  try {
    if (lower.endsWith(".pdf") || mime === "application/pdf") {
      const { extractText } = await import("unpdf");
      const r = await extractText(new Uint8Array(data), { mergePages: true });
      const text = Array.isArray(r.text) ? r.text.join("\n") : String(r.text ?? "");
      return text.trim() || null;
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm") || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(data as unknown as ArrayBuffer);
      const lines: string[] = [];
      wb.eachSheet((ws) => {
        lines.push(`# ${ws.name}`);
        ws.eachRow((row) => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: false }, (c) => {
            const v = c.value;
            const t = v == null ? "" : typeof v === "object" && "result" in (v as object) ? String((v as { result: unknown }).result ?? "") : typeof v === "object" && "richText" in (v as object) ? (v as { richText: Array<{ text: string }> }).richText.map((r) => r.text).join("") : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
            if (t.trim()) cells.push(t.trim());
          });
          if (cells.length) lines.push(cells.join("  "));
        });
      });
      return lines.join("\n").trim() || null;
    }
    if (lower.endsWith(".csv") || lower.endsWith(".txt") || (mime ?? "").startsWith("text/")) return data.toString("utf8").slice(0, 200_000);
  } catch (err) {
    return `[could not read ${filename}: ${err instanceof Error ? err.message : String(err)}]`;
  }
  return null;
}

/** Record one message as an intake request with its attachments and draft. Idempotent on the Gmail message id. */
export async function recordIntakeFromMail(db: DbOrTx, mailbox: string, m: ParsedMessage, fetchAttachment: (attachmentId: string) => Promise<Buffer>) {
  const [dup] = await db.select({ id: schema.orderIntakeRequest.id }).from(schema.orderIntakeRequest).where(and(eq(schema.orderIntakeRequest.sourceReference, m.id), eq(schema.orderIntakeRequest.source, "email")));
  if (dup) return { recorded: false, id: dup.id };
  const attachments: Array<{ filename: string; mime: string | null; size: number; data: Buffer | null; text: string | null }> = [];
  for (const a of m.attachments) {
    if (a.size > MAX_ATTACHMENT_BYTES) {
      attachments.push({ filename: a.filename, mime: a.mime, size: a.size, data: null, text: `[${a.filename} is ${Math.round(a.size / 1_048_576)} MB; too large to keep]` });
      continue;
    }
    const data = await fetchAttachment(a.attachmentId);
    attachments.push({ filename: a.filename, mime: a.mime, size: data.length, data, text: await extractAttachmentText(a.filename, a.mime, data) });
  }
  const draft = await draftFromMessage(db, { fromEmail: m.from, subject: m.subject, text: m.text, attachmentTexts: attachments.map((a) => a.text ?? "").filter(Boolean), receivedAt: m.receivedAt });
  const [loc] = draft.locationId ? await db.select({ marketId: schema.customerLocation.marketId, tradeName: schema.customerLocation.tradeName }).from(schema.customerLocation).where(eq(schema.customerLocation.id, draft.locationId)) : [];
  const [row] = await db
    .insert(schema.orderIntakeRequest)
    .values({
      source: "email",
      sourceReference: m.id,
      mailbox,
      threadId: m.threadId,
      fromEmail: m.from,
      subject: m.subject,
      body: m.text || "(no text in the message)",
      receivedAt: m.receivedAt,
      marketId: loc?.marketId ?? null,
      locationId: draft.locationId,
      parsed: draft as unknown as Record<string, unknown>,
      parseNote: draft.notes.join(" ") || null,
      attachmentCount: attachments.length,
    })
    .returning();
  for (const a of attachments) {
    await db.insert(schema.intakeAttachment).values({ intakeId: row.id, filename: a.filename, mime: a.mime, sizeBytes: a.size, data: a.data, textExtract: a.text });
  }
  await recordAudit(db, SYSTEM_ACTOR, { action: "intake.record", subjectType: "order_intake_request", subjectId: row.id, current: { fromEmail: m.from, subject: m.subject, mailbox, attachments: attachments.length, draftConfidence: draft.confidence, locationId: draft.locationId }, marketId: loc?.marketId ?? null });
  await openException(db, SYSTEM_ACTOR, {
    category: "email_intake",
    title: `Email order to review${m.fromName ? ` from ${m.fromName}` : m.from ? ` — ${m.from}` : ""}${loc ? ` (${loc.tradeName})` : ""}`,
    cause: `${m.subject ?? "(no subject)"}${draft.lines.length ? `; draft: ${draft.lines.map((l) => `${l.qty} ${l.skuName}`).join(", ")}` : "; no lines recognised"}${draft.poNumber ? `; PO ${draft.poNumber}` : ""}.`,
    marketId: loc?.marketId ?? null,
    locationId: draft.locationId,
    ownerRole: "admin",
    nextAction: "Check the draft on Email intake and convert it to an order, or mark it incomplete or not an order.",
    dedupeKey: `email_intake:${row.id}`,
    links: [{ subjectType: "order_intake_request", subjectId: row.id }, ...(draft.locationId ? [{ subjectType: "customer_location", subjectId: draft.locationId }] : [])],
  });
  return { recorded: true, id: row.id };
}

/** The cron entry point: list new inbox messages since the last poll and record each one once. */
export async function pollIntakeMailbox(db: DbOrTx, now: Date = new Date()): Promise<{ skipped?: string; fetched: number; recorded: number }> {
  const settings = await getCompanySettings(db);
  if (!settings.intakeMailboxEnabled) return { skipped: "switch_off", fetched: 0, recorded: 0 };
  if (!gmailConfigured()) return { skipped: "gmail_not_configured", fetched: 0, recorded: 0 };
  const mailbox = settings.intakeMailboxAddress;
  const [sync] = await db.select().from(schema.mailboxSync).where(eq(schema.mailboxSync.mailbox, mailbox));
  const sinceEpoch = sync?.lastMessageAt ? Math.floor(sync.lastMessageAt.getTime() / 1000) - 86_400 : Math.floor(now.getTime() / 1000) - 14 * 86_400;
  let fetched = 0;
  let recorded = 0;
  let newest = sync?.lastMessageAt ?? null;
  try {
    let pageToken: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const list = await listMessages(db, mailbox, { q: `in:inbox -from:${mailbox} after:${sinceEpoch}`, maxResults: 50, pageToken });
      for (const ref of list.messages ?? []) {
        fetched += 1;
        const [dup] = await db.select({ id: schema.orderIntakeRequest.id, receivedAt: schema.orderIntakeRequest.receivedAt }).from(schema.orderIntakeRequest).where(eq(schema.orderIntakeRequest.sourceReference, ref.id));
        if (dup) {
          if (!newest || dup.receivedAt > newest) newest = dup.receivedAt;
          continue;
        }
        const parsed = parseMessage(await getMessage(db, mailbox, ref.id));
        if (parsed.from && parsed.from.toLowerCase() === mailbox.toLowerCase()) continue;
        const r = await recordIntakeFromMail(db, mailbox, parsed, (attachmentId) => getAttachment(db, mailbox, ref.id, attachmentId));
        if (r.recorded) recorded += 1;
        if (!newest || parsed.receivedAt > newest) newest = parsed.receivedAt;
      }
      pageToken = list.nextPageToken ?? null;
      if (!pageToken) break;
    }
    await db
      .insert(schema.mailboxSync)
      .values({ mailbox, lastPolledAt: now, lastMessageAt: newest, lastError: null, messagesSeen: (sync?.messagesSeen ?? 0) + recorded, updatedAt: now })
      .onConflictDoUpdate({ target: schema.mailboxSync.mailbox, set: { lastPolledAt: now, lastMessageAt: newest, lastError: null, messagesSeen: (sync?.messagesSeen ?? 0) + recorded, updatedAt: now } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.insert(schema.mailboxSync).values({ mailbox, lastPolledAt: now, lastError: message, updatedAt: now }).onConflictDoUpdate({ target: schema.mailboxSync.mailbox, set: { lastPolledAt: now, lastError: message, updatedAt: now } });
    await openException(db, SYSTEM_ACTOR, {
      category: "provider_unavailable",
      title: "The orders@ mailbox could not be read",
      cause: message,
      ownerRole: "admin",
      nextAction: "Check the mailbox on the Integrations screen; if it is not connected, the Owner connects it (Connect mailbox).",
      dedupeKey: `mailbox_poll_failed:${mailbox}`,
    });
  }
  return { fetched, recorded };
}
