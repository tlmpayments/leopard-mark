import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { DEMO_OWNER_EMAIL } from "./seed";

/** The seeded demo Owner's employee id (null if not seeded or the row was removed). */
export async function demoOwnerEmployeeId(db: DbOrTx): Promise<string | null> {
  const [row] = await db
    .select({ employeeId: schema.employeeIdentity.employeeId })
    .from(schema.employeeIdentity)
    .where(and(eq(schema.employeeIdentity.email, DEMO_OWNER_EMAIL), eq(schema.employeeIdentity.current, true)))
    .limit(1);
  return row?.employeeId ?? null;
}
