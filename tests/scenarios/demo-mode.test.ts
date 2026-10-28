import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { seedDemo, DEMO_OWNER_EMAIL } from "@/lib/demo/seed";
import { demoOwnerEmployeeId } from "@/lib/demo/owner";
import { loadActor } from "@/lib/domain/employees/service";
import { demoModeEnabled, devAuthBypassEnabled } from "@/lib/env";
import { createTestDb } from "../support/db";

const KEYS = ["NODE_ENV", "VERCEL", "VERCEL_ENV", "FV_ENV", "FV_DEMO", "DATABASE_URL", "DEV_AUTH_BYPASS"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

const env = process.env as Record<string, string | undefined>;

function setEnv(vars: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const k of KEYS) {
    const v = vars[k];
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete env[k];
    else env[k] = saved[k];
  }
});

describe("DEVELOPMENT DEMO MODE guards", () => {
  it("is on for a fresh development checkout (no DATABASE_URL) and with FV_DEMO=true", () => {
    setEnv({ NODE_ENV: "development" });
    expect(demoModeEnabled()).toBe(true);
    expect(devAuthBypassEnabled()).toBe(true); // implied
    setEnv({ NODE_ENV: "development", DATABASE_URL: "postgres://x", FV_DEMO: "true" });
    expect(demoModeEnabled()).toBe(true);
  });

  it("is off when a DATABASE_URL is configured (real Postgres path) unless FV_DEMO=true, and FV_DEMO=false forces it off", () => {
    setEnv({ NODE_ENV: "development", DATABASE_URL: "postgres://x" });
    expect(demoModeEnabled()).toBe(false);
    setEnv({ NODE_ENV: "development", FV_DEMO: "false" });
    expect(demoModeEnabled()).toBe(false);
  });

  it("is impossible under a production build, on Vercel production or preview, or with FV_ENV=production — even with FV_DEMO=true", () => {
    setEnv({ NODE_ENV: "production", FV_DEMO: "true" });
    expect(demoModeEnabled()).toBe(false);
    expect(devAuthBypassEnabled()).toBe(false);
    setEnv({ NODE_ENV: "development", FV_DEMO: "true", VERCEL: "1", VERCEL_ENV: "preview" });
    expect(demoModeEnabled()).toBe(false);
    setEnv({ NODE_ENV: "development", FV_DEMO: "true", VERCEL_ENV: "production" });
    expect(demoModeEnabled()).toBe(false);
    setEnv({ NODE_ENV: "development", FV_DEMO: "true", FV_ENV: "production" });
    expect(demoModeEnabled()).toBe(false);
    // production also disables the plain dev bypass
    setEnv({ NODE_ENV: "production", DEV_AUTH_BYPASS: "true" });
    expect(devAuthBypassEnabled()).toBe(false);
  });
});

describe("Demo seed", () => {
  it("seeds representative data through the real services, is idempotent, provides the demo Owner, and refuses in production", async () => {
    const { db, close } = await createTestDb();
    try {
      setEnv({ NODE_ENV: "test", FV_ENV: "test" });
      const first = await seedDemo(db);
      expect(first.seeded).toBe(true);
      const second = await seedDemo(db);
      expect(second.seeded).toBe(false);
      const markets = await db.select().from(schema.market);
      expect(markets.map((m) => m.code).sort()).toEqual(["LA", "MA", "NC"]);
      const locations = await db.select().from(schema.customerLocation);
      expect(locations.length).toBeGreaterThanOrEqual(7);
      expect(locations.filter((l) => l.tradeName === "Golden Gate Grill")).toHaveLength(2); // legitimate identical names
      const orders = await db.select().from(schema.order);
      expect(orders.length).toBeGreaterThanOrEqual(7);
      const openCases = await db.select().from(schema.exceptionCase).where(eq(schema.exceptionCase.state, "open"));
      const categories = new Set(openCases.map((c) => c.category));
      for (const c of ["license_unverified", "allocation_shortage", "below_minimum", "hold", "closure_review", "billing_email_change", "email_intake", "payment_setup_pending"]) {
        expect(categories.has(c)).toBe(true);
      }
      // Provider truth: the Stripe association stays pending / not connected — never simulated as established.
      const refs = await db.select().from(schema.providerReference);
      expect(refs.length).toBeGreaterThanOrEqual(1);
      expect(refs.every((r) => r.status === "pending" && r.providerId === null)).toBe(true);
      // Decisions remain unselected; gates unproven.
      expect((await db.select().from(schema.decision)).every((d) => d.status === "unselected")).toBe(true);
      expect((await db.select().from(schema.capabilityGate)).every((g) => g.status === "unproven")).toBe(true);
      // Demo Owner is a real employee with an Owner grant.
      const ownerId = await demoOwnerEmployeeId(db);
      expect(ownerId).not.toBeNull();
      const owner = await loadActor(db, ownerId!, "dev_fixture");
      expect(owner?.email).toBe(DEMO_OWNER_EMAIL);
      expect(owner?.grants.some((g) => g.role === "owner")).toBe(true);
      // Refuses in production.
      setEnv({ NODE_ENV: "production" });
      await expect(seedDemo(db)).rejects.toThrow(/production/);
    } finally {
      await close();
    }
  });
});
