/**
 * Round 4 operations: split shipments (one order, two deliveries, two invoices), the delivery-day coverage warning,
 * the orders@ intake parser (Martignetti PDF text, Mancini order-form text, known senders) and the two reports.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { availability } from "@/lib/domain/allocation/service";
import { setMarketPrice, upsertSkuAlias } from "@/lib/domain/catalog/service";
import { getLocation } from "@/lib/domain/customers/service";
import { updateAccountShipping } from "@/lib/domain/customers/shipping";
import { recordIntakeFromMail } from "@/lib/domain/intake/mailbox";
import { draftFromMessage, findPoNumber, findRequestedDate, linesFromText, locationForSender, parserCatalog, quantityIn } from "@/lib/domain/intake/parse";
import { recordPackagingReport } from "@/lib/domain/lots/service";
import { updateOrigin } from "@/lib/domain/origins/service";
import { cancelUndeliveredDemand, createShipmentForOrder, getOrder, splitDraftShipment, submitOrder } from "@/lib/domain/orders/service";
import { salesByFormat, sampleWriteOff } from "@/lib/domain/reports/service";
import { confirmShipment, deliverShipment, deliveryDayCovered, getShipment } from "@/lib/domain/shipments/service";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

let db: Db;
let close: () => Promise<void>;
let f: Fixture;
let bar: typeof schema.customerLocation.$inferSelect;
let martignetti: typeof schema.customerLocation.$inferSelect;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
  await updateOrigin(db, f.owner, f.warehouse.id, { originCode: "EBB", kind: "brewery", lotFacilityCode: "01" });
  await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", packagingDate: "2026-10-07", runCode: "1", quantities: [{ skuId: f.skus.cantinescaSixtel.id, qty: 60 }, { skuId: f.skus.cantinescaCase.id, qty: 300 }, { skuId: f.skus.sunlightHalf.id, qty: 30 }] });
  bar = (await makeLocation(db, f.sales, f.market.id, "Split Street Tavern", { ap: { name: "Pat Payables", email: "ap@splitstreet.example.test" } })).location;
  await updateAccountShipping(db, f.admin, bar.id, { payBy: "check", depositMode: "none" });
  martignetti = (await makeLocation(db, f.sales, f.market.id, "Martignetti Test Companies", { ap: { name: "AP Martignetti", email: "ap@martignetti-test.example.test" } })).location;
  await updateAccountShipping(db, f.admin, martignetti.id, { kind: "distributor", payBy: "check", depositMode: "none" });
  for (const [skuId, cents] of [[f.skus.cantinescaCase.id, 2347], [f.skus.cantinescaSixtel.id, 4435], [f.skus.sunlightHalf.id, 10988]] as const) {
    await setMarketPrice(db, f.admin, { marketId: f.market.id, skuId, tier: "distributor", priceCents: cents });
  }
  await upsertSkuAlias(db, f.admin, "7799101", f.skus.sunlightHalf.id, "Martignetti item number");
  await upsertSkuAlias(db, f.admin, "7799102", f.skus.cantinescaSixtel.id, "Martignetti item number");
  await upsertSkuAlias(db, f.admin, "7799103", f.skus.cantinescaCase.id, "Martignetti item number");
});
afterAll(() => close());

const line = (skuId: string, qty: number) => ({ skuId, qty });

describe("Split shipments", () => {
  it("part of a draft moves to a second draft; each confirms and delivers on its own with its own invoice; the order fulfils once", async () => {
    const res = await submitOrder(db, f.admin, { locationId: bar.id, source: "phone", lines: [line(f.skus.cantinescaCase.id, 10), line(f.skus.cantinescaSixtel.id, 4)] });
    const first = (await getShipment(db, res.shipment!.id))!;
    const caseLine = first.lines.find((l) => l.line.skuId === f.skus.cantinescaCase.id)!.line;
    const sixtelLine = first.lines.find((l) => l.line.skuId === f.skus.cantinescaSixtel.id)!.line;
    await expect(splitDraftShipment(db, f.admin, first.shipment.id, [{ shipmentLineId: caseLine.id, qty: 10 }, { shipmentLineId: sixtelLine.id, qty: 4 }], "all")).rejects.toThrow(/empty/);
    await expect(splitDraftShipment(db, f.admin, first.shipment.id, [{ shipmentLineId: caseLine.id, qty: 11 }], "too many")).rejects.toThrow(/only 10/);
    const second = await splitDraftShipment(db, f.admin, first.shipment.id, [{ shipmentLineId: caseLine.id, qty: 4 }, { shipmentLineId: sixtelLine.id, qty: 4 }], "cooler takes half now");
    const a = (await getShipment(db, first.shipment.id))!;
    const b = (await getShipment(db, second.id))!;
    expect(a.lines.map((l) => l.line.qty)).toEqual([6]);
    expect(b.lines.map((l) => l.line.qty).sort()).toEqual([4, 4]);
    expect(b.lines.every((l) => l.line.orderLineId)).toBe(true);
    // Reservations are untouched by the split: the order still holds 14 units.
    const ord0 = (await getOrder(db, res.order.id))!;
    expect(ord0.lines.reduce((s, l) => s + l.reservedQty, 0)).toBe(14);
    expect(ord0.lines.reduce((s, l) => s + l.onDraftQty, 0)).toBe(14);
    expect(ord0.lines.reduce((s, l) => s + l.unshippedQty, 0)).toBe(0);
    await expect(createShipmentForOrder(db, f.admin, res.order.id)).rejects.toThrow(/unconfirmed draft/);
    const ca = await confirmShipment(db, f.admin, a.shipment.id, { scheduledDate: "2026-11-10" });
    const cb = await confirmShipment(db, f.admin, b.shipment.id, { scheduledDate: "2026-11-12" });
    expect(ca.number).not.toBe(cb.number);
    const avail = await availability(db, f.warehouse.id, f.skus.cantinescaCase.id);
    expect(avail.reservedQty).toBe(10); // counted once across both shipments
    await deliverShipment(db, f.admin, ca.id, { actualDate: "2026-11-10" });
    const mid = (await getOrder(db, res.order.id))!;
    expect(mid.order.demandState).toBe("partially_fulfilled");
    expect(mid.lines.find((l) => l.skuId === f.skus.cantinescaCase.id)!.deliveredQty).toBe(6);
    await deliverShipment(db, f.admin, cb.id, { actualDate: "2026-11-12" });
    const done = (await getOrder(db, res.order.id))!;
    expect(done.order.demandState).toBe("fulfilled");
    const invA = (await getShipment(db, ca.id))!.invoices[0];
    const invB = (await getShipment(db, cb.id))!.invoices[0];
    expect(invA.id).not.toBe(invB.id);
    expect(invA.number).toMatch(/^INV/);
    expect(invB.number).toMatch(/^INV/);
  });

  it("the rest of an order ships on a second draft once the first is confirmed; cancelling with a confirmed shipment is refused", async () => {
    const res = await submitOrder(db, f.admin, { locationId: bar.id, source: "text", lines: [line(f.skus.cantinescaCase.id, 6)] });
    const first = (await getShipment(db, res.shipment!.id))!;
    const second = await splitDraftShipment(db, f.admin, first.shipment.id, [{ shipmentLineId: first.lines[0].line.id, qty: 2 }], "two trips");
    const c1 = await confirmShipment(db, f.admin, first.shipment.id, { scheduledDate: "2026-11-10" });
    await expect(cancelUndeliveredDemand(db, f.admin, res.order.id, "changed mind")).rejects.toThrow(/void that shipment first/);
    await deliverShipment(db, f.admin, c1.id, { actualDate: "2026-11-10" });
    // The second draft is in play; nothing more to create until it is confirmed or voided.
    await expect(createShipmentForOrder(db, f.admin, res.order.id)).rejects.toThrow(/unconfirmed draft/);
    // Cancel the remainder: the draft goes with it, the delivered part stays (a partly delivered order ends fulfilled, brief §13).
    await cancelUndeliveredDemand(db, f.admin, res.order.id, "the rest is not wanted");
    expect((await getShipment(db, second.id))!.shipment.status).toBe("voided");
    const ord = (await getOrder(db, res.order.id))!;
    expect(ord.order.demandState).toBe("fulfilled");
    expect(ord.order.cancelReason).toBe("the rest is not wanted");
    expect(ord.lines[0].deliveredQty).toBe(4);
    expect(ord.lines[0].currentQty).toBe(4);
  });
});

describe("Delivery-day coverage (Round 4)", () => {
  it("a shipment scheduled on a day the origin does not deliver opens a warning, never a block", async () => {
    await updateOrigin(db, f.owner, f.warehouse.id, { deliveryDays: ["Tue", "Thu"] });
    expect(deliveryDayCovered({ deliveryDays: ["Tue", "Thu"] }, "2026-11-10")).toBe(true); // Tuesday
    expect(deliveryDayCovered({ deliveryDays: ["Tue", "Thu"] }, "2026-11-11")).toBe(false); // Wednesday
    expect(deliveryDayCovered({ deliveryDays: null }, "2026-11-11")).toBe(true);
    const res = await submitOrder(db, f.admin, { locationId: bar.id, source: "phone", lines: [line(f.skus.cantinescaCase.id, 1)] });
    const confirmed = await confirmShipment(db, f.admin, res.shipment!.id, { scheduledDate: "2026-11-11" });
    expect(confirmed.status).toBe("confirmed");
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `delivery_day_uncovered:${confirmed.id}`));
    expect(c.state).toBe("open");
    expect(c.title).toMatch(/Wed 2026-11-11 is not a day EBB delivers/);
    await updateOrigin(db, f.owner, f.warehouse.id, { deliveryDays: null });
  });
});

describe("The orders@ intake parser", () => {
  it("reads quantities, PO numbers and dates out of free text without mistaking prices, dates or item codes for quantities", () => {
    expect(quantityIn("7799101  CANTINESCA 1/2 BBL   16   109.88   1,758.08", ["7799101"])).toBe(16);
    expect(quantityIn("Please send 3 cases of Cantinesca by 11/14")).toBe(3);
    expect(quantityIn("Total $1,234.50 due 12/01/2026")).toBeNull();
    expect(findPoNumber("PO # 10072645 attached")).toBe("10072645");
    expect(findPoNumber("Purchase Order No: MART-77")).toBe("MART-77");
    expect(findRequestedDate("Deliver by 11/14 please", new Date("2026-11-04T12:00:00Z"))).toBe("2026-11-14");
    expect(findRequestedDate("needed 1/5", new Date("2026-12-20T12:00:00Z"))).toBe("2027-01-05");
  });

  it("matches Martignetti's item numbers through the SKU aliases and product names through brand and package", async () => {
    const { skus, aliases } = await parserCatalog(db);
    const po = ["MARTIGNETTI COMPANIES   PURCHASE ORDER 10072645", "Vendor 234647", "7799101  CANTINESCA 1/2 BBL KEG         16   109.88", "7799102  CANTINESCA 1/6 BBL KEG         20    44.35", "7799103  CANTINESCA 2/12 12OZ CAN      200    23.47", "Delivery charge 476.00", "Total 7,815.08"].join("\n");
    const lines = linesFromText(po, skus, aliases);
    expect(lines.map((l) => [l.skuCode, l.qty, l.via])).toEqual([
      ["SUN-HALF", 16, "alias"],
      ["CAN-SIX", 20, "alias"],
      ["CAN-12C", 200, "alias"],
    ]);
    const email = ["Hi there,", "Can we get 4 sixtels of Cantinesca and 10 cases of the 12 oz Cantinesca cans this week?", "Also 2 half barrels Sunlight Groove.", "Thanks"].join("\n");
    const byName = linesFromText(email, skus, aliases);
    expect(byName.map((l) => [l.skuCode, l.qty, l.via])).toEqual([
      ["CAN-SIX", 4, "name"],
      ["CAN-12C", 10, "name"],
      ["SUN-HALF", 2, "name"],
    ]);
  });

  it("knows the sender by contact email or company domain, drafts the order, and records a mail with its attachment text", async () => {
    const ap = (await getLocation(db, martignetti.id))!.contacts.find((c) => c.contactRole === "ap")!;
    const [contact] = await db.select().from(schema.contact).where(eq(schema.contact.id, ap.contactId));
    expect((await locationForSender(db, contact.email))?.match).toBe("contact_email");
    const domain = contact.email!.split("@")[1];
    expect((await locationForSender(db, `someone.else@${domain}`))?.locationId).toBe(martignetti.id);
    expect(await locationForSender(db, "nobody@gmail.com")).toBeNull();
    const draft = await draftFromMessage(db, { fromEmail: `buyer@${domain}`, subject: "PO 10072645", text: "See attached purchase order. Deliver 11/20.", attachmentTexts: ["7799103 CANTINESCA 2/12 12OZ CAN 200 23.47\n7799102 CANTINESCA 1/6 BBL 20 44.35"], receivedAt: new Date("2026-11-04T15:00:00Z") });
    expect(draft.locationId).toBe(martignetti.id);
    expect(draft.poNumber).toBe("10072645");
    expect(draft.requestedDate).toBe("2026-11-20");
    expect(draft.lines.map((l) => [l.skuCode, l.qty])).toEqual([
      ["CAN-12C", 200],
      ["CAN-SIX", 20],
    ]);
    expect(draft.confidence).toBe("medium"); // domain match, not an exact contact
    const r = await recordIntakeFromMail(db, "orders@theleopardmark.com", { id: "gm-1", threadId: "th-1", receivedAt: new Date("2026-11-04T15:00:00Z"), from: contact.email, fromName: contact.name, to: "orders@theleopardmark.com", subject: "PO 10072645", text: "Attached.", attachments: [{ attachmentId: "att-1", filename: "PO10072645.txt", mime: "text/plain", size: 60 }] }, async () => Buffer.from("7799101 CANTINESCA 1/2 BBL 16 109.88\n", "utf8"));
    expect(r.recorded).toBe(true);
    const [row] = await db.select().from(schema.orderIntakeRequest).where(eq(schema.orderIntakeRequest.id, r.id));
    expect(row.locationId).toBe(martignetti.id);
    expect(row.attachmentCount).toBe(1);
    expect((row.parsed as { lines: Array<{ qty: number }> }).lines[0].qty).toBe(16);
    const atts = await db.select().from(schema.intakeAttachment).where(eq(schema.intakeAttachment.intakeId, r.id));
    expect(atts[0].textExtract).toContain("7799101");
    // The same message a second time is not recorded twice.
    const again = await recordIntakeFromMail(db, "orders@theleopardmark.com", { id: "gm-1", threadId: "th-1", receivedAt: new Date(), from: contact.email, fromName: null, to: null, subject: "PO", text: "x", attachments: [] }, async () => Buffer.alloc(0));
    expect(again.recorded).toBe(false);
    const [c] = await db.select().from(schema.exceptionCase).where(and(eq(schema.exceptionCase.dedupeKey, `email_intake:${r.id}`)));
    expect(c.title).toContain("Martignetti Test Companies");
  });
});

describe("Reports", () => {
  it("sales by format and the sample write-off read the issued invoices by month and package", async () => {
    const sales = await salesByFormat(db, f.owner, { from: "2026-11-01", to: "2026-12-01", marketIds: [f.market.id] });
    expect(sales.rows.some((r) => r.packageKind === "case_12oz_can" && r.month === "2026-11")).toBe(true);
    const cases = sales.rows.filter((r) => r.packageKind === "case_12oz_can").reduce((s, r) => s + r.units, 0);
    expect(cases).toBeGreaterThanOrEqual(14);
    expect(sales.totals.barrels).toBeGreaterThan(0);
    const w = await sampleWriteOff(db, f.owner, { from: "2026-11-01", to: "2026-12-01" });
    expect(w.rows.length).toBe(0); // nothing left at no charge in this file
  });
});
