import { scriptDb } from "./_db";

/** Apply pending SQL migrations (drizzle/). Safe to run repeatedly. */
const { pool, migrate } = scriptDb();
migrate()
  .then(() => {
    console.log("Migrations applied.");
    return pool.end();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
