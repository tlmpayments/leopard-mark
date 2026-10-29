import { eq } from "drizzle-orm";
import type { Actor, Role } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { recordStockMovement } from "@/lib/domain/allocation/service";
import { createSku, setMarketPrice } from "@/lib/domain/catalog/service";
import { createLocation, createRepHomeAddress, recordLicenseDecision, requestBillingEmailChange, samplesRecipients, setLocationStatus } from "@/lib/domain/customers/service";
import { updateAccountShipping } from "@/lib/domain/customers/shipping";
import { createBatch, recordPackagingReport } from "@/lib/domain/lots/service";
import { updateMarketBilling } from "@/lib/domain/markets/billing";
import { createOrigin, updateOrigin } from "@/lib/domain/origins/service";
import { confirmShipment, deliverShipment, getShipment, updateShipmentHeader } from "@/lib/domain/shipments/service";
import { grantRole, loadActor } from "@/lib/domain/employees/service";
import { createHold } from "@/lib/domain/holds/service";
import { recordIntakeRequest } from "@/lib/domain/intake/service";
import { createMarket } from "@/lib/domain/markets/service";
import { cancelUndeliveredDemand, requestOrderChange, submitOrder } from "@/lib/domain/orders/service";
import { requestPaymentSetup, setPayerContact } from "@/lib/domain/payment/service";
import { recordNoticeOutcome } from "@/lib/domain/notices/service";
import { demoModeEnabled, isDeployment } from "@/lib/env";
import { recordSampleWithdrawal } from "@/lib/domain/samples/service";
import { createStandingArrangement } from "@/lib/domain/standing/service";
import { seedGates } from "@/lib/integrations/gates";
import { seedShipmentDefaults } from "@/lib/domain/settings/service";
import { runDueJobs } from "@/lib/jobs/queue";
import { seedDecisionRegister } from "@/lib/policy/policy";
import "@/lib/integrations/stripe/adapter"; // registers job handlers
import "@/lib/domain/pullsheet/service"; // registers the pull sheet send handler (R2-29)
import { hashPin } from "@/lib/auth/pin";
import { DEMO_PIN } from "./constants";

/**
 * Representative DEMO data (development only). Everything goes through the
 * real domain services, so the seeded state is exactly what the rules
 * produce: audit rows, exception cases, notice intents, unselected decisions.
 *
 * Nothing here pretends a provider succeeded: the Stripe association request
 * is left in its truthful IMPLEMENTED / NOT CONNECTED pending state, notices
 * stay manual-pending (D32 unselected), and every capability gate is unproven.
 *
 * Prices are SAMPLE values, not the company's price list.
 */
export const DEMO_OWNER_EMAIL = "owner@demo.local";

/** The n-th weekday from today (YYYY-MM-DD), so the demo's scheduled dates stay in the near future whenever it is seeded. */
function nextWeekday(n: number): string {
  const d = new Date();
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

export interface SeedResult {
  seeded: boolean;
  locations?: string[];
}

/**
 * Safety (REV-02 / AC05): every check runs BEFORE any write. The seed refuses
 * on a deployment, in production, and whenever FV_ENV is not explicitly a
 * non-production value; it also refuses to touch a database that already has
 * business data (any market), so it can never add fixtures to a live store.
 */
export function assertSeedAllowed() {
  if (isDeployment()) throw new Error("Demo seed refuses to run on a deployment (production build or Vercel environment)");
  const env = process.env.FV_ENV;
  if (env === "production") throw new Error("Demo seed refuses to run in production");
  // The embedded demo database (never a real DATABASE_URL) is covered by the demo-mode guards themselves.
  if (demoModeEnabled()) return;
  if (env !== "development" && env !== "test") throw new Error("Demo seed requires FV_ENV=development or FV_ENV=test to be set explicitly");
}

export async function seedDemo(db: Db): Promise<SeedResult> {
  assertSeedAllowed();
  const [already] = await db.select({ id: schema.market.id }).from(schema.market).limit(1);
  if (already) return { seeded: false };
  await seedDecisionRegister(db);
  await seedGates(db);
  await seedShipmentDefaults(db);

  // Every seeded person signs in with the same demo PIN (already chosen, so no forced change) — local demo only.
  const demoPinHash = await hashPin(DEMO_PIN);
  async function person(name: string, email: string, role: Role, marketId: string | null, by?: Actor): Promise<Actor> {
    const [emp] = await db.insert(schema.employee).values({ displayName: name }).returning();
    await db.insert(schema.employeeIdentity).values({ employeeId: emp.id, email });
    await db.insert(schema.employeeCredential).values({ employeeId: emp.id, pinHash: demoPinHash, mustChange: false, setByEmployeeId: by?.employeeId ?? null });
    if (by) await grantRole(db, by, emp.id, role, marketId);
    else await db.insert(schema.roleGrant).values({ employeeId: emp.id, role, marketId });
    return (await loadActor(db, emp.id))!;
  }

  // --- people (five roles) ---
  const owner = await person("Demo Owner", DEMO_OWNER_EMAIL, "owner", null);
  await db.insert(schema.auditEvent).values({ actorKind: "system", action: "demo.seed", subjectType: "employee", subjectId: owner.employeeId!, current: { note: "demo data — not customer history" } });

  // --- markets & origins (R2-34 codes; R2-37 host breweries hold stock; warehouses receive the end-of-day sheet, R2-29) ---
  const nc = await createMarket(db, owner, { code: "NC", name: "NorCal Self Distribution" });
  const la = await createMarket(db, owner, { code: "LA", name: "SoCal" });
  const ma = await createMarket(db, owner, { code: "MA", name: "Massachusetts", timezone: "America/New_York" });
  await updateMarketBilling(db, owner, la.id, { routeDays: ["Tue", "Thu"] });
  const eastBrother = await createOrigin(db, owner, { name: "East Brother Beer Co.", kind: "brewery", marketId: nc.id, originCode: "EBB", lotFacilityCode: "01", addressText: "1001 Canal Blvd, Richmond, CA 94804" });
  const ewd = await createOrigin(db, owner, { name: "Express Wine Delivery", kind: "warehouse", marketId: nc.id, originCode: "EWD", isPrimary: true, addressText: "Oakland, CA (demo)" });
  await updateOrigin(db, owner, ewd.id, { pullSheetEmail: "warehouse@ewd.demo", pullSheetSendTime: "16:30", fulfillmentContact: "EWD dispatch desk" });
  const beachwood = await createOrigin(db, owner, { name: "Beachwood Brewing", kind: "brewery", marketId: la.id, originCode: "BWD", lotFacilityCode: "02", addressText: "Huntington Beach, CA (demo)" });
  const balmuth = await createOrigin(db, owner, { name: "Balmuth & Co.", kind: "warehouse", marketId: la.id, originCode: "WLA", isPrimary: true, addressText: "Los Angeles, CA (demo)" });
  await updateOrigin(db, owner, balmuth.id, { pullSheetEmail: "ops@balmuth.demo", pullSheetSendTime: "17:00", fulfillmentContact: "Balmuth receiving" });
  await createOrigin(db, owner, { name: "Jack's Abby Brewing", kind: "brewery", marketId: ma.id, originCode: "JAB", lotFacilityCode: "06", isPrimary: true, addressText: "Framingham, MA (demo)" });

  const admin = await person("Daniel Back Office", "admin@demo.local", "admin", null, owner);
  const accounting = await person("Al Accounting", "accounting@demo.local", "accounting", null, owner);
  const sales = await person("Sam Sales (NorCal)", "sales-nc@demo.local", "sales", nc.id, owner);
  const salesLa = await person("Lee Sales (SoCal)", "sales-la@demo.local", "sales", la.id, owner);
  const driver = await person("Dee Driver", "driver@demo.local", "driver_service", nc.id, owner);
  const driverLa = await person("Rio Driver (SoCal)", "driver-la@demo.local", "driver_service", la.id, owner);

  // --- catalog & SAMPLE prices (brands in production only, R2-33) ---
  const mk = (code: string, brand: string, name: string, packageKind: Parameters<typeof createSku>[2]["packageKind"], sellingUnit: string) =>
    createSku(db, admin, { code, name, brand, packageKind, sellingUnit });
  const can12 = await mk("CAN-12C", "Cantinesca", "12 oz can case", "case_12oz_can", "case (24 x 12 oz)");
  const can24 = await mk("CAN-24C", "Cantinesca", "24 oz can case", "case_24oz_can", "case (12 x 24 oz)");
  const canSix = await mk("CAN-SIX", "Cantinesca", "1/6 bbl keg", "keg_sixtel", "1/6 bbl keg");
  const canHalf = await mk("CAN-HALF", "Cantinesca", "1/2 bbl keg", "keg_half", "1/2 bbl keg");
  const sun12 = await mk("SUN-12C", "Sunlight Groove", "12 oz can case", "case_12oz_can", "case (24 x 12 oz)");
  const sunSix = await mk("SUN-SIX", "Sunlight Groove", "1/6 bbl keg", "keg_sixtel", "1/6 bbl keg");
  const samplePrices: Array<[typeof can12, number]> = [
    [can12, 3600],
    [can24, 4200],
    [canSix, 9500],
    [canHalf, 17500],
    [sun12, 3400],
    [sunSix, 9000],
  ];
  for (const m of [nc, la]) for (const [s, cents] of samplePrices) await setMarketPrice(db, admin, { marketId: m.id, skuId: s.id, priceCents: cents, reason: "demo seed SAMPLE price" });
  // MA gets Cantinesca only (illustrates market-scoped catalogs).
  await setMarketPrice(db, admin, { marketId: ma.id, skuId: can12.id, priceCents: 3800, reason: "demo seed SAMPLE price" });
  await setMarketPrice(db, admin, { marketId: ma.id, skuId: canSix.id, priceCents: 9900, reason: "demo seed SAMPLE price" });

  // --- batches and lots (R2-26, R2-22): brewed at the host, packaged into lots; stock posts at the brewery (R2-37) ---
  const batchCnt = await createBatch(db, admin, { facilityWarehouseId: eastBrother.id, brandCode: "CNT", brewDate: "2026-10-01", barrels: 30, status: "in_progress", notes: "Demo batch" });
  const lotCnt = await recordPackagingReport(db, admin, { facilityWarehouseId: eastBrother.id, brandCode: "CNT", packagingDate: "2026-10-14", runCode: "1", batchId: batchCnt.id, quantities: [{ skuId: can12.id, qty: 60 }, { skuId: can24.id, qty: 20 }, { skuId: canSix.id, qty: 18 }, { skuId: canHalf.id, qty: 8 }] });
  const batchSlg = await createBatch(db, admin, { facilityWarehouseId: eastBrother.id, brandCode: "SLG", brewDate: "2026-10-03", barrels: 30, status: "in_progress" });
  const lotSlg = await recordPackagingReport(db, admin, { facilityWarehouseId: eastBrother.id, brandCode: "SLG", packagingDate: "2026-10-15", runCode: "1", batchId: batchSlg.id, quantities: [{ skuId: sun12.id, qty: 40 }, { skuId: sunSix.id, qty: 6 }] });
  const batchBwd = await createBatch(db, admin, { facilityWarehouseId: beachwood.id, brandCode: "CNT", brewDate: "2026-10-05", barrels: 20, status: "in_progress" });
  const lotBwd = await recordPackagingReport(db, admin, { facilityWarehouseId: beachwood.id, brandCode: "CNT", packagingDate: "2026-10-16", runCode: "1", batchId: batchBwd.id, quantities: [{ skuId: can12.id, qty: 40 }, { skuId: canSix.id, qty: 12 }] });

  // --- warehouse stock, lot-tagged (what the hosts shipped over before cut-over; Sunlight sixtels deliberately short) ---
  const opening = async (warehouseId: string, lotId: string, rows: Array<[typeof can12, number]>, where: string) => {
    for (const [s, qty] of rows) await recordStockMovement(db, admin, { warehouseId, skuId: s.id, kind: "opening", qtyDelta: qty, evidence: `demo seed opening count (${where} cut-over sheet)`, lotId });
  };
  await opening(ewd.id, lotCnt.id, [[can12, 40], [can24, 18], [canSix, 12], [canHalf, 6]], "EWD");
  await opening(ewd.id, lotSlg.id, [[sun12, 24], [sunSix, 2]], "EWD");
  await opening(balmuth.id, lotBwd.id, [[can12, 30], [canSix, 8]], "Balmuth");
  await opening(balmuth.id, lotSlg.id, [[sun12, 12]], "Balmuth");

  // --- accounts ---
  const loc = (marketId: string, tradeName: string, line1: string, city: string, state: string, postal: string, buyer: string, buyerEmail: string, ap?: string) =>
    createLocation(db, marketId === la.id ? salesLa : sales, {
      marketId,
      tradeName,
      deliveryAddress: { line1, city, state, postalCode: postal },
      buyer: { name: buyer, email: buyerEmail },
      ap: ap ? { name: "Accounts Payable", email: ap } : null,
      deliveryInstructions: "Deliver before 11am; ring the side bell.",
    });

  const mission = (await loc(nc.id, "Mission Taproom", "2400 Mission St", "San Francisco", "CA", "94110", "Jordan Buyer", "jordan@missiontaproom.demo", "ap@missiontaproom.demo")).location;
  const gg1 = (await loc(nc.id, "Golden Gate Grill", "88 Marina Blvd", "San Francisco", "CA", "94123", "Casey Manager", "casey@gggrill.demo")).location;
  const gg2 = (await loc(nc.id, "Golden Gate Grill", "1501 Sloat Blvd", "San Francisco", "CA", "94132", "Robin Owner", "robin@gggrill-sloat.demo")).location; // legitimate identical name
  const dogpatch = (await loc(nc.id, "Dogpatch Bottle Shop", "2200 3rd St", "San Francisco", "CA", "94107", "Alex Buyer", "alex@dogpatchbottles.demo", "ap@dogpatchbottles.demo")).location;
  const marina = (await loc(nc.id, "Marina Wine & Beer", "3200 Chestnut St", "San Francisco", "CA", "94123", "Pat Buyer", "pat@marinawb.demo")).location;
  const sunset = (await loc(nc.id, "Sunset Social Club", "1300 Judah St", "San Francisco", "CA", "94122", "Dana Buyer", "dana@sunsetsocial.demo")).location;
  const echo = (await loc(la.id, "Echo Park Cantina", "1500 Sunset Blvd", "Los Angeles", "CA", "90026", "Maria Buyer", "maria@echoparkcantina.demo", "ap@echoparkcantina.demo")).location;
  const silverlake = (await loc(la.id, "Silver Lake Wine", "2395 Glendale Blvd", "Los Angeles", "CA", "90039", "Sam Buyer", "sam@silverlakewine.demo")).location;
  const matagrano = (await loc(nc.id, "Matagrano Distributing", "2200 Pike Ave", "San Leandro", "CA", "94577", "Receiving Desk", "receiving@matagrano.demo", "ap@matagrano.demo")).location;
  await updateAccountShipping(db, admin, matagrano.id, { kind: "distributor", fulfilment: "pickup", payBy: "check", depositMode: "none" });

  // Verified accounts
  for (const l of [mission, dogpatch, marina, echo, silverlake, matagrano]) {
    await recordLicenseDecision(db, admin, { locationId: l.id, state: "verified", licenseNumber: `ABC-${l.id.slice(0, 6).toUpperCase()}`, licenseType: "ABC Type 47", evidence: "ABC license lookup (demo)" });
  }
  // Payment channel and floating deposit on file (R2-12, R2-13); one account takes its invoice on receipt (R2-30).
  await updateAccountShipping(db, admin, mission.id, { payBy: "fintech", depositMode: "floating", depositTakenCents: 10500, depositTakenOn: "2026-09-04", invoiceOnReceipt: true });
  await updateAccountShipping(db, admin, dogpatch.id, { payBy: "stripe" });
  await updateAccountShipping(db, admin, echo.id, { payBy: "check" });
  await updateAccountShipping(db, admin, silverlake.id, { payBy: "stripe", fulfilment: "pickup" });
  // The SoCal rep's home address takes samples (R2-28).
  await createRepHomeAddress(db, admin, { marketId: la.id, repEmployeeId: salesLa.employeeId!, address: { line1: "4100 Eagle Rock Blvd", city: "Los Angeles", state: "CA", postalCode: "90065" } });

  // Orders (R2-1, R2-2): the office keys them with a source; each drafts its shipment from the market's warehouse.
  // Mission: a delivered order (invoice issued, kegs posted), an open draft, a standing arrangement, a prior delivery visit.
  const m1 = await submitOrder(db, admin, { source: "phone", locationId: mission.id, lines: [{ skuId: can12.id, qty: 4 }, { skuId: canSix.id, qty: 1 }], notes: "Regular Thursday order (demo)" });
  const m1Shipment = await confirmShipment(db, admin, m1.shipment!.id, { scheduledDate: "2026-10-23" });
  await updateShipmentHeader(db, admin, m1Shipment.id, { driverEmployeeId: driver.employeeId });
  await deliverShipment(db, admin, m1Shipment.id, { actualDate: "2026-10-23", kegPickup: { halfIn: 0, sixtelIn: 1 }, lines: (await getShipment(db, m1Shipment.id))!.lines.map(({ line }) => ({ lineId: line.id, deliveredQty: line.qty })) });
  await db.insert(schema.deliveryVisit).values({ locationId: mission.id, deliveryDate: "2026-09-04", outcome: "accepted", acceptedMerchandiseCents: 23900, acceptedKegCount: 1, evidence: { demo: true, note: "phase-2 skeleton record so D01 shows as unresolved" } });
  await db.insert(schema.deliveryVisitLine).values({ visitId: (await db.select().from(schema.deliveryVisit).where(eq(schema.deliveryVisit.locationId, mission.id)))[0].id, orderId: m1.order.id, orderLineId: m1.lines[0].id, plannedQty: 4, acceptedQty: 4 });
  const m2 = await submitOrder(db, admin, { source: "email", locationId: mission.id, lines: [{ skuId: sun12.id, qty: 3 }, { skuId: can24.id, qty: 2 }], requestedDate: nextWeekday(2) });
  const m2Shipment = await confirmShipment(db, admin, m2.shipment!.id, { scheduledDate: nextWeekday(2) });
  await updateShipmentHeader(db, admin, m2Shipment.id, { driverEmployeeId: driver.employeeId });
  await createStandingArrangement(db, sales, { locationId: mission.id, lines: [{ skuId: can12.id, qty: 4 }], authorizationNote: "Buyer asked by email on 9/1 (demo)", requestedCadence: "every two weeks" });
  // Payer authority is an intentional Accounting act (never inherited from AP); then the setup invitation intent exists for the manual sender.
  const missionContacts = await db.select().from(schema.locationContact).where(eq(schema.locationContact.locationId, mission.id));
  const missionApContact = missionContacts.find((c) => c.contactRole === "ap");
  if (missionApContact) await setPayerContact(db, accounting, mission.id, missionApContact.contactId);
  await requestPaymentSetup(db, accounting, mission.id);
  await requestBillingEmailChange(db, sales, { locationId: mission.id, requestedEmail: "payables@missiontaproom.demo" });
  // One order-received notice recorded as sent through the manual process (evidence, not provider confirmation).
  const [m1Notice] = await db.select().from(schema.notice).where(eq(schema.notice.subjectId, m1.order.id));
  if (m1Notice) await recordNoticeOutcome(db, accounting, { noticeId: m1Notice.id, outcome: "sent", sentVia: "Gmail (ops@ mailbox, manual)", evidence: "demo: sent 2026-09-03 10:12, message id <demo-1@ops>" });

  // Golden Gate Grill #1: unverified; a rep order below the $90 minimum is flagged, not rejected (R2-6); its draft waits.
  await submitOrder(db, admin, { source: "rep", locationId: gg1.id, lines: [{ skuId: can12.id, qty: 2 }], requestedDate: nextWeekday(4) });

  // Dogpatch: short on Sunlight sixtels (2 on hand at EWD): the office ships what is on hand, the rest stays open (R2-5); a Sales change request.
  const dp = await submitOrder(db, admin, { source: "text", locationId: dogpatch.id, lines: [{ skuId: sunSix.id, qty: 5 }, { skuId: sun12.id, qty: 2 }], shortfallDecision: "ship_available", shortfallReason: "Buyer takes the other three sixtels next week (demo)" });
  await requestOrderChange(db, sales, { orderLineId: dp.lines[1].id, kind: "amend_qty", requestedQty: 4, reason: "Buyer wants two more cases if available (demo)" });

  // Marina: compliance hold; the order is still taken and its draft waits for the office.
  await createHold(db, admin, { locationId: marina.id, kind: "compliance", cause: "Receiving entrance unconfirmed after remodel (demo)" });
  await submitOrder(db, admin, { source: "slack", locationId: marina.id, lines: [{ skuId: canHalf.id, qty: 1 }] });

  // Golden Gate Grill #2: held because the origin was short (R2-5); nothing ships until the hold is lifted.
  await submitOrder(db, admin, { source: "phone", locationId: gg2.id, lines: [{ skuId: sunSix.id, qty: 4 }], shortfallDecision: "hold", shortfallReason: "Waiting for the next Sunlight packaging run (demo)" });

  // Sunset: closed, nothing deleted; its order was cancelled with the closure (run-off review case).
  const sunsetOrder = await submitOrder(db, admin, { source: "email", locationId: sunset.id, lines: [{ skuId: can12.id, qty: 3 }] });
  await cancelUndeliveredDemand(db, admin, sunsetOrder.order.id, "Venue closed for the season (demo)");
  await setLocationStatus(db, admin, sunset.id, "closed", "Venue closed for the season (demo)");

  // Matagrano (distributor, will-call): PO order; the numbered invoice travels in the pickup pack (R2-10, R2-11).
  const mt = await submitOrder(db, admin, { source: "po", poNumbers: ["MAT-88120"], locationId: matagrano.id, lines: [{ skuId: canHalf.id, qty: 4 }, { skuId: can12.id, qty: 20 }] });
  await confirmShipment(db, admin, mt.shipment!.id, { scheduledDate: nextWeekday(1) });

  // SoCal: Echo Park confirmed for the SoCal driver's next route day; Silver Lake (will-call) drafted; samples to the rep's home (R2-27, R2-28).
  const ep = await submitOrder(db, admin, { source: "phone", locationId: echo.id, lines: [{ skuId: can12.id, qty: 6 }, { skuId: canSix.id, qty: 2 }] });
  const epShipment = await confirmShipment(db, admin, ep.shipment!.id, { scheduledDate: nextWeekday(1) });
  await updateShipmentHeader(db, admin, epShipment.id, { driverEmployeeId: driverLa.employeeId });
  await submitOrder(db, admin, { source: "rep", locationId: silverlake.id, lines: [{ skuId: can12.id, qty: 3 }] });
  const [repHome] = (await samplesRecipients(db, la.id)).filter((r) => r.loc.repEmployeeId);
  if (repHome) {
    const smp = await submitOrder(db, admin, { source: "rep", noCharge: true, locationId: repHome.loc.id, lines: [{ skuId: can12.id, qty: 1 }, { skuId: sun12.id, qty: 1 }], notes: "Tasting kit for the Eastside accounts (demo)" });
    await confirmShipment(db, admin, smp.shipment!.id, { scheduledDate: nextWeekday(1) });
  }

  // Phase 1 sample withdrawals, kept as history (R2-27); an email waiting in intake.
  await recordSampleWithdrawal(db, sales, { marketId: nc.id, skuId: can12.id, qty: 2, withdrawnOn: "2026-09-15", notes: "Tasting at Dogpatch (demo)" });
  await recordSampleWithdrawal(db, salesLa, { marketId: la.id, skuId: sun12.id, qty: 1, withdrawnOn: "2026-09-16" });
  await recordIntakeRequest(db, admin, {
    fromEmail: "buyer@northbeachpizza.demo",
    subject: "Beer order for Friday",
    body: "Hi — can we get 3 cases of Cantinesca 12oz and one sixtel of Sunlight for Friday? Thanks, Nico (demo email)",
    marketId: nc.id,
  });

  // Run queued jobs once so the Stripe association shows its TRUTHFUL state (pending: IMPLEMENTED / NOT CONNECTED).
  await runDueJobs(db, { limit: 10, workerId: "demo-seed" });
  return { seeded: true, locations: [mission.id, gg1.id, gg2.id, dogpatch.id, marina.id, sunset.id, echo.id, silverlake.id, matagrano.id] };
}
