import {
  customerCredit,
  dec,
  ledgerIndex,
  minDec,
  moneyString,
  nextPaymentNumber,
  validateRefund,
  type InvoiceAdjustment,
  type Payment,
  type Refund,
  type RefundInput,
} from "@workspace/shared";
import { DemoRuleError } from "./admin-rules";
import { describeFiles, invoiceWithLedger, storeFiles, type ActionContext } from "./payment-actions";

const dollars = (amount: string) => `$${moneyString(amount)}`;

const needReason = (reason: string, what: string) => {
  if (reason.trim().length < 3) throw new DemoRuleError(`Say why ${what}.`);
  return reason.trim();
};

/** A customer's credit now, from every invoice, credit, write-off and refund in the company. */
function creditNow(ctx: ActionContext, customerId: string) {
  const invoices = ctx.db.list("invoices");
  const adjustments = ctx.db.list("invoiceAdjustments");
  const ledgers = ledgerIndex(invoices, { payments: ctx.db.list("payments"), adjustments }, ctx.today);
  return customerCredit(customerId, invoices, ledgers, adjustments, ctx.db.list("refunds"));
}

/**
 * Voids a payment (spec Appendix A "Corrections"): kept with its files and struck through, the
 * balance comes back and the status follows. Used for bounced checks and mistakes; a reason is
 * required. To correct an amount, void and record again.
 */
export async function voidPayment(ctx: ActionContext, paymentId: string, reason: string): Promise<Payment> {
  await ctx.assertCan(["sales.payment.void"]);
  const payment = ctx.db.get("payments", paymentId);
  if (!payment) throw new DemoRuleError("This payment no longer exists.");
  if (payment.status !== "confirmed" && payment.status !== "pending") {
    throw new DemoRuleError(`Payment ${payment.number} is already ${payment.status}.`);
  }
  const why = needReason(reason, "the payment is voided");
  const { invoice } = invoiceWithLedger(ctx, payment.invoiceId);
  const voided: Payment = {
    ...payment,
    status: "voided",
    voidedBy: ctx.actor.name,
    voidedAt: ctx.now,
    voidReason: why,
  };
  ctx.db.put("payments", voided);
  const { ledger } = invoiceWithLedger(ctx, payment.invoiceId);
  ctx.audit({
    action: "Voided payment",
    target: `${payment.number} on ${invoice.number}`,
    before: `${dollars(payment.amount)}, ${payment.status}`,
    after: `voided: ${why}; balance ${dollars(ledger.balance)}`,
  });
  return voided;
}

/** Marks an invoice as sent to the customer, for its timeline (spec B2 "Mark as sent"). */
export async function markInvoiceSent(ctx: ActionContext, invoiceId: string) {
  await ctx.assertCan(["sales.invoice.edit"]);
  const { invoice, ledger } = invoiceWithLedger(ctx, invoiceId);
  if (ledger.state === "void") throw new DemoRuleError(`Invoice ${invoice.number} is void.`);
  if (invoice.sentAt) throw new DemoRuleError(`Invoice ${invoice.number} was already sent.`);
  const sent = { ...invoice, sentAt: ctx.today, sentBy: ctx.actor.id };
  ctx.db.put("invoices", sent);
  ctx.audit({
    category: "data",
    action: "Marked invoice sent",
    target: invoice.number,
    before: null,
    after: ctx.today,
  });
  return sent;
}

/**
 * Voids an invoice (spec Appendix A): only while no payment is confirmed; a reason is required.
 * Pending payments on it are voided with it, so nothing waits on a cancelled invoice.
 */
export async function voidInvoice(ctx: ActionContext, invoiceId: string, reason: string) {
  await ctx.assertCan(["sales.invoice.void"]);
  const { invoice, ledger } = invoiceWithLedger(ctx, invoiceId);
  if (ledger.state === "void") throw new DemoRuleError(`Invoice ${invoice.number} is already void.`);
  if (ledger.locked) {
    throw new DemoRuleError(
      `Invoice ${invoice.number} has confirmed payments. Void them first, or issue a credit note.`,
    );
  }
  const why = needReason(reason, "the invoice is voided");
  for (const p of ctx.db.list("payments").filter((p) => p.invoiceId === invoiceId && p.status === "pending")) {
    ctx.db.put("payments", { ...p, status: "voided", voidedBy: ctx.actor.name, voidedAt: ctx.now, voidReason: why });
  }
  const voided = { ...invoice, voidedAt: ctx.today, voidReason: why };
  ctx.db.put("invoices", voided);
  ctx.audit({
    category: "data",
    action: "Voided invoice",
    target: invoice.number,
    before: `${dollars(invoice.total)}, ${ledger.state}`,
    after: `void: ${why}`,
  });
  return voided;
}

/** Adds an adjustment to an invoice and audits it. */
function adjust(ctx: ActionContext, adjustment: Omit<InvoiceAdjustment, "id" | "byName" | "at">, action: string) {
  const { invoice, ledger } = invoiceWithLedger(ctx, adjustment.invoiceId);
  const saved: InvoiceAdjustment = { ...adjustment, id: ctx.newId("adj"), byName: ctx.actor.name, at: ctx.now };
  ctx.db.put("invoiceAdjustments", saved);
  ctx.audit({
    action,
    target: invoice.number,
    before: `balance ${dollars(ledger.balance)}`,
    after: `${dollars(saved.amount)}: ${saved.reason}`,
  });
  return saved;
}

/**
 * Writes off what is left on an invoice (spec Appendix A): Owner and Accountant by default, a
 * reason, and only up to the company's write-off maximum. The invoice then reads Paid.
 */
export async function writeOffBalance(ctx: ActionContext, invoiceId: string, reason: string) {
  await ctx.assertCan(["sales.payment.write_off"]);
  const { invoice, ledger } = invoiceWithLedger(ctx, invoiceId);
  if (dec(ledger.balance).lte(0)) throw new DemoRuleError(`Invoice ${invoice.number} has nothing left to write off.`);
  const max = ctx.db.settings.payments.writeOffMax.trim();
  if (max && dec(ledger.balance).gt(max)) {
    throw new DemoRuleError(
      `Only balances up to ${dollars(max)} can be written off; this one is ${dollars(ledger.balance)}.`,
    );
  }
  const why = needReason(reason, "the balance is written off");
  return adjust(
    ctx,
    { invoiceId, customerId: invoice.customerId, kind: "write_off", amount: ledger.balance, reason: why },
    "Wrote off balance",
  );
}

/**
 * Applies the customer's credit (overpayments and credit notes) to an invoice (spec Appendix A
 * "Apply customer credit"): as much as the balance takes, never more than the credit.
 */
export async function applyCredit(ctx: ActionContext, invoiceId: string) {
  await ctx.assertCan(["sales.payment.apply_credit"]);
  const { invoice, ledger } = invoiceWithLedger(ctx, invoiceId);
  const credit = creditNow(ctx, invoice.customerId);
  if (credit.lte(0)) throw new DemoRuleError("This customer has no credit to apply.");
  if (dec(ledger.balance).lte(0)) throw new DemoRuleError(`Invoice ${invoice.number} has nothing left to pay.`);
  const amount = moneyString(minDec(credit, dec(ledger.balance)));
  return adjust(
    ctx,
    { invoiceId, customerId: invoice.customerId, kind: "credit_applied", amount, reason: "Customer credit applied" },
    "Applied customer credit",
  );
}

/**
 * Refunds customer credit (spec Appendix A "Refund"): an outgoing payment with method, reference
 * and mandatory proof, never more than the customer's credit. It lowers the credit.
 */
export async function refundCredit(ctx: ActionContext, input: RefundInput, files: readonly File[]): Promise<Refund> {
  await ctx.assertCan(["sales.payment.refund"]);
  const customer = ctx.db.get("customers", input.customerId);
  if (!customer) throw new DemoRuleError("This customer no longer exists.");
  const credit = moneyString(creditNow(ctx, input.customerId));
  const problem = Object.values(validateRefund(input, { credit, today: ctx.today, formatMoney: dollars }))[0];
  if (problem) throw new DemoRuleError(problem);
  const id = ctx.newId("ref");
  const metas = await describeFiles(ctx, id, files);
  await storeFiles(ctx, metas, files);
  const prefix = ctx.db.settings.payments.refundPrefix;
  const refund: Refund = {
    id,
    number: nextPaymentNumber(
      prefix,
      ctx.db.list("refunds").map((r) => r.number),
    ),
    customerId: input.customerId,
    amount: moneyString(input.amount),
    date: input.date,
    method: input.method,
    reference: input.reference.trim(),
    note: input.note.trim(),
    files: metas,
    status: "completed",
    byName: ctx.actor.name,
    at: ctx.now,
  };
  ctx.db.put("refunds", refund);
  ctx.audit({
    action: "Refunded customer credit",
    target: `${refund.number} to ${customer.name}`,
    before: `credit ${dollars(credit)}`,
    after: `${dollars(refund.amount)} by ${refund.method} ${refund.reference}`.trim(),
  });
  return refund;
}
