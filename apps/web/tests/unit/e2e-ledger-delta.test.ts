import { describe, expect, it } from "vitest";
import {
  CASH,
  ledgerDelta,
  ledgerMismatches,
  movedBy,
  type TrialBalance,
  type TrialBalanceRow,
} from "../e2e-api/flows/ledger";

/** A trial balance row with the given totals; the balance is left for the helpers to ignore. */
function row(key: string | null, code: string, name: string, debit: string, credit: string): TrialBalanceRow {
  return { key, code, name, type: "asset", debit, credit, balance: "0.00" };
}

/** A trial balance over the given rows, which the helpers read without checking its totals. */
function tb(rows: TrialBalanceRow[]): TrialBalance {
  return { through: null, rows, debit: "0.00", credit: "0.00", balanced: true };
}

const BEFORE = tb([
  row("cash", "1000", "Cash and Bank", "500.00", "0.00"),
  row("accounts_receivable", "1100", "Accounts Receivable", "1200.00", "200.00"),
  row("sales", "4000", "Sales", "0.00", "1000.00"),
  row(null, "4900", "Other income (added by the company)", "0.00", "0.00"),
]);

// The flows' ledger rule (session log 2026-11-16-0200, decision 4): each account moves by exactly
// the expected amount, keyed by its unique code; cash is whichever one cash account moved; the rest
// stay put.
describe("e2e flows: the ledger delta between two trial balances", () => {
  it("finds no move between equal trial balances, and expects none", () => {
    const same = tb(BEFORE.rows.map((r) => ({ ...r })));
    expect(ledgerDelta(BEFORE, same)).toEqual({});
    expect(ledgerMismatches(BEFORE, same, {})).toEqual([]);
    expect(ledgerMismatches(BEFORE, same, { sales_tax_payable: "0.00" })).toEqual([]);
    expect(movedBy(BEFORE, same, "sales")).toBe("0.00");
  });

  it("reads debits less credits, so an invoice is AR up and Sales down, and names a wrong or unexpected move", () => {
    const after = tb([
      row("cash", "1000", "Cash and Bank", "500.00", "0.00"),
      row("accounts_receivable", "1100", "Accounts Receivable", "1307.50", "200.00"),
      row("sales", "4000", "Sales", "0.00", "1100.00"),
      row(null, "4900", "Other income (added by the company)", "0.00", "7.50"),
    ]);
    expect(ledgerDelta(BEFORE, after)).toEqual({ "1100": "107.50", "4000": "-100.00", "4900": "-7.50" });
    expect(movedBy(BEFORE, after, "accounts_receivable")).toBe("107.50");
    expect(ledgerMismatches(BEFORE, after, { accounts_receivable: "107.50", sales: "-100.00" })).toEqual([
      "4900 Other income (added by the company) moved by -7.50, expected 0.00",
    ]);
    expect(ledgerMismatches(BEFORE, after, { accounts_receivable: "100.00", sales: "-100.00" })).toEqual([
      "1100 Accounts Receivable moved by 107.50, expected 100.00",
      "4900 Other income (added by the company) moved by -7.50, expected 0.00",
    ]);
  });

  it("counts an account that exists only after as moved from zero, as on a fresh database before its first posting", () => {
    const after = tb([
      row("cash", "1000", "Cash and Bank", "500.00", "0.00"),
      row("accounts_receivable", "1100", "Accounts Receivable", "1200.00", "200.00"),
      row("sales", "4000", "Sales", "0.00", "1000.00"),
      row(null, "4900", "Other income (added by the company)", "0.00", "0.00"),
      row("cost_of_goods_sold", "5000", "Cost of Goods Sold", "42.40", "0.00"),
      row("inventory", "1200", "Inventory", "0.00", "42.40"),
    ]);
    expect(ledgerDelta(tb([]), tb([]))).toEqual({});
    expect(ledgerDelta(BEFORE, after)).toEqual({ "5000": "42.40", "1200": "-42.40" });
    expect(movedBy(BEFORE, after, "cost_of_goods_sold")).toBe("42.40");
    expect(ledgerMismatches(BEFORE, after, { cost_of_goods_sold: "42.40", inventory: "-42.40" })).toEqual([]);
    expect(() => ledgerMismatches(BEFORE, BEFORE, { retainage_receivable: "40.00" })).toThrow(/retainage_receivable/);
  });

  it("matches CASH to the one cash account that moved, a bank account as well as Cash and Bank", () => {
    const withBank = tb([
      ...BEFORE.rows,
      row("bank:0195f3a2-7b1c-7d4e-8f00-000000000b01", "1010", "Operating account", "0.00", "0.00"),
    ]);
    const paid = tb([
      row("cash", "1000", "Cash and Bank", "500.00", "0.00"),
      row("accounts_receivable", "1100", "Accounts Receivable", "1200.00", "450.00"),
      row("sales", "4000", "Sales", "0.00", "1000.00"),
      row(null, "4900", "Other income (added by the company)", "0.00", "0.00"),
      row("bank:0195f3a2-7b1c-7d4e-8f00-000000000b01", "1010", "Operating account", "250.00", "0.00"),
    ]);
    expect(ledgerMismatches(withBank, paid, { [CASH]: "250.00", accounts_receivable: "-250.00" })).toEqual([]);
    expect(ledgerMismatches(withBank, paid, { [CASH]: "200.00", accounts_receivable: "-250.00" })).toEqual([
      "1010 Operating account moved by 250.00, expected 200.00 (cash)",
    ]);
    const both = tb(paid.rows.map((r) => (r.key === "cash" ? { ...r, debit: "750.00" } : r)));
    expect(ledgerMismatches(withBank, both, { [CASH]: "250.00", accounts_receivable: "-250.00" })).toEqual([
      "exactly one cash account should move by 250.00; 2 moved",
    ]);
    expect(ledgerMismatches(withBank, withBank, { [CASH]: "250.00" })).toEqual([
      "exactly one cash account should move by 250.00; 0 moved",
    ]);
  });
});
