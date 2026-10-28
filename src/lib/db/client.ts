import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { demoModeEnabled } from "@/lib/env";
import * as schema from "./schema";
import type { Db } from "./types";

/**
 * Runtime database client.
 *
 * - Production / any configured DATABASE_URL: node-postgres. Works with
 *   Neon's pooled connection string on Vercel and with any ordinary Postgres
 *   locally. This path is unchanged by demo mode.
 * - DEVELOPMENT DEMO MODE (see env.ts): an embedded PGlite database under
 *   ./.fv-demo/ running the same Drizzle schema and SQL migrations, loaded
 *   lazily so the PGlite module is never touched in production.
 *
 * Tests use PGlite through the same schema (see tests/support/db.ts).
 */
declare global {
  var __fvPool: Pool | undefined;
}

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. See .env.example and docs/DEPLOYMENT.md (or run `npm run demo` for the zero-setup local demo).",
    );
  }
  return url;
}

function getPool(): Pool {
  if (!globalThis.__fvPool) {
    globalThis.__fvPool = new Pool({
      connectionString: connectionString(),
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      // Neon requires TLS; local Postgres usually does not.
      ssl:
        process.env.DATABASE_SSL === "false"
          ? undefined
          : /neon\.tech|sslmode=require/.test(connectionString())
            ? { rejectUnauthorized: true }
            : undefined,
    });
  }
  return globalThis.__fvPool;
}

let cached: Db | undefined;

export async function getDb(): Promise<Db> {
  if (demoModeEnabled()) {
    const { demoDb } = await import("./demo");
    return demoDb();
  }
  if (!cached) {
    cached = drizzle(getPool(), { schema }) as unknown as Db;
  }
  return cached;
}
