"use client";

import { useState } from "react";
import { CalendarPlus, Check, CircleCheck, CircleSlash, Clock, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { timeOffBalance, type Employee, type PtoRequest } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { QueryFallback } from "@/components/query-fallback";
import { NoAccess } from "@/components/no-access";
import { ReasonDialog } from "@/components/reason-dialog";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { HrTabs } from "./hr-tabs";
import { RequestTimeOffDialog } from "./request-time-off-dialog";
import { TeamCalendar } from "./team-calendar";

/** How each request status reads. */
export const REQUEST_STATUS = {
  pending: { tone: "warning", icon: Clock, label: "Pending" },
  approved: { tone: "success", icon: CircleCheck, label: "Approved" },
  denied: { tone: "neutral", icon: XCircle, label: "Declined" },
  cancelled: { tone: "neutral", icon: CircleSlash, label: "Cancelled" },
} as const;

/** Time off (spec C1): requests with approve or decline, balances, the team calendar, and your own request. */
export function TimeOffPage() {
  const can = useCan();
  const { user, product } = useWorkspace();
  const formatDate = useFormatDate();
  const [asking, setAsking] = useState(false);
  const [declining, setDeclining] = useState<PtoRequest | null>(null);
  const data = useApiQuery(async (client) => {
    const hr = await client.hrData();
    return {
      ptoRequests: hr.ptoRequests,
      employees: hr.employees,
      policies: hr.timeOffPolicies,
      entries: hr.timeOffEntries,
    };
  }, []);
  if (!can("hr.pto.view")) return <NoAccess />;
  const canDecide = can("hr.pto.approve");
  const nameOf = (id: string) => data.data?.employees.find((e) => e.id === id)?.name ?? "Unknown";
  const policyOf = (id: string) => data.data?.policies.find((p) => p.id === id)?.name ?? "Time off";

  async function approve(request: PtoRequest) {
    try {
      await api.decideTimeOff(request.id, { action: "approve" });
      toast.success(`Time off approved for ${nameOf(request.employeeId)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve this request.");
    }
  }

  const columns: ColumnSpec<PtoRequest>[] = [
    {
      id: "employee",
      header: "Employee",
      value: (p) => nameOf(p.employeeId),
      cell: (p) => <span className="font-medium">{nameOf(p.employeeId)}</span>,
    },
    { id: "kind", header: "Type", value: (p) => policyOf(p.policyId) },
    { id: "start", header: "From", value: (p) => p.start, cell: (p) => formatDate(p.start) },
    { id: "end", header: "To", value: (p) => p.end, cell: (p) => formatDate(p.end) },
    { id: "hours", header: "Hours", kind: "quantity", value: (p) => p.hours },
    { id: "note", header: "Note", value: (p) => p.decisionReason ?? p.note },
    {
      id: "status",
      header: "Status",
      value: (p) => REQUEST_STATUS[p.status].label,
      cell: (p) =>
        p.status === "pending" && canDecide && p.employeeId !== user.employeeId ? (
          <span className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => void approve(p)}>
              <Check />
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeclining(p)}>
              <X />
              Decline
            </Button>
          </span>
        ) : (
          <StatusPill {...REQUEST_STATUS[p.status]} />
        ),
    },
  ];
  const withBalance = (data.data?.employees ?? []).filter((e) => e.workerType === "w2" && e.status !== "terminated");
  const balanceColumns: ColumnSpec<Employee>[] = [
    {
      id: "name",
      header: "Employee",
      value: (e) => e.name,
      cell: (e) => <span className="font-medium">{e.name}</span>,
    },
    ...(data.data?.policies ?? [])
      .filter((p) => p.accrualMethod !== "none")
      .map((p): ColumnSpec<Employee> => ({
        id: p.id,
        header: p.name,
        kind: "quantity",
        unit: "h",
        value: (e) => (data.data ? timeOffBalance(data.data.entries, e.id, p.id).toString() : "0"),
      })),
  ];

  return (
    <>
      <PageHeader
        title={product.key === "hr" ? "Time off" : "HR"}
        actions={
          can("hr.pto.request") && user.employeeId ? (
            <Button onClick={() => setAsking(true)}>
              <CalendarPlus />
              Request time off
            </Button>
          ) : null
        }
      />
      <HrTabs />
      {data.status !== "ready" ? (
        <QueryFallback query={data} className="h-96" label="Loading time off" />
      ) : (
        <Tabs defaultValue="requests" className="gap-6">
          <TabsList aria-label="Time off view">
            <TabsTrigger value="requests">Requests</TabsTrigger>
            <TabsTrigger value="balances">Balances</TabsTrigger>
            <TabsTrigger value="calendar">Team calendar</TabsTrigger>
          </TabsList>
          <TabsContent value="requests">
            <DataTable
              id="hr-time-off"
              rows={data.data.ptoRequests}
              columns={columns}
              getRowId={(p) => p.id}
              searchPlaceholder="Search requests"
              csvName="time-off"
              initialSort={{ id: "start", desc: true }}
              empty={{ message: "No time-off requests yet." }}
            />
          </TabsContent>
          <TabsContent value="balances">
            <DataTable
              id="hr-time-off-balances"
              rows={withBalance}
              columns={balanceColumns}
              getRowId={(e) => e.id}
              searchPlaceholder="Search people"
              csvName="time-off-balances"
              initialSort={{ id: "name", desc: false }}
              empty={{ message: "No balances yet." }}
            />
          </TabsContent>
          <TabsContent value="calendar">
            <TeamCalendar requests={data.data.ptoRequests} employees={data.data.employees} kinds />
          </TabsContent>
        </Tabs>
      )}
      {asking && user.employeeId && data.data ? (
        <RequestTimeOffDialog
          employeeId={user.employeeId}
          policies={data.data.policies}
          onClose={() => setAsking(false)}
        />
      ) : null}
      {declining ? (
        <ReasonDialog
          title={`Decline ${nameOf(declining.employeeId)}'s request`}
          description="Say why, so the employee knows. It goes in the message to them."
          confirmLabel="Decline"
          onConfirm={(reason) => api.decideTimeOff(declining.id, { action: "deny", reason })}
          onClose={() => setDeclining(null)}
        />
      ) : null}
    </>
  );
}
