import "server-only";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import type { Db } from "./types";

/**
 * DEVELOPMENT DEMO MODE database: an embedded PGlite (real Postgres in WASM)
 * persisted under ./.fv-demo/pgdata. Same Drizzle schema, same SQL
 * migrations as production. On first open it migrates and seeds
 * representative demo data. Never imported unless demoModeEnabled().
 *
 * The instance is cached on globalThis so dev-server hot reloads reuse the
 * one open database (PGlite locks its data directory). The cache slot is
 * taken synchronously, before the first await, so concurrent first requests
 * (several browser tabs, a browser test fanning out) share one open instead
 * of each opening and seeding the same directory.
 */
declare global {
  var __fvDemo: { ready: Promise<Db> } | undefined;
}

export const DEMO_DATA_DIR = path.join(process.cwd(), ".fv-demo", "pgdata");

async function openAndSeed(): Promise<Db> {
  const [{ PGlite }, { drizzle }, { migrate }, { seedDemo }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
    import("@/lib/demo/seed"),
  ]);
  mkdirSync(DEMO_DATA_DIR, { recursive: true });
  const client = await PGlite.create(DEMO_DATA_DIR);
  const db = drizzle(client, { schema }) as unknown as Db;
  try {
    await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
    const result = await seedDemo(db);
    if (result.seeded) console.log(`[demo] Seeded representative demo data into ${DEMO_DATA_DIR}`);
  } catch (err) {
    await client.close().catch(() => undefined);
    throw err;
  }
  return db;
}

export async function demoDb(): Promise<Db> {
  if (!globalThis.__fvDemo) globalThis.__fvDemo = { ready: openAndSeed() };
  const slot = globalThis.__fvDemo;
  try {
    return await slot.ready;
  } catch (err) {
    // Let the next request retry from scratch instead of pinning a failed initialisation.
    if (globalThis.__fvDemo === slot) globalThis.__fvDemo = undefined;
    throw err;
  }
}
