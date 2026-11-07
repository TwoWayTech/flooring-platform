"use client";

import { Briefcase, CircleCheck, CirclePause, CircleX, FileSignature } from "lucide-react";
import { SENSITIVE, stateName, type Employee } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { QueryFallback } from "@/components/query-fallback";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { HrTabs } from "./hr-tabs";

const STATUS = {
  active: { tone: "success", icon: CircleCheck, label: "Active" },
  on_leave: { tone: "warning", icon: CirclePause, label: "On leave" },
  terminated: { tone: "neutral", icon: CircleX, label: "Left" },
} as const;

const WORKER = {
  w2: { tone: "brand", icon: Briefcase, label: "W-2" },
  "1099": { tone: "neutral", icon: FileSignature, label: "1099" },
} as const;

const PAY_UNIT: Record<Employee["payType"], string> = { hourly: "per hour", salary: "per year", per_job: "per job" };

/**
 * Employees (spec "HR host"): W-2 and 1099 workers with department, state and PTO balance. Pay
 * rate is sensitive and shows only with hr.employee.view_sensitive (CLAUDE.md rule 2).
 */
export function EmployeesPage() {
  const can = useCan();
  const { product } = useWorkspace();
  const formatDate = useFormatDate();
  const data = useApiQuery((client) => client.list("employees"), []);
  if (!can("hr.employee.view")) return <NoAccess />;

  const columns: ColumnSpec<Employee>[] = [
    {
      id: "name",
      header: "Name",
      value: (e) => e.name,
      cell: (e) => (
        <span className="flex flex-col">
          <span className="font-medium">{e.name}</span>
          <span className="text-muted-foreground text-xs">{e.title}</span>
        </span>
      ),
    },
    { id: "department", header: "Department", value: (e) => e.department },
    {
      id: "type",
      header: "Worker type",
      value: (e) => WORKER[e.workerType].label,
      cell: (e) => <StatusPill {...WORKER[e.workerType]} />,
    },
    ...(can(SENSITIVE.payRate)
      ? [
          {
            id: "pay",
            header: "Pay rate",
            kind: "money" as const,
            value: (e: Employee) => e.payRate,
            cell: (e: Employee, { delta }: { delta: number }) => (
              <>
                <Num kind="money" value={e.payRate} delta={delta} />
                <span className="text-muted-foreground"> {PAY_UNIT[e.payType]}</span>
              </>
            ),
          },
        ]
      : []),
    { id: "state", header: "Works in", value: (e) => stateName(e.state) },
    { id: "hired", header: "Hired", value: (e) => e.hiredAt, cell: (e) => formatDate(e.hiredAt) },
    { id: "pto", header: "PTO balance", kind: "quantity", unit: "h", value: (e) => e.ptoBalanceHours },
    {
      id: "status",
      header: "Status",
      value: (e) => STATUS[e.status].label,
      cell: (e) => <StatusPill {...STATUS[e.status]} />,
    },
  ];

  return (
    <>
      <PageHeader title={product.key === "hr" ? "Employees" : "HR"} />
      <HrTabs />
      {data.status !== "ready" ? (
        <QueryFallback query={data} className="h-96" label="Loading employees" />
      ) : (
        <DataTable
          id="hr-employees"
          rows={data.data}
          columns={columns}
          getRowId={(e) => e.id}
          searchPlaceholder="Search employees"
          csvName="employees"
          initialSort={{ id: "name", desc: false }}
          empty={{ message: "No employees yet." }}
        />
      )}
    </>
  );
}
