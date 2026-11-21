"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Check,
  CircleCheck,
  CircleDashed,
  CornerUpLeft,
  Download,
  RotateCcw,
  Send,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  addDays,
  californiaPayNote,
  californiaPayOn,
  companyOvertimeRule,
  dec,
  OVERTIME_RULE_LABELS,
  plural,
  sum,
  timesheetFlags,
  timesheetTemplate,
  needsTimesheet,
  WEEKDAY_LABELS,
  weekdayHeadings,
  type PtoRequest,
  type Timesheet,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { cn } from "@workspace/ui/lib/utils";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { ScrollRegion } from "@/components/scroll-region";
import { QueryFallback } from "@/components/query-fallback";
import { NoAccess } from "@/components/no-access";
import { ReasonDialog } from "@/components/reason-dialog";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { writeTableFile } from "@/features/import/import-files";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { saveBlob } from "@/lib/save-blob";
import { useFormatDate } from "@/lib/use-format-date";
import { CaliforniaPayNote } from "./california-pay-note";
import { HrTabs } from "./hr-tabs";
import { weekRows, weeksOf, type WeekRow } from "./hr-week";
import { TimesheetUploadDialog } from "./timesheet-upload-dialog";

/** How each timesheet status reads. */
export const SHEET_STATUS = {
  draft: { tone: "neutral", icon: CircleDashed, label: "Draft" },
  submitted: { tone: "brand", icon: Send, label: "Submitted" },
  approved: { tone: "success", icon: CircleCheck, label: "Approved" },
  rejected: { tone: "danger", icon: CornerUpLeft, label: "Sent back" },
} as const;

/** Hours over 8 in a day count as daily overtime under the California rule. */
const DAILY_LIMIT = 8;

function Row({
  row,
  canDecide,
  onApprove,
  onReject,
  onReopen,
}: {
  row: WeekRow;
  canDecide: boolean;
  onApprove: (sheet: Timesheet) => void;
  onReject: (sheet: Timesheet) => void;
  onReopen: (sheet: Timesheet) => void;
}) {
  const flagged = dec(row.extraHours).gt(0);
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
            <Num kind="quantity" value={row.extraHours} delta={-1} />
          </span>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </td>
      <td className="px-3 py-2">
        {row.sheet.status === "submitted" && canDecide ? (
          <span className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => onApprove(row.sheet)}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onReject(row.sheet)}>
              Send back
            </Button>
          </span>
        ) : row.sheet.status === "approved" && canDecide ? (
          <span className="flex items-center gap-1.5">
            <StatusPill {...SHEET_STATUS.approved} />
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Reopen ${row.employee.name}'s timesheet`}
              onClick={() => onReopen(row.sheet)}
            >
              <RotateCcw />
            </Button>
          </span>
        ) : (
          <StatusPill {...SHEET_STATUS[row.sheet.status]} />
        )}
      </td>
    </tr>
  );
}

/** One submitted sheet in the approval queue. */
interface QueueRow {
  sheet: Timesheet;
  name: string;
  /** Hours as a decimal string (CLAUDE.md rule 6). */
  total: string;
  overtime: string;
  flags: string[];
}

/** Confirms a bulk approval with the totals first; flagged sheets stay out of it (ADR 0024). */
function BulkApproveDialog({ rows, onClose }: { rows: QueueRow[]; onClose: () => void }) {
  const clean = rows.filter((r) => r.flags.length === 0);
  // Hours are added with decimal.js, never floats (fifth security review of PR #25).
  const hours = sum(clean.map((r) => r.total)).toString();
  const overtime = sum(clean.map((r) => r.overtime));
  const flagged = rows.length - clean.length;
  // Every count in this dialog reads singular for one (click-through #46).
  const sheets = (n: number) => `${n} ${plural(n, "timesheet", "timesheets")}`;
  async function confirm() {
    await api.decideTimesheets(
      clean.map((r) => r.sheet.id),
      { action: "approve" },
    );
    toast.success(`${sheets(clean.length)} approved`);
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve {sheets(clean.length)}</DialogTitle>
          <DialogDescription>
            <Num kind="quantity" value={hours} /> {dec(hours).eq(1) ? "hour" : "hours"} in total,{" "}
            <Num kind="quantity" value={overtime} /> of them overtime.
            {flagged > 0
              ? ` ${flagged} flagged ${plural(flagged, "sheet is", "sheets are")} left for you to review one by one.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={clean.length === 0} onClick={() => void confirm()}>
            <Check />
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalQueue({
  rows,
  onApprove,
  onReject,
}: {
  rows: QueueRow[];
  onApprove: (s: Timesheet) => void;
  onReject: (s: Timesheet) => void;
}) {
  const formatDate = useFormatDate();
  const [bulk, setBulk] = useState<QueueRow[] | null>(null);
  const columns: ColumnSpec<QueueRow>[] = [
    {
      id: "name",
      header: "Employee",
      value: (r) => r.name,
      cell: (r) => <span className="font-medium">{r.name}</span>,
    },
    { id: "week", header: "Week of", value: (r) => r.sheet.weekStart, cell: (r) => formatDate(r.sheet.weekStart) },
    { id: "hours", header: "Hours", kind: "quantity", value: (r) => r.total },
    { id: "overtime", header: "Overtime", kind: "quantity", value: (r) => r.overtime },
    {
      id: "flags",
      header: "Check",
      value: (r) => r.flags.join(", "),
      cell: (r) =>
        r.flags.length ? (
          <span className="text-warning-ink">{r.flags.join(", ")}</span>
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
    {
      id: "actions",
      header: "Decide",
      value: () => "",
      visualOnly: true,
      cell: (r) => (
        <span className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => onApprove(r.sheet)}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onReject(r.sheet)}>
            Send back
          </Button>
        </span>
      ),
    },
  ];
  return (
    <>
      <DataTable
        id="hr-timesheet-queue"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.sheet.id}
        searchPlaceholder="Search timesheets"
        csvName="timesheets-to-approve"
        initialSort={{ id: "week", desc: true }}
        bulkActions={(selected) => (
          <Button size="sm" onClick={() => setBulk(selected)}>
            <Check />
            Approve selected
          </Button>
        )}
        empty={{ message: "No timesheets are waiting for approval." }}
      />
      {bulk ? <BulkApproveDialog rows={bulk} onClose={() => setBulk(null)} /> : null}
    </>
  );
}

/**
 * Timesheets (spec C1, ADR 0024): the weekly grid with overtime under each worker's rule, the
 * approval queue, and bulk entry through the CSV or Excel template.
 */
export function TimesheetsPage() {
  const can = useCan();
  const { settings, product, user } = useWorkspace();
  const formatDate = useFormatDate();
  const router = useRouter();
  const params = useSearchParams();
  const [chosen, setChosen] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Timesheet | null>(null);
  const [reopening, setReopening] = useState<Timesheet | null>(null);
  const [uploading, setUploading] = useState(false);
  const data = useApiQuery(async (client) => {
    const { timesheets, employees, ptoRequests } = await client.hrData();
    return { timesheets, employees, ptoRequests };
  }, []);
  if (!can("hr.timesheet.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading timesheets" />;

  const { timesheets, employees, ptoRequests } = data.data;
  const { workweekStartDay } = settings.hr;
  const rule = settings.localization.payroll.overtimeRule;
  const weeks = weeksOf(timesheets);
  const week = chosen ?? weeks[0] ?? "";
  const rows = weekRows(timesheets, employees, week, rule);
  const canDecide = can("hr.timesheet.approve");
  const view = params.get("view") === "queue" && canDecide ? "queue" : "week";
  const nameOf = (s: Timesheet) => employees.find((e) => e.id === s.employeeId)?.name ?? "employee";

  async function approve(sheet: Timesheet) {
    try {
      await api.decideTimesheets([sheet.id], { action: "approve" });
      toast.success(`Timesheet approved for ${nameOf(sheet)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve this timesheet.");
    }
  }

  async function downloadTemplate(format: "csv" | "xlsx") {
    const staff = employees.filter(needsTimesheet);
    const blob = await writeTableFile(timesheetTemplate(staff, week), format, "Timesheets");
    saveBlob(blob, `timesheets-${week}.${format}`);
  }

  const queue: QueueRow[] = timesheets
    .filter((s) => s.status === "submitted" && s.employeeId !== user.employeeId)
    .map((sheet) => {
      const row = weekRows([sheet], employees, sheet.weekStart, rule)[0];
      return {
        sheet,
        name: nameOf(sheet),
        total: row?.total ?? "0",
        overtime: row?.extraHours ?? "0",
        flags: timesheetFlags(sheet, ptoRequests as PtoRequest[]),
      };
    });
  const headings = weekdayHeadings(workweekStartDay);

  return (
    <>
      <PageHeader
        title={product.key === "hr" ? "Timesheets" : "HR"}
        actions={
          canDecide ? (
            <>
              <Button variant="outline" onClick={() => void downloadTemplate("csv")}>
                <Download />
                Template CSV
              </Button>
              <Button variant="outline" onClick={() => void downloadTemplate("xlsx")}>
                <Download />
                Template Excel
              </Button>
              <Button onClick={() => setUploading(true)}>
                <Upload />
                Upload hours
              </Button>
            </>
          ) : null
        }
      />
      <HrTabs />
      <Tabs
        value={view}
        className="gap-6"
        onValueChange={(v) => router.replace(v === "queue" ? "/hr/timesheets?view=queue" : "/hr/timesheets")}
      >
        {canDecide ? (
          <TabsList aria-label="Timesheet view">
            <TabsTrigger value="week">Weekly grid</TabsTrigger>
            <TabsTrigger value="queue">To approve {queue.length > 0 ? `(${queue.length})` : ""}</TabsTrigger>
          </TabsList>
        ) : null}
        <TabsContent value="week">
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
              Company rule: {OVERTIME_RULE_LABELS[companyOvertimeRule(rule)]}. The workweek starts on{" "}
              {WEEKDAY_LABELS[workweekStartDay]}.
              {californiaPayOn()
                ? " Workers in California follow the California rule; days over 8 hours are highlighted."
                : null}
            </p>
            <CaliforniaPayNote note={californiaPayNote(employees, rule)} className="mx-4" />
            {rows.length === 0 ? (
              <p className="text-muted-foreground px-4 pb-4">No timesheets for this week.</p>
            ) : (
              <ScrollRegion label="Timesheets this week">
                <table className="w-full min-w-[44rem] text-sm">
                  <thead className="bg-raised text-muted-foreground text-xs">
                    <tr>
                      <th scope="col" className="h-9 px-3 text-left font-medium">
                        Employee
                      </th>
                      {headings.map((d) => (
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
                      <Row
                        key={row.sheet.id}
                        row={row}
                        canDecide={canDecide && row.sheet.employeeId !== user.employeeId}
                        onApprove={(s) => void approve(s)}
                        onReject={setRejecting}
                        onReopen={setReopening}
                      />
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            )}
          </Panel>
        </TabsContent>
        <TabsContent value="queue">
          <ApprovalQueue rows={queue} onApprove={(s) => void approve(s)} onReject={setRejecting} />
        </TabsContent>
      </Tabs>
      {rejecting ? (
        <ReasonDialog
          title={`Send back ${nameOf(rejecting)}'s timesheet`}
          description="Say what needs correcting. The hours stay as they are, and the employee is told."
          confirmLabel="Send back"
          onConfirm={(reason) => api.decideTimesheets([rejecting.id], { action: "reject", reason })}
          onClose={() => setRejecting(null)}
        />
      ) : null}
      {reopening ? (
        <ReasonDialog
          title={`Reopen ${nameOf(reopening)}'s timesheet`}
          description="It goes back to draft and is no longer counted for pay."
          confirmLabel="Reopen"
          onConfirm={(reason) => api.reopenTimesheet(reopening.id, reason)}
          onClose={() => setReopening(null)}
        />
      ) : null}
      {uploading ? <TimesheetUploadDialog own={false} onClose={() => setUploading(false)} /> : null}
    </>
  );
}
