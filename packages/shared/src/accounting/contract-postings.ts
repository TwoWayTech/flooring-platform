import { dec, moneyString, type Dec } from "../money";
import type { PostingDraft, PostingLine } from "./postings";
import type { LedgerKey } from "./settings";

/**
 * Contract billing postings (contracts.md rules 12 and 14; ADR 0045). Retainage is held off an
 * invoice's or bill's total, so it is not in receivables or payables until it is released: the
 * customer side keeps it in Retainage Receivable, the subcontract side in Retainage Payable. A
 * billing can carry a lower cumulative figure than the last one (rule 5, edge case 15), so any
 * amount may be negative; a negative amount simply moves to the other side, which keeps every
 * line one-sided and the entry balanced.
 */

/** Which billing an entry belongs to: its id, its contract's number and its own number. */
export interface BillingRef {
  id: string;
  contractNumber: string;
  number: number;
  kind: "progress" | "release";
}

/** A debit of `amount`, or a credit of its size when it is negative. */
function debitSide(account: LedgerKey, amount: Dec, extra: Partial<PostingLine> = {}): PostingLine {
  const positive = amount.gte(0);
  return {
    account,
    debit: moneyString(positive ? amount : dec(0)),
    credit: moneyString(positive ? dec(0) : amount.negated()),
    locationId: null,
    customerId: null,
    ...extra,
  };
}

/** A credit of `amount`, or a debit of its size when it is negative. */
function creditSide(account: LedgerKey, amount: Dec, extra: Partial<PostingLine> = {}): PostingLine {
  return debitSide(account, amount.negated(), extra);
}

/** Leaves out lines of zero, which a ledger never stores. */
function nonZero(lines: PostingLine[]): PostingLine[] {
  return lines.filter((line) => dec(line.debit).gt(0) || dec(line.credit).gt(0));
}

function memoOf(billing: BillingRef, document: string): string {
  const what = billing.kind === "release" ? "Retainage release" : "Contract billing";
  return `${what} ${billing.contractNumber} #${billing.number}, ${document}`;
}

/**
 * A customer billing's invoice (contracts.md rule 12; ADR 0045): debit Accounts Receivable for the
 * total and Retainage Receivable for what is withheld; credit Sales for the gross at the contract's
 * location and Sales Tax Payable for the tax. A release moves the released money from Retainage
 * Receivable to Accounts Receivable, with any tax the contract's treatment puts on it (rule 13).
 * It balances because `total = subtotal + tax - withheld + released`.
 */
export function contractInvoicePosting(
  billing: BillingRef,
  invoice: {
    number: string;
    issuedAt: string;
    customerId: string;
    locationId: string;
    subtotal: string;
    tax: string;
    total: string;
    retainageWithheld?: string | undefined;
    retainageReleased?: string | undefined;
  },
): PostingDraft {
  const customer = { customerId: invoice.customerId };
  return {
    event: "contract_billing.posted",
    sourceType: "contract_billing",
    sourceId: billing.id,
    sourceNumber: invoice.number,
    date: invoice.issuedAt,
    memo: memoOf(billing, `invoice ${invoice.number}`),
    lines: nonZero([
      debitSide("accounts_receivable", dec(invoice.total), customer),
      debitSide("retainage_receivable", dec(invoice.retainageWithheld ?? 0), customer),
      creditSide("retainage_receivable", dec(invoice.retainageReleased ?? 0), customer),
      creditSide("sales", dec(invoice.subtotal), { ...customer, locationId: invoice.locationId }),
      creditSide("sales_tax_payable", dec(invoice.tax), customer),
    ]),
  };
}

/**
 * A subcontract billing's bill (contracts.md rule 14; ADR 0045): debit Cost of Goods Sold for the
 * gross at the contract's location (subcontracted work is a job cost, blueprint-delta 2026-11-14);
 * credit Accounts Payable for the total and Retainage Payable for what is withheld. A release moves
 * the released money from Retainage Payable to Accounts Payable. It balances because
 * `total = gross - withheld + released`. A bill carries no tax.
 */
export function contractBillPosting(
  billing: BillingRef,
  bill: {
    number: string;
    issuedAt: string;
    total: string;
    gross: string;
    retainageWithheld: string;
    retainageReleased: string;
    supplierName: string;
  },
  locationId: string,
): PostingDraft {
  return {
    event: "contract_billing.posted",
    sourceType: "contract_billing",
    sourceId: billing.id,
    sourceNumber: bill.number,
    date: bill.issuedAt,
    memo: memoOf(billing, `bill ${bill.number} from ${bill.supplierName}`),
    lines: nonZero([
      debitSide("cost_of_goods_sold", dec(bill.gross), { locationId }),
      debitSide("retainage_payable", dec(bill.retainageReleased)),
      creditSide("accounts_payable", dec(bill.total)),
      creditSide("retainage_payable", dec(bill.retainageWithheld)),
    ]),
  };
}
