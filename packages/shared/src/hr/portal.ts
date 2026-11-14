import { dec, moneyString, sum } from "../money";
import type { Employee, HrSettings, PayPeriodLine, PtoRequest } from "../types";
import type { CommissionStatementRow } from "./commission-statements";
import { needsTimesheet } from "./timesheets";

/** What the employee portal shows a person (employee-portal.md rule 1); a hidden item is not offered at all. */
export interface PortalVisibility {
  pay: boolean;
  commission: boolean;
  rates: boolean;
  teamCalendar: boolean;
  clock: boolean;
}

/** The company switches the portal reads (Settings → HR, CLAUDE.md rule 12). */
export type PortalSwitches = Pick<
  HrSettings,
  | "showPayToEmployees"
  | "showCommissionToEmployees"
  | "showRatesToEmployees"
  | "showTeamCalendarToEmployees"
  | "clockEnabled"
>;

/**
 * What a person may see in the portal (employee-portal.md rule 1): the company's switches plus the
 * per-employee commission override. `onPlan` means an assignment with no end. Pay and the team
 * calendar (shown on My time off) are for W-2 people only (rule 11), and the clock for people who
 * fill in timesheets. The API narrows this further by
 * feature switch, product and permission (ADR 0049); this is the rule both clients share.
 */
export function portalVisibility(
  employee: Pick<Employee, "workerType" | "flsaStatus" | "status" | "commissionVisible"> | null,
  hr: PortalSwitches,
  onPlan: boolean,
): PortalVisibility {
  return {
    pay: !!employee && employee.workerType === "w2" && hr.showPayToEmployees,
    commission: onPlan && (employee?.commissionVisible ?? hr.showCommissionToEmployees),
    rates: hr.showRatesToEmployees,
    teamCalendar: hr.showTeamCalendarToEmployees && employee?.workerType === "w2",
    clock: hr.clockEnabled && !!employee && needsTimesheet(employee),
  };
}

/**
 * A pay line as the person sees it (employee-portal.md rule 3; ADR 0024): with commission hidden,
 * the commission line and its overtime true-up leave the total, so the page still adds up, and the
 * workweek breakdown goes too, because each week's allocated earnings and regular rate carry the
 * commission (PR #28 security review).
 */
export function ownPayLine(line: PayPeriodLine, showCommission: boolean): PayPeriodLine {
  if (showCommission) return line;
  const gross = dec(line.grossPay).minus(line.commissionPay).minus(line.overtimeTrueUp);
  return { ...line, commissionPay: "0.00", overtimeTrueUp: "0.00", grossPay: moneyString(gross), weeks: [] };
}

/** Gross pay of the rows paid in a calendar year (employee-portal.md rule 5), as a money string. */
export function earnedInYear(
  rows: readonly { period: { payDate: string }; line: { grossPay: string } }[],
  year: string,
): string {
  return moneyString(sum(rows.filter((row) => row.period.payDate.startsWith(year)).map((row) => row.line.grossPay)));
}

/**
 * The person's own statements as My commission lists them (employee-portal.md rule 7): their own,
 * with lines or past draft, newest first.
 */
export function ownStatements(rows: readonly CommissionStatementRow[], userId: string): CommissionStatementRow[] {
  return rows.filter((row) => row.userId === userId && (row.lines.length > 0 || row.status !== "draft")).reverse();
}

/**
 * A colleague's approved time off as the team calendar shows it (employee-portal.md rule 10): that
 * someone is out and when, never why. The kind reads `vacation`; the note, reason, policy, hours
 * and decider are left out (ADR 0049).
 */
export function teamOutView(request: PtoRequest): PtoRequest {
  return {
    id: request.id,
    employeeId: request.employeeId,
    policyId: "",
    start: request.start,
    end: request.end,
    hours: "",
    kind: "vacation",
    status: request.status,
    note: "",
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
  };
}
