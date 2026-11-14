import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateCompany } from "../src";
import { scratchDatabase } from "../src/testing";

/**
 * One live sign-in per employee (owner decision 2026-11-14, ADR 0049; migration 0004): a second
 * live profile linked to the same employee is refused by `user_profiles_employee_uidx`, while
 * unlinked (NULL) and deleted profiles never count.
 */
describe("user_profiles sign-in link (needs the local PostgreSQL)", () => {
  const scratch: Awaited<ReturnType<typeof scratchDatabase>>[] = [];
  let sql: postgres.Sql;
  let employee = "";

  beforeAll(async () => {
    scratch.push(await scratchDatabase("profiles_company"));
    await migrateCompany(scratch[0].url);
    sql = postgres(scratch[0].url, { max: 1, onnotice: () => undefined });
    employee = uuidv7();
    await sql`insert into employees (id, name, worker_type, pay_type, pay_rate, state, hired_at, status, flsa_status)
      values (${employee}, 'Test Person', 'w2', 'hourly', '20.00', 'TX', '2024-01-08', 'active', 'non_exempt')`;
  });

  afterAll(async () => {
    await sql.end();
    for (const db of scratch) await db.drop();
  });

  /** Adds a profile for a new user, linked to `employeeId`, deleted when `deleted` is set. */
  async function profile(employeeId: string | null, deleted = false) {
    const id = uuidv7();
    await sql`insert into user_profiles (id, user_id, employee_id, deleted_at)
      values (${id}, ${uuidv7()}, ${employeeId}, ${deleted ? new Date() : null})`;
    return id;
  }

  it("refuses a second live sign-in linked to the same employee", async () => {
    await profile(employee);
    await expect(profile(employee)).rejects.toMatchObject({
      code: "23505",
      constraint_name: "user_profiles_employee_uidx",
    });
  });

  it("ignores unlinked and deleted profiles", async () => {
    await profile(null);
    await profile(null);
    await profile(employee, true);
    const [{ count }] = await sql<{ count: string }[]>`select count(*) as count from user_profiles
      where employee_id = ${employee}`;
    expect(count).toBe("2");
  });

  it("lets a link move once the old profile is unlinked or deleted", async () => {
    const other = uuidv7();
    await sql`insert into employees (id, name, worker_type, pay_type, pay_rate, state, hired_at, status, flsa_status)
      values (${other}, 'Other Person', 'w2', 'hourly', '20.00', 'TX', '2024-01-08', 'active', 'non_exempt')`;
    const first = await profile(other);
    await sql`update user_profiles set deleted_at = now() where id = ${first}`;
    const second = await profile(other);
    await sql`update user_profiles set employee_id = null where id = ${second}`;
    await expect(profile(other)).resolves.toBeTruthy();
  });
});
