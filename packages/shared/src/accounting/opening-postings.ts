import { dec, moneyString, sum, type Dec } from "../money";
import type { PostingDraft, PostingLine } from "./postings";
import type { LedgerKey } from "./settings";

/** One amount of an opening balance, with the customer or location it belongs to (null for company-wide). */
export interface OpeningAmount {
  amount: string;
  customerId?: string | null;
  locationId?: string | null;
}

/**
 * What a company holds and owes on the day its books start (ADR 0062), each figure as the screens
 * work it out from the documents: receivables are open invoice balances, payables open bill
 * balances, stock its value at cost, retainage what is still held. Asset amounts are debit
 * balances, liability amounts credit balances.
 */
export interface OpeningBalances {
  cash: string;
  /** Open invoice balances, per customer. */
  receivables: readonly OpeningAmount[];
  /** Retainage withheld from customers and not yet released, per customer. */
  retainageReceivable: readonly OpeningAmount[];
  /** Stock on hand at cost, per warehouse. */
  inventory: readonly OpeningAmount[];
  /** Open supplier bill balances. */
  payables: string;
  /** Goods received that no bill covers yet, at the order's cost. */
  receivedNotBilled: string;
  /** Retainage withheld from subcontractors and not yet released. */
  retainagePayable: string;
  /** Customer credit not yet applied or refunded, per customer. */
  customerCredit: readonly OpeningAmount[];
  /**
   * Whether the payables or retainage hold a subcontract bill, whose amount shows what the
   * subcontract cost. The entry is then a contract posting, so reading the trial balance needs
   * contract cost sight (ADR 0055 S4; ADR 0062).
   */
  holdsSubcontractBill: boolean;
}

/** Which entry this is: its source id, accounting date (`yyyy-MM-dd`) and memo. */
export interface OpeningEntryRef {
  id: string;
  date: string;
  memo: string;
}

/** A line of `amount` on its normal side: a debit, or a credit of its size when it is negative. */
function signed(account: LedgerKey, amount: Dec, part: Omit<OpeningAmount, "amount"> = {}): PostingLine {
  const positive = amount.gte(0);
  return {
    account,
    debit: moneyString(positive ? amount : dec(0)),
    credit: moneyString(positive ? dec(0) : amount.negated()),
    locationId: part.locationId ?? null,
    customerId: part.customerId ?? null,
  };
}

function debits(account: LedgerKey, amounts: readonly OpeningAmount[]): PostingLine[] {
  return amounts.map((entry) => signed(account, dec(entry.amount), entry));
}

function credits(account: LedgerKey, amounts: readonly OpeningAmount[]): PostingLine[] {
  return amounts.map((entry) => signed(account, dec(entry.amount).negated(), entry));
}

/**
 * The opening-balance entry (ADR 0062; blueprint page 48): debit each asset (cash, receivables per
 * customer, retainage receivable, stock per warehouse) and credit each liability (payables, goods
 * received not billed, retainage payable, customer credit) for its balance, so every balance-sheet
 * account starts at what the documents say. What they leave over is the owners' stake on that day,
 * which goes to Opening Balance Equity, so the entry balances. Lines of zero are left out; an entry
 * with nothing to open has no lines and posts nothing. One that holds a subcontract bill posts as
 * `opening_balance_contract`, a contract source, so the trial balance asks for contract cost sight.
 */
export function openingBalancePosting(ref: OpeningEntryRef, balances: OpeningBalances): PostingDraft {
  const lines = [
    signed("cash", dec(balances.cash)),
    ...debits("accounts_receivable", balances.receivables),
    ...debits("retainage_receivable", balances.retainageReceivable),
    ...debits("inventory", balances.inventory),
    signed("accounts_payable", dec(balances.payables).negated()),
    signed("received_not_billed", dec(balances.receivedNotBilled).negated()),
    signed("retainage_payable", dec(balances.retainagePayable).negated()),
    ...credits("customer_credit", balances.customerCredit),
  ].filter((line) => dec(line.debit).gt(0) || dec(line.credit).gt(0));
  const net = sum(lines.map((line) => line.debit)).minus(sum(lines.map((line) => line.credit)));
  const equity = net.isZero() ? [] : [signed("opening_balance_equity", net.negated())];
  return {
    event: "opening_balance.posted",
    sourceType: balances.holdsSubcontractBill ? "opening_balance_contract" : "opening_balance",
    sourceId: ref.id,
    sourceNumber: "Opening balances",
    date: ref.date,
    memo: ref.memo,
    lines: lines.length === 0 ? [] : [...lines, ...equity],
  };
}
