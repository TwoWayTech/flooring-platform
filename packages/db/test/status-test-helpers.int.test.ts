import { randomBytes } from "node:crypto";
import { NoopProvisioner } from "@workspace/providers";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openControlDb, type ControlDb } from "../src";
import { planLimits, planModules, plans, products, tenantSubscriptions, tenants } from "../src/control";
import { seedTestCompany } from "../src/seed";
import { clearTestStatus, readStatusFacts, removeTestPlans, scratchDatabase } from "../src/testing";

// The api-mode Playwright spec for plans and company status (docs/specs/platform-admin.md, part 2)
// suspends Summit and creates `e2e-` plans through the real API, then cleans up through these
// helpers; this pins that they touch only Summit's status and only unused `e2e-` plans.
describe("status and plan test helpers", () => {
  const scratch: { url: string; drop: () => Promise<void> }[] = [];
  let url = "";
  let control: { db: ControlDb; close: () => Promise<void> };

  beforeAll(async () => {
    scratch.push(await scratchDatabase("status_control"), await scratchDatabase("status_company"));
    url = scratch[0].url;
    await seedTestCompany({
      controlUrl: url,
      encryptionKey: randomBytes(32).toString("base64"),
      provisioner: new NoopProvisioner(scratch[1].url),
      provider: "noop",
      userPassword: randomBytes(12).toString("base64url"),
    });
    control = openControlDb(url, { max: 2 });
  });

  afterAll(async () => {
    await control.close();
    for (const database of scratch) await database.drop();
  });

  /** Sets Summit's status by a plain update, as a suspend or cancel would. */
  async function setSummitStatus(status: "trial" | "active" | "past_due" | "suspended" | "cancelled") {
    await control.db.update(tenants).set({ status }).where(eq(tenants.slug, "summit"));
  }

  /** Every subscription row, in a fixed order, to compare before and after. */
  const subscriptionRows = () => control.db.select().from(tenantSubscriptions).orderBy(asc(tenantSubscriptions.id));

  /** Every company's status and stamp except Summit's. */
  async function otherCompanies() {
    const rows = await control.db
      .select({ slug: tenants.slug, status: tenants.status, statusChangedAt: tenants.statusChangedAt })
      .from(tenants)
      .orderBy(asc(tenants.slug));
    return rows.filter((row) => row.slug !== "summit");
  }

  /** Inserts a plan with a module row and a limits row; returns its id. */
  async function insertPlan(key: string): Promise<string> {
    const [product] = await control.db.select({ id: products.id }).from(products).where(eq(products.key, "flooring"));
    const [plan] = await control.db
      .insert(plans)
      .values({ key, name: key, productId: product.id, monthlyPrice: "49.00", yearlyPrice: "490.00" })
      .returning({ id: plans.id });
    await control.db.insert(planModules).values({ planId: plan.id, module: "core" });
    await control.db.insert(planLimits).values({ planId: plan.id, maxUsers: 5, maxBranches: 1 });
    return plan.id;
  }

  /** The plan keys that exist now, sorted. */
  async function planKeys(): Promise<string[]> {
    const rows = await control.db.select({ key: plans.key }).from(plans);
    return rows.map((row) => row.key).sort();
  }

  it("H-1 reads Summit's facts and changes nothing", async () => {
    const rowsBefore = await subscriptionRows();
    const first = await readStatusFacts(url, "summit");
    const second = await readStatusFacts(url, "summit");
    expect(first.status).toBe("active");
    expect(first.statusChangedAt).toBeInstanceOf(Date);
    expect(first.tenantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toEqual(first);
    expect(await subscriptionRows()).toEqual(rowsBefore);
  });

  it("H-2 refuses harbor and an unknown slug before anything changes", async () => {
    await insertPlan("e2e-refusal-probe");
    const before = { facts: await readStatusFacts(url, "summit"), keys: await planKeys() };
    await setSummitStatus("suspended");
    const suspended = await readStatusFacts(url, "summit");
    const calls: (() => Promise<unknown>)[] = [
      () => readStatusFacts(url, "harbor"),
      () => readStatusFacts(url, "no-such-company"),
      () => clearTestStatus(url, "harbor"),
      () => clearTestStatus(url, "no-such-company"),
    ];
    for (const call of calls)
      await expect(call()).rejects.toThrow(/only touches the seeded company with the slug summit/);
    expect(await readStatusFacts(url, "summit")).toEqual(suspended);
    expect(await planKeys()).toEqual([...before.keys]);
    await clearTestStatus(url, "summit");
    await removeTestPlans(url);
  });

  it("H-2 refuses a connection string that is not a database before reading anything", async () => {
    await expect(readStatusFacts("not-a-url", "harbor")).rejects.toThrow(/only touches/);
  });

  it("H-3 moves a suspended or cancelled Summit to active and leaves every other state, row and company alone", async () => {
    const rowsBefore = await subscriptionRows();
    const othersBefore = await otherCompanies();

    for (const status of ["suspended", "cancelled"] as const) {
      await setSummitStatus(status);
      const stamped = await readStatusFacts(url, "summit");
      expect(stamped.status).toBe(status);
      expect(await clearTestStatus(url, "summit")).toEqual([`status ${status} set back to active`]);
      const after = await readStatusFacts(url, "summit");
      expect(after.status).toBe("active");
      // The control trigger stamped the change itself; the helper never switches it off.
      expect(after.statusChangedAt.getTime()).toBeGreaterThanOrEqual(stamped.statusChangedAt.getTime());
    }

    for (const status of ["active", "trial", "past_due"] as const) {
      await setSummitStatus(status);
      const before = await readStatusFacts(url, "summit");
      expect(await clearTestStatus(url, "summit")).toEqual([]);
      expect(await readStatusFacts(url, "summit")).toEqual(before);
    }
    await setSummitStatus("active");

    expect(await subscriptionRows()).toEqual(rowsBefore);
    expect(await otherCompanies()).toEqual(othersBefore);
  });

  it("H-4 removes only unused e2e- plans with their module and limit rows", async () => {
    const seededKeys = await planKeys();
    expect(seededKeys.length).toBeGreaterThan(0);
    expect(seededKeys.some((key) => key.startsWith("e2e-"))).toBe(false);
    const lookalike = await insertPlan("not-e2e-plan");
    const first = await insertPlan("e2e-first");
    const second = await insertPlan("e2e-second");

    const removed = await removeTestPlans(url);
    expect(removed.sort()).toEqual(["e2e-first", "e2e-second"]);
    expect(await planKeys()).toEqual([...seededKeys, "not-e2e-plan"].sort());
    for (const id of [first, second]) {
      expect(await control.db.select().from(planModules).where(eq(planModules.planId, id))).toEqual([]);
      expect(await control.db.select().from(planLimits).where(eq(planLimits.planId, id))).toEqual([]);
    }
    expect(await control.db.select().from(planModules).where(eq(planModules.planId, lookalike))).toHaveLength(1);
    expect(await control.db.select().from(planLimits).where(eq(planLimits.planId, lookalike))).toHaveLength(1);
    expect(await removeTestPlans(url)).toEqual([]);
  });

  it("H-4 throws for an e2e- plan a subscription names, deleted rows included, and removes nothing", async () => {
    const [summit] = await control.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, "summit"));
    const [existing] = await control.db.select().from(tenantSubscriptions).limit(1);
    const used = await insertPlan("e2e-used");
    const spare = await insertPlan("e2e-spare");
    const keysBefore = await planKeys();
    const [row] = await control.db
      .insert(tenantSubscriptions)
      .values({
        tenantId: summit.id,
        planId: used,
        interval: "monthly",
        price: "0.00",
        currentPeriodStart: existing.currentPeriodStart,
        currentPeriodEnd: existing.currentPeriodEnd,
        status: "cancelled",
        deletedAt: new Date(),
      })
      .returning({ id: tenantSubscriptions.id });

    await expect(removeTestPlans(url)).rejects.toThrow(/e2e-used/);
    expect(await planKeys()).toEqual(keysBefore);
    expect(await control.db.select().from(planModules).where(eq(planModules.planId, spare))).toHaveLength(1);
    expect(await control.db.select().from(planLimits).where(eq(planLimits.planId, used))).toHaveLength(1);

    await control.db.delete(tenantSubscriptions).where(eq(tenantSubscriptions.id, row.id));
    expect((await removeTestPlans(url)).sort()).toEqual(["e2e-spare", "e2e-used"]);
  });
});
