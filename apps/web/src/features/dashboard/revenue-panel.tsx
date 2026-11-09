"use client";

import { useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { filteredHref, formatNumber, SENSITIVE } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { Panel } from "@workspace/ui/components/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { useCan } from "@/components/workspace/workspace-context";
import { KeyFigure } from "./key-figure";
import { monthLabel, RevenueChart } from "./revenue-chart";
import type { DashboardData } from "./use-dashboard-data";

/** The quotes list filtered to Pending, behind the Pending quotes figure (spec B1). */
const PENDING_QUOTES_HREF = filteredHref("/sales?view=quotes", "sales-quotes", "status", ["Pending"]);

function Legend({ showMargin }: { showMargin: boolean }) {
  const items = [
    { label: "Revenue", color: "var(--chart-1)" },
    ...(showMargin ? [{ label: "Gross margin", color: "var(--chart-2)" }] : []),
  ];
  return (
    <ul className="text-muted-foreground flex items-center gap-4 text-xs" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function MonthsTable({ data, showMargin }: { data: DashboardData; showMargin: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead className="text-right">Revenue</TableHead>
          {showMargin ? <TableHead className="text-right">Gross margin</TableHead> : null}
          {showMargin ? <TableHead className="text-right">Margin</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.months.map((m) => (
          <TableRow key={m.month}>
            <TableCell>
              {monthLabel(m.month)} {m.month.slice(0, 4)}
            </TableCell>
            <TableCell className="text-right">
              <Num kind="money" value={m.revenue} />
            </TableCell>
            {showMargin ? (
              <TableCell className="text-right">
                <Num kind="money" value={m.grossMargin} />
              </TableCell>
            ) : null}
            {showMargin ? (
              <TableCell className="text-right">
                <Num kind="percent" value={m.grossMarginPct} />
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The dashboard's large panel (design brief "Dashboard"): key figures in one row above the
 * 12-month chart they summarise, with a table view of the same numbers. Margins need view_sensitive.
 */
export function RevenuePanel({ data, ownScope }: { data: DashboardData; ownScope: boolean }) {
  const can = useCan();
  const showMargin = can(SENSITIVE.margin);
  const [asTable, setAsTable] = useState(false);
  const { totals, pending } = data;
  const numbers = useNumberSettings();
  const formatCount = (n: number) => formatNumber(String(n), "count", numbers);
  const pendingFigure = (
    <KeyFigure
      label="Pending quotes"
      value={pending.total}
      kind="money"
      href={PENDING_QUOTES_HREF}
      note={
        pending.count === 0
          ? "None waiting"
          : `${formatCount(pending.count)} waiting, oldest ${formatCount(pending.oldestDays ?? 0)} days`
      }
    />
  );
  return (
    <Panel
      title={
        ownScope
          ? "Your revenue, last 12 months"
          : showMargin
            ? "Revenue and gross margin, last 12 months"
            : "Revenue, last 12 months"
      }
      actions={
        <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? <BarChart3 /> : <Table2 />}
          {asTable ? "Show chart" : "Show table"}
        </Button>
      }
      bodyClassName="flex flex-col gap-5"
    >
      <dl className="divide-hairline grid grid-cols-2 gap-y-4 sm:grid-cols-4 sm:divide-x [&>div]:sm:px-4 [&>div:first-child]:sm:pl-0">
        <KeyFigure label="Revenue" value={totals.revenue} kind="money" />
        {showMargin ? <KeyFigure label="Gross margin" value={totals.marginPct} kind="percent" /> : pendingFigure}
        <KeyFigure label="Receivables" value={totals.receivables} kind="money" />
        {showMargin ? pendingFigure : null}
      </dl>
      {asTable ? (
        <MonthsTable data={data} showMargin={showMargin} />
      ) : (
        <div className="flex flex-col gap-2">
          <Legend showMargin={showMargin} />
          <RevenueChart months={data.months} showMargin={showMargin} />
        </div>
      )}
    </Panel>
  );
}
