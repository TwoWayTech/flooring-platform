import { describe, expect, it } from "vitest";
import { EXPENSE_ACCOUNTS, EXPENSE_CATEGORY_LABELS, expensePosting, postingProblem, reversedLines } from "../src";

const base = {
  id: "exp-1",
  number: "EXP-210",
  date: "2026-11-03",
  category: "rent" as const,
  locationId: "loc-denver",
  amount: "1000.00",
  tax: "81.00",
  settlement: "paid" as const,
};

/** Expense postings (finance-expenses.md rule 16; ADR 0023, ADR 0040). */
describe("expense postings", () => {
  it("debits the category for the full cost at its location and credits the method's bank", () => {
    const draft = expensePosting(base, "bank:0193a1b2-0000-7000-8000-000000000001");
    expect(draft).toMatchObject({ event: "expense.confirmed", sourceType: "expense", date: "2026-11-03" });
    expect(draft.lines).toEqual([
      { account: "rent", debit: "1081.00", credit: "0.00", locationId: "loc-denver", customerId: null },
      {
        account: "bank:0193a1b2-0000-7000-8000-000000000001",
        debit: "0.00",
        credit: "1081.00",
        locationId: null,
        customerId: null,
      },
    ]);
    expect(postingProblem(draft.lines)).toBeNull();
  });

  it("credits Accounts Payable when it is paid later, and a sales tax payment pays down the tax", () => {
    expect(expensePosting({ ...base, settlement: "on_account" }, "cash").lines[1]!.account).toBe("accounts_payable");
    const tax = expensePosting({ ...base, category: "sales_tax_payment", locationId: null, tax: "0.00" }, "cash");
    expect(tax.lines.map((line) => [line.account, line.debit, line.credit])).toEqual([
      ["sales_tax_payable", "1000.00", "0.00"],
      ["cash", "0.00", "1000.00"],
    ]);
  });

  it("maps every category to an account, and a void nets to zero", () => {
    for (const category of Object.keys(EXPENSE_CATEGORY_LABELS) as (keyof typeof EXPENSE_CATEGORY_LABELS)[]) {
      expect(EXPENSE_ACCOUNTS[category]).toBeTruthy();
    }
    const lines = expensePosting(base, "cash").lines;
    expect(postingProblem([...lines, ...reversedLines(lines)])).toBeNull();
  });
});
