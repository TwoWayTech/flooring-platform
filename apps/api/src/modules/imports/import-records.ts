import type { CompanyDb, ControlDb } from "@workspace/db";
import {
  importJobs,
  importMappings,
  products,
  rolls,
  stockMovements,
  suppliers,
  userProfiles,
} from "@workspace/db/company";
import { user } from "@workspace/db/control";
import {
  nextNumber,
  type ColumnMapping,
  type ImportBatch,
  type ImportBatchSummary,
  type ImportChange,
  type ImportCounts,
  type ImportKind,
  type ImportMapping,
  type ImportUser,
} from "@workspace/shared";
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { loadNames } from "../sales/invoice-records";

/** How many batches the history lists, newest first. */
const HISTORY_LENGTH = 200;

/** What the history shows for someone whose sign-in is gone. */
const FORMER_USER = "Former user";

/** An import job row with everything Undo needs, the saved record versions included. */
export interface StoredBatch {
  id: string;
  number: string;
  kind: ImportKind;
  fileName: string;
  mapping: ColumnMapping;
  counts: ImportCounts;
  changes: ImportChange[];
  createdAt: Date;
  createdBy: string | null;
  undoneAt: Date | null;
  undoneBy: string | null;
}

/** The columns of a batch the history shows: never `changes` (ADR 0057 S-15). */
const SUMMARY_COLUMNS = {
  id: importJobs.id,
  number: importJobs.number,
  kind: importJobs.kind,
  fileName: importJobs.fileName,
  mapping: importJobs.mapping,
  counts: importJobs.counts,
  createdAt: importJobs.createdAt,
  createdBy: importJobs.createdBy,
  undoneAt: importJobs.undoneAt,
  undoneBy: importJobs.undoneBy,
};

/**
 * A batch as the history and the answers give it (ADR 0057 S-15): who imported and who undid it by
 * name from the control database, or "Former user" when the sign-in is gone. Built field by field,
 * so the saved record versions never leave the server.
 */
export function summaryOf(row: Omit<StoredBatch, "changes">, names: ReadonlyMap<string, string>): ImportBatchSummary {
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? FORMER_USER) : FORMER_USER);
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    fileName: row.fileName,
    at: row.createdAt.toISOString(),
    byName: nameOf(row.createdBy),
    mapping: row.mapping,
    counts: row.counts,
    undoneAt: row.undoneAt ? row.undoneAt.toISOString() : null,
    undoneBy: row.undoneAt ? nameOf(row.undoneBy) : null,
  };
}

/** The live batches, newest first, without their saved record versions. */
export async function loadBatchSummaries(db: CompanyDb, control: ControlDb): Promise<ImportBatchSummary[]> {
  const rows = await db
    .select(SUMMARY_COLUMNS)
    .from(importJobs)
    .where(isNull(importJobs.deletedAt))
    .orderBy(desc(importJobs.createdAt), desc(importJobs.id))
    .limit(HISTORY_LENGTH);
  const names = await loadNames(
    control,
    rows.flatMap((row) => [row.createdBy, row.undoneBy]),
  );
  return rows.map((row) => summaryOf(row, names));
}

/** A live batch, locked for this transaction so two Undos of it run one after the other; undefined when gone. */
export async function lockBatch(tx: CompanyDb, id: string): Promise<StoredBatch | undefined> {
  const [row] = await tx
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.id, id), isNull(importJobs.deletedAt)))
    .for("update");
  return row;
}

/** Keeps a finished import for the history and Undo; answers its creation time. */
export async function insertBatch(
  tx: CompanyDb,
  batch: Pick<ImportBatch, "id" | "number" | "kind" | "fileName" | "mapping" | "counts" | "changes">,
  createdBy: string,
): Promise<Date> {
  const [row] = await tx
    .insert(importJobs)
    .values({ ...batch, createdBy })
    .returning({ createdAt: importJobs.createdAt });
  return row!.createdAt;
}

/** Marks a batch undone, by whom and when. */
export async function markUndone(tx: CompanyDb, id: string, undoneBy: string): Promise<Date> {
  const [row] = await tx
    .update(importJobs)
    .set({ undoneAt: sql`now()`, undoneBy })
    .where(eq(importJobs.id, id))
    .returning({ undoneAt: importJobs.undoneAt });
  return row!.undoneAt!;
}

/**
 * The next batch number, IMP-1001 on (ADR 0057). Every row counts, deleted ones too, because
 * `import_jobs_number_uidx` is not partial; the import lock keeps two imports from taking one.
 */
export async function nextBatchNumber(tx: CompanyDb): Promise<string> {
  const rows = await tx.select({ number: importJobs.number }).from(importJobs);
  return nextNumber(
    "IMP-",
    rows.map((row) => row.number),
    1001,
  );
}

/** How many imports the company committed in the last 24 hours, undone and deleted ones included (ADR 0057 S-12). */
export async function batchesInLastDay(tx: CompanyDb): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(importJobs)
    .where(gt(importJobs.createdAt, sql`now() - interval '24 hours'`));
  return row?.n ?? 0;
}

/** The saved column choices, one per kind. */
export async function loadMappings(db: CompanyDb): Promise<ImportMapping[]> {
  const rows = await db.select().from(importMappings).where(isNull(importMappings.deletedAt));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    columns: row.columns,
    savedAt: row.updatedAt.toISOString(),
  }));
}

/** The kind's saved column choices, live or not, for the audit entry's "before". */
export async function storedMapping(tx: CompanyDb, kind: ImportKind): Promise<ColumnMapping | null> {
  const [row] = await tx
    .select({ columns: importMappings.columns, deletedAt: importMappings.deletedAt })
    .from(importMappings)
    .where(eq(importMappings.kind, kind));
  return row && !row.deletedAt ? row.columns : null;
}

/**
 * Saves a kind's column choices in place (ADR 0057 api 4.10): one row per kind, since
 * `import_mappings_kind_uidx` is not partial; a deleted row comes back. `created_by` keeps the
 * first saver.
 */
export async function upsertMapping(
  tx: CompanyDb,
  kind: ImportKind,
  columns: ColumnMapping,
  savedBy: string,
): Promise<ImportMapping> {
  const [row] = await tx
    .insert(importMappings)
    .values({ kind, columns, createdBy: savedBy })
    .onConflictDoUpdate({
      target: importMappings.kind,
      set: { columns: sql`excluded.columns`, updatedAt: sql`now()`, deletedAt: null },
    })
    .returning();
  return { id: row!.id, kind: row!.kind, columns: row!.columns, savedAt: row!.updatedAt.toISOString() };
}

/**
 * The company's members as an import may name them, such as a sales rep (ADR 0057 S-8): every live
 * profile with the name and email of its sign-in and the profile's status. A profile whose sign-in
 * is gone is left out.
 */
export async function loadMembers(db: CompanyDb, control: ControlDb): Promise<ImportUser[]> {
  const profiles = await db
    .select({ userId: userProfiles.userId, status: userProfiles.status })
    .from(userProfiles)
    .where(isNull(userProfiles.deletedAt));
  if (profiles.length === 0) return [];
  const accounts = await control
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(
      inArray(
        user.id,
        profiles.map((profile) => profile.userId),
      ),
    );
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return profiles.flatMap((profile) => {
    const account = byId.get(profile.userId);
    return account ? [{ id: account.id, name: account.name, email: account.email, status: profile.status }] : [];
  });
}

/** Lower-case SKUs held by deleted products, which a new product may not take (ADR 0057 S-6). */
export async function loadRetiredSkus(db: CompanyDb): Promise<string[]> {
  const rows = await db
    .select({ sku: sql<string>`lower(${products.sku})` })
    .from(products)
    .where(isNotNull(products.deletedAt));
  return rows.map((row) => row.sku);
}

/**
 * Product ids with any stock history (ADR 0057 S-5, M4): any stock movement, a transfer's
 * `transfer_out` for stock in transit included, or any roll, deleted ones included. Read as one
 * set, never as every movement and roll (M7).
 */
export async function loadProductsWithStock(db: CompanyDb): Promise<Set<string>> {
  const rows = await db
    .select({ productId: stockMovements.productId })
    .from(stockMovements)
    .union(db.select({ productId: rolls.productId }).from(rolls));
  return new Set(rows.map((row) => row.productId));
}

/** The ids of live suppliers, for the products Undo check (ADR 0057 M6). */
export async function liveSupplierIds(db: CompanyDb): Promise<Set<string>> {
  const rows = await db.select({ id: suppliers.id }).from(suppliers).where(isNull(suppliers.deletedAt));
  return new Set(rows.map((row) => row.id));
}
