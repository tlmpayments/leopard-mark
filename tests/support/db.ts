import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";

/**
 * Real SQL for business-scenario tests: an in-process Postgres (PGlite) with
 * the same Drizzle migrations that production runs. Each call returns a fresh
 * database so scenarios cannot leak state into each other.
 */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });
  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}
