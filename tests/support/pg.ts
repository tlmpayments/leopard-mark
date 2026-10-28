import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { Client, Pool } from "pg";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";

/**
 * Disposable REAL Postgres database for concurrency/locking scenarios.
 * Requires TEST_DATABASE_URL pointing at a server where the user may CREATE
 * DATABASE (a local Postgres, a CI service container — never a shared or
 * live database). Each call creates `fv_test_<random>`, migrates it with the
 * production migrations, and drops it on close. Skipped (with a visible
 * message) when the variable is absent.
 */
export const PG_URL = process.env.TEST_DATABASE_URL;

export function pgAvailable(): boolean {
  return Boolean(PG_URL);
}

export async function createPgTestDb(): Promise<{ db: Db; pool: Pool; close: () => Promise<void>; url: string }> {
  if (!PG_URL) throw new Error("TEST_DATABASE_URL is not set");
  const name = `fv_test_${randomBytes(4).toString("hex")}`;
  const admin = new Client({ connectionString: PG_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(PG_URL);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 10 });
  const db = drizzle(pool, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return {
    db,
    pool,
    url: url.toString(),
    close: async () => {
      await pool.end();
      const drop = new Client({ connectionString: PG_URL });
      await drop.connect();
      // Wait for the pool's sockets to finish closing so the drop never has to terminate a client mid-close.
      for (let attempt = 0; attempt < 20; attempt++) {
        const { rows } = await drop.query(`select count(*)::int as n from pg_stat_activity where datname = $1`, [name]);
        if (rows[0].n === 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await drop.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await drop.end();
    },
  };
}
