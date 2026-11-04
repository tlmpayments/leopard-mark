/**
 * The effect of an approved email (Round 4): resolve its attachments, generate a bank setup link when the message
 * carries one, and send through Gmail as orders@ or operations@. Runs only while `sendEmailAutomatically` is on; with
 * the switch off the item stays approved with manual transport and a person sends it by hand (`recordManualSend`).
 */
import { eq } from "drizzle-orm";
import { SYSTEM_ACTOR, type Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { Db, DbOrTx } from "@/lib/db/types";
import { renderDocument } from "@/lib/documents/pdf";
import { toPullSheetSnapshot } from "@/lib/documents/pull-sheet";
import { gmailConfigured, sendEmail, type OutgoingEmail } from "@/lib/integrations/gmail/adapter";
import { createHostedSetupSession } from "@/lib/integrations/stripe/adapter";
import { ProviderUnavailableError } from "@/lib/jobs/queue";
import { latestInvoiceDocument, storeInvoiceDocument } from "@/lib/domain/invoices/service";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { pullSheet } from "@/lib/domain/shipments/service";
import { registerApprovalExecutor, type ApprovalItem, type EmailPayload } from "./service";

export function senderAddress(sender: string, settings: { customerSenderAddress: string; operationsSenderAddress: string }): string {
  return sender === "operations@" ? settings.operationsSenderAddress : settings.customerSenderAddress;
}

/** The files an email item carries, rendered or fetched at send time. */
export async function resolveAttachments(db: DbOrTx, actor: Actor, payload: EmailPayload): Promise<NonNullable<OutgoingEmail["attachments"]>> {
  const out: NonNullable<OutgoingEmail["attachments"]> = [];
  for (const a of payload.attachments ?? []) {
    if (a.kind === "invoice_pdf") {
      let doc = await latestInvoiceDocument(db, a.invoiceId);
      if (!doc?.pdf) {
        await storeInvoiceDocument(db, actor, a.invoiceId);
        doc = await latestInvoiceDocument(db, a.invoiceId);
      }
      if (doc?.pdf) out.push({ filename: `${doc.number ?? "invoice"}.pdf`, mime: "application/pdf", data: Buffer.from(doc.pdf) });
    } else if (a.kind === "pull_sheet") {
      const sheet = await pullSheet(db, actor, a.warehouseId, a.date);
      const pdf = await renderDocument(toPullSheetSnapshot(sheet, "Leopard Mark Ops"));
      out.push({ filename: `pull-sheet-${sheet.origin.originCode ?? "warehouse"}-${a.date}.pdf`, mime: "application/pdf", data: Buffer.from(pdf) });
    } else if (a.kind === "shipment_document") {
      const [doc] = await db.select().from(schema.shipmentDocument).where(eq(schema.shipmentDocument.id, a.documentId));
      if (doc?.pdf) out.push({ filename: `${doc.number ?? doc.kind}-${doc.kind}.pdf`, mime: "application/pdf", data: Buffer.from(doc.pdf) });
    }
  }
  return out;
}

/** The bank setup link for an item that carries one: generated now, bound to the payer, stored on the item for the record. */
export async function setupLinkFor(db: DbOrTx, item: ApprovalItem): Promise<string | null> {
  const payload = item.payload as unknown as EmailPayload;
  if (!payload.setupLink) return null;
  const existing = (item.result as { setupUrl?: string } | null)?.setupUrl;
  if (existing) return existing;
  const s = await createHostedSetupSession(db, SYSTEM_ACTOR, payload.setupLink.locationId, payload.setupLink.returnUrl, { authorized: true });
  await db.update(schema.approvalItem).set({ result: { ...(item.result ?? {}), setupUrl: s.url, setupSessionId: s.sessionId }, updatedAt: new Date() }).where(eq(schema.approvalItem.id, item.id));
  return s.url;
}

registerApprovalExecutor("email", async (db: Db, item: ApprovalItem) => {
  const settings = await getCompanySettings(db);
  if (!settings.sendEmailAutomatically) throw new ProviderUnavailableError("Automatic email sending is switched off; send it by hand and record the outcome, or turn the switch on in Company settings");
  if (!gmailConfigured()) throw new ProviderUnavailableError("Gmail is not connected (GOOGLE_SERVICE_ACCOUNT_KEY); the email waits");
  const payload = item.payload as unknown as EmailPayload;
  let text = payload.body;
  const result: Record<string, unknown> = {};
  if (payload.setupLink) {
    const url = await setupLinkFor(db, item);
    if (!url) throw new Error("The bank setup link could not be generated");
    text = text.replace("{setup_link}", url);
    result.setupUrl = url;
  }
  const attachments = await resolveAttachments(db, SYSTEM_ACTOR, payload);
  const from = senderAddress(item.sender, settings);
  const r = await sendEmail({ from, to: payload.to, cc: payload.cc, subject: payload.subject, text, attachments, replyTo: from });
  return { ...result, messageId: r.id, threadId: r.threadId, from, to: payload.to, attachments: attachments.map((a) => a.filename) };
});
