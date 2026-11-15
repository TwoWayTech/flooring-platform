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
