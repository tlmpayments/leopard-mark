import { assertSeedAllowed, seedDemo } from "../src/lib/demo/seed";
import { scriptDb } from "./_db";

/**
 * DEVELOPMENT SEED against a real Postgres (DATABASE_URL). Same representative
 * demo data the zero-setup demo mode uses. Every safety check runs BEFORE any
 * connection or write (REV-02/AC05): it refuses on a deployment, in
 * production, without an explicit FV_ENV=development|test, and against a
 * database that already holds business data. For the embedded zero-setup demo
 * you do not need this: `npm run demo`.
 *
 *   FV_ENV=development DATABASE_URL=postgres://… npm run seed:dev
 */
async function main() {
  assertSeedAllowed();
  const { db, pool, migrate } = scriptDb();
  await migrate();
  const result = await seedDemo(db);
  console.log(result.seeded ? "Dev seed complete. Sign in via the dev fixture list (DEV_AUTH_BYPASS=true, npm run dev)." : "Database already holds business data. Nothing changed.");
  await pool.end();
}
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
