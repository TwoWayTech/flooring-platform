import type { CompanyDb } from "@workspace/db";
import { journalEntries, journalLines } from "@workspace/db/company";
import { dec, sum, type Dec } from "@workspace/shared";
import { eq, sql } from "drizzle-orm";

/** One account's totals in the trial balance, as `GET /ledger/trial-balance` answers it. */
export interface TrialBalanceRow {
  key: string | null;
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
  /** Debits less credits. */
  balance: string;
}

/** The trial balance as the API answers it (ADR 0039). */
export interface TrialBalance {
  through: string | null;
  rows: TrialBalanceRow[];
  debit: string;
  credit: string;
  balanced: boolean;
}

/**
 * An account's balance, debits less credits, by its key (`cash`, `bank:<id>`, `sales`, ...); zero
 * for an account the company has not posted to yet, because accounts are made on first posting
 * (ADR 0039).
 */
export function balanceOf(trial: TrialBalance, key: string): Dec {
  return dec(trial.rows.find((row) => row.key === key)?.balance ?? "0");
}

/**
 * What is wrong with a trial balance (E2, blueprint page 48): it says it is unbalanced, its debit
 * and credit totals differ, its rows don't add up to its totals, or the signed balances don't sum
 * to zero. Empty when it is sound.
 */
export function trialBalanceProblems(trial: TrialBalance): string[] {
  const problems: string[] = [];
  if (!trial.balanced) problems.push("the API says the trial balance is not balanced");
  if (!dec(trial.debit).eq(trial.credit)) problems.push(`debits ${trial.debit} differ from credits ${trial.credit}`);
  const debits = sum(trial.rows.map((row) => row.debit));
  const credits = sum(trial.rows.map((row) => row.credit));
  if (!debits.eq(trial.debit) || !credits.eq(trial.credit)) {
    problems.push(
      `rows add up to ${debits.toFixed(2)} / ${credits.toFixed(2)}, totals say ${trial.debit} / ${trial.credit}`,
    );
  }
  const signed = sum(trial.rows.map((row) => row.balance));
  if (!signed.isZero()) problems.push(`signed balances add up to ${signed.toFixed(2)}, not 0`);
  return problems;
}

/** An entry that breaks E1, with what its lines add up to. */
export interface BadEntry {
  entryId: string;
  event: string;
  sourceNumber: string;
  debit: string;
  credit: string;
  lines: number;
  badLines: number;
}

/**
 * Entries that break E1 (blueprint page 48; CLAUDE.md rule 10), read straight from the company
 * database: debits differ from credits, fewer than two lines, or a line that is negative or not
 * one-sided. The database's own triggers refuse these at commit (packages/db ledger tests), so
 * this reads what actually stands rather than trusting them.
 */
export async function unbalancedEntries(db: CompanyDb): Promise<BadEntry[]> {
  const badLine = sql`(${journalLines.debit} > 0) = (${journalLines.credit} > 0) or ${journalLines.debit} < 0 or ${journalLines.credit} < 0`;
  return db
    .select({
      entryId: journalEntries.id,
      event: journalEntries.event,
      sourceNumber: journalEntries.sourceNumber,
      debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::text`,
      credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::text`,
      lines: sql<number>`count(${journalLines.id})::int`,
      badLines: sql<number>`(count(${journalLines.id}) filter (where ${badLine}))::int`,
    })
    .from(journalEntries)
    .leftJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
    .groupBy(journalEntries.id)
    .having(
      sql`coalesce(sum(${journalLines.debit}), 0) <> coalesce(sum(${journalLines.credit}), 0) or count(${journalLines.id}) < 2 or count(${journalLines.id}) filter (where ${badLine}) > 0`,
    );
}

/** One journal entry's link to the document behind it (E14). */
export interface EntrySource {
  sourceType: string;
  sourceId: string;
  event: string;
  date: string;
  /** The entry this one reverses, for a void or a reopen. */
  reversesId: string | null;
  id: string;
}

/** Every journal entry's source, event, date and reversal link, oldest first (E14). */
export async function entriesBySource(db: CompanyDb): Promise<EntrySource[]> {
  return db
    .select({
      id: journalEntries.id,
      sourceType: journalEntries.sourceType,
      sourceId: journalEntries.sourceId,
      event: journalEntries.event,
      date: journalEntries.date,
      reversesId: journalEntries.reversesId,
    })
    .from(journalEntries)
    .orderBy(journalEntries.id);
}

/** The key E14 compares entries by: what kind of document, which one, and which event. */
export function entryKey(entry: Pick<EntrySource, "sourceType" | "sourceId" | "event">): string {
  return `${entry.sourceType} ${entry.sourceId} ${entry.event}`;
}

/**
 * Columns of money tables (any table with a numeric(14,2) column) whose names suggest a stored
 * balance or status: `table.column`, sorted (E15; ADR 0013, CLAUDE.md rule 9). The reviewed list
 * `STORED_STATE_COLUMNS` says why each one is a fact and not something the ledger derives.
 */
export async function stateLikeColumns(db: CompanyDb): Promise<string[]> {
  const rows = await db.execute<{ name: string }>(sql`
    select c.table_name || '.' || c.column_name as name
    from information_schema.columns c
    where c.table_schema = current_schema()
      and c.column_name ~ '(^|_)(balance|paid|owed|outstanding|remaining|settled|state|status)(_|$)'
      and exists (
        select 1 from information_schema.columns m
        where m.table_schema = c.table_schema and m.table_name = c.table_name
          and m.data_type = 'numeric' and m.numeric_precision = 14 and m.numeric_scale = 2
      )
    order by 1`);
  return [...rows].map((row) => row.name);
}
