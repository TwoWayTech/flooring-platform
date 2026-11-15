import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  offeredKeys,
  SUPPORT_OPEN_MESSAGE,
  SUPPORT_REASON_MESSAGE,
  type PermissionKey,
  type PlatformAccessPatch,
} from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

/** A Storage held in memory, so the demo's local-storage overlay can be read back in node. */
class MemoryStorage {
  private readonly items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
  /** Every stored value, for comparing the overlay before and after a call. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.items);
  }
}

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

const REASON = "Checking the roles the Owner asked about";

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  // Object.keys(localStorage) lists the stored keys in a browser; the proxy gives the same here.
  const proxied = new Proxy(storage, {
    ownKeys: (target) => [...Object.keys(target.snapshot())],
    getOwnPropertyDescriptor: (target, key) =>
      typeof key === "string" && target.getItem(key) !== null
        ? { enumerable: true, configurable: true, value: target.getItem(key) }
        : undefined,
  });
  Object.defineProperty(globalThis, "localStorage", { value: proxied, configurable: true });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("demo platform console (part 3)", () => {
  it("writes nothing for a save that changes nothing, and one platform row for a real change", async () => {
    const store = new DemoStore(noFiles);
    const company = await store.getPlatformCompany("summit");
    expect(company).not.toBeNull();
    const before = storage.snapshot();

    const unchanged: PlatformAccessPatch = {
      ceiling: offeredKeys(["flooring"]).filter((k) => company!.ceiling.includes(k)),
    };
    await store.updatePlatformCompanyAccess("summit", unchanged);
    expect(storage.snapshot()).toEqual(before);
    expect((await store.listPlatformAudit({})).entries).toEqual([]);

    const ceiling = unchanged.ceiling!.filter((key) => key !== ("retail.sample.view" as PermissionKey));
    await store.updatePlatformCompanyAccess("summit", { ceiling });
    const { entries } = await store.listPlatformAudit({});
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "company.access_changed",
      company: { id: "summit", name: "Summit Floor Co." },
      details: { kind: "access_changed", keysRemoved: ["retail.sample.view"], keysAdded: [] },
    });
  });

  it("records a support request once, refuses a second while it is open, and resets", async () => {
    const store = new DemoStore(noFiles);
    await expect(store.requestSupportAccess({ companyId: "nowhere", reason: REASON, hours: 2 })).rejects.toThrow(
      "That company does not exist.",
    );
    // The body is checked before the company, as the API answers 400 before 404 ("Refusal order").
    await expect(store.requestSupportAccess({ companyId: "nowhere", reason: " short ", hours: 2 })).rejects.toThrow(
      SUPPORT_REASON_MESSAGE,
    );
    await expect(store.requestSupportAccess({ companyId: "summit", reason: " short ", hours: 2 })).rejects.toThrow(
      SUPPORT_REASON_MESSAGE,
    );

    const { id } = await store.requestSupportAccess({ companyId: "summit", reason: `  ${REASON}  `, hours: 2 });
    const [grant] = await store.listPlatformSupportGrants("summit");
    expect(grant).toMatchObject({ id, reason: REASON, status: "pending", mine: true });
    expect(Date.parse(grant!.expiresAt) - Date.parse(grant!.requestedAt)).toBe(2 * 3_600_000);
    await expect(store.requestSupportAccess({ companyId: "summit", reason: REASON, hours: 2 })).rejects.toThrow(
      SUPPORT_OPEN_MESSAGE,
    );
    expect(await store.listPlatformSupportGrants("keystone")).toEqual([]);

    const audit = await store.listPlatformAudit({ action: "support.requested" });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]?.details).toEqual({
      kind: "support_requested",
      reason: REASON,
      expiresAt: grant!.expiresAt,
    });

    await store.resetDemo();
    expect(await store.listPlatformSupportGrants("summit")).toEqual([]);
    expect((await store.listPlatformAudit({})).entries).toEqual([]);
  });
});
