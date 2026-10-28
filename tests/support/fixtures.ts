import type { Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { recordStockMovement } from "@/lib/domain/allocation/service";
import { createSku, setMarketPrice } from "@/lib/domain/catalog/service";
import { createLocation, type CreateLocationInput } from "@/lib/domain/customers/service";
import { grantRole, loadActor } from "@/lib/domain/employees/service";
import { createMarket, createWarehouse } from "@/lib/domain/markets/service";
import { seedGates } from "@/lib/integrations/gates";
import { seedDecisionRegister } from "@/lib/policy/policy";

/**
 * Representative fixture (brief §53): one market, a primary warehouse, a
 * multi-package catalog with market prices, one employee per role.
 * Everything goes through the domain services so the fixture itself
 * exercises authorization and audit.
 */
export interface Fixture {
  owner: Actor;
  admin: Actor;
  accounting: Actor;
  sales: Actor;
  sales2: Actor;
  driver: Actor;
  market: typeof schema.market.$inferSelect;
  market2: typeof schema.market.$inferSelect;
  warehouse: typeof schema.warehouse.$inferSelect;
  skus: {
    cantinescaCase: typeof schema.sku.$inferSelect;
    cantinescaSixtel: typeof schema.sku.$inferSelect;
    sunlightHalf: typeof schema.sku.$inferSelect;
    sunlightCase: typeof schema.sku.$inferSelect;
  };
}

export async function bootstrapOwner(db: Db, name = "Owner Fixture", email = "owner@example.test"): Promise<Actor> {
  const [emp] = await db.insert(schema.employee).values({ displayName: name }).returning();
  await db.insert(schema.employeeIdentity).values({ employeeId: emp.id, email, googleSubject: `sub-${emp.id}` });
  await db.insert(schema.roleGrant).values({ employeeId: emp.id, role: "owner", marketId: null });
  return (await loadActor(db, emp.id))!;
}

export async function makeEmployee(db: Db, by: Actor, name: string, email: string, role: Actor["grants"][number]["role"], marketId: string | null): Promise<Actor> {
  const [emp] = await db.insert(schema.employee).values({ displayName: name }).returning();
  await db.insert(schema.employeeIdentity).values({ employeeId: emp.id, email, googleSubject: `sub-${emp.id}` });
  await grantRole(db, by, emp.id, role, marketId);
  return (await loadActor(db, emp.id))!;
}

export async function buildFixture(db: Db): Promise<Fixture> {
  await seedDecisionRegister(db);
  await seedGates(db);
  const owner = await bootstrapOwner(db);
  const market = await createMarket(db, owner, { code: "NC", name: "NorCal / Bay Area" });
  const market2 = await createMarket(db, owner, { code: "MA", name: "Massachusetts" });
  const warehouse = await createWarehouse(db, owner, { marketId: market.id, name: "East Brother (Richmond)", isPrimary: true, fulfillmentContact: "host brewery" });
  await createWarehouse(db, owner, { marketId: market2.id, name: "Jack's Abby (Framingham)", isPrimary: true });
  const admin = await makeEmployee(db, owner, "Ada Admin", "ada@example.test", "admin", null);
  const accounting = await makeEmployee(db, owner, "Al Accounting", "al@example.test", "accounting", null);
  const sales = await makeEmployee(db, owner, "Sam Sales", "sam@example.test", "sales", market.id);
  const sales2 = await makeEmployee(db, owner, "Mia Sales (MA)", "mia@example.test", "sales", market2.id);
  const driver = await makeEmployee(db, owner, "Dee Driver", "dee@example.test", "driver_service", market.id);

  const cantinescaCase = await createSku(db, admin, { code: "CAN-12C", name: "Cantinesca 12 oz case", brand: "Cantinesca", packageKind: "case_12oz_can", sellingUnit: "case (24 × 12 oz)" });
  const cantinescaSixtel = await createSku(db, admin, { code: "CAN-SIX", name: "Cantinesca 1/6 bbl", brand: "Cantinesca", packageKind: "keg_sixtel", sellingUnit: "1/6 bbl keg" });
  const sunlightHalf = await createSku(db, admin, { code: "SUN-HALF", name: "Sunlight Groove 1/2 bbl", brand: "Sunlight Groove", packageKind: "keg_half", sellingUnit: "1/2 bbl keg" });
  const sunlightCase = await createSku(db, admin, { code: "SUN-24C", name: "Sunlight Groove 24 oz case", brand: "Sunlight Groove", packageKind: "case_24oz_can", sellingUnit: "case (12 × 24 oz)" });
  await setMarketPrice(db, admin, { marketId: market.id, skuId: cantinescaCase.id, priceCents: 3600 });
  await setMarketPrice(db, admin, { marketId: market.id, skuId: cantinescaSixtel.id, priceCents: 9500 });
  await setMarketPrice(db, admin, { marketId: market.id, skuId: sunlightHalf.id, priceCents: 17500 });
  await setMarketPrice(db, admin, { marketId: market.id, skuId: sunlightCase.id, priceCents: 4200 });
  await setMarketPrice(db, admin, { marketId: market2.id, skuId: cantinescaCase.id, priceCents: 3800 });

  for (const s of [cantinescaCase, cantinescaSixtel, sunlightHalf, sunlightCase]) {
    await recordStockMovement(db, admin, { warehouseId: warehouse.id, skuId: s.id, kind: "opening", qtyDelta: 20, evidence: "opening count confirmed with host brewery" });
  }
  return { owner, admin, accounting, sales, sales2, driver, market, market2, warehouse, skus: { cantinescaCase, cantinescaSixtel, sunlightHalf, sunlightCase } };
}

export function locationInput(marketId: string, tradeName: string, overrides: Partial<CreateLocationInput> = {}): CreateLocationInput {
  return {
    marketId,
    tradeName,
    deliveryAddress: { line1: "100 Main St", city: "Oakland", state: "CA", postalCode: "94607" },
    buyer: { name: "Bo Buyer", email: `buyer+${tradeName.replace(/\W+/g, "").toLowerCase()}@example.test` },
    ap: { name: "Pat Payables", email: "ap@shared-ap.example.test" },
    deliveryInstructions: "Back door, before 11am",
    ...overrides,
  };
}

export async function makeLocation(db: Db, actor: Actor, marketId: string, tradeName: string, overrides: Partial<CreateLocationInput> = {}) {
  return createLocation(db, actor, locationInput(marketId, tradeName, overrides));
}
