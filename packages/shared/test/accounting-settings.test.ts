import { describe, expect, it } from "vitest";
import {
  accountingSettingsProblem,
  cashAccountFor,
  DEFAULT_ACCOUNTING_SETTINGS,
  isCashAccount,
  paymentPosting,
  type AccountingSettings,
  type Payment,
} from "../src";

const OPERATING = "bank:0190a1b2-0000-7000-8000-000000000001" as const;
const MERCHANT = "bank:0190a1b2-0000-7000-8000-000000000002" as const;

function withBanks(bankAccounts: AccountingSettings["bankAccounts"]): AccountingSettings {
  return { ...DEFAULT_ACCOUNTING_SETTINGS, bankAccounts };
}

describe("accounting settings (ADR 0040, owner decision 2026-11-14)", () => {
  it("defaults to average cost, accrual sales tax and one Cash and Bank account", () => {
    expect(DEFAULT_ACCOUNTING_SETTINGS).toEqual({
      costingMethod: "average",
      salesTaxBasis: "accrual",
      bankAccounts: [],
    });
    expect(cashAccountFor(DEFAULT_ACCOUNTING_SETTINGS, "card")).toBe("cash");
  });

  it("sends each method to its bank account, and the rest to Cash and Bank", () => {
    const value = withBanks([
      { key: OPERATING, name: "Operating", methods: ["check", "ach"] },
      { key: MERCHANT, name: "Merchant", methods: ["card"] },
    ]);
    expect(cashAccountFor(value, "ach")).toBe(OPERATING);
    expect(cashAccountFor(value, "card")).toBe(MERCHANT);
    expect(cashAccountFor(value, "cash")).toBe("cash");
    // A bank account not saved yet has no ledger account, so it takes nothing.
    expect(cashAccountFor(withBanks([{ name: "New", methods: ["cash"] }]), "cash")).toBe("cash");
  });

  it("refuses a method on two bank accounts and two accounts with one name", () => {
    expect(
      accountingSettingsProblem(
        withBanks([
          { key: OPERATING, name: "Operating", methods: ["check"] },
          { key: MERCHANT, name: "Merchant", methods: ["check"] },
        ]),
      ),
    ).toMatch(/only one bank account/);
    expect(
      accountingSettingsProblem(
        withBanks([
          { name: "Operating", methods: [] },
          { name: " operating ", methods: [] },
        ]),
      ),
    ).toMatch(/Two bank accounts/);
    expect(
      accountingSettingsProblem(
        withBanks([
          { key: OPERATING, name: "A", methods: [] },
          { key: OPERATING, name: "B", methods: [] },
        ]),
      ),
    ).toMatch(/listed twice/);
    expect(accountingSettingsProblem(withBanks([{ key: OPERATING, name: "Operating", methods: ["ach"] }]))).toBeNull();
  });

  it("knows which accounts hold cash", () => {
    expect(isCashAccount("cash")).toBe(true);
    expect(isCashAccount(OPERATING)).toBe(true);
    expect(isCashAccount("accounts_receivable")).toBe(false);
    expect(isCashAccount(null)).toBe(false);
  });

  it("posts a payment's cash to the bank account it is given", () => {
    const payment = {
      id: "p",
      number: "PAY-1",
      invoiceId: "i",
      customerId: "c",
      amount: "25.00",
      date: "2026-11-14",
      kind: "payment",
      method: "card",
    } as Payment;
    const draft = paymentPosting(payment, "INV-1", "25.00", MERCHANT);
    expect(draft.lines[0]).toMatchObject({ account: MERCHANT, debit: "25.00" });
  });
});
