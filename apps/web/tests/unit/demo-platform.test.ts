import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FEATURES,
  offeredKeys,
  PLAN_MESSAGES,
  PLATFORM_AUDIT_QUERY_MESSAGES,
  STATUS_ACTION_MESSAGES,
  SUPPORT_OPEN_MESSAGE,
  SUPPORT_REASON_MESSAGE,
  type PermissionKey,
  type PlatformAccessPatch,
  type PlatformPlanInput,
} from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";
import { apiErrorCode } from "@/lib/api/errors";

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

/** The refusal a call ends with: its message and its code (`apiErrorCode`), or a failed test. */
async function refusalOf(call: Promise<unknown>): Promise<{ message: string; code: string | null }> {
  try {
    await call;
  } catch (failure) {
    return { message: failure instanceof Error ? failure.message : String(failure), code: apiErrorCode(failure) };
  }
  throw new Error("The call went through.");
}

const PLAN_REASON = "New entry plan the owner asked to try";

/** A complete new plan, as the plan dialog sends it. */
const STARTER: PlatformPlanInput = {
  key: "e2e-starter",
  name: "E2E Starter",
  product: "flooring",
  monthlyPrice: "49",
  yearlyPrice: "490.00",
  modules: ["platform", "retail", "core"],
  maxUsers: 5,
  maxBranches: 1,
  reason: `  ${PLAN_REASON}  `,
};

describe("demo plans and company status (part 2, W-7)", () => {
  it("refuses every part 2 method and the seven audit filters while admin.billing is off; the rows still list", async () => {
    const store = new DemoStore(noFiles);
    await store.createPlatformPlan(STARTER);
    const feature = FEATURES["admin.billing"] as { enabled: boolean };
    feature.enabled = false;
    try {
      const off = "This feature is switched off.";
      await expect(store.listPlatformPlans()).rejects.toThrow(off);
      await expect(store.createPlatformPlan({ ...STARTER, key: "e2e-other" })).rejects.toThrow(off);
      await expect(store.updatePlatformPlan("e2e-starter", { name: "Other", reason: PLAN_REASON })).rejects.toThrow(
        off,
      );
      await expect(store.retirePlatformPlan("e2e-starter", PLAN_REASON)).rejects.toThrow(off);
      await expect(store.restorePlatformPlan("e2e-starter", PLAN_REASON)).rejects.toThrow(off);
      await expect(store.getPlatformCompanyStatus("summit")).rejects.toThrow(off);
      await expect(
        store.changePlatformCompanyStatus("summit", { action: "suspend", reason: REASON, expectedStatus: "active" }),
      ).rejects.toThrow(off);
      await expect(store.listPlatformAudit({ action: "plan.created" })).rejects.toThrow(
        PLATFORM_AUDIT_QUERY_MESSAGES.action,
      );
      await expect(store.listPlatformAudit({ action: "company.suspended" })).rejects.toThrow(
        PLATFORM_AUDIT_QUERY_MESSAGES.action,
      );
      expect((await store.listPlatformAudit({ action: "support.requested" })).entries).toEqual([]);
      expect((await store.listPlatformAudit({})).entries.map((e) => e.action)).toEqual(["plan.created"]);
    } finally {
      feature.enabled = true;
    }
    expect((await store.listPlatformAudit({ action: "plan.created" })).entries).toHaveLength(1);
  });

  it("lists the fixture companies' plans as seeded, each in use", async () => {
    const plans = await new DemoStore(noFiles).listPlatformPlans();
    expect(plans.map((p) => [p.id, p.key, p.name, p.product, p.monthlyPrice, p.yearlyPrice, p.companies])).toEqual([
      ["flooring-pro", "flooring-pro", "Flooring Pro", "flooring", "0.00", "0.00", 1],
      ["flooring-wholesale", "flooring-wholesale", "Flooring Wholesale", "flooring", "0.00", "0.00", 1],
      ["hr-standard", "hr-standard", "HR Standard", "hr", "0.00", "0.00", 1],
    ]);
    expect(plans[0]).toMatchObject({
      modules: ["core", "retail", "installation", "contracts", "hr", "meetings"],
      maxUsers: 16,
      maxBranches: 3,
      active: true,
    });
  });

  it("creates, changes, retires and restores a plan with one audit row each, and refuses what the API refuses", async () => {
    const store = new DemoStore(noFiles);
    await expect(store.createPlatformPlan({ ...STARTER, monthlyPrice: "49,00" })).rejects.toThrow(
      PLAN_MESSAGES.monthlyPrice,
    );
    const created = await store.createPlatformPlan(STARTER);
    expect(created).toMatchObject({
      id: "e2e-starter",
      name: "E2E Starter",
      monthlyPrice: "49.00",
      yearlyPrice: "490.00",
      modules: ["core", "retail"],
      companies: 0,
      active: true,
    });
    expect(await refusalOf(store.createPlatformPlan(STARTER))).toEqual({
      message: PLAN_MESSAGES.keyTaken,
      code: "conflict",
    });
    expect(await refusalOf(store.createPlatformPlan({ ...STARTER, key: "flooring-pro" }))).toEqual({
      message: PLAN_MESSAGES.keyTaken,
      code: "conflict",
    });

    const before = storage.snapshot();
    expect(await store.updatePlatformPlan("e2e-starter", { monthlyPrice: "49.0", reason: PLAN_REASON })).toEqual(
      created,
    );
    expect(storage.snapshot()).toEqual(before);
    const renamed = await store.updatePlatformPlan("e2e-starter", {
      name: "Starter",
      modules: ["core"],
      maxUsers: 6,
      reason: PLAN_REASON,
    });
    expect(renamed).toMatchObject({ name: "Starter", modules: ["core"], maxUsers: 6 });
    await expect(store.updatePlatformPlan("nowhere", { name: "X", reason: PLAN_REASON })).rejects.toThrow(
      PLAN_MESSAGES.notFound,
    );

    const retired = await store.retirePlatformPlan("e2e-starter", PLAN_REASON);
    expect(retired.active).toBe(false);
    expect(await refusalOf(store.retirePlatformPlan("e2e-starter", PLAN_REASON))).toEqual({
      message: PLAN_MESSAGES.alreadyRetired,
      code: "conflict",
    });
    await expect(store.restorePlatformPlan("e2e-starter", "short")).rejects.toThrow(SUPPORT_REASON_MESSAGE);
    expect((await store.restorePlatformPlan("e2e-starter", PLAN_REASON)).active).toBe(true);
    expect(await refusalOf(store.restorePlatformPlan("e2e-starter", PLAN_REASON))).toEqual({
      message: PLAN_MESSAGES.notRetired,
      code: "conflict",
    });
    expect((await store.listPlatformPlans()).find((p) => p.id === "e2e-starter")).toMatchObject({
      name: "Starter",
      active: true,
    });

    const { entries } = await store.listPlatformAudit({});
    // Rows written in one millisecond have no fixed order between them, so each is found by action.
    expect(entries.map((e) => e.action).sort()).toEqual([
      "plan.changed",
      "plan.created",
      "plan.restored",
      "plan.retired",
    ]);
    expect(entries.every((e) => e.company === null)).toBe(true);
    const row = (action: string) => entries.find((e) => e.action === action);
    expect(row("plan.created")?.details).toEqual({
      kind: "plan_created",
      key: "e2e-starter",
      name: "E2E Starter",
      product: "flooring",
      monthlyPrice: "49.00",
      yearlyPrice: "490.00",
      modules: ["core", "retail"],
      maxUsers: 5,
      maxBranches: 1,
      reason: PLAN_REASON,
    });
    expect(row("plan.changed")?.details).toEqual({
      kind: "plan_changed",
      changes: [
        { field: "name", from: "E2E Starter", to: "Starter" },
        { field: "modules", from: ["core", "retail"], to: ["core"] },
        { field: "maxUsers", from: 5, to: 6 },
      ],
      reason: PLAN_REASON,
    });
    expect(row("plan.retired")?.details).toEqual({ kind: "plan_active", active: false, reason: PLAN_REASON });
  });

  it("keeps a plan in use's modules and limits, with the API's code, and lets its name change", async () => {
    const store = new DemoStore(noFiles);
    expect(
      await refusalOf(store.updatePlatformPlan("flooring-pro", { modules: ["core"], reason: PLAN_REASON })),
    ).toEqual({ message: PLAN_MESSAGES.inUse, code: "rule_broken" });
    expect(await refusalOf(store.updatePlatformPlan("flooring-pro", { maxUsers: 20, reason: PLAN_REASON }))).toEqual({
      message: PLAN_MESSAGES.inUse,
      code: "rule_broken",
    });
    // The same visible modules in another order change nothing; the hidden Installation stays.
    const same = await store.updatePlatformPlan("flooring-pro", {
      modules: ["meetings", "hr", "contracts", "retail", "core"],
      reason: PLAN_REASON,
    });
    expect(same.modules).toEqual(["core", "retail", "installation", "contracts", "hr", "meetings"]);
    const renamed = await store.updatePlatformPlan("flooring-pro", { name: "Flooring Pro 2027", reason: PLAN_REASON });
    expect(renamed).toMatchObject({ name: "Flooring Pro 2027", maxUsers: 16, companies: 1 });
    // A demo company holds its own plan, modules and limits.
    expect(await store.getPlatformCompany("summit")).toMatchObject({ plan: "Flooring Pro", userLimit: 16 });
  });

  it("suspends, reinstates and cancels Summit in the console only, in the API's order", async () => {
    const store = new DemoStore(noFiles);
    const preview = await store.getPlatformCompanyStatus("summit");
    expect(preview).toMatchObject({ companyId: "summit", status: "active", phase: "full" });
    expect(preview?.actions.map((a) => [a.action, a.refusal?.code ?? null, a.next?.status ?? null])).toEqual([
      ["suspend", null, "suspended"],
      ["reinstate", "conflict", null],
      ["cancel", null, "cancelled"],
    ]);
    expect(await store.getPlatformCompanyStatus("nowhere")).toBeNull();

    // The body before the company, the company before the state (the API's refusal order).
    await expect(
      store.changePlatformCompanyStatus("nowhere", { action: "suspend", reason: "short", expectedStatus: "active" }),
    ).rejects.toThrow(SUPPORT_REASON_MESSAGE);
    await expect(
      store.changePlatformCompanyStatus("nowhere", { action: "suspend", reason: REASON, expectedStatus: "active" }),
    ).rejects.toThrow("That company does not exist.");

    const suspended = await store.changePlatformCompanyStatus("summit", {
      action: "suspend",
      reason: REASON,
      expectedStatus: "active",
    });
    expect(suspended).toMatchObject({ status: "suspended", phase: "read_only" });
    expect((await store.listPlatformCompanies()).find((c) => c.id === "summit")).toMatchObject({
      status: "suspended",
      phase: "read_only",
    });
    expect((await store.listPlatformCompanies()).find((c) => c.id === "keystone")).toMatchObject({
      status: "active",
      phase: "full",
    });
    // A second tab still showing "active" lost the race; a repeat says it is already done.
    expect(
      await refusalOf(
        store.changePlatformCompanyStatus("summit", { action: "suspend", reason: REASON, expectedStatus: "active" }),
      ),
    ).toEqual({ message: STATUS_ACTION_MESSAGES.changedMeanwhile, code: "conflict" });
    expect(
      await refusalOf(
        store.changePlatformCompanyStatus("summit", { action: "suspend", reason: REASON, expectedStatus: "suspended" }),
      ),
    ).toEqual({ message: STATUS_ACTION_MESSAGES.alreadySuspended, code: "conflict" });

    const reinstated = await store.changePlatformCompanyStatus("summit", {
      action: "reinstate",
      reason: REASON,
      expectedStatus: "suspended",
    });
    expect(reinstated).toMatchObject({ status: "active", phase: "full" });

    await expect(
      store.changePlatformCompanyStatus("summit", {
        action: "cancel",
        reason: REASON,
        expectedStatus: "active",
        confirmName: "summit floor co.",
      }),
    ).rejects.toThrow(STATUS_ACTION_MESSAGES.confirmName);
    const cancelled = await store.changePlatformCompanyStatus("summit", {
      action: "cancel",
      reason: REASON,
      expectedStatus: "active",
      confirmName: "Summit Floor Co.",
    });
    expect(cancelled).toMatchObject({ status: "cancelled", phase: "read_only" });
    expect(await store.getCompanyStanding()).toEqual({ state: "full" });
    expect((await store.listCompanies()).find((c) => c.id === "summit")?.status).toBe("active");

    const { entries } = await store.listPlatformAudit({ companyId: "summit" });
    expect(entries.map((e) => e.action).sort()).toEqual([
      "company.cancelled",
      "company.reinstated",
      "company.suspended",
    ]);
    expect(entries.find((e) => e.action === "company.suspended")).toMatchObject({
      company: { id: "summit", name: "Summit Floor Co." },
      actor: { kind: "platform_admin", name: "Platform admin" },
      details: { kind: "status_changed", from: "active", to: "suspended", reason: REASON },
    });
    expect((await store.listPlatformAudit({ action: "company.reinstated" })).entries).toHaveLength(1);
  });

  it("drops unreadable stored plans and statuses, and Reset demo clears both", async () => {
    const store = new DemoStore(noFiles);
    await store.createPlatformPlan(STARTER);
    await store.changePlatformCompanyStatus("summit", { action: "suspend", reason: REASON, expectedStatus: "active" });
    const keys = Object.keys(storage.snapshot());
    expect(keys).toContain("fp-demo:v2:platform-plans");
    expect(keys).toContain("fp-demo:v2:platform-status");

    storage.setItem(
      "fp-demo:v2:platform-plans",
      JSON.stringify({
        created: [{ id: "bad", key: "Bad Key" }],
        edits: { "flooring-pro": { name: "", monthlyPrice: "1e3", maxUsers: 0, active: "no" } },
      }),
    );
    storage.setItem("fp-demo:v2:platform-status", JSON.stringify({ summit: { status: "frozen" }, keystone: 7 }));
    expect((await store.listPlatformPlans()).map((p) => [p.id, p.name, p.monthlyPrice, p.maxUsers])).toEqual([
      ["flooring-pro", "Flooring Pro", "0.00", 16],
      ["flooring-wholesale", "Flooring Wholesale", "0.00", 13],
      ["hr-standard", "HR Standard", "0.00", 10],
    ]);
    expect(await store.getPlatformCompany("summit")).toMatchObject({ status: "active", phase: "full" });

    await store.resetDemo();
    const after = Object.keys(storage.snapshot());
    expect(after).not.toContain("fp-demo:v2:platform-plans");
    expect(after).not.toContain("fp-demo:v2:platform-status");
    expect((await store.listPlatformPlans()).map((p) => p.id)).toEqual([
      "flooring-pro",
      "flooring-wholesale",
      "hr-standard",
    ]);
  });
});
