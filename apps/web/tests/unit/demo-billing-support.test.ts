import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BILLING_OWNER_ONLY_MESSAGE,
  FEATURES,
  SUPPORT_CLOSED_MESSAGES,
  SUPPORT_OWNER_ONLY_MESSAGE,
} from "@workspace/shared";
import { demoBilling } from "@/lib/api/demo/company-standing";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

/** A Storage held in memory, so the demo's local-storage overlay can be read back in node. */
class MemoryStorage {
  private readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  /** Every stored key, as Object.keys(localStorage) lists them in a browser. */
  keys(): string[] {
    return [...this.items.keys()];
  }
}

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

const SUMMIT_OWNER = "sm-usr-01";
const SUMMIT_MANAGER = "sm-usr-02";
const REASON = "Checking the roles the Owner asked about";
const HOUR = 3_600_000;

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  const proxied = new Proxy(storage, {
    ownKeys: (target) => target.keys(),
    getOwnPropertyDescriptor: (target, key) =>
      typeof key === "string" && target.getItem(key) !== null
        ? { enumerable: true, configurable: true, value: target.getItem(key) }
        : undefined,
  });
  Object.defineProperty(globalThis, "localStorage", { value: proxied, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "localStorage");
});

/** A demo store with Summit open for one of its people. */
async function summitAs(userId: string): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId, viewAsRoleId: null });
  return store;
}

/** The platform audit rows the demo stored, as written. */
function storedPlatformRows(): { action: string; before: unknown; after: unknown; tenantId: string }[] {
  return JSON.parse(storage.getItem("fp-demo:v2:platform-audit") ?? "[]");
}

describe("demo standing and billing (part 4)", () => {
  it("is always in full use, and shows the Owner the stand-in plan with no notice", async () => {
    const store = await summitAs(SUMMIT_OWNER);
    expect(await store.getCompanyStanding()).toEqual({ state: "full" });
    const billing = await store.getCompanyBilling();
    expect(Object.keys(billing).sort()).toEqual(["limits", "notice", "phase", "status", "subscriptions"]);
    expect(billing).toMatchObject({
      status: "active",
      phase: "full",
      limits: { userLimit: 16, branchLimit: 3 },
      notice: null,
    });
    expect(billing.subscriptions).toHaveLength(1);
    expect(billing.subscriptions[0]).toMatchObject({
      planName: "Flooring Pro",
      product: "flooring",
      interval: "monthly",
      standing: "current",
    });
    expect(Object.keys(billing.subscriptions[0]!).sort()).toEqual([
      "currentPeriodEnd",
      "currentPeriodStart",
      "interval",
      "planName",
      "product",
      "standing",
    ]);
  });

  it("never reads the clock, so the end of a month in UTC shows no false overdue (C5)", async () => {
    const store = await summitAs(SUMMIT_OWNER);
    const summit = (await store.listCompanies()).find((company) => company.id === "summit")!;
    vi.useFakeTimers({ now: new Date("2026-12-01T03:00:00Z") });
    const billing = demoBilling(summit, "2026-11-30");
    expect(billing.notice).toBeNull();
    expect(billing.subscriptions[0]?.standing).toBe("current");
  });

  it("refuses billing and support access to anyone but the Owner, with the API's words", async () => {
    const store = await summitAs(SUMMIT_MANAGER);
    await expect(store.getCompanyBilling()).rejects.toThrow(BILLING_OWNER_ONLY_MESSAGE);
    await expect(store.listSupportGrants()).rejects.toThrow(SUPPORT_OWNER_ONLY_MESSAGE);
    await expect(store.approveSupportGrant("summit-sup-1")).rejects.toThrow(SUPPORT_OWNER_ONLY_MESSAGE);
    await expect(store.revokeSupportGrant("summit-sup-1")).rejects.toThrow(SUPPORT_OWNER_ONLY_MESSAGE);
    expect(await store.getCompanyStanding()).toEqual({ state: "full" });
  });

  it("refuses billing to everyone while settings.billing is off, before the Owner check", async () => {
    const feature = FEATURES["settings.billing"] as { enabled: boolean };
    feature.enabled = false;
    try {
      await expect((await summitAs(SUMMIT_OWNER)).getCompanyBilling()).rejects.toThrow("This feature is switched off.");
      await expect((await summitAs(SUMMIT_MANAGER)).getCompanyBilling()).rejects.toThrow(
        "This feature is switched off.",
      );
    } finally {
      feature.enabled = true;
    }
  });
});

describe("demo support access for the Owner (part 4)", () => {
  it("refuses requests, the list and both decisions while settings.users is off, as the API does", async () => {
    const store = await summitAs(SUMMIT_OWNER);
    const { id } = await store.requestSupportAccess({ companyId: "summit", reason: REASON, hours: 2 });
    const feature = FEATURES["settings.users"] as { enabled: boolean };
    feature.enabled = false;
    try {
      const off = "This feature is switched off.";
      await expect(store.requestSupportAccess({ companyId: "summit", reason: REASON, hours: 2 })).rejects.toThrow(off);
      await expect(store.listSupportGrants()).rejects.toThrow(off);
      await expect(store.approveSupportGrant(id)).rejects.toThrow(off);
      await expect(store.revokeSupportGrant(id)).rejects.toThrow(off);
    } finally {
      feature.enabled = true;
    }
    expect((await store.listSupportGrants()).map((grant) => [grant.id, grant.status])).toEqual([[id, "pending"]]);
  });

  it("lists the console's request, and approves then revokes it with both log rows", async () => {
    const store = await summitAs(SUMMIT_OWNER);
    const { id } = await store.requestSupportAccess({ companyId: "summit", reason: REASON, hours: 2 });

    const [listed] = await store.listSupportGrants();
    expect(listed).toMatchObject({ id, adminName: "Platform admin", reason: REASON, status: "pending" });
    expect(Object.keys(listed!).sort()).toEqual(["adminName", "expiresAt", "id", "reason", "requestedAt", "status"]);

    await store.approveSupportGrant(id);
    expect((await store.listSupportGrants())[0]?.status).toBe("approved");
    await expect(store.approveSupportGrant(id)).rejects.toThrow(SUPPORT_CLOSED_MESSAGES.approve);

    await store.revokeSupportGrant(id);
    expect((await store.listSupportGrants())[0]?.status).toBe("revoked");
    await expect(store.revokeSupportGrant(id)).rejects.toThrow(SUPPORT_CLOSED_MESSAGES.revoke);

    const audit = (await store.list("audit")).filter((entry) => entry.target === "Support access");
    expect(audit.map((entry) => [entry.action, entry.category, entry.before, entry.after]).sort()).toEqual([
      ["Approved support access", "security", null, null],
      ["Revoked support access", "security", null, null],
    ]);
    const decisions = storedPlatformRows().filter((row) => row.action !== "support.requested");
    expect(decisions).toEqual([
      expect.objectContaining({ action: "support.approved", tenantId: "summit", before: null, after: null }),
      expect.objectContaining({ action: "support.revoked", tenantId: "summit", before: null, after: null }),
    ]);
    const consoleList = await store.listPlatformSupportGrants("summit");
    expect(consoleList[0]?.status).toBe("revoked");
  });

  it("can't approve an expired request", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-15T09:00:00Z"), toFake: ["Date"] });
    const store = await summitAs(SUMMIT_OWNER);
    const { id } = await store.requestSupportAccess({ companyId: "summit", reason: REASON, hours: 1 });
    vi.setSystemTime(new Date(Date.parse("2026-11-15T09:00:00Z") + HOUR));
    expect((await store.listSupportGrants())[0]?.status).toBe("expired");
    await expect(store.approveSupportGrant(id)).rejects.toThrow(SUPPORT_CLOSED_MESSAGES.approve);
    await expect(store.revokeSupportGrant(id)).rejects.toThrow(SUPPORT_CLOSED_MESSAGES.revoke);
  });

  it("neither lists nor decides another company's request", async () => {
    const store = await summitAs(SUMMIT_OWNER);
    const { id } = await store.requestSupportAccess({ companyId: "keystone", reason: REASON, hours: 2 });
    expect(await store.listSupportGrants()).toEqual([]);
    await expect(store.approveSupportGrant(id)).rejects.toThrow(SUPPORT_CLOSED_MESSAGES.approve);
    await expect(store.revokeSupportGrant(id)).rejects.toThrow(SUPPORT_CLOSED_MESSAGES.revoke);
    expect((await store.listPlatformSupportGrants("keystone"))[0]?.status).toBe("pending");
  });
});
