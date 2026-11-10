import { dec, type Dec } from "./money";
import type { Expense, ExpenseCategory, ExpenseSettings, RecurringExpense } from "./types";

/** How each category reads. Payroll is not offered: it exists only for seeded and imported months. */
export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  rent: "Rent",
  electricity: "Electricity",
  water: "Water",
  internet_phone: "Internet and phone",
  supplies: "Supplies",
  maintenance: "Maintenance and repairs",
  fuel_vehicles: "Fuel and vehicles",
  insurance: "Insurance",
  taxes_licenses: "Taxes and licences",
  marketing: "Marketing",
  professional_fees: "Professional fees",
  other: "Other",
  sales_tax_payment: "Sales tax payment",
  payroll: "Payroll",
};

/** The categories a person can pick (spec F1, ADR 0023). */
export const EXPENSE_CATEGORIES = (Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[]).filter(
  (c) => c !== "payroll",
);

/** What an expense costs: amount plus tax, because US sales tax on a purchase is part of its cost (ADR 0023). */
export const expenseCost = (e: Pick<Expense, "amount" | "tax">): Dec => dec(e.amount).plus(e.tax);

/** Whether an expense counts as a cost: confirmed, and not money passed on to the state (ADR 0023). */
export const countsAsCost = (e: Pick<Expense, "status" | "category">) =>
  e.status === "confirmed" && e.category !== "sales_tax_payment";

/** Why an expense cannot leave draft, or null: the spec makes the receipt mandatory. */
export function expenseProblem(
  e: Pick<Expense, "date" | "category" | "amount" | "tax" | "supplierId">,
  fileCount: number,
): string | null {
  if (!e.date) return "Choose the date.";
  if (!e.supplierId) return "Choose the vendor.";
  if (!/^\d+(\.\d{1,2})?$/.test(e.amount) || dec(e.amount).lte(0)) return "Enter the amount.";
  if (e.tax && !/^\d+(\.\d{1,2})?$/.test(e.tax)) return "Enter the tax as an amount, or leave it empty.";
  if (fileCount === 0) return "Attach the receipt, statement or lease.";
  return null;
}

/** Whether an expense waits for a second person: the same rule as payments (ADR 0023). */
export function needsExpenseApproval(settings: ExpenseSettings, e: Pick<Expense, "amount" | "tax">): boolean {
  if (!settings.approvalRequired) return false;
  return !settings.approvalThreshold.trim() || expenseCost(e).gt(settings.approvalThreshold);
}

const STEP_MONTHS: Record<RecurringExpense["frequency"], number> = { monthly: 1, quarterly: 3, yearly: 12 };

function dateIn(year: number, monthIndex: number, day: number): string {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(day, last))).toISOString().slice(0, 10);
}

function periodKey(date: string, frequency: RecurringExpense["frequency"]): string {
  if (frequency === "monthly") return date.slice(0, 7);
  if (frequency === "yearly") return date.slice(0, 4);
  return `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
}

const MAX_CATCH_UP = 12;

/**
 * Which drafts a recurring expense still owes (spec F1, ADR 0023): one per template and period, safe
 * to repeat because a period stays used even after its expense is voided, at most twelve at a time.
 */
export function dueRecurringDrafts(
  templates: readonly RecurringExpense[],
  expenses: readonly Pick<Expense, "recurringId" | "period">[],
  today: string,
): { template: RecurringExpense; period: string; date: string }[] {
  const used = new Set(expenses.map((e) => `${e.recurringId}|${e.period}`));
  return templates
    .filter((t) => t.active)
    .flatMap((template) => {
      const due: { template: RecurringExpense; period: string; date: string }[] = [];
      const [y, m] = template.startsOn.split("-").map(Number) as [number, number];
      for (let i = 0; ; i += STEP_MONTHS[template.frequency]) {
        const date = dateIn(y, m - 1 + i, template.dayOfMonth);
        if (date > today || (template.endsOn && date > template.endsOn)) break;
        if (date < template.startsOn) continue;
        const period = periodKey(date, template.frequency);
        if (!used.has(`${template.id}|${period}`)) due.push({ template, period, date });
      }
      return due.slice(-MAX_CATCH_UP);
    });
}
