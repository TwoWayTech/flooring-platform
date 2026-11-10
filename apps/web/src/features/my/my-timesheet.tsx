"use client";

import { useState } from "react";
import { Download, Save, Send, Upload } from "lucide-react";
import { toast } from "sonner";
import { addDays, timesheetTemplate, weekdayHeadings, type Employee, type Timesheet } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { TimesheetUploadDialog } from "@/features/hr/timesheet-upload-dialog";
import { Pick } from "@/features/hr/pick";
import { SHEET_STATUS } from "@/features/hr/timesheets-page";
import { writeTableFile } from "@/features/import/import-files";
import { api } from "@/lib/api";
import type { MyPortal } from "@/lib/api/contract";
import { saveBlob } from "@/lib/save-blob";
import { useFormatDate } from "@/lib/use-format-date";
import { MyShell } from "./my-shell";

function WeekForm({
  employee,
  weekStart,
  sheet,
  headings,
}: {
  employee: Employee;
  weekStart: string;
  sheet: Timesheet | undefined;
  headings: string[];
}) {
  const [days, setDays] = useState((sheet?.days ?? [0, 0, 0, 0, 0, 0, 0]).map(String));
  const locked = sheet?.status === "approved" || sheet?.status === "submitted";
  const numbers = days.map((d) => Number(d) || 0);

  async function save() {
    return api.saveTimesheet({ employeeId: employee.id, weekStart, days: numbers });
  }

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {sheet?.status === "rejected" ? (
        <p className="bg-danger/10 text-danger-ink rounded-md p-3 text-sm">Sent back: {sheet.rejectionReason}</p>
      ) : null}
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
        {headings.map((d, i) => (
          <div key={d} className="flex flex-col gap-1">
            <label htmlFor={`day-${i}`} className="text-muted-foreground text-xs">
              {d}
            </label>
            <Input
              id={`day-${i}`}
              inputMode="decimal"
              className="text-center tabular-nums"
              disabled={locked}
              value={days[i]}
              onChange={(e) => setDays(days.map((v, at) => (at === i ? e.target.value.replace(/[^\d.]/g, "") : v)))}
            />
          </div>
        ))}
      </div>
      <p className="text-sm">
        Total: <Num kind="quantity" value={numbers.reduce((a, b) => a + b, 0)} unit="hours" />
      </p>
      {!locked ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void run(save, "Saved")}>
            <Save />
            Save
          </Button>
          <Button
            onClick={() =>
              void run(async () => {
                const saved = await save();
                await api.submitTimesheet(saved.id);
              }, "Timesheet submitted")
            }
          >
            <Send />
            Submit
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Timesheets({ portal }: { portal: MyPortal }) {
  const formatDate = useFormatDate();
  const [week, setWeek] = useState(portal.weekStart);
  const [uploading, setUploading] = useState(false);
  const employee = portal.employee!;
  const earlier = Array.from({ length: 8 }, (_, i) => addDays(portal.weekStart, -7 * i));
  const sheet = portal.timesheets.find((s) => s.weekStart === week);

  async function template(format: "csv" | "xlsx") {
    saveBlob(
      await writeTableFile(timesheetTemplate([employee], week), format, "My timesheet"),
      `my-timesheet-${week}.${format}`,
    );
  }

  return (
    <Panel
      title={`Week of ${formatDate(week)}`}
      actions={sheet ? <StatusPill {...SHEET_STATUS[sheet.status]} /> : null}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-60">
            <Pick
              label="Week"
              value={week}
              onChange={setWeek}
              options={earlier.map((w) => [w, `${formatDate(w)} to ${formatDate(addDays(w, 6))}`] as const)}
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => void template("csv")}>
            <Download />
            Template CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void template("xlsx")}>
            <Download />
            Template Excel
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setUploading(true)}>
            <Upload />
            Upload
          </Button>
        </div>
        <WeekForm
          key={week + (sheet?.status ?? "")}
          employee={employee}
          weekStart={week}
          sheet={sheet}
          headings={weekdayHeadings(portal.weekStartDay)}
        />
      </div>
      {uploading ? <TimesheetUploadDialog own onClose={() => setUploading(false)} /> : null}
    </Panel>
  );
}

/** My timesheet (spec C2): fill in the week or use the template, then submit. */
export function MyTimesheetPage() {
  return (
    <MyShell title="My timesheet">
      {(p) =>
        p.usesTimesheet ? (
          <Timesheets portal={p} />
        ) : (
          <p className="text-muted-foreground">You do not fill in timesheets.</p>
        )
      }
    </MyShell>
  );
}
