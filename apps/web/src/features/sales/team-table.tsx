"use client";

import { useState } from "react";
import {
  PERIOD_LABELS,
  periodRange,
  seesMargin,
  teamStats,
  type DashboardPeriod,
  type Location,
  type Quote,
  type User,
} from "@workspace/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { ALL_WAREHOUSES, ALL_WAREHOUSES_OPTION, WarehouseSelect } from "@/components/warehouse-select";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import type { SalesLedger } from "@/lib/sales-ledger";

type Row = ReturnType<typeof teamStats>[number];

/**
 * Sales → Team (spec E2): per salesperson sales, paid revenue, margin (both keys, known cost), quotes
 * sent, conversion, average deal and commission earned, paid and pending, for a period and warehouse.
 * Data scope applies: Sales see their own row. The CSV is the payroll export of commission totals.
 * The Margin column needs `seesMargin` and every shown row's margin known, or its total and the CSV
 * would be partial (commissions.md Reports; CLAUDE.md rule 5; ADR 0037, 2026-11-17).
 */
export function TeamTable({
  sales,
  quotes,
  users,
  locations,
}: {
  sales: SalesLedger;
  quotes: Quote[];
  users: User[];
  locations: Location[];
}) {
  const can = useCan();
  const { user } = useWorkspace();
  const [period, setPeriod] = useState<Exclude<DashboardPeriod, "custom">>("month");
  const [warehouse, setWarehouse] = useState(ALL_WAREHOUSES);
  const range = periodRange(period, api.today());
  const commission = useApiQuery(
    (client) => client.teamCommission({ from: range.from, to: range.to }),
    [range.from, range.to],
  );
  const rows = teamStats(
    { ...sales, users, quotes, commission: new Map(commission.data ?? []) },
    { from: range.from, to: range.to, today: api.today(), locationId: warehouse === ALL_WAREHOUSES ? null : warehouse },
  ).filter((r) => r.userId === user.id || Number(r.sales) !== 0 || Number(r.paidRevenue) !== 0 || r.quotesSent > 0);
  const marginShown = seesMargin(can) && rows.every((r) => r.margin !== null);
  const money = (id: keyof Row, header: string, total = true): ColumnSpec<Row> => ({
    id,
    header,
    kind: "money",
    value: (r) => String(r[id]),
    total,
  });
  const columns: ColumnSpec<Row>[] = [
    {
      id: "name",
      header: "Salesperson",
      value: (r) => r.name,
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    money("sales", "Sales"),
    money("paidRevenue", "Paid revenue"),
    ...(marginShown ? [money("margin", "Margin")] : []),
    { id: "quotesSent", header: "Quotes sent", kind: "count", value: (r) => r.quotesSent, total: true },
    { id: "conversion", header: "Conversion", kind: "percent", value: (r) => r.conversionPct },
    money("averageDeal", "Average deal", false),
    money("earned", "Commission earned"),
    money("paid", "Commission paid"),
    money("pending", "Commission pending"),
  ];
  return (
    <DataTable
      id="sales-team"
      rows={rows}
      columns={columns}
      getRowId={(r) => r.userId}
      searchPlaceholder="Search salespeople"
      csvName="commissions"
      initialSort={{ id: "paidRevenue", desc: true }}
      empty={{ message: "No sales in this period." }}
      toolbar={
        <div className="flex flex-wrap gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <SelectTrigger className="bg-surface h-9 w-40" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PERIOD_LABELS) as DashboardPeriod[])
                .filter((p) => p !== "custom")
                .map((p) => (
                  <SelectItem key={p} value={p}>
                    {PERIOD_LABELS[p]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <WarehouseSelect
            label="Warehouse"
            extraOption={ALL_WAREHOUSES_OPTION}
            locations={locations}
            value={warehouse}
            onChange={setWarehouse}
          />
        </div>
      }
    />
  );
}
