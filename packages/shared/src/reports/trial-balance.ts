import type { AccountKey, AccountType } from "../accounting/accounts";
import type { PostingDraft } from "../accounting/postings";
import type { PermissionKey } from "../permissions/catalog";
import { reportVisibility } from "./visibility";

/** One account's totals in the trial balance (GET /ledger/trial-balance; ADR 0039). */
export interface TrialBalanceRow {
  /** The default account's stable key, or null for an account the company added. */
  key: string | null;
  code: string;
  name: string;
  type: AccountType;
  /** Decimal strings, as all money in JSON (CLAUDE.md rule 6). */
  debit: string;
  credit: string;
  /** Debits less credits. */
  balance: string;
}

/** The trial balance through a day (or all time): every account's totals, and whether they agree. */
export interface TrialBalance {
  through: string | null;
  rows: TrialBalanceRow[];
  debit: string;
  credit: string;
  balanced: boolean;
}

/**
 * The accounts that hold pay (ADR 0047): a pay run's Wages and Accrued Payroll, commission
 * statements' Commissions, and 1099 contractors' Contract Labor. A payroll expense posts to Wages too.
 */
export const PAY_ACCOUNT_KEYS = [
  "wages",
  "accrued_payroll",
  "commissions_expense",
  "contract_labor",
] as const satisfies readonly AccountKey[];

/**
 * The account whose balance shows what subcontracts cost (ADR 0045): what is withheld from a
 * subcontractor is a share of their bill's gross. A line on it needs contract cost sight whichever
 * source posted it, such as the opening-balance entry (ADR 0062).
 */
export const CONTRACT_ACCOUNT_KEYS = ["retainage_payable"] as const satisfies readonly AccountKey[];

/** A journal source type, as the posting builders name them. */
type SourceType = PostingDraft["sourceType"];

/**
 * What each journal source reveals, beyond the product cost every reader needs: pay, contract cost,
 * or nothing more. A Record, so a new source type doesn't compile until someone decides (security
 * review round 3); the sight rule's facts are derived from it.
 */
export const SOURCE_SIGHT: Readonly<Record<SourceType, "pay" | "contract" | "cost">> = {
  invoice: "cost",
  payment: "cost",
  adjustment: "cost",
  refund: "cost",
  // A payroll-category expense posts to Wages, which the pay-account check catches.
  expense: "cost",
  goods_receipt: "cost",
  bill: "cost",
  supplier_payment: "cost",
  stock_adjustment: "cost",
  stock_issue: "cost",
  contract_billing: "contract",
  pay_period: "pay",
  contractor_payment: "pay",
  commission_statement: "pay",
  // Stock at cost and what is owed (ADR 0062); a Retainage Payable line is caught by CONTRACT_ACCOUNT_KEYS.
  opening_balance: "cost",
};

const sourcesOf = (sight: "pay" | "contract"): SourceType[] =>
  (Object.keys(SOURCE_SIGHT) as SourceType[]).filter((source) => SOURCE_SIGHT[source] === sight);

/** The journal sources that post pay, whichever accounts they use. */
export const PAY_SOURCE_TYPES: readonly SourceType[] = sourcesOf("pay");

/** The journal source whose cost is a contract's (ADR 0045): a contract billing or subcontract bill. */
export const CONTRACT_SOURCE_TYPES: readonly SourceType[] = sourcesOf("contract");

/** Facts about the company's journal that decide who may read it. */
export interface TrialBalanceFacts {
  /**
   * An entry from a contract billing, whose Cost of Goods Sold is contract cost (ADR 0055 S4), or a
   * line on a contract account (`CONTRACT_ACCOUNT_KEYS`).
   */
  hasContractPostings: boolean;
  /** An entry from pay, or a line on a pay account (`PAY_ACCOUNT_KEYS`, `PAY_SOURCE_TYPES`). */
  hasPayPostings: boolean;
}

/** Said to a person the trial balance's sight rule refuses (403 `forbidden`). */
export const TRIAL_BALANCE_HIDDEN = "The trial balance shows cost of goods and pay, which your access doesn't include.";

/**
 * Whether a person may read the trial balance (ADR 0055 "Trial balance", owner question 7, taken
 * in the safer direction). The books show every cost and pay figure the reports hide, and hiding a
 * row is not enough: the other side of each posting (Inventory and Accrued Payroll credits, Cash)
 * and the column totals give it back. So the whole trial balance needs everything it reveals:
 * - the reports' margin rule (sales margin and product cost, S17), with contract cost sight while
 *   the journal holds a contract posting (S4);
 * - pay sight, `hr.payroll.view` (S3), while the journal holds pay.
 * Access to the route itself (module, `reports.financial.view`, data scope `all`) is checked first.
 */
export function seesTrialBalance(
  viewer: { permissions: ReadonlySet<PermissionKey> },
  facts: TrialBalanceFacts,
): boolean {
  const sight = reportVisibility(viewer, { hasContractInvoices: facts.hasContractPostings });
  return sight.margin && (sight.payroll || !facts.hasPayPostings);
}
