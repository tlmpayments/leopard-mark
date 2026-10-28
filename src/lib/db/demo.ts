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
 * one open database (PGlite locks its data directory).
 */
declare global {
  var __fvDemo: { db: Db; ready: Promise<void> } | undefined;
}

export const DEMO_DATA_DIR = path.join(process.cwd(), ".fv-demo", "pgdata");

export async function demoDb(): Promise<Db> {
  if (!globalThis.__fvDemo) {
    const [{ PGlite }, { drizzle }, { migrate }, { seedDemo }] = await Promise.all([
      import("@electric-sql/pglite"),
      import("drizzle-orm/pglite"),
      import("drizzle-orm/pglite/migrator"),
      import("@/lib/demo/seed"),
    ]);
    mkdirSync(DEMO_DATA_DIR, { recursive: true });
    const client = await PGlite.create(DEMO_DATA_DIR);
    const db = drizzle(client, { schema }) as unknown as Db;
    const ready = (async () => {
      await migrate(db as never, { migrationsFolder: path.join(process.cwd(), "drizzle") });
      const result = await seedDemo(db);
      if (result.seeded) console.log(`[demo] Seeded representative demo data into ${DEMO_DATA_DIR}`);
    })();
    globalThis.__fvDemo = { db, ready };
  }
  try {
    await globalThis.__fvDemo.ready;
  } catch (err) {
    // Let the next request retry from scratch instead of pinning a failed initialisation.
    const failed = globalThis.__fvDemo;
    globalThis.__fvDemo = undefined;
    await (failed.db as unknown as { $client?: { close?: () => Promise<void> } }).$client?.close?.().catch(() => undefined);
    throw err;
  }
  return globalThis.__fvDemo.db;
}
