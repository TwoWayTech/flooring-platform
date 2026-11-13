import type { CompanyDb } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Stock changes in one company are made one at a time, under a transaction-level advisory lock, so
 * two transfers, corrections or goods receipts can never both spend the same stock or take the
 * same number (ADR 0035). Every module that changes stock takes it first.
 */
export async function lockStock(tx: CompanyDb): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('inventory:stock'))`);
}
