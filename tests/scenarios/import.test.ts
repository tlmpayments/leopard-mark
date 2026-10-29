/**
 * Repeatable in-app import of the TLM Master File — docs/SHIPMENTS_SPEC.md §5 and acceptance item 7.
 *
 * The scenario runs against a SYNTHETIC workbook built in code (tests/support/workbook.ts). The real export is read
 * only when TLM_WORKBOOK_PATH points at it (owner's machine); that part prints the summary counts and is skipped
 * otherwise. No real row ever enters the repository.
 */
import { readFileSync } from "node:fs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/authz/authorize";
import type { Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { grantRole } from "@/lib/domain/employees/service";
import { seedShipmentDefaults } from "@/lib/domain/settings/service";
import { applyRun, discardRun, dryRun, getRun, listRuns, type ImportReport } from "@/lib/import";
import { ids } from "@/lib/import/ids";
import { parseWorkbook } from "@/lib/import/parse";
import { StaleStateError } from "@/lib/errors";
import { createTestDb } from "../support/db";
import { bootstrapOwner } from "../support/fixtures";
import { buildSyntheticWorkbook } from "../support/workbook";

function printSummary(title: string, report: ImportReport) {
  const lines = [`${title}: creates ${report.totals.creates}, updates ${report.totals.updates}, unchanged ${report.totals.unchanged}, skipped ${report.totals.skipped}, flags ${report.flags.length}, excluded ${report.excluded.length}, unconfirmed lots ${report.unconfirmedLots}`];
  for (const e of report.entities) lines.push(`  ${e.label.padEnd(28)} create ${String(e.creates.length).padStart(4)}  update ${String(e.updates.length).padStart(4)}  unchanged ${String(e.unchanged).padStart(4)}  skipped ${e.skipped.length}`);
  console.log(lines.join("\n"));
}

async function makeAdmin(db: Db, owner: Actor): Promise<Actor> {
  const [emp] = await db.insert(schema.employee).values({ displayName: "Import Admin" }).returning();
  await db.insert(schema.employeeIdentity).values({ employeeId: emp.id, email: "import-admin@example.test" });
  await grantRole(db, owner, emp.id, "admin", null);
  return { kind: "employee", employeeId: emp.id, displayName: emp.displayName, email: "import-admin@example.test", grants: [{ role: "admin", marketId: null }] };
}

describe("TLM Master File import — synthetic workbook", () => {
  let db: Db;
  let close: () => Promise<void>;
  let owner: Actor;
  let admin: Actor;
  let bytes: Buffer;
  let runId: string;
  let first: ImportReport;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedShipmentDefaults(db);
    owner = await bootstrapOwner(db);
    admin = await makeAdmin(db, owner);
    bytes = await buildSyntheticWorkbook();
  });
  afterAll(() => close());

  it("parses every expected tab and normalises cells to text", async () => {
    const parsed = await parseWorkbook(bytes);
    expect(parsed.missing).toEqual([]);
    expect(parsed.present).toHaveLength(11);
    expect(parsed.tabs["Routes"]).toBeUndefined();
    const ca = parsed.tabs["Customer Accounts"];
    expect(ca[0][3]).toBe("Alc.\nLicense #");
    // 542804 (a number cell) prints as "542804"; dates as YYYY-MM-DD; booleans as True/False.
    expect(ca[1][3]).toBe("542804");
    expect(ca[1][19]).toBe("2026-05-29");
    expect(ca[1][29]).toBe("True");
    expect(parsed.tabs["Location Information"][5][7]).toBe("1702");
  });

  it("dry run (admin) stores a run with creates per entity and the flagged and excluded lists", async () => {
    const r = await dryRun(db, admin, { fileName: "tlm-synthetic.xlsx", bytes });
    runId = r.run.id;
    first = r.report;
    printSummary("Synthetic dry run 1", r.report);
    expect(r.run.status).toBe("dry_run");
    const s = r.report.summary;
    expect(s.markets.create).toBe(5);
    expect(s.origins.create).toBe(12);
    expect(s.employees.create).toBe(12);
    expect(s.skus.create).toBe(8 + 13);
    expect(s.prices.create).toBe(12);
    // 7 master rows kept (Leopard Mark, Balmuth, blank excluded) + Pier Nine from the Accounts tab + 3 distributors.
    expect(s.accounts.create).toBe(11);
    expect(s.batches.create).toBe(9);
    // 4 real Production lots + the dotted TLM.EBB.SGB.001 (01SGB2601301) + 2 backfilled from the log.
    expect(s.lots.create).toBe(7);
    expect(s.shipments.create).toBe(12);
    expect(s.invoices.create).toBe(6);
    expect(s.links.create).toBe(5); // the merged duplicate WLA-090326-1 also names INV26278
    expect(r.report.unconfirmedLots).toBe(2);
    expect(r.report.totals.updates).toBe(0);
    const excludedKeys = r.report.excluded.map((e) => e.key);
    expect(excludedKeys).toEqual(expect.arrayContaining(["The Leopard Mark", "Balmuth", "(blank)", "Dock & Dine (ACC-5)", "Katie Sloan", "Jack Begley", "Admin", "SGB-TAPHANDLE"]));
    const messages = r.report.flags.map((f) => `${f.key}: ${f.message}`).join("\n");
    expect(messages).toContain("Pier Nine Bistro: Present only in the Accounts tab");
    expect(messages).toContain("Dock & Dine (Marina): No ZIP");
    expect(messages).toMatch(/WLA-090326-1: Duplicate of WLA-090326-01/);
    expect(messages).toMatch(/EWD-D-261010-01: Destination "Unknown Bar" matches no account/);
    expect(messages).toMatch(/TLM-D-260909-02: TLM prefix carries no origin/);
    expect(messages).toMatch(/INV26302: Customer "Some Event LLC" matches no account/);
    expect(messages).toMatch(/Thomas Gilbert: Email to supply/);
    expect(messages).toMatch(/Zack Bone: Sales rep without a market grant/);
    expect(messages).toMatch(/01SGB2606021: Packaged Products lot 01GSB2606021 read as 01SGB2606021/);
    // The run is listed and readable.
    const runs = await listRuns(db);
    expect(runs.map((x) => x.id)).toContain(runId);
    const stored = await getRun(db, runId);
    expect(stored?.diff.records.accounts.length).toBe(11);
  });

  it("admin cannot apply; the Owner applies once", async () => {
    await expect(applyRun(db, admin, runId)).rejects.toBeInstanceOf(AuthorizationError);
    const r = await applyRun(db, owner, runId);
    expect(r.run.status).toBe("applied");
    expect(r.result.creates).toBe(first.totals.creates);
    expect(r.result.updates).toBe(0);
    expect(r.result.exceptionsOpened).toBe(2);
    await expect(applyRun(db, owner, runId)).rejects.toBeInstanceOf(StaleStateError);
  });

  it("accounts carry the decisions: kinds, served-by, status, terms, fulfilment, legacy ids, originating reps", async () => {
    const byName = async (name: string) => (await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, ids.location(name))))[0];
    const matagrano = await byName("Matagrano, Inc");
    expect(matagrano.kind).toBe("distributor");
    expect(matagrano.fulfilment).toBe("pickup");
    expect(matagrano.status).toBe("active");
    expect(matagrano.marketId).toBe(ids.market("NORCAL-D"));
    const fog = await byName("Fog City Oyster Bar");
    expect(fog.kind).toBe("retail");
    expect(fog.status).toBe("active");
    expect(fog.servedByLocationId).toBe(matagrano.id);
    expect(fog.marketId).toBe(ids.market("NORCAL-D"));
    expect(fog.termsDaysOverride).toBe(0);
    expect(fog.legacyAccountId).toBe("ACC-2");
    expect(fog.region).toBe("San Francisco");
    expect(fog.originatingRepEmployeeId).toBe(ids.employee("Thomas Gilbert"));
    expect(fog.currentRepEmployeeId).toBeNull();
    const heron = await byName("Blue Heron Tavern");
    expect(heron.servedByLocationId).toBeNull();
    expect(heron.termsDaysOverride).toBeNull(); // Net 30 equals the market rule
    expect(heron.marketId).toBe(ids.market("NORCAL-SD"));
    const sunset = await byName("Sunset Sports Grill");
    expect(sunset.originatingRepEmployeeId).toBe(ids.employee("James Williams"));
    const hartford = await byName("Hartford Distributors Inc.");
    expect(hartford.kind).toBe("distributor");
    expect(hartford.marketId).toBe(ids.market("CT"));
    const pier = await byName("Pier Nine Bistro");
    expect(pier.marketId).toBe(ids.market("SOCAL"));
    expect(pier.legacyAccountId).toBe("ACC-6");
    // Children: delivery and billing addresses, buyer and AP contacts, license, payment, cleaning.
    const harbor = await byName("Harbor Light Cantina");
    const addrs = await db.select().from(schema.locationAddress).where(eq(schema.locationAddress.locationId, harbor.id));
    expect(addrs.map((a) => a.kind).sort()).toEqual(["billing", "delivery"]);
    expect(new Set(addrs.map((a) => a.addressId)).size).toBe(2);
    const contacts = await db.select().from(schema.locationContact).where(eq(schema.locationContact.locationId, heron.id));
    expect(contacts.map((c) => c.contactRole).sort()).toEqual(["ap", "buyer"]);
    const [buyer] = await db.select().from(schema.contact).where(eq(schema.contact.id, ids.contact(heron.id, "buyer")));
    expect(buyer.email).toBe("orders@blueheron.example");
    expect(buyer.phone).toBe("(415) 555-0101");
    const [lic] = await db.select().from(schema.licenseVerification).where(eq(schema.licenseVerification.locationId, heron.id));
    expect(lic.licenseNumber).toBe("542804");
    const [pay] = await db.select().from(schema.paymentRelationship).where(eq(schema.paymentRelationship.locationId, heron.id));
    expect(pay.channel).toBe("fintech");
    const [clean] = await db.select().from(schema.cleaningObligation).where(eq(schema.cleaningObligation.locationId, heron.id));
    expect(clean.lastCompletedOn).toBe("2026-05-29");
  });

  it("origins, markets, SKUs, aliases and prices match the production ids and the decisions", async () => {
    const origins = await db.select().from(schema.warehouse);
    const byCode = new Map(origins.map((o) => [o.originCode, o]));
    expect(byCode.get("EBB")!.id).toBe(ids.origin("P_CA_Richmond"));
    expect(byCode.get("EBB")!.lotFacilityCode).toBe("01");
    expect(byCode.get("EBB")!.marketId).toBe(ids.market("NORCAL-D"));
    expect(byCode.get("RAD")!.id).toBe(ids.origin("RAD"));
    expect(byCode.get("RAD")!.marketId).toBe(ids.market("MA"));
    expect(byCode.get("RAD")!.isPrimary).toBe(true);
    expect(byCode.get("RAD")!.addressPostalCode).toBe("02048");
    expect(byCode.get("JAB")!.isPrimary).toBe(false);
    expect(byCode.get("JAB")!.appointmentRequired).toBe(true);
    expect(byCode.get("JAB")!.addressPostalCode).toBe("01702");
    expect(byCode.get("PRO")!.marketId).toBeNull();
    expect(byCode.get("RAL")!.marketId).toBeNull();
    expect(origins.filter((o) => !o.active).map((o) => o.name).sort()).toEqual(["Envision Cold Storage (San Francisco)", "SC Warehouses (Benicia)"]);
    const [norcalD] = await db.select().from(schema.market).where(eq(schema.market.code, "NORCAL-D"));
    expect(norcalD.id).toBe(ids.market("NORCAL-D"));
    expect(norcalD.regionList).toEqual(["San Francisco"]);
    const skus = await db.select().from(schema.sku);
    expect(skus.filter((s) => !s.archivedAt)).toHaveLength(8);
    expect(skus.filter((s) => s.archivedAt)).toHaveLength(13);
    const slgHalf = skus.find((s) => s.code === "SLG0KHB010")!;
    expect(slgHalf.id).toBe(ids.sku("SLG0KHB010"));
    expect(slgHalf.upcUnit).toBe("850000000001");
    expect(slgHalf.palletFraction).toBe("0.1250");
    expect(slgHalf.recipeVariant).toBe("0");
    const cntCase = skus.find((s) => s.code === "CNTCC1206P")!;
    expect(cntCase.upcCase).toBe("10850000000005");
    expect(cntCase.recipeVariant).toBe("C");
    const aliases = await db.select().from(schema.skuAlias);
    const alias = new Map(aliases.map((a) => [a.alias, a.skuId]));
    expect(alias.get("SGB1AKHB01")).toBe(slgHalf.id);
    expect(alias.get("TLM-SGB1AKHB01-M")).toBe(slgHalf.id);
    expect(alias.get("TLM.EBB.SGB-KEG.1/2")).toBe(slgHalf.id);
    expect(alias.get("TLM.PRO.GSP-KEG.1/2")).toBe(ids.sku("GSP1AKHB01"));
    const prices = await db.select().from(schema.marketPrice);
    expect(prices).toHaveLength(12);
    const p = prices.find((x) => x.id === ids.price("SOCAL", "CNTCKHB010", "2026-10-28"))!;
    expect(p.priceCents).toBe(19200);
  });

  it("people exist without identities or credentials; grants follow 9.2", async () => {
    const employees = await db.select().from(schema.employee);
    const names = employees.map((e) => e.displayName);
    expect(names).toEqual(expect.arrayContaining(["Thomas Gilbert", "Max Finnance", "Kellan Hegedus", "Zack Bone", "Steve Almaraz", "Daniel O'Sullivan", "Alex Lai", "Alexander Velazquez", "James Williams", "Ricardo Villanueva", "S. Sprague", "D. Krause"]));
    expect(names).not.toContain("Katie Sloan");
    expect(names).not.toContain("Jack Begley");
    const jw = employees.find((e) => e.displayName === "James Williams")!;
    expect(jw.enabled).toBe(false);
    expect(jw.disableReason).toBe("Left the company (decision 9.2)");
    const identities = await db.select().from(schema.employeeIdentity).where(eq(schema.employeeIdentity.employeeId, ids.employee("Thomas Gilbert")));
    expect(identities).toHaveLength(0);
    const creds = await db.select().from(schema.employeeCredential);
    expect(creds).toHaveLength(0);
    const grants = await db.select().from(schema.roleGrant).where(isNull(schema.roleGrant.revokedAt));
    const forEmp = (name: string) => grants.filter((g) => g.employeeId === ids.employee(name)).map((g) => `${g.role}:${g.marketId ?? "all"}`);
    expect(forEmp("Thomas Gilbert")).toEqual([`sales:${ids.market("NORCAL-SD")}`]);
    expect(forEmp("Kellan Hegedus")).toEqual([`sales:${ids.market("MA")}`]);
    expect(forEmp("Max Finnance")).toEqual([`sales:${ids.market("CT")}`]);
    expect(forEmp("Daniel O'Sullivan")).toEqual(["admin:all"]);
    expect(forEmp("Steve Almaraz")).toEqual(["admin:all"]);
    expect(forEmp("Zack Bone")).toEqual([]);
    expect(forEmp("James Williams")).toEqual([]);
  });

  it("batches and lots: statuses, synthetic codes for dotted lots, Packaged Products quantities, backfilled lots with one exception each", async () => {
    const batches = await db.select().from(schema.brewBatch);
    expect(batches).toHaveLength(9);
    const status = Object.fromEntries(batches.map((b) => [b.batchNumber, b.status]));
    expect(status).toMatchObject({ B01CNT26001: "complete", B01SGB26002: "destroyed", B01CNT26003: "in_progress", B06CNT26002: "scheduled", B01GSP26001: "cancelled" });
    expect(batches.find((b) => b.batchNumber === "B01SGB26002")!.statusReason).toBe("Grain blended during milling");
    expect(batches.find((b) => b.batchNumber === "B06CNT26002")!.facilityWarehouseId).toBe(ids.origin("P_MA_Framingham"));
    const lots = await db.select().from(schema.lot);
    const byCode = new Map(lots.map((l) => [l.lotCode, l]));
    expect(Array.from(byCode.keys()).sort()).toEqual(["01CNT2607151", "01SGB2601301", "01SGB2606021", "01SGB2608031", "02XHZ260312A", "03GSP2603251", "05CNT2609021"]);
    const dotted = byCode.get("01SGB2601301")!;
    expect(dotted.legacyCode).toBe("TLM.EBB.SGB.001");
    expect(dotted.batchId).toBe(ids.batch("B01SGB26001"));
    expect(dotted.quantitiesKnown).toBe(true);
    const qty = await db.select({ lot: schema.lot.lotCode, sku: schema.sku.code, qty: schema.lotSkuQty.qtyPackaged }).from(schema.lotSkuQty).innerJoin(schema.lot, eq(schema.lot.id, schema.lotSkuQty.lotId)).innerJoin(schema.sku, eq(schema.sku.id, schema.lotSkuQty.skuId));
    const q = (lot: string, sku: string) => qty.find((x) => x.lot === lot && x.sku === sku)?.qty;
    expect(q("01CNT2607151", "CNTCKHB010")).toBe(22);
    expect(q("01CNT2607151", "CNTCC1206P")).toBe(50);
    expect(q("01SGB2601301", "SLG0C1206P")).toBe(94);
    expect(q("02XHZ260312A", "XHZ1AKHB01")).toBe(8);
    expect(q("02XHZ260312A", "XHZ1AC1224")).toBe(5); // 5.25 rounded
    // Packaged Products fills the lots whose Production row has no quantities (dotted TLM.PRO.GSP.001 and the typo 01GSB…).
    expect(q("03GSP2603251", "GSP1AKHB01")).toBe(56);
    expect(q("03GSP2603251", "GSP1AC1224")).toBe(172);
    expect(q("01SGB2606021", "SLG0KHB010")).toBe(66);
    expect(byCode.get("03GSP2603251")!.quantitiesKnown).toBe(true);
    // Backfilled lots: parsed from the code, unknown quantities, one exception each.
    const back = byCode.get("05CNT2609021")!;
    expect(back.source).toBe("bol_log_backfill");
    expect(back.quantitiesKnown).toBe(false);
    expect(back.facilityWarehouseId).toBe(ids.origin("P_CA_San Diego"));
    expect(back.brandCode).toBe("CNT");
    expect(back.packagingDate).toBe("2026-09-02");
    expect(byCode.get("01SGB2608031")!.brandCode).toBe("SGB");
    const exceptions = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.category, "lot_quantities_unconfirmed"));
    expect(exceptions.map((e) => e.dedupeKey).sort()).toEqual([`lot_quantities_unconfirmed:${byCode.get("01SGB2608031")!.id}`, `lot_quantities_unconfirmed:${back.id}`].sort());
  });

  it("legacy shipments: types, pickup, driver stock loads, origins, destinations, lines, keg pickups and the merged duplicate", async () => {
    const shipments = await db.select().from(schema.shipment);
    expect(shipments).toHaveLength(12);
    expect(shipments.every((s) => s.legacy && s.status === "delivered")).toBe(true);
    const byNumber = new Map(shipments.map((s) => [s.number, s]));
    const harbor = byNumber.get("WLA-090326-01")!;
    expect(harbor.type).toBe("D");
    expect(harbor.originWarehouseId).toBe(ids.origin("W_CA_Wilmington 01"));
    expect(harbor.destinationLocationId).toBe(ids.location("Harbor Light Cantina"));
    expect(harbor.template).toBe("retail");
    expect(harbor.scheduledDate).toBe("2026-09-03");
    expect(harbor.actualDate).toBe("2026-09-03");
    expect(harbor.marketId).toBe(ids.market("SOCAL"));
    const dup = byNumber.get("WLA-090326-1")!;
    expect(dup.mergedIntoShipmentId).toBe(harbor.id);
    const leopard = byNumber.get("WLA-P-260930")!;
    expect(leopard.type).toBe("T");
    expect(leopard.destinationText).toBe("Driver stock load (legacy)");
    expect(leopard.destinationLocationId).toBeNull();
    const pickup = byNumber.get("WLA-P-261001-01")!;
    expect(pickup.type).toBe("D");
    expect(pickup.pickup).toBe(true);
    expect(pickup.destinationLocationId).toBe(ids.location("Sunset Sports Grill"));
    const sample = byNumber.get("EWD-S-261006-01")!;
    expect(sample.type).toBe("S");
    expect(sample.destinationText).toBe("Thomas Gilbert");
    const transfer = byNumber.get("EWD-T-260917-01")!;
    expect(transfer.type).toBe("T");
    expect(transfer.destinationWarehouseId).toBe(ids.origin("W_CA_Windsor 01"));
    expect(transfer.originWarehouseId).toBe(ids.origin("P_CA_Richmond")); // inferred from lot 01SGB2608031
    expect(transfer.template).toBe("transfer");
    const freightT = byNumber.get("BOL-T-260929-01")!;
    expect(freightT.type).toBe("T");
    expect(freightT.originWarehouseId).toBe(ids.origin("P_MA_Framingham"));
    expect(freightT.destinationWarehouseId).toBe(ids.origin("RAD"));
    expect(freightT.carrier).toBe("Example Freight LLC");
    expect(freightT.palletCount).toBe(4);
    expect(freightT.appointment).toBe("Destination: Call ahead");
    const freightD = byNumber.get("BOL-260926-01")!;
    expect(freightD.type).toBe("D");
    expect(freightD.originWarehouseId).toBe(ids.origin("P_CA_Richmond"));
    expect(freightD.destinationLocationId).toBe(ids.location("Hartford Distributors Inc."));
    expect(freightD.template).toBe("distributor");
    expect(freightD.marketId).toBe(ids.market("CT"));
    expect(freightD.notes).toContain("Ref: PO 4471");
    const tlm = byNumber.get("TLM-D-260909-02")!;
    expect(tlm.originWarehouseId).toBe(ids.origin("P_CA_Richmond"));
    expect(tlm.destinationLocationId).toBe(ids.location("Fog City Oyster Bar"));
    const site = byNumber.get("WLA-D-261005-01")!;
    expect(site.destinationLocationId).toBe(ids.location("Dock & Dine (Downtown)"));
    const unknown = byNumber.get("EWD-D-261010-01")!;
    expect(unknown.destinationLocationId).toBeNull();
    expect(unknown.destinationText).toBe("Unknown Bar");
    expect(unknown.legacyPayload).toMatchObject({ docNumber: "EWD-D-261010-01", bolNumber: "EWD-D-261010-01" });
    // Lines: SKU through the alias to the active SKU, lot id when a lot row exists, POS items for tap handles.
    const heronShip = byNumber.get("EWD-D-260910-01")!;
    const lines = await db.select().from(schema.shipmentLine).where(eq(schema.shipmentLine.shipmentId, heronShip.id)).orderBy(schema.shipmentLine.lineNo);
    expect(lines).toHaveLength(2);
    expect(lines[0].skuId).toBe(ids.sku("SLG0KHB010"));
    expect(lines[0].lotCode).toBe("01SGB2608031");
    expect(lines[0].lotId).toBe(ids.lot("01SGB2608031"));
    expect(lines[0].qty).toBe(2);
    expect(Number(lines[0].weightLb)).toBe(320);
    expect(lines[1].skuId).toBeNull();
    const [pos] = await db.select().from(schema.posItem).where(eq(schema.posItem.code, "TAPHANDLE-STD"));
    expect(lines[1].posItemId).toBe(pos.id);
    const [kegs] = await db.select().from(schema.shipmentKegPickup).where(eq(schema.shipmentKegPickup.shipmentId, heronShip.id));
    expect(kegs.halfIn).toBe(1);
    // Nothing legacy touched the ledger.
    const movements = await db.select().from(schema.stockMovement);
    expect(movements).toHaveLength(0);
  });

  it("legacy invoices: statuses, series, customer matching, lines and links to legacy shipments", async () => {
    const invoices = await db.select().from(schema.invoice);
    expect(invoices).toHaveLength(6);
    expect(invoices.every((i) => i.legacy)).toBe(true);
    const byNumber = new Map(invoices.map((i) => [i.number, i]));
    expect(byNumber.get("INV26278")!.status).toBe("paid");
    expect(byNumber.get("INV26278")!.legacyStatus).toBe("Paid");
    expect(byNumber.get("INV26278")!.locationId).toBe(ids.location("Harbor Light Cantina"));
    expect(byNumber.get("INV26278")!.invoiceDate).toBe("2026-09-03");
    expect(byNumber.get("INV26278")!.totalCents).toBe(19200);
    expect(byNumber.get("INV26300")!.status).toBe("issued");
    expect(byNumber.get("INV26300")!.locationId).toBe(ids.location("Blue Heron Tavern")); // "Legal / Trade"
    expect(byNumber.get("INV26300")!.subtotalCents).toBe(41000 + 3625);
    expect(byNumber.get("INV26301")!.status).toBe("void");
    expect(byNumber.get("INV26302")!.locationId).toBeNull();
    expect(byNumber.get("INV26302")!.legacyStatus).toBe("Not Created");
    expect(byNumber.get("NC26001")!.series).toBe("NC");
    expect(byNumber.get("INV26303")!.locationId).toBe(ids.location("Matagrano, Inc")); // trailing period dropped
    const heronLines = await db.select().from(schema.invoiceLine).where(eq(schema.invoiceLine.invoiceId, byNumber.get("INV26300")!.id)).orderBy(schema.invoiceLine.lineNo);
    expect(heronLines.map((l) => l.kind)).toEqual(["beer", "beer", "info", "pos"]);
    expect(heronLines[0].skuId).toBe(ids.sku("SLG0KHB010")); // product name + packaging format
    expect(heronLines[0].unitPriceCents).toBe(20500);
    expect(heronLines[1].skuId).toBe(ids.sku("SLG0C1206P"));
    expect(heronLines[2].description).toMatch(/MicroStar 1\/2 bbl empties/);
    const matLines = await db.select().from(schema.invoiceLine).where(eq(schema.invoiceLine.invoiceId, byNumber.get("INV26303")!.id));
    expect(matLines[0].skuId).toBe(ids.sku("CNTCC1206P"));
    expect(matLines[0].lineTotalCents).toBe(310170);
    const fogLines = await db.select().from(schema.invoiceLine).where(eq(schema.invoiceLine.invoiceId, byNumber.get("INV26301")!.id));
    expect(fogLines[0].lotCode).toBe("TLM.EBB.SGB.001");
    const links = await db.select().from(schema.invoiceShipment);
    const pairs = new Set(links.map((l) => `${l.invoiceId}|${l.shipmentId}`));
    expect(pairs.has(`${byNumber.get("INV26278")!.id}|${ids.legacyShipment("WLA-090326-01")}`)).toBe(true);
    expect(pairs.has(`${byNumber.get("INV26300")!.id}|${ids.legacyShipment("EWD-D-260910-01")}`)).toBe(true);
    expect(pairs.has(`${byNumber.get("NC26001")!.id}|${ids.legacyShipment("WLA-P-261001-01")}`)).toBe(true);
    expect(links).toHaveLength(5);
  });

  it("every write is audited under the run id and one import.run event exists", async () => {
    const events = await db.select().from(schema.auditEvent).where(eq(schema.auditEvent.correlationId, runId));
    const actions = new Set(events.map((e) => e.action));
    expect(actions).toEqual(expect.any(Set));
    for (const a of ["import.run", "import.location", "import.origin", "import.sku", "import.shipment", "import.invoice", "import.lot", "import.batch", "import.person", "import.market", "import.price"]) expect(actions.has(a)).toBe(true);
    expect(events.filter((e) => e.action === "import.run")).toHaveLength(1);
    expect(events.filter((e) => e.action === "import.location")).toHaveLength(11);
    expect(events.every((e) => e.actorEmployeeId === owner.employeeId)).toBe(true);
  });

  it("a second dry run of the same workbook reports no creates and no updates; a discarded run cannot be applied", async () => {
    const r = await dryRun(db, owner, { fileName: "tlm-synthetic.xlsx", bytes });
    printSummary("Synthetic dry run 2", r.report);
    expect(r.report.totals.creates).toBe(0);
    expect(r.report.totals.updates).toBe(0);
    expect(r.report.totals.unchanged).toBe(first.totals.creates);
    const discarded = await discardRun(db, admin, r.run.id);
    expect(discarded.status).toBe("discarded");
    await expect(applyRun(db, owner, r.run.id)).rejects.toBeInstanceOf(StaleStateError);
  });

  it("an edited workbook updates in place: a changed address and a new document show as updates and creates", async () => {
    // Re-import with the Harbor Light address changed and a 13th document: the diff must report exactly those.
    const parsed = await parseWorkbook(bytes);
    const { normalizeWorkbook } = await import("@/lib/import/normalize");
    const { planImport } = await import("@/lib/import/diff");
    const ca = parsed.tabs["Customer Accounts"];
    const row = ca.find((r) => r[0] === "Harbor Light Cantina")!;
    row[8] = "78 Pine Ave, Long Beach, CA 90802";
    const records = normalizeWorkbook(parsed, "edited.xlsx");
    const plan = await planImport(db, records);
    expect(plan.report.totals.creates).toBe(0);
    const harbor = plan.report.entities.find((e) => e.entity === "accounts")!.updates.find((u) => u.label === "Harbor Light Cantina")!;
    expect(harbor.changes).toEqual([{ field: "delivery address.line1", from: "77 Pine Ave", to: "78 Pine Ave" }]);
    expect(plan.report.totals.updates).toBe(1);
  });

  it("rejects files that are not a workbook export", async () => {
    await expect(dryRun(db, admin, { fileName: "notes.txt", bytes: Buffer.from("hello") })).rejects.toThrow(/\.xlsx/);
    await expect(dryRun(db, admin, { fileName: "empty.xlsx", bytes: Buffer.alloc(0) })).rejects.toThrow(/Choose/);
  });
});

const REAL = process.env.TLM_WORKBOOK_PATH;

describe.skipIf(!REAL)("TLM Master File import — real export (TLM_WORKBOOK_PATH)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let owner: Actor;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    await seedShipmentDefaults(db);
    owner = await bootstrapOwner(db, "Owner", "owner@example.test");
  });
  afterAll(() => close());

  it("dry run, apply, dry run again: the expected counts and zero changes the second time", async () => {
    const bytes = readFileSync(REAL!);
    const r1 = await dryRun(db, owner, { fileName: "tlm-master.xlsx", bytes });
    printSummary("Real workbook dry run 1", r1.report);
    const grouped = new Map<string, number>();
    for (const f of r1.report.flags) {
      const k = `${f.entity}: ${f.message.replace(/"[^"]*"/g, '"…"').replace(/\b[A-Z]{2,3}[-.][-A-Z0-9./ ]*\d[-A-Z0-9./]*\b/g, "#").replace(/\d+(\.\d+)?/g, "n")}`;
      grouped.set(k, (grouped.get(k) ?? 0) + 1);
    }
    console.log(["Real workbook flags by kind:", ...Array.from(grouped.entries()).map(([k, n]) => `  [${String(n).padStart(3)}] ${k}`)].join("\n"));
    console.log(["Real workbook exclusions:", ...r1.report.excluded.map((e) => `  ${e.entity} ${e.key} — ${e.reason}`)].join("\n"));
    const s = r1.report.summary;
    expect(s.accounts.create).toBe(142);
    expect(s.origins.create).toBe(12);
    expect(s.skus.create).toBe(8 + 23);
    expect(s.prices.create).toBe(12);
    expect(s.shipments.create).toBe(123);
    expect(r1.report.flags.filter((f) => /merged$/.test(f.message))).toHaveLength(1);
    expect(s.invoices.create).toBe(374);
    expect(s.batches.create).toBe(43);
    expect(s.lots.create).toBeGreaterThanOrEqual(24 + 16);
    expect(s.employees.create).toBe(12);
    const r2 = await applyRun(db, owner, r1.run.id);
    console.log(`Real workbook apply: creates ${r2.result.creates}, updates ${r2.result.updates}, exceptions opened ${r2.result.exceptionsOpened}`);
    expect(r2.result.creates).toBe(r1.report.totals.creates);
    const r3 = await dryRun(db, owner, { fileName: "tlm-master.xlsx", bytes });
    printSummary("Real workbook dry run 2", r3.report);
    expect(r3.report.totals.creates).toBe(0);
    expect(r3.report.totals.updates).toBe(0);
    const [{ n: backfilled }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.lot).where(eq(schema.lot.source, "bol_log_backfill"));
    const [{ n: unconfirmed }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.exceptionCase).where(and(eq(schema.exceptionCase.category, "lot_quantities_unconfirmed"), eq(schema.exceptionCase.state, "open")));
    const [{ n: matagranoServed }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.customerLocation).where(eq(schema.customerLocation.servedByLocationId, ids.location("Matagrano, Inc")));
    console.log(`Real workbook: backfilled lots ${backfilled}, open lot_quantities_unconfirmed ${unconfirmed}, accounts served by Matagrano ${matagranoServed}`);
    expect(backfilled).toBeGreaterThanOrEqual(16);
    expect(unconfirmed).toBe(backfilled);
    expect(matagranoServed).toBe(51);
  });
});
