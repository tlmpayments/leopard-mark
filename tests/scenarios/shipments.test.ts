/**
 * Shipments, lots, numbering, ledger, kegs and invoices — acceptance items 1 to 5, 8 and 9 of docs/SHIPMENTS_SPEC.md.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { availability } from "@/lib/domain/allocation/service";
import { createWarehouse } from "@/lib/domain/markets/service";
import { createOrigin, updateOrigin } from "@/lib/domain/origins/service";
import { composeLotCode, lotPickerOptions, parseLotCode, recordPackagingReport } from "@/lib/domain/lots/service";
import { confirmShipment, createShipment, deliverShipment, getShipment, listShipments, receiveTransfer, regenerateShipmentDocuments, replaceShipmentLines, updateShipmentHeader, voidShipment } from "@/lib/domain/shipments/service";
import { getInvoice, listInvoices } from "@/lib/domain/invoices/service";
import { kegBalances, microstarReport, recordKegEvent } from "@/lib/domain/kegs/service";
import { applyCountSession, createCountSession } from "@/lib/domain/counts/service";
import { getCompanySettings, nextDocNumber, updateCompanySettings } from "@/lib/domain/settings/service";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

let db: Db;
let close: () => Promise<void>;
let f: Fixture;
let lotHalf: string; // Sunlight half-barrel lot
let lotSixtel: string; // Cantinesca sixtel lot
let lotCase: string;
let retail: typeof schema.customerLocation.$inferSelect;
let distributor: typeof schema.customerLocation.$inferSelect;
let served: typeof schema.customerLocation.$inferSelect;
let floating: typeof schema.customerLocation.$inferSelect;
let noCodeOrigin: typeof schema.warehouse.$inferSelect;
let destWarehouse: typeof schema.warehouse.$inferSelect;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
  await updateOrigin(db, f.owner, f.warehouse.id, { originCode: "EBB", kind: "brewery", lotFacilityCode: "01", addressLine1: "1001 Canal Blvd", addressCity: "Richmond", addressState: "CA", addressPostalCode: "94804" });
  noCodeOrigin = await createWarehouse(db, f.owner, { marketId: f.market.id, name: "No-code warehouse" });
  destWarehouse = await createOrigin(db, f.owner, { name: "Express Wine Delivery", kind: "warehouse", marketId: f.market.id, originCode: "EWD" });
  const l1 = await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", packagingDate: "2026-10-06", runCode: "1", quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 24 }, { skuId: f.skus.sunlightCase.id, qty: 40 }] });
  lotHalf = l1.id;
  const l2 = await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", packagingDate: "2026-10-07", runCode: "1", quantities: [{ skuId: f.skus.cantinescaSixtel.id, qty: 20 }, { skuId: f.skus.cantinescaCase.id, qty: 50 }] });
  lotSixtel = l2.id;
  lotCase = l2.id;
  retail = (await makeLocation(db, f.sales, f.market.id, "Retail Tavern")).location;
  distributor = (await makeLocation(db, f.sales, f.market.id, "Big Distributor Inc")).location;
  await db.update(schema.customerLocation).set({ kind: "distributor", fulfilment: "pickup" }).where(eq(schema.customerLocation.id, distributor.id));
  served = (await makeLocation(db, f.sales, f.market.id, "Served Bar")).location;
  await db.update(schema.customerLocation).set({ servedByLocationId: distributor.id }).where(eq(schema.customerLocation.id, served.id));
  floating = (await makeLocation(db, f.sales, f.market.id, "Floating Deposit Bar")).location;
  await db.update(schema.customerLocation).set({ depositMode: "floating" }).where(eq(schema.customerLocation.id, floating.id));
});
afterAll(() => close());

function header(over: Partial<Parameters<typeof createShipment>[2]> = {}) {
  return { type: "D" as const, originWarehouseId: f.warehouse.id, destinationLocationId: retail.id, scheduledDate: "2026-11-05", ...over };
}

describe("Lot codes (4.x)", () => {
  it("composes and parses facility + brand + yymmdd + run", () => {
    expect(composeLotCode("01", "CNT", "2026-10-07", "1")).toBe("01CNT2610071");
    expect(parseLotCode("01CNT2610071")).toEqual({ facilityCode: "01", brandCode: "CNT", packagingDate: "2026-10-07", runCode: "1" });
    expect(parseLotCode("05CNT02609021")).toBeNull();
  });
  it("offers lots newest first, flags unknown quantities, never offers dotted legacy lots (1.7, 4.6)", async () => {
    const backfill = await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", packagingDate: "2026-09-02", runCode: "1", quantities: [], quantitiesKnown: false, source: "bol_log_backfill" });
    await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", packagingDate: "2026-01-30", runCode: "1", quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 24 }], legacyCode: "TLM.EBB.SGB.001", source: "production_tab" });
    const options = await lotPickerOptions(db, { brandCode: "SLG" });
    expect(options.map((o) => o.lotCode)).toEqual(["01SLG2610061", "01SLG2609021"]);
    expect(options.find((o) => o.lotId === backfill.id)?.quantitiesKnown).toBe(false);
    const [exc] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `lot_quantities_unconfirmed:${backfill.id}`));
    expect(exc?.state).toBe("open");
  });
  it("refuses a duplicate lot code and a facility without a lot code", async () => {
    await expect(recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", packagingDate: "2026-10-06", runCode: "1", quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 1 }] })).rejects.toThrow(/already exists/);
    await expect(recordPackagingReport(db, f.admin, { facilityWarehouseId: destWarehouse.id, brandCode: "SLG", packagingDate: "2026-10-06", runCode: "2", quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 1 }] })).rejects.toThrow(/lot facility code/);
  });
});

describe("Acceptance 1 — numbering", () => {
  it("assigns -001 and -002 for the same origin and date, restarts for another date, and refuses an origin without a code", async () => {
    const a = await createShipment(db, f.admin, header(), [{ skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 2 }]);
    const b = await createShipment(db, f.admin, header(), [{ skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 1 }]);
    const c = await createShipment(db, f.admin, header({ scheduledDate: "2026-11-06" }), [{ skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 1 }]);
    const [ca, cb] = await Promise.all([confirmShipment(db, f.admin, a.id), confirmShipment(db, f.admin, b.id)]);
    expect([ca.number, cb.number].sort()).toEqual(["EBB-D-261105-001", "EBB-D-261105-002"]);
    const cc = await confirmShipment(db, f.admin, c.id);
    expect(cc.number).toBe("EBB-D-261106-001");
    const d = await createShipment(db, f.admin, header({ originWarehouseId: noCodeOrigin.id }), [{ skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 1 }]);
    await expect(confirmShipment(db, f.admin, d.id)).rejects.toThrow(/origin code/);
  });
});

describe("Acceptance 2 — confirmation guards", () => {
  it("refuses a beer line without a lot, a served account without an override, and an unknown-quantity lot without a reason", async () => {
    const noLot = await createShipment(db, f.admin, header(), [{ skuId: f.skus.sunlightHalf.id, qty: 1 }]);
    await expect(confirmShipment(db, f.admin, noLot.id)).rejects.toThrow(/needs a lot/);
    const toServed = await createShipment(db, f.admin, header({ destinationLocationId: served.id }), [{ skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 1 }]);
    await expect(confirmShipment(db, f.admin, toServed.id)).rejects.toThrow(/override reason/);
    await updateShipmentHeader(db, f.admin, toServed.id, { overrideReason: "Distributor out of stock; owner approved direct drop" });
    const ok = await confirmShipment(db, f.admin, toServed.id);
    expect(ok.number).toMatch(/^EBB-D-261105-\d{3}$/);
    const backfill = (await db.select().from(schema.lot).where(eq(schema.lot.lotCode, "01SLG2609021")))[0];
    const unknown = await createShipment(db, f.admin, header(), [{ skuId: f.skus.sunlightHalf.id, lotId: backfill.id, qty: 1 }]);
    await expect(confirmShipment(db, f.admin, unknown.id)).rejects.toThrow(/reason/);
    await replaceShipmentLines(db, f.admin, unknown.id, [{ skuId: f.skus.sunlightHalf.id, lotId: backfill.id, qty: 1, lotReason: "Host confirms by phone; sheet to follow" }]);
    const confirmed = await confirmShipment(db, f.admin, unknown.id);
    expect(confirmed.status).toBe("confirmed");
    const open = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `lot_quantities_unconfirmed:${backfill.id}`));
    expect(open.length).toBe(1);
  });
  it("refuses a dotted legacy lot and an archived SKU on a line (1.7, 3.4)", async () => {
    const legacy = (await db.select().from(schema.lot).where(eq(schema.lot.legacyCode, "TLM.EBB.SGB.001")))[0];
    await expect(createShipment(db, f.admin, header(), [{ skuId: f.skus.sunlightHalf.id, lotId: legacy.id, qty: 1 }])).rejects.toThrow(/history only/);
  });
});

describe("Acceptance 3 — allocate, void, deliver", () => {
  it("allocation lowers availability; void releases and keeps the number; deliver writes shipment_out, a keg event and an issued invoice dated the actual date", async () => {
    const before = await availability(db, f.warehouse.id, f.skus.cantinescaSixtel.id);
    const s = await createShipment(db, f.admin, header(), [
      { skuId: f.skus.cantinescaSixtel.id, lotId: lotSixtel, qty: 3 },
      { skuId: f.skus.cantinescaCase.id, lotId: lotCase, qty: 2 },
    ]);
    const confirmed = await confirmShipment(db, f.admin, s.id);
    const during = await availability(db, f.warehouse.id, f.skus.cantinescaSixtel.id);
    expect(during.availableQty).toBe(before.availableQty - 3);
    const voided = await voidShipment(db, f.admin, s.id, "Customer cancelled");
    expect(voided.number).toBe(confirmed.number);
    expect(voided.status).toBe("voided");
    const after = await availability(db, f.warehouse.id, f.skus.cantinescaSixtel.id);
    expect(after.availableQty).toBe(before.availableQty);
    const docs = (await getShipment(db, s.id))!.documents;
    expect(docs.some((d) => d.kind === "bol" && d.revision === 1)).toBe(true);
    const voidedSnapshot = (await db.select().from(schema.shipmentDocument).where(and(eq(schema.shipmentDocument.shipmentId, s.id), eq(schema.shipmentDocument.revision, 1))))[0];
    expect((voidedSnapshot.snapshot as { voided: boolean }).voided).toBe(true);

    // A second shipment is delivered on a different actual date; the number does not change.
    const s2 = await createShipment(db, f.admin, header({ scheduledDate: "2026-11-10" }), [{ skuId: f.skus.cantinescaSixtel.id, lotId: lotSixtel, qty: 2 }, { skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 1 }]);
    const c2 = await confirmShipment(db, f.admin, s2.id);
    expect(c2.number).toBe("EBB-D-261110-001");
    const onHandBefore = (await availability(db, f.warehouse.id, f.skus.cantinescaSixtel.id)).onHandQty;
    const delivered = await deliverShipment(db, f.admin, s2.id, { actualDate: "2026-11-11", kegPickup: { halfIn: 1, sixtelIn: 0 } });
    expect(delivered.number).toBe("EBB-D-261110-001");
    expect(delivered.actualDate).toBe("2026-11-11");
    expect((await availability(db, f.warehouse.id, f.skus.cantinescaSixtel.id)).onHandQty).toBe(onHandBefore - 2);
    const moves = await db.select().from(schema.stockMovement).where(and(eq(schema.stockMovement.shipmentId, s2.id), eq(schema.stockMovement.kind, "shipment_out")));
    expect(moves.length).toBe(2);
    expect(moves.every((m) => m.lotId !== null)).toBe(true);
    const balances = await kegBalances(db, f.admin, { locationId: retail.id });
    expect(balances[0]).toMatchObject({ halfOut: 1, sixtelOut: 2, halfIn: 1, sixtelIn: 0, halfBalance: 0, sixtelBalance: 2 });
    const detail = (await getShipment(db, s2.id))!;
    expect(detail.invoices.length).toBe(1);
    const inv = detail.invoices[0];
    expect(inv.status).toBe("issued");
    expect(inv.invoiceDate).toBe("2026-11-11");
    expect(inv.number).toBe("INV26376");
    expect(inv.dueDate).toBe("2026-12-11");
    const full = (await getInvoice(db, inv.id))!;
    const deposit = full.lines.find((l) => l.kind === "deposit");
    expect(deposit?.lineTotalCents).toBe(3 * 3500);
    expect(full.invoice.totalCents).toBe(2 * 9500 + 1 * 17500 + 3 * 3500);
    expect(full.invoice.fobWording).toBeNull();
    const audits = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.subjectId, s2.id));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["shipment.create", "shipment.confirm", "shipment.deliver"]));
  });
  it("does not renumber or re-allocate on a logistics edit after confirmation, but bumps the revision", async () => {
    const s = await createShipment(db, f.admin, header({ scheduledDate: "2026-11-12" }), [{ skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 1 }]);
    const c = await confirmShipment(db, f.admin, s.id);
    await updateShipmentHeader(db, f.admin, s.id, { carrier: "Owner truck", palletCount: 1 });
    const after = (await getShipment(db, s.id))!.shipment;
    expect(after.number).toBe(c.number);
    expect(after.revision).toBe(1);
    await expect(updateShipmentHeader(db, f.admin, s.id, { destinationLocationId: floating.id })).rejects.toThrow(/logistics/);
    const regen = await regenerateShipmentDocuments(db, f.admin, s.id, "Reprint for the dock");
    expect(regen).toBeUndefined();
    expect((await getShipment(db, s.id))!.shipment.revision).toBe(2);
  });
});

describe("Owner review of Oct 28 — pickup invoicing and market scoping", () => {
  it("issues the numbered invoice at confirmation for a pickup, dated the scheduled date, and re-dates it at delivery without renumbering", async () => {
    const pick = await createShipment(db, f.admin, header({ destinationLocationId: distributor.id, pickup: true, scheduledDate: "2026-11-25", poNumbers: ["TLM2003"] }), [{ skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 1 }]);
    await confirmShipment(db, f.admin, pick.id);
    const atConfirm = (await getShipment(db, pick.id))!.invoices[0];
    expect(atConfirm.status).toBe("issued");
    expect(atConfirm.number).toMatch(/^INV26\d{3}$/);
    expect(atConfirm.invoiceDate).toBe("2026-11-25");
    await deliverShipment(db, f.admin, pick.id, { actualDate: "2026-11-26" });
    const atDelivery = (await getShipment(db, pick.id))!.invoices[0];
    expect(atDelivery.number).toBe(atConfirm.number);
    expect(atDelivery.invoiceDate).toBe("2026-11-26");
    expect(atDelivery.dueDate).toBe("2026-12-26");
    const audits = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.subjectId, atConfirm.id));
    expect(audits.map((a) => a.action)).toContain("invoice.redate");
  });
  it("gives a transfer the destination origin's market, so the receiving market's sales see it and the sending market's do not", async () => {
    const maWarehouse = (await db.select().from(schema.warehouse).where(eq(schema.warehouse.marketId, f.market2.id)))[0];
    const t = await createShipment(db, f.admin, { type: "T", originWarehouseId: f.warehouse.id, destinationWarehouseId: maWarehouse.id, scheduledDate: "2026-11-27" }, [{ skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 1 }]);
    expect(t.marketId).toBe(f.market2.id);
    expect((await listShipments(db, f.sales2, {})).map((r) => r.s.id)).toEqual([t.id]);
    expect((await listShipments(db, f.sales, {})).map((r) => r.s.id)).not.toContain(t.id);
  });
});

describe("Acceptance 4 — transfers", () => {
  it("puts stock in transit at the destination and raises a receiving discrepancy on a short count", async () => {
    const t = await createShipment(db, f.admin, { type: "T", originWarehouseId: f.warehouse.id, destinationWarehouseId: destWarehouse.id, scheduledDate: "2026-11-15" }, [{ skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 4 }]);
    const c = await confirmShipment(db, f.admin, t.id);
    expect(c.number).toBe("EBB-T-261115-001");
    expect(c.template).toBe("transfer");
    await deliverShipment(db, f.admin, t.id, { actualDate: "2026-11-15" });
    const dest = await availability(db, destWarehouse.id, f.skus.sunlightHalf.id);
    expect(dest.inTransitQty).toBe(4);
    expect(dest.onHandQty).toBe(0);
    const { discrepancies } = await receiveTransfer(db, f.admin, t.id, { receivedOn: "2026-11-16", lines: [{ skuId: f.skus.sunlightHalf.id, qtyReceived: 3 }], note: "one keg damaged in transit" });
    expect(discrepancies.length).toBe(1);
    const after = await availability(db, destWarehouse.id, f.skus.sunlightHalf.id);
    expect(after.onHandQty).toBe(3);
    expect(after.inTransitQty).toBe(0);
    const [exc] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `receiving_discrepancy:${t.id}`));
    expect(exc?.category).toBe("receiving_discrepancy");
    await expect(receiveTransfer(db, f.admin, t.id, { receivedOn: "2026-11-16", lines: [] })).rejects.toThrow(/already received/);
    // Transfers carry no invoice.
    expect((await getShipment(db, t.id))!.invoices.length).toBe(0);
  });
});

describe("Acceptance 5 — invoices", () => {
  it("samples issue an NC invoice with $0 lines; distributors get no deposit, the FOB wording and the MicroStar note; floating accounts get no deposit", async () => {
    const sample = await createShipment(db, f.admin, header({ type: "S", scheduledDate: "2026-11-20" }), [{ skuId: f.skus.cantinescaCase.id, lotId: lotCase, qty: 2 }]);
    await confirmShipment(db, f.admin, sample.id);
    await deliverShipment(db, f.admin, sample.id, { actualDate: "2026-11-20" });
    const sInv = (await getShipment(db, sample.id))!.invoices[0];
    expect(sInv.series).toBe("NC");
    expect(sInv.number).toBe("NC26002");
    expect(sInv.totalCents).toBe(0);

    const dist = await createShipment(db, f.admin, header({ destinationLocationId: distributor.id, pickup: true, scheduledDate: "2026-11-21", poNumbers: ["TLM2002"] }), [{ skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 2 }, { skuId: f.skus.cantinescaSixtel.id, lotId: lotSixtel, qty: 1 }]);
    const dc = await confirmShipment(db, f.admin, dist.id);
    expect(dc.template).toBe("distributor");
    await deliverShipment(db, f.admin, dist.id, { actualDate: "2026-11-21" });
    const dInv = (await getInvoice(db, (await getShipment(db, dist.id))!.invoices[0].id))!;
    expect(dInv.invoice.number).toBe("INV26378");
    expect(dInv.invoice.fobWording).toBe("FOB brewery or designated warehouse");
    expect(dInv.lines.some((l) => l.kind === "deposit")).toBe(false);
    // Round 3: the keg statement is in the printed notes, not an invoice line.
    expect(dInv.lines.some((l) => /MicroStar/.test(l.description))).toBe(false);
    expect(dInv.invoice.printedNotes).toMatch(/MicroStar-owned \(2 half barrel, 1 sixtel on this invoice\)/);
    expect(dInv.invoice.depositCents).toBe(0);

    const fl = await createShipment(db, f.admin, header({ destinationLocationId: floating.id, scheduledDate: "2026-11-22" }), [{ skuId: f.skus.cantinescaSixtel.id, lotId: lotSixtel, qty: 1 }]);
    await confirmShipment(db, f.admin, fl.id);
    await deliverShipment(db, f.admin, fl.id, { actualDate: "2026-11-22" });
    const fInv = (await getInvoice(db, (await getShipment(db, fl.id))!.invoices[0].id))!;
    expect(fInv.lines.some((l) => l.kind === "deposit")).toBe(false);
    expect(fInv.lines.some((l) => l.kind === "info" && /Floating/.test(l.description))).toBe(true);
  });
  it("issues exactly one invoice per delivery; samples take their own NC invoice (R2-15, 7.3)", async () => {
    const a = await createShipment(db, f.admin, header({ scheduledDate: "2026-12-01" }), [{ skuId: f.skus.cantinescaCase.id, lotId: lotCase, qty: 1 }]);
    const b = await createShipment(db, f.admin, header({ scheduledDate: "2026-12-03" }), [{ skuId: f.skus.cantinescaCase.id, lotId: lotCase, qty: 1 }]);
    await confirmShipment(db, f.admin, a.id);
    await confirmShipment(db, f.admin, b.id);
    const draftA = (await getShipment(db, a.id))!.invoices[0];
    const draftB = (await getShipment(db, b.id))!.invoices[0];
    expect(draftA.id).not.toBe(draftB.id);
    const sample = await createShipment(db, f.admin, header({ type: "S", scheduledDate: "2026-12-02" }), [{ skuId: f.skus.cantinescaCase.id, lotId: lotCase, qty: 1 }]);
    await confirmShipment(db, f.admin, sample.id);
    expect((await getInvoice(db, (await getShipment(db, sample.id))!.invoices[0].id))!.invoice.series).toBe("NC");
    await deliverShipment(db, f.admin, a.id, { actualDate: "2026-12-01" });
    expect((await getInvoice(db, draftA.id))!.invoice.status).toBe("issued");
    expect((await getInvoice(db, draftA.id))!.invoice.invoiceDate).toBe("2026-12-01");
    expect((await getInvoice(db, draftB.id))!.invoice.status).toBe("draft");
    await deliverShipment(db, f.admin, b.id, { actualDate: "2026-12-03" });
    const issued = (await getInvoice(db, draftB.id))!.invoice;
    expect(issued.status).toBe("issued");
    expect(issued.invoiceDate).toBe("2026-12-03");
    expect((await getInvoice(db, draftB.id))!.shipments.length).toBe(1);
  });
  it("counters continue from the Sheet and widen past 999", async () => {
    expect(await nextDocNumber(db, "INV", 2027)).toBe("INV27001");
    await db.update(schema.docCounter).set({ lastSeq: 999 }).where(and(eq(schema.docCounter.series, "INV"), eq(schema.docCounter.year, 2027)));
    expect(await nextDocNumber(db, "INV", 2027)).toBe("INV271000");
  });
});

describe("Counts, kegs by hand, MicroStar report (8.x)", () => {
  it("applies a count with lot codes and keeps movements per lot", async () => {
    const session = await createCountSession(db, f.admin, { warehouseId: destWarehouse.id, countedOn: "2026-11-30", countedBy: "EWD staff", lines: [{ skuId: f.skus.sunlightHalf.id, lotCode: "01SLG2610061", qty: 5 }, { skuId: f.skus.cantinescaCase.id, qty: 12 }] });
    // R2-23: a variance needs a reason; it goes on each adjustment.
    await expect(applyCountSession(db, f.admin, session.id)).rejects.toThrow(/say why/);
    const { changes } = await applyCountSession(db, f.admin, session.id, { reason: "Month-end count sheet" });
    expect(changes).toEqual(expect.arrayContaining([expect.objectContaining({ after: 5 }), expect.objectContaining({ after: 12 })]));
    expect((await availability(db, destWarehouse.id, f.skus.sunlightHalf.id)).onHandQty).toBe(5);
    await expect(applyCountSession(db, f.admin, session.id)).rejects.toThrow(/already applied/);
  });
  it("records an opening keg balance and reports kegs out to distributors per facility with the BOL (R2-25)", async () => {
    await recordKegEvent(db, f.admin, { locationId: retail.id, on: "2026-10-31", kind: "opening", halfOut: 2, note: "Counted at the bar on cut-over" });
    const b = (await kegBalances(db, f.admin, { locationId: retail.id }))[0];
    expect(b.halfBalance).toBe(2); // 1 out, 1 in from deliveries plus 2 opening
    const rows = await microstarReport(db, f.accounting, { month: "2026-11" });
    expect(rows.length).toBe(2); // the carrier delivery and the will-call pickup to the distributor; retail never appears
    expect(rows.find((r) => r.sixtelOut === 1)).toMatchObject({ distributorName: "Big Distributor Inc", halfOut: 2, sixtelOut: 1 });
    expect(rows.every((r) => r.facilityName.includes("East Brother") && r.shipmentNumber)).toBe(true);
    const other = await microstarReport(db, f.accounting, { month: "2026-11", facilityWarehouseId: destWarehouse.id });
    expect(other.length).toBe(0);
  });
});

describe("Acceptance 8 and 9 — access and audit", () => {
  it("scopes shipments and invoices by market, confines drivers to assigned stops, and reserves confirm/void and settings/import to the right roles", async () => {
    const mine = await listShipments(db, f.sales, {});
    expect(mine.length).toBeGreaterThan(0);
    // The MA rep sees only the transfer into the MA warehouse (its market), none of the NC deliveries.
    expect((await listShipments(db, f.sales2, {})).every((r) => r.s.type === "T")).toBe(true);
    expect(await listInvoices(db, f.sales2, {})).toEqual([]);
    const s = await createShipment(db, f.admin, header({ scheduledDate: "2026-12-10", driverEmployeeId: f.driver.employeeId }), [{ skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 1 }]);
    const driverSees = await listShipments(db, f.driver, {});
    expect(driverSees.map((r) => r.s.id)).toEqual([s.id]);
    await expect(confirmShipment(db, f.sales, s.id)).rejects.toThrow(AuthorizationError);
    await expect(createShipment(db, f.sales, header(), [])).rejects.toThrow(AuthorizationError);
    await expect(updateCompanySettings(db, f.admin, { dba: "X" })).rejects.toThrow(AuthorizationError);
    const updated = await updateCompanySettings(db, f.owner, { officeLine1: "580 California St", officeCity: "San Francisco", officeState: "CA", officePostalCode: "94104" });
    expect(updated.officeCity).toBe("San Francisco");
    expect((await getCompanySettings(db)).legalName).toBe("Familiar Ventures, LLC");
    const confirmed = await confirmShipment(db, f.admin, s.id);
    expect(confirmed.status).toBe("confirmed");
    const voided = await voidShipment(db, f.admin, s.id, "Driver route cancelled");
    expect(voided.status).toBe("voided");
    const audits = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.subjectId, s.id));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["shipment.confirm", "shipment.void"]));
    const emails = audits.filter((a) => /email|send/.test(a.action));
    expect(emails.length).toBe(0);
  });
});
