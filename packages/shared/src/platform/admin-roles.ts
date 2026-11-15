import type { PlatformAdminRole } from "../types/platform";

/** Every role the console accepts, in display order. */
export const PLATFORM_ADMIN_ROLES: readonly PlatformAdminRole[] = ["owner", "support"];

/**
 * Whether a stored `platform_admins.role` is one the console accepts (docs/specs/platform-admin.md,
 * "Who uses it"; review A4). The column is free text with no CHECK, so any other value, such as a
 * typo or a future `billing`, counts as no admin: deny by default.
 */
export function isPlatformAdminRole(value: string): value is PlatformAdminRole {
  return PLATFORM_ADMIN_ROLES.some((role) => role === value);
}

/**
 * The roles that may make a platform write when the route names no roles (spec "The platform
 * guard", step 4; "Who may call what (part 3)"). One copy for the API guard and the console, so
 * they can't drift apart (PR #34 security review finding 3; ADR 0053).
 */
export const PLATFORM_DEFAULT_WRITE_ROLES: readonly PlatformAdminRole[] = ["owner"];

/**
 * Whether this role may change a company's access (spec "Who may call what (part 3)"). The console
 * shows the access page read only otherwise; the API's guard still decides.
 */
export function mayChangeCompanyAccess(role: PlatformAdminRole): boolean {
  return PLATFORM_DEFAULT_WRITE_ROLES.includes(role);
}

/**
 * Whether this role may create, edit, retire and restore plans and suspend, reinstate and cancel a
 * company (docs/specs/platform-admin.md, "Who may call what (part 2)"). The console offers those
 * writes only then; the API's guard still decides. Kept apart from `mayChangeCompanyAccess`: a
 * different power that happens to share the list today.
 */
export function mayManageBilling(role: PlatformAdminRole): boolean {
  return PLATFORM_DEFAULT_WRITE_ROLES.includes(role);
}

/**
 * Whether this role sees the IP and user agent of platform admins' audit entries (spec "Who may
 * call what (part 3)"; blueprint p28 "IP and device"): the owner role only.
 */
export function seesAuditNetwork(role: PlatformAdminRole): boolean {
  return role === "owner";
}

/**
 * Whether this role sees every admin's support requests (spec "Who may call what (part 3)"): the
 * owner role only. Kept apart from `mayChangeCompanyAccess`, because changing access and seeing
 * other admins' requests are different powers.
 */
export function seesAllSupportGrants(role: PlatformAdminRole): boolean {
  return role === "owner";
}

/** The admin reading support requests or the audit log, as `seesAdminReason` needs them. */
export interface SupportReasonViewer {
  role: PlatformAdminRole;
  userId: string;
}

/**
 * Whether the viewer may read the reason an admin wrote on a platform write made by `authorId`
 * (spec "Who may call what (part 3)" and "Audit (part 2)"; ADR 0053, safer than part 1's "both
 * roles read every page"). Reasons are an admin's free text: the owner role reads every one; any
 * other role only its own. A missing or empty author is never the viewer: deny by default. The
 * grant list, the audit SQL and the audit view all use this rule.
 */
export function seesAdminReason(viewer: SupportReasonViewer, authorId: string | null): boolean {
  if (viewer.role === "owner") return true;
  return typeof authorId === "string" && authorId.length > 0 && authorId === viewer.userId;
}

/**
 * Whether the viewer may read the reason of a support request made by `requesterId` (spec "Who may
 * call what (part 3)"): the general reason rule, `seesAdminReason`, under the name part 3 uses.
 */
export function seesSupportReason(viewer: SupportReasonViewer, requesterId: string | null): boolean {
  return seesAdminReason(viewer, requesterId);
}
