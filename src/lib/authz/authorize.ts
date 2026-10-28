import { ACTIONS, type Action } from "./actions";
import { type Actor, hasRole } from "./actor";

export class AuthorizationError extends Error {
  readonly action: Action;
  constructor(action: Action, message?: string) {
    super(message ?? `Not authorized: ${action}`);
    this.name = "AuthorizationError";
    this.action = action;
  }
}

export interface AuthzContext {
  /** Market the action concerns; omit for market-independent actions. */
  marketId?: string | null;
}

/**
 * Can this actor perform the action (optionally within a market)?
 * Owner: full functional access. System: allowed (internal automation runs
 * under confirmed rules; every system effect is still audited).
 */
export function can(actor: Actor, action: Action, ctx: AuthzContext = {}): boolean {
  if (actor.kind === "system") return true;
  if (hasRole(actor, "owner")) return true;
  const roles = ACTIONS[action] as readonly string[];
  return roles.some((r) => hasRole(actor, r as never, ctx.marketId ?? null));
}

export function authorize(actor: Actor, action: Action, ctx: AuthzContext = {}): void {
  if (!can(actor, action, ctx)) {
    throw new AuthorizationError(action);
  }
}
