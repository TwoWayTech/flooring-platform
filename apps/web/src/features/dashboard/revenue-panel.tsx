"use client";

import { useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { seesMargin } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { useCan } from "@/components/workspace/workspace-context";
import { KeyFigure } from "./key-figure";
import { monthLabel, RevenueChart, type ChartMonth } from "./revenue-chart";
import type { DashboardData } from "./use-dashboard-data";

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

function MonthsTable({ months, showMargin }: { months: readonly ChartMonth[]; showMargin: boolean }) {
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
        {months.map((m) => (
          <TableRow key={m.month}>
            <TableCell>
              {monthLabel(m.month)} {m.month.slice(0, 4)}
            </TableCell>
            <TableCell className="text-right">
              <Num kind="money" value={m.revenue} />
            </TableCell>
            {m.grossMargin !== undefined ? (
              <TableCell className="text-right">
                <Num kind="money" value={m.grossMargin} />
              </TableCell>
            ) : null}
            {m.grossMarginPct !== undefined ? (
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
 * Revenue and gross margin over the last 12 months (spec E1 widget, design brief "Dashboard"): the
 * totals above the chart they summarise, with a table view of the same numbers. Margins need both
 * keys (`seesMargin`) and a known cost for every month (`pnlTotals`); without them the title, key
 * figures, chart line and table columns all leave margin out, and the rows passed down hold no
 * margin at all (CLAUDE.md rule 5; ADR 0037, 2026-11-17).
 */
export function RevenuePanel({ data, ownScope }: { data: DashboardData; ownScope: boolean }) {
  const can = useCan();
  const margin = seesMargin(can) ? data.totals.margin : null;
  const showMargin = margin !== null;
  const [asTable, setAsTable] = useState(false);
  const months: ChartMonth[] = margin
    ? margin.months.map((m) => ({
        month: m.month,
        revenue: m.revenue,
        grossMargin: m.grossMargin,
        grossMarginPct: m.grossMarginPct,
      }))
    : data.months.map((m) => ({ month: m.month, revenue: m.revenue }));
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
        <KeyFigure label="Revenue" value={data.totals.revenue} kind="money" />
        {margin ? <KeyFigure label="Gross margin" value={margin.marginPct} kind="percent" /> : null}
        {margin ? <KeyFigure label="Gross profit" value={margin.grossMargin} kind="money" /> : null}
      </dl>
      {asTable ? (
        <MonthsTable months={months} showMargin={showMargin} />
      ) : (
        <div className="flex flex-col gap-2">
          <Legend showMargin={showMargin} />
          <RevenueChart months={months} showMargin={showMargin} />
        </div>
      )}
    </Panel>
  );
}
