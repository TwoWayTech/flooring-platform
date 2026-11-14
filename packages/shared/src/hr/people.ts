import { addDays, daysBetween } from "../dates";
import { dec } from "../money";
import type { ChecklistItem, Employee } from "../types";
import type { DataScope } from "../permissions/roles";

/** Exempt salary floors, per year, with the day each applies from (ADR 0024). */
const EXEMPT_FLOORS: readonly { state: "US" | "CA"; from: string; annual: string }[] = [
  { state: "US", from: "2019-01-01", annual: "35568" },
  { state: "CA", from: "2026-01-01", annual: "70304" },
  { state: "CA", from: "2027-01-01", annual: "72384" },
];

/**
 * A warning when an exempt salary is under the applicable floor (ADR 0024). Outside sales has no
 * floor. It warns and does not block, because exemption is a legal call for the company to make.
 */
export function exemptSalaryWarning(employee: Employee, today: string): string | null {
  if (employee.flsaStatus !== "exempt" || employee.exemptionBasis === "outside_sales") return null;
  const area = employee.state === "CA" ? "CA" : "US";
  const floor = EXEMPT_FLOORS.filter((f) => f.state === area && f.from <= today).at(-1);
  if (!floor || employee.payType !== "salary" || dec(employee.payRate).gte(floor.annual)) return null;
  return `This salary is below the exempt floor of $${floor.annual} a year. Confirm the exemption with counsel.`;
}

/** A birthday or work anniversary coming up (spec C1 Home). */
export interface PersonDate {
  employeeId: string;
  name: string;
  kind: "birthday" | "anniversary";
  /** This year's occurrence. */
  date: string;
  /** Completed years at a work anniversary; null for a birthday. */
  years: number | null;
}

/** This year's or next year's occurrence of a month and day, on or after today. */
function nextOccurrence(iso: string, today: string): string {
  const thisYear = `${today.slice(0, 4)}${iso.slice(4)}`;
  return thisYear >= today ? thisYear : `${Number(today.slice(0, 4)) + 1}${iso.slice(4)}`;
}

/** Birthdays and work anniversaries in the next `days` days, soonest first. */
export function upcomingPersonDates(employees: readonly Employee[], today: string, days: number): PersonDate[] {
  const end = addDays(today, days);
  return employees
    .filter((e) => e.status !== "terminated")
    .flatMap((e): PersonDate[] => {
      const out: PersonDate[] = [];
      if (e.birthDate) {
        const date = nextOccurrence(e.birthDate, today);
        if (date <= end) out.push({ employeeId: e.id, name: e.name, kind: "birthday", date, years: null });
      }
      const date = nextOccurrence(e.hiredAt, today);
      const years = Number(date.slice(0, 4)) - Number(e.hiredAt.slice(0, 4));
      if (date <= end && years > 0) out.push({ employeeId: e.id, name: e.name, kind: "anniversary", date, years });
      return out;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** The onboarding steps every new person starts with (spec C1 People). */
export const ONBOARDING_STEPS = [
  "Offer letter signed",
  "Form I-9 completed",
  "Form W-4 completed",
  "Handbook acknowledged",
  "Equipment issued",
  "First-week check-in",
] as const;

/** The offboarding steps when someone leaves; vacation payout follows ADR 0024. */
export const OFFBOARDING_STEPS = [
  "Final timesheet approved",
  "Final commission statement run",
  "Accrued vacation added to final pay",
  "Equipment returned",
  "Access removed",
] as const;

/** A fresh checklist, nothing done, ids stable within the list. */
export function newChecklist(labels: readonly string[], prefix: string): ChecklistItem[] {
  return labels.map((label, i) => ({ id: `${prefix}-${i + 1}`, label, doneAt: null }));
}

/** How long someone has been at the company, in whole years and months, for the profile. */
export function tenure(hiredAt: string, today: string): string {
  const months = Math.max(Math.floor(daysBetween(hiredAt, today) / 30.44), 0);
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} month${m === 1 ? "" : "s"}`;
  return `${y} year${y === 1 ? "" : "s"}${m ? `, ${m} month${m === 1 ? "" : "s"}` : ""}`;
}

/**
 * Whether a viewer sees one person's timesheets, time off and balances (hr.md "Data scope",
 * `ownOrReports`): scope `all` sees everyone; `own` sees the viewer's own employee record; `branch`
 * adds the viewer's direct reports (`Employee.managerId`). A viewer not linked to an employee sees
 * nothing below `all`, so a missing link never widens access.
 */
export function seesPersonRecords(
  scope: DataScope,
  viewerEmployeeId: string | null,
  person: Pick<Employee, "id" | "managerId">,
): boolean {
  if (scope === "all") return true;
  if (!viewerEmployeeId) return false;
  if (person.id === viewerEmployeeId) return true;
  return scope === "branch" && person.managerId === viewerEmployeeId;
}
