import { addDays, daysBetween } from "../dates";
import { moneyString, sum } from "../money";
import type { Quote } from "../types";

/**
 * What a quote's state is today (spec B1): its stored status, or Expired for a pending quote
 * whose expiry date has passed. Expired is never stored, so moving the date changes it at once.
 */
export type QuoteState = Quote["status"] | "expired";

/** A status change a person makes on a quote (spec B1). Convert has its own store call. */
export type QuoteAction = "send" | "accept" | "decline";

/** The fields full validation checks before a quote is sent or converted. */
export type QuoteField = "customer" | "lines" | "street" | "city" | "state" | "zip" | "location" | "expiresAt";

/** Field messages from validation, shown next to each field. */
export type QuoteProblems = Partial<Record<QuoteField, string>>;

/** A quote's state on a day: pending past its expiry date reads Expired. */
export function quoteState(quote: Pick<Quote, "status" | "expiresAt">, today: string): QuoteState {
  if (quote.status === "pending" && quote.expiresAt && quote.expiresAt < today) return "expired";
  return quote.status;
}

/** Whether a quote can still turn into an invoice: not converted and not declined. */
export function quoteIsOpen(quote: Pick<Quote, "status">): boolean {
  return quote.status === "draft" || quote.status === "pending" || quote.status === "accepted";
}

/**
 * The status changes a quote offers in its state (spec B1): a draft can be sent; a pending or
 * expired quote can be accepted, declined or sent again with a new expiry date; an accepted
 * quote can still be declined. Converted and declined quotes are closed.
 */
export function quoteActions(quote: Pick<Quote, "status" | "expiresAt">, today: string): QuoteAction[] {
  switch (quoteState(quote, today)) {
    case "draft":
      return ["send"];
    case "pending":
      return ["accept", "decline"];
    case "expired":
      return ["send", "accept", "decline"];
    case "accepted":
      return ["decline"];
    default:
      return [];
  }
}

/** The status each action leads to. */
export const QUOTE_ACTION_STATUS: Record<QuoteAction, Quote["status"]> = {
  send: "pending",
  accept: "accepted",
  decline: "declined",
};

/** A draft needs only its customer (spec B1: "only a customer name required"). */
export function quoteDraftProblem(quote: Pick<Quote, "customerId">): string | null {
  return quote.customerId ? null : "Choose a customer before saving the quote.";
}

/**
 * Full validation before a quote is sent or converted (spec B1): customer, at least one line, a
 * complete job-site address (it picks the tax rule), the warehouse it ships from, and an expiry
 * date that is not in the past.
 */
export function quoteSendProblems(
  quote: Pick<Quote, "customerId" | "lines" | "jobSite" | "locationId">,
  expiresAt: string | null,
  today: string,
): QuoteProblems {
  const problems: QuoteProblems = {};
  if (!quote.customerId) problems.customer = "Choose a customer.";
  if (quote.lines.length === 0) problems.lines = "Add at least one line.";
  if (!quote.jobSite.street.trim()) problems.street = "Enter the job-site street.";
  if (!quote.jobSite.city.trim()) problems.city = "Enter the city.";
  if (!quote.jobSite.state) problems.state = "Choose the state.";
  if (!/^\d{5}(-\d{4})?$/.test(quote.jobSite.zip.trim())) problems.zip = "Enter a 5-digit ZIP.";
  if (!quote.locationId) problems.location = "Choose the warehouse it ships from.";
  if (expiresAt && expiresAt < today) problems.expiresAt = "The expiry date can't be in the past.";
  return problems;
}

/** The default expiry date for a quote sent today. */
export function defaultQuoteExpiry(today: string, expiryDays: number): string {
  return addDays(today, expiryDays);
}

/** Days since a quote was created; used for the Age column and the oldest pending quote. */
export function quoteAgeDays(quote: Pick<Quote, "createdAt">, today: string): number {
  return Math.max(0, daysBetween(quote.createdAt.slice(0, 10), today));
}

/** The dashboard's Pending quotes figure (spec B1): how many, their value and the oldest age. */
export interface PendingQuotesSummary {
  count: number;
  total: string;
  oldestDays: number | null;
}

/** Sums the quotes waiting for the customer: pending, not yet expired. */
export function pendingQuotes(quotes: readonly Quote[], today: string): PendingQuotesSummary {
  const pending = quotes.filter((q) => quoteState(q, today) === "pending");
  return {
    count: pending.length,
    total: moneyString(sum(pending.map((q) => q.total))),
    oldestDays: pending.length ? Math.max(...pending.map((q) => quoteAgeDays(q, today))) : null,
  };
}

/** Words for each quote state, for pills, filters, CSV and the audit log. */
export const QUOTE_STATE_LABELS: Record<QuoteState, string> = {
  draft: "Draft",
  pending: "Pending",
  accepted: "Accepted",
  converted: "Converted",
  declined: "Declined",
  expired: "Expired",
};

/** Label of a quote state. */
export function quoteStateLabel(state: QuoteState): string {
  return QUOTE_STATE_LABELS[state];
}
