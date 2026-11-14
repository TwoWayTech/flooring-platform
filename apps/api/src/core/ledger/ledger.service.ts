import { ConflictException, Injectable } from "@nestjs/common";
import type { CompanyDb } from "@workspace/db";
import { journalEntries, journalLines, ledgerAccounts, periodCloses } from "@workspace/db/company";
import {
  dec,
  DEFAULT_ACCOUNTS,
  isCashAccount,
  moneyString,
  postingProblem,
  reversedLines,
  type AccountType,
  type LedgerKey,
  type PostingDraft,
  type PostingLine,
} from "@workspace/shared";
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

/** One account's totals in the trial balance. */
export interface TrialBalanceRow {
  key: string | null;
  code: string;
  name: string;
  type: AccountType;
  debit: string;
  credit: string;
  /** Debits less credits. */
  balance: string;
}

/** The trial balance through a day: every account's totals, and whether they agree. */
export interface TrialBalance {
  through: string | null;
  rows: TrialBalanceRow[];
  debit: string;
  credit: string;
  balanced: boolean;
}

/** A posting the books refuse: 409 with the rule's words. */
function refused(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/**
 * The company ledger (blueprint pages 24, 25, 34 and 48; CLAUDE.md rule 10; ADR 0039). Modules post
 * a balanced entry from the shared posting rules inside the same transaction as their document, so
 * the two commit together or not at all. Entries are never changed: a void posts the reversing
 * entry. Nothing posts on or before the last closed day. The database checks all of this again.
 */
@Injectable()
export class LedgerService {
  /** The ids of the default accounts by key, making any that are missing (safe to repeat). */
  async accounts(tx: CompanyDb): Promise<Map<string, string>> {
    await tx
      .insert(ledgerAccounts)
      .values(DEFAULT_ACCOUNTS.map((account) => ({ id: uuidv7(), ...account })))
      .onConflictDoNothing({ target: ledgerAccounts.key });
    const rows = await tx
      .select({ id: ledgerAccounts.id, key: ledgerAccounts.key })
      .from(ledgerAccounts)
      .where(isNull(ledgerAccounts.deletedAt));
    return new Map(rows.flatMap((row) => (row.key ? [[row.key, row.id] as const] : [])));
  }

  /** The last closed day, or null while no period is closed. */
  async closedThrough(db: CompanyDb): Promise<string | null> {
    const [row] = await db
      .select({ through: periodCloses.closedThrough })
      .from(periodCloses)
      // UUID v7 ids sort by time; created_at is the transaction's start, so it is not the order.
      .orderBy(desc(periodCloses.id))
      .limit(1);
    return row?.through ?? null;
  }

  /**
   * Posts one entry in the caller's transaction. Refuses an unbalanced entry and a date in a closed
   * period (409 `period_closed`). An entry with nothing to post (a zero invoice) is skipped.
   */
  async post(tx: CompanyDb, draft: PostingDraft, by: string): Promise<string | null> {
    if (draft.lines.length === 0) return null;
    const problem = postingProblem(draft.lines);
    if (problem) throw new Error(`Posting ${draft.event} for ${draft.sourceNumber}: ${problem}`);
    await this.assertOpen(tx, draft.date);
    return this.write(tx, draft, by, null);
  }

  /**
   * Undoes the entry a source posted for an event, on the given day: the same lines with debit and
   * credit swapped, linked to the original (CLAUDE.md rule 9). Nothing happens when the source never
   * posted that event, such as a payment that was never confirmed. `lines` replaces the mirrored
   * lines when undoing the document now moves different accounts than posting it did, such as a
   * payment whose extra became credit only because another payment came first (PR #16 review).
   */
  async reverse(
    tx: CompanyDb,
    source: Pick<PostingDraft, "sourceType" | "sourceId" | "event">,
    date: string,
    by: string,
    lines?: PostingLine[],
  ): Promise<string | null> {
    const [entry] = await tx
      .select()
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.sourceType, source.sourceType),
          eq(journalEntries.sourceId, source.sourceId),
          eq(journalEntries.event, source.event),
        ),
      );
    if (!entry) return null;
    await this.assertOpen(tx, date);
    if (lines) {
      const problem = postingProblem(lines);
      if (problem) throw new Error(`Reversing ${source.event} for ${entry.sourceNumber}: ${problem}`);
      return this.write(
        tx,
        {
          event: `${source.event}.reversed` as PostingDraft["event"],
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sourceNumber: entry.sourceNumber,
          date,
          memo: `Reverses: ${entry.memo}`,
          lines,
        },
        by,
        entry.id,
      );
    }
    const posted = await tx
      .select({
        key: ledgerAccounts.key,
        accountId: journalLines.accountId,
        debit: journalLines.debit,
        credit: journalLines.credit,
        locationId: journalLines.locationId,
        customerId: journalLines.customerId,
      })
      .from(journalLines)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, entry.id));
    const reversal = reversedLines(
      posted.map((line) => ({
        account: line.key as LedgerKey,
        debit: line.debit,
        credit: line.credit,
        locationId: line.locationId,
        customerId: line.customerId,
      })),
    );
    return this.write(
      tx,
      {
        event: `${source.event}.reversed` as PostingDraft["event"],
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceNumber: entry.sourceNumber,
        date,
        memo: `Reverses: ${entry.memo}`,
        lines: reversal,
      },
      by,
      entry.id,
      posted.map((line) => line.accountId),
    );
  }

  /**
   * The cash account (Cash and Bank or a bank account) that a source's entry for an event posted
   * to, or null when it never posted; 409 when the entry has no cash line. A void credits the same bank the money went into, even when
   * the method's bank account has changed since (ADR 0040).
   */
  async postedCashAccount(
    tx: CompanyDb,
    source: Pick<PostingDraft, "sourceType" | "sourceId" | "event">,
  ): Promise<LedgerKey | null> {
    const rows = await tx
      .select({ key: ledgerAccounts.key })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(
        and(
          eq(journalEntries.sourceType, source.sourceType),
          eq(journalEntries.sourceId, source.sourceId),
          eq(journalEntries.event, source.event),
        ),
      );
    if (rows.length === 0) return null;
    const cash = rows.map((row) => row.key).find(isCashAccount);
    // An entry that took money in always has a cash line; anything else is a broken entry, not a default.
    if (!cash)
      throw refused("ledger_entry_invalid", `The ${source.event} entry has no cash line, so it can't be reversed.`);
    return cash;
  }

  /** Every account's debits, credits and balance through a day (or all time), and their totals. */
  async trialBalance(db: CompanyDb, through?: string): Promise<TrialBalance> {
    // A read only: accounts are made by the first posting, so a read-only company stays unchanged.
    const rows = await db
      .select({
        key: ledgerAccounts.key,
        code: ledgerAccounts.code,
        name: ledgerAccounts.name,
        type: ledgerAccounts.type,
        debit: sql<string>`coalesce(sum(${journalLines.debit}) filter (where ${journalEntries.id} is not null), 0)::numeric(14,2)`,
        credit: sql<string>`coalesce(sum(${journalLines.credit}) filter (where ${journalEntries.id} is not null), 0)::numeric(14,2)`,
      })
      .from(ledgerAccounts)
      .leftJoin(journalLines, eq(journalLines.accountId, ledgerAccounts.id))
      .leftJoin(
        journalEntries,
        and(eq(journalEntries.id, journalLines.entryId), through ? lte(journalEntries.date, through) : undefined),
      )
      .where(isNull(ledgerAccounts.deletedAt))
      .groupBy(ledgerAccounts.id)
      .orderBy(asc(ledgerAccounts.code));
    const [sums] = await db
      .select({
        debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)::numeric(14,2)`,
        credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)::numeric(14,2)`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(through ? lte(journalEntries.date, through) : undefined);
    return {
      through: through ?? null,
      rows: rows.map((row) => ({ ...row, balance: moneyString(dec(row.debit).minus(row.credit)) })),
      debit: moneyString(sums?.debit ?? "0"),
      credit: moneyString(sums?.credit ?? "0"),
      balanced: dec(sums?.debit ?? "0").eq(sums?.credit ?? "0"),
    };
  }

  /**
   * Closes the books through a day (or reopens to an earlier one); the newest close decides. It
   * waits for postings in flight, which hold the period lock shared, so none slips in behind it.
   * Returns the day that was closed before, read under the lock.
   */
  async closePeriod(tx: CompanyDb, through: string, note: string, by: string): Promise<string | null> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ledger:period'))`);
    const before = await this.closedThrough(tx);
    await tx.insert(periodCloses).values({ id: uuidv7(), closedThrough: through, note, createdBy: by });
    return before;
  }

  private async assertOpen(tx: CompanyDb, date: string): Promise<void> {
    // Shared with other postings, exclusive against a close, until this transaction ends.
    await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtext('ledger:period'))`);
    const closed = await this.closedThrough(tx);
    if (closed && date <= closed) {
      throw refused("period_closed", `The books are closed through ${closed}, so nothing can be recorded on ${date}.`);
    }
  }

  private async write(
    tx: CompanyDb,
    draft: PostingDraft,
    by: string,
    reversesId: string | null,
    accountIds?: readonly string[],
  ): Promise<string> {
    const accounts = accountIds ? null : await this.accounts(tx);
    const id = uuidv7();
    await tx.insert(journalEntries).values({
      id,
      date: draft.date,
      event: draft.event,
      sourceType: draft.sourceType,
      sourceId: draft.sourceId,
      sourceNumber: draft.sourceNumber,
      memo: draft.memo,
      reversesId,
      createdBy: by,
    });
    await tx.insert(journalLines).values(
      draft.lines.map((line: PostingLine, index) => ({
        id: uuidv7(),
        entryId: id,
        accountId: accountIds ? accountIds[index]! : accountOf(accounts!, line.account),
        debit: line.debit,
        credit: line.credit,
        locationId: line.locationId,
        customerId: line.customerId,
        createdBy: by,
      })),
    );
    return id;
  }
}

function accountOf(accounts: ReadonlyMap<string, string>, key: LedgerKey): string {
  const id = accounts.get(key);
  if (!id)
    throw refused(
      "ledger_account_missing",
      "An account this posting needs is missing or retired. Check Settings → Accounting.",
    );
  return id;
}
