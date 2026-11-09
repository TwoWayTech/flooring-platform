import { daysBetween } from "./dates";
import { dec, maxDec, moneyString, pctOf, roundMoney, sum, type Dec } from "./money";
import type { Invoice, InvoiceAdjustment, Payment, Refund } from "./types";

/**
 * An invoice's state, derived from its total, confirmed payments, credits, write-offs and due
 * date (spec Appendix A "Core rule"): never chosen from a dropdown, never stored.
 */
export type InvoiceState = "open" | "partial" | "paid" | "overpaid" | "void" | "return";

/** Everything the screens, reports and documents show about what an invoice owes. */
export interface InvoiceLedger {
  invoiceId: string;
  state: InvoiceState;
  total: string;
  /** Confirmed payments. */
  paid: string;
  /** Payments recorded but not yet confirmed; they do not reduce the balance. */
  pending: string;
  credited: string;
  writtenOff: string;
  /** total − confirmed payments − applied credits − write-offs, never below zero. */
  balance: string;
  /** What was paid above the total; it becomes customer credit. */
  overpaid: string;
  overdue: boolean;
  /** Days past the due date of an overdue invoice, else 0. */
  daysOverdue: number;
  pendingVerification: boolean;
  /** Confirmed payments cover the deposit and a balance remains (plan B-3: a label, not a state). */
  depositPaid: boolean;
  lastPaymentAt: string | null;
  /** The day the last confirmed payment, credit or write-off settled it, for the PAID mark. */
  paidAt: string | null;
  /** Lines and prices are locked once any payment is confirmed (spec Appendix A "Corrections"). */
  locked: boolean;
}

/** Payments, credits and write-offs that touch invoices, grouped once for many ledgers. */
export interface LedgerDocs {
  payments: readonly Payment[];
  adjustments: readonly InvoiceAdjustment[];
}

const confirmed = (p: Payment) => p.status === "confirmed";

/**
 * The ledger of one invoice (spec Appendix A): balance = total − confirmed payments − applied
 * credits − write-offs, at full precision, rounded only for display. Void invoices and credit
 * notes owe nothing. `depositPct` comes from the quote the invoice was made from.
 */
export function invoiceLedger(
  invoice: Invoice,
  docs: LedgerDocs,
  today: string,
  depositPct: string = invoice.depositPct ?? "0",
): InvoiceLedger {
  const payments = docs.payments.filter((p) => p.invoiceId === invoice.id);
  const adjustments = docs.adjustments.filter((a) => a.invoiceId === invoice.id);
  const total = dec(invoice.total);
  const paid = sum(payments.filter(confirmed).map((p) => p.amount));
  const pending = sum(payments.filter((p) => p.status === "pending").map((p) => p.amount));
  const credited = sum(adjustments.filter((a) => a.kind === "credit_applied").map((a) => a.amount));
  const writtenOff = sum(adjustments.filter((a) => a.kind === "write_off").map((a) => a.amount));
  const settled = paid.plus(credited).plus(writtenOff);
  const owed = total.minus(settled);
  const balance = invoice.voidedAt || invoice.isReturn ? dec(0) : maxDec(owed, dec(0));
  const overpaid = maxDec(paid.minus(total.minus(credited).minus(writtenOff)), dec(0));
  const lastPaymentAt = latest(payments.filter(confirmed).map((p) => p.date));
  const overdue = balance.gt(0) && !!invoice.dueAt && daysBetween(invoice.dueAt, today) > 0;
  const deposit = roundMoney(pctOf(total, depositPct));
  return {
    invoiceId: invoice.id,
    state: stateOf(invoice, balance, settled, overpaid),
    total: moneyString(total),
    paid: moneyString(paid),
    pending: moneyString(pending),
    credited: moneyString(credited),
    writtenOff: moneyString(writtenOff),
    balance: moneyString(balance),
    overpaid: moneyString(overpaid),
    overdue,
    daysOverdue: overdue ? daysBetween(invoice.dueAt!, today) : 0,
    pendingVerification: pending.gt(0),
    depositPaid:
      balance.gt(0) &&
      paid.gt(0) &&
      ((deposit.gt(0) && paid.gte(deposit)) || payments.some((p) => confirmed(p) && p.kind === "deposit")),
    lastPaymentAt,
    paidAt:
      balance.isZero() && settled.gt(0) ? latest([lastPaymentAt, ...adjustments.map((a) => a.at.slice(0, 10))]) : null,
    locked: paid.gt(0),
  };
}

function latest(dates: readonly (string | null)[]): string | null {
  return (
    dates
      .filter((d): d is string => !!d)
      .sort()
      .at(-1) ?? null
  );
}

function stateOf(invoice: Invoice, balance: Dec, settled: Dec, overpaid: Dec): InvoiceState {
  if (invoice.voidedAt) return "void";
  if (invoice.isReturn) return "return";
  if (overpaid.gt(0)) return "overpaid";
  if (balance.isZero()) return "paid";
  return settled.gt(0) ? "partial" : "open";
}

/** Ledgers of many invoices at once, keyed by invoice id, grouping payments and adjustments a single time. */
export function ledgerIndex(invoices: readonly Invoice[], docs: LedgerDocs, today: string): Map<string, InvoiceLedger> {
  const payments = groupBy(docs.payments, (p) => p.invoiceId);
  const adjustments = groupBy(docs.adjustments, (a) => a.invoiceId);
  return new Map(
    invoices.map((inv) => [
      inv.id,
      invoiceLedger(inv, { payments: payments.get(inv.id) ?? [], adjustments: adjustments.get(inv.id) ?? [] }, today),
    ]),
  );
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/**
 * A customer's credit (spec Appendix A "Apply customer credit"): overpayments plus credit notes
 * not refunded on the spot, minus credit already applied to invoices and credit refunded.
 */
export function customerCredit(
  customerId: string,
  invoices: readonly Invoice[],
  ledgers: ReadonlyMap<string, InvoiceLedger>,
  adjustments: readonly InvoiceAdjustment[],
  refunds: readonly Refund[],
): Dec {
  const own = invoices.filter((i) => i.customerId === customerId);
  const overpaid = sum(own.map((i) => ledgers.get(i.id)?.overpaid ?? "0"));
  const notes = sum(own.filter((i) => i.isReturn && !i.voidedAt && !i.refundedAt).map((i) => i.total));
  const applied = sum(
    adjustments.filter((a) => a.customerId === customerId && a.kind === "credit_applied").map((a) => a.amount),
  );
  const refunded = sum(
    refunds.filter((r) => r.customerId === customerId && r.status === "completed").map((r) => r.amount),
  );
  return maxDec(overpaid.plus(notes).minus(applied).minus(refunded), dec(0));
}

/**
 * What an invoice shows and filters by (spec Appendix A table, B2): the derived state plus the
 * labels that sit on top of it. Overdue shows together with Partly paid; Pending verification
 * and Deposit paid are labels, never stored states (plan B-3).
 */
export type InvoiceStatusKey = InvoiceState | "overdue" | "pending" | "deposit";

/** Words for each invoice status, for pills, filters and CSV. */
export const INVOICE_STATUS_LABELS: Record<InvoiceStatusKey, string> = {
  open: "Open",
  partial: "Partly paid",
  paid: "Paid",
  overpaid: "Overpaid",
  void: "Void",
  return: "Return",
  overdue: "Overdue",
  pending: "Pending verification",
  deposit: "Deposit paid",
};

/** The status that leads, then the labels shown beside it. */
export interface InvoiceStatus {
  main: InvoiceStatusKey;
  extras: InvoiceStatusKey[];
}

/**
 * The invoice's leading status and extra labels. The most urgent fact leads, so filters find it:
 * void and returns first, then a payment waiting for verification, then overdue; Deposit paid
 * stands in for Partly paid when the deposit is what was paid.
 */
export function invoiceStatus(ledger: InvoiceLedger): InvoiceStatus {
  if (ledger.state === "void" || ledger.state === "return") return { main: ledger.state, extras: [] };
  const base: InvoiceStatusKey = ledger.state === "partial" && ledger.depositPaid ? "deposit" : ledger.state;
  const flags: InvoiceStatusKey[] = [
    ...(ledger.pendingVerification ? (["pending"] as const) : []),
    ...(ledger.overdue ? (["overdue"] as const) : []),
  ];
  const [main = base, ...rest] = flags;
  const extras = [...rest, ...(main === base ? [] : [base])].filter((k) => k !== "open");
  return { main, extras };
}

/** The leading status's label, the value a status filter or CSV uses. */
export function invoiceStatusLabel(ledger: InvoiceLedger): string {
  return INVOICE_STATUS_LABELS[invoiceStatus(ledger).main];
}
