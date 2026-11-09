import { describe, expect, it } from "vitest";
import {
  customerCredit,
  detectProofType,
  duplicateReference,
  invoiceActions,
  invoiceLedger,
  ledgerIndex,
  needsApproval,
  nextPaymentNumber,
  proofFilesProblem,
  validatePayment,
  type Invoice,
  type InvoiceAdjustment,
  type Payment,
  type RecordPaymentInput,
} from "../src";

const today = "2026-11-08";
const invoice = (over: Partial<Invoice> = {}): Invoice =>
  ({
    id: "i1",
    customerId: "c1",
    total: "1000.00",
    issuedAt: "2026-10-01",
    dueAt: "2026-10-31",
    isReturn: false,
    voidedAt: null,
    refundedAt: null,
    sentAt: null,
    depositPct: "50",
    ...over,
  }) as Invoice;
let n = 0;
const payment = (amount: string, over: Partial<Payment> = {}): Payment =>
  ({
    id: `p${++n}`,
    number: `PAY-${n}`,
    invoiceId: "i1",
    customerId: "c1",
    kind: "payment",
    amount,
    date: "2026-10-05",
    method: "ach",
    reference: `R${n}`,
    status: "confirmed",
    files: [],
    ...over,
  }) as Payment;
const adjustment = (kind: InvoiceAdjustment["kind"], amount: string): InvoiceAdjustment =>
  ({ id: `a${++n}`, invoiceId: "i1", customerId: "c1", kind, amount, at: "2026-10-20T10:00" }) as InvoiceAdjustment;
const ledger = (payments: Payment[], adjustments: InvoiceAdjustment[] = [], over: Partial<Invoice> = {}) =>
  invoiceLedger(invoice(over), { payments, adjustments }, today);

describe("invoice status and balance from payments (spec Appendix A)", () => {
  it("is open with no confirmed payment, and overdue past its due date", () => {
    expect(ledger([])).toMatchObject({ state: "open", balance: "1000.00", overdue: true, daysOverdue: 8 });
    expect(ledger([], [], { dueAt: "2026-11-30" }).overdue).toBe(false);
  });

  it("is partly paid, overdue at the same time, and Deposit paid once the deposit is covered", () => {
    const l = ledger([payment("500.00")]);
    expect(l).toMatchObject({ state: "partial", balance: "500.00", overdue: true, depositPaid: true, locked: true });
    expect(ledger([payment("200.00")]).depositPaid).toBe(false);
  });

  it("is paid at zero, overpaid above the total with the extra as credit", () => {
    expect(ledger([payment("400.00"), payment("600.00")])).toMatchObject({ state: "paid", balance: "0.00" });
    const over = ledger([payment("1250.00")]);
    expect(over).toMatchObject({ state: "overpaid", balance: "0.00", overpaid: "250.00" });
  });

  it("does not count pending payments until they are confirmed", () => {
    const l = ledger([payment("1000.00", { status: "pending" })]);
    expect(l).toMatchObject({ state: "open", balance: "1000.00", pending: "1000.00", pendingVerification: true });
  });

  it("restores the balance when a payment is voided or rejected", () => {
    const l = ledger([
      payment("600.00"),
      payment("400.00", { status: "voided" }),
      payment("1.00", { status: "rejected" }),
    ]);
    expect(l).toMatchObject({ state: "partial", balance: "400.00" });
  });

  it("closes the balance with a write-off or applied credit", () => {
    expect(ledger([payment("996.00")], [adjustment("write_off", "4.00")])).toMatchObject({
      state: "paid",
      balance: "0.00",
    });
    expect(ledger([payment("700.00")], [adjustment("credit_applied", "300.00")])).toMatchObject({ state: "paid" });
  });

  it("rounds only for display: three payments of $33.33 on $99.99 leave nothing", () => {
    const l = invoiceLedger(
      invoice({ total: "99.99" }),
      { payments: [payment("33.33"), payment("33.33"), payment("33.33")], adjustments: [] },
      today,
    );
    expect(l).toMatchObject({ state: "paid", balance: "0.00", paid: "99.99" });
  });

  it("owes nothing on a void invoice or a credit note", () => {
    expect(ledger([], [], { voidedAt: "2026-10-02T09:00" })).toMatchObject({ state: "void", balance: "0.00" });
    expect(ledger([], [], { isReturn: true })).toMatchObject({ state: "return", balance: "0.00" });
  });

  it("builds customer credit from overpayments and open credit notes, less what was applied", () => {
    const invoices = [invoice(), invoice({ id: "cr", isReturn: true, total: "80.00" })];
    const payments = [payment("1100.00")];
    const ledgers = ledgerIndex(invoices, { payments, adjustments: [] }, today);
    expect(customerCredit("c1", invoices, ledgers, [], []).toString()).toBe("180");
    const applied = [{ ...adjustment("credit_applied", "30.00"), invoiceId: "other" }];
    expect(customerCredit("c1", invoices, ledgers, applied, []).toString()).toBe("150");
  });
});

describe("recording a payment (spec Appendix A)", () => {
  const input: RecordPaymentInput = {
    invoiceId: "i1",
    kind: "payment",
    amount: "250.00",
    date: "2026-11-01",
    method: "check",
    checkNumber: "1042",
    cardLast4: "",
    reference: "CHK-1042",
    note: "",
    extraAsCredit: false,
    allowDuplicateReference: false,
  };
  const context = {
    issuedAt: "2026-10-01",
    today,
    balance: "500.00",
    canCredit: true,
    formatMoney: (v: string) => `$${v}`,
  };

  it("accepts a complete payment", () => {
    expect(validatePayment(input, context)).toEqual({});
  });

  it("refuses zero, a future date, a date before the invoice, a missing reference and a full card number", () => {
    expect(validatePayment({ ...input, amount: "0" }, context).amount).toBeDefined();
    expect(validatePayment({ ...input, date: "2026-11-09" }, context).date).toMatch(/future/);
    expect(validatePayment({ ...input, date: "2026-09-30" }, context).date).toMatch(/before the invoice/);
    expect(validatePayment({ ...input, method: "ach", reference: "" }, context).reference).toBeDefined();
    expect(validatePayment({ ...input, method: "cash", reference: "", checkNumber: "" }, context)).toEqual({});
    expect(
      validatePayment({ ...input, method: "card", cardLast4: "4111111111111111" }, context).cardLast4,
    ).toBeDefined();
  });

  it("names the extra above the balance unless it becomes credit", () => {
    expect(validatePayment({ ...input, amount: "600.00" }, context).amount).toMatch(/\$100\.00 more than the balance/);
    expect(validatePayment({ ...input, amount: "600.00", extraAsCredit: true }, context).amount).toBeUndefined();
  });

  it("finds a reference already used in the company", () => {
    expect(duplicateReference(" chk-1 ", [payment("1", { reference: "CHK-1" })])).toBeDefined();
    expect(duplicateReference("CHK-1", [payment("1", { reference: "CHK-1", status: "voided" })])).toBeUndefined();
  });

  it("needs a proof file of a real type, at most three of 5 MB", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(proofFilesProblem([])).toMatch(/Attach the receipt/);
    expect(proofFilesProblem([{ name: "a.pdf", size: 10, head: pdf }])).toBeNull();
    expect(proofFilesProblem([{ name: "fake.pdf", size: 10, head: new Uint8Array([1, 2, 3, 4]) }])).toMatch(
      /not a PDF/,
    );
    expect(proofFilesProblem([{ name: "big.pdf", size: 6 * 1024 * 1024, head: pdf }])).toMatch(/larger than 5 MB/);
    expect(detectProofType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
  });

  it("asks for approval above the threshold only, and numbers payments PAY-0001", () => {
    const settings = {
      approvalRequired: true,
      approvalThreshold: "1000",
      writeOffMax: "5",
      paymentPrefix: "PAY-",
      refundPrefix: "RF-",
    };
    expect(needsApproval(settings, "999.99")).toBe(false);
    expect(needsApproval(settings, "1000.01")).toBe(true);
    expect(needsApproval({ ...settings, approvalRequired: false }, "5000")).toBe(false);
    expect(nextPaymentNumber("PAY-", ["PAY-0009", "PAY-0010"])).toBe("PAY-0011");
  });

  it("offers only the actions that fit the invoice", () => {
    const open = ledger([]);
    expect(invoiceActions(invoice(), open, { customerCredit: "0", writeOffMax: "5" })).toEqual([
      "deposit",
      "payment",
      "send",
      "void",
    ]);
    const small = ledger([payment("997.00")]);
    expect(invoiceActions(invoice({ sentAt: "x" }), small, { customerCredit: "20", writeOffMax: "5" })).toEqual([
      "payment",
      "credit",
      "write_off",
    ]);
  });
});
