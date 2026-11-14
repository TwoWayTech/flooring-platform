import { addDays, last12Months, monthEnd } from "../dates";
import { dec } from "../money";
import type { CommissionAdjustment, CommissionAssignment, CommissionPlan, CommissionStatement } from "../types";
import {
  planOn,
  statementChain,
  type CommissionInputs,
  type CommissionLine,
  type StatementFigures,
} from "./commission-plans";

/**
 * A statement line as a screen receives it. `base` is null when it would show margin dollars to
 * someone without `sales.margin.view_sensitive` (CLAUDE.md rule 5; ADR 0048): on a gross margin
 * plan the base is the invoice's margin.
 */
export interface CommissionLineView extends Omit<CommissionLine, "base"> {
  base: string | null;
}

/** A person's month of commission with its status (commissions.md "Statement figures"; ADR 0025). */
export interface CommissionStatementRow extends Omit<StatementFigures, "lines"> {
  lines: CommissionLineView[];
  statementId: string | null;
  name: string;
  status: CommissionStatement["status"];
  approvedBy: string | null;
  approvedAt: string | null;
  payPeriodId: string | null;
  monthEnded: boolean;
  planName: string | null;
}

/** Whether a month (YYYY-MM) has ended on a company day: only then may its statement be approved. */
export const monthEnded = (month: string, today: string): boolean => month < today.slice(0, 7);

/** HR's decisions on reversals outside their window, by reversal line id (commissions.md rule 9). */
export function commissionDecisions(
  adjustments: readonly Pick<CommissionAdjustment, "decides">[],
): Map<string, "applied" | "waived"> {
  return new Map(adjustments.flatMap((a) => (a.decides ? [[a.decides.lineId, a.decides.outcome] as const] : [])));
}

/** What `commissionStatementRows` reads besides the engine's inputs. */
export interface StatementRowsInput {
  inputs: CommissionInputs;
  /** `commissionLines(inputs)`, computed once by the caller. */
  lines: readonly CommissionLine[];
  statements: readonly CommissionStatement[];
  adjustments: readonly CommissionAdjustment[];
  nameOf: (userId: string) => string;
  /** The months to show, oldest first; the last twelve by default (`statementRows`). */
  months?: readonly string[];
}

/**
 * Every person's statements, month by month (commissions.md rule 11, `statementRows`): anyone on a
 * plan or with a line has a row per month, its figures derived from the lines and adjustments, its
 * status from the stored statement (a month with none reads as `draft`). The plan for a month is
 * the one in force on the 15th. One function serves the demo and the API.
 */
export function commissionStatementRows(input: StatementRowsInput): CommissionStatementRow[] {
  const { inputs, lines, statements, adjustments, nameOf } = input;
  const months = input.months ?? last12Months(inputs.today);
  const people = [...new Set([...inputs.assignments.map((a) => a.userId), ...lines.map((l) => l.userId)])];
  return people.flatMap((userId) => {
    const planFor = (month: string) => planOn(inputs, userId, `${month}-15`)?.plan ?? null;
    const before = monthsBefore(months[0] ?? "", firstMonthOf(userId, inputs, lines, adjustments));
    const carryIn = statementChain(userId, before, lines, adjustments, planFor).at(-1)?.carryOut ?? "0.00";
    return statementChain(userId, months, lines, adjustments, planFor, carryIn).map((figures) => {
      const record = statements.find((s) => s.userId === userId && s.month === figures.month);
      return {
        ...figures,
        statementId: record?.id ?? null,
        name: nameOf(userId),
        status: record?.status ?? "draft",
        approvedBy: record?.approvedBy ?? null,
        approvedAt: record?.approvedAt ?? null,
        payPeriodId: record?.payPeriodId ?? null,
        monthEnded: monthEnded(figures.month, inputs.today),
        planName: planOn(inputs, userId, `${figures.month}-15`)?.plan.name ?? null,
      };
    });
  });
}

/**
 * The first month a person has anything that feeds a statement: a line, an adjustment or an
 * assignment, or null. The chain before the window starts there (ADR 0048: carry never resets).
 */
function firstMonthOf(
  userId: string,
  inputs: Pick<CommissionInputs, "assignments">,
  lines: readonly CommissionLine[],
  adjustments: readonly CommissionAdjustment[],
): string | null {
  const months = [
    ...lines.filter((l) => l.userId === userId).map((l) => l.month),
    ...adjustments.filter((a) => a.userId === userId).map((a) => a.month),
    ...inputs.assignments.filter((a) => a.userId === userId).map((a) => a.effectiveFrom.slice(0, 7)),
  ].sort();
  return months[0] ?? null;
}

/** Every month (YYYY-MM) from `from` up to, not including, `before`; empty when `from` is null or not earlier. */
function monthsBefore(before: string, from: string | null): string[] {
  const out: string[] = [];
  if (!from) return out;
  for (let month = from; month < before; month = nextMonth(month)) out.push(month);
  return out;
}

/** The month after a YYYY-MM month. */
const nextMonth = (month: string): string => addDays(monthEnd(month), 1).slice(0, 7);

/**
 * Why a month's statement can't be approved (commissions.md "To approved"), or null. Months are
 * approved in order (ADR 0048): an earlier month with commission or adjustments that is still open
 * would change this month's carry after it is frozen, so it goes first.
 */
export function statementApprovalProblem(
  rows: readonly CommissionStatementRow[],
  userId: string,
  month: string,
  today: string,
): string | null {
  const row = rows.find((r) => r.userId === userId && r.month === month);
  if (!row) return "This statement no longer exists.";
  if (!monthEnded(month, today)) return "A statement can be approved once its month has ended.";
  if (row.status !== "draft") return "This statement is already approved.";
  if (row.needsReview) return "Accept or waive the reversals waiting for review first.";
  const earlier = rows.find(
    (r) =>
      r.userId === userId &&
      r.month < month &&
      r.status === "draft" &&
      (r.lines.length > 0 || !dec(r.adjustment).isZero()),
  );
  if (earlier) return `Approve the statement for ${earlier.month} first, so each month's carry is final.`;
  return null;
}

/**
 * The latest month whose statement for a person is approved or paid, or null. Nothing may change a
 * month up to it (ADR 0048): adjustments and reversal decisions go on a later open month, and a new
 * plan assignment starts after it, so a frozen month's figures and the carry it passed on stay put.
 */
export function frozenThrough(statements: readonly CommissionStatement[], userId: string): string | null {
  return (
    statements
      .filter((s) => s.userId === userId && s.status !== "draft")
      .map((s) => s.month)
      .sort()
      .at(-1) ?? null
  );
}

/** Why HR can't decide a reversal (commissions.md rule 9): only a reversal line waiting for review on that statement. */
export function reversalDecisionProblem(row: CommissionStatementRow | undefined, lineId: string): string | null {
  const line = row?.lines.find((l) => l.id === lineId);
  if (!line || line.kind !== "reversal" || line.reversalState !== "needs_review") {
    return "This reversal is not waiting for a decision.";
  }
  return null;
}

/**
 * Hides the base of lines worked out on a gross margin basis from someone without
 * `sales.margin.view_sensitive` (CLAUDE.md rule 5; commissions.md edge case "Base is not masked for
 * HR", closed by ADR 0048): the base there is margin dollars, from the sensitive invoice cost. It
 * goes by the line's `basis`, the plan that set the invoice's base, not the line's own plan: on a
 * split sale a paid revenue co-rep's share, and every override or reversal of it, is margin too.
 */
export function hideMarginBase(rows: readonly CommissionStatementRow[]): CommissionStatementRow[] {
  return rows.map((row) => ({
    ...row,
    lines: row.lines.map((l) => (l.basis === "gross_margin" ? { ...l, base: null } : l)),
  }));
}

const PERCENT = /^\d{1,3}(\.\d{1,4})?$/;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;
const percentOk = (value: string) => PERCENT.test(value) && dec(value).lte(100);

/**
 * Why a commission plan can't be saved (commissions.md "CommissionPlan"; `PlanFormDialog`), or
 * null: a name, rates from 0 to 100 percent with up to four decimals, money with two, a draw amount
 * only when there is a draw, tiers from distinct points of the target, and a clawback window of up
 * to ten years.
 */
export function commissionPlanProblem(
  plan: Pick<
    CommissionPlan,
    "name" | "baseRatePct" | "monthlyTarget" | "tiers" | "overridePct" | "draw" | "clawbackDays"
  >,
): string | null {
  if (!plan.name.trim()) return "Give the plan a name.";
  if (!percentOk(plan.baseRatePct)) return "Enter a base rate from 0 to 100 percent.";
  if (!AMOUNT.test(plan.monthlyTarget)) return "Enter the monthly target in dollars and cents.";
  if (!percentOk(plan.overridePct)) return "Enter a manager override from 0 to 100 percent.";
  if (plan.tiers.some((t) => !PERCENT.test(t.fromPctOfTarget) || !percentOk(t.ratePct))) {
    return "Each tier needs a point of the target and a rate from 0 to 100 percent.";
  }
  if (new Set(plan.tiers.map((t) => dec(t.fromPctOfTarget).toString())).size !== plan.tiers.length) {
    return "Two tiers start at the same point of the target.";
  }
  if (!AMOUNT.test(plan.draw.monthlyAmount)) return "Enter the draw in dollars and cents.";
  if (plan.draw.kind === "none" && !dec(plan.draw.monthlyAmount).isZero())
    return "A plan with no draw has no draw amount.";
  if (!Number.isInteger(plan.clawbackDays) || plan.clawbackDays < 0 || plan.clawbackDays > 3650) {
    return "Enter a clawback window from 0 to 3650 days.";
  }
  return null;
}

/** What putting someone on a plan does to the assignments they have (commissions.md rule 14). */
export interface AssignmentChanges {
  /** Assignments that now end the day before the new one starts. */
  end: { id: string; effectiveTo: string }[];
  /** Assignments that start on or after the new one, which replaces them. */
  remove: string[];
}

/**
 * The person's other assignments around a new one from `from` (commissions.md rule 14, `assignPlan`):
 * one that starts on or after it is replaced, and one that is still running on that day ends the
 * day before, so no two assignments ever cover the same day.
 */
export function assignmentChanges(
  existing: readonly Pick<CommissionAssignment, "id" | "userId" | "effectiveFrom" | "effectiveTo">[],
  userId: string,
  from: string,
): AssignmentChanges {
  const own = existing.filter((a) => a.userId === userId);
  const dayBefore = addDays(from, -1);
  return {
    end: own
      .filter((a) => a.effectiveFrom < from && (!a.effectiveTo || a.effectiveTo >= from))
      .map((a) => ({ id: a.id, effectiveTo: dayBefore })),
    remove: own.filter((a) => a.effectiveFrom >= from).map((a) => a.id),
  };
}
