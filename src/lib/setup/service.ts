import { readFileSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { SYSTEM_ACTOR } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import { withTx, type Db } from "@/lib/db/types";
import { validatePinPolicy } from "@/lib/auth/pin";
import { setEmployeePin } from "@/lib/domain/employees/credentials";
import { demoModeEnabled, envPresent } from "@/lib/env";
import { BusinessError } from "@/lib/errors";
import { seedGates } from "@/lib/integrations/gates";
import { seedShipmentDefaults } from "@/lib/domain/settings/service";
import { seedDecisionRegister } from "@/lib/policy/policy";

/**
 * Browser-driven setup for a deployment that has no terminal access to the
 * database: apply pending migrations, seed the decision register (unselected)
 * and capability gates (unproven), and provision the first Owner with a
 * temporary PIN. Every action needs the setup token (the CRON_SECRET the
 * deployment already holds); nothing here is reachable without it, and the
 * Owner step refuses once any Owner exists — later people are provisioned
 * in the app by that Owner. Equivalent to `npm run db:migrate` + `npm run
 * bootstrap`; the scripts remain for operators who prefer a terminal.
 */
export interface SetupStatus {
  databaseConfigured: boolean;
  tokenConfigured: boolean;
  journal: string[];
  applied: number | null;
  pending: string[];
  ownerExists: boolean;
  ownerEmail: string | null;
}

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

export function journalTags(): string[] {
  const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8")) as { entries: Array<{ tag: string }> };
  return journal.entries.map((e) => e.tag);
}

export function setupTokenMatches(token: string): boolean {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected || expected.length < 16) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function appliedMigrations(db: Db): Promise<number | null> {
  try {
    const res = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    const rows = (res as unknown as { rows?: Array<{ n: number }> }).rows ?? (res as unknown as Array<{ n: number }>);
    return Number(rows[0]?.n ?? 0);
  } catch {
    return null; // the migrations table does not exist yet: nothing applied
  }
}

async function currentOwner(db: Db): Promise<{ employeeId: string; email: string | null } | null> {
  const [grant] = await db
    .select({ employeeId: schema.roleGrant.employeeId })
    .from(schema.roleGrant)
    .where(and(eq(schema.roleGrant.role, "owner"), isNull(schema.roleGrant.revokedAt)))
    .limit(1);
  if (!grant) return null;
  const [identity] = await db
    .select({ email: schema.employeeIdentity.email })
    .from(schema.employeeIdentity)
    .where(and(eq(schema.employeeIdentity.employeeId, grant.employeeId), eq(schema.employeeIdentity.current, true)))
    .limit(1);
  return { employeeId: grant.employeeId, email: identity?.email ?? null };
}

export async function setupStatus(db: Db | null): Promise<SetupStatus> {
  const journal = journalTags();
  const base: SetupStatus = { databaseConfigured: demoModeEnabled() || envPresent("DATABASE_URL"), tokenConfigured: (process.env.CRON_SECRET ?? "").length >= 16, journal, applied: null, pending: journal, ownerExists: false, ownerEmail: null };
  if (!db) return base;
  const applied = await appliedMigrations(db);
  const pending = applied === null ? journal : journal.slice(applied);
  let owner: { employeeId: string; email: string | null } | null = null;
  if (pending.length === 0) owner = await currentOwner(db);
  return { ...base, applied, pending, ownerExists: Boolean(owner), ownerEmail: owner?.email ?? null };
}

/** Apply pending SQL migrations with the migrator that matches the runtime database. Idempotent. */
export async function applyMigrations(db: Db): Promise<{ before: number | null; after: number | null }> {
  const before = await appliedMigrations(db);
  if (demoModeEnabled()) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
  }
  await seedDecisionRegister(db);
  await seedGates(db);
  await seedShipmentDefaults(db);
  const after = await appliedMigrations(db);
  await db.insert(schema.auditEvent).values({ actorKind: "system", action: "setup.migrate", subjectType: "database", subjectId: "migrations", prior: { applied: before }, current: { applied: after } });
  return { before, after };
}

/** Provision the first Owner with a temporary PIN. Refuses when any Owner already exists. */
export async function provisionFirstOwner(db: Db, input: { email: string; name: string; pin: string }) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BusinessError("A valid company email is required", { field: "email" });
  if (!name) throw new BusinessError("A display name is required", { field: "name" });
  if (await currentOwner(db)) throw new BusinessError("An Owner already exists. Further people are provisioned by that Owner under Employees & access.");
  const [existing] = await db
    .select()
    .from(schema.employeeIdentity)
    .where(and(eq(schema.employeeIdentity.email, email), eq(schema.employeeIdentity.current, true)))
    .limit(1);
  if (existing) throw new BusinessError("That email already belongs to an employee record; sign in as the Owner and grant from Employees & access.", { field: "email" });
  validatePinPolicy(input.pin, "pin");
  return withTx(db, async (tx) => {
    const [emp] = await tx.insert(schema.employee).values({ displayName: name }).returning();
    await tx.insert(schema.employeeIdentity).values({ employeeId: emp.id, email });
    await tx.insert(schema.roleGrant).values({ employeeId: emp.id, role: "owner", marketId: null });
    await tx.insert(schema.auditEvent).values({ actorKind: "system", action: "employee.bootstrap_owner", subjectType: "employee", subjectId: emp.id, current: { email, via: "setup page" } });
    await setEmployeePin(tx, SYSTEM_ACTOR, emp.id, input.pin, { reason: "temporary PIN from the setup page", mustChange: true });
    return { employeeId: emp.id, email };
  });
}
