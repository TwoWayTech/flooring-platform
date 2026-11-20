import type { BlockingStandingState } from "@workspace/shared";
import { HttpApiError } from "@/lib/api/http/transport";

/** What a refused first read of the workspace shows: the standing panel for a state, or the API's own words. */
export type WorkspaceRefusal =
  { kind: "standing"; state: BlockingStandingState } | { kind: "message"; message: string };

/**
 * TenantGuard's refusals that say the company can't be used (`STANDING_REFUSAL_CODES` in
 * lib/api/standing-watch.ts), each with the state `companyStandingState` gives it. A read-only
 * company still answers reads, so its code never refuses a first read and is not here.
 */
const STANDING_BY_CODE: ReadonlyMap<string, BlockingStandingState> = new Map<string, BlockingStandingState>([
  ["company_maintenance", "maintenance"],
  ["company_unavailable", "unavailable"],
  ["company_suspended", "locked"],
]);

/**
 * What a refused first read of `GET /company` shows (ADR 0051, "GET /company", D17): the
 * company-unavailable panel for a standing refusal, and otherwise the error's own message (a
 * disabled profile, MFA still to set up, a network failure, a demo refusal).
 */
export function workspaceRefusal(error: Error): WorkspaceRefusal {
  const state = error instanceof HttpApiError ? STANDING_BY_CODE.get(error.code) : undefined;
  return state ? { kind: "standing", state } : { kind: "message", message: error.message };
}
