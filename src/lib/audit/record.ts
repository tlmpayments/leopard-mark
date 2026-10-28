import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import type { Actor } from "@/lib/authz/actor";

export interface AuditInput {
  action: string;
  subjectType: string;
  subjectId: string;
  prior?: unknown;
  current?: unknown;
  reason?: string | null;
  correlationId?: string | null;
  marketId?: string | null;
}

/**
 * Append an audit event (brief §43). Audit rows are never updated or deleted
 * by the application; corrections are new events.
 */
export async function recordAudit(db: DbOrTx, actor: Actor, input: AuditInput) {
  const [row] = await db
    .insert(schema.auditEvent)
    .values({
      actorKind: actor.kind === "dev_fixture" ? "dev_fixture" : actor.kind,
      actorEmployeeId: actor.employeeId,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      prior: input.prior ?? null,
      current: input.current ?? null,
      reason: input.reason ?? null,
      correlationId: input.correlationId ?? null,
      marketId: input.marketId ?? null,
    })
    .returning();
  return row;
}
