import { daysBetween } from "../dates";
import { dec, moneyString } from "../money";
import type { Invoice, Payment, PaymentMethod, PaymentSettings } from "../types";
import type { InvoiceLedger } from "../ledger";
import { nextNumber } from "./quotes";

/** Payment methods as people say them (spec Appendix A "Record payment"). */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  ach: "Bank transfer / ACH",
  card: "Card",
  other: "Other",
};

/** What a person fills in to record a payment; files travel beside it. */
export interface RecordPaymentInput {
  invoiceId: string;
  kind: Payment["kind"];
  amount: string;
  date: string;
  method: PaymentMethod;
  checkNumber: string;
  cardLast4: string;
  reference: string;
  note: string;
  /** The part above the balance becomes customer credit (needs sales.payment.apply_credit). */
  extraAsCredit: boolean;
  /** The person confirmed that a reference already used elsewhere is right. */
  allowDuplicateReference: boolean;
}

/** Field errors of a payment form, by field. */
export type PaymentErrors = Partial<
  Record<"amount" | "date" | "method" | "reference" | "checkNumber" | "cardLast4", string>
>;

/**
 * Why a payment cannot be recorded, field by field (spec Appendix A): an amount above zero and
 * not above the balance unless the extra becomes credit; a date not in the future nor before
 * the invoice; a reference for anything but cash; a check number for checks; only the last four
 * digits of a card.
 */
export function validatePayment(
  input: RecordPaymentInput,
  context: { issuedAt: string; today: string; balance: string; canCredit: boolean; formatMoney: (v: string) => string },
): PaymentErrors {
  const errors: PaymentErrors = {};
  const amount = dec(/^\d+(\.\d{1,2})?$/.test(input.amount.trim()) ? input.amount.trim() : "0");
  if (amount.lte(0)) errors.amount = "Enter an amount above zero, with at most two decimals.";
  else if (amount.gt(context.balance) && !(input.extraAsCredit && context.canCredit)) {
    const extra = moneyString(amount.minus(context.balance));
    errors.amount = `This is ${context.formatMoney(extra)} more than the balance. Lower the amount${
      context.canCredit ? " or record the extra as customer credit" : ""
    }.`;
  }
  if (!input.date) errors.date = "Enter the payment date.";
  else if (daysBetween(context.today, input.date) > 0) errors.date = "The payment date cannot be in the future.";
  else if (daysBetween(input.date, context.issuedAt) > 0)
    errors.date = "The payment date cannot be before the invoice date.";
  if (!input.method) errors.method = "Choose how the customer paid.";
  if (input.method !== "cash" && !input.reference.trim())
    errors.reference = "Enter the reference or transaction ID from the bank, card or check.";
  if (input.method === "check" && !/^\d{1,10}$/.test(input.checkNumber.trim()))
    errors.checkNumber = "Enter the check number.";
  if (input.method === "card" && !/^\d{4}$/.test(input.cardLast4.trim()))
    errors.cardLast4 = "Enter only the last 4 digits of the card.";
  return errors;
}

/** What a person fills in to refund customer credit (spec Appendix A "Refund"); proof travels beside it. */
export interface RefundInput {
  customerId: string;
  amount: string;
  date: string;
  method: PaymentMethod;
  reference: string;
  note: string;
}

/** Field errors of a refund form. */
export type RefundErrors = Partial<Record<"amount" | "date" | "reference", string>>;

/**
 * Why a refund cannot be recorded (spec Appendix A): an amount above zero and not above the
 * customer's credit, a date not in the future, and a reference for anything but cash.
 */
export function validateRefund(
  input: RefundInput,
  context: { credit: string; today: string; formatMoney: (v: string) => string },
): RefundErrors {
  const errors: RefundErrors = {};
  const amount = dec(/^\d+(\.\d{1,2})?$/.test(input.amount.trim()) ? input.amount.trim() : "0");
  if (amount.lte(0)) errors.amount = "Enter an amount above zero, with at most two decimals.";
  else if (amount.gt(context.credit))
    errors.amount = `The customer has ${context.formatMoney(context.credit)} of credit; refund at most that.`;
  if (!input.date) errors.date = "Enter the refund date.";
  else if (daysBetween(context.today, input.date) > 0) errors.date = "The refund date cannot be in the future.";
  if (input.method !== "cash" && !input.reference.trim())
    errors.reference = "Enter the reference or transaction ID of the refund.";
  return errors;
}

/** A payment in this company that already uses the reference, for the duplicate warning. */
export function duplicateReference(reference: string, payments: readonly Payment[]): Payment | undefined {
  const ref = reference.trim().toLowerCase();
  return ref ? payments.find((p) => p.reference.trim().toLowerCase() === ref && p.status !== "voided") : undefined;
}

/**
 * Whether a new payment waits for a second person (spec Appendix A "Approval"): when approval is
 * on, for every payment or only those above the threshold.
 */
export function needsApproval(settings: PaymentSettings, amount: string): boolean {
  if (!settings.approvalRequired) return false;
  const threshold = settings.approvalThreshold.trim();
  return !threshold || dec(amount).gt(threshold);
}

/** The next payment number, four digits after the prefix: PAY-0001 (spec Appendix A). */
export function nextPaymentNumber(prefix: string, existing: readonly string[]): string {
  return nextNumber(prefix, existing, 1, 4);
}

/** What the Update status menu offers (spec B2): only actions that fit the invoice now. */
export type InvoiceAction = "deposit" | "payment" | "send" | "credit" | "write_off" | "void";

/**
 * The valid next actions for an invoice (spec B2, Appendix A): payments while a balance is due,
 * a deposit before any payment when the quote asked for one, Mark as sent until it was sent,
 * credit while the customer has some, a write-off for a small leftover, and Void while nothing
 * is confirmed. Permissions narrow this list further on the screen and in the store.
 */
export function invoiceActions(
  invoice: Invoice,
  ledger: InvoiceLedger,
  context: { customerCredit: string; writeOffMax: string },
): InvoiceAction[] {
  if (ledger.state === "void" || ledger.state === "return") return [];
  const due = dec(ledger.balance).gt(0);
  const actions: InvoiceAction[] = [];
  if (due && dec(ledger.paid).isZero() && dec(invoice.depositPct ?? "0").gt(0)) actions.push("deposit");
  if (due) actions.push("payment");
  if (!invoice.sentAt) actions.push("send");
  if (due && dec(context.customerCredit).gt(0)) actions.push("credit");
  if (due && dec(ledger.balance).lte(context.writeOffMax)) actions.push("write_off");
  if (!ledger.locked) actions.push("void");
  return actions;
}
