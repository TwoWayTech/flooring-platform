import { describe, expect, it } from "vitest";
import { FEATURES, featureForPath, type FeatureKey } from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

const DANA = "sm-usr-01";
const OFF = "This feature is switched off.";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** Summit open as Dana, its Owner. */
async function summit(): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId: DANA, viewAsRoleId: null });
  return store;
}

/** Runs `run` with these switches off, and puts them back whatever happens. */
async function withOff(keys: readonly FeatureKey[], run: () => Promise<void>): Promise<void> {
  const features = keys.map((key) => FEATURES[key] as { enabled: boolean });
  for (const feature of features) feature.enabled = false;
  try {
    await run();
  } finally {
    for (const feature of features) feature.enabled = true;
  }
}

/**
 * Settings → Users, Security roles and the Audit log follow their switches in the demo as on the API
 * (CLAUDE.md rules 1 and 13; whole-product check finding F-h, 2026-11-20).
 */
describe("DemoStore hides Users, Roles and the Audit log with their switches, as the API does", () => {
  it("refuses the Users writes while settings.users is off", async () => {
    const store = await summit();
    const roles = await store.listSettingsRoles();
    const sales = roles.find((role) => role.key === "sales")!;
    await withOff(["settings.users"], async () => {
      const invite = { name: "Nobody", email: "nobody@example.test", title: "", roleIds: [sales.id], branchId: "" };
      await expect(store.inviteUser(invite)).rejects.toThrow(OFF);
      await expect(store.updateUser(DANA, { title: "Owner" })).rejects.toThrow(OFF);
    });
  });

  it("refuses the role writes while settings.roles is off", async () => {
    const store = await summit();
    const sales = (await store.listSettingsRoles()).find((role) => role.key === "sales")!;
    await withOff(["settings.roles"], async () => {
      await expect(store.saveRole({ ...sales, description: "Changed" })).rejects.toThrow(OFF);
      await expect(store.resetRole(sales.id)).rejects.toThrow(OFF);
      await expect(store.deleteRole(sales.id)).rejects.toThrow(OFF);
    });
  });

  it("reads the people and the roles while either page is on, and neither with both off", async () => {
    const store = await summit();
    for (const key of ["settings.users", "settings.roles"] as const) {
      await withOff([key], async () => {
        expect((await store.listSettingsUsers()).length).toBeGreaterThan(0);
        expect((await store.listSettingsRoles()).length).toBeGreaterThan(0);
      });
    }
    await withOff(["settings.users", "settings.roles"], async () => {
      await expect(store.listSettingsUsers()).rejects.toThrow(OFF);
      await expect(store.listSettingsRoles()).rejects.toThrow(OFF);
    });
  });

  it("refuses the audit log while settings.audit is off", async () => {
    const store = await summit();
    expect((await store.list("audit")).length).toBeGreaterThanOrEqual(0);
    await withOff(["settings.audit"], async () => {
      await expect(store.list("audit")).rejects.toThrow(OFF);
    });
  });

  it("maps each page to its switch, so PageGate hides a typed address too", () => {
    for (const product of ["flooring", "hr"] as const) {
      expect(featureForPath(product, "/settings/users")).toBe("settings.users");
      expect(featureForPath(product, "/settings/roles")).toBe("settings.roles");
      expect(featureForPath(product, "/settings/audit")).toBe("settings.audit");
    }
  });
});
