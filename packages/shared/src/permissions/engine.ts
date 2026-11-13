import type { ModuleKey } from "../products";
import { permissionDef, type PermissionKey } from "./catalog";
import { SCOPE_RANK, type DataScope } from "./roles";

/** The parts of a role the engine needs. */
export interface RoleLike {
  id: string;
  permissions: readonly PermissionKey[];
  dataScope: DataScope;
  owner: boolean;
}

/** A user's set of effective permissions plus the facts the UI needs about them. */
export interface Access {
  permissions: ReadonlySet<PermissionKey>;
  dataScope: DataScope;
  isOwner: boolean;
}

/**
 * Effective permissions = (union of the user's role permissions) ∩ (company ceiling) ∩
 * (permissions of enabled modules). Blueprint "Users, roles and super-admin access".
 * A role keeps ticks outside the ceiling; they are simply inactive until re-enabled.
 */
export function effectivePermissions(
  roles: readonly RoleLike[],
  ceiling: Iterable<PermissionKey>,
  modules: readonly ModuleKey[],
): Set<PermissionKey> {
  const allowed = new Set(ceiling);
  const result = new Set<PermissionKey>();
  for (const role of roles) {
    for (const key of role.permissions) {
      const def = permissionDef(key);
      if (def && allowed.has(key) && modules.includes(def.module)) result.add(key);
    }
  }
  return result;
}

/** The widest data scope across a user's roles (blueprint rule 4: several roles per user). */
export function dataScope(roles: readonly RoleLike[]): DataScope {
  return roles.reduce<DataScope>(
    (widest, r) => (SCOPE_RANK[r.dataScope] > SCOPE_RANK[widest] ? r.dataScope : widest),
    "own",
  );
}

/** Builds the full access picture for a user. */
export function resolveAccess(
  roles: readonly RoleLike[],
  ceiling: Iterable<PermissionKey>,
  modules: readonly ModuleKey[],
): Access {
  return {
    permissions: effectivePermissions(roles, ceiling, modules),
    dataScope: dataScope(roles),
    isOwner: roles.some((r) => r.owner),
  };
}

/** Whether an access set includes a permission. */
export function can(access: Access, key: PermissionKey): boolean {
  return access.permissions.has(key);
}

/** Why a grant was refused, or null when it is allowed. */
export type GrantDenial = "not_held" | "owner_only" | "scope_wider" | null;

/**
 * No privilege escalation (blueprint rule 2): a user can grant a permission only if they
 * hold it themselves.
 */
export function canGrant(granter: Access, key: PermissionKey): boolean {
  return granter.permissions.has(key);
}

/**
 * Whether a user may assign a role to someone. The role's active permissions (inside the
 * ceiling and enabled modules) must be a subset of the granter's, its data scope may not be wider
 * than the granter's, and only an Owner can make someone else an Owner (blueprint rules 1 and 2;
 * data scope is part of what a person holds, PR #11 security review).
 */
export function canAssignRole(
  granter: Access,
  role: RoleLike,
  ceiling: Iterable<PermissionKey>,
  modules: readonly ModuleKey[],
): GrantDenial {
  if (role.owner && !granter.isOwner) return "owner_only";
  const active = effectivePermissions([role], ceiling, modules);
  for (const key of active) if (!granter.permissions.has(key)) return "not_held";
  return scopeWidens(granter, role.dataScope, null) ? "scope_wider" : null;
}

/** Permissions in a proposed role that the granter does not hold; empty means the save is allowed. */
export function escalations(
  granter: Access,
  proposed: readonly PermissionKey[],
  current: readonly PermissionKey[],
): PermissionKey[] {
  const before = new Set(current);
  return proposed.filter((key) => !before.has(key) && !granter.permissions.has(key));
}

/**
 * Whether saving a role with this data scope would give more than the granter holds: a scope wider
 * than their own that the role did not already have. Owners hold every scope.
 */
export function scopeWidens(granter: Access, proposed: DataScope, current: DataScope | null): boolean {
  if (granter.isOwner || proposed === current) return false;
  return SCOPE_RANK[proposed] > SCOPE_RANK[granter.dataScope];
}

/**
 * Whether the granter may change a person who holds these roles (their roles, status or MFA):
 * they must be able to give every one of those roles themselves, so nobody acts on someone who
 * holds more than they do, and only an Owner acts on an Owner (PR #11 security review).
 */
export function canManageHolder(
  granter: Access,
  heldRoles: readonly RoleLike[],
  ceiling: Iterable<PermissionKey>,
  modules: readonly ModuleKey[],
): GrantDenial {
  const allowed = [...ceiling];
  for (const role of heldRoles) {
    const denial = canAssignRole(granter, role, allowed, modules);
    if (denial) return denial;
  }
  return null;
}

/** The parts of a user the owner rule needs. */
export interface UserLike {
  id: string;
  status: "invited" | "active" | "disabled";
  roleIds: readonly string[];
}

/**
 * At least one active Owner must always exist (blueprint rule 1). Returns true when the
 * proposed user list still has an active Owner.
 */
export function hasActiveOwner(users: readonly UserLike[], ownerRoleIds: ReadonlySet<string>): boolean {
  return users.some((u) => u.status === "active" && u.roleIds.some((id) => ownerRoleIds.has(id)));
}
