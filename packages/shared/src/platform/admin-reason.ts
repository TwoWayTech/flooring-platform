/*
 * The reason every platform admin write carries (docs/specs/platform-admin.md, part 2, "The plan
 * rules" and "POST /platform/companies/:id/suspend, /reinstate and /cancel"; part 3, "POST
 * /platform/support-grants", Body). It is kept in `platform_audit_log`, so the field's hint tells
 * the admin not to paste the company's data into it. One copy for the API, the console and the demo.
 */

/** The length of a platform admin's reason, after trimming. */
export const ADMIN_REASON = { min: 10, max: 500 } as const;

/** Why a reason is refused; the API's 400, the console's field and the demo say the same. */
export const ADMIN_REASON_MESSAGE = `Give a reason of ${ADMIN_REASON.min} to ${ADMIN_REASON.max} characters.`;

/**
 * Why a reason is refused, or null when it is fine: it must be a string whose trimmed length is
 * within `ADMIN_REASON`. Anything that is not a string is refused (deny by default).
 */
export function adminReasonProblem(value: unknown): string | null {
  if (typeof value !== "string") return ADMIN_REASON_MESSAGE;
  const length = value.trim().length;
  return length >= ADMIN_REASON.min && length <= ADMIN_REASON.max ? null : ADMIN_REASON_MESSAGE;
}
