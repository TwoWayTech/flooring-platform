import type { CompanyDb } from "@workspace/db";
import { settings } from "@workspace/db/company";
import { DEFAULT_ACCOUNTING_SETTINGS, type AccountingSettings } from "@workspace/shared";
import { eq } from "drizzle-orm";

/**
 * The company's accounting settings (ADR 0040). A company that never saved Settings → Accounting
 * uses the owner's defaults (2026-11-14): average cost, accrual sales tax, one Cash and Bank account.
 */
export async function loadAccounting(db: CompanyDb): Promise<AccountingSettings> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, "accounting"));
  if (!row) return DEFAULT_ACCOUNTING_SETTINGS;
  return { ...DEFAULT_ACCOUNTING_SETTINGS, ...(row.value as Partial<AccountingSettings>) };
}
