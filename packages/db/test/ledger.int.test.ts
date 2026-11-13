import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateCompany } from "../src";
import { scratchDatabase } from "../src/testing";

/**
 * The ledger's database guarantees (ADR 0039; blueprint page 48): balanced entries at commit,
 * one-sided lines, no posting into a closed period, and no change to what was posted.
 */
describe("ledger tables (needs the local PostgreSQL)", () => {
  const scratch: Awaited<ReturnType<typeof scratchDatabase>>[] = [];
  let sql: postgres.Sql;
  let cash = "";
  let sales = "";

  beforeAll(async () => {
    scratch.push(await scratchDatabase("ledger_company"));
    await migrateCompany(scratch[0].url);
    sql = postgres(scratch[0].url, { max: 1, onnotice: () => undefined });
    cash = uuidv7();
    sales = uuidv7();
    await sql`insert into ledger_accounts (id, key, code, name, type) values
      (${cash}, 'cash', '1000', 'Cash and Bank', 'asset'),
      (${sales}, 'sales', '4000', 'Sales', 'revenue')`;
  });

  afterAll(async () => {
    await sql.end();
    for (const db of scratch) await db.drop();
  });

  /** Posts one entry with the given lines in one transaction. */
  async function post(date: string, lines: [string, string, string][]) {
    const id = uuidv7();
    await sql.begin(async (tx) => {
      await tx`insert into journal_entries (id, date, event, source_type, source_id, source_number)
        values (${id}, ${date}, 'test', 'invoice', ${uuidv7()}, 'T-1')`;
      for (const [account, debit, credit] of lines) {
        await tx`insert into journal_lines (id, entry_id, account_id, debit, credit)
          values (${uuidv7()}, ${id}, ${account}, ${debit}, ${credit})`;
      }
    });
    return id;
  }

  it("takes a balanced entry and refuses one that does not balance at commit", async () => {
    const id = await post("2026-11-01", [
      [cash, "10.00", "0"],
      [sales, "0", "10.00"],
    ]);
    expect(id).toBeTruthy();
    await expect(
      post("2026-11-01", [
        [cash, "10.00", "0"],
        [sales, "0", "9.99"],
      ]),
    ).rejects.toThrow(/does not balance/);
    await expect(post("2026-11-01", [[cash, "10.00", "0"]])).rejects.toThrow(/does not balance/);
  });

  it("refuses two-sided, empty and negative lines", async () => {
    await expect(
      post("2026-11-01", [
        [cash, "5.00", "5.00"],
        [sales, "0", "0"],
      ]),
    ).rejects.toThrow(/one_sided/);
    await expect(
      post("2026-11-01", [
        [cash, "-5.00", "0"],
        [sales, "0", "-5.00"],
      ]),
    ).rejects.toThrow(/one_sided/);
  });

  it("never adds lines to an entry posted earlier, even in balance", async () => {
    const id = await post("2026-11-03", [
      [cash, "2.00", "0"],
      [sales, "0", "2.00"],
    ]);
    await expect(
      sql.begin(async (tx) => {
        await tx`insert into journal_lines (id, entry_id, account_id, debit, credit) values
          (${uuidv7()}, ${id}, ${cash}, 5, 0), (${uuidv7()}, ${id}, ${sales}, 0, 5)`;
      }),
    ).rejects.toThrow(/already posted/);
  });

  it("never changes or deletes what was posted", async () => {
    await expect(sql`update journal_lines set debit = debit + 1`).rejects.toThrow(/append-only/);
    await expect(sql`delete from journal_entries`).rejects.toThrow(/append-only/);
    await expect(sql`truncate journal_lines`).rejects.toThrow(/append-only/);
  });

  it("refuses entries dated on or before the last closed day", async () => {
    await sql`insert into period_closes (id, closed_through) values (${uuidv7()}, '2026-10-31')`;
    await expect(
      post("2026-10-31", [
        [cash, "1.00", "0"],
        [sales, "0", "1.00"],
      ]),
    ).rejects.toThrow(/closed through/);
    await post("2026-11-02", [
      [cash, "1.00", "0"],
      [sales, "0", "1.00"],
    ]);
    await expect(sql`update period_closes set closed_through = '2026-01-01'`).rejects.toThrow(/append-only/);
    // Reopening is a newer close with an earlier day; the newest decides.
    await sql`insert into period_closes (id, closed_through) values (${uuidv7()}, '2026-01-01')`;
    await post("2026-10-31", [
      [cash, "1.00", "0"],
      [sales, "0", "1.00"],
    ]);
  });
});
