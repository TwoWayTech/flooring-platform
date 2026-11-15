import { BadRequestException } from "@nestjs/common";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  REPORT_CUSTOMER_SEARCH_MAX,
  REPORT_QUERY_MESSAGES as M,
  REPORT_RANGE_KEYS,
  reportDayProblem,
  reportPeriodProblem,
  type BusinessFilters,
  type ExpenseCategory,
  type Location,
  type PaymentsReportQuery,
  type PnlQuery,
  type ProductCategory,
  type ReportRange,
  type SalesByCategoryQuery,
} from "@workspace/shared";
import { z } from "zod";
import { parse } from "../../core/access/request-actor";

/** A refused report query: 400 `invalid_request` in the person's words (REPORT_QUERY_MESSAGES). */
function refuse(message: string): BadRequestException {
  return new BadRequestException({ code: "invalid_request", message });
}

/**
 * A report day, `yyyy-MM-dd`, a real calendar day with a year from 1900 to 2999 (ADR 0055 S8). Not
 * `DAY` from sales-common: a parameter sent twice arrives as an array and must still read "Enter a
 * date.", and the year range keeps every date sum and SQL bound four-digit.
 */
export const REPORT_DAY = z.string({ error: M.date }).superRefine((day, ctx) => {
  const problem = reportDayProblem(day);
  if (problem) ctx.addIssue({ code: "custom", message: problem });
});

/** The most locations one Business report may pick (ADR 0055 S10): far more than any company has. */
export const MAX_REPORT_LOCATIONS = 50;

/** Maps only an unknown parameter to the report's words; every field names its own message. */
const UNKNOWN = { error: (issue: { code?: string }) => (issue.code === "unrecognized_keys" ? M.unknown : undefined) };

/** The product categories the Business report can filter by (CATEGORY_LABELS keys). */
const PRODUCT_CATEGORY_KEYS = Object.keys(CATEGORY_LABELS) as [ProductCategory, ...ProductCategory[]];

/** The categories Sales by category can filter by: services are labour, not a product category (rule 24). */
const SALES_CATEGORY_KEYS = PRODUCT_CATEGORY_KEYS.filter((key) => key !== "service") as [
  ProductCategory,
  ...ProductCategory[],
];

/** Location ids as the Business report sends them: comma-separated UUIDs, empty parts dropped (spec F2). */
const LOCATION_IDS = z
  .string({ error: M.locations })
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(z.uuid({ error: M.locations })).max(MAX_REPORT_LOCATIONS, { error: M.locations }));

const BUSINESS = z.strictObject(
  {
    from: REPORT_DAY,
    to: REPORT_DAY,
    locationIds: LOCATION_IDS.optional(),
    productCategory: z.enum(PRODUCT_CATEGORY_KEYS, { error: M.productCategory }).optional(),
    // The picker's list (rule 22): payroll is never offered, so it is refused (known limit kept:
    // sales_tax_payment is offered and leaves the Expenses sections empty).
    expenseCategory: z
      .enum(EXPENSE_CATEGORIES as [ExpenseCategory, ...ExpenseCategory[]], { error: M.expenseCategory })
      .optional(),
    salesRepId: z.uuid({ error: M.salesperson }).optional(),
    supplierId: z.uuid({ error: M.vendor }).optional(),
  },
  UNKNOWN,
);

/** The fields every hub report takes (spec rule 24): a date preset and, optionally, a warehouse. */
const HUB = {
  range: z.enum(REPORT_RANGE_KEYS as [ReportRange, ...ReportRange[]], { error: M.range }).optional(),
  locationId: z.uuid({ error: M.warehouse }).optional(),
};

const PNL = z.strictObject(HUB, UNKNOWN);

const SALES = z.strictObject(
  {
    ...HUB,
    category: z.enum(SALES_CATEGORY_KEYS, { error: M.category }).optional(),
  },
  UNKNOWN,
);

const PAYMENTS = z.strictObject(
  {
    ...HUB,
    method: z.enum(PAYMENT_METHODS, { error: M.method }).optional(),
    customer: z.string({ error: M.customer }).max(REPORT_CUSTOMER_SEARCH_MAX, { error: M.customer }).optional(),
  },
  UNKNOWN,
);

const OPTIONS = z.strictObject({}, UNKNOWN);

/**
 * Refuses a parameter the schema does not name (ADR 0055 S10), before any field is read, whatever
 * else is wrong: `?companyId=` can never be read as anything but a mistake, because the tenant comes
 * from the verified session only (CLAUDE.md rule 2). The strict schemas say the same as a second net.
 */
function refuseUnknown(schema: z.ZodObject, query: unknown): void {
  const given = typeof query === "object" && query !== null ? Object.keys(query) : [];
  if (given.some((key) => !Object.hasOwn(schema.shape, key))) throw refuse(M.unknown);
}

/** GET /reports/options takes no parameter (ADR 0055 S10). */
export function parseOptionsQuery(query: unknown): void {
  refuseUnknown(OPTIONS, query);
  parse(OPTIONS, query);
}

/**
 * The Business report's period and filters (spec F2; ADR 0055 S8, S10): two real days in order, at
 * most 366 days counted inclusively, and filters in the pickers' shapes. Whether the locations are
 * live is the service's to check, inside the report's snapshot.
 */
export function parseBusinessQuery(query: unknown): BusinessFilters {
  refuseUnknown(BUSINESS, query);
  const parsed = parse(BUSINESS, query);
  const problem = reportPeriodProblem(parsed.from, parsed.to);
  if (problem) throw refuse(problem);
  return {
    from: parsed.from,
    to: parsed.to,
    locationIds: [...new Set(parsed.locationIds ?? [])],
    productCategory: parsed.productCategory ?? null,
    expenseCategory: parsed.expenseCategory ?? null,
    salesRepId: parsed.salesRepId ?? null,
    supplierId: parsed.supplierId ?? null,
  };
}

/** The hub fields as the shared builders take them; the range defaults to the last 12 months (rule 24). */
function hubOf(parsed: { range?: ReportRange | undefined; locationId?: string | undefined }): PnlQuery {
  return { range: parsed.range ?? "12m", locationId: parsed.locationId ?? null };
}

/** The Profit and loss query (spec rule 24). */
export function parsePnlQuery(query: unknown): PnlQuery {
  refuseUnknown(PNL, query);
  return hubOf(parse(PNL, query));
}

/** The Sales by category query (spec rule 24). */
export function parseSalesQuery(query: unknown): SalesByCategoryQuery {
  refuseUnknown(SALES, query);
  const parsed = parse(SALES, query);
  return { ...hubOf(parsed), category: parsed.category ?? null };
}

/** The Payments received query (spec rule 24). */
export function parsePaymentsQuery(query: unknown): PaymentsReportQuery {
  refuseUnknown(PAYMENTS, query);
  const parsed = parse(PAYMENTS, query);
  return { ...hubOf(parsed), method: parsed.method ?? null, customer: parsed.customer ?? "" };
}

/** Every picked location must be a live one (ADR 0055 S10); 400 `locations` otherwise. */
export function checkLocations(ids: readonly string[], live: readonly Pick<Location, "id">[]): void {
  const known = new Set(live.map((location) => location.id));
  if (ids.some((id) => !known.has(id))) throw refuse(M.locations);
}

/** A hub report's location must be a live warehouse, where invoices ship from (rule 24; S10). */
export function checkWarehouse(id: string | null, live: readonly Pick<Location, "id" | "kind">[]): void {
  if (id !== null && !live.some((location) => location.id === id && location.kind === "warehouse")) {
    throw refuse(M.warehouse);
  }
}
