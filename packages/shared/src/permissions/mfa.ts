import type { DefaultRoleKey } from "./roles";

/**
 * Roles whose holders must sign in with a second factor (blueprint p27, "MFA": mandatory for
 * Owner, Accountant, HR and platform admins). Platform admins are checked by the API from the
 * platform_admins table; company roles are matched by key.
 */
export const MFA_REQUIRED_ROLES: readonly DefaultRoleKey[] = ["owner", "accountant", "hr"];

const MEMBER_ROLE_SEPARATOR = ",";

/** Whether any of these role keys makes MFA mandatory for the person who holds them. */
export function rolesRequireMfa(roleKeys: readonly string[]): boolean {
  return roleKeys.some((key) => (MFA_REQUIRED_ROLES as readonly string[]).includes(key));
}

/**
 * The value written to Better Auth's `member.role` for a person's company roles: their role keys,
 * comma-separated (Better Auth's multi-role format). Sign-in reads it to decide on MFA before any
 * company database is open (ADR 0029, part 2). Keys are sorted so the value is stable.
 */
export function encodeMemberRoles(roleKeys: readonly string[]): string {
  return [...new Set(roleKeys)].sort().join(MEMBER_ROLE_SEPARATOR);
}

/** The role keys held in a `member.role` value; empty parts are dropped. */
export function decodeMemberRoles(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(MEMBER_ROLE_SEPARATOR)
    .map((key) => key.trim())
    .filter((key) => key !== "");
}
