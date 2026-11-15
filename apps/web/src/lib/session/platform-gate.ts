import { isPlatformAdminRole, type PlatformAdminRole } from "@workspace/shared";

/**
 * Whether the person may open /admin (docs/specs/platform-admin.md, "Screens", Layout):
 * - `admin`: a platform admin, with their role;
 * - `signed_out`: no session, or MFA still to set up, so to /login;
 * - `not_admin`: signed in but not a platform admin, so to /;
 * - `off`: the admin.access feature is switched off, so not found.
 */
export type PlatformGate =
  { kind: "admin"; role: PlatformAdminRole } | { kind: "signed_out" } | { kind: "not_admin" } | { kind: "off" };

/**
 * Reads the API's answer to GET /platform/me. Anything the rule does not name counts as not an
 * admin, so an unexpected answer, an unknown role or a failing API never opens the console (deny
 * by default). The API's guard decides again on every /platform request.
 */
export function platformGateOf(status: number, body: unknown): PlatformGate {
  const fields = typeof body === "object" && body !== null ? (body as { role?: unknown; code?: unknown }) : {};
  if (status === 200) {
    return typeof fields.role === "string" && isPlatformAdminRole(fields.role)
      ? { kind: "admin", role: fields.role }
      : { kind: "not_admin" };
  }
  if (status === 401) return { kind: "signed_out" };
  if (status === 403 && fields.code === "mfa_enrolment_required") return { kind: "signed_out" };
  if (status === 404) return { kind: "off" };
  return { kind: "not_admin" };
}
