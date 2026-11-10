import { daysBetween } from "../../dates";
import { workweekStartOf } from "../../hr/timesheets";
import type { Timesheet } from "../../types";
import { fold } from "../fields";
import { text } from "../lookup";
import type { KindHandler, ParsedRow, PlanContext, RowOutcome } from "../plan";

const problem = (field: string, message: string): RowOutcome => ({ problems: [{ field, message }] });

function findEmployee(row: ParsedRow, ctx: PlanContext) {
  const email = text(row, "employee_email");
  const ext = text(row, "employee_external_id");
  const { employees } = ctx.world;
  return (
    (email ? employees.find((e) => fold(e.email) === fold(email)) : undefined) ??
    (ext ? employees.find((e) => e.externalId && fold(e.externalId) === fold(ext)) : undefined)
  );
}

/**
 * One employee's hours on one day (ADR 0024). Refused: an unknown or inactive person, a 1099
 * worker, a locked week, or someone else's row in a portal upload. A blank leaves the day alone
 * and a zero overwrites it. Paid leave never comes from this file.
 */
function resolveTimesheet(row: ParsedRow, ctx: PlanContext): RowOutcome {
  if (!text(row, "employee_email") && !text(row, "employee_external_id")) {
    return problem("employee_email", "Give the employee's email or external ID.");
  }
  const employee = findEmployee(row, ctx);
  if (!employee) return problem("employee_email", "No employee matches this row.");
  if (ctx.onlyEmployeeId && employee.id !== ctx.onlyEmployeeId) {
    return problem("employee_email", "You can only upload your own hours.");
  }
  if (employee.status === "terminated") return problem("employee_email", `${employee.name} is no longer active.`);
  if (employee.workerType === "1099") return problem("employee_email", "Contractors do not use timesheets.");
  const date = row.work_date as string;
  const label = `${employee.name}, ${date}`;
  if (row.hours_worked === null) return { action: "skip", label, writes: [], note: "Blank hours leave the day alone." };
  const hours = Number(row.hours_worked);
  if (hours < 0 || hours > 24) return problem("hours_worked", "Hours must be between 0 and 24.");
  const weekStart = workweekStartOf(date, ctx.workweekStartDay);
  const sheet = ctx.world.timesheets.find((s) => s.employeeId === employee.id && s.weekStart === weekStart);
  if (sheet?.status === "approved") return problem("work_date", "This week is already approved.");
  const at = daysBetween(weekStart, date);
  if (sheet && sheet.days[at] === hours) return { action: "skip", label, writes: [], note: "Already these hours." };
  const base: Timesheet = sheet ?? {
    id: ctx.newId("ts"),
    employeeId: employee.id,
    weekStart,
    days: [0, 0, 0, 0, 0, 0, 0],
    status: "draft",
    submittedAt: null,
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    source: "upload",
    history: [],
  };
  const record: Timesheet = { ...base, days: base.days.map((h, i) => (i === at ? hours : h)), source: "upload" };
  return { action: sheet ? "update" : "create", label, writes: [{ collection: "timesheets", record }] };
}

/** The timesheets kind (spec C1, C2): one row per employee per day. */
export const TIMESHEETS: KindHandler = {
  labelField: "work_date",
  duplicateKey: (row) => `${text(row, "employee_email") || text(row, "employee_external_id")}|${String(row.work_date)}`,
  resolve: resolveTimesheet,
  def: {
    kind: "timesheets",
    label: "Timesheets",
    description: "Hours worked, one row per employee per day.",
    module: "hr",
    matchOn: "email, then External ID, and the work date",
    fields: [
      {
        key: "employee_email",
        label: "Employee email",
        type: "text",
        aliases: ["email", "employee", "work email"],
        examples: ["jordan.reyes@work.example", "jordan.reyes@work.example"],
      },
      {
        key: "employee_external_id",
        label: "External ID",
        type: "text",
        aliases: ["external id", "employee id"],
        examples: ["", ""],
      },
      {
        key: "employee_name",
        label: "Employee name",
        type: "text",
        aliases: ["name"],
        examples: ["Jordan Reyes", "Jordan Reyes"],
      },
      {
        key: "work_date",
        label: "Work date",
        type: "date",
        required: true,
        aliases: ["date", "day"],
        examples: ["2026-11-02", "11/3/2026"],
      },
      {
        key: "hours_worked",
        label: "Hours worked",
        type: "number",
        aliases: ["hours", "hours worked"],
        examples: ["8", "9.5"],
      },
      { key: "note", label: "Note", type: "text", aliases: ["comment"], examples: ["", "Late delivery"] },
    ],
  },
};
