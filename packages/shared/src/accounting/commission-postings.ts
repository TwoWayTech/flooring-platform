import { monthEnd } from "../dates";
import { dec, moneyString, type Dec } from "../money";
import type { PostingDraft, PostingLine } from "./postings";
import type { LedgerKey } from "./settings";

/**
 * Commission postings (commissions.md "Workflows"; ADR 0048). Commission is paid through payroll
 * (hr.md rule 19), so approving a statement accrues it: debit Commissions, credit Accrued Payroll.
 * The pay run that later pays it debits Wages only for the rest of each person's gross pay
 * (`payrollPosting`, `commissionPay`), so the commission is never expensed twice.
 */

/** One approved statement, as its entry names it. */
export interface CommissionStatementRef {
  id: string;
  /** The month as YYYY-MM. */
  month: string;
}

function line(account: LedgerKey, debit: Dec, credit: Dec, locationId: string | null): PostingLine {
  return { account, debit: moneyString(debit), credit: moneyString(credit), locationId, customerId: null };
}

/**
 * An approved statement (commissions.md rule 11, `payable`; ADR 0048): debit Commissions at the
 * rep's home location (where hr.md counts their pay; null is company-wide) and credit Accrued
 * Payroll, dated the month's last day because the commission belongs to that month. `payable` is
 * never negative (a bad month carries forward instead), so a statement with nothing to pay posts
 * nothing. Reversals and adjustments are not posted on their own: they net into the open month's
 * statement and post with its approval. The memo names the statement, never the person.
 */
export function commissionStatementPosting(
  statement: CommissionStatementRef,
  payable: string,
  locationId: string | null,
): PostingDraft {
  const amount = dec(payable);
  return {
    event: "commission.approved",
    sourceType: "commission_statement",
    sourceId: statement.id,
    sourceNumber: `CS ${statement.month}`,
    date: monthEnd(statement.month),
    memo: `Commission statement CS-${statement.id.slice(-8)}, ${statement.month}`,
    lines: amount.gt(0)
      ? [line("commissions_expense", amount, dec(0), locationId), line("accrued_payroll", dec(0), amount, null)]
      : [],
  };
}
