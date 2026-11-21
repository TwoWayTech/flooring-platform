"use client";

import {
  last12Months,
  monthlyPnl,
  pnlTotals,
  slowMovers,
  type Crew,
  type Customer,
  type Expense,
  type Job,
  type Location,
  type PnlMonth,
  type PnlTotals,
  type Product,
  type Quote,
  type Role,
  type SlowMover,
  type User,
} from "@workspace/shared";
import { useApiQuery } from "@/lib/api/use-api";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { loadSalesLedger, type SalesLedger } from "@/lib/sales-ledger";

const LIST_LENGTH = 5;

/** A job on today's timeline with its crew and customer. */
export interface TimelineJob {
  job: Job;
  crew: Crew;
  customer: Customer | undefined;
}

/**
 * Everything the dashboard shows, from documents (spec section 4, E1). The 12-month chart and
 * slow movers are computed here; period and warehouse figures are computed on the page from the
 * records, so changing the period does not reload anything.
 */
export interface DashboardData {
  months: PnlMonth[];
  /**
   * The 12-month totals (`pnlTotals`). The margin part is shown only with `seesMargin`: the panel
   * decides, and the hook doesn't read permissions, so View as keeps working through `useCan`.
   */
  totals: PnlTotals;
  slow: (SlowMover & { product: Product })[];
  jobsToday: TimelineJob[];
  sales: SalesLedger;
  quotes: Quote[];
  expenses: Expense[];
  products: Product[];
  locations: Location[];
  users: User[];
  roles: Role[];
}

const withProduct = <T extends { productId: string }>(rows: T[], products: Product[]) =>
  rows.flatMap((row) => {
    const product = products.find((p) => p.id === row.productId);
    return product ? [{ ...row, product }] : [];
  });

/**
 * Dashboard records for the viewer. Lists come through the ApiClient, so data scope applies:
 * a Sales user's revenue is their own (spec "Dashboard": figures match the fixtures).
 */
export function useDashboardData() {
  const { access } = useWorkspace();
  return useApiQuery(
    async (client): Promise<DashboardData> => {
      const today = client.today();
      const [
        sales,
        quotes,
        expenses,
        products,
        rolls,
        jobs,
        crews,
        customers,
        stockMovements,
        locations,
        users,
        roles,
      ] = await Promise.all([
        loadSalesLedger(client),
        client.list("quotes"),
        client.list("expenses"),
        client.list("products"),
        client.list("rolls"),
        client.list("jobs"),
        client.list("crews"),
        client.list("customers"),
        client.list("stockMovements"),
        client.list("locations"),
        client.list("users"),
        client.list("roles"),
      ]);
      const months = monthlyPnl(last12Months(today), sales.invoices, expenses);
      return {
        months,
        totals: pnlTotals(months),
        slow: withProduct(
          slowMovers(products, rolls, sales.invoices, today, LIST_LENGTH, stockMovements),
          products,
        ),
        jobsToday: jobs
          .filter((j) => j.date === today)
          .sort((a, b) => a.startHour - b.startHour)
          .map((job) => ({
            job,
            crew: crews.find((c) => c.id === job.crewId)!,
            customer: customers.find((c) => c.id === job.customerId),
          })),
        sales,
        quotes,
        expenses,
        products,
        locations,
        users,
        roles,
      };
    },
    [access],
  );
}
