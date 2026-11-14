"use client";

import { useState } from "react";
import { Briefcase, CircleCheck, CirclePause, CircleX, FileSignature, UserPlus } from "lucide-react";
import { SENSITIVE, stateName, timeOffBalance, type Employee } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
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
import { EmployeeFormDialog } from "./employee-form-dialog";
import { EmployeeSheet } from "./employee-sheet";
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
 * People (spec C1): W-2 and 1099 workers with department, state and vacation balance; a row opens
 * the profile. Pay rate is sensitive and shows only with hr.employee.view_sensitive (CLAUDE.md rule 2).
 */
export function EmployeesPage() {
  const can = useCan();
  const { product } = useWorkspace();
  const formatDate = useFormatDate();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const data = useApiQuery(async (client) => {
    const hr = await client.hrData();
    return {
      employees: hr.employees,
      locations: hr.locations,
      policies: hr.timeOffPolicies,
      entries: hr.timeOffEntries,
    };
  }, []);
  if (!can("hr.employee.view")) return <NoAccess />;

  const vacation = data.data?.policies.find((p) => p.kind === "vacation");
  const balanceOf = (e: Employee) =>
    data.data && vacation && e.workerType === "w2"
      ? timeOffBalance(data.data.entries, e.id, vacation.id).toString()
      : "0";
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
    { id: "pto", header: "Vacation balance", kind: "quantity", unit: "h", value: balanceOf },
    {
      id: "status",
      header: "Status",
      value: (e) => STATUS[e.status].label,
      cell: (e) => <StatusPill {...STATUS[e.status]} />,
    },
  ];
  const open = data.data?.employees.find((e) => e.id === openId);

  return (
    <>
      <PageHeader
        title={product.key === "hr" ? "People" : "HR"}
        actions={
          can("hr.employee.create") ? (
            <Button onClick={() => setAdding(true)}>
              <UserPlus />
              Add person
            </Button>
          ) : null
        }
      />
      <HrTabs />
      {data.status !== "ready" ? (
        <QueryFallback query={data} className="h-96" label="Loading people" />
      ) : (
        <DataTable
          id="hr-employees"
          rows={data.data.employees}
          columns={columns}
          getRowId={(e) => e.id}
          onRowClick={(e) => setOpenId(e.id)}
          rowLabel={(e) => `Open ${e.name}`}
          searchPlaceholder="Search people"
          csvName="people"
          initialSort={{ id: "name", desc: false }}
          empty={{ message: "No people yet." }}
        />
      )}
      {open && data.data ? (
        <EmployeeSheet
          employee={open}
          employees={data.data.employees}
          locations={data.data.locations}
          policies={data.data.policies}
          entries={data.data.entries}
          onClose={() => setOpenId(null)}
        />
      ) : null}
      {adding && data.data ? (
        <EmployeeFormDialog
          employee={null}
          employees={data.data.employees}
          locations={data.data.locations}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </>
  );
}
