import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS, migrateCompany, openCompanyDb } from "../src";
import { scratchDatabase } from "../src/testing";

/**
 * Company migrations 0005 and 0006 on a database that already holds data (owner decision 2026-11-15;
 * ADR 0048): the database is migrated up to 0004, filled with people and statements, then brought to
 * the newest version. Every live employee gets one since-records-began manager row, every approved or
 * paid statement stores the employee its rep's sign-in is linked to, so nothing worked out before
 * moves, and the new foreign keys are indexed.
 */
describe("migration 0005 backfill (needs the local PostgreSQL)", () => {
  let scratch: Awaited<ReturnType<typeof scratchDatabase>>;
  let sql: postgres.Sql;
  let folder = "";
  const id = {
    boss: uuidv7(),
    report: uuidv7(),
    gone: uuidv7(),
    linked: uuidv7(),
    unlinked: uuidv7(),
    draft: uuidv7(),
    paid: uuidv7(),
    removedLink: uuidv7(),
  };
  const users = { approved: uuidv7(), draft: uuidv7(), paid: uuidv7(), none: uuidv7(), removed: uuidv7() };
  const statements: Record<string, string> = {};

  beforeAll(async () => {
    scratch = await scratchDatabase("backfill_0005");
    // A copy of the migrations whose journal stops at 0004.
    folder = mkdtempSync(join(tmpdir(), "migrations-0004-"));
    cpSync(MIGRATIONS.company, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((entry) => entry.tag < "0005");
    writeFileSync(journalPath, JSON.stringify(journal));
    const old = openCompanyDb(scratch.url, { max: 1 });
    try {
      await migrate(old.db, { migrationsFolder: folder });
    } finally {
      await old.close();
    }
    sql = postgres(scratch.url, { max: 1, onnotice: () => undefined });
    const employee = (key: keyof typeof id, name: string, manager: string | null, deleted = false) =>
      sql`insert into employees (id, name, worker_type, pay_type, pay_rate, state, hired_at, status, flsa_status,
        manager_id, created_by, deleted_at)
        values (${id[key]}, ${name}, 'w2', 'hourly', '20.00', 'TX', '2024-01-08', 'active', 'non_exempt',
        ${manager}, ${uuidv7()}, ${deleted ? new Date() : null})`;
    await employee("boss", "Bea Boss", null);
    await employee("report", "Ray Report", id.boss);
    await employee("gone", "Gus Gone", id.boss, true);
    await employee("linked", "Lin Linked", null);
    await employee("unlinked", "Una Unlinked", null);
    await employee("draft", "Dru Draft", null);
    await employee("paid", "Pat Paid", null);
    await employee("removedLink", "Rex Removed", null, true);
    const profile = (user: string, employeeId: string | null, deleted = false) =>
      sql`insert into user_profiles (id, user_id, employee_id, deleted_at)
        values (${uuidv7()}, ${user}, ${employeeId}, ${deleted ? new Date() : null})`;
    await profile(users.approved, id.linked);
    await profile(users.draft, id.draft);
    await profile(users.paid, id.paid);
    await profile(users.removed, id.removedLink);
    const statement = async (key: keyof typeof users, status: string) => {
      statements[key] = uuidv7();
      await sql`insert into commission_statements (id, user_id, month, status)
        values (${statements[key]!}, ${users[key]}, '2026-09', ${status})`;
    };
    await statement("approved", "approved");
    await statement("draft", "draft");
    await statement("paid", "paid");
    await statement("none", "approved");
    await statement("removed", "approved");
    await migrateCompany(scratch.url);
  }, 120_000);

  afterAll(async () => {
    await sql.end();
    await scratch.drop();
    rmSync(folder, { recursive: true, force: true });
  });

  it("gives every live employee one since-records-began row with today's manager, and none to a deleted one", async () => {
    const rows = await sql<{ employee_id: string; manager_id: string | null; effective_from: string | null }[]>`
      select employee_id, manager_id, effective_from from employee_manager_history`;
    expect(rows.every((row) => row.effective_from === null)).toBe(true);
    const byEmployee = new Map(rows.map((row) => [row.employee_id, row.manager_id]));
    expect(rows).toHaveLength(6);
    expect(byEmployee.get(id.report)).toBe(id.boss);
    expect(byEmployee.get(id.boss)).toBeNull();
    expect(byEmployee.has(id.gone)).toBe(false);
    expect(byEmployee.has(id.removedLink)).toBe(false);
  });

  it("writes UUID v7 ids and the employee's creator on the backfilled rows", async () => {
    const rows = await sql<{ id: string; version: string; same: boolean }[]>`
      select h.id, substr(h.id::text, 15, 1) as version, h.created_by = e.created_by as same
      from employee_manager_history h join employees e on e.id = h.employee_id`;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.version).toBe("7");
      expect(row.same).toBe(true);
    }
  });

  it("stores the linked live employee on approved and paid statements only", async () => {
    const rows = await sql<{ user_id: string; employee_id: string | null }[]>`
      select user_id, employee_id from commission_statements`;
    const stored = new Map(rows.map((row) => [row.user_id, row.employee_id]));
    expect(stored.get(users.approved)).toBe(id.linked);
    expect(stored.get(users.paid)).toBe(id.paid);
    // A draft gets its employee when it is approved; no link, or a link to a deleted employee, stays null.
    expect(stored.get(users.draft)).toBeNull();
    expect(stored.get(users.none)).toBeNull();
    expect(stored.get(users.removed)).toBeNull();
  });

  it("indexes every foreign key the history and the stored employee add (migration 0006)", async () => {
    // Schema rule 5: the re-link guard filters the history by manager, and pay runs filter statements
    // by their stored employee, so each foreign key needs an index that leads with its column.
    const rows = await sql<{ name: string; indexed: boolean }[]>`
      select c.conname as name,
        exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]) as indexed
      from pg_constraint c
      where c.contype = 'f'
        and (c.conrelid = 'employee_manager_history'::regclass
          or c.conname = 'commission_statements_employee_id_employees_id_fk')`;
    expect(rows.map((row) => row.name).sort()).toEqual([
      "commission_statements_employee_id_employees_id_fk",
      "employee_manager_history_employee_id_employees_id_fk",
      "employee_manager_history_manager_id_employees_id_fk",
    ]);
    expect(rows.filter((row) => !row.indexed)).toEqual([]);
  });

  it("leaves every other column of the statements as it was", async () => {
    const rows = await sql<{ id: string; month: string; status: string }[]>`
      select id, month, status from commission_statements order by id`;
    expect(rows.map((row) => [row.id, row.month, row.status]).sort()).toEqual(
      [
        [statements.approved, "2026-09", "approved"],
        [statements.draft, "2026-09", "draft"],
        [statements.paid, "2026-09", "paid"],
        [statements.none, "2026-09", "approved"],
        [statements.removed, "2026-09", "approved"],
      ].sort(),
    );
  });
});
