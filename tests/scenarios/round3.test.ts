/**
 * Round 3 (Oct 29): distributor vs retail price tiers, pass-through freight (lane per pallet plus fuel, or fixed per
 * unit), the distributor keg statement in the notes, order cutoffs and delivery days, changes after the cutoff,
 * the second-delivery payment warning, overdue and stock-aging sweeps, POS charged and cost-tracked, account spend,
 * and the weekly count cadence.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { SYSTEM_ACTOR } from "@/lib/authz/actor";
import { currentPrice, setMarketPrice } from "@/lib/domain/catalog/service";
import { sweepOriginStockAging, sweepOverdueInvoices } from "@/lib/domain/alerts/service";
import { countCadence } from "@/lib/domain/counts/service";
import { accountSpend } from "@/lib/domain/customers/spend";
import { updateAccountShipping } from "@/lib/domain/customers/shipping";
import { changeDeadline, cutoffHint, nextShipDate } from "@/lib/domain/cutoff/service";
import { buildInvoiceSnapshot, fuelSurchargeCents, getInvoice, laneFreight, markInvoicePaid, palletsForLines, renderInvoiceNotes } from "@/lib/domain/invoices/service";
import { recordPackagingReport } from "@/lib/domain/lots/service";
import { adminAmendQuantity, getOrder, submitOrder } from "@/lib/domain/orders/service";
import { updateOrigin } from "@/lib/domain/origins/service";
import { FREIGHT_LANES, getCompanySettings, upsertFreightLane, upsertPosItem } from "@/lib/domain/settings/service";
import { confirmShipment, createShipment, deliverShipment, getShipment } from "@/lib/domain/shipments/service";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

let db: Db;
let close: () => Promise<void>;
let f: Fixture;
let lot: string;
let hdi: typeof schema.customerLocation.$inferSelect;
let mart: typeof schema.customerLocation.$inferSelect;
let bar: typeof schema.customerLocation.$inferSelect;

const CT = FREIGHT_LANES.find((l) => l.code === "CT")!;
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
  await updateOrigin(db, f.owner, f.warehouse.id, { originCode: "EBB", kind: "brewery", lotFacilityCode: "01" });
  // Pallet sizes from the item forms: 8 halves, 20 sixtels, 100 cases a pallet.
  await db.update(schema.sku).set({ palletFraction: "0.1250" }).where(eq(schema.sku.id, f.skus.sunlightHalf.id));
  await db.update(schema.sku).set({ palletFraction: "0.0500" }).where(eq(schema.sku.id, f.skus.cantinescaSixtel.id));
  await db.update(schema.sku).set({ palletFraction: "0.0100" }).where(eq(schema.sku.id, f.skus.cantinescaCase.id));
  const l = await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", packagingDate: "2026-10-07", runCode: "1", quantities: [{ skuId: f.skus.cantinescaSixtel.id, qty: 60 }, { skuId: f.skus.cantinescaCase.id, qty: 600 }, { skuId: f.skus.sunlightHalf.id, qty: 30 }] });
  lot = l.id;
  hdi = (await makeLocation(db, f.sales, f.market.id, "Hartford Test Distributors")).location;
  await updateAccountShipping(db, f.admin, hdi.id, { kind: "distributor", depositMode: "none" });
  mart = (await makeLocation(db, f.sales, f.market.id, "Quality Test Beverage")).location;
  await updateAccountShipping(db, f.admin, mart.id, { kind: "distributor", depositMode: "none" });
  bar = (await makeLocation(db, f.sales, f.market.id, "Round Three Bar")).location;
  for (const [skuId, cents] of [
    [f.skus.cantinescaCase.id, 1800],
    [f.skus.cantinescaSixtel.id, 3750],
    [f.skus.sunlightHalf.id, 10000],
  ] as const) {
    await setMarketPrice(db, f.admin, { marketId: f.market.id, skuId, tier: "distributor", priceCents: cents });
  }
});
afterAll(() => close());

describe("Freight math from the rate chart (R2-52)", () => {
  it("one pallet pays the minimum, 2 to 4 and 5 to 8 pay per pallet, 9 or more is a truckload; fuel is 43% of freight", () => {
    expect(laneFreight(0, CT)).toBeNull();
    expect(laneFreight(1, CT)!.totalCents).toBe(8900);
    expect(laneFreight(4, CT)!.totalCents).toBe(31200);
    expect(laneFreight(6, CT)!.totalCents).toBe(6 * 7200);
    expect(laneFreight(9, CT)!.totalCents).toBe(67500);
    // INV26351: 4 pallets at $78.00 = $312.00, 43% fuel = $134.16.
    expect(fuelSurchargeCents(31200, 43)).toBe(13416);
  });
  it("pallets come from the item-form sizes: 200 cases, 20 sixtels and 8 halves are the invoice's 4 pallets", () => {
    expect(palletsForLines([{ qty: 200, palletFraction: "0.01" }, { qty: 20, palletFraction: "0.05" }, { qty: 8, palletFraction: "0.125" }], null)).toBe(4);
    expect(palletsForLines([{ qty: 21, palletFraction: "0.05" }], null)).toBe(2);
    expect(palletsForLines([{ qty: 3, palletFraction: null }], null)).toBe(1);
    expect(palletsForLines([{ qty: 3, palletFraction: "0.05" }], 6)).toBe(6);
  });
  it("seeds the CT and Eastern MA lanes and the 43% default", async () => {
    const s = await getCompanySettings(db);
    expect(Number(s.fuelSurchargePct)).toBe(43);
    const lanes = await db.select().from(schema.freightLane);
    expect(lanes.map((l) => l.code).sort()).toEqual(["CT", "MA-EAST"]);
    await expect(upsertFreightLane(db, f.sales, { code: "XX", name: "x", minCents: 1, tier2to4Cents: 1, tier5to8Cents: 1, truckloadCents: 1 })).rejects.toThrow();
  });
});

describe("Price tiers (R2-41)", () => {
  it("a distributor is priced at the distributor tier and never falls back to retail", async () => {
    expect((await currentPrice(db, f.market.id, f.skus.cantinescaCase.id, new Date(), "distributor"))!.priceCents).toBe(1800);
    expect((await currentPrice(db, f.market.id, f.skus.cantinescaCase.id, new Date(), "retail"))!.priceCents).toBe(3600);
    const res = await submitOrder(db, f.admin, { locationId: hdi.id, source: "email", lines: [{ skuId: f.skus.cantinescaCase.id, qty: 2 }] });
    const ord = (await getOrder(db, res.order.id))!;
    expect(ord.lines[0].unitPriceCentsAtSubmission).toBe(1800);
    await expect(submitOrder(db, f.admin, { locationId: hdi.id, source: "email", lines: [{ skuId: f.skus.sunlightCase.id, qty: 1 }] })).rejects.toThrow(/no distributor price/);
  });
});

describe("Distributor invoices: lane freight, per-unit freight, notes", () => {
  it("lane freight: product, freight and a 43% fuel line; the keg statement sits in the notes, not a line", async () => {
    await updateAccountShipping(db, f.admin, hdi.id, { freightMode: "lane", freightLaneCode: "CT", invoiceNotes: "Pricing is FOB brewery or designated warehouse per the Connecticut price posting.\nKegs: no keg deposit is charged." });
    const s = await createShipment(db, f.admin, { type: "D", originWarehouseId: f.warehouse.id, destinationLocationId: hdi.id, scheduledDate: "2026-11-12" }, [
      { skuId: f.skus.cantinescaCase.id, lotId: lot, qty: 200 },
      { skuId: f.skus.cantinescaSixtel.id, lotId: lot, qty: 20 },
      { skuId: f.skus.sunlightHalf.id, lotId: lot, qty: 8 },
    ]);
    await confirmShipment(db, f.admin, s.id);
    await deliverShipment(db, f.admin, s.id, { actualDate: "2026-11-12" });
    const inv = (await getInvoice(db, (await getShipment(db, s.id))!.invoices[0].id))!;
    expect(inv.invoice.subtotalCents).toBe(200 * 1800 + 20 * 3750 + 8 * 10000);
    expect(inv.invoice.freightCents).toBe(31200 + 13416);
    expect(inv.invoice.depositCents).toBe(0);
    expect(inv.invoice.totalCents).toBe(515000 + 44616);
    const freight = inv.lines.filter((l) => l.kind === "freight");
    expect(freight.map((l) => l.lineTotalCents)).toEqual([31200, 13416]);
    expect(freight[1].description).toMatch(/43% of freight/);
    expect(inv.lines.some((l) => l.kind === "info" || l.kind === "deposit")).toBe(false);
    // The account's notes mention kegs, so no second keg statement is added.
    expect(inv.invoice.printedNotes).toBe("Pricing is FOB brewery or designated warehouse per the Connecticut price posting.\nKegs: no keg deposit is charged.");
  });

  it("per-unit freight (Martignetti): fixed charge per unit, fuel included, and a case below the 5-pallet minimum", async () => {
    await updateAccountShipping(db, f.admin, mart.id, { freightMode: "per_unit", freightPerUnit: { keg_half: 1100, keg_sixtel: 500, case_12oz_can: 100 }, freightMinPallets: 5 });
    const s = await createShipment(db, f.admin, { type: "D", originWarehouseId: f.warehouse.id, destinationLocationId: mart.id, scheduledDate: "2026-11-13" }, [
      { skuId: f.skus.cantinescaCase.id, lotId: lot, qty: 100 },
      { skuId: f.skus.cantinescaSixtel.id, lotId: lot, qty: 10 },
    ]);
    await confirmShipment(db, f.admin, s.id);
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `freight_below_minimum:${s.id}`));
    expect(c?.category).toBe("freight_below_minimum");
    await deliverShipment(db, f.admin, s.id, { actualDate: "2026-11-13" });
    const inv = (await getInvoice(db, (await getShipment(db, s.id))!.invoices[0].id))!;
    expect(inv.invoice.freightCents).toBe(100 * 100 + 10 * 500);
    expect(inv.lines.filter((l) => l.kind === "freight").every((l) => /fuel included/.test(l.description))).toBe(true);
    expect(inv.lines.some((l) => /Fuel surcharge/.test(l.description))).toBe(false);
    // No notes of its own mentioning kegs: the standard MicroStar statement is added to the notes.
    expect(inv.invoice.printedNotes).toMatch(/MicroStar-owned \(0 half barrel, 10 sixtel on this invoice\)/);
  });

  it("the price posting date on the notes is the first of the invoice's month", async () => {
    expect(renderInvoiceNotes("Price posting effective {posting_date}.", "2026-11-12")).toBe("Price posting effective 11/01/2026.");
    expect(renderInvoiceNotes("Posting {posting_date}", null, at("2027-01-15T20:00:00Z"))).toBe("Posting 01/01/2027");
    await updateAccountShipping(db, f.admin, hdi.id, { invoiceNotes: "Pricing is FOB brewery or designated warehouse per the Connecticut price posting effective {posting_date}.\nKegs: no keg deposit is charged." });
    const s = await createShipment(db, f.admin, { type: "D", originWarehouseId: f.warehouse.id, destinationLocationId: hdi.id, scheduledDate: "2026-12-03" }, [{ skuId: f.skus.cantinescaCase.id, lotId: lot, qty: 10 }]);
    await confirmShipment(db, f.admin, s.id);
    await deliverShipment(db, f.admin, s.id, { actualDate: "2026-12-03" });
    const invId = (await getShipment(db, s.id))!.invoices[0].id;
    const snap = await buildInvoiceSnapshot(db, invId, "test");
    expect(snap.printedNotes?.[0]).toBe("Pricing is FOB brewery or designated warehouse per the Connecticut price posting effective 12/01/2026.");
  });

  it("validates freight settings on the account", async () => {
    await expect(updateAccountShipping(db, f.admin, bar.id, { freightMode: "lane", freightLaneCode: "NOPE" })).rejects.toThrow(/not found/);
    await expect(updateAccountShipping(db, f.admin, bar.id, { freightMode: "per_unit", freightPerUnit: null })).rejects.toThrow(/per-unit/);
  });
});

describe("Cutoffs and delivery days", () => {
  const wla = { orderCutoff: "14:30", leadDays: 1, deliveryDays: ["Wed", "Thu"], timezone: "America/Los_Angeles", originCode: "WLA", name: "Balmuth & Co." };
  it("next ship date: lead days, one more after the cutoff, then the next delivery day", () => {
    // Mon Nov 2 10:00 Pacific: Tuesday is not a delivery day, so Wednesday.
    expect(nextShipDate(wla, at("2026-11-02T18:00:00Z"))).toBe("2026-11-04");
    // Tue Nov 3 15:00 Pacific, after 2:30: two days out is Thursday.
    expect(nextShipDate(wla, at("2026-11-03T23:00:00Z"))).toBe("2026-11-05");
    // No delivery days set: weekdays only. Friday after the cutoff goes to Monday.
    expect(nextShipDate({ ...wla, deliveryDays: null }, at("2026-11-06T23:30:00Z"))).toBe("2026-11-09");
    expect(cutoffHint(wla, at("2026-11-02T18:00:00Z"))).toMatch(/WLA can ship next on Wed, Nov 4\. Order by 2:30 p\.m\. Pacific the day before\. Delivers Wed, Thu\./);
  });
  it("changes close at the cutoff the day before the ship date", () => {
    expect(changeDeadline(wla, "2026-11-05", at("2026-11-04T21:00:00Z"))).toEqual({ date: "2026-11-04", time: "14:30", passed: false });
    expect(changeDeadline(wla, "2026-11-05", at("2026-11-04T23:00:00Z")).passed).toBe(true); // 3 p.m. PST
    expect(changeDeadline(wla, "2026-11-05", at("2026-11-05T16:00:00Z")).passed).toBe(true);
  });
  it("an amendment after the cutoff is applied and logged as an exception", async () => {
    await updateOrigin(db, f.owner, f.warehouse.id, { orderCutoff: "14:30", leadDays: 1, deliveryDays: ["Wed", "Thu"] });
    const res = await submitOrder(db, f.admin, { locationId: bar.id, source: "phone", requestedDate: "2026-01-08", lines: [{ skuId: f.skus.cantinescaSixtel.id, qty: 2 }] });
    const ord = (await getOrder(db, res.order.id))!;
    await adminAmendQuantity(db, f.admin, ord.lines[0].id, 3, "customer called");
    const [c] = await db.select().from(schema.exceptionCase).where(and(eq(schema.exceptionCase.category, "order_change_after_cutoff"), eq(schema.exceptionCase.locationId, bar.id)));
    expect(c?.title).toMatch(/changed after the cutoff/);
    expect((await getOrder(db, res.order.id))!.lines[0].currentQty).toBe(3);
  });
});

describe("Warnings and sweeps", () => {
  it("a retail account's second delivery without a payment channel opens a case; distributors are exempt", async () => {
    const first = await createShipment(db, f.admin, { type: "D", originWarehouseId: f.warehouse.id, destinationLocationId: bar.id, scheduledDate: "2026-11-16" }, [{ skuId: f.skus.cantinescaCase.id, lotId: lot, qty: 4 }]);
    await confirmShipment(db, f.admin, first.id);
    await deliverShipment(db, f.admin, first.id, { actualDate: "2026-11-16" });
    expect((await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `payment_setup_missing:${bar.id}`))).length).toBe(0);
    const second = await createShipment(db, f.admin, { type: "D", originWarehouseId: f.warehouse.id, destinationLocationId: bar.id, scheduledDate: "2026-11-18" }, [{ skuId: f.skus.cantinescaCase.id, lotId: lot, qty: 4 }]);
    await confirmShipment(db, f.admin, second.id);
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `payment_setup_missing:${bar.id}`));
    expect(c?.category).toBe("payment_setup_missing");
    expect((await getShipment(db, second.id))!.shipment.status).toBe("confirmed"); // warn only
  });

  it("overdue: a distributor with any overdue invoice, a retail account only at $500 or more; paying resolves it", async () => {
    const r1 = await sweepOverdueInvoices(db, SYSTEM_ACTOR, at("2027-03-01T20:00:00Z"));
    const cases = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.category, "collections_overdue"));
    const locs = new Set(cases.filter((c) => c.state !== "resolved").map((c) => c.locationId));
    expect(locs.has(hdi.id)).toBe(true); // $5,596-style distributor invoice, any amount
    expect(locs.has(mart.id)).toBe(true);
    expect(locs.has(bar.id)).toBe(false); // 4 cases at $36 = $144, under the threshold
    expect(r1.opened).toBeGreaterThanOrEqual(2);
    const martInvoices = await db.select().from(schema.invoice).where(and(eq(schema.invoice.locationId, mart.id), eq(schema.invoice.status, "issued")));
    for (const i of martInvoices) await markInvoicePaid(db, f.accounting, i.id, "EFT received");
    const r2 = await sweepOverdueInvoices(db, SYSTEM_ACTOR, at("2027-03-01T20:00:00Z"));
    expect(r2.resolved).toBe(1);
  });

  it("stock aging: a lot at an origin with a 10-day limit opens a case from day 7", async () => {
    await updateOrigin(db, f.owner, f.warehouse.id, { maxDaysOnHand: 10 });
    expect((await sweepOriginStockAging(db, SYSTEM_ACTOR, at("2026-10-13T20:00:00Z"))).opened).toBe(0); // day 6
    const r = await sweepOriginStockAging(db, SYSTEM_ACTOR, at("2026-10-14T20:00:00Z")); // day 7
    expect(r.opened).toBe(1);
    const [c] = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.dedupeKey, `origin_stock_aging:${f.warehouse.id}:${lot}`));
    expect(c.title).toMatch(/near its 10-day limit/);
    expect(c.cause).toMatch(/must leave by 2026-10-17/);
    await updateOrigin(db, f.owner, f.warehouse.id, { maxDaysOnHand: null });
    expect((await sweepOriginStockAging(db, SYSTEM_ACTOR, at("2026-10-14T20:00:00Z"))).resolved).toBe(1);
  });
});

describe("POS charged and cost-tracked; account spend; weekly counts", () => {
  it("a priced POS item is charged on the invoice and its cost counts as spend, with sample beer at SKU cost", async () => {
    const pos = await upsertPosItem(db, f.admin, { code: "TAPHANDLE-STD", name: "Tap handle, standard", priceCents: 2500, unitCostCents: 1200 });
    await db.update(schema.sku).set({ unitCostCents: 900 }).where(eq(schema.sku.id, f.skus.cantinescaCase.id));
    const d = await createShipment(db, f.admin, { type: "D", originWarehouseId: f.warehouse.id, destinationLocationId: bar.id, scheduledDate: "2026-11-19" }, [
      { skuId: f.skus.cantinescaCase.id, lotId: lot, qty: 1 },
      { posItemId: pos.id, qty: 2 },
    ]);
    await confirmShipment(db, f.admin, d.id);
    await deliverShipment(db, f.admin, d.id, { actualDate: "2026-11-19" });
    const inv = (await getInvoice(db, (await getShipment(db, d.id))!.invoices[0].id))!;
    const posLine = inv.lines.find((l) => l.kind === "pos")!;
    expect(posLine.lineTotalCents).toBe(5000);
    const sample = await createShipment(db, f.admin, { type: "S", originWarehouseId: f.warehouse.id, destinationLocationId: bar.id, scheduledDate: "2026-11-20" }, [{ skuId: f.skus.cantinescaCase.id, lotId: lot, qty: 3 }]);
    await confirmShipment(db, f.admin, sample.id);
    const spend = await accountSpend(db, bar.id);
    expect(spend.posCostCents).toBe(2400);
    expect(spend.sampleCostCents).toBe(2700);
    expect(spend.totalCents).toBe(5100);
  });

  it("every origin with a code is due a count every 7 days", async () => {
    const rows = await countCadence(db, "2026-11-01");
    const ebb = rows.find((r) => r.warehouse.id === f.warehouse.id)!;
    expect(ebb.lastCountedOn).toBeNull();
    expect(ebb.overdue).toBe(true);
  });
});
