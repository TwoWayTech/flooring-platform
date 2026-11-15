import type { CompanyPhase } from "../permissions/company-lifecycle";
import type { CompanyStanding, CompanyStandingState } from "../types/platform";

/** The standing states that block every company route, so the shell shows a full screen instead. */
export type BlockingStandingState = Extract<CompanyStandingState, "maintenance" | "unavailable" | "locked">;

/** Whether each state blocks the company; the record keeps the list of states complete. */
const BLOCKS: Readonly<Record<CompanyStandingState, boolean>> = {
  full: false,
  read_only: false,
  locked: true,
  maintenance: true,
  unavailable: true,
};

/** Every standing state `GET /company/standing` may answer (docs/specs/platform-admin.md, part 4). */
export const COMPANY_STANDING_STATES = Object.keys(BLOCKS) as readonly CompanyStandingState[];

/** Whether a value read from the wire is one of the five standing states. */
export function isCompanyStandingState(value: unknown): value is CompanyStandingState {
  return COMPANY_STANDING_STATES.some((state) => state === value);
}

/** What the standing rule needs to know, read by the API from control rows only. */
export interface StandingFacts {
  /** `tenants.maintenance_mode`: a move or a failed migration. */
  maintenanceMode: boolean;
  /** TenantGuard's `isDatabaseUsable`: the database is `ready` or `read_only`. */
  databaseUsable: boolean;
  /** TenantGuard's `isReadOnly`: a phase short of full, or a read-only database. */
  readOnly: boolean;
  phase: CompanyPhase;
}

/**
 * Where a company stands, in TenantGuard's own order (apps/api/src/core/tenancy/tenant.guard.ts,
 * lines 61 to 64; spec part 4, "GET /company/standing"): maintenance (503 `company_maintenance`),
 * then an unusable database (503 `company_unavailable`), then locked (403 `company_suspended`),
 * then read only (403 `company_read_only` on writes), else full. The API's tests S-7 to S-14 pin
 * this order against the guard.
 */
export function companyStandingState(facts: StandingFacts): CompanyStandingState {
  if (facts.maintenanceMode) return "maintenance";
  if (!facts.databaseUsable) return "unavailable";
  if (facts.phase === "locked") return "locked";
  return facts.readOnly ? "read_only" : "full";
}

/** Whether a standing blocks every company route: maintenance, an unavailable database, or locked. */
export function blocksCompany(state: CompanyStandingState): state is BlockingStandingState {
  return BLOCKS[state];
}

/**
 * A standing read from an API answer. A missing or unknown state reads `unavailable`, so the shell
 * blocks rather than opens on an answer it can't read (deny by default); other fields are dropped.
 */
export function companyStandingFromWire(body: unknown): CompanyStanding {
  const state = typeof body === "object" && body !== null ? (body as { state?: unknown }).state : undefined;
  return { state: isCompanyStandingState(state) ? state : "unavailable" };
}

/** The title and text of a blocked company's full screen. */
export interface StandingScreen {
  title: string;
  body: string;
}

/**
 * The full screen for each blocking state (spec part 4, "Screens (part 4)"). Each body is the
 * API's own refusal text for that state, word for word (`companyMaintenance`, `companyUnavailable`
 * and `TENANCY_REFUSALS.company_suspended`; test S-20 pins them), and none names a reason, a date
 * or a billing word, because every member sees it (owner question 21).
 */
export const STANDING_SCREENS: Readonly<Record<BlockingStandingState, StandingScreen>> = {
  maintenance: {
    title: "Under maintenance",
    body: "Your company's account is under maintenance. Please try again later; your data is safe.",
  },
  unavailable: {
    title: "Not available right now",
    body: "Your company's data is not available right now. Please try again in a few minutes.",
  },
  locked: {
    title: "Account suspended",
    body: "Your company's account is suspended, so its data cannot be opened. Your data is kept; contact us to restore access.",
  },
};
