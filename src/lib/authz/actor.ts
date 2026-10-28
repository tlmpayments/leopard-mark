export type Role = "owner" | "admin" | "accounting" | "sales" | "driver_service";

export const ROLES: Role[] = ["owner", "admin", "accounting", "sales", "driver_service"];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  accounting: "Accounting",
  sales: "Sales",
  driver_service: "Driver / Service",
};

export interface ActorGrant {
  role: Role;
  /** null = every market for this role */
  marketId: string | null;
}

/**
 * The authenticated, internally-authorized business actor for a request.
 * Google supplies identity; the internal employee record and its current
 * grants supply authority (brief §5).
 */
export interface Actor {
  kind: "employee" | "system" | "dev_fixture";
  employeeId: string | null;
  displayName: string;
  email: string | null;
  grants: ActorGrant[];
}

export const SYSTEM_ACTOR: Actor = {
  kind: "system",
  employeeId: null,
  displayName: "System",
  email: null,
  grants: [],
};

export function actorRoles(actor: Actor): Role[] {
  return Array.from(new Set(actor.grants.map((g) => g.role)));
}

export function hasRole(actor: Actor, role: Role, marketId?: string | null): boolean {
  return actor.grants.some(
    (g) => g.role === role && (g.marketId === null || marketId == null || g.marketId === marketId),
  );
}

/** Markets the actor can see for a role (null = all). */
export function marketScopeFor(actor: Actor, roles: Role[]): "all" | string[] {
  const relevant = actor.grants.filter((g) => roles.includes(g.role));
  if (relevant.some((g) => g.marketId === null)) return "all";
  return Array.from(new Set(relevant.map((g) => g.marketId as string)));
}
