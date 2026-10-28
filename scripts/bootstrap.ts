import { and, eq } from "drizzle-orm";
import { generatePin } from "../src/lib/auth/pin";
import { SYSTEM_ACTOR } from "../src/lib/authz/actor";
import * as schema from "../src/lib/db/schema";
import { currentCredential, setEmployeePin } from "../src/lib/domain/employees/credentials";
import { seedGates } from "../src/lib/integrations/gates";
import { seedDecisionRegister } from "../src/lib/policy/policy";
import { scriptDb } from "./_db";

/**
 * Production-safe bootstrap: migrate, seed the decision register (all
 * unselected) and capability gates (all unproven), and provision the first
 * Owner by email with a temporary PIN so they can sign in and provision
 * everyone else. The Owner chooses their own PIN at first sign-in.
 *
 *   OWNER_EMAIL=owner@company.com OWNER_NAME="Owner Name" OWNER_PIN=48215736 npm run bootstrap
 *
 * Without OWNER_PIN a random temporary PIN is generated and printed ONCE to
 * this terminal (never stored in clear, never logged by the application).
 * Re-running never changes an existing Owner's PIN; use `npm run set-pin`.
 */
async function main() {
  const { db, pool, migrate } = scriptDb();
  await migrate();
  await seedDecisionRegister(db);
  await seedGates(db);
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (email) {
    const [existing] = await db.select().from(schema.employeeIdentity).where(and(eq(schema.employeeIdentity.email, email), eq(schema.employeeIdentity.current, true))).limit(1);
    if (!existing) {
      const [emp] = await db.insert(schema.employee).values({ displayName: process.env.OWNER_NAME ?? "Owner" }).returning();
      await db.insert(schema.employeeIdentity).values({ employeeId: emp.id, email });
      await db.insert(schema.roleGrant).values({ employeeId: emp.id, role: "owner", marketId: null });
      await db.insert(schema.auditEvent).values({ actorKind: "system", action: "employee.bootstrap_owner", subjectType: "employee", subjectId: emp.id, current: { email } });
      const pin = process.env.OWNER_PIN?.trim() || generatePin(8);
      await setEmployeePin(db, SYSTEM_ACTOR, emp.id, pin, { reason: "temporary PIN from bootstrap", mustChange: true });
      console.log(`Provisioned Owner ${email}.`);
      if (process.env.OWNER_PIN?.trim()) console.log("Temporary PIN: the OWNER_PIN you supplied (must be changed at first sign-in).");
      else console.log(`Temporary PIN (shown once, change it at first sign-in): ${pin}`);
    } else {
      const cred = await currentCredential(db, existing.employeeId);
      console.log(`Owner ${email} already provisioned${cred ? "" : " — no PIN set yet: run `PIN_EMAIL=… PIN=… npm run set-pin`"}.`);
    }
  } else {
    console.log("OWNER_EMAIL not set — no Owner provisioned. Set it to provision the first Owner.");
  }
  console.log("Bootstrap complete: 66 decision records (unselected), capability gates (unproven).");
  await pool.end();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
