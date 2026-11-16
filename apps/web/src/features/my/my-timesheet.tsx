"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
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
import { NewerHoursNotice } from "./newer-hours-notice";
import {
  hoursSaved,
  keepTypedHours,
  readKey,
  saveInput,
  serverHours,
  takeSavedHours,
  typedHours,
  typeHours,
  weekHours,
  weekLocked,
} from "./week-hours";

/**
 * Moves focus after a save or submit ends, or when the newer-hours notice comes or goes, but only
 * when focus was lost (on the page body) or sits in the form's buttons, never while the person
 * types in a day: to the notice's first button while it shows, else back to the button that
 * started the action, or the first one (CLAUDE.md rule 15).
 */
function useActionFocus(busy: boolean, waiting: boolean) {
  const actionsRef = useRef<HTMLDivElement>(null);
  const noticeRef = useRef<HTMLButtonElement>(null);
  const clickedRef = useRef<HTMLButtonElement | null>(null);
  const lastRef = useRef({ busy, waiting });
  useEffect(() => {
    const before = lastRef.current;
    lastRef.current = { busy, waiting };
    if (before.busy === busy && before.waiting === waiting) return;
    const active = document.activeElement;
    if (active !== document.body && !actionsRef.current?.contains(active)) return;
    const target = waiting
      ? noticeRef.current
      : (clickedRef.current ?? actionsRef.current?.querySelector<HTMLButtonElement>("button") ?? null);
    if (target?.isConnected && !target.disabled) target.focus();
  }, [busy, waiting]);
  return { actionsRef, noticeRef, clickedRef };
}

/**
 * One week's hours. The saved hours arrive with every read (an upload, the clock, another tab, or
 * this form's own save makes the page read again): a form with no edits takes them, and a form
 * with edits keeps them and asks (`week-hours.ts`). Its own save's answer counts as a read. Every
 * save sends the hours the form started from, so the server refuses one made from hours that
 * changed meanwhile (ADR 0051, 2026-11-16).
 */
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
  const locked = weekLocked(sheet);
  const key = readKey(sheet);
  const [hours, setHours] = useState(() => weekHours(sheet?.days));
  const [seen, setSeen] = useState(key);
  const [busy, setBusy] = useState(false);
  // Adjusted while rendering, not in an effect, so no frame shows hours the server no longer holds.
  if (seen !== key) {
    setSeen(key);
    setHours((current) => serverHours(current, sheet?.days, locked));
  }
  const waiting = hours.newer !== null;
  const { actionsRef, noticeRef, clickedRef } = useActionFocus(busy, waiting);
  const numbers = typedHours(hours);

  async function save() {
    const input = saveInput(hours);
    // Unreachable: Save and Submit are disabled while newer hours wait for a choice.
    if (!input) throw new Error("Choose which hours to keep first.");
    const saved = await api.saveTimesheet({ employeeId: employee.id, weekStart, ...input });
    // The answer is remembered as the last read, so a read that differs from it is never skipped.
    setHours((current) => hoursSaved(current, input.days, saved));
    setSeen(readKey(saved));
    return saved;
  }

  async function run(event: MouseEvent<HTMLButtonElement>, action: () => Promise<unknown>, done: string) {
    clickedRef.current = event.currentTarget;
    setBusy(true);
    try {
      await action();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {sheet?.status === "rejected" ? (
        <p className="bg-danger/10 text-danger-ink rounded-md p-3 text-sm">Sent back: {sheet.rejectionReason}</p>
      ) : null}
      {hours.newer ? (
        <NewerHoursNotice
          days={hours.newer}
          headings={headings}
          busy={busy}
          onUse={() => setHours(takeSavedHours)}
          onKeep={() => setHours(keepTypedHours)}
          firstButton={noticeRef}
        />
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
              value={hours.typed[i]}
              onChange={(e) => {
                const text = e.target.value;
                setHours((current) => typeHours(current, i, text));
              }}
            />
          </div>
        ))}
      </div>
      <p className="text-sm">
        Total: <Num kind="quantity" value={numbers.reduce((a, b) => a + b, 0)} unit="hours" />
      </p>
      {!locked ? (
        <div ref={actionsRef} className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || waiting} onClick={(e) => void run(e, save, "Saved")}>
            <Save />
            Save
          </Button>
          <Button
            disabled={busy || waiting}
            onClick={(e) =>
              void run(
                e,
                async () => {
                  const saved = await save();
                  await api.submitTimesheet(saved.id);
                },
                "Timesheet submitted",
              )
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
          key={week}
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
