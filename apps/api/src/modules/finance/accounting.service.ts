import { ConflictException, Injectable } from "@nestjs/common";
import type { CompanyDb } from "@workspace/db";
import { journalLines, ledgerAccounts, settings } from "@workspace/db/company";
import {
  accountingSettingsProblem,
  type AccountingSettings,
  type BankAccountKey,
  type BankAccountSetting,
} from "@workspace/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { loadAccounting } from "../../core/ledger/accounting-settings";
import { refuse } from "../sales/sales-common";

/** Bank accounts take the free codes after Cash and Bank (1000) and before receivables (1100). */
const FIRST_BANK_CODE = 1010;
const LAST_BANK_CODE = 1099;

/** What a save changed, for the audit entry. */
export interface AccountingChange {
  before: AccountingSettings;
  after: AccountingSettings;
}

/**
 * Settings → Accounting (ADR 0040). Each bank account is a ledger account of its own, made when it
 * is added and renamed with it. One that has postings can't be removed, because its entries must
 * keep pointing at a live account; take its methods away instead.
 */
@Injectable()
export class AccountingService {
  /** Saves the settings and keeps the bank ledger accounts in step, in the caller's transaction. */
  async save(tx: CompanyDb, input: AccountingSettings, by: string): Promise<AccountingChange> {
    // One save at a time, so two saves can't both take the same free account code.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('settings:accounting'))`);
    const problem = accountingSettingsProblem(input);
    if (problem) throw refuse(problem);
    const before = await loadAccounting(tx);
    const known = new Map(before.bankAccounts.flatMap((bank) => (bank.key ? [[bank.key, bank] as const] : [])));
    for (const bank of input.bankAccounts) {
      if (bank.key && !known.has(bank.key))
        throw refuse("A bank account in the list no longer exists. Reload and try again.");
    }
    const kept = new Set(input.bankAccounts.flatMap((bank) => (bank.key ? [bank.key] : [])));
    await this.remove(
      tx,
      [...known.keys()].filter((key) => !kept.has(key)),
    );
    const bankAccounts: BankAccountSetting[] = [];
    for (const bank of input.bankAccounts) {
      const name = bank.name.trim();
      const methods = [...new Set(bank.methods)];
      if (bank.key) {
        if (known.get(bank.key)?.name !== name) {
          await tx.update(ledgerAccounts).set({ name, updatedAt: new Date() }).where(eq(ledgerAccounts.key, bank.key));
        }
        bankAccounts.push({ key: bank.key, name, methods });
      } else {
        bankAccounts.push({ key: await this.add(tx, name, by), name, methods });
      }
    }
    const after: AccountingSettings = { ...input, bankAccounts };
    await tx
      .insert(settings)
      .values({ id: uuidv7(), group: "accounting", value: after, createdBy: by })
      .onConflictDoUpdate({ target: settings.group, set: { value: after, updatedAt: new Date() } });
    return { before, after };
  }

  /** Makes the ledger account for a new bank account with the next free code, and returns its key. */
  private async add(tx: CompanyDb, name: string, by: string): Promise<BankAccountKey> {
    const used = await tx
      .select({ code: ledgerAccounts.code })
      .from(ledgerAccounts)
      .where(isNull(ledgerAccounts.deletedAt));
    const taken = new Set(used.map((row) => row.code));
    let code = FIRST_BANK_CODE;
    while (code <= LAST_BANK_CODE && taken.has(String(code))) code += 1;
    if (code > LAST_BANK_CODE) throw refuse("The chart of accounts has no free code for another bank account.");
    const id = uuidv7();
    const key: BankAccountKey = `bank:${id}`;
    await tx
      .insert(ledgerAccounts)
      .values({ id, key, code: String(code), name, type: "asset" as const, createdBy: by });
    return key;
  }

  /**
   * Retires bank accounts that left the list; refuses one whose ledger account has postings. A
   * posting that read the old settings just before the removal commits finds no account and rolls
   * back (fails closed), so nothing posts to a retired account.
   */
  private async remove(tx: CompanyDb, keys: BankAccountKey[]): Promise<void> {
    if (keys.length === 0) return;
    const used = await tx
      .selectDistinct({ name: ledgerAccounts.name })
      .from(journalLines)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(inArray(ledgerAccounts.key, keys));
    if (used[0]) {
      throw new ConflictException({
        code: "bank_account_in_use",
        message: `${used[0].name} has entries in the books, so it can't be removed. Take its payment methods away instead.`,
      });
    }
    await tx
      .update(ledgerAccounts)
      .set({ deletedAt: new Date(), updatedAt: new Date(), active: false })
      .where(and(inArray(ledgerAccounts.key, keys), isNull(ledgerAccounts.deletedAt)));
  }
}
