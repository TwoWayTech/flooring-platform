import { describe, expect, it } from "vitest";
import { DEFAULT_ACCOUNTS, openingBalancePosting, postingProblem, type OpeningBalances } from "../src";

const REF = { id: "ob-1", date: "2025-12-09", memo: "Opening balances (seed)" };

const NOTHING: OpeningBalances = {
  cash: "0",
  receivables: [],
  retainageReceivable: [],
  inventory: [],
  payables: "0",
  receivedNotBilled: "0",
  retainagePayable: "0",
  customerCredit: [],
};

describe("the opening-balance entry (ADR 0062)", () => {
  it("adds Opening Balance Equity to the chart, among the equity accounts", () => {
    expect(DEFAULT_ACCOUNTS).toContainEqual({
      key: "opening_balance_equity",
      code: "3900",
      name: "Opening Balance Equity",
      type: "equity",
    });
    expect(new Set(DEFAULT_ACCOUNTS.map((account) => account.code)).size).toBe(DEFAULT_ACCOUNTS.length);
  });

  it("debits each asset, credits each liability and balances on Opening Balance Equity", () => {
    const draft = openingBalancePosting(REF, {
      cash: "50000",
      receivables: [
        { customerId: "c1", amount: "1200.50" },
        { customerId: "c2", amount: "300" },
      ],
      retainageReceivable: [{ customerId: "c1", amount: "1800" }],
      inventory: [{ locationId: "w1", amount: "9000.10" }],
      payables: "4000",
      receivedNotBilled: "500",
      retainagePayable: "370",
      customerCredit: [{ customerId: "c2", amount: "25" }],
    });
    expect(draft).toMatchObject({
      event: "opening_balance.posted",
      sourceType: "opening_balance",
      sourceId: "ob-1",
      sourceNumber: "Opening balances",
      date: "2025-12-09",
      memo: "Opening balances (seed)",
    });
    expect(postingProblem(draft.lines)).toBeNull();
    const line = (account: string) => draft.lines.filter((entry) => entry.account === account);
    expect(line("accounts_receivable")).toEqual([
      { account: "accounts_receivable", debit: "1200.50", credit: "0.00", customerId: "c1", locationId: null },
      { account: "accounts_receivable", debit: "300.00", credit: "0.00", customerId: "c2", locationId: null },
    ]);
    expect(line("inventory")).toEqual([
      { account: "inventory", debit: "9000.10", credit: "0.00", customerId: null, locationId: "w1" },
    ]);
    expect(line("accounts_payable")[0]).toMatchObject({ debit: "0.00", credit: "4000.00" });
    expect(line("received_not_billed")[0]).toMatchObject({ credit: "500.00" });
    expect(line("retainage_payable")[0]).toMatchObject({ credit: "370.00" });
    expect(line("customer_credit")[0]).toMatchObject({ credit: "25.00", customerId: "c2" });
    // Assets 62300.60 less liabilities 4895.00 is the owners' stake.
    expect(line("opening_balance_equity")).toEqual([
      { account: "opening_balance_equity", debit: "0.00", credit: "57405.60", customerId: null, locationId: null },
    ]);
  });

  it("debits Opening Balance Equity when the company owes more than it holds", () => {
    const draft = openingBalancePosting(REF, { ...NOTHING, cash: "100", payables: "250" });
    expect(postingProblem(draft.lines)).toBeNull();
    expect(draft.lines.find((entry) => entry.account === "opening_balance_equity")).toMatchObject({
      debit: "150.00",
      credit: "0.00",
    });
  });

  it("leaves out lines of zero, and posts nothing when there is nothing to open", () => {
    const draft = openingBalancePosting(REF, { ...NOTHING, cash: "10000", receivables: [{ amount: "0" }] });
    expect(draft.lines.map((entry) => entry.account)).toEqual(["cash", "opening_balance_equity"]);
    expect(openingBalancePosting(REF, NOTHING).lines).toEqual([]);
  });

  it("needs no equity line when holdings and debts match", () => {
    const draft = openingBalancePosting(REF, { ...NOTHING, cash: "400", payables: "400" });
    expect(draft.lines.map((entry) => entry.account)).toEqual(["cash", "accounts_payable"]);
  });
});
