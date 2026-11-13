import type { PermissionKey } from "./catalog";
import type { DefaultRoleKey } from "./roles";

/**
 * Roles whose holders must sign in with a second factor (blueprint p27, "MFA": mandatory for
 * Owner, Accountant, HR and platform admins). Platform admins are checked by the API from the
 * platform_admins table; company roles are matched by key.
 */
export const MFA_REQUIRED_ROLES: readonly DefaultRoleKey[] = ["owner", "accountant", "hr"];

/**
 * Keys that make MFA mandatory for whoever holds them, so the rule follows what a role can do,
 * not its key: a copy of the Accountant role gets a new key but keeps these (PR #4 security review,
 * finding 7; docs/specs/settings-users-access.md). They move money, see pay or sensitive HR data,
 * change tax and payment settings, or hand out access. The default Owner, Accountant and HR
 * manager roles hold some; Manager, Sales, Purchasing, Warehouse and Installer hold none.
 */
export const MFA_REQUIRED_KEYS: readonly PermissionKey[] = [
  "sales.payment.approve",
  "sales.payment.void",
  "sales.payment.refund",
  "sales.payment.write_off",
  "sales.tax.override",
  "hr.payroll.view",
  "hr.payroll.approve",
  "hr.payroll.export",
  "hr.employee.view_sensitive",
  "hr.commission.approve",
  "settings.tax.manage",
  "settings.payments.manage",
  "settings.hr.manage",
  "settings.users.manage",
  "settings.roles.manage",
  "reports.financial.export",
];

/** The `member.role` marker that says a person's company roles make MFA mandatory. */
export const MFA_MARKER = "mfa";

/** Whether a role makes MFA mandatory: the Owner role, or any key in MFA_REQUIRED_KEYS. */
export function roleRequiresMfa(role: { owner: boolean; permissions: readonly string[] }): boolean {
  return role.owner || role.permissions.some((key) => (MFA_REQUIRED_KEYS as readonly string[]).includes(key));
}

const MEMBER_ROLE_SEPARATOR = ",";

/**
 * Whether a `member.role` value makes MFA mandatory: the `mfa` marker that role assignment writes
 * from role content, or a default role key that needs it (values written before the marker).
 */
export function rolesRequireMfa(roleKeys: readonly string[]): boolean {
  return roleKeys.some((key) => key === MFA_MARKER || (MFA_REQUIRED_ROLES as readonly string[]).includes(key));
}

/**
 * The `member.role` value for a person's company roles: their role keys, plus the `mfa` marker
 * when any of the roles needs MFA by content (roleRequiresMfa).
 */
export function memberRoleValue(roles: readonly { key: string; owner: boolean; permissions: readonly string[] }[]): string {
  const keys = roles.map((role) => role.key);
  return encodeMemberRoles(roles.some(roleRequiresMfa) ? [...keys, MFA_MARKER] : keys);
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
