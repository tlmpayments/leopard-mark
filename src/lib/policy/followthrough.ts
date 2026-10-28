import type { Actor } from "@/lib/authz/actor";
import type { DbOrTx } from "@/lib/db/types";
import { reevaluateLicenseCasesForMarkets } from "@/lib/domain/customers/service";

/**
 * Targeted follow-through when a policy selection changes (UX-06): current
 * work whose explanation depends on the decision is re-evaluated once,
 * idempotently. Nothing historical is rewritten; unselected behaviour stays
 * inactive. Only decisions with implemented consequences are listed here.
 */
export async function runPolicyFollowThrough(db: DbOrTx, actor: Actor, decisionId: string, marketIds: string[] | null): Promise<string | null> {
  switch (decisionId) {
    case "D02": {
      const n = await reevaluateLicenseCasesForMarkets(db, actor, marketIds);
      return `License cases re-evaluated for ${n} location(s)`;
    }
    default:
      return null;
  }
}
