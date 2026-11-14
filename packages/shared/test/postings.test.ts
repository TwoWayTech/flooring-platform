import { describe, expect, it } from "vitest";
import {
  adjustmentPosting,
  creditNotePosting,
  dec,
  invoicePosting,
  paymentPosting,
  postingProblem,
  refundPosting,
  reversedLines,
  sum,
  type Invoice,
  type Payment,
  type PostingLine,
} from "../src";

function invoice(extra: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1",
    number: "INV-1001",
    quoteId: null,
    customerId: "cus-1",
    salesRepId: "rep",
    branchId: "br",
    issuedAt: "2026-11-01",
    dueAt: "2026-11-15",
    createdBy: "rep",
    sentAt: null,
    sentBy: null,
    voidedAt: null,
    voidReason: null,
    depositPct: "0",
    isReturn: false,
    creditForInvoiceId: null,
    refundedAt: null,
    locationId: "wh",
    soldAtLocationId: "showroom",
    jobSite: { street: "", city: "", state: "CO", zip: "" },
    lines: [],
    taxRule: null,
    taxSource: { kind: "none", label: "" },
    taxOverride: null,
    taxExempt: false,
    subtotal: "450.00",
    tax: "39.65",
    total: "489.65",
    cost: "210.00",
    ...extra,
  };
}

function payment(amount: string): Payment {
  return {
    id: "pay-1",
    number: "PAY-0001",
    invoiceId: "inv-1",
    customerId: "cus-1",
    kind: "payment",
    amount,
    date: "2026-11-03",
    method: "check",
    checkNumber: "1",
    cardLast4: "",
    reference: "r",
    note: "",
    files: [],
    status: "confirmed",
    recordedById: "u",
    recordedBy: "",
    recordedAt: "",
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  };
}

const balanceOf = (lines: readonly PostingLine[], account: string) =>
  sum(lines.filter((l) => l.account === account).map((l) => dec(l.debit).minus(l.credit)));

/** Posting rules for sales (ADR 0039; blueprint pages 24, 25 and 48). */
describe("sales postings", () => {
  it("posts an invoice to receivables, sales at the selling location, and sales tax", () => {
    const draft = invoicePosting(invoice());
    expect(postingProblem(draft.lines)).toBeNull();
    expect(draft.lines).toEqual([
      expect.objectContaining({ account: "accounts_receivable", debit: "489.65", customerId: "cus-1" }),
      expect.objectContaining({ account: "sales", credit: "450.00", locationId: "showroom" }),
      expect.objectContaining({ account: "sales_tax_payable", credit: "39.65" }),
    ]);
    expect(() => invoicePosting(invoice({ retainageWithheld: "10.00" }))).toThrow();
  });

  it("sends the part of a payment above the balance to customer credit", () => {
    const draft = paymentPosting(payment("500.00"), "INV-1001", "489.65", "cash");
    expect(postingProblem(draft.lines)).toBeNull();
    expect(balanceOf(draft.lines, "cash").toString()).toBe("500");
    expect(balanceOf(draft.lines, "accounts_receivable").toString()).toBe("-489.65");
    expect(balanceOf(draft.lines, "customer_credit").toString()).toBe("-10.35");
    const exact = paymentPosting(payment("100.00"), "INV-1001", "489.65", "cash");
    expect(exact.lines).toHaveLength(2);
  });

  it("posts credit notes, write-offs, applied credit and refunds in balance", () => {
    const note = creditNotePosting(
      invoice({ id: "cr", number: "CR-5001", isReturn: true, subtotal: "100.00", tax: "8.81", total: "108.81" }),
    );
    expect(postingProblem(note.lines)).toBeNull();
    expect(balanceOf(note.lines, "customer_credit").toString()).toBe("-108.81");
    const adjustment = {
      id: "a",
      invoiceId: "inv-1",
      customerId: "cus-1",
      amount: "0.05",
      reason: "r",
      byName: "",
      at: "",
    };
    const writeOff = adjustmentPosting({ ...adjustment, kind: "write_off" }, "INV-1001", "2026-11-04");
    expect(writeOff.lines.map((l) => l.account)).toEqual(["bad_debt", "accounts_receivable"]);
    const applied = adjustmentPosting({ ...adjustment, kind: "credit_applied" }, "INV-1001", "2026-11-04");
    expect(applied.lines.map((l) => l.account)).toEqual(["customer_credit", "accounts_receivable"]);
    const refund = refundPosting(
      {
        id: "rf",
        number: "RF-0001",
        customerId: "cus-1",
        amount: "50.00",
        date: "2026-11-05",
        method: "cash",
        reference: "",
        note: "",
        files: [],
        status: "completed",
        byName: "",
        at: "",
      },
      "bank:0190a1b2-0000-7000-8000-000000000001",
    );
    expect(postingProblem(refund.lines)).toBeNull();
  });

  it("refuses unbalanced, one-line, two-sided and negative entries", () => {
    const line = { debit: "1.00", credit: "0.00" };
    expect(postingProblem([line])).not.toBeNull();
    expect(postingProblem([line, { debit: "0.00", credit: "0.99" }])).not.toBeNull();
    expect(postingProblem([{ debit: "1.00", credit: "1.00" }, line])).not.toBeNull();
    expect(
      postingProblem([
        { debit: "-1.00", credit: "0.00" },
        { debit: "0.00", credit: "-1.00" },
      ]),
    ).not.toBeNull();
  });

  it("keeps the trial balance at zero through random sequences of sales events and reversals", () => {
    // A small seeded generator, so a failure always reproduces (blueprint page 48: trial balance zero).
    let seed = 20261114;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const cents = (max: number) => (Math.floor(next() * max * 100) / 100).toFixed(2);
    for (let run = 0; run < 200; run += 1) {
      const posted: PostingLine[] = [];
      let balance = dec(0);
      const subtotal = cents(5000);
      const tax = cents(400);
      const issued = invoicePosting(invoice({ subtotal, tax, total: dec(subtotal).plus(tax).toFixed(2) }));
      posted.push(...issued.lines);
      balance = dec(subtotal).plus(tax);
      for (let step = 0; step < 6; step += 1) {
        const roll = next();
        if (roll < 0.4) {
          const pay = paymentPosting(payment(cents(3000)), "INV-1001", balance.toFixed(2), "cash");
          posted.push(...pay.lines);
          if (next() < 0.3) posted.push(...reversedLines(pay.lines));
          else balance = balance.minus(dec(pay.lines.find((l) => l.account === "accounts_receivable")?.credit ?? "0"));
        } else if (roll < 0.6 && balance.gt(0)) {
          const amount = balance.toFixed(2);
          const adj = { id: "a", invoiceId: "inv-1", customerId: "cus-1", amount, reason: "r", byName: "", at: "" };
          posted.push(
            ...adjustmentPosting(
              { ...adj, kind: next() < 0.5 ? "write_off" : "credit_applied" },
              "INV-1001",
              "2026-11-04",
            ).lines,
          );
          balance = dec(0);
        } else {
          const noteSubtotal = cents(200);
          const noteTax = cents(20);
          const note = invoice({
            isReturn: true,
            subtotal: noteSubtotal,
            tax: noteTax,
            total: dec(noteSubtotal).plus(noteTax).toFixed(2),
          });
          posted.push(...creditNotePosting(note).lines);
        }
      }
      const all = posted.map((line) => dec(line.debit).minus(line.credit));
      expect(sum(all).toFixed(2)).toBe("0.00");
      expect(balanceOf(posted, "accounts_receivable").toFixed(2)).toBe(balance.toFixed(2));
    }
  });
});
