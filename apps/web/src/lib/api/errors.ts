/**
 * An error the API reports to the person using the app: a broken business rule or a failed
 * request. Its message is written for them, so screens can show it as it is.
 */
export class ApiError extends Error {}

/**
 * The machine-readable code of a refusal: the `code` of an `HttpApiError` from apps/api, or of the
 * demo's `DemoRefusal`, else null (docs/specs/platform-admin.md, "ApiClient (part 2)"). Screens
 * decide what to do on the code, never on the text, so a reworded message changes no behaviour
 * (PR #36 note).
 */
export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  return "code" in error && typeof error.code === "string" ? error.code : null;
}
