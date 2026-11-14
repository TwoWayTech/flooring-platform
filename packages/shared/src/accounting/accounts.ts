/** The five kinds of account in a double-entry ledger. */
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

/** A default account: a stable key the postings use, a code, a name the company may rename, and its kind. */
export interface DefaultAccount {
  key: AccountKey;
  code: string;
  name: string;
  type: AccountType;
}

/**
 * The default chart of accounts every company starts with (blueprint pages 24 and 25; ADR 0023;
 * ADR 0039). Postings name accounts by key, so a company can rename an account without breaking
 * them. The client's accountant may rename these and add more (STATUS, accountant questions).
 */
export const DEFAULT_ACCOUNTS = [
  { key: "cash", code: "1000", name: "Cash and Bank", type: "asset" },
  { key: "accounts_receivable", code: "1100", name: "Accounts Receivable", type: "asset" },
  { key: "inventory", code: "1200", name: "Inventory", type: "asset" },
  { key: "accounts_payable", code: "2000", name: "Accounts Payable", type: "liability" },
  { key: "sales_tax_payable", code: "2100", name: "Sales Tax Payable", type: "liability" },
  { key: "customer_credit", code: "2200", name: "Customer Credit", type: "liability" },
  { key: "accrued_payroll", code: "2300", name: "Accrued Payroll", type: "liability" },
  { key: "owner_equity", code: "3000", name: "Owner's Equity", type: "equity" },
  { key: "sales", code: "4000", name: "Sales", type: "revenue" },
  { key: "sales_returns", code: "4100", name: "Sales Returns and Allowances", type: "revenue" },
  { key: "cost_of_goods_sold", code: "5000", name: "Cost of Goods Sold", type: "expense" },
  { key: "wages", code: "6000", name: "Wages", type: "expense" },
  { key: "rent", code: "6100", name: "Rent", type: "expense" },
  { key: "utilities", code: "6200", name: "Utilities", type: "expense" },
  { key: "vehicles", code: "6300", name: "Vehicles", type: "expense" },
  { key: "supplies", code: "6400", name: "Supplies", type: "expense" },
  { key: "repairs_maintenance", code: "6500", name: "Repairs and Maintenance", type: "expense" },
  { key: "insurance", code: "6600", name: "Insurance", type: "expense" },
  { key: "taxes_licences", code: "6700", name: "Taxes and Licences", type: "expense" },
  { key: "marketing", code: "6800", name: "Marketing", type: "expense" },
  { key: "professional_fees", code: "6900", name: "Professional Fees", type: "expense" },
  { key: "bad_debt", code: "6950", name: "Bad Debt", type: "expense" },
  { key: "other_expenses", code: "6990", name: "Other Expenses", type: "expense" },
] as const satisfies readonly { key: string; code: string; name: string; type: AccountType }[];

/** The stable key of a default account. */
export type AccountKey = (typeof DEFAULT_ACCOUNTS)[number]["key"];

/** Whether an account grows with debits (assets and expenses) or with credits (the rest). */
export function debitNormal(type: AccountType): boolean {
  return type === "asset" || type === "expense";
}
