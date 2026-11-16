import { dec, isCashAccount, moneyString, type AccountKey, type AccountType, type Dec } from "@workspace/shared";

/** One account's totals, as GET /ledger/trial-balance answers them (apps/api `TrialBalanceRow`). */
export interface TrialBalanceRow {
  /** The posting key (`cash`, `bank:<id>`, `sales`, ...); null for an account the company added. */
  key: string | null;
  code: string;
  name: string;
  type: AccountType;
  debit: string;
  credit: string;
  /** Debits less credits. */
  balance: string;
}

/**
 * GET /ledger/trial-balance's answer (apps/api `TrialBalance`). The web client has no screen or
 * method for it yet (STATUS "Later"), so the flows read it through `/api-proxy`.
 */
export interface TrialBalance {
  through: string | null;
  rows: TrialBalanceRow[];
  debit: string;
  credit: string;
  balanced: boolean;
}

/**
 * Stands for "the one cash account the posting used": the default Cash and Bank, or a company bank
 * account (`bank:<id>`) when a payment method is routed to one (accounting/settings.ts, `cashAccountFor`).
 */
export const CASH = "CASH";

/**
 * How a step should move the books: account key (or `CASH`) to the change in debits less credits,
 * as a decimal string or Decimal (never a float, CLAUDE.md rule 6). A zero amount is the same as
 * leaving the account out, so a tax of 0.00 can be passed as it is.
 */
export type ExpectedMoves = Partial<Record<AccountKey | typeof CASH, Dec | string>>;

/** Expected moves resolved against a trial balance: by account code, plus cash still to be matched. */
export interface ResolvedMoves {
  byCode: Record<string, string>;
  /** The cash amount, and the codes of every cash account it may land on; null when no cash moves. */
  cash: { amount: string; codes: string[] } | null;
}

/** Each account's net (debits less credits) by its code, which is unique; the key can be null. */
export function netByCode(tb: TrialBalance): Map<string, Dec> {
  return new Map(tb.rows.map((row) => [row.code, dec(row.debit).minus(row.credit)]));
}

/**
 * The accounts that moved between two trial balances: code to the change in debits less credits, as
 * a money string. An account missing on one side counts as zero there: on a fresh database the
 * accounts appear only with the first posting (ledger.service.ts `trialBalance`).
 */
export function ledgerDelta(before: TrialBalance, after: TrialBalance): Record<string, string> {
  const was = netByCode(before);
  const now = netByCode(after);
  const delta: Record<string, string> = {};
  for (const code of new Set([...was.keys(), ...now.keys()])) {
    const moved = (now.get(code) ?? dec(0)).minus(was.get(code) ?? dec(0));
    if (!moved.isZero()) delta[code] = moneyString(moved);
  }
  return delta;
}

/** How far one account, named by key, moved between two trial balances ("0.00" when it did not). */
export function movedBy(before: TrialBalance, after: TrialBalance, key: AccountKey): string {
  const code = (after.rows.find((row) => row.key === key) ?? before.rows.find((row) => row.key === key))?.code;
  return code ? (ledgerDelta(before, after)[code] ?? "0.00") : "0.00";
}

/**
 * Maps expected moves from account keys to codes through `after`'s rows, and `CASH` to every cash
 * account there. Zero amounts are dropped. Throws when a non-zero move names an account `after`
 * lacks, since the posting that moved it would have made it.
 */
export function resolveExpected(after: TrialBalance, expected: ExpectedMoves): ResolvedMoves {
  const resolved: ResolvedMoves = { byCode: {}, cash: null };
  for (const [key, amount] of Object.entries(expected)) {
    if (amount === undefined || dec(amount).isZero()) continue;
    if (key === CASH) {
      const codes = after.rows.filter((row) => isCashAccount(row.key)).map((row) => row.code);
      resolved.cash = { amount: moneyString(amount), codes };
      continue;
    }
    const row = after.rows.find((r) => r.key === key);
    if (!row) throw new Error(`The trial balance has no "${key}" account, which was expected to move by ${amount}.`);
    resolved.byCode[row.code] = moneyString(amount);
  }
  return resolved;
}

/**
 * Every way the books moved other than expected, in words, empty when they moved exactly as
 * expected: each expected account by exactly its amount, exactly one cash account by the `CASH`
 * amount, and every other account not at all (the flows' ledger rule, session log 2026-11-16-0200,
 * decision 4).
 */
export function ledgerMismatches(before: TrialBalance, after: TrialBalance, expected: ExpectedMoves): string[] {
  const delta = ledgerDelta(before, after);
  const { byCode, cash } = resolveExpected(after, expected);
  const names = new Map([...before.rows, ...after.rows].map((row) => [row.code, `${row.code} ${row.name}`]));
  const problems: string[] = [];
  const checked = new Set<string>();
  if (cash) {
    const moved = cash.codes.filter((code) => code in delta);
    moved.forEach((code) => checked.add(code));
    const [only] = moved;
    if (moved.length !== 1 || only === undefined)
      problems.push(`exactly one cash account should move by ${cash.amount}; ${moved.length} moved`);
    else if (!dec(delta[only] ?? "0").eq(cash.amount))
      problems.push(`${names.get(only)} moved by ${delta[only]}, expected ${cash.amount} (cash)`);
  }
  for (const code of new Set([...Object.keys(delta), ...Object.keys(byCode)])) {
    if (checked.has(code)) continue;
    const actual = delta[code] ?? "0.00";
    const wanted = byCode[code] ?? "0.00";
    if (!dec(actual).eq(wanted)) problems.push(`${names.get(code) ?? code} moved by ${actual}, expected ${wanted}`);
  }
  return problems;
}
