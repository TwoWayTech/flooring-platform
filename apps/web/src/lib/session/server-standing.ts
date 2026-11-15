import { companyStandingFromWire, type CompanyStanding } from "@workspace/shared";

/**
 * Reads the API's answer to GET /company/standing on the server (docs/specs/platform-admin.md,
 * part 4, "On a full page load"). A 200 is read through `companyStandingFromWire`, so an unknown
 * state reads `unavailable` (deny by default). Any other status gives no answer: the shell renders,
 * the API's guards still refuse every request, and the client re-checks on the first refusal.
 */
export function serverStandingOf(status: number, body: unknown): CompanyStanding | null {
  return status === 200 ? companyStandingFromWire(body) : null;
}
