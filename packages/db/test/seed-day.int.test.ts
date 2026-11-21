import { randomBytes } from "node:crypto";
import { NoopProvisioner } from "@workspace/providers";
import { addDays, dayInZone } from "@workspace/shared";
import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openCompanyDb, openControlDb } from "../src";
import { invoices, timesheets } from "../src/company";
import { tenants } from "../src/control";
import { seedTestCompany, type SeedOptions } from "../src/seed";
import { loadDemoCompany } from "../src/seed/fixtures";
import { anchorDayFor } from "../src/seed/seed-day";
import { scratchDatabase } from "../src/testing";

const fixtures = loadDemoCompany("summit").fixtures;

/** The newest invoice's issue day, as stored. */
async function newestInvoiceDay(url: string): Promise<string> {
  const company = openCompanyDb(url, { max: 1 });
  try {
    const [newest] = await company.db.select().from(invoices).orderBy(desc(invoices.issuedAt)).limit(1);
    return newest!.issuedAt.toISOString().slice(0, 10);
  } finally {
    await company.close();
  }
}

describe("the seed moves the fixtures to the day the company was first seeded (findings #3, #4)", () => {
  const scratch: { url: string; drop: () => Promise<void> }[] = [];
  let options: SeedOptions;
  let tenantId = "";
  let seedDay = "";

  beforeAll(async () => {
    scratch.push(await scratchDatabase("seedday_control"), await scratchDatabase("seedday_company"));
    options = {
      controlUrl: scratch[0].url,
      encryptionKey: randomBytes(32).toString("base64"),
      provisioner: new NoopProvisioner(scratch[1].url),
      provider: "noop",
    };
    tenantId = await seedTestCompany(options);
    const control = openControlDb(scratch[0].url, { max: 1 });
    try {
      const [tenant] = await control.db.select().from(tenants).where(eq(tenants.id, tenantId));
      seedDay = dayInZone(tenant!.createdAt, tenant!.timeZone);
    } finally {
      await control.close();
    }
  });

  afterAll(async () => {
    for (const database of scratch) await database.drop();
  });

  it("lands the newest invoice where the anchor lands: on or up to 6 days before the seed day", async () => {
    const newestFixture = fixtures.invoices
      .map((invoice) => invoice.issuedAt.slice(0, 10))
      .sort()
      .at(-1)!;
    expect(newestFixture).toBe(fixtures.anchorDate);
    expect(await newestInvoiceDay(scratch[1].url)).toBe(anchorDayFor(fixtures.anchorDate, seedDay));
  });

  it("keeps timesheet weeks on Mondays", async () => {
    const company = openCompanyDb(scratch[1].url, { max: 1 });
    try {
      const notMonday = await company.db
        .select({ weekStart: timesheets.weekStart })
        .from(timesheets)
        .where(sql`extract(isodow from ${timesheets.weekStart}) <> 1`);
      expect(notMonday).toEqual([]);
    } finally {
      await company.close();
    }
  });

  it("never shifts twice: a re-seed on a later day keeps the first seed's dates", async () => {
    const control = openControlDb(scratch[0].url, { max: 1 });
    try {
      // As if the first seed ran 30 days ago: the re-seed must read that day and change nothing.
      await control.db
        .update(tenants)
        .set({ createdAt: sql`${tenants.createdAt} - interval '30 days'` })
        .where(eq(tenants.id, tenantId));
    } finally {
      await control.close();
    }
    const before = await newestInvoiceDay(scratch[1].url);
    await seedTestCompany(options);
    expect(await newestInvoiceDay(scratch[1].url)).toBe(before);
    expect(before).toBe(anchorDayFor(fixtures.anchorDate, seedDay));
    expect(anchorDayFor(fixtures.anchorDate, addDays(seedDay, -30))).not.toBe(before);
  });
});
