"use client";

import Link from "next/link";
import { useState } from "react";
import { FilePlus2, Trophy } from "lucide-react";
import {
  changePct,
  dataScope,
  dec,
  featureOn,
  filteredHref,
  formatNumber,
  invoicesIn,
  INVOICE_STATUS_LABELS,
  isYear,
  PERIOD_LABELS,
  pendingQuotes,
  periodRange,
  receivablesSummary,
  salesTotals,
  sparkSeries,
  teamStats,
  type DashboardPeriod,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { DueSummary } from "@/components/due-summary";
import { QueryFallback } from "@/components/query-fallback";
import { ALL_WAREHOUSES, ALL_WAREHOUSES_OPTION, WarehouseSelect } from "@/components/warehouse-select";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { AttentionPanel } from "./attention-panel";
import { BestSellers } from "./best-sellers";
import { FigureCard } from "./figure-card";
import { RevenuePanel } from "./revenue-panel";
import { SlowMovers } from "./sellers-panels";
import { TodaysJobs } from "./todays-jobs";
import { useDashboardData, type DashboardData } from "./use-dashboard-data";

const PENDING_QUOTES_HREF = filteredHref("/sales?view=quotes", "sales-quotes", "status", ["Pending"]);
const TO_VERIFY_HREF = filteredHref("/sales?view=invoices", "sales-invoices", "state", [INVOICE_STATUS_LABELS.pending]);

/** The key figures for the chosen period and warehouse, with the change vs the previous period. */
function FigureRow({
  data,
  period,
  locationId,
}: {
  data: DashboardData;
  period: ReturnType<typeof periodRange>;
  locationId: string | null;
}) {
  const can = useCan();
  const numbers = useNumberSettings();
  const count = (n: number) => formatNumber(String(n), "count", numbers);
  const today = api.today();
  const { invoices, payments, ledgers } = data.sales;
  const now = salesTotals(invoicesIn(invoices, period.from, period.to, locationId));
  const before = salesTotals(invoicesIn(invoices, period.prevFrom, period.prevTo, locationId));
  const shipsFrom = new Map(invoices.map((i) => [i.id, i.locationId]));
  const paidIn = (from: string, to: string) =>
    payments.filter(
      (p) =>
        p.status === "confirmed" &&
        p.date >= from &&
        p.date <= to &&
        (!locationId || shipsFrom.get(p.invoiceId) === locationId),
    );
  const paidNow = paidIn(period.from, period.to)
    .reduce((s, p) => s.plus(p.amount), dec(0))
    .toString();
  const paidBefore = paidIn(period.prevFrom, period.prevTo)
    .reduce((s, p) => s.plus(p.amount), dec(0))
    .toString();
  const series = (value: "subtotal" | "margin") =>
    sparkSeries(
      invoicesIn(invoices, period.from, period.to, locationId),
      (i) => i.issuedAt,
      (i) => (value === "subtotal" ? dec(i.subtotal) : dec(i.subtotal).minus(i.cost)).times(i.isReturn ? -1 : 1),
      period.from,
      period.to,
    );
  const quotes = data.quotes.filter((q) => !locationId || q.locationId === locationId);
  const pending = pendingQuotes(quotes, today);
  const receivables = receivablesSummary(
    invoices.filter((i) => !locationId || i.locationId === locationId),
    ledgers,
    today,
  );
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
      <FigureCard
        label="Revenue"
        value={now.revenue}
        kind="money"
        change={changePct(now.revenue, before.revenue)}
        points={series("subtotal")}
      />
      {can("sales.margin.view_sensitive") ? (
        <FigureCard
          label="Gross margin"
          value={now.margin}
          kind="money"
          change={changePct(now.margin, before.margin)}
          note={`${formatNumber(now.marginPct, "percent", numbers)} of revenue`}
          points={series("margin")}
        />
      ) : null}
      <FigureCard
        label="Payments received"
        value={paidNow}
        kind="money"
        change={changePct(paidNow, paidBefore)}
        points={sparkSeries(
          paidIn(period.from, period.to),
          (p) => p.date,
          (p) => dec(p.amount),
          period.from,
          period.to,
        )}
      />
      {featureOn("sales.quotes") ? (
        <FigureCard
          label="Pending quotes"
          value={pending.total}
          kind="money"
          href={PENDING_QUOTES_HREF}
          note={
            pending.count === 0
              ? "None waiting"
              : `${count(pending.count)} waiting, oldest ${count(pending.oldestDays ?? 0)} days`
          }
        />
      ) : null}
      <FigureCard
        label="Overdue receivables"
        value={receivables.overdue}
        kind="money"
        note={`of ${formatNumber(receivables.total, "money", numbers, { compact: true })} open`}
      />
    </dl>
  );
}

/** The salesperson with the most paid revenue in the period (spec E2); Employee of the year for a year. */
function TopPerformer({
  data,
  period,
  locationId,
}: {
  data: DashboardData;
  period: ReturnType<typeof periodRange>;
  locationId: string | null;
}) {
  const { settings } = useWorkspace();
  const rows = teamStats(
    { ...data.sales, users: data.users, roles: data.roles, rules: settings.commissions.rules, quotes: data.quotes },
    { from: period.from, to: period.to, today: api.today(), locationId },
  ).filter((r) => dec(r.paidRevenue).gt(0));
  const [top, ...rest] = rows;
  return (
    <Panel title={isYear(period) ? "Employee of the year" : "Top performer"}>
      {!top ? (
        <p className="text-muted-foreground text-sm">No paid sales in this period yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2">
            <Trophy aria-hidden="true" className="text-chart-3 size-5" />
            <span className="font-semibold">{top.name}</span>
            <span className="text-muted-foreground ml-auto text-sm">
              <Num kind="money" value={top.paidRevenue} /> paid
            </span>
          </p>
          {rest.length ? (
            <ol className="text-sm" aria-label="Leaderboard">
              {rest.slice(0, 4).map((r, i) => (
                <li key={r.userId} className="border-hairline flex justify-between border-t py-1.5">
                  <span>
                    {i + 2}. {r.name}
                  </span>
                  <Num kind="money" value={r.paidRevenue} />
                </li>
              ))}
            </ol>
          ) : null}
          <Link href="/sales?view=team" className="text-brand-ink text-sm underline-offset-4 hover:underline">
            Sales team
          </Link>
        </div>
      )}
    </Panel>
  );
}

/**
 * The Flooring dashboard (spec "Dashboard", E1): one period selector and a warehouse filter above
 * a row of key figure cards, then the widgets: revenue and margin, receivables, payments to verify,
 * best sellers with their own filters, slow movers, today's jobs, needs attention and the top
 * performer. Each appears only for viewers allowed to see its data.
 */
export function DashboardPage() {
  const can = useCan();
  const { roles, user, viewAsRole } = useWorkspace();
  const data = useDashboardData();
  const today = api.today();
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const [custom, setCustom] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const [warehouse, setWarehouse] = useState(ALL_WAREHOUSES);
  const locationId = warehouse === ALL_WAREHOUSES ? null : warehouse;
  const range = periodRange(period, today, custom);
  const ownScope =
    (viewAsRole ? viewAsRole.dataScope : dataScope(roles.filter((r) => user.roleIds.includes(r.id)))) === "own";
  const sales = can("sales.invoice.view");
  const toVerify = data.data?.sales.payments.filter((p) => p.status === "pending").length ?? 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        actions={
          can("sales.quote.create") && featureOn("sales.quotes") ? (
            <Button asChild>
              <Link href="/sales/quotes/new">
                <FilePlus2 />
                New quote
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Dashboard filters">
        <Select value={period} onValueChange={(v) => setPeriod(v as DashboardPeriod)}>
          <SelectTrigger className="bg-surface h-9 w-44" aria-label="Period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PERIOD_LABELS) as DashboardPeriod[]).map((p) => (
              <SelectItem key={p} value={p}>
                {PERIOD_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {period === "custom" ? (
          <>
            <Input
              type="date"
              aria-label="From"
              className="h-9 w-40"
              value={custom.from}
              max={custom.to}
              onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            />
            <Input
              type="date"
              aria-label="To"
              className="h-9 w-40"
              value={custom.to}
              min={custom.from}
              max={today}
              onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            />
          </>
        ) : null}
        {data.data ? (
          <WarehouseSelect
            label="Warehouse"
            extraOption={ALL_WAREHOUSES_OPTION}
            locations={data.data.locations}
            value={warehouse}
            onChange={setWarehouse}
          />
        ) : null}
      </div>
      {data.status === "error" ? (
        <QueryFallback query={data} label="Loading dashboard" />
      ) : data.status !== "ready" ? (
        <div
          className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]"
          aria-busy="true"
          aria-label="Loading dashboard"
        >
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      ) : (
        <>
          {sales ? <FigureRow data={data.data} period={range} locationId={locationId} /> : null}
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
            <div className="flex min-w-0 flex-col gap-6">
              {sales ? <RevenuePanel data={data.data} ownScope={ownScope} /> : null}
              {sales ? (
                <DueSummary
                  title="Receivables"
                  basis="invoice"
                  {...receivablesSummary(
                    data.data.sales.invoices.filter((i) => !locationId || i.locationId === locationId),
                    data.data.sales.ledgers,
                    today,
                  )}
                />
              ) : null}
              <div className="grid gap-6 md:grid-cols-2">
                {sales ? (
                  <BestSellers
                    invoices={data.data.sales.invoices}
                    products={data.data.products}
                    locationId={locationId}
                  />
                ) : null}
                {can("inventory.product.view") ? <SlowMovers rows={data.data.slow} /> : null}
              </div>
            </div>
            {/* On phones what needs action comes first; on desktop it is the side column. */}
            <div className="order-first flex min-w-0 flex-col gap-6 lg:order-none">
              <AttentionPanel />
              {can("sales.payment.approve") && featureOn("sales.payments") ? (
                <Panel title="Payments to verify">
                  <p className="flex items-baseline justify-between gap-2 text-sm">
                    <span>
                      <span className="font-display text-2xl font-semibold">
                        <Num kind="count" value={toVerify} />
                      </span>{" "}
                      waiting for a second person
                    </span>
                    <Link href={TO_VERIFY_HREF} className="text-brand-ink underline-offset-4 hover:underline">
                      Review
                    </Link>
                  </p>
                </Panel>
              ) : null}
              {can("sales.commission.view") && sales ? (
                <TopPerformer data={data.data} period={range} locationId={locationId} />
              ) : null}
              {can("installation.job.view") && featureOn("installation.calendar") ? (
                <TodaysJobs jobs={data.data.jobsToday} />
              ) : null}
            </div>
          </div>
        </>
      )}
    </>
  );
}
