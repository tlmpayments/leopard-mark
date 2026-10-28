import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "../src/lib/db/schema";
import type { Db } from "../src/lib/db/types";

export function scriptDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: url, max: 3, ssl: /neon\.tech|sslmode=require/.test(url) ? { rejectUnauthorized: true } : undefined });
  const db = drizzle(pool, { schema }) as unknown as Db;
  return { db, pool, migrate: () => migrate(db as never, { migrationsFolder: "./drizzle" }) };
}
