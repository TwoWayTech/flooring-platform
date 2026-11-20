import type { CompanyDb } from "@workspace/db";
import { sql } from "drizzle-orm";
import { jsonNodes } from "./strippable";

/**
 * Every record id in one company database: the `id` of each row of each table whose `id` is a
 * uuid, read straight from the database. The isolation check (FA-11) uses it to tell whether an
 * answer for one company names any record of another.
 */
export async function recordIds(db: CompanyDb): Promise<Set<string>> {
  const tables = await db.execute<{ name: string }>(
    sql`select table_name as name from information_schema.columns
        where table_schema = 'public' and column_name = 'id' and data_type = 'uuid'
        order by table_name`,
  );
  const ids = new Set<string>();
  for (const { name } of tables) {
    const rows = await db.execute<{ id: string }>(sql`select id::text as id from ${sql.identifier(name)}`);
    for (const row of rows) ids.add(row.id);
  }
  return ids;
}

/** The places in a JSON body whose string value is one of `ids`, as `$.path = id`. */
export function idsFound(body: unknown, ids: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (const node of jsonNodes(body)) {
    if (typeof node.value === "string" && ids.has(node.value)) found.push(`${node.path} = ${node.value}`);
  }
  return found;
}
