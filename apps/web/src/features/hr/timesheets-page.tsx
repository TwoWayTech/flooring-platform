"use client";

import { useState } from "react";
import { CircleCheck, CircleDashed, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { addDays, OVERTIME_RULE_LABELS, type Timesheet } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { cn } from "@workspace/ui/lib/utils";
import { QueryFallback } from "@/components/query-fallback";
import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { HrTabs } from "./hr-tabs";
import { weekRows, weeksOf, type WeekRow } from "./hr-week";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS = {
  draft: { tone: "neutral", icon: CircleDashed, label: "Draft" },
  submitted: { tone: "brand", icon: Send, label: "Submitted" },
  approved: { tone: "success", icon: CircleCheck, label: "Approved" },
} as const;

/** Hours over 8 in a day count as daily overtime under the California rule. */
const DAILY_LIMIT = 8;

function Row({
  row,
  canApprove,
  onApprove,
}: {
  row: WeekRow;
  canApprove: boolean;
  onApprove: (sheet: Timesheet) => void;
}) {
  const flagged = row.split.overtime + row.split.doubleTime > 0;
  return (
    <tr className="border-hairline border-t">
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <span className="block font-medium">{row.employee.name}</span>
        <span className="text-muted-foreground text-xs">
          {row.rule === "california" ? "California rule" : "Federal rule"}
        </span>
      </th>
      {row.sheet.days.map((h, i) => (
        <td
          key={i}
          data-overtime={row.rule === "california" && h > DAILY_LIMIT ? true : undefined}
          title={
            row.rule === "california" && h > DAILY_LIMIT ? "Over 8 hours: daily overtime in California" : undefined
          }
          className={cn(
            "px-2 py-2 text-center tabular-nums",
            row.rule === "california" && h > DAILY_LIMIT && "bg-warning/14 text-warning-ink font-medium",
            h === 0 && "text-muted-foreground",
          )}
        >
          {h === 0 ? "" : <Num kind="quantity" value={h} delta={-1} />}
        </td>
      ))}
      <td className="px-3 py-2 text-right font-medium">
        <Num kind="quantity" value={row.total} delta={-1} />
      </td>
      <td className="px-3 py-2 text-right">
        {flagged ? (
          <span className="text-warning-ink inline-flex items-center gap-1 font-medium">
            <TriangleAlert aria-hidden="true" className="size-3.5" />
            <Num kind="quantity" value={row.split.overtime + row.split.doubleTime} delta={-1} />
          </span>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </td>
      <td className="px-3 py-2">
        {row.sheet.status === "submitted" && canApprove ? (
          <Button size="sm" variant="outline" onClick={() => onApprove(row.sheet)}>
            Approve
          </Button>
        ) : (
          <StatusPill {...STATUS[row.sheet.status]} />
        )}
      </td>
    </tr>
  );
}

/**
 * The weekly timesheet grid (spec "HR host"): hours per day, overtime flagged under each
 * worker's rule (federal 40-hour week, California daily overtime), and approval.
 */
export function TimesheetsPage() {
  const can = useCan();
  const { settings, product } = useWorkspace();
  const formatDate = useFormatDate();
  const [chosen, setChosen] = useState<string | null>(null);
  const data = useApiQuery(async (client) => {
    const [timesheets, employees] = await Promise.all([client.list("timesheets"), client.list("employees")]);
    return { timesheets, employees };
  }, []);
  if (!can("hr.timesheet.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading timesheets" />;

  const { timesheets, employees } = data.data;
  const weeks = weeksOf(timesheets);
  const week = chosen ?? weeks[0] ?? "";
  const rows = weekRows(timesheets, employees, week, settings.localization.payroll.overtimeRule);
  const canApprove = can("hr.timesheet.approve");

  async function approve(sheet: Timesheet) {
    const name = employees.find((e) => e.id === sheet.employeeId)?.name ?? "employee";
    await api.save(
      "timesheets",
      { ...sheet, status: "approved" },
      {
        category: "data",
        action: "Approved timesheet",
        target: `${name}, week of ${sheet.weekStart}`,
        before: "submitted",
        after: "approved",
      },
    );
    toast.success(`Timesheet approved for ${name}`);
  }

  return (
    <>
      <PageHeader title={product.key === "hr" ? "Timesheets" : "HR"} />
      <HrTabs />
      <Panel
        title={`Week of ${week ? formatDate(week) : ""}`}
        actions={
          <Select value={week} onValueChange={setChosen}>
            <SelectTrigger className="h-8 w-60" aria-label="Week">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {weeks.map((w) => (
                <SelectItem key={w} value={w}>
                  {formatDate(w)} to {formatDate(addDays(w, 6))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        bodyClassName="flex flex-col gap-3 p-0"
      >
        <p className="text-muted-foreground px-4 pt-4 text-xs">
          Company rule: {OVERTIME_RULE_LABELS[settings.localization.payroll.overtimeRule]}. Workers in California follow
          the California rule; days over 8 hours are highlighted.
        </p>
        {rows.length === 0 ? (
          <p className="text-muted-foreground px-4 pb-4">No timesheets for this week.</p>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="bg-raised text-muted-foreground text-xs">
                <tr>
                  <th scope="col" className="h-9 px-3 text-left font-medium">
                    Employee
                  </th>
                  {DAYS.map((d) => (
                    <th key={d} scope="col" className="px-2 text-center font-medium">
                      {d}
                    </th>
                  ))}
                  <th scope="col" className="px-3 text-right font-medium">
                    Total
                  </th>
                  <th scope="col" className="px-3 text-right font-medium">
                    Overtime
                  </th>
                  <th scope="col" className="px-3 text-left font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Row key={row.sheet.id} row={row} canApprove={canApprove} onApprove={(s) => void approve(s)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
