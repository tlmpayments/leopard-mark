/**
 * The packaging report, batch first (owner test of the preview): the batch decides facility and brand, a blank run
 * takes the next free digit, a taken digit is refused with the next free one named, and the batch list offers only
 * batches in the tank or recently complete. Stock on hand: one grid of SKUs by location from warehouseAvailability.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { stockByLocation, stockGrid } from "@/lib/domain/allocation/onhand";
import { recordTransferDeparture, warehouseAvailability } from "@/lib/domain/allocation/service";
import { addPackagingDay, createBatch, nextFreeRunDigit, packagingBatchOptions, recentLots, recordPackagingReport, recordPackagingReportOutcome, setBatchStatus, skuInBrand } from "@/lib/domain/lots/service";
import { listWarehouses } from "@/lib/domain/markets/service";
import { createOrigin, updateOrigin } from "@/lib/domain/origins/service";
import { createTestDb } from "../support/db";
import { buildFixture, type Fixture } from "../support/fixtures";

let db: Db;
let close: () => Promise<void>;
let f: Fixture;
let beachwood: typeof schema.warehouse.$inferSelect;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
  await updateOrigin(db, f.owner, f.warehouse.id, { originCode: "EBB", kind: "brewery", lotFacilityCode: "01" });
  beachwood = await createOrigin(db, f.owner, { name: "Beachwood", kind: "brewery", marketId: f.market.id, originCode: "BWD", lotFacilityCode: "02" });
});
afterAll(() => close());

describe("packaging report: the batch decides facility and brand", () => {
  it("takes the facility and brand from the batch, whatever the selects still say", async () => {
    const b = await createBatch(db, f.admin, { facilityWarehouseId: beachwood.id, brandCode: "CNT", brewDate: "2026-10-20", barrels: 20, status: "in_progress" });
    // The form still shows East Brother and Sunlight Groove: no refusal, the batch wins.
    const lot = await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", packagingDate: "2026-11-02", runCode: "", batchId: b.id, quantities: [{ skuId: f.skus.cantinescaCase.id, qty: 30 }] });
    expect(lot.lotCode).toBe("02CNT2611021");
    expect(lot.facilityWarehouseId).toBe(beachwood.id);
    expect(lot.brandCode).toBe("CNT");
    expect(lot.batchId).toBe(b.id);
    // Packaged units went on hand at the batch's brewery, not the facility the select showed.
    const bwd = await warehouseAvailability(db, beachwood.id);
    expect(bwd.find((r) => r.skuId === f.skus.cantinescaCase.id)?.onHandQty).toBe(30);
  });

  it("needs no facility or brand at all when the batch is given; the same batch again adds a day to its lot", async () => {
    const b = await createBatch(db, f.admin, { facilityWarehouseId: beachwood.id, brandCode: "SLG", brewDate: "2026-10-22", barrels: 15, status: "in_progress" });
    const first = await recordPackagingReportOutcome(db, f.admin, { packagingDate: "2026-11-03", batchId: b.id, quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 10 }] });
    expect(first.addedDay).toBe(false);
    expect(first.lot.lotCode).toBe("02SLG2611031");
    const again = await recordPackagingReportOutcome(db, f.admin, { packagingDate: "2026-11-04", runCode: "1", batchId: b.id, quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 4 }] });
    expect(again.addedDay).toBe(true);
    expect(again.lot.id).toBe(first.lot.id);
  });

  it("without a batch, the facility and brand are required", async () => {
    await expect(recordPackagingReport(db, f.admin, { brandCode: "CNT", packagingDate: "2026-11-02", quantities: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] })).rejects.toThrow(/facility/);
    await expect(recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, packagingDate: "2026-11-02", quantities: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] })).rejects.toThrow(/brand/);
  });
});

describe("packaging report: run digit", () => {
  it("a blank run takes the next free digit for facility, brand and date", async () => {
    const one = await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", packagingDate: "2026-10-28", runCode: "1", quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 5 }] });
    expect(one.lotCode).toBe("01SLG2610281");
    expect(await nextFreeRunDigit(db, "01", "SLG", "2026-10-28")).toBe("2");
    const two = await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", packagingDate: "2026-10-28", runCode: "", quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 5 }] });
    expect(two.lotCode).toBe("01SLG2610282");
    expect(two.runCode).toBe("2");
    const three = await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", packagingDate: "2026-10-28", quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 5 }] });
    expect(three.lotCode).toBe("01SLG2610283");
    // Another brand or another day starts at 1 again.
    const other = await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", packagingDate: "2026-10-28", runCode: "auto", quantities: [{ skuId: f.skus.cantinescaCase.id, qty: 5 }] });
    expect(other.lotCode).toBe("01CNT2610281");
  });

  it("a typed digit that is taken is refused, naming the lot and the next free digit", async () => {
    // 01SLG261028 runs 1, 2 and 3 exist from the test above.
    await expect(recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", packagingDate: "2026-10-28", runCode: "1", quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 1 }] })).rejects.toThrow(
      "Run 1 is taken: lot 01SLG2610281 already exists. Use run 4, or leave Run blank for the next free digit",
    );
    // A batch with no lot yet whose typed digit collides is refused the same way (the batch would make a new lot).
    const b = await createBatch(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", brewDate: "2026-10-10", status: "in_progress" });
    await expect(recordPackagingReport(db, f.admin, { packagingDate: "2026-10-28", runCode: "2", batchId: b.id, quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 1 }] })).rejects.toThrow(/Run 2 is taken: lot 01SLG2610282 already exists\. Use run 4/);
    const lot = await recordPackagingReport(db, f.admin, { packagingDate: "2026-10-28", runCode: "4", batchId: b.id, quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 1 }] });
    expect(lot.lotCode).toBe("01SLG2610284");
  });

  it("when runs 1 to 9 are all taken, a blank run says so", async () => {
    for (let i = 1; i <= 9; i++) await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", packagingDate: "2026-09-30", runCode: String(i), quantities: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] });
    expect(await nextFreeRunDigit(db, "01", "CNT", "2026-09-30")).toBeNull();
    await expect(recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", packagingDate: "2026-09-30", quantities: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] })).rejects.toThrow(/Runs 1 to 9 are all taken/);
  });
});

describe("packaging report: the batch list", () => {
  it("offers batches in progress or complete, newest brew first, packaged ones with their lot, and drops old history", async () => {
    const scheduled = await createBatch(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", brewDate: "2026-11-01", status: "scheduled" });
    const destroyed = await createBatch(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", brewDate: "2026-10-30", status: "in_progress" });
    await setBatchStatus(db, f.admin, destroyed.id, "destroyed", "infected", "2026-10-31");
    const undated = await createBatch(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", status: "in_progress" });
    const oldPackaged = await createBatch(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", brewDate: "2026-07-01", status: "in_progress" });
    const oldLot = await recordPackagingReport(db, f.admin, { packagingDate: "2026-07-20", batchId: oldPackaged.id, quantities: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] });
    const oldComplete = await createBatch(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", brewDate: "2026-01-05", status: "complete" });

    const now = await packagingBatchOptions(db, { today: "2026-11-04" });
    const ids = now.map((o) => o.batch.id);
    expect(ids).not.toContain(scheduled.id);
    expect(ids).not.toContain(destroyed.id);
    expect(ids).not.toContain(oldPackaged.id); // last packaged Jul 20, more than 60 days ago
    expect(ids).not.toContain(oldComplete.id); // complete, never linked to a lot, long ago
    expect(now.every((o) => o.batch.status === "in_progress" || o.batch.status === "complete")).toBe(true);
    // Newest brew date first; a batch with no brew date last.
    const dates = now.map((o) => o.batch.brewDate);
    expect(dates.at(-1)).toBeNull();
    expect(ids.at(-1)).toBe(undated.id);
    const dated = dates.filter((x): x is string => x !== null);
    expect([...dated].sort().reverse()).toEqual(dated);
    // The Beachwood CNT batch from above was packaged on Nov 2: listed with its lot.
    const bwd = now.find((o) => o.lot?.lotCode === "02CNT2611021");
    expect(bwd?.batch.facilityWarehouseId).toBe(beachwood.id);
    expect(bwd?.lot?.lastPackagedOn).toBe("2026-11-02");

    // Earlier in the year the old batch was still recent; a later packaging day brings it back.
    expect((await packagingBatchOptions(db, { today: "2026-08-15" })).find((o) => o.batch.id === oldPackaged.id)?.lot?.lotCode).toBe(oldLot.lotCode);
    await addPackagingDay(db, f.admin, oldLot.id, { packagedOn: "2026-09-20", quantities: [{ skuId: f.skus.cantinescaCase.id, qty: 1 }] });
    expect((await packagingBatchOptions(db, { today: "2026-11-04" })).find((o) => o.batch.id === oldPackaged.id)?.lot?.lastPackagedOn).toBe("2026-09-20");
  });

  it("a SKU belongs to a brand by its code, or by the brand's name when the code carries another prefix", () => {
    expect(skuInBrand({ code: "CNT12C0001", brand: "Cantinesca" }, "CNT")).toBe(true);
    expect(skuInBrand({ code: "SGB-HALF", brand: "Sunlight Groove" }, "SLG")).toBe(true);
    expect(skuInBrand({ code: "CAN-12C", brand: "Cantinesca" }, "CNT")).toBe(true);
    expect(skuInBrand({ code: "CAN-12C", brand: "Cantinesca" }, "SLG")).toBe(false);
  });
});

describe("stock on hand", () => {
  it("lays every location with a stock position across, SKUs down, from warehouseAvailability", async () => {
    const [ja] = (await listWarehouses(db, f.market2.id)).filter((w) => w.name.startsWith("Jack's Abby"));
    const ebBefore = (await warehouseAvailability(db, f.warehouse.id)).find((r) => r.skuId === f.skus.sunlightCase.id)!;
    await recordTransferDeparture(db, f.admin, { fromWarehouseId: f.warehouse.id, toWarehouseId: ja.id, skuId: f.skus.sunlightCase.id, qty: 5, evidence: "test transfer" });
    const all = await listWarehouses(db);
    const locations = await stockByLocation(db, all);
    // Every location listed has a position; Jack's Abby now does (5 in transit).
    expect(locations.map((l) => l.warehouse.id)).toEqual(expect.arrayContaining([f.warehouse.id, beachwood.id, ja.id]));
    const grid = stockGrid([f.skus.sunlightCase, f.skus.cantinescaSixtel], locations);
    const at = (skuId: string, warehouseId: string) => grid.find((r) => r.sku.id === skuId)!.cells[locations.findIndex((l) => l.warehouse.id === warehouseId)];
    expect(at(f.skus.sunlightCase.id, f.warehouse.id)?.onHandQty).toBe(ebBefore.onHandQty - 5);
    expect(at(f.skus.sunlightCase.id, ja.id)).toMatchObject({ availableQty: 0, onHandQty: 0, inTransitQty: 5 });
    // Nothing of the sixtel at Beachwood: a blank cell, not zeros.
    expect(at(f.skus.cantinescaSixtel.id, beachwood.id)).toBeNull();
    // The total is the sum of the locations shown, and available matches the per-warehouse computation.
    const row = grid.find((r) => r.sku.id === f.skus.sunlightCase.id)!;
    const perWarehouse = await Promise.all(locations.map((l) => warehouseAvailability(db, l.warehouse.id)));
    const expected = perWarehouse.flat().filter((r) => r.skuId === f.skus.sunlightCase.id).reduce((s, r) => s + r.availableQty, 0);
    expect(row.total?.availableQty).toBe(expected);
    expect(row.total?.inTransitQty).toBe(5);
  });

  it("recent lots carry their packaged quantities, newest first, and narrow to the facilities given", async () => {
    const lots = await recentLots(db, { facilityWarehouseIds: [beachwood.id] });
    expect(lots.map((l) => l.lot.lotCode)).toEqual(["02SLG2611031", "02CNT2611021"]);
    expect(lots[1].quantities).toEqual([expect.objectContaining({ code: f.skus.cantinescaCase.code, qty: 30 })]);
    expect(await recentLots(db, { facilityWarehouseIds: [] })).toEqual([]);
    const lot = (await db.select().from(schema.lot).where(eq(schema.lot.lotCode, "02SLG2611031")))[0];
    expect(lots[0].quantities[0].qty).toBe(14); // two packaging days on the same lot
    expect(lot.packagingDate).toBe("2026-11-03");
  });
});
