import type { CompanyDb } from "@workspace/db";
import { inArray, notInArray, sql } from "drizzle-orm";
import { REFERENCE_TABLES, type ReferenceTable, type ReferenceTarget } from "./kind-store";

/** A link from one table's column to the records an import created. */
interface Link {
  table: string;
  column: string;
}

/**
 * Links no foreign key covers (ADR 0057 api 4.8, R4): a meeting guest, an attachment's owner, a
 * journal entry's source, and an outbox email's source and recipient. A new polymorphic link must
 * be added here. Copies are not links: a quote's job-site JSON or a purchase order's contact
 * snapshot never stops an Undo, and `audit_log.target_id` is a log.
 */
export const POLYMORPHIC_REFERENCES: readonly Link[] = [
  { table: "meeting_attendees", column: "party_id" },
  { table: "attachments", column: "owner_id" },
  { table: "journal_entries", column: "source_id" },
  { table: "outbox_messages", column: "source_id" },
  { table: "outbox_messages", column: "recipient_id" },
];

/** How many ids one reference query names at most, well inside PostgreSQL's parameter limit. */
const CHUNK = 1000;

/** A list in slices of at most `CHUNK`. */
function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < list.length; at += CHUNK) out.push(list.slice(at, at + CHUNK));
  return out;
}

/**
 * Every single-column foreign key in the company schema that points at one of `tables`, read from
 * the catalog, so a table added later is covered without a code change. A key of more than one
 * column is a fault: the check would miss it, so it stops here (a 500 the integration tests catch).
 */
async function foreignKeys(tx: CompanyDb, tables: readonly ReferenceTable[]): Promise<(Link & { target: string })[]> {
  const rows = await tx.execute<{ table: string; column: string; target: string; width: number }>(sql`
    select cl.relname as "table", att.attname as "column", ref.relname as target,
           array_length(con.conkey, 1) as width
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_class ref on ref.oid = con.confrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
    where con.contype = 'f' and ns.nspname = current_schema()
      and ref.relname in (${sql.join(
        tables.map((table) => sql`${table}`),
        sql`, `,
      )})`);
  for (const row of rows) {
    if (Number(row.width) !== 1) {
      throw new Error(`The foreign key ${row.table}.${row.column} has ${row.width} columns; the Undo check needs one.`);
    }
  }
  return rows.map((row) => ({ table: row.table, column: row.column, target: row.target }));
}

/** The company tables with a `deleted_at` column: their rows count as links only while live. */
async function softTables(tx: CompanyDb): Promise<Set<string>> {
  const rows = await tx.execute<{ table: string }>(sql`
    select cl.relname as "table"
    from pg_attribute att
    join pg_class cl on cl.oid = att.attrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    where att.attname = 'deleted_at' and not att.attisdropped and cl.relkind = 'r'
      and ns.nspname = current_schema()`);
  return new Set(rows.map((row) => row.table));
}

/**
 * The first of `ids` a row of `link` points at, or null. A row of a table with `deleted_at` counts
 * only while live (ADR 0057 M1); a row of a log or ledger always counts; a row the batch itself
 * wrote never does. Identifiers come from the catalog or the list above, never from a request.
 */
async function firstLinked(
  tx: CompanyDb,
  link: Link,
  ids: readonly string[],
  soft: boolean,
  batchIds: readonly string[],
): Promise<string | null> {
  const column = sql`${sql.identifier(link.column)}`;
  for (const slice of chunks(ids)) {
    const [row] = await tx.execute<{ ref: string }>(sql`
      select ${column}::text as ref from ${sql.identifier(link.table)}
      where ${inArray(column, slice)}
        ${soft ? sql`and deleted_at is null` : sql``}
        and ${notInArray(sql`id`, [...batchIds])}
      limit 1`);
    if (row) return row.ref;
  }
  return null;
}

/**
 * Locks the rows an Undo will soft-delete, `FOR UPDATE NOWAIT`, table by table from the fixed list
 * and in id order (ADR 0057 api 4.6 step 8, S-14). The table locks let a foreign-key insert
 * elsewhere (a quote, an invoice line) through, and its check holds `FOR KEY SHARE` on the row it
 * names until it commits. `NOWAIT` fails at once (SQLSTATE 55P03) on such a row instead of
 * waiting, so the Undo never waits on a row lock and can't close a deadlock with a writer that
 * takes the stock lock after its lines, as converting a quote does. Once these rows are locked, no
 * new foreign key can name them until the Undo ends. Only the batch's own rows are locked.
 */
export async function lockTargets(tx: CompanyDb, targets: readonly ReferenceTarget[]): Promise<void> {
  for (const table of REFERENCE_TABLES) {
    const ids = [...new Set(targets.filter((target) => target.table === table).map((target) => target.id))].sort();
    for (const slice of chunks(ids)) {
      await tx.execute(sql`
        select id from ${sql.identifier(table)}
        where ${inArray(sql`id`, slice)}
        order by id
        for update nowait`);
    }
  }
}

/**
 * The first record an import created that a live record elsewhere still points at, or null (ADR
 * 0057 api 4.8, S-14): through every foreign key to the created rows' tables, and through the
 * polymorphic links. Undo is refused while one exists, so it never leaves a dangling link.
 * `batchIds` are the ids the batch itself wrote, whose rows never count.
 */
export async function firstReference(
  tx: CompanyDb,
  targets: readonly ReferenceTarget[],
  batchIds: ReadonlySet<string>,
): Promise<string | null> {
  if (targets.length === 0) return null;
  const tables = [...new Set(targets.map((target) => target.table))];
  const [keys, soft] = await Promise.all([foreignKeys(tx, tables), softTables(tx)]);
  const exclude = [...batchIds];
  for (const key of keys) {
    const ids = targets.filter((target) => target.table === key.target).map((target) => target.id);
    const found = await firstLinked(tx, key, ids, soft.has(key.table), exclude);
    if (found) return found;
  }
  const every = targets.map((target) => target.id);
  for (const link of POLYMORPHIC_REFERENCES) {
    const found = await firstLinked(tx, link, every, soft.has(link.table), exclude);
    if (found) return found;
  }
  return null;
}
