import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultNumberSettings,
  overtimeRuleProblem,
  PAYMENT_MESSAGES,
  SETTINGS_SCOPE_MESSAGE,
  type CompanyId,
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

/** Summit personas (fixtures): the Owner and a Sales rep; Harbor's Owner (HR Suite). */
const DANA = "sm-usr-01";
const PRIYA = "sm-usr-03";
const HARBOR_OWNER = "hb-usr-01";
const ROLE_REFUSAL = "Your role does not allow this. Ask an Owner to change your security role.";

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

  it("D5 the overtime rule is still refused on a localization save", async () => {
    const store = await open("summit", DANA);
    const localization = (await store.getSettings()).localization;
    const saveRule = (overtimeRule: string) =>
      store.updateSettings("localization", {
        ...localization,
        payroll: { ...localization.payroll, overtimeRule: overtimeRule as "federal" },
      });
    await expect(saveRule("weekly")).rejects.toThrow(overtimeRuleProblem("weekly")!);
    // California is switched off in the register until a payroll review (ADR 0050).
    await expect(saveRule("california")).rejects.toThrow(overtimeRuleProblem("california")!);
  });

  it("D6 Sales can't save the number format: the keys come from SETTINGS_SECTIONS", async () => {
    const store = await open("summit", PRIYA);
    await expect(store.updateSettings("numbers", defaultNumberSettings())).rejects.toThrow(ROLE_REFUSAL);
  });

  it("D7 an HR Suite company has no core module, so its Owner can't save payments", async () => {
    const store = await open("harbor", HARBOR_OWNER);
    const payments = (await store.getSettings()).payments;
    await expect(store.updateSettings("payments", payments)).rejects.toThrow(
      "This part of the product is not switched on for your company.",
    );
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
