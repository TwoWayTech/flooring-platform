import { ConflictException, HttpException } from "@nestjs/common";
import type { CompanyDb } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * One import operation at a time per company (ADR 0057 S-12): a dry run, an import or an Undo
 * takes this transaction-level advisory lock without waiting, so a second one is told at once.
 * The import's number is read under it too.
 */
export async function takeImportLock(tx: CompanyDb): Promise<void> {
  const [row] = await tx.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock(hashtext('imports:run')) as locked`,
  );
  if (!row?.locked) {
    throw new ConflictException({
      code: "import_running",
      message: "Another import or undo is running for this company. Try again when it finishes.",
    });
  }
}

/**
 * An import or Undo gives up after waiting 10 seconds for a table or the stock lock (ADR 0057
 * S-12), so it never holds other writers back for long; the wait ends as `import_busy`.
 */
export async function limitLockWait(tx: CompanyDb): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '10s'`);
}

/** Lock waits that end in a retry: deadlock, serialization failure, lock timeout. */
const BUSY_CODES: ReadonlySet<string> = new Set(["40P01", "40001", "55P03"]);

/** The PostgreSQL error code of an error or of the error it wraps (drizzle wraps the driver's). */
function databaseCode(error: unknown): string | undefined {
  for (let at: unknown = error; typeof at === "object" && at !== null;) {
    const fields = at as { code?: unknown; cause?: unknown };
    if (typeof fields.code === "string") return fields.code;
    at = fields.cause;
  }
  return undefined;
}

/**
 * The answer to an error inside an import or Undo transaction (ADR 0057 api 4.4): a lock wait
 * that failed is a 409 `import_busy` and a unique clash a 409 `import_conflict`, both meaning
 * nothing was written. Refusals pass as they are; anything else is rethrown for the ErrorFilter,
 * since the field rules keep data errors from reaching the database.
 */
export function importFailure(error: unknown): unknown {
  if (error instanceof HttpException) return error;
  const code = databaseCode(error);
  if (code && BUSY_CODES.has(code)) {
    return new ConflictException({
      code: "import_busy",
      message: "The records were busy, so nothing was imported. Try again in a moment.",
    });
  }
  if (code === "23505") {
    return new ConflictException({
      code: "import_conflict",
      message:
        "A record in this file clashes with one saved at the same time, so nothing was imported. Check the file again.",
    });
  }
  return error;
}
