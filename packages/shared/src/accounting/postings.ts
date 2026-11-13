import { dec, minDec, moneyString, sum, type Dec } from "../money";
import type { Invoice, InvoiceAdjustment, Payment, Refund } from "../types";
import type { AccountKey } from "./accounts";

/** One side of one account in a journal entry. Exactly one of debit and credit is above zero. */
export interface PostingLine {
  account: AccountKey;
  debit: string;
  credit: string;
  /** The location the figure belongs to (revenue by where it was sold); null for company-wide. */
  locationId: string | null;
  customerId: string | null;
}

/** What a business event posts (ADR 0039). `event` and the source make it unique, so nothing posts twice. */
export interface PostingDraft {
  event: PostingEvent;
  sourceType: "invoice" | "payment" | "adjustment" | "refund";
  sourceId: string;
  sourceNumber: string;
  /** The accounting date, `yyyy-MM-dd`. */
  date: string;
  memo: string;
  lines: PostingLine[];
}

/** The events that post, and the reversal of each. */
export type PostingEvent =
  | "invoice.issued"
  | "credit_note.issued"
  | "payment.confirmed"
  | "write_off"
  | "credit.applied"
  | "refund"
  | `${"invoice.issued" | "credit_note.issued" | "payment.confirmed"}.reversed`;

const ZERO = "0.00";

function debit(account: AccountKey, amount: Dec, extra: Partial<PostingLine> = {}): PostingLine {
  return { account, debit: moneyString(amount), credit: ZERO, locationId: null, customerId: null, ...extra };
}

function credit(account: AccountKey, amount: Dec, extra: Partial<PostingLine> = {}): PostingLine {
  return { account, debit: ZERO, credit: moneyString(amount), locationId: null, customerId: null, ...extra };
}

/** Leaves out lines of zero, which a ledger never stores. */
function nonZero(lines: PostingLine[]): PostingLine[] {
  return lines.filter((line) => dec(line.debit).gt(0) || dec(line.credit).gt(0));
}

/** Where an invoice's revenue belongs: where it was sold, else where it ships from (ADR 0023). */
function soldAt(invoice: Pick<Invoice, "soldAtLocationId" | "locationId">): string {
  return invoice.soldAtLocationId ?? invoice.locationId;
}

/**
 * An invoice (blueprint page 24): debit Accounts Receivable for the total; credit Sales for the
 * subtotal at the location it was sold and Sales Tax Payable for the tax. Retainage is a contract
 * billing rule and posts with the contracts module, so an invoice that carries it is refused here.
 */
export function invoicePosting(invoice: Invoice): PostingDraft {
  if (invoice.retainageWithheld || invoice.retainageReleased) {
    throw new Error("Contract billings with retainage post with the contracts module.");
  }
  const customer = { customerId: invoice.customerId };
  return {
    event: "invoice.issued",
    sourceType: "invoice",
    sourceId: invoice.id,
    sourceNumber: invoice.number,
    date: invoice.issuedAt,
    memo: `Invoice ${invoice.number}`,
    lines: nonZero([
      debit("accounts_receivable", dec(invoice.total), customer),
      credit("sales", dec(invoice.subtotal), { ...customer, locationId: soldAt(invoice) }),
      credit("sales_tax_payable", dec(invoice.tax), customer),
    ]),
  };
}

/**
 * A credit note (spec rule 38): debit Sales Returns for the amount before tax and Sales Tax
 * Payable for its tax; credit Customer Credit for the total. Settling its own invoice first is a
 * separate credit-applied posting (ADR 0039).
 */
export function creditNotePosting(note: Invoice): PostingDraft {
  const customer = { customerId: note.customerId };
  return {
    event: "credit_note.issued",
    sourceType: "invoice",
    sourceId: note.id,
    sourceNumber: note.number,
    date: note.issuedAt,
    memo: `Credit note ${note.number}`,
    lines: nonZero([
      debit("sales_returns", dec(note.subtotal), { ...customer, locationId: soldAt(note) }),
      debit("sales_tax_payable", dec(note.tax), customer),
      credit("customer_credit", dec(note.total), customer),
    ]),
  };
}

/**
 * A payment once it counts (spec rule 28): debit Cash for the whole amount; credit Accounts
 * Receivable up to the invoice's balance before it, and Customer Credit for any extra. A deposit is
 * a payment on an invoice that is already issued, so it reduces the receivable too (ADR 0039).
 */
export function paymentPosting(payment: Payment, invoiceNumber: string, balanceBefore: string): PostingDraft {
  const amount = dec(payment.amount);
  const toInvoice = minDec(amount, dec(balanceBefore).lt(0) ? dec(0) : dec(balanceBefore));
  const customer = { customerId: payment.customerId };
  return {
    event: "payment.confirmed",
    sourceType: "payment",
    sourceId: payment.id,
    sourceNumber: payment.number,
    date: payment.date,
    memo: `${payment.kind === "deposit" ? "Deposit" : "Payment"} ${payment.number} on ${invoiceNumber}`,
    lines: nonZero([
      debit("cash", amount, customer),
      credit("accounts_receivable", toInvoice, customer),
      credit("customer_credit", amount.minus(toInvoice), customer),
    ]),
  };
}

/**
 * A write-off (spec rule 34) moves the balance to Bad Debt, and applied credit (rule 36) moves
 * Customer Credit onto the invoice. Either way Accounts Receivable goes down.
 */
export function adjustmentPosting(adjustment: InvoiceAdjustment, invoiceNumber: string, date: string): PostingDraft {
  const amount = dec(adjustment.amount);
  const customer = { customerId: adjustment.customerId };
  const writeOff = adjustment.kind === "write_off";
  return {
    event: writeOff ? "write_off" : "credit.applied",
    sourceType: "adjustment",
    sourceId: adjustment.id,
    sourceNumber: invoiceNumber,
    date,
    memo: `${writeOff ? "Write-off" : "Credit applied"} on ${invoiceNumber}`,
    lines: nonZero([
      debit(writeOff ? "bad_debt" : "customer_credit", amount, customer),
      credit("accounts_receivable", amount, customer),
    ]),
  };
}

/** A refund of customer credit (spec rule 37): debit Customer Credit, credit Cash. */
export function refundPosting(refund: Refund): PostingDraft {
  const amount = dec(refund.amount);
  const customer = { customerId: refund.customerId };
  return {
    event: "refund",
    sourceType: "refund",
    sourceId: refund.id,
    sourceNumber: refund.number,
    date: refund.date,
    memo: `Refund ${refund.number}`,
    lines: nonZero([debit("customer_credit", amount, customer), credit("cash", amount, customer)]),
  };
}

/** The lines that undo an entry: every debit becomes a credit and every credit a debit (CLAUDE.md rule 9). */
export function reversedLines(lines: readonly PostingLine[]): PostingLine[] {
  return lines.map((line) => ({ ...line, debit: line.credit, credit: line.debit }));
}

/** Total debits and credits of some lines. */
export function totals(lines: readonly Pick<PostingLine, "debit" | "credit">[]): { debit: Dec; credit: Dec } {
  return { debit: sum(lines.map((line) => line.debit)), credit: sum(lines.map((line) => line.credit)) };
}

/**
 * Why lines cannot be posted, or null when they can: at least two lines, each one-sided, none
 * negative, and debits equal to credits (blueprint page 48).
 */
export function postingProblem(lines: readonly Pick<PostingLine, "debit" | "credit">[]): string | null {
  if (lines.length < 2) return "An entry needs at least two lines.";
  for (const line of lines) {
    const d = dec(line.debit);
    const c = dec(line.credit);
    if (d.lt(0) || c.lt(0)) return "An entry line cannot be negative.";
    if (d.gt(0) === c.gt(0)) return "Each entry line is either a debit or a credit.";
  }
  const sums = totals(lines);
  return sums.debit.eq(sums.credit) ? null : "Debits and credits must be equal.";
}
