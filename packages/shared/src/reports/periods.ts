import { addDays, daysBetween, last12Months, monthEnd } from "../dates";

/** The date presets of the three hub reports (spec rule 24). */
export const REPORT_RANGES = {
  "12m": "Last 12 months",
  "3m": "Last 3 months",
  "1m": "This month",
  ytd: "This year",
} as const;

/** One of the hub reports' date presets. */
export type ReportRange = keyof typeof REPORT_RANGES;

/** The presets in the order the page offers them; the first is the default. */
export const REPORT_RANGE_KEYS = Object.keys(REPORT_RANGES) as readonly ReportRange[];

/** The months a range covers, oldest first, ending with this month (spec rule 24). */
export function reportMonths(range: ReportRange, today: string): string[] {
  const all = last12Months(today);
  if (range === "3m") return all.slice(-3);
  if (range === "1m") return all.slice(-1);
  if (range === "ytd") return all.filter((m) => m.startsWith(today.slice(0, 4)));
  return all;
}

/** The longest Business report period, in days counted inclusively (ADR 0055 S8). */
export const MAX_REPORT_DAYS = 366;

/** The years a report day may fall in (ADR 0055 S8): date arithmetic and SQL bounds stay four-digit. */
export const REPORT_YEARS = { from: 1900, to: 2999 } as const;

/** The longest customer search Payments received takes, in characters (ADR 0055 S10). */
export const REPORT_CUSTOMER_SEARCH_MAX = 100;

/** Every refusal of a report query, in the person's words (the API and the demo say the same). */
export const REPORT_QUERY_MESSAGES = {
  date: "Enter a date.",
  realDate: "Enter a real date.",
  order: "The start date must be on or before the end date.",
  tooLong: "Choose a period of 366 days or less.",
  locations: "Choose locations from the list.",
  productCategory: "Choose a product category from the list.",
  expenseCategory: "Choose an expense category from the list.",
  salesperson: "Choose a salesperson from the list.",
  vendor: "Choose a vendor from the list.",
  range: "Choose dates from the list.",
  warehouse: "Choose a warehouse from the list.",
  location: "Choose a location from the list.",
  category: "Choose a category from the list.",
  method: "Choose a payment method from the list.",
  customer: "Enter at most 100 characters to find a customer.",
  unknown: "This report can't be filtered that way.",
} as const;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Why a report day is refused, or null (ADR 0055 S8): `date` unless it reads yyyy-MM-dd, `realDate`
 * unless it is a real calendar day with a year in REPORT_YEARS, so no date sum leaves four digits.
 */
export function reportDayProblem(day: string): string | null {
  if (!DAY_PATTERN.test(day)) return REPORT_QUERY_MESSAGES.date;
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    return REPORT_QUERY_MESSAGES.realDate;
  }
  const year = parsed.getUTCFullYear();
  return year < REPORT_YEARS.from || year > REPORT_YEARS.to ? REPORT_QUERY_MESSAGES.realDate : null;
}

/**
 * Why a Business report period is refused, or null (ADR 0055 S8): the start after the end, then a
 * period longer than MAX_REPORT_DAYS counted inclusively. Both days must already be real days.
 */
export function reportPeriodProblem(from: string, to: string): string | null {
  if (from > to) return REPORT_QUERY_MESSAGES.order;
  return daysBetween(from, to) + 1 > MAX_REPORT_DAYS ? REPORT_QUERY_MESSAGES.tooLong : null;
}

/**
 * Why a Business report's From and To are refused, or null (ADR 0055 S8): each day first, then the
 * period. The demo refuses with it and the screen checks its Custom dates with it before sending,
 * so a period the API would refuse is caught beside the dates instead of failing the whole page.
 */
export function businessPeriodProblem(from: string, to: string): string | null {
  return reportDayProblem(from) ?? reportDayProblem(to) ?? reportPeriodProblem(from, to);
}

/** The dates a hub report reads (spec rule 24), so the API's readers and the shared builders agree. */
export interface HubWindow {
  months: string[];
  /** The first day of the first month. */
  from: string;
  /** Invoices issued up to the day after today (rule 24). */
  invoicesTo: string;
  /** Payments dated up to today (rule 24). */
  paymentsTo: string;
  /** Expenses dated up to the end of this month: the P&L counts the whole month. */
  expensesTo: string;
}

/** The dates the hub reports read (spec rule 24): the builders filter by these, and the API reads no more. */
export function hubWindow(range: ReportRange, today: string): HubWindow {
  const months = reportMonths(range, today);
  return {
    months,
    from: `${months[0] ?? today.slice(0, 7)}-01`,
    invoicesTo: addDays(today, 1),
    paymentsTo: today,
    expensesTo: monthEnd(today.slice(0, 7)),
  };
}
