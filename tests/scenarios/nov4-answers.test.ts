/**
 * Owner, Nov 4 2026: each host brewery is recorded as an alternating proprietorship or contract brewed; Prost
 * (Colorado) is added; Round Table (limited New York production) has no market and is never a default; Connecticut
 * distributors are served from Radford; invoices print ar@ for billing and orders@ for reorders, shipment documents
 * print operations@; EFT is a way to pay. Covers the service rules and replays the data part of migration 0009.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { setMarketPrice } from "@/lib/domain/catalog/service";
import { setWarehouseOverride } from "@/lib/domain/customers/service";
import { updateAccountShipping } from "@/lib/domain/customers/shipping";
import { createMarket } from "@/lib/domain/markets/service";
import { submitOrder } from "@/lib/domain/orders/service";
import { createOrigin, originByCode, updateOrigin } from "@/lib/domain/origins/service";
import { getCompanySettings, updateCompanySettings } from "@/lib/domain/settings/service";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

let db: Db;
let close: () => Promise<void>;
let f: Fixture;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  f = await buildFixture(db);
});

afterAll(async () => {
  await close();
});

/** The data statements of 0009 (everything after the schema change), run against the fixture database. */
async function replay0009() {
  const file = readFileSync(path.join(process.cwd(), "drizzle/0009_origins_and_settings.sql"), "utf8");
  const statements = file
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s && !/^(CREATE TYPE|ALTER TYPE|ALTER TABLE)/.test(s));
  expect(statements.length).toBe(13);
  for (const s of statements) await db.execute(sql.raw(s));
}

describe("production arrangement on origins", () => {
  it("is set on breweries and refused on warehouses", async () => {
    const brewery = await createOrigin(db, f.owner, { name: "Test Host", kind: "brewery", originCode: "TSH", lotFacilityCode: "41", productionArrangement: "contract" });
    expect(brewery.productionArrangement).toBe("contract");
    const changed = await updateOrigin(db, f.owner, brewery.id, { productionArrangement: "alternating_proprietorship" });
    expect(changed.productionArrangement).toBe("alternating_proprietorship");
    // Turning it into a warehouse while it still carries an arrangement is refused.
    await expect(updateOrigin(db, f.owner, brewery.id, { kind: "warehouse" })).rejects.toThrow(/Only a brewery/);
    const cleared = await updateOrigin(db, f.owner, brewery.id, { kind: "warehouse", productionArrangement: null });
    expect(cleared.productionArrangement).toBeNull();

    const warehouse = await createOrigin(db, f.owner, { name: "Test Cold Store", kind: "warehouse", originCode: "TCS" });
    expect(warehouse.productionArrangement).toBeNull();
    await expect(updateOrigin(db, f.owner, warehouse.id, { productionArrangement: "contract" })).rejects.toThrow(/Only a brewery/);
    await expect(createOrigin(db, f.owner, { name: "Bad", kind: "warehouse", originCode: "BAD", productionArrangement: "contract" })).rejects.toThrow(/Only a brewery/);
  });

  it("takes the confirmed arrangement from a known brewery code unless one is given", async () => {
    const ale = await createOrigin(db, f.owner, { name: "AleSmith Brewing", kind: "brewery", originCode: "ALE", lotFacilityCode: "05" });
    expect(ale.productionArrangement).toBe("contract");
    const bwd = await createOrigin(db, f.owner, { name: "Beachwood Brewing", kind: "brewery", originCode: "BWD", lotFacilityCode: "02" });
    expect(bwd.productionArrangement).toBe("alternating_proprietorship");
    const unknown = await createOrigin(db, f.owner, { name: "Unknown Host", kind: "brewery", originCode: "UNK", lotFacilityCode: "42" });
    expect(unknown.productionArrangement).toBeNull();
  });
});

describe("migration 0009 data", () => {
  it("records arrangements, adds Prost, frees Round Table and points Connecticut distributors at Radford", async () => {
    const ct = await createMarket(db, f.owner, { code: "CT", name: "Connecticut" });
    const rad = await createOrigin(db, f.owner, { name: "Radford Warehouse", kind: "warehouse", marketId: f.market2.id, originCode: "RAD" });
    // As production has them today: Round Table under Connecticut, nothing recorded.
    const rtb = await createOrigin(db, f.owner, { name: "Round Table Brewing", kind: "brewery", marketId: ct.id, originCode: "RTB", lotFacilityCode: "04", isPrimary: true, productionArrangement: null });
    const jab = await createOrigin(db, f.owner, { name: "Jack's Abby Brewing", kind: "brewery", marketId: f.market2.id, originCode: "JAB", lotFacilityCode: "06", productionArrangement: null });
    const rea = await createOrigin(db, f.owner, { name: "Real Ale Brewing", kind: "brewery", originCode: "REA", lotFacilityCode: "07", productionArrangement: null });

    const hdi = (await makeLocation(db, f.owner, ct.id, "Hartford Test Distributors")).location;
    await updateAccountShipping(db, f.owner, hdi.id, { kind: "distributor", depositMode: "none" });
    const mancini = (await makeLocation(db, f.owner, ct.id, "Mancini Test Beverage")).location;
    await updateAccountShipping(db, f.owner, mancini.id, { kind: "distributor", depositMode: "none" });
    // An account someone already pointed elsewhere keeps that choice.
    await setWarehouseOverride(db, f.owner, mancini.id, jab.id, "ships direct from Jack's Abby");

    await replay0009();
    await replay0009(); // safe to run twice

    const reload = async (id: string) => (await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, id)))[0];
    const rtbAfter = await reload(rtb.id);
    expect(rtbAfter.marketId).toBeNull();
    expect(rtbAfter.isPrimary).toBe(false);
    expect(rtbAfter.productionArrangement).toBe("alternating_proprietorship");
    expect((await reload(jab.id)).productionArrangement).toBe("alternating_proprietorship");
    expect((await reload(rea.id)).productionArrangement).toBe("contract");
    expect((await reload(rad.id)).productionArrangement).toBeNull();

    const prost = await originByCode(db, "PRO");
    expect(prost).toMatchObject({ name: "Prost Brewing", kind: "brewery", lotFacilityCode: "03", marketId: null, addressLine1: "351 W 104th Ave", addressLine2: "Unit A", addressCity: "Northglenn", addressState: "CO", addressPostalCode: "80234", productionArrangement: "alternating_proprietorship" });
    expect((await db.select().from(schema.warehouse).where(eq(schema.warehouse.originCode, "PRO"))).length).toBe(1);

    const loc = async (id: string) => (await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, id)))[0];
    expect((await loc(hdi.id)).warehouseOverrideId).toBe(rad.id);
    expect((await loc(mancini.id)).warehouseOverrideId).toBe(jab.id);

    // A Connecticut order now goes to Radford instead of being refused for want of a primary warehouse
    // (Radford has no stock in this test, so the order is held for stock rather than shipped short).
    await setMarketPrice(db, f.owner, { marketId: ct.id, skuId: f.skus.cantinescaCase.id, tier: "distributor", priceCents: 1800 });
    await expect(submitOrder(db, f.owner, { locationId: hdi.id, source: "email", lines: [{ skuId: f.skus.cantinescaCase.id, qty: 5 }] })).rejects.toThrow(/RAD Radford Warehouse is short/);
    const res = await submitOrder(db, f.owner, { locationId: hdi.id, source: "email", shortfallDecision: "hold", lines: [{ skuId: f.skus.cantinescaCase.id, qty: 5 }] });
    expect(res.order.warehouseId).toBe(rad.id);
  });
});

describe("migration 0009 settings and payment data", () => {
  it("sets the company name and contact emails, cleans the distributor footer and stops printing freight class codes", async () => {
    // As production has them today.
    await db.update(schema.companySettings).set({
      dba: "The Leopard Mark Brewing Company",
      ordersEmail: null,
      operationsEmail: null,
      distributorFooter: "Keg deposits are remitted by the distributor to MicroStar; CRV, where the state applies it, is remitted by the distributor to the state. Wording to be confirmed against the current distributor document (question 6.4).",
      nmfcKeg: "88900 (Beer, in kegs) — proposed, verify before use",
      nmfcCan: "88900 (Beer, canned) — proposed, verify before use",
    });
    await replay0009();
    const s = await getCompanySettings(db);
    expect(s.dba).toBe("The Leopard Mark Beverage Group");
    expect(s.arEmail).toBe("ar@theleopardmark.com");
    expect(s.ordersEmail).toBe("orders@theleopardmark.com");
    expect(s.operationsEmail).toBe("operations@theleopardmark.com");
    expect(s.distributorFooter).toBe("Keg deposits are remitted by the distributor to MicroStar; CRV, where the state applies it, is remitted by the distributor to the state.");
    expect(s.nmfcKeg).toBeNull();
    expect(s.nmfcCan).toBeNull();
  });

  it("fills how each account pays from the workbook's channel", async () => {
    const fin = (await makeLocation(db, f.owner, f.market.id, "Fintech Test Bar")).location;
    const ach = (await makeLocation(db, f.owner, f.market.id, "Stripe Test Bar")).location;
    const set = (await makeLocation(db, f.owner, f.market.id, "Already Set Bar")).location;
    // A bar in a distributor's territory buys through the distributor and is not billed by us.
    const dist = (await makeLocation(db, f.owner, f.market.id, "Territory Test Distributor")).location;
    await updateAccountShipping(db, f.owner, dist.id, { kind: "distributor", depositMode: "none" });
    const served = (await makeLocation(db, f.owner, f.market.id, "Served Test Bar")).location;
    await updateAccountShipping(db, f.owner, served.id, { servedByLocationId: dist.id });
    await db.update(schema.paymentRelationship).set({ channel: "fintech" }).where(eq(schema.paymentRelationship.locationId, served.id));
    await db.update(schema.paymentRelationship).set({ channel: "fintech" }).where(eq(schema.paymentRelationship.locationId, fin.id));
    await db.update(schema.paymentRelationship).set({ channel: "stripe_ach" }).where(eq(schema.paymentRelationship.locationId, ach.id));
    await db.update(schema.paymentRelationship).set({ channel: "fintech" }).where(eq(schema.paymentRelationship.locationId, set.id));
    await updateAccountShipping(db, f.owner, set.id, { payBy: "eft" });
    await replay0009();
    const payBy = async (id: string) => (await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, id)))[0].payBy;
    expect(await payBy(fin.id)).toBe("fintech");
    expect(await payBy(ach.id)).toBe("stripe");
    expect(await payBy(set.id)).toBe("eft"); // a choice already made is kept
    expect(await payBy(served.id)).toBeNull();
  });
});

describe("contact emails on documents", () => {
  it("validates the new emails and keeps the AR email required", async () => {
    await expect(updateCompanySettings(db, f.owner, { ordersEmail: "not-an-email" })).rejects.toThrow(/email address/);
    await expect(updateCompanySettings(db, f.owner, { arEmail: "" })).rejects.toThrow(/AR email is required/);
    const s = await updateCompanySettings(db, f.owner, { operationsEmail: " Operations@TheLeopardMark.com " });
    expect(s.operationsEmail).toBe("operations@theleopardmark.com");
    const cleared = await updateCompanySettings(db, f.owner, { ordersEmail: "" });
    expect(cleared.ordersEmail).toBeNull();
    await updateCompanySettings(db, f.owner, { ordersEmail: "orders@theleopardmark.com" });
  });
});
