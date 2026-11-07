import { resolveAccess, type Access, type Company, type Role, type User } from "@workspace/shared";

/**
 * Effective access of a user, or of the role they are viewing as (CLAUDE.md rule 2): role
 * permissions ∩ company ceiling ∩ enabled modules. Shared by the store and the screens so both
 * apply the same rule.
 */
export function viewerAccess(
  company: Company,
  roles: readonly Role[],
  user: User,
  viewAsRoleId: string | null,
): Access {
  const held = viewAsRoleId
    ? roles.filter((r) => r.id === viewAsRoleId)
    : roles.filter((r) => user.roleIds.includes(r.id));
  return resolveAccess(held, company.ceiling, company.modules);
}
