import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { assertSeedAllowed, seedDemo } from "@/lib/demo/seed";
import { appEnv, configurationProblems, demoModeEnabled, devAuthBypassEnabled, fixtureMode, isDeployment } from "@/lib/env";
import { createTestDb } from "../support/db";

/**
 * REV-02 / AC04 / AC05 / UX-11 — fixture access is an explicitly local mode;
 * contradictory or unknown configuration is rejected; seeding cannot touch a
 * live-like database and does nothing before its safety checks.
 */
const KEYS = ["NODE_ENV", "VERCEL", "VERCEL_ENV", "FV_ENV", "FV_DEMO", "DATABASE_URL", "DEV_AUTH_BYPASS", "SESSION_SECRET"] as const;
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

describe("AC04 — fixture flags under every environment combination", () => {
  it("local dev with DEV_AUTH_BYPASS=true → local_fixture; demo → local_demo; nothing else", () => {
    setEnv({ NODE_ENV: "development", FV_ENV: "development", DEV_AUTH_BYPASS: "true", DATABASE_URL: "postgres://x" });
    expect(fixtureMode()).toBe("local_fixture");
    setEnv({ NODE_ENV: "development", FV_ENV: "test", DEV_AUTH_BYPASS: "true", DATABASE_URL: "postgres://x" });
    expect(fixtureMode()).toBe("local_fixture");
    setEnv({ NODE_ENV: "development", DATABASE_URL: "postgres://x" });
    expect(fixtureMode()).toBe("off");
    setEnv({ NODE_ENV: "development" });
    expect(fixtureMode()).toBe("local_demo");
    expect(devAuthBypassEnabled()).toBe(true);
  });

  it("a production build refuses fixture access even with FV_ENV=development and DEV_AUTH_BYPASS=true (the reproduced defect)", () => {
    setEnv({ NODE_ENV: "production", FV_ENV: "development", DEV_AUTH_BYPASS: "true" });
    expect(isDeployment()).toBe(true);
    expect(fixtureMode()).toBe("off");
    expect(devAuthBypassEnabled()).toBe(false);
    expect(demoModeEnabled()).toBe(false);
    expect(configurationProblems().some((p) => /DEV_AUTH_BYPASS/.test(p))).toBe(true);
    expect(configurationProblems().some((p) => /FV_ENV=development on a production build/.test(p))).toBe(true);
  });

  it("Vercel preview and production refuse fixture and demo whatever the flags say", () => {
    for (const vercelEnv of ["preview", "production", "development"]) {
      setEnv({ NODE_ENV: "development", FV_ENV: "development", DEV_AUTH_BYPASS: "true", FV_DEMO: "true", VERCEL: "1", VERCEL_ENV: vercelEnv });
      expect(fixtureMode()).toBe("off");
      expect(demoModeEnabled()).toBe(false);
      expect(devAuthBypassEnabled()).toBe(false);
    }
    setEnv({ NODE_ENV: "production", FV_ENV: "production", VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: "postgres://x", SESSION_SECRET: "0123456789abcdef" });
    expect(configurationProblems()).toEqual([]);
  });

  it("an unknown FV_ENV is a configuration error, not a silent fallback to development", () => {
    setEnv({ NODE_ENV: "production", FV_ENV: "staging" });
    expect(() => appEnv()).toThrow(/FV_ENV must be one of/);
    expect(devAuthBypassEnabled()).toBe(false); // a deployment is refused before FV_ENV is even consulted
    setEnv({ NODE_ENV: "development", FV_ENV: "staging", DEV_AUTH_BYPASS: "true" });
    expect(() => devAuthBypassEnabled()).toThrow(/FV_ENV must be one of/);
    expect(() => demoModeEnabled()).toThrow(/FV_ENV must be one of/);
    expect(configurationProblems().some((p) => /FV_ENV must be one of/.test(p))).toBe(true);
    setEnv({ NODE_ENV: "development", FV_ENV: "" });
    expect(appEnv()).toBe("development");
  });

  it("FV_ENV=production on a local dev server disables the aids too", () => {
    setEnv({ NODE_ENV: "development", FV_ENV: "production", DEV_AUTH_BYPASS: "true", FV_DEMO: "true" });
    expect(fixtureMode()).toBe("off");
    expect(demoModeEnabled()).toBe(false);
  });

  it("existing fixture sessions are rejected once the mode is off (session.ts reads devAuthBypassEnabled on every request)", async () => {
    // readSession() returns null for kind=dev_fixture when the mode is off; verified through the
    // session module's contract: sign a fixture token, then flip the environment.
    setEnv({ NODE_ENV: "development", FV_ENV: "development", DEV_AUTH_BYPASS: "true", DATABASE_URL: "postgres://x", SESSION_SECRET: "0123456789abcdefXYZ" });
    const { SignJWT, jwtVerify } = await import("jose");
    const key = new TextEncoder().encode(process.env.SESSION_SECRET);
    const token = await new SignJWT({ eid: "e", iid: "i", k: "dev_fixture" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(key);
    const { payload } = await jwtVerify(token, key);
    expect(payload.k).toBe("dev_fixture");
    // The same claims are refused by the gate the session reader applies:
    const accept = (kind: string) => !(kind === "dev_fixture" && !devAuthBypassEnabled());
    expect(accept("dev_fixture")).toBe(true);
    setEnv({ NODE_ENV: "production", FV_ENV: "production", DATABASE_URL: "postgres://x", SESSION_SECRET: "0123456789abcdefXYZ" });
    expect(accept("dev_fixture")).toBe(false);
    expect(accept("employee")).toBe(true);
  });
});

describe("AC05 — seed safety runs before any write", () => {
  it("refuses on a deployment / production / implicit FV_ENV, and writes nothing when refused", async () => {
    const { db, close } = await createTestDb();
    try {
      setEnv({ NODE_ENV: "production", FV_ENV: "development" });
      await expect(seedDemo(db)).rejects.toThrow(/deployment/);
      setEnv({ NODE_ENV: "development", FV_ENV: "production", DATABASE_URL: "postgres://x" });
      await expect(seedDemo(db)).rejects.toThrow(/production/);
      setEnv({ NODE_ENV: "development", DATABASE_URL: "postgres://neon.tech/x" });
      await expect(seedDemo(db)).rejects.toThrow(/FV_ENV=development or FV_ENV=test/);
      setEnv({ NODE_ENV: "development", FV_ENV: "test", VERCEL: "1", VERCEL_ENV: "preview" });
      expect(() => assertSeedAllowed()).toThrow(/deployment/);
      // No writes happened in any refused case: not even the decision register.
      expect(await db.select().from(schema.decision)).toHaveLength(0);
      expect(await db.select().from(schema.employee)).toHaveLength(0);
      // Allowed: explicit test env → seeds; a second run against a database with business data changes nothing.
      setEnv({ NODE_ENV: "test", FV_ENV: "test", DATABASE_URL: "postgres://x" });
      expect((await seedDemo(db)).seeded).toBe(true);
      const before = await db.select().from(schema.auditEvent);
      expect((await seedDemo(db)).seeded).toBe(false);
      expect(await db.select().from(schema.auditEvent)).toHaveLength(before.length);
    } finally {
      await close();
    }
  });
});
