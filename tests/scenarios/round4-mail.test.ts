/**
 * Round 4 mail: the Gmail adapter's message parsing and MIME building, approved emails leaving through the transport
 * only while the company switch is on, the pull sheet as an approval item, and auto-approval by company policy.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { approveItem, approvalsForSubject, requestApproval } from "@/lib/domain/approvals/service";
import { requestInvoiceEmail } from "@/lib/domain/collection";
import { updateAccountShipping } from "@/lib/domain/customers/shipping";
import { getInvoice } from "@/lib/domain/invoices/service";
import { recordPackagingReport } from "@/lib/domain/lots/service";
import { updateOrigin } from "@/lib/domain/origins/service";
import { submitOrder } from "@/lib/domain/orders/service";
import { schedulePullSheetSends } from "@/lib/domain/pullsheet/service";
import { updateCompanySettings } from "@/lib/domain/settings/service";
import { confirmShipment, deliverShipment, getShipment } from "@/lib/domain/shipments/service";
import { buildMime, htmlToText, parseAddress, parseMessage, setGmailTestTransport, type OutgoingEmail } from "@/lib/integrations/gmail/adapter";
import { runDueJobs } from "@/lib/jobs/queue";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";
import "@/lib/domain/collection";

let db: Db;
let close: () => Promise<void>;
let f: Fixture;
let bar: typeof schema.customerLocation.$inferSelect;
const sent: OutgoingEmail[] = [];

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
  await updateOrigin(db, f.owner, f.warehouse.id, { originCode: "EBB", kind: "brewery", lotFacilityCode: "01" });
  await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", packagingDate: "2026-10-07", runCode: "1", quantities: [{ skuId: f.skus.cantinescaCase.id, qty: 100 }] });
  bar = (await makeLocation(db, f.sales, f.market.id, "Mail Order Bar", { ap: { name: "Pat Payables", email: "ap@mailorder.example.test" } })).location;
  await updateAccountShipping(db, f.admin, bar.id, { payBy: "check", depositMode: "none" });
  setGmailTestTransport(async (e) => {
    sent.push(e);
    return { id: `gm-${sent.length}`, threadId: null };
  });
});
afterAll(async () => {
  setGmailTestTransport(null);
  await close();
});

describe("Gmail adapter helpers", () => {
  it("parses a multipart message into text, addresses and attachment references, and strips HTML", () => {
    const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
    const m = parseMessage({
      id: "m1",
      threadId: "t1",
      internalDate: String(Date.parse("2026-11-04T15:00:00Z")),
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "\"Bo Buyer\" <bo@buyer.example.test>" },
          { name: "To", value: "orders@theleopardmark.com" },
          { name: "Subject", value: "PO 123" },
        ],
        parts: [
          { mimeType: "text/html", body: { data: b64("<p>Please send <b>4</b> sixtels.</p><br>Thanks") } },
          { mimeType: "application/pdf", filename: "PO123.pdf", body: { attachmentId: "att-9", size: 1234 } },
        ],
      },
    });
    expect(m.from).toBe("bo@buyer.example.test");
    expect(m.fromName).toBe("Bo Buyer");
    expect(m.subject).toBe("PO 123");
    expect(m.text).toMatch(/^Please send 4 sixtels\.\s+Thanks$/);
    expect(m.attachments).toEqual([{ attachmentId: "att-9", filename: "PO123.pdf", mime: "application/pdf", size: 1234 }]);
    expect(parseAddress("plain@example.test")).toEqual({ email: "plain@example.test", name: null });
    expect(htmlToText("<div>a</div><div>b &amp; c</div>")).toBe("a\nb & c");
    const mime = buildMime({ from: "orders@theleopardmark.com", to: ["x@example.test"], subject: "Invoice INV26376", text: "Body", attachments: [{ filename: "INV26376.pdf", mime: "application/pdf", data: Buffer.from("%PDF") }] });
    expect(mime).toContain("Content-Type: multipart/mixed");
    expect(mime).toContain('filename="INV26376.pdf"');
    expect(mime).toContain("Subject: Invoice INV26376");
  });
});

describe("Approved emails and the send switch", () => {
  it("with the switch off an approved invoice email waits for a hand send; with it on it leaves through Gmail with the PDF attached", async () => {
    const res = await submitOrder(db, f.admin, { locationId: bar.id, source: "phone", lines: [{ skuId: f.skus.cantinescaCase.id, qty: 2 }] });
    const confirmed = await confirmShipment(db, f.admin, res.shipment!.id, { scheduledDate: "2026-11-10" });
    await deliverShipment(db, f.admin, confirmed.id, { actualDate: "2026-11-10" });
    const inv = (await getInvoice(db, (await getShipment(db, confirmed.id))!.invoices[0].id))!.invoice;
    const r = await requestInvoiceEmail(db, f.accounting, inv.id);
    const approvedOff = await approveItem(db, f.accounting, r.item.id);
    expect(approvedOff.transport).toBe("manual");
    await runDueJobs(db);
    expect(sent.length).toBe(0);
    // The Owner turns automatic sending on: a new approval leaves through the transport.
    await updateCompanySettings(db, f.owner, { sendEmailAutomatically: true });
    const r2 = await requestApproval(db, f.accounting, { kind: "email", purpose: "custom", sender: "orders@", title: "Note to the bar", payload: { to: ["ap@mailorder.example.test"], subject: "A note", body: "Hello", attachments: [{ kind: "invoice_pdf", invoiceId: inv.id }] }, subjectType: "invoice", subjectId: inv.id, locationId: bar.id, marketId: bar.marketId });
    const approvedOn = await approveItem(db, f.accounting, r2.item.id);
    expect(approvedOn.transport).toBe("auto");
    await runDueJobs(db);
    expect(sent.length).toBe(1);
    expect(sent[0].from).toBe("orders@theleopardmark.com");
    expect(sent[0].to).toEqual(["ap@mailorder.example.test"]);
    expect(sent[0].attachments?.[0].filename).toBe(`${inv.number}.pdf`);
    const [done] = await db.select().from(schema.approvalItem).where(eq(schema.approvalItem.id, r2.item.id));
    expect(done.state).toBe("done");
    expect((done.result as { messageId: string }).messageId).toBe("gm-1");
    await updateCompanySettings(db, f.owner, { sendEmailAutomatically: false });
  });

  it("company policy can approve emails on creation; the end-of-day pull sheet is an approval item from operations@", async () => {
    await updateCompanySettings(db, f.owner, { autoApproveEmails: true, autoSendPullSheets: true });
    // The brewery stands in as a warehouse with a pull sheet address for this test (lots are already on hand there).
    await updateOrigin(db, f.owner, f.warehouse.id, { kind: "warehouse", pullSheetEmail: "warehouse@etd.example.test", pullSheetSendTime: "00:01" });
    const warehouse = { id: f.warehouse.id };
    const { nextDay } = await import("@/lib/domain/pullsheet/service");
    const tomorrow = nextDay("America/Los_Angeles");
    const res = await submitOrder(db, f.admin, { locationId: bar.id, source: "phone", lines: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] });
    await confirmShipment(db, f.admin, res.shipment!.id, { scheduledDate: tomorrow });
    const r = await schedulePullSheetSends(db, new Date());
    expect(r.queued).toBe(1);
    const items = await approvalsForSubject(db, "warehouse", warehouse.id);
    expect(items[0].kind).toBe("email");
    expect(items[0].purpose).toBe("pull_sheet");
    expect(items[0].sender).toBe("operations@");
    expect(items[0].autoApproved).toBe(true);
    expect(items[0].state).toBe("approved"); // approved by policy; manual transport while the send switch is off
    expect(items[0].transport).toBe("manual");
    expect((items[0].payload as { to: string[] }).to).toEqual(["warehouse@etd.example.test"]);
    // The same day is never queued twice.
    expect((await schedulePullSheetSends(db, new Date())).queued).toBe(0);
    await updateCompanySettings(db, f.owner, { autoApproveEmails: false, autoSendPullSheets: false });
    await updateOrigin(db, f.owner, f.warehouse.id, { kind: "brewery" });
    const [c] = await db.select().from(schema.approvalItem).where(and(eq(schema.approvalItem.subjectId, warehouse.id), eq(schema.approvalItem.kind, "email")));
    expect(c).toBeTruthy();
  });
});
