import { dec, moneyString, sum, type Dec } from "../money";
import type { PayPeriod } from "../types";
import type { PostingDraft, PostingLine } from "./postings";
import type { LedgerKey } from "./settings";

/**
 * Payroll postings (hr.md "Pay periods"; ADR 0047). The API works out gross pay only; taxes and
 * net pay belong to the outside payroll provider (hr.md "Purpose"), so an approved run accrues its
 * gross wages and nothing else: no employer taxes are posted, because the spec and the country pack
 * have none. A 1099 contractor is never in a run; a contractor payment posts on its own when paid.
 */

/** One approved run, as its entry names it: `sourceId` is unique per approval, so a reopened run can be approved again. */
export interface PayrollRunRef {
  sourceId: string;
  period: Pick<PayPeriod, "start" | "end">;
}

/** One person's gross pay in a run and the location it counts at (Employee.homeLocationId; null for company-wide). */
export interface PayrollLineAmount {
  grossPay: string;
  locationId: string | null;
}

function line(account: LedgerKey, debit: Dec, credit: Dec, locationId: string | null = null): PostingLine {
  return {
    account,
    debit: moneyString(debit),
    credit: moneyString(credit),
    locationId,
    customerId: null,
  };
}

/**
 * An approved pay run (hr.md "To approved"; ADR 0047): debit Wages for the gross pay of each
 * location, from each person's home location (hr.md "Employee", `homeLocationId`: where their pay
 * counts in location profit), and credit Accrued Payroll for the total, which the payroll provider's
 * run pays out. Bonuses and commission are part of each line's gross, so they are wages too. Dated
 * the period's last day, because the wages belong to that period; a run with no pay posts nothing.
 * One debit per location, never per person, so the ledger does not list each person's pay.
 */
export function payrollPosting(run: PayrollRunRef, lines: readonly PayrollLineAmount[]): PostingDraft {
  const byLocation = new Map<string | null, Dec>();
  for (const entry of lines) {
    const gross = dec(entry.grossPay);
    if (gross.lte(0)) continue;
    byLocation.set(entry.locationId, (byLocation.get(entry.locationId) ?? dec(0)).plus(gross));
  }
  const total = sum([...byLocation.values()]);
  const label = `${run.period.start} to ${run.period.end}`;
  const debits = [...byLocation.entries()]
    .sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""))
    .map(([locationId, amount]) => line("wages", amount, dec(0), locationId));
  return {
    event: "payroll.approved",
    sourceType: "pay_period",
    sourceId: run.sourceId,
    sourceNumber: `PP ${run.period.start}`,
    date: run.period.end,
    memo: `Payroll ${label}, gross pay estimate`,
    lines: total.gt(0) ? [...debits, line("accrued_payroll", dec(0), total)] : [],
  };
}

/**
 * A contractor payment once it is paid (hr.md "ContractorPayment"; ADR 0047): debit Contract
 * Labor, credit the bank account for its method (`cashAccountFor`, ADR 0040). It names no person
 * in the ledger, and its memo carries no free text from the form, only a short reference to the
 * payment (first security review of PR #26). Approving a payment to make posts nothing; a void of a
 * paid one posts the reversal on the void day.
 */
export function contractorPaymentPosting(
  payment: { id: string; amount: string },
  paidOn: string,
  cashAccount: LedgerKey,
): PostingDraft {
  const amount = dec(payment.amount);
  return {
    event: "contractor_payment.paid",
    sourceType: "contractor_payment",
    sourceId: payment.id,
    sourceNumber: `CP ${paidOn}`,
    date: paidOn,
    memo: `Contractor payment CP-${payment.id.slice(-8)}`,
    lines: amount.gt(0) ? [line("contract_labor", amount, dec(0)), line(cashAccount, dec(0), amount)] : [],
  };
}
