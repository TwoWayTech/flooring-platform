import { randomBytes } from "node:crypto";
import { NoopProvisioner } from "@workspace/providers";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openControlDb } from "../src";
import { supportAccessGrants, tenantSubscriptions, tenants, user } from "../src/control";
import { seedTestCompany } from "../src/seed";
import {
  clearTestStanding,
  ensureTestSupportAgent,
  insertSupportGrant,
  readStandingFacts,
  removeTestSupportAgent,
  restoreStandingFacts,
  scratchDatabase,
  setMaintenance,
  setPeriodEnd,
} from "../src/testing";

const DAY = 86_400_000;

// The api-mode Playwright spec for company standing (docs/specs/platform-admin.md, part 4) changes
// Summit's facts through these helpers and must put them back exactly; this pins that.
describe("standing test helpers", () => {
  const scratch: { url: string; drop: () => Promise<void> }[] = [];
  let url = "";

  beforeAll(async () => {
    scratch.push(await scratchDatabase("standing_control"), await scratchDatabase("standing_company"));
    url = scratch[0].url;
    await seedTestCompany({
      controlUrl: url,
      encryptionKey: randomBytes(32).toString("base64"),
      provisioner: new NoopProvisioner(scratch[1].url),
      provider: "noop",
      userPassword: randomBytes(12).toString("base64url"),
    });
  });

  afterAll(async () => {
    for (const database of scratch) await database.drop();
  });

  it("restores maintenance and period dates exactly and never touches the status", async () => {
    const before = await readStandingFacts(url, "summit");
    expect(before.subscriptions.length).toBeGreaterThan(0);
    await setMaintenance(url, "summit", "move");
    await setPeriodEnd(url, "summit", new Date(Date.now() - 20 * DAY));
    const during = await readStandingFacts(url, "summit");
    expect(during.maintenanceMode).toBe(true);
    expect(during.maintenanceReason).toBe("move");
    expect(during.subscriptions[0].currentPeriodEnd.getTime()).toBeLessThan(Date.now());
    await restoreStandingFacts(url, before);
    expect(await readStandingFacts(url, "summit")).toEqual(before);
  });

  it("refuses any company but summit and changes nothing when summit is already in full use", async () => {
    await expect(clearTestStanding(url, "harbor")).rejects.toThrow(/only touches/);
    const before = await readStandingFacts(url, "summit");
    expect(await clearTestStanding(url, "summit")).toEqual([]);
    expect(await readStandingFacts(url, "summit")).toEqual(before);
  });

  it("clears a leftover move maintenance and ended rows, and leaves a migration failure alone", async () => {
    const control = openControlDb(url, { max: 1 });
    try {
      await setMaintenance(url, "summit", "move");
      await setPeriodEnd(url, "summit", new Date(Date.now() - 3 * DAY));
      const changed = await clearTestStanding(url, "summit");
      expect(changed).toHaveLength(2);
      const after = await readStandingFacts(url, "summit");
      expect(after.maintenanceMode).toBe(false);
      for (const row of after.subscriptions) {
        expect(row.currentPeriodEnd.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
      }
      await control.db
        .update(tenants)
        .set({ maintenanceMode: true, maintenanceReason: "migration_failed" })
        .where(eq(tenants.id, after.tenantId));
      expect(await clearTestStanding(url, "summit")).toEqual([]);
      expect((await readStandingFacts(url, "summit")).maintenanceMode).toBe(true);
      await setMaintenance(url, "summit", null);
      const rows = await control.db.select().from(tenantSubscriptions);
      expect(rows.every((row) => row.status !== "cancelled")).toBe(true);
    } finally {
      await control.close();
    }
  });

  it("makes a requester that cannot sign in, a pending grant for it, and removes both", async () => {
    const agentId = await ensureTestSupportAgent(url);
    expect(await ensureTestSupportAgent(url)).toBe(agentId);
    const grantId = await insertSupportGrant(url, { slug: "summit", reason: "Checking roles", hours: 2 });
    const control = openControlDb(url, { max: 1 });
    try {
      const [agent] = await control.db.select().from(user).where(eq(user.id, agentId));
      expect(agent.name).toBe("Test Support Agent");
      expect(agent.emailVerified).toBe(false);
      const [grant] = await control.db.select().from(supportAccessGrants).where(eq(supportAccessGrants.id, grantId));
      expect(grant.adminUserId).toBe(agentId);
      expect(grant.createdBy).toBe(agentId);
      expect(grant.approvedAt).toBeNull();
      expect(grant.expiresAt.getTime()).toBeGreaterThan(Date.now() + 119 * 60_000);
      await removeTestSupportAgent(url);
      expect(await control.db.select().from(supportAccessGrants).where(eq(supportAccessGrants.id, grantId))).toEqual(
        [],
      );
      expect(await control.db.select().from(user).where(eq(user.id, agentId))).toEqual([]);
    } finally {
      await control.close();
    }
  });
});
