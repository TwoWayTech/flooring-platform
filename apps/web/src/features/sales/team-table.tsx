"use client";

import { useState } from "react";
import {
  PERIOD_LABELS,
  periodRange,
  teamStats,
  type DashboardPeriod,
  type Location,
  type Quote,
  type Role,
  type User,
} from "@workspace/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { ALL_WAREHOUSES, ALL_WAREHOUSES_OPTION, WarehouseSelect } from "@/components/warehouse-select";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import type { SalesLedger } from "@/lib/sales-ledger";

type Row = ReturnType<typeof teamStats>[number];

/**
 * Sales → Team (spec E2): per salesperson sales, paid revenue, margin (sensitive), quotes sent,
 * conversion, average deal and commission earned, paid and pending, for a period and warehouse.
 * Data scope applies: Sales see their own row. The CSV is the payroll export of commission totals.
 */
export function TeamTable({
  sales,
  quotes,
  users,
  roles,
  locations,
}: {
  sales: SalesLedger;
  quotes: Quote[];
  users: User[];
  roles: Role[];
  locations: Location[];
}) {
  const can = useCan();
  const { settings, user } = useWorkspace();
  const [period, setPeriod] = useState<Exclude<DashboardPeriod, "custom">>("month");
  const [warehouse, setWarehouse] = useState(ALL_WAREHOUSES);
  const range = periodRange(period, api.today());
  const rows = teamStats(
    { ...sales, users, roles, rules: settings.commissions.rules, quotes },
    { from: range.from, to: range.to, today: api.today(), locationId: warehouse === ALL_WAREHOUSES ? null : warehouse },
  ).filter((r) => r.userId === user.id || Number(r.sales) !== 0 || Number(r.paidRevenue) !== 0 || r.quotesSent > 0);
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
    ...(can("sales.margin.view_sensitive") ? [money("margin", "Margin")] : []),
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
