import { dec, moneyString, type AccountType, type TrialBalance, type TrialBalanceRow } from "@workspace/shared";
import { toCsv } from "@/components/data-table/csv";

/** The account kinds in chart-of-accounts order, with the heading each group shows. */
export const ACCOUNT_GROUPS: readonly { type: AccountType; label: string }[] = [
  { type: "asset", label: "Assets" },
  { type: "liability", label: "Liabilities" },
  { type: "equity", label: "Equity" },
  { type: "revenue", label: "Revenue" },
  { type: "expense", label: "Expenses" },
];

/** One kind of account and its rows, as the table groups them. */
export interface TrialBalanceGroup {
  type: AccountType;
  label: string;
  rows: TrialBalanceRow[];
}

/** Whether nothing has posted to an account (through the day asked for). */
export function isEmptyAccount(row: TrialBalanceRow): boolean {
  return dec(row.debit).isZero() && dec(row.credit).isZero();
}

/**
 * The rows grouped by kind, in code order within each group (the API sends them by code). Empty
 * accounts are left out unless asked for, and a group with no rows is left out.
 */
export function trialBalanceGroups(tb: TrialBalance, showEmpty: boolean): TrialBalanceGroup[] {
  return ACCOUNT_GROUPS.map(({ type, label }) => ({
    type,
    label,
    rows: tb.rows.filter((row) => row.type === type && (showEmpty || !isEmptyAccount(row))),
  })).filter((group) => group.rows.length > 0);
}

/**
 * Which side an account's balance sits on, and how much (ADR 0039: balance is debits less credits).
 * A trial balance prints a balance as a positive amount on its side; zero sits on neither.
 */
export function balanceSide(balance: string): { side: "Dr" | "Cr" | null; amount: string } {
  const value = dec(balance);
  if (value.isZero()) return { side: null, amount: moneyString(value) };
  return { side: value.gt(0) ? "Dr" : "Cr", amount: moneyString(value.abs()) };
}

/** How far debits and credits are apart: zero when the books balance. */
export function outOfBalanceBy(tb: TrialBalance): string {
  return moneyString(dec(tb.debit).minus(tb.credit).abs());
}

interface CsvLine {
  code: string;
  account: string;
  type: string;
  debit: string;
  credit: string;
  balance: string;
}

/**
 * The CSV of every account the person sees on screen, then the totals, with raw decimal values (spec
 * "Exports": values are raw, not formatted). The balance keeps its sign, debits less credits.
 */
export function trialBalanceCsv(tb: TrialBalance, showEmpty: boolean): string {
  const lines: CsvLine[] = trialBalanceGroups(tb, showEmpty).flatMap((group) =>
    group.rows.map((row) => ({
      code: row.code,
      account: row.name,
      type: group.label,
      debit: row.debit,
      credit: row.credit,
      balance: row.balance,
    })),
  );
  lines.push({
    code: "",
    account: "Total",
    type: "",
    debit: tb.debit,
    credit: tb.credit,
    balance: moneyString(dec(tb.debit).minus(tb.credit)),
  });
  const column = (id: keyof CsvLine, header: string) => ({ id, header, value: (line: CsvLine) => line[id] });
  return toCsv(lines, [
    column("code", "Code"),
    column("account", "Account"),
    column("type", "Type"),
    column("debit", "Debits"),
    column("credit", "Credits"),
    column("balance", "Balance"),
  ]);
}
