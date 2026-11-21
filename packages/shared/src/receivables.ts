import { addDays } from "./dates";
import type { InvoiceLedger } from "./ledger";
import { dec, moneyString, sum } from "./money";
import type { Invoice } from "./types";

/** How many days ahead "Due in the next 7 days" looks (spec B5). */
export const DUE_SOON_DAYS = 7;

/** The receivables figures on the customers page (spec B5): two clear numbers and what comes due soon. */
export interface ReceivablesSummary {
  total: string;
  /** Not yet due, including balances held until installation. */
  current: string;
  /** Past its due date. */
  overdue: string;
  /** Part of current that falls due within the next 7 days. */
  dueSoon: string;
}

/** What one customer owes and when (spec B5 list). */
export interface CustomerReceivable {
  open: string;
  overdue: string;
  /** Days past due of the customer's oldest overdue invoice, or 0. */
  oldestDaysOverdue: number;
  /** The earliest due date still ahead, or null. */
  nextDueAt: string | null;
  lastPaymentAt: string | null;
}

const open = (invoices: readonly Invoice[], ledgers: ReadonlyMap<string, InvoiceLedger>) =>
  invoices.filter((i) => dec(ledgers.get(i.id)?.balance ?? "0").gt(0));

/**
 * Current, overdue and due-soon totals from each invoice's due date (spec B5: "Calculated from
 * each invoice's due date"). Current and overdue always add up to the total open.
 */
export function receivablesSummary(
  invoices: readonly Invoice[],
  ledgers: ReadonlyMap<string, InvoiceLedger>,
  today: string,
): ReceivablesSummary {
  const owed = open(invoices, ledgers);
  const balance = (i: Invoice) => ledgers.get(i.id)!.balance;
  const overdue = owed.filter((i) => ledgers.get(i.id)!.overdue);
  const current = owed.filter((i) => !ledgers.get(i.id)!.overdue);
  const soon = addDays(today, DUE_SOON_DAYS);
  return {
    total: moneyString(sum(owed.map(balance))),
    current: moneyString(sum(current.map(balance))),
    overdue: moneyString(sum(overdue.map(balance))),
    dueSoon: moneyString(sum(current.filter((i) => i.dueAt && i.dueAt <= soon).map(balance))),
  };
}

/** One customer's open balance, overdue amount, oldest days overdue, next due date and last payment. */
export function customerReceivable(
  customerId: string,
  invoices: readonly Invoice[],
  ledgers: ReadonlyMap<string, InvoiceLedger>,
): CustomerReceivable {
  const own = invoices.filter((i) => i.customerId === customerId);
  const owed = open(own, ledgers);
  const late = owed.filter((i) => ledgers.get(i.id)!.overdue);
  const ahead = owed
    .filter((i) => !ledgers.get(i.id)!.overdue && i.dueAt)
    .map((i) => i.dueAt!)
    .sort();
  const paidOn = own
    .map((i) => ledgers.get(i.id)?.lastPaymentAt)
    .filter((d): d is string => !!d)
    .sort();
  return {
    open: moneyString(sum(owed.map((i) => ledgers.get(i.id)!.balance))),
    overdue: moneyString(sum(late.map((i) => ledgers.get(i.id)!.balance))),
    oldestDaysOverdue: Math.max(0, ...late.map((i) => ledgers.get(i.id)!.daysOverdue)),
    nextDueAt: ahead[0] ?? null,
    lastPaymentAt: paidOn.at(-1) ?? null,
  };
}

/**
 * Whether a customer owes more than their credit limit (click-through #18). A limit of zero means
 * none was set (spec "Adding a customer" starts at 0.00), so it is never exceeded. The credit limit
 * is sensitive (CLAUDE.md rule 5): the server strips it from viewers without view_sensitive, so a
 * missing limit answers false and only people who see the limit see the warning.
 */
export function overCreditLimit(openBalance: string, creditLimit: string | null | undefined): boolean {
  if (!creditLimit || !dec(creditLimit).gt(0)) return false;
  return dec(openBalance).gt(creditLimit);
}
