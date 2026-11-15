import type { BusinessFilters, PaymentsReportQuery, PnlQuery, SalesByCategoryQuery } from "@workspace/shared";

/** The three hub report routes (docs/api-contract.md, Reports; ADR 0055). */
export type HubReportRoute = "/reports/pnl" | "/reports/sales-by-category" | "/reports/payments";

/** Any hub report's query: the P&L's fields, plus those Sales by category and Payments received add. */
export type HubReportQuery = PnlQuery &
  Partial<Pick<SalesByCategoryQuery, "category">> &
  Partial<Pick<PaymentsReportQuery, "method" | "customer">>;

/**
 * GET /reports/business's path for a period and its filters (spec F2). Each filter is sent only when
 * set, and locations as one comma-separated list, because the API refuses a parameter it doesn't
 * know or one sent twice (ADR 0055 S10). The company is never sent: it comes from the session.
 */
export function businessReportPath(filters: BusinessFilters): string {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.locationIds.length > 0) params.set("locationIds", filters.locationIds.join(","));
  if (filters.productCategory !== null) params.set("productCategory", filters.productCategory);
  if (filters.expenseCategory !== null) params.set("expenseCategory", filters.expenseCategory);
  if (filters.salesRepId !== null) params.set("salesRepId", filters.salesRepId);
  if (filters.supplierId !== null) params.set("supplierId", filters.supplierId);
  return `/reports/business?${params.toString()}`;
}

/**
 * A hub report's path (spec rule 24): the date preset, then the warehouse, category, payment method
 * and customer search, each only when set (the customer trimmed, and left out when empty), so the
 * API's strict query reads exactly what the screen picked (ADR 0055 S10). No company id is ever sent.
 */
export function hubReportPath(path: HubReportRoute, query: HubReportQuery): string {
  const params = new URLSearchParams({ range: query.range });
  if (query.locationId) params.set("locationId", query.locationId);
  if (query.category) params.set("category", query.category);
  if (query.method) params.set("method", query.method);
  const customer = query.customer?.trim() ?? "";
  if (customer) params.set("customer", customer);
  return `${path}?${params.toString()}`;
}
