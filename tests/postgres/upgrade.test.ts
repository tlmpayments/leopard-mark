import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { Client, Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { loadActor } from "@/lib/domain/employees/service";
import { submitOrder } from "@/lib/domain/orders/service";
import { PG_URL, pgAvailable } from "../support/pg";

/**
 * AC37 — upgrade of a representative POPULATED database from the previous
 * supported revision (baseline commit 884684c, migrations 0000+0001, demo
 * data) to the current revision. Also proves the preflight: pre-existing
 * invalid data stops the migration with a diagnostic and changes nothing.
 * Requires TEST_DATABASE_URL; otherwise skipped (reported as not run).
 */
const run = pgAvailable() ? describe : describe.skip;
if (!pgAvailable()) console.warn("[tests/postgres] TEST_DATABASE_URL not set — upgrade scenario SKIPPED (not run).");

const dump = path.join(process.cwd(), "tests/support/fixtures/baseline-884684c.sql");
const created: string[] = [];

async function restoreBaseline(): Promise<{ db: Db; pool: Pool; name: string }> {
  const name = `fv_upg_${randomBytes(4).toString("hex")}`;
  const admin = new Client({ connectionString: PG_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  created.push(name);
  const url = new URL(PG_URL!);
  url.pathname = `/${name}`;
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  await c.query(readFileSync(dump, "utf8"));
  await c.end();
  const pool = new Pool({ connectionString: url.toString(), max: 4 });
  return { db: drizzle(pool, { schema }) as unknown as Db, pool, name };
}

afterAll(async () => {
  if (!pgAvailable()) return;
  const admin = new Client({ connectionString: PG_URL });
  await admin.connect();
  for (const name of created) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const { rows } = await admin.query(`select count(*)::int as n from pg_stat_activity where datname = $1`, [name]);
      if (rows[0].n === 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }
  await admin.end();
});

run("AC37 — upgrade from the previous revision", () => {
  it("applies 0002 to the populated baseline, keeps every business record, adds the constraints, and the upgraded data works with current services", async () => {
    const { db, pool } = await restoreBaseline();
    const before = {
      orders: (await pool.query("select count(*)::int as n from customer_order")).rows[0].n,
      audit: (await pool.query("select count(*)::int as n from audit_event")).rows[0].n,
      migrations: (await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n,
      refs: (await pool.query("select status from provider_reference")).rows,
    };
    expect(before.migrations).toBe(2);
    expect(before.orders).toBeGreaterThan(0);
    // An ESTABLISHED reference recorded by the previous revision carries no provider account: the migration must mark it
    // stale (re-verify against the connected account) rather than trust it under whatever key comes next.
    const [legacyPending] = (await pool.query("select id from provider_reference where status = 'pending' limit 1")).rows;
    await pool.query("update provider_reference set status = 'established', provider_id = 'cus_legacy_test' where id = $1", [legacyPending.id]);
    await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    expect((await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n).toBe(3);
    expect((await pool.query("select count(*)::int as n from customer_order")).rows[0].n).toBe(before.orders);
    expect((await pool.query("select count(*)::int as n from audit_event")).rows[0].n).toBe(before.audit);
    // Constraints and indexes exist.
    const cons = (await pool.query("select conname from pg_constraint where conname in ('stock_position_qty_chk','order_line_qty_chk','reservation_qty_chk','sample_qty_chk','job_status_chk')")).rows.map((r) => r.conname);
    expect(cons.sort()).toEqual(["job_status_chk", "order_line_qty_chk", "reservation_qty_chk", "sample_qty_chk", "stock_position_qty_chk"]);
    const idx = (await pool.query("select indexname from pg_indexes where indexname in ('order_intake_request_uq','notice_pending_dedupe_uq','employee_identity_current_employee_uq','license_verification_current_uq','payment_relationship_current_uq')")).rows.length;
    expect(idx).toBe(5);
    // Legacy pending Stripe references stay pending (never invented); the legacy established one is now stale with the
    // reason in its evidence; nothing gained an account id it never had; job status column is text now.
    const refs = (await pool.query("select id, status, provider_account_id, evidence from provider_reference")).rows;
    expect(refs.every((r) => r.provider_account_id === null)).toBe(true);
    expect(refs.filter((r) => r.id !== legacyPending.id).every((r) => r.status === "pending")).toBe(true);
    const legacy = refs.find((r) => r.id === legacyPending.id)!;
    expect(legacy.status).toBe("stale");
    expect(String(legacy.evidence.migration_0002)).toMatch(/re-verify/);
    expect((await pool.query("select data_type from information_schema.columns where table_name='job' and column_name='status'")).rows[0].data_type).toBe("text");
    // Re-running the migrator is a no-op (idempotent journal).
    await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    expect((await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n).toBe(3);
    // Upgraded data works with the current services: the seeded NC Sales rep places an order at a seeded account.
    const [salesIdentity] = await db.select().from(schema.employeeIdentity).where(eq(schema.employeeIdentity.email, "sales-nc@demo.local"));
    const sales = (await loadActor(db, salesIdentity.employeeId))!;
    const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.tradeName, "Dogpatch Bottle Shop"));
    const [sku] = await db.select().from(schema.sku).where(eq(schema.sku.code, "CAN-12C"));
    const res = await submitOrder(db, sales, { locationId: loc.id, lines: [{ skuId: sku.id, qty: 1 }] });
    expect(res.order.orderNumber).toMatch(/^NC-\d{6}$/);
    // Pre-existing payment relationship rows had the AP contact as payer by inheritance (old REV-08 behaviour): they are
    // kept as history, but the authority check now refuses them until intentionally assigned.
    const { authorizedPayer } = await import("@/lib/domain/payment/service");
    const [mission] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.tradeName, "Mission Taproom"));
    const auth = await authorizedPayer(db, mission.id);
    expect(auth.ok).toBe(false);
    await pool.end();
  }, 120_000);

  it("preflight: pre-existing invalid data stops the migration with a diagnostic and nothing is changed", async () => {
    const { db, pool } = await restoreBaseline();
    // Manufacture a violation the new invariant forbids: a second current identity for one employee.
    const { rows } = await pool.query("select employee_id, email from employee_identity limit 1");
    await pool.query("insert into employee_identity (employee_id, email, current) values ($1, $2, true)", [rows[0].employee_id, `dup-${rows[0].email}`]);
    const failure = await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") }).then(() => null, (e: unknown) => e as Error & { cause?: Error });
    expect(failure).not.toBeNull();
    expect(`${failure?.message} ${failure?.cause?.message ?? ""}`).toMatch(/preflight: 1 employee\(s\) with more than one current identity/);
    expect((await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n).toBe(2);
    expect((await pool.query("select count(*)::int as n from information_schema.columns where table_name='job' and column_name='claim_token'")).rows[0].n).toBe(0);
    await pool.end();
  }, 120_000);
});
