import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultNumberSettings,
  overtimeRuleProblem,
  PAYMENT_MESSAGES,
  SETTINGS_SCOPE_MESSAGE,
  SHARED_COST_MESSAGES,
  type CompanyId,
  type CompanySettings,
  type FeatureKey,
  type FeatureRegister,
  type Role,
} from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

/** Switches these tests turn off; every other one keeps its real value. */
const OFF = vi.hoisted(() => new Set<string>());

vi.mock("@workspace/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/shared")>();
  return {
    ...real,
    featureOn: (key: FeatureKey, register?: FeatureRegister) => (OFF.has(key) ? false : real.featureOn(key, register)),
  };
});

/** The number-format locale Summit opens with when a test sets one (D8b); null keeps the fixture's. */
const SUMMIT_LOCALE = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("@/lib/api/demo/fixtures", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api/demo/fixtures")>();
  return {
    ...real,
    loadCompanyFixtures: async (companyId: CompanyId) => {
      const fixtures = await real.loadCompanyFixtures(companyId);
      const locale = SUMMIT_LOCALE.value;
      if (companyId !== "summit" || !locale) return fixtures;
      const numbers = { ...fixtures.settings.numbers, locale };
      return { ...fixtures, settings: { ...fixtures.settings, numbers } };
    },
  };
});

afterEach(() => {
  OFF.clear();
  SUMMIT_LOCALE.value = null;
});

/** Summit personas (fixtures): the Owner and a Sales rep; Harbor's Owner and HR manager (HR Suite). */
const DANA = "sm-usr-01";
const PRIYA = "sm-usr-03";
const HARBOR_OWNER = "hb-usr-01";
const HARBOR_HR = "hb-usr-02";
const ROLE_REFUSAL = "Your role does not allow this. Ask an Owner to change your security role.";
const MODULE_REFUSAL = "This part of the product is not switched on for your company.";
const SECTION_REFUSAL = "Localization and tax saves one tab at a time.";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** A fresh demo store with a company open for one person. */
async function open(company: "summit" | "harbor", userId: string): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany(company, { userId, viewAsRoleId: null });
  return store;
}

describe("DemoStore settings saves follow the API's rules (ADR 0059)", () => {
  it("D1 a refused payments amount is not stored and writes no audit entry", async () => {
    const store = await open("summit", DANA);
    const before = (await store.getSettings()).payments;
    const audits = (await store.list("audit")).length;
    await expect(store.updateSettings("payments", { ...before, approvalThreshold: "12." })).rejects.toThrow(
      PAYMENT_MESSAGES.approvalThreshold,
    );
    expect((await store.getSettings()).payments).toEqual(before);
    expect(await store.list("audit")).toHaveLength(audits);
  });

  it("D2 View as a role below company-wide scope can't save settings", async () => {
    const store = await open("summit", DANA);
    const sales = (await store.list("roles")).find((role) => role.key === "sales")!;
    const role: Role = {
      ...sales,
      id: "sm-role-branch-numbers",
      key: "branch-numbers",
      name: "Branch numbers",
      system: false,
      permissions: ["settings.numbers.manage"],
      dataScope: "branch",
    };
    await store.saveRole(role);
    store.setViewer({ userId: DANA, viewAsRoleId: role.id });
    await expect(store.updateSettings("numbers", defaultNumberSettings())).rejects.toThrow(SETTINGS_SCOPE_MESSAGE);
  });

  it("D3 a switched-off page's section refuses with the switch's words", async () => {
    OFF.add("settings.number-format");
    const store = await open("summit", DANA);
    await expect(store.updateSettings("numbers", defaultNumberSettings())).rejects.toThrow(
      "This feature is switched off.",
    );
  });

  it("D3b the keys are checked before the switch, as on the API", async () => {
    OFF.add("settings.number-format");
    const store = await open("summit", PRIYA);
    await expect(store.updateSettings("numbers", defaultNumberSettings())).rejects.toThrow(ROLE_REFUSAL);
  });

  it("D4 the Accountant saves the number format, stored and audited with the spec's words", async () => {
    const owner = await open("summit", DANA);
    const accountantRole = (await owner.list("roles")).find((role) => role.key === "accountant")!;
    const grace = (await owner.list("users")).find((user) => user.roleIds.includes(accountantRole.id))!;
    const store = await open("summit", grace.id);
    const value = { ...(await store.getSettings()).numbers, negativeStyle: "parens" as const };
    const seen = new Set((await store.list("audit")).map((row) => row.id));
    await store.updateSettings("numbers", value);
    expect((await store.getSettings()).numbers).toEqual(value);
    const added = (await store.list("audit")).filter((row) => !seen.has(row.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      category: "settings",
      action: "Changed number format",
      target: "Number format",
      actorName: grace.name,
    });
  });

  it("D5 the overtime rule is refused on a Payroll rules save; the whole section is refused before any rule (part 3b)", async () => {
    const store = await open("summit", DANA);
    const localization = (await store.getSettings()).localization;
    const payroll = (overtimeRule: string) => ({ ...localization.payroll, overtimeRule: overtimeRule as "federal" });
    await expect(store.updateLocalization("payroll", payroll("weekly"))).rejects.toThrow(
      overtimeRuleProblem("weekly")!,
    );
    // California is switched off in the register until a payroll review (ADR 0050).
    await expect(store.updateLocalization("payroll", payroll("california"))).rejects.toThrow(
      overtimeRuleProblem("california")!,
    );
    await expect(store.updateSettings("localization", { ...localization, payroll: payroll("weekly") })).rejects.toThrow(
      SECTION_REFUSAL,
    );
  });

  it("D6 Sales can't save the number format: the keys come from SETTINGS_SECTIONS", async () => {
    const store = await open("summit", PRIYA);
    await expect(store.updateSettings("numbers", defaultNumberSettings())).rejects.toThrow(ROLE_REFUSAL);
  });

  it("D7 an HR Suite company has no core module, so its Owner can't save payments", async () => {
    const store = await open("harbor", HARBOR_OWNER);
    const payments = (await store.getSettings()).payments;
    await expect(store.updateSettings("payments", payments)).rejects.toThrow(MODULE_REFUSAL);
  });

  it("D7b the module is checked before the keys, as the API's permissionDecision does (review round 4)", async () => {
    const owner = await open("harbor", HARBOR_OWNER);
    const { payments, expenses } = await owner.getSettings();
    // No one in Harbor holds the `core` key settings.expenses.manage, the Owner included.
    await expect(owner.updateSettings("expenses", expenses)).rejects.toThrow(MODULE_REFUSAL);
    const hrManager = await open("harbor", HARBOR_HR);
    await expect(hrManager.updateSettings("payments", payments)).rejects.toThrow(MODULE_REFUSAL);
    await expect(hrManager.updateSettings("expenses", expenses)).rejects.toThrow(MODULE_REFUSAL);
  });

  it("D8 the shared content rules: the company's locale and currency, and different prefixes", async () => {
    const store = await open("summit", DANA);
    const settings = await store.getSettings();
    await expect(store.updateSettings("numbers", { ...settings.numbers, locale: "fr-FR" })).rejects.toThrow(
      "(en-US, USD)",
    );
    await expect(
      store.updateSettings("payments", { ...settings.payments, refundPrefix: settings.payments.paymentPrefix }),
    ).rejects.toThrow(PAYMENT_MESSAGES.samePrefix);
  });

  it("D8b the locale rule compares with the company's stored format, not the default (rule 12)", async () => {
    SUMMIT_LOCALE.value = "en-CA";
    const store = await open("summit", DANA);
    const canadian = (await store.getSettings()).numbers;
    expect(canadian.locale).toBe("en-CA");
    await expect(store.updateSettings("numbers", { ...canadian, locale: "en-US" })).rejects.toThrow("(en-CA, USD)");
    const kept = { ...canadian, negativeStyle: "parens" as const };
    await store.updateSettings("numbers", kept);
    expect((await store.getSettings()).numbers).toEqual(kept);
  });
});

describe("DemoStore saves shared costs with the API's rule (ADR 0059, part 4b)", () => {
  /** Summit's first two live locations, as Settings → Expenses lists them. */
  async function twoLocations(store: DemoStore) {
    const [a, b] = await store.list("locations");
    return { a, b };
  }

  it("SCD1 the Owner saves a fixed split over live locations, stored and audited once with the API's label", async () => {
    const store = await open("summit", DANA);
    const { a, b } = await twoLocations(store);
    const value = { rule: "fixed" as const, fixedPct: { [a.id]: "60", [b.id]: "40.00000000" } };
    const seen = new Set((await store.list("audit")).map((row) => row.id));
    await store.updateSettings("sharedCosts", value);
    expect((await store.getSettings()).sharedCosts).toEqual(value);
    const added = (await store.list("audit")).filter((row) => !seen.has(row.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ category: "settings", action: "Changed shared costs", target: "Shared costs" });
  });

  it("SCD2 the same refusals as the API, with its words; nothing stored or audited (plan note (b))", async () => {
    const store = await open("summit", DANA);
    const { a, b } = await twoLocations(store);
    const before = (await store.getSettings()).sharedCosts;
    const audits = (await store.list("audit")).length;
    const cases: [unknown, string][] = [
      [{ rule: "weighted", fixedPct: {} }, SHARED_COST_MESSAGES.rule],
      [{ rule: "fixed", fixedPct: { [a.id]: "60", [b.id]: "30" } }, SHARED_COST_MESSAGES.total("90")],
      [{ rule: "fixed", fixedPct: { [a.id]: "1.2.3", [b.id]: "40" } }, SHARED_COST_MESSAGES.shareOf(a.name)],
      [{ rule: "revenue", fixedPct: { [a.id]: "" } }, SHARED_COST_MESSAGES.shareOf(a.name)],
      [{ rule: "equal", fixedPct: { "kn-loc-01": "0" } }, SHARED_COST_MESSAGES.unknownLocation],
    ];
    for (const [value, words] of cases)
      await expect(
        store.updateSettings("sharedCosts", value as CompanySettings["sharedCosts"]),
        JSON.stringify(value),
      ).rejects.toThrow(words);
    expect((await store.getSettings()).sharedCosts).toEqual(before);
    expect(await store.list("audit")).toHaveLength(audits);
  });

  it("SCD3 the key, the Expenses switch and the module, in the API's order", async () => {
    const value = { rule: "equal" as const, fixedPct: {} };
    await expect((await open("summit", PRIYA)).updateSettings("sharedCosts", value)).rejects.toThrow(ROLE_REFUSAL);
    await expect((await open("harbor", HARBOR_OWNER)).updateSettings("sharedCosts", value)).rejects.toThrow(
      MODULE_REFUSAL,
    );
    OFF.add("finance.expenses");
    await expect((await open("summit", DANA)).updateSettings("sharedCosts", value)).rejects.toThrow(
      "This feature is switched off.",
    );
  });
});
