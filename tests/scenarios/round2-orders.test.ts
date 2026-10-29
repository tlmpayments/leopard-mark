/**
 * Round 2 (Oct 28 brief): the order creates its shipment (R2-1), shortfall decisions (R2-5), the rep-only minimum (R2-6),
 * void with the order reopened or cancelled (R2-7), delivered, refused and damaged quantities on the invoice and the
 * stock (R2-8, R2-9), will-call (R2-10), PO numbers (R2-11), pay-by on the invoice (R2-12), credit memos (R2-14),
 * price exceptions with an end date (R2-16), samples as no-charge orders (R2-27, R2-28), the driver's own stops (R2-38),
 * two-day packaging (R2-21) and the batch yield (R2-22, R2-26).
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { availability } from "@/lib/domain/allocation/service";
import { setPriceOverride } from "@/lib/domain/catalog/service";
import { createRepHomeAddress, samplesRecipients, setLocationStatus } from "@/lib/domain/customers/service";
import { updateAccountShipping } from "@/lib/domain/customers/shipping";
import { creditMemosForInvoice, getInvoice, issueCreditMemo } from "@/lib/domain/invoices/service";
import { kegBalances } from "@/lib/domain/kegs/service";
import { addPackagingDay, createBatch, lotYield, recordPackagingReport } from "@/lib/domain/lots/service";
import { updateOrigin } from "@/lib/domain/origins/service";
import { ShortfallError, cancelUndeliveredDemand, createShipmentForOrder, getOrder, listOrders, previewOrderShortfall, releaseHeldOrder, submitOrder } from "@/lib/domain/orders/service";
import { confirmShipment, correctDelivery, deliverShipment, getShipment, updateShipmentHeader, voidShipment } from "@/lib/domain/shipments/service";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

let db: Db;
let close: () => Promise<void>;
let f: Fixture;
let bar: typeof schema.customerLocation.$inferSelect;
let willCall: typeof schema.customerLocation.$inferSelect;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
  await updateOrigin(db, f.owner, f.warehouse.id, { originCode: "EBB", kind: "brewery", lotFacilityCode: "01" });
  // Lot-tagged stock on top of the fixture's opening 20 per SKU: a sixtel lot and a case lot at the brewery.
  await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", packagingDate: "2026-10-07", runCode: "1", quantities: [{ skuId: f.skus.cantinescaSixtel.id, qty: 10 }, { skuId: f.skus.cantinescaCase.id, qty: 10 }] });
  bar = (await makeLocation(db, f.sales, f.market.id, "Round Two Bar")).location;
  await updateAccountShipping(db, f.admin, bar.id, { payBy: "check", depositMode: "floating" });
  willCall = (await makeLocation(db, f.sales, f.market.id, "Will Call Wines")).location;
  await updateAccountShipping(db, f.admin, willCall.id, { fulfilment: "pickup", payBy: "stripe" });
});
afterAll(() => close());

const line = (skuId: string, qty: number) => ({ skuId, qty });

describe("R2-1, R2-3, R2-11, R2-12: the order drafts its shipment; confirm sets the date", () => {
  it("submitting an office order creates a D draft with lots prefilled, no scheduled date, the PO numbers and the order line on each line", async () => {
    const res = await submitOrder(db, f.admin, { locationId: bar.id, source: "phone", poNumbers: ["PO-4471"], lines: [line(f.skus.cantinescaSixtel.id, 4), line(f.skus.cantinescaCase.id, 2)] });
    expect(res.held).toBe(false);
    expect(res.shipment).not.toBeNull();
    expect(res.minimumApplies).toBe(false); // R2-6: no $90 rule for office orders
    const s = (await getShipment(db, res.shipment!.id))!;
    expect(s.shipment.type).toBe("D");
    expect(s.shipment.status).toBe("draft");
    expect(s.shipment.scheduledDate).toBeNull();
    expect(s.shipment.poNumbers).toEqual(["PO-4471"]);
    expect(s.lines.length).toBe(2);
    expect(s.lines.every((l) => l.line.orderLineId && l.line.lotCode)).toBe(true);
    expect(s.orders.map((o) => o.id)).toEqual([res.order.id]);
    // Availability counts the order's reservation once (not the draft shipment too).
    const before = await availability(db, f.warehouse.id, f.skus.cantinescaSixtel.id);
    expect(before.reservedQty).toBe(4);
    await expect(confirmShipment(db, f.admin, s.shipment.id)).rejects.toThrow(/scheduled date/);
    const confirmed = await confirmShipment(db, f.admin, s.shipment.id, { scheduledDate: "2026-11-10" });
    expect(confirmed.number).toMatch(/^EBB-D-261110-/);
    expect(confirmed.scheduledDate).toBe("2026-11-10");
    // After confirmation the shipment allocation holds the stock and the order's reservation is route-committed: still counted once.
    const after = await availability(db, f.warehouse.id, f.skus.cantinescaSixtel.id);
    expect(after.reservedQty).toBe(4);
    const inv = (await getInvoice(db, confirmed.id ? (await getShipment(db, confirmed.id))!.invoices[0].id : ""))!;
    expect(inv.invoice.status).toBe("draft");
    // Delivered in full: the invoice issues for the delivered quantities and carries the account's payment channel.
    await deliverShipment(db, f.admin, confirmed.id, { actualDate: "2026-11-10", kegPickup: { halfIn: 0, sixtelIn: 1 } });
    const issued = (await getInvoice(db, inv.invoice.id))!;
    expect(issued.invoice.status).toBe("issued");
    expect(issued.invoice.payBy).toBe("check");
    expect(issued.lines.some((l) => l.kind === "deposit")).toBe(false); // floating deposit: no per-keg lines (R2-13)
    const ord = (await getOrder(db, res.order.id))!;
    expect(ord.order.demandState).toBe("fulfilled");
    expect(ord.lines.every((l) => l.deliveredQty === l.currentQty)).toBe(true);
    const kb = (await kegBalances(db, f.admin, { locationId: bar.id }))[0];
    expect(kb.sixtelBalance).toBe(3); // 4 out, 1 empty back
  });

  it("the $90 minimum applies to rep orders only (R2-6)", async () => {
    const rep = await submitOrder(db, f.admin, { locationId: bar.id, source: "rep", lines: [line(f.skus.cantinescaCase.id, 1)] });
    expect(rep.minimumApplies).toBe(true);
    const office = await submitOrder(db, f.admin, { locationId: bar.id, source: "text", lines: [line(f.skus.cantinescaCase.id, 1)] });
    expect(office.minimumApplies).toBe(false);
    const cases = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `below_minimum:${office.order.id}`));
    expect(cases.length).toBe(0);
    await voidShipment(db, f.admin, rep.shipment!.id, "test cleanup", { order: "cancel" });
    await voidShipment(db, f.admin, office.shipment!.id, "test cleanup", { order: "cancel" });
  });

  it("a PO order needs its PO number (R2-11)", async () => {
    await expect(submitOrder(db, f.admin, { locationId: bar.id, source: "po", lines: [line(f.skus.cantinescaCase.id, 1)] })).rejects.toThrow(/PO number/);
  });
});

describe("R2-5: never short silently", () => {
  it("refuses a short order without a decision, shows the lines, then ships what is on hand with the reason recorded", async () => {
    const a = await availability(db, f.warehouse.id, f.skus.cantinescaSixtel.id);
    const ask = a.availableQty + 3;
    const preview = await previewOrderShortfall(db, f.admin, { locationId: bar.id, lines: [line(f.skus.cantinescaSixtel.id, ask)] });
    expect(preview.lines).toEqual([expect.objectContaining({ requested: ask, available: a.availableQty, short: 3 })]);
    await expect(submitOrder(db, f.admin, { locationId: bar.id, source: "email", lines: [line(f.skus.cantinescaSixtel.id, ask)] })).rejects.toBeInstanceOf(ShortfallError);
    await expect(submitOrder(db, f.admin, { locationId: bar.id, source: "email", lines: [line(f.skus.cantinescaSixtel.id, ask)], shortfallDecision: "ship_available" })).rejects.toThrow(/why/);
    const res = await submitOrder(db, f.admin, { locationId: bar.id, source: "email", lines: [line(f.skus.cantinescaSixtel.id, ask)], shortfallDecision: "ship_available", shortfallReason: "Buyer takes the rest next week" });
    expect(res.shortage).toBe(true);
    expect(res.shipment).not.toBeNull();
    const s = (await getShipment(db, res.shipment!.id))!;
    expect(s.lines[0].line.qty).toBe(a.availableQty);
    const ord = (await getOrder(db, res.order.id))!;
    expect(ord.order.shortfallDecision).toBe("ship_available");
    expect(ord.order.shortfallReason).toBe("Buyer takes the rest next week");
    expect(ord.order.shortfallDecidedByEmployeeId).toBe(f.admin.employeeId);
    expect(ord.lines[0].unmetQty).toBe(3);
    const audits = await db.select().from(schema.auditEvent).where(and(eq(schema.auditEvent.subjectType, "order"), eq(schema.auditEvent.subjectId, res.order.id)));
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(["order.submit", "order.submit_short"]));
    // Confirming commits only the shipped quantity; the 3 waiting stay in the queue.
    await confirmShipment(db, f.admin, s.shipment.id, { scheduledDate: "2026-11-12" });
    const after = (await getOrder(db, res.order.id))!;
    expect(after.lines[0].unmetQty).toBe(3);
    expect(after.lines[0].reservedQty).toBe(a.availableQty); // committed to the shipment, still the order's
    await voidShipment(db, f.admin, s.shipment.id, "test cleanup", { order: "cancel" });
  });

  it("holding keeps the order unconfirmed with no shipment; lifting the hold drafts one from what is on hand", async () => {
    const a = await availability(db, f.warehouse.id, f.skus.sunlightCase.id);
    const res = await submitOrder(db, f.admin, { locationId: bar.id, source: "slack", lines: [line(f.skus.sunlightCase.id, a.availableQty + 2)], shortfallDecision: "hold" });
    expect(res.held).toBe(true);
    expect(res.shipment).toBeNull();
    expect(res.order.demandState).toBe("held");
    expect((await listOrders(db, f.admin, { state: "held" })).some((r) => r.order.id === res.order.id)).toBe(true);
    expect((await listOrders(db, f.admin, { state: "open" })).some((r) => r.order.id === res.order.id)).toBe(true);
    const lifted = await releaseHeldOrder(db, f.admin, res.order.id, "Partial agreed by phone");
    expect(lifted.order.demandState).toBe("submitted");
    expect(lifted.shipment).not.toBeNull();
    await voidShipment(db, f.admin, lifted.shipment!.id, "test cleanup", { order: "cancel" });
  });
});

describe("R2-7: void after confirmation", () => {
  it("keeps the number, releases stock and returns the order to open; a new draft can be created", async () => {
    const res = await submitOrder(db, f.admin, { locationId: bar.id, source: "phone", lines: [line(f.skus.cantinescaCase.id, 3)] });
    const confirmed = await confirmShipment(db, f.admin, res.shipment!.id, { scheduledDate: "2026-11-13" });
    const voided = await voidShipment(db, f.admin, confirmed.id, "Truck broke down", { order: "reopen" });
    expect(voided.number).toBe(confirmed.number);
    const ord = (await getOrder(db, res.order.id))!;
    expect(ord.order.demandState).toBe("submitted");
    expect(ord.lines[0].reservedQty).toBe(3); // reservations count again
    const fresh = await createShipmentForOrder(db, f.admin, res.order.id);
    expect(fresh.status).toBe("draft");
    expect((await getShipment(db, fresh.id))!.lines[0].line.qty).toBe(3);
    await expect(createShipmentForOrder(db, f.admin, res.order.id)).rejects.toThrow(/already has shipment/);
    await voidShipment(db, f.admin, fresh.id, "test cleanup", { order: "cancel" });
    expect((await getOrder(db, res.order.id))!.order.demandState).toBe("cancelled");
  });

  it("cancelling an open order voids its unconfirmed draft with it", async () => {
    const res = await submitOrder(db, f.admin, { locationId: bar.id, source: "phone", lines: [line(f.skus.cantinescaCase.id, 1)] });
    await cancelUndeliveredDemand(db, f.admin, res.order.id, "Customer changed their mind");
    expect((await getShipment(db, res.shipment!.id))!.shipment.status).toBe("voided");
  });
});

describe("R2-8, R2-9, R2-38: delivery with refused and damaged lines, from the assigned driver, corrected by the office", () => {
  it("invoices the delivered quantity, returns refused units to stock, writes off damaged units with the reason", async () => {
    const start = await availability(db, f.warehouse.id, f.skus.cantinescaSixtel.id);
    const res = await submitOrder(db, f.admin, { locationId: bar.id, source: "phone", lines: [line(f.skus.cantinescaSixtel.id, 5)] });
    const confirmed = await confirmShipment(db, f.admin, res.shipment!.id, { scheduledDate: "2026-11-14" });
    await updateShipmentHeader(db, f.admin, confirmed.id, { driverEmployeeId: f.driver.employeeId });
    const other = await submitOrder(db, f.admin, { locationId: willCall.id, source: "phone", pickup: false, lines: [line(f.skus.cantinescaCase.id, 1)] });
    const otherConfirmed = await confirmShipment(db, f.admin, other.shipment!.id, { scheduledDate: "2026-11-14" });
    // The driver may deliver only an assigned stop.
    await expect(deliverShipment(db, f.driver, otherConfirmed.id, { actualDate: "2026-11-14" })).rejects.toThrow(/assigned/);
    const lineId = (await getShipment(db, confirmed.id))!.lines[0].line.id;
    await expect(deliverShipment(db, f.driver, confirmed.id, { actualDate: "2026-11-14", lines: [{ lineId, deliveredQty: 3, refusedQty: 1, damagedQty: 1 }] })).rejects.toThrow(/damaged/);
    await expect(deliverShipment(db, f.driver, confirmed.id, { actualDate: "2026-11-14", lines: [{ lineId, deliveredQty: 3, refusedQty: 1, damagedQty: 2, damageReason: "x" }] })).rejects.toThrow(/must equal/);
    const delivered = await deliverShipment(db, f.driver, confirmed.id, { actualDate: "2026-11-14", lines: [{ lineId, deliveredQty: 3, refusedQty: 1, damagedQty: 1, damageReason: "Dented at the dock" }] });
    expect(delivered.status).toBe("delivered");
    const s = (await getShipment(db, confirmed.id))!;
    expect(s.lines[0].line).toMatchObject({ deliveredQty: 3, refusedQty: 1, damagedQty: 1, damageReason: "Dented at the dock" });
    const inv = (await getInvoice(db, s.invoices[0].id))!;
    expect(inv.invoice.status).toBe("issued");
    expect(inv.lines.find((l) => l.kind === "beer")?.qty).toBe(3);
    const after = await availability(db, f.warehouse.id, f.skus.cantinescaSixtel.id);
    expect(after.onHandQty).toBe(start.onHandQty - 4); // 3 delivered + 1 damaged left; the refused one never did
    const damage = await db.select().from(schema.stockMovement).where(and(eq(schema.stockMovement.shipmentId, confirmed.id), eq(schema.stockMovement.kind, "damage")));
    expect(damage.length).toBe(1);
    expect(damage[0].evidence).toMatch(/Dented at the dock/);
    expect(damage[0].qtyDelta).toBe(-1);
    // The order keeps the refused and damaged units as open demand, re-reserved from what is on hand.
    const ord = (await getOrder(db, res.order.id))!;
    expect(ord.order.demandState).toBe("partially_fulfilled");
    expect(ord.lines[0].deliveredQty).toBe(3);
    expect(ord.lines[0].reservedQty + ord.lines[0].unmetQty).toBe(2);
    const kb = (await kegBalances(db, f.admin, { locationId: bar.id }))[0];
    expect(kb.sixtelBalance).toBe(3 + 3); // the earlier test left 3 out; 3 kept now
    // The office corrects: the buyer kept 4 after all.
    await expect(correctDelivery(db, f.driver, confirmed.id, { lines: [{ lineId, deliveredQty: 4, refusedQty: 0, damagedQty: 1, damageReason: "Dented at the dock" }], reason: "driver keyed wrong" })).rejects.toThrow(/office/);
    await correctDelivery(db, f.admin, confirmed.id, { lines: [{ lineId, deliveredQty: 4, refusedQty: 0, damagedQty: 1, damageReason: "Dented at the dock" }], reason: "Driver keyed 3; the buyer signed for 4" });
    const corrected = (await getInvoice(db, s.invoices[0].id))!;
    expect(corrected.lines.find((l) => l.kind === "beer")?.qty).toBe(4);
    expect(corrected.invoice.number).toBe(inv.invoice.number);
    expect(corrected.documents.length).toBeGreaterThan(inv.documents.length);
    expect((await availability(db, f.warehouse.id, f.skus.cantinescaSixtel.id)).onHandQty).toBe(start.onHandQty - 5);
    expect((await kegBalances(db, f.admin, { locationId: bar.id }))[0].sixtelBalance).toBe(7);
    await deliverShipment(db, f.admin, otherConfirmed.id, { actualDate: "2026-11-14" });
  });
});

describe("R2-10, R2-14, R2-16: will-call, credit memos, price exceptions", () => {
  it("a pickup account's order is will-call: no driver, the invoice issues at confirmation and re-dates at pickup", async () => {
    const res = await submitOrder(db, f.admin, { locationId: willCall.id, source: "phone", lines: [line(f.skus.cantinescaCase.id, 2)] });
    expect(res.shipment!.pickup).toBe(true);
    const confirmed = await confirmShipment(db, f.admin, res.shipment!.id, { scheduledDate: "2026-11-15" });
    const inv = (await getInvoice(db, (await getShipment(db, confirmed.id))!.invoices[0].id))!;
    expect(inv.invoice.status).toBe("issued");
    expect(inv.invoice.payBy).toBe("stripe");
    await deliverShipment(db, f.admin, confirmed.id, { actualDate: "2026-11-16" });
    expect((await getInvoice(db, inv.invoice.id))!.invoice.invoiceDate).toBe("2026-11-16");
  });

  it("credit memos stand against an issued invoice in their own CM series, Owner or back office only, never above the total", async () => {
    const [inv] = await db.select().from(schema.invoice).where(and(eq(schema.invoice.locationId, willCall.id), eq(schema.invoice.status, "issued")));
    await expect(issueCreditMemo(db, f.accounting, { invoiceId: inv.id, amountCents: 500, reason: "Short-dated" })).rejects.toThrow(/Not authorized/);
    await expect(issueCreditMemo(db, f.admin, { invoiceId: inv.id, amountCents: 500, reason: "" })).rejects.toThrow(/reason/);
    const cm = await issueCreditMemo(db, f.admin, { invoiceId: inv.id, amountCents: 500, reason: "Short-dated case", memoDate: "2026-11-20" });
    expect(cm.number).toMatch(/^CM26\d{3}$/);
    await expect(issueCreditMemo(db, f.admin, { invoiceId: inv.id, amountCents: inv.totalCents, reason: "Too much" })).rejects.toThrow(/exceed/);
    expect((await creditMemosForInvoice(db, inv.id)).length).toBe(1);
    expect((await getInvoice(db, inv.id))!.invoice.totalCents).toBe(inv.totalCents); // the invoice itself never changes
  });

  it("a price exception needs the Owner or back office, a reason and an end date (R2-16)", async () => {
    await expect(setPriceOverride(db, f.sales, { locationId: bar.id, skuId: f.skus.cantinescaCase.id, priceCents: 3000, reason: "deal", endsOn: "2027-01-31" })).rejects.toThrow(/Not authorized/);
    await expect(setPriceOverride(db, f.admin, { locationId: bar.id, skuId: f.skus.cantinescaCase.id, priceCents: 3000, reason: "deal", endsOn: "" })).rejects.toThrow(/end date/);
    await expect(setPriceOverride(db, f.admin, { locationId: bar.id, skuId: f.skus.cantinescaCase.id, priceCents: 3000, reason: "deal", endsOn: "2020-01-01" })).rejects.toThrow(/future/);
    const o = await setPriceOverride(db, f.admin, { locationId: bar.id, skuId: f.skus.cantinescaCase.id, priceCents: 3000, reason: "Opening promotion", endsOn: "2099-01-31" });
    expect(o.effectiveTo).not.toBeNull();
  });
});

describe("R2-27, R2-28: samples are no-charge orders to the samples house or a rep's home address", () => {
  it("ships as S from the market default and invoices on the NC series; the samples page is history", async () => {
    const recipients = await samplesRecipients(db, f.market.id);
    expect(recipients.length).toBe(1); // the market's samples house, created with the market (migration 0005 for existing ones)
    expect(recipients[0].loc).toMatchObject({ samplesHouse: true, kind: "internal", termsDaysOverride: 0 });
    const home = await createRepHomeAddress(db, f.admin, { marketId: f.market.id, repEmployeeId: f.sales.employeeId!, address: { line1: "12 Rep Street", city: "Oakland", state: "ca", postalCode: "94601" } });
    expect(home.kind).toBe("individual");
    expect(home.repEmployeeId).toBe(f.sales.employeeId);
    expect((await samplesRecipients(db, f.market.id)).map((r) => r.loc.id)).toEqual([recipients[0].loc.id, home.id]);
    // The samples house takes a no-charge order too.
    const house = await submitOrder(db, f.admin, { locationId: recipients[0].loc.id, source: "rep", noCharge: true, lines: [line(f.skus.cantinescaCase.id, 1)] });
    expect(house.shipment!.type).toBe("S");
    await voidShipment(db, f.admin, house.shipment!.id, "test cleanup", { order: "cancel" });
    await expect(createRepHomeAddress(db, f.admin, { marketId: f.market.id, repEmployeeId: f.sales.employeeId!, address: { line1: "12 Rep Street", city: "Oakland", state: "CA", postalCode: "94601" } })).rejects.toThrow(/already has/);
    const res = await submitOrder(db, f.admin, { locationId: home.id, source: "rep", noCharge: true, lines: [line(f.skus.cantinescaCase.id, 1), line(f.skus.cantinescaSixtel.id, 1)] });
    expect(res.minimumApplies).toBe(false);
    expect(res.shipment!.type).toBe("S");
    const confirmed = await confirmShipment(db, f.admin, res.shipment!.id, { scheduledDate: "2026-11-18" });
    expect(confirmed.number).toMatch(/^EBB-S-/);
    await deliverShipment(db, f.admin, confirmed.id, { actualDate: "2026-11-18" });
    const inv = (await getInvoice(db, (await getShipment(db, confirmed.id))!.invoices[0].id))!;
    expect(inv.invoice.series).toBe("NC");
    expect(inv.invoice.totalCents).toBe(0);
    expect(inv.invoice.status).toBe("issued");
  });
});

describe("R2-31: accounts are Active or Closed", () => {
  it("refuses the retired inactive status", async () => {
    await expect(setLocationStatus(db, f.admin, bar.id, "inactive", "test")).rejects.toThrow(/Active or Closed/);
  });
});

describe("R2-21, R2-22, R2-26: batch size, two-day packaging, yield", () => {
  it("numbers a batch from brand, barrels, facility and brew date; a second packaging day adds to the same lot; loss is displayed", async () => {
    const b = await createBatch(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", brewDate: "2026-11-01", barrels: 30, status: "in_progress" });
    expect(b.batchNumber).toBe("B01SLG26001");
    expect(b.barrels).toBe("30.00");
    const lot = await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", packagingDate: "2026-11-20", runCode: "1", batchId: b.id, quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 20 }] });
    const day1 = await lotYield(db, lot.id);
    expect(day1.packagedBarrels).toBe(10);
    expect(day1.lossBarrels).toBe(20);
    // The run continued the next day: same lot, same code, quantities added, stock posted lot-tagged.
    const before = await availability(db, f.warehouse.id, f.skus.sunlightHalf.id);
    await expect(addPackagingDay(db, f.admin, lot.id, { packagedOn: "2026-11-19", quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 1 }] })).rejects.toThrow(/earlier/);
    const same = await addPackagingDay(db, f.admin, lot.id, { packagedOn: "2026-11-21", quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 30 }], note: "Day 2" });
    expect(same.lotCode).toBe(lot.lotCode);
    expect((await availability(db, f.warehouse.id, f.skus.sunlightHalf.id)).onHandQty).toBe(before.onHandQty + 30);
    const day2 = await lotYield(db, lot.id);
    expect(day2.packagedBarrels).toBe(25);
    expect(day2.lossBarrels).toBe(5);
    // Recording a packaging report against the same batch again adds a day rather than a second lot.
    const again = await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", packagingDate: "2026-11-22", runCode: "2", batchId: b.id, quantities: [{ skuId: f.skus.sunlightCase.id, qty: 10 }] });
    expect(again.id).toBe(lot.id);
    expect((await db.select().from(schema.brewBatch).where(eq(schema.brewBatch.id, b.id)))[0].status).toBe("complete");
  });
});
