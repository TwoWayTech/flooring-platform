import type { AccountType } from "@workspace/shared";
import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { appendOnly, business, day, money } from "../columns";
import { customers } from "./customers";
import { locations } from "./organization";

/**
 * The chart of accounts (blueprint pages 24 and 25; ADR 0039). Postings find an account by its
 * stable `key`; a company may rename it or add its own, which have no key.
 */
export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    ...business(),
    key: text(),
    code: text().notNull(),
    name: text().notNull(),
    type: text().$type<AccountType>().notNull(),
    active: boolean().notNull().default(true),
  },
  (table) => [
    // A key stays unique even on a deleted account, because postings find accounts by key.
    uniqueIndex("ledger_accounts_key_uidx").on(table.key),
    uniqueIndex("ledger_accounts_code_uidx")
      .on(table.code)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * One balanced journal entry (blueprint page 48; CLAUDE.md rule 10). Append-only: a mistake is
 * undone by a reversing entry, never by an edit. The source and event make an entry unique, so a
 * document never posts the same event twice. Triggers refuse unbalanced entries at commit and
 * entries dated in a closed period.
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    ...appendOnly(),
    date: day().notNull(),
    event: text().notNull(),
    sourceType: text().notNull(),
    sourceId: uuid().notNull(),
    sourceNumber: text().notNull(),
    memo: text().notNull().default(""),
    /** Set on a reversing entry: the entry it undoes. */
    reversesId: uuid().references((): AnyPgColumn => journalEntries.id),
  },
  (table) => [
    uniqueIndex("journal_entries_source_event_uidx").on(table.sourceType, table.sourceId, table.event),
    index("journal_entries_date_idx").on(table.date),
    index("journal_entries_reverses_idx").on(table.reversesId),
  ],
);

/** One debit or credit of an entry. Exactly one side is above zero; none is negative. */
export const journalLines = pgTable(
  "journal_lines",
  {
    ...appendOnly(),
    entryId: uuid()
      .notNull()
      .references(() => journalEntries.id),
    accountId: uuid()
      .notNull()
      .references(() => ledgerAccounts.id),
    debit: money().notNull(),
    credit: money().notNull(),
    locationId: uuid().references(() => locations.id),
    customerId: uuid().references(() => customers.id),
  },
  (table) => [
    index("journal_lines_entry_idx").on(table.entryId),
    index("journal_lines_account_idx").on(table.accountId),
    index("journal_lines_location_idx").on(table.locationId),
    index("journal_lines_customer_idx").on(table.customerId),
    check(
      "journal_lines_one_sided",
      sql`${table.debit} >= 0 and ${table.credit} >= 0 and ((${table.debit} > 0) <> (${table.credit} > 0))`,
    ),
  ],
);

/**
 * Closing the books (blueprint page 48): the newest row's date is the last closed day, and nothing
 * posts on or before it. Reopening is a new row with an earlier date, so every change is kept.
 */
export const periodCloses = pgTable("period_closes", {
  ...appendOnly(),
  closedThrough: day().notNull(),
  note: text().notNull().default(""),
});
