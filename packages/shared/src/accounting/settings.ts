import type { PaymentMethod } from "../types";
import type { AccountKey } from "./accounts";

/** The key of a bank account the company adds: `bank:` and the account's id. */
export type BankAccountKey = `bank:${string}`;

/** Any account a posting line may name: a default account or one of the company's bank accounts. */
export type LedgerKey = AccountKey | BankAccountKey;

/** The payment methods, in the order the settings screen lists them. */
export const PAYMENT_METHODS = ["cash", "check", "ach", "card", "other"] as const satisfies readonly PaymentMethod[];

/**
 * One bank account in the ledger (owner decision 2026-11-14: cash split by bank account). Money
 * received or paid by one of its methods posts to it. Only a name is kept, never an account number
 * (CLAUDE.md rule 14).
 */
export interface BankAccountSetting {
  /** Set by the server when the account is added; absent on a new one. */
  key?: BankAccountKey;
  name: string;
  methods: PaymentMethod[];
}

/**
 * How the company keeps its books (ADR 0040). Until the client's accountant answers, the defaults
 * are the owner's (2026-11-14) and each is a per-company setting:
 * - `costingMethod`: average cost for stock and cost of goods; the only method so far (P12 part 3).
 * - `salesTaxBasis`: when sales tax is due to the state. The ledger always posts tax when invoiced
 *   (accrual); on the cash basis the sales tax report counts tax as due when the customer pays.
 * - `bankAccounts`: each one is its own ledger account. A method no bank account claims posts to
 *   the default Cash and Bank account.
 */
export interface AccountingSettings {
  costingMethod: "average";
  salesTaxBasis: "accrual" | "cash";
  bankAccounts: BankAccountSetting[];
}

/** What a company has before anyone saves Settings → Accounting. */
export const DEFAULT_ACCOUNTING_SETTINGS: AccountingSettings = {
  costingMethod: "average",
  salesTaxBasis: "accrual",
  bankAccounts: [],
};

/**
 * Why the settings can't be saved, or null: every bank account has its own name, and a payment
 * method goes to at most one bank account, so a payment's account is never ambiguous.
 */
export function accountingSettingsProblem(value: AccountingSettings): string | null {
  const names = new Set<string>();
  const methods = new Set<PaymentMethod>();
  const keys = new Set<string>();
  for (const bank of value.bankAccounts) {
    const name = bank.name.trim().toLowerCase();
    if (names.has(name)) return `Two bank accounts are named ${bank.name.trim()}.`;
    // Only a name is kept, never an account number (CLAUDE.md rule 14; PR #19 review).
    // Separators are dropped first, so 1234-5678-90 or 1234 5678 is caught too.
    if (/\d{6,}/.test(bank.name.replace(/[\s.-]/g, ""))) return "Name the bank account without its account number.";
    names.add(name);
    if (bank.key) {
      if (keys.has(bank.key)) return "A bank account is listed twice.";
      keys.add(bank.key);
    }
    for (const method of bank.methods) {
      if (methods.has(method)) return `Payments by ${method} can go to only one bank account.`;
      methods.add(method);
    }
  }
  return null;
}

/** The account money paid or received by a method posts to: its bank account, else Cash and Bank. */
export function cashAccountFor(value: AccountingSettings, method: PaymentMethod): LedgerKey {
  return value.bankAccounts.find((bank) => bank.key && bank.methods.includes(method))?.key ?? "cash";
}

/** Whether a ledger key is a cash account: the default Cash and Bank or a company bank account. */
export function isCashAccount(key: string | null): key is LedgerKey {
  return key === "cash" || (key?.startsWith("bank:") ?? false);
}
