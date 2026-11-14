import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateCompany, migrateControl } from "../src";
import { scratchDatabase } from "../src/testing";

/** Tables that are corrected by a new row, never hidden, so they have no deleted_at. */
const APPEND_ONLY = new Set([
  "audit_log",
  "platform_audit_log",
  "stock_movements",
  "roll_cuts",
  "journal_entries",
  "journal_lines",
  "period_closes",
  "time_off_entries",
  "employee_manager_history",
  "meeting_responses",
  "auth_attempts",
]);
/** Better Auth owns these shapes (src/control/auth.ts); only the uuid id rule applies to them. */
const LIBRARY_OWNED = new Set([
  "user",
  "session",
  "account",
  "verification",
  "two_factor",
  "passkey",
  "organization",
  "member",
  "invitation",
  "rate_limit",
]);
/** Floats are allowed only for drawing coordinates, never for money or quantities. */
const FLOAT_ALLOWED = new Set(["addresses.lat", "addresses.lng", "measurement_rooms.x", "measurement_rooms.y"]);
/** numeric(14,2) money, (14,4) unit cost, (14,3) quantity, (18,8) rates (blueprint p15, p23). */
const NUMERIC_TYPES = new Set(["14,2", "14,4", "14,3", "18,8"]);

interface Column {
  table: string;
  column: string;
  type: string;
  precision: number | null;
  scale: number | null;
}

async function columnsOf(url: string): Promise<Column[]> {
  const sql = postgres(url, { max: 1 });
  try {
    return await sql<Column[]>`
      select table_name as table, column_name as column, data_type as type,
             numeric_precision as precision, numeric_scale as scale
      from information_schema.columns where table_schema = 'public'`;
  } finally {
    await sql.end();
  }
}

/** Every rule a migrated database breaks, as readable lines; empty means it follows the rules. */
function ruleBreaks(columns: Column[]): string[] {
  const byTable = new Map<string, Column[]>();
  for (const column of columns) byTable.set(column.table, [...(byTable.get(column.table) ?? []), column]);
  const breaks: string[] = [];
  for (const [table, tableColumns] of byTable) {
    const type = (name: string) => tableColumns.find((column) => column.column === name)?.type;
    if (type("id") !== "uuid") breaks.push(`${table}: id is not a uuid`);
    // Better Auth tables keep its column shapes, but their ids must still be uuid (ADR 0029).
    if (LIBRARY_OWNED.has(table)) continue;
    for (const name of ["created_at", "updated_at"]) {
      if (type(name) !== "timestamp with time zone") breaks.push(`${table}: ${name} missing or not timestamptz`);
    }
    if (type("created_by") !== "uuid") breaks.push(`${table}: created_by missing`);
    if (!APPEND_ONLY.has(table) && !type("deleted_at")) breaks.push(`${table}: deleted_at missing (soft delete)`);
    for (const column of tableColumns) {
      const name = `${table}.${column.column}`;
      if (column.type === "numeric" && !NUMERIC_TYPES.has(`${column.precision},${column.scale}`)) {
        breaks.push(`${name}: numeric(${column.precision},${column.scale}) is not an allowed precision`);
      }
      if ((column.type === "double precision" || column.type === "real") && !FLOAT_ALLOWED.has(name)) {
        breaks.push(`${name}: floating point`);
      }
    }
  }
  return breaks;
}

describe("table rules (blueprint p15, p23)", () => {
  const scratch: { url: string; drop: () => Promise<void> }[] = [];

  beforeAll(async () => {
    scratch.push(await scratchDatabase("rules_control"), await scratchDatabase("rules_company"));
    await migrateControl(scratch[0].url);
    await migrateCompany(scratch[1].url);
  });

  afterAll(async () => {
    for (const database of scratch) await database.drop();
  });

  it("the control database follows them", async () => {
    expect(ruleBreaks(await columnsOf(scratch[0].url))).toEqual([]);
  });

  it("every company table follows them", async () => {
    const columns = await columnsOf(scratch[1].url);
    expect(new Set(columns.map((column) => column.table)).size).toBeGreaterThan(60);
    expect(ruleBreaks(columns)).toEqual([]);
  });
});
