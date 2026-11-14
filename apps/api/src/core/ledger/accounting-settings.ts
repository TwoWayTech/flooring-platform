import { ConflictException, Logger } from "@nestjs/common";
import type { CompanyDb } from "@workspace/db";
import { settings } from "@workspace/db/company";
import { DEFAULT_ACCOUNTING_SETTINGS, PAYMENT_METHODS, type AccountingSettings } from "@workspace/shared";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

const BANK_KEY = z
  .string()
  .regex(/^bank:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "Unknown bank account.")
  .transform((key) => key as `bank:${string}`);

/** One bank account; `key` is optional as the screen sends it (a new one has none). */
function bankAccount<K extends z.ZodType>(key: K) {
  return z
    .object({
      key,
      name: z.string().trim().min(1, "Name the bank account.").max(80),
      methods: z.array(z.enum(PAYMENT_METHODS)).max(PAYMENT_METHODS.length),
    })
    .strict();
}

function accountingSchema<K extends z.ZodType>(key: K) {
  return z
    .object({
      costingMethod: z.literal("average"),
      salesTaxBasis: z.enum(["accrual", "cash"]),
      bankAccounts: z.array(bankAccount(key)).max(20),
    })
    .strict();
}

/**
 * Settings → Accounting as the screen sends it (ADR 0040). Strict, so an unknown field such as an
 * account number is refused (CLAUDE.md rule 14). Bank account keys come from the server.
 */
export const ACCOUNTING_INPUT = accountingSchema(BANK_KEY.optional());

/** The settings as stored: every bank account has its key. */
const ACCOUNTING_STORED = accountingSchema(BANK_KEY);

/** Postings and the settings save exclude each other through this lock (PR #19 security review). */
const SETTINGS_LOCK = sql`hashtext('settings:accounting')`;

const logger = new Logger("AccountingSettings");

/**
 * The company's accounting settings (ADR 0040). A company that never saved Settings → Accounting
 * uses the owner's defaults (2026-11-14): average cost, accrual sales tax, one Cash and Bank account.
 * A stored row that fails the schema is refused, never replaced by the defaults, because the
 * defaults would quietly post a bank's money to Cash and Bank.
 */
export async function loadAccounting(db: CompanyDb): Promise<AccountingSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, "accounting"));
  if (!row) return DEFAULT_ACCOUNTING_SETTINGS;
  const parsed = ACCOUNTING_STORED.safeParse(row.value);
  if (!parsed.success) {
    logger.error("The stored accounting settings fail their schema.");
    throw new ConflictException({
      code: "settings_invalid",
      message: "The accounting settings can't be read. Ask the Accountant to save Settings → Accounting again.",
    });
  }
  return parsed.data;
}

/**
 * The settings for a posting, read under a shared lock that the save takes exclusively. A save
 * that retires a bank account waits for postings in flight, then sees their lines and refuses
 * (409 `bank_account_in_use`); a posting that starts after it reads the new settings.
 */
export async function loadAccountingForPosting(tx: CompanyDb): Promise<AccountingSettings> {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(${SETTINGS_LOCK})`);
  return loadAccounting(tx);
}

/** Takes the settings lock exclusively for a save, so no posting runs against settings it changes. */
export async function lockAccountingForSave(tx: CompanyDb): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${SETTINGS_LOCK})`);
}
