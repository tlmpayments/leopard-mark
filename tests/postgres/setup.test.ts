import { eq, and } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { signInWithPin } from "@/lib/domain/employees/credentials";
import { applyMigrations, provisionFirstOwner, setupStatus, setupTokenMatches } from "@/lib/setup/service";
import { createPgTestDb, pgAvailable } from "../support/pg";

/**
 * Browser-driven setup (/setup) against a real, EMPTY Postgres: the same
 * path a fresh Neon database takes on Vercel. Migrations apply in order and
 * are idempotent; the register and gates are seeded; exactly one first Owner
 * can be provisioned with a temporary PIN; the token check is strict.
 */
const run = pgAvailable() ? describe : describe.skip;
const env = process.env as Record<string, string | undefined>;
const saved = { DATABASE_URL: env.DATABASE_URL, CRON_SECRET: env.CRON_SECRET, FV_DEMO: env.FV_DEMO };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
});

run("Setup page service on an empty real database", () => {
  it("reports nothing applied, applies every migration once, seeds register + gates, provisions one Owner with a must-change PIN, refuses a second Owner and wrong tokens", async () => {
    const { db, url, close } = await createPgTestDb({ migrate: false });
    env.DATABASE_URL = url; // the service picks the node-postgres migrator when not in demo mode
    env.FV_DEMO = "false";
    env.CRON_SECRET = "setup-token-for-this-test-only";
    try {
      const fresh = await setupStatus(db);
      expect(fresh.applied).toBeNull();
      expect(fresh.pending.length).toBe(fresh.journal.length);
      expect(fresh.pending.length).toBeGreaterThanOrEqual(4);
      expect(fresh.ownerExists).toBe(false);
      const first = await applyMigrations(db);
      expect(first.before).toBeNull();
      expect(first.after).toBe(fresh.journal.length);
      const again = await applyMigrations(db);
      expect(again.after).toBe(first.after); // idempotent
      const decisions = await db.select().from(schema.decision);
      expect(decisions.length).toBe(66);
      expect(decisions.every((d) => d.status === "unselected")).toBe(true);
      expect((await db.select().from(schema.capabilityGate)).length).toBeGreaterThan(5);
      const mid = await setupStatus(db);
      expect(mid.pending).toEqual([]);
      expect(mid.ownerExists).toBe(false);
      // Token check: exact match only, and never on a short/missing secret.
      expect(setupTokenMatches("setup-token-for-this-test-only")).toBe(true);
      expect(setupTokenMatches("setup-token-for-this-test-onl")).toBe(false);
      expect(setupTokenMatches("")).toBe(false);
      env.CRON_SECRET = "short";
      expect(setupTokenMatches("short")).toBe(false);
      // First Owner with a temporary PIN; signs in; must change; a second Owner is refused.
      await expect(provisionFirstOwner(db, { email: "not-an-email", name: "L", pin: "482157" })).rejects.toThrow(/valid company email/);
      await expect(provisionFirstOwner(db, { email: "owner@example.test", name: "L", pin: "123456" })).rejects.toThrow(/straight run/);
      const owner = await provisionFirstOwner(db, { email: "Owner@Example.test", name: "L", pin: "482157" });
      expect(owner.email).toBe("owner@example.test");
      const grants = await db.select().from(schema.roleGrant).where(and(eq(schema.roleGrant.employeeId, owner.employeeId), eq(schema.roleGrant.role, "owner")));
      expect(grants).toHaveLength(1);
      const signedIn = await signInWithPin(db, { email: "owner@example.test", pin: "482157" });
      expect(signedIn.outcome === "ok" && signedIn.mustChange).toBe(true);
      await expect(provisionFirstOwner(db, { email: "second@example.test", name: "X", pin: "907315" })).rejects.toThrow(/Owner already exists/);
      const done = await setupStatus(db);
      expect(done.ownerExists).toBe(true);
      expect(done.ownerEmail).toBe("owner@example.test");
      // The setup audit trail exists and carries no PIN value.
      const audits = await db.select().from(schema.auditEvent);
      expect(audits.some((a) => a.action === "setup.migrate")).toBe(true);
      expect(audits.some((a) => a.action === "employee.bootstrap_owner")).toBe(true);
      expect(JSON.stringify(audits)).not.toContain("482157");
    } finally {
      await close();
    }
  }, 120_000);
});
