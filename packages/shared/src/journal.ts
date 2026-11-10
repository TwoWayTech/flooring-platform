import { expenseCost } from "./expenses";
import { moneyString } from "./money";
import type { Expense, ExpenseCategory } from "./types";

/** One line of a journal entry, derived from a document and never stored (ADR 0013, 0023). */
export interface JournalLine {
  account: string;
  debit: string;
  credit: string;
  /** The location the cost belongs to, on the debit line; null for company-wide. */
  locationId: string | null;
}

/** The expense account each category posts to (ADR 0023). */
const ACCOUNT: Record<ExpenseCategory, string> = {
  rent: "Rent",
  electricity: "Utilities",
  water: "Utilities",
  internet_phone: "Utilities",
  fuel_vehicles: "Vehicles",
  other: "Other Expenses",
  supplies: "Supplies",
  maintenance: "Repairs and Maintenance",
  insurance: "Insurance",
  taxes_licenses: "Taxes and Licences",
  marketing: "Marketing",
  professional_fees: "Professional Fees",
  payroll: "Payroll",
  sales_tax_payment: "Sales Tax Payable",
};

/**
 * The journal lines for an expense (ADR 0023): debit the category for its full cost and credit cash,
 * or accounts payable when it is paid later. A void reverses them. A draft, pending or rejected
 * expense posts nothing. A share of a company-wide cost is a report dimension, never a posting.
 */
export function expenseJournal(expense: Expense): JournalLine[] {
  if (expense.status !== "confirmed" && expense.status !== "voided") return [];
  const amount = moneyString(expenseCost(expense));
  const credit = expense.settlement === "on_account" ? "Accounts Payable" : "Cash or Bank";
  const debitLine: JournalLine = {
    account: ACCOUNT[expense.category],
    debit: amount,
    credit: "0.00",
    locationId: expense.locationId,
  };
  const creditLine: JournalLine = { account: credit, debit: "0.00", credit: amount, locationId: null };
  if (expense.status === "confirmed") return [debitLine, creditLine];
  return [
    debitLine,
    creditLine,
    { ...creditLine, debit: amount, credit: "0.00" },
    { ...debitLine, debit: "0.00", credit: amount },
  ];
}

/** Paying a pay-later expense moves it from payables to cash (ADR 0023). */
export function billPaymentJournal(amount: string): JournalLine[] {
  return [
    { account: "Accounts Payable", debit: amount, credit: "0.00", locationId: null },
    { account: "Cash or Bank", debit: "0.00", credit: amount, locationId: null },
  ];
}
