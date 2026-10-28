import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { seedGates } from "../src/lib/integrations/gates";
import { seedDecisionRegister } from "../src/lib/policy/policy";
import { scriptDb } from "./_db";

/**
 * Production-safe bootstrap: migrate, seed the decision register (all
 * unselected) and capability gates (all unproven), and provision the first
 * Owner by email so they can sign in with Google and provision everyone else.
 *
 *   OWNER_EMAIL=owner@company.com OWNER_NAME="Owner Name" npm run bootstrap
 */
async function main() {
  const { db, pool, migrate } = scriptDb();
  await migrate();
  await seedDecisionRegister(db);
  await seedGates(db);
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (email) {
    const [existing] = await db.select().from(schema.employeeIdentity).where(eq(schema.employeeIdentity.email, email)).limit(1);
    if (!existing) {
      const [emp] = await db.insert(schema.employee).values({ displayName: process.env.OWNER_NAME ?? "Owner" }).returning();
      await db.insert(schema.employeeIdentity).values({ employeeId: emp.id, email });
      await db.insert(schema.roleGrant).values({ employeeId: emp.id, role: "owner", marketId: null });
      await db.insert(schema.auditEvent).values({ actorKind: "system", action: "employee.bootstrap_owner", subjectType: "employee", subjectId: emp.id, current: { email } });
      console.log(`Provisioned Owner ${email} (binds to Google on first sign-in).`);
    } else {
      console.log(`Owner ${email} already provisioned.`);
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
