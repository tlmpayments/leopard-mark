import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/types";
import { adminAmendQuantity, submitOrder } from "@/lib/domain/orders/service";
import { updateOrigin } from "@/lib/domain/origins/service";
import { recordPackagingReport } from "@/lib/domain/lots/service";
import { getShipment } from "@/lib/domain/shipments/service";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

let db: Db;
let close: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
  await updateOrigin(db, f.owner, f.warehouse.id, { originCode: "EBB", kind: "brewery", lotFacilityCode: "01" });
  await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", packagingDate: "2026-10-07", runCode: "1", quantities: [{ skuId: f.skus.cantinescaCase.id, qty: 10 }] });
});
afterAll(() => close());

describe("R2-1: the draft shipment follows an amendment", () => {
  it("amending an open order's quantity resizes the draft shipment line", async () => {
    const loc = (await makeLocation(db, f.sales, f.market.id, "Amend Bar")).location;
    const res = await submitOrder(db, f.admin, { locationId: loc.id, source: "phone", lines: [{ skuId: f.skus.cantinescaCase.id, qty: 2 }] });
    expect((await getShipment(db, res.shipment!.id))!.lines[0].line.qty).toBe(2);
    await adminAmendQuantity(db, f.admin, res.lines[0].id, 4, "buyer wants more");
    expect((await getShipment(db, res.shipment!.id))!.lines[0].line.qty).toBe(4);
    await adminAmendQuantity(db, f.admin, res.lines[0].id, 1, "buyer wants less");
    expect((await getShipment(db, res.shipment!.id))!.lines[0].line.qty).toBe(1);
  });
});
