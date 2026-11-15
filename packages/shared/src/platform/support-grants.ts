import type { SupportGrantStatus } from "../types/platform";

/** A moment as the API (a `Date` from the database) or the demo (an ISO string) holds it. */
type Moment = Date | string;

const HOUR_MS = 3_600_000;

/**
 * How many support requests one platform admin may send, and over what window
 * (docs/specs/platform-admin.md, "POST /platform/support-grants", The limits). Every grant the
 * admin asked for counts, across all companies, revoked, expired and deleted ones included.
 */
export const SUPPORT_REQUEST_LIMIT = { perWindow: 10, windowMs: 24 * HOUR_MS } as const;

/** The whole hours a support grant may last (spec "POST /platform/support-grants", Body). */
export const SUPPORT_HOURS = { min: 1, max: 72 } as const;

/** The length of a support request's reason, after trimming (spec "POST /platform/support-grants", Body). */
export const SUPPORT_REASON = { min: 10, max: 500 } as const;

/** Why a reason is refused; the API's 400, the dialog and the demo say the same. */
export const SUPPORT_REASON_MESSAGE = `Give a reason of ${SUPPORT_REASON.min} to ${SUPPORT_REASON.max} characters.`;

/** Why the hours are refused; the API's 400, the dialog and the demo say the same. */
export const SUPPORT_HOURS_MESSAGE = `Enter a whole number of hours from ${SUPPORT_HOURS.min} to ${SUPPORT_HOURS.max}.`;

/** The 409 `grant_open` message (spec "Validations and messages (part 3)"). */
export const SUPPORT_OPEN_MESSAGE = "You already have an open support request for this company.";

/** The 429 `rate_limited` message (spec "Validations and messages (part 3)"). */
export const SUPPORT_LIMIT_MESSAGE = `You can send at most ${SUPPORT_REQUEST_LIMIT.perWindow} support requests in ${
  SUPPORT_REQUEST_LIMIT.windowMs / HOUR_MS
} hours. Try again later.`;

/** Milliseconds since the epoch; NaN for a string that is not a moment. */
function timeOf(moment: Moment): number {
  return moment instanceof Date ? moment.getTime() : Date.parse(moment);
}

/** Whether a nullable moment column is set. */
function isSet(moment: Moment | null | undefined): boolean {
  return moment !== null && moment !== undefined;
}

/** The dates of a support grant that its status comes from. */
export interface SupportGrantDates {
  approvedAt: Moment | null;
  revokedAt: Moment | null;
  expiresAt: Moment;
}

/**
 * A support grant's status, derived and never stored (spec "Support requests", Status; ADR 0013
 * style). The order is the Owner's list's in Settings: revoked when `revokedAt` is set, else
 * expired when `expiresAt` is at or before `now`, else approved when `approvedAt` is set, else
 * pending. An expiry that can't be read counts as expired: deny by default.
 */
export function supportGrantStatus(grant: SupportGrantDates, now: Date): SupportGrantStatus {
  if (isSet(grant.revokedAt)) return "revoked";
  if (!(timeOf(grant.expiresAt) > now.getTime())) return "expired";
  return isSet(grant.approvedAt) ? "approved" : "pending";
}

/** The fields of a support grant that say whether it is still open. */
export interface OpenGrantDates {
  revokedAt: Moment | null;
  expiresAt: Moment;
  deletedAt?: Moment | null;
}

/**
 * Whether a support grant is open (spec "Support requests", Open): not revoked, not deleted, and
 * expiring after `now`, so pending or approved. An open grant blocks the same admin's next request
 * for that company (409 `grant_open`), and an approved one blocks it too.
 */
export function isOpenSupportGrant(grant: OpenGrantDates, now: Date): boolean {
  return !isSet(grant.revokedAt) && !isSet(grant.deletedAt) && timeOf(grant.expiresAt) > now.getTime();
}

/**
 * The start of the request-limit window ending at `now` (spec "The limits"). The API's SQL
 * prefilter and `inSupportWindow` both use it, so the two never disagree.
 */
export function supportWindowStart(now: Date): Date {
  return new Date(now.getTime() - SUPPORT_REQUEST_LIMIT.windowMs);
}

/**
 * Whether a grant created at `createdAt` counts toward the request limit at `now`: created after
 * `supportWindowStart(now)`. A grant stamped later than `now` (clock drift) counts, and so does a
 * time that can't be read: deny by default.
 */
export function inSupportWindow(createdAt: Moment, now: Date): boolean {
  return !(timeOf(createdAt) <= supportWindowStart(now).getTime());
}

/** When a grant asked for at `now` for `hours` hours ends (spec "What a request does", step 6). */
export function supportGrantExpiresAt(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * HOUR_MS);
}

/** A support request's reason and hours as typed, before they are checked. */
export interface SupportRequestFields {
  reason: string;
  hours: number;
}

/**
 * Why a support request's fields are refused, or null when they are fine (spec "POST
 * /platform/support-grants", Body): the reason first, then the hours, as the API's schema reports
 * them. The reason counts after trimming; the hours are a whole number in `SUPPORT_HOURS`.
 */
export function supportRequestInputProblem(input: SupportRequestFields): string | null {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < SUPPORT_REASON.min || reason.length > SUPPORT_REASON.max) return SUPPORT_REASON_MESSAGE;
  const { hours } = input;
  if (!Number.isInteger(hours) || hours < SUPPORT_HOURS.min || hours > SUPPORT_HOURS.max) return SUPPORT_HOURS_MESSAGE;
  return null;
}

/** What the request limits need to know about the admin's grants at the moment of a request. */
export interface SupportRequestFacts {
  /** Whether the admin has an open grant for this company. */
  openForCompany: boolean;
  /** How many grants the admin asked for in the window, across all companies. */
  requestsInWindow: number;
}

/** One of the admin's own grants, as `supportRequestFacts` reads it. */
export interface SupportGrantFactRow extends OpenGrantDates {
  companyId: string;
  createdAt: Moment;
}

/**
 * The limit facts for a request by one admin for `companyId` at `now` (spec "What a request does",
 * step 4). `grants` must be that admin's own grants, deleted ones included; the API reads them
 * under the admin's row lock and the demo from its store, so both count the same way.
 */
export function supportRequestFacts(
  grants: readonly SupportGrantFactRow[],
  companyId: string,
  now: Date,
): SupportRequestFacts {
  return {
    openForCompany: grants.some((grant) => grant.companyId === companyId && isOpenSupportGrant(grant, now)),
    requestsInWindow: grants.filter((grant) => inSupportWindow(grant.createdAt, now)).length,
  };
}

/** Why a support request is refused by the limits, as the API answers it. */
export type SupportRequestRefusal =
  { status: 409; code: "grant_open"; message: string } | { status: 429; code: "rate_limited"; message: string };

/**
 * Why the limits refuse a support request, or null when it may be sent (spec "The limits"): an
 * open grant for the company first (409 `grant_open`), then the window (429 `rate_limited`) once
 * the admin has sent `SUPPORT_REQUEST_LIMIT.perWindow` requests in it. A count that is not a
 * number refuses: deny by default.
 */
export function supportRequestRefusal(facts: SupportRequestFacts): SupportRequestRefusal | null {
  if (facts.openForCompany) return { status: 409, code: "grant_open", message: SUPPORT_OPEN_MESSAGE };
  if (!(facts.requestsInWindow < SUPPORT_REQUEST_LIMIT.perWindow))
    return { status: 429, code: "rate_limited", message: SUPPORT_LIMIT_MESSAGE };
  return null;
}
