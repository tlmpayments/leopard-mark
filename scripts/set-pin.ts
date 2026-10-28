import { eq, and } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { SYSTEM_ACTOR } from "../src/lib/authz/actor";
import { setEmployeePin } from "../src/lib/domain/employees/credentials";
import { scriptDb } from "./_db";

/**
 * Break-glass PIN reset from a trusted machine (e.g. the only Owner forgot
 * their PIN). Sets a TEMPORARY PIN that must be changed at the next sign-in,
 * ends the previous credential (every session for that person stops) and
 * audits the reset as the system actor. The PIN is read from the environment
 * so it never appears in shell history as an argument.
 *
 *   DATABASE_URL=… PIN_EMAIL=owner@company.com PIN=48215736 npm run set-pin
 */
async function main() {
  const email = process.env.PIN_EMAIL?.trim().toLowerCase();
  const pin = process.env.PIN?.trim();
  if (!email || !pin) throw new Error("Set PIN_EMAIL and PIN in the environment (see the comment at the top of scripts/set-pin.ts).");
  const { db, pool } = scriptDb();
  const [identity] = await db
    .select()
    .from(schema.employeeIdentity)
    .where(and(eq(schema.employeeIdentity.email, email), eq(schema.employeeIdentity.current, true)))
    .limit(1);
  if (!identity) throw new Error(`No current employee identity for ${email}.`);
  await setEmployeePin(db, SYSTEM_ACTOR, identity.employeeId, pin, { reason: "break-glass reset from scripts/set-pin.ts", mustChange: true });
  console.log(`Temporary PIN set for ${email}; they must choose their own PIN at the next sign-in. Existing sessions for that person are signed out.`);
  await pool.end();
}
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
