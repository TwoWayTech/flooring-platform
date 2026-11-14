import type { Employee } from "../types";
import { californiaPayOn, type OvertimeRule } from "../us-pack/overtime";

/**
 * California pay rules behind `hr.payroll.california` (owner, 2026-11-14; ADR 0050). The rules of
 * ADR 0024 are not yet reviewed by a qualified payroll person, so the switch is off for real
 * companies and every screen or output that uses them says so. The California refusals (exempt
 * salary floor, monthly pay, vacation carryover) are not here: they stay on whatever the switch says.
 */

/** Shown wherever California overtime or pay is worked out while the switch is on. */
export const CALIFORNIA_PENDING_NOTE = "California pay rules are pending payroll review — don't use them for real pay.";

/** Shown where people work in California, or California is the company rule, while the switch is off. */
export const CALIFORNIA_OFF_NOTE =
  "California pay rules are off: people who work in California are paid on the federal weekly rule here. Check their pay with your payroll provider.";

/** True for a W-2 worker in California who has not left; overtime law does not reach 1099 contractors. */
const worksInCalifornia = (e: Pick<Employee, "state" | "status"> & Partial<Pick<Employee, "workerType">>) =>
  e.state === "CA" && e.status !== "terminated" && e.workerType !== "1099";

/**
 * The California note a pay or hours screen shows, or null when California plays no part: pending
 * review when the rules are used (switch on, with California staff or California as the company
 * rule), off when they would have been (switch off, same condition).
 */
export function californiaPayNote(
  employees: readonly (Pick<Employee, "state" | "status"> & Partial<Pick<Employee, "workerType">>)[],
  companyRule: OvertimeRule,
  californiaOn: boolean = californiaPayOn(),
): string | null {
  if (companyRule !== "california" && !employees.some(worksInCalifornia)) return null;
  return californiaOn ? CALIFORNIA_PENDING_NOTE : CALIFORNIA_OFF_NOTE;
}

/**
 * The hours a California salary covers: 40 (Labor Code 515) with the California switch on, or null
 * to keep the hours the form or the stored record gives (ADR 0050).
 */
export function californiaSalaryHours(state: string, californiaOn: boolean = californiaPayOn()): number | null {
  return californiaOn && state === "CA" ? 40 : null;
}
