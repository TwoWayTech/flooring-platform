import { featureOn, type Role, type User } from "@workspace/shared";
import { isDemoMode } from "@/lib/data-source";

/*
 * Who may "View as a role", and when a choice applies (spec settings-and-permissions.md, "View as";
 * ADR 0051, "GET /company", D2 and D16). Pure, so the shell, the provider and the tests share one
 * copy of the rule.
 */

/**
 * Whether View as is offered at all: in the demo only. In api mode the API answers for the
 * signed-in person only, so a viewed role's buttons could offer what the API refuses (D2).
 */
export function viewAsOffered(): boolean {
  return featureOn("shell.view-as") && isDemoMode();
}

/** Whether the person may view as a role: a held role is the Owner or lists `settings.roles.manage`. */
export function mayViewAs(user: User, roles: readonly Role[]): boolean {
  return roles
    .filter((role) => user.roleIds.includes(role.id))
    .some((role) => role.owner || role.permissions.includes("settings.roles.manage"));
}

/**
 * The role to view as, or null. A stored choice belongs to someone who may view as; anyone else,
 * such as the next person to sign in on the same tab, sees their own access (D16). Never the owner
 * role, which the switcher never offers.
 */
export function viewAsRoleFor(viewAs: string | null, user: User, roles: readonly Role[]): Role | null {
  if (!viewAs || !viewAsOffered() || !mayViewAs(user, roles)) return null;
  const role = roles.find((candidate) => candidate.id === viewAs);
  return role && !role.owner ? role : null;
}
