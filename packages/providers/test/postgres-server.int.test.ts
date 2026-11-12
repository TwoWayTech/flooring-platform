import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { PostgresServerProvisioner } from "../src";

const adminUrl = process.env.TENANT_DB_ADMIN_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const provisioner = new PostgresServerProvisioner(adminUrl);
const slug = `itest_${process.pid}`;

describe("PostgresServerProvisioner (needs the local PostgreSQL)", () => {
  afterAll(async () => {
    await provisioner.drop(`company_${slug}`);
  });

  it("creates a database its own login can use, and drops both", async () => {
    const created = await provisioner.create({ tenantId: "t-itest", slug });

    const sql = postgres(created.connectionUrl, { max: 1 });
    const [row] = await sql`select current_database() as db, current_user as role`;
    await sql.end();
    expect(row).toEqual({ db: `company_${slug}`, role: `company_${slug}` });

    await provisioner.drop(created.providerRef);
    const admin = postgres(adminUrl, { max: 1 });
    const left = await admin`select 1 from pg_database where datname = ${created.providerRef}`;
    await admin.end();
    expect(left).toHaveLength(0);
  });
});
