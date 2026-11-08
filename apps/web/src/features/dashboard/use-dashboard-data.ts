"use client";

import {
  addDays,
  balance,
  bestSellers,
  last12Months,
  marginPct,
  moneyString,
  monthlyPnl,
  openInvoices,
  slowMovers,
  sum,
  type Crew,
  type Customer,
  type Job,
  type PnlMonth,
  type Product,
  type ProductSales,
  type SlowMover,
  boxedStock,
} from "@workspace/shared";
import { useApiQuery } from "@/lib/api/use-api";
import { useWorkspace } from "@/components/workspace/workspace-context";

/** Best sellers look back one quarter, so the list reflects the current season. */
const BEST_SELLER_DAYS = 90;
const LIST_LENGTH = 5;

/** A job on today's timeline with its crew and customer. */
export interface TimelineJob {
  job: Job;
  crew: Crew;
  customer: Customer | undefined;
}

/** Everything the dashboard shows, computed from documents, never typed by hand (spec section 4). */
export interface DashboardData {
  months: PnlMonth[];
  totals: { revenue: string; grossMargin: string; marginPct: string; receivables: string; openQuotes: string };
  best: (ProductSales & { product: Product })[];
  slow: (SlowMover & { product: Product })[];
  jobsToday: TimelineJob[];
}

const withProduct = <T extends { productId: string }>(rows: T[], products: Product[]) =>
  rows.flatMap((row) => {
    const product = products.find((p) => p.id === row.productId);
    return product ? [{ ...row, product }] : [];
  });

/**
 * Dashboard figures for the viewer. Lists come through the ApiClient, so data scope applies:
 * a Sales user's revenue is their own (spec "Dashboard": figures match the fixtures).
 */
export function useDashboardData() {
  const { access } = useWorkspace();
  return useApiQuery(
    async (client): Promise<DashboardData> => {
      const today = client.today();
      const [invoices, quotes, expenses, products, rolls, jobs, crews, customers, stockMovements] = await Promise.all([
        client.list("invoices"),
        client.list("quotes"),
        client.list("expenses"),
        client.list("products"),
        client.list("rolls"),
        client.list("jobs"),
        client.list("crews"),
        client.list("customers"),
        client.list("stockMovements"),
      ]);
      const months = monthlyPnl(last12Months(today), invoices, expenses);
      const revenue = sum(months.map((m) => m.revenue));
      const cogs = sum(months.map((m) => m.cogs));
      const open = quotes.filter((q) => q.status === "sent" || q.status === "accepted");
      return {
        months,
        totals: {
          revenue: moneyString(revenue),
          grossMargin: moneyString(revenue.minus(cogs)),
          marginPct: marginPct(revenue, cogs).toString(),
          receivables: moneyString(sum(openInvoices(invoices).map(balance))),
          openQuotes: moneyString(sum(open.map((q) => q.total))),
        },
        best: withProduct(bestSellers(invoices, addDays(today, -BEST_SELLER_DAYS), LIST_LENGTH), products),
        slow: withProduct(
          slowMovers(products, rolls, invoices, today, LIST_LENGTH, boxedStock(stockMovements)),
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
      };
    },
    [access],
  );
}
