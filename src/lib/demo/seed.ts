import { eq } from "drizzle-orm";
import type { Actor, Role } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { recordStockMovement } from "@/lib/domain/allocation/service";
import { createSku, setMarketPrice } from "@/lib/domain/catalog/service";
import { createLocation, recordLicenseDecision, requestBillingEmailChange, setLocationStatus } from "@/lib/domain/customers/service";
import { grantRole, loadActor } from "@/lib/domain/employees/service";
import { createHold } from "@/lib/domain/holds/service";
import { recordIntakeRequest } from "@/lib/domain/intake/service";
import { createMarket, createWarehouse } from "@/lib/domain/markets/service";
import { requestOrderChange, submitOrder } from "@/lib/domain/orders/service";
import { requestPaymentSetup, setPayerContact } from "@/lib/domain/payment/service";
import { recordNoticeOutcome } from "@/lib/domain/notices/service";
import { demoModeEnabled, isDeployment } from "@/lib/env";
import { recordSampleWithdrawal } from "@/lib/domain/samples/service";
import { createStandingArrangement } from "@/lib/domain/standing/service";
import { seedGates } from "@/lib/integrations/gates";
import { runDueJobs } from "@/lib/jobs/queue";
import { seedDecisionRegister } from "@/lib/policy/policy";
import "@/lib/integrations/stripe/adapter"; // registers job handlers
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

  // --- markets & warehouses (asset-light: host breweries hold stock) ---
  const nc = await createMarket(db, owner, { code: "NC", name: "NorCal / Bay Area" });
  const la = await createMarket(db, owner, { code: "LA", name: "Greater Los Angeles" });
  const ma = await createMarket(db, owner, { code: "MA", name: "Massachusetts", timezone: "America/New_York" });
  const eastBrother = await createWarehouse(db, owner, { marketId: nc.id, name: "East Brother Beer Co. (Richmond, CA)", isPrimary: true, fulfillmentContact: "host brewery cellar lead" });
  await createWarehouse(db, owner, { marketId: nc.id, name: "Overflow cold storage (Oakland)", isPrimary: false, fulfillmentContact: "3PL desk" });
  const beachwood = await createWarehouse(db, owner, { marketId: la.id, name: "Beachwood (Huntington Beach, CA)", isPrimary: true, fulfillmentContact: "host brewery" });
  await createWarehouse(db, owner, { marketId: ma.id, name: "Jack's Abby (Framingham, MA)", isPrimary: true, fulfillmentContact: "host brewery" });

  const admin = await person("Ada Admin", "admin@demo.local", "admin", null, owner);
  const accounting = await person("Al Accounting", "accounting@demo.local", "accounting", null, owner);
  const sales = await person("Sam Sales (NC)", "sales-nc@demo.local", "sales", nc.id, owner);
  const salesLa = await person("Lee Sales (LA)", "sales-la@demo.local", "sales", la.id, owner);
  await person("Dee Driver", "driver@demo.local", "driver_service", nc.id, owner);

  // --- catalog & SAMPLE prices ---
  const mk = (code: string, brand: string, name: string, packageKind: Parameters<typeof createSku>[2]["packageKind"], sellingUnit: string) =>
    createSku(db, admin, { code, name, brand, packageKind, sellingUnit });
  const can12 = await mk("CAN-12C", "Cantinesca", "12 oz can case", "case_12oz_can", "case (24 × 12 oz)");
  const can24 = await mk("CAN-24C", "Cantinesca", "24 oz can case", "case_24oz_can", "case (12 × 24 oz)");
  const canSix = await mk("CAN-SIX", "Cantinesca", "1/6 bbl keg", "keg_sixtel", "1/6 bbl keg");
  const canHalf = await mk("CAN-HALF", "Cantinesca", "1/2 bbl keg", "keg_half", "1/2 bbl keg");
  const sun12 = await mk("SUN-12C", "Sunlight Groove", "12 oz can case", "case_12oz_can", "case (24 × 12 oz)");
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

  // --- opening stock (evidence-backed; Sunlight sixtels deliberately short) ---
  const opening: Array<[typeof can12, number]> = [
    [can12, 40],
    [can24, 18],
    [canSix, 12],
    [canHalf, 6],
    [sun12, 24],
    [sunSix, 2],
  ];
  for (const [s, qty] of opening) await recordStockMovement(db, admin, { warehouseId: eastBrother.id, skuId: s.id, kind: "opening", qtyDelta: qty, evidence: "demo seed opening count (host brewery cellar sheet)" });
  for (const [s, qty] of [[can12, 30], [canSix, 8], [sun12, 12]] as Array<[typeof can12, number]>) await recordStockMovement(db, admin, { warehouseId: beachwood.id, skuId: s.id, kind: "opening", qtyDelta: qty, evidence: "demo seed opening count" });

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

  // Verified accounts
  for (const l of [mission, dogpatch, marina, echo]) {
    await recordLicenseDecision(db, admin, { locationId: l.id, state: "verified", licenseNumber: `ABC-${l.id.slice(0, 6).toUpperCase()}`, licenseType: "ABC Type 47", evidence: "ABC license lookup (demo)" });
  }

  // Orders — Mission: two orders + a standing arrangement + an accepted prior delivery (phase-2 skeleton fact)
  const m1 = await submitOrder(db, sales, { locationId: mission.id, lines: [{ skuId: can12.id, qty: 4 }, { skuId: canSix.id, qty: 1 }], notes: "Regular Thursday order (demo)" });
  await db.insert(schema.deliveryVisit).values({ locationId: mission.id, deliveryDate: "2026-09-04", outcome: "accepted", acceptedMerchandiseCents: 23900, acceptedKegCount: 1, evidence: { demo: true, note: "phase-2 skeleton record so D01 shows as unresolved" } });
  await db.insert(schema.deliveryVisitLine).values({ visitId: (await db.select().from(schema.deliveryVisit).where(eq(schema.deliveryVisit.locationId, mission.id)))[0].id, orderId: m1.order.id, orderLineId: m1.lines[0].id, plannedQty: 4, acceptedQty: 4 });
  await submitOrder(db, sales, { locationId: mission.id, lines: [{ skuId: sun12.id, qty: 3 }, { skuId: can24.id, qty: 2 }] });
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

  // Golden Gate Grill #1: unverified, below-minimum order → flagged, not rejected
  await submitOrder(db, sales, { locationId: gg1.id, lines: [{ skuId: can12.id, qty: 2 }], requestedDate: "2026-09-19" });

  // Dogpatch: shortage on Sunlight sixtels (only 2 on hand) → retained unmet demand + Admin case; a Sales change request
  const dp = await submitOrder(db, sales, { locationId: dogpatch.id, lines: [{ skuId: sunSix.id, qty: 5 }, { skuId: sun12.id, qty: 2 }] });
  await requestOrderChange(db, sales, { orderLineId: dp.lines[1].id, kind: "amend_qty", requestedQty: 4, reason: "Buyer wants two more cases if available (demo)" });

  // Marina: compliance hold — order still captured
  await createHold(db, admin, { locationId: marina.id, kind: "compliance", cause: "Receiving entrance unconfirmed after remodel (demo)" });
  await submitOrder(db, sales, { locationId: marina.id, lines: [{ skuId: canHalf.id, qty: 1 }] });

  // Sunset: closed → run-off review case (nothing deleted)
  await submitOrder(db, sales, { locationId: sunset.id, lines: [{ skuId: can12.id, qty: 3 }] });
  await setLocationStatus(db, admin, sunset.id, "closed", "Venue closed for the season (demo)");

  // Echo Park (LA): verified, one order
  await submitOrder(db, salesLa, { locationId: echo.id, lines: [{ skuId: can12.id, qty: 6 }, { skuId: canSix.id, qty: 2 }] });

  // Samples and email intake
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
  return { seeded: true, locations: [mission.id, gg1.id, gg2.id, dogpatch.id, marina.id, sunset.id, echo.id] };
}
