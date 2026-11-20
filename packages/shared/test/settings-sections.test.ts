import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  API_SETTINGS_SECTIONS,
  companyProfileProblem,
  defaultNumberSettings,
  effectivePermissions,
  enabledModules,
  EXPENSE_MESSAGES,
  expenseSettingsProblem,
  FEATURES,
  featureOn,
  isApiSettingsSection,
  LOCALIZATION_SECTION_MESSAGE,
  MODULES,
  NUMBER_KINDS,
  numberSettingsProblem,
  numbersFromWire,
  numbersToWire,
  PAYMENT_MESSAGES,
  paymentSettingsProblem,
  permissionsForModules,
  PRODUCT_ROLES,
  PROFILE_MESSAGES,
  profileFor,
  readableSections,
  roleTemplate,
  SENSITIVE_FIELDS,
  SETTINGS_READERS,
  SETTINGS_SECTIONS,
  settingsSectionProblem,
  type CompanySettings,
  type DefaultRoleKey,
  type FeatureKey,
  type ModuleKey,
  type NumberKind,
  type NumberSettingsWire,
  type PermissionKey,
  type ProductKey,
} from "../src";

const summit = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/summit.json", import.meta.url)), "utf8")) as {
  settings: CompanySettings;
};
const SUMMIT = summit.settings;

/** Every property name anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}

/** A default role's effective keys and the modules of a fresh company of one product. */
function readerOf(product: ProductKey, key: DefaultRoleKey) {
  const modules: ModuleKey[] = enabledModules([product], null, []);
  const template = roleTemplate(key);
  const permissions = effectivePermissions(
    [{ id: key, permissions: template.permissions, dataScope: template.dataScope, owner: template.owner }],
    permissionsForModules(modules),
    modules,
  );
  return { permissions, modules };
}

/** The switches as they are, with these switched off. */
function without(...off: FeatureKey[]): (key: FeatureKey) => boolean {
  return (key) => !off.includes(key) && featureOn(key);
}

describe("Settings sections on the API (ADR 0059)", () => {
  it("R1 SETTINGS_SECTIONS: every section once, the old keys, real switches and modules, the spec's audit words", () => {
    const sections = Object.keys(SETTINGS_SECTIONS).sort();
    expect(sections).toEqual(Object.keys(SUMMIT).sort());
    expect(sections).toHaveLength(11);
    // The map the demo used before (permission-rules.ts `SETTINGS_PERMISSIONS`), pinned here.
    const before: Record<keyof CompanySettings, readonly PermissionKey[]> = {
      branding: ["settings.branding.manage"],
      localization: ["settings.localization.manage", "settings.tax.manage"],
      numbers: ["settings.numbers.manage"],
      profile: ["settings.company.manage"],
      payments: ["settings.payments.manage"],
      inventory: ["settings.locations.manage"],
      expenses: ["settings.expenses.manage"],
      sharedCosts: ["settings.expenses.manage"],
      hr: ["settings.hr.manage"],
      meetings: ["settings.meetings.manage"],
      email: ["settings.notifications.manage"],
    };
    const moduleKeys = MODULES.map((module) => module.key);
    for (const [section, rule] of Object.entries(SETTINGS_SECTIONS)) {
      expect(rule.keys, section).toEqual(before[section as keyof CompanySettings]);
      expect(Object.keys(FEATURES), section).toContain(rule.feature);
      expect(moduleKeys, section).toContain(rule.module);
    }
    for (const section of ["payments", "expenses", "sharedCosts", "inventory"] as const)
      expect(SETTINGS_SECTIONS[section].module, section).toBe("core");
    // Both keys: who reaches the whole-section refusal; every save goes per tab (part 3b).
    expect(SETTINGS_SECTIONS.localization.keys).toEqual(["settings.localization.manage", "settings.tax.manage"]);
    const actions = Object.values(SETTINGS_SECTIONS).map((rule) => `Changed ${rule.label.toLowerCase()}`);
    expect(actions.sort()).toEqual(
      [
        "Changed branding",
        "Changed localization and tax",
        "Changed number format",
        "Changed company profile",
        "Changed payments",
        "Changed stock rules",
        "Changed expense approval",
        "Changed shared costs",
        "Changed hr",
        "Changed meetings",
        "Changed email and notifications",
      ].sort(),
    );
  });

  it("R2 companyProfileProblem: Summit passes; each bad field gets its own words", () => {
    expect(companyProfileProblem(SUMMIT.profile)).toBeNull();
    const placed = { ...SUMMIT.profile, address: { ...SUMMIT.profile.address, lat: 39.7, lng: -104.9 } };
    expect(companyProfileProblem(placed)).toBeNull();
    const address = (patch: object) => ({ ...SUMMIT.profile, address: { ...SUMMIT.profile.address, ...patch } });
    const cases: [object, string][] = [
      [{ ...SUMMIT.profile, legalName: "  " }, PROFILE_MESSAGES.legalName],
      [{ ...SUMMIT.profile, ein: "12345" }, PROFILE_MESSAGES.ein],
      [{ ...SUMMIT.profile, phone: "555" }, PROFILE_MESSAGES.phone],
      [{ ...SUMMIT.profile, email: "a@b" }, PROFILE_MESSAGES.email],
      [{ ...SUMMIT.profile, website: "javascript:alert(1)" }, PROFILE_MESSAGES.website],
      [{ ...SUMMIT.profile, website: "ftp://x" }, PROFILE_MESSAGES.website],
      [address({ street: " " }), PROFILE_MESSAGES.street],
      [address({ city: "" }), PROFILE_MESSAGES.city],
      [address({ state: "XX" }), PROFILE_MESSAGES.state],
      [address({ zip: "8020" }), PROFILE_MESSAGES.zip],
    ];
    for (const [profile, message] of cases)
      expect(companyProfileProblem(profile as CompanySettings["profile"]), message).toBe(message);
    expect(companyProfileProblem({ ...SUMMIT.profile, website: "" })).toBeNull();
    expect(companyProfileProblem({ ...SUMMIT.profile, website: "https://summitfloor.example" })).toBeNull();
  });

  it("R3 numberSettingsProblem: each kind in its range, a known style, and the company's own locale and currency", () => {
    const defaults = defaultNumberSettings();
    expect(numberSettingsProblem(defaults, defaults)).toBeNull();
    const withDecimals = (kind: NumberKind, places: number) => ({
      ...defaults,
      decimals: { ...defaults.decimals, [kind]: places },
    });
    for (const [kind, range] of Object.entries(NUMBER_KINDS) as [NumberKind, (typeof NUMBER_KINDS)[NumberKind]][]) {
      const message = `Choose between ${range.min} and ${range.max} decimals for ${range.label}.`;
      expect(numberSettingsProblem(withDecimals(kind, range.min - 1), defaults), kind).toBe(message);
      expect(numberSettingsProblem(withDecimals(kind, range.max + 1), defaults), kind).toBe(message);
      expect(numberSettingsProblem(withDecimals(kind, 2.5), defaults), kind).toBe(message);
    }
    const missing = { ...defaults, decimals: { ...defaults.decimals } } as {
      decimals: Partial<Record<NumberKind, number>>;
    };
    delete missing.decimals.taxRate;
    expect(numberSettingsProblem(missing as typeof defaults, defaults)).toMatch(/decimals for Tax rate\.$/);
    expect(numberSettingsProblem({ ...defaults, negativeStyle: "brackets" as "minus" }, defaults)).not.toBeNull();
    expect(numberSettingsProblem({ ...defaults, locale: "fr-FR" }, defaults)).toContain("(en-US, USD)");
    const canadian = { ...defaults, locale: "en-CA" };
    expect(numberSettingsProblem(defaults, canadian)).toContain("(en-CA, USD)");
    expect(numberSettingsProblem(canadian, canadian)).toBeNull();
  });

  it("R4 paymentSettingsProblem: plain money or empty, each field named; prefixes; payment and refund prefixes differ", () => {
    expect(paymentSettingsProblem(SUMMIT.payments)).toBeNull();
    expect(paymentSettingsProblem({ ...SUMMIT.payments, approvalThreshold: "", writeOffMax: "" })).toBeNull();
    for (const bad of ["12.", ".5", "1e3", "-5", "1000.123", " 5", "0x10"]) {
      expect(paymentSettingsProblem({ ...SUMMIT.payments, approvalThreshold: bad }), bad).toBe(
        PAYMENT_MESSAGES.approvalThreshold,
      );
      expect(paymentSettingsProblem({ ...SUMMIT.payments, writeOffMax: bad }), bad).toBe(PAYMENT_MESSAGES.writeOffMax);
    }
    for (const bad of ["", "PAY 1", "-PAY", "ABCDEFGHIJK"]) {
      expect(paymentSettingsProblem({ ...SUMMIT.payments, paymentPrefix: bad }), bad).toBe(
        PAYMENT_MESSAGES.paymentPrefix,
      );
      expect(paymentSettingsProblem({ ...SUMMIT.payments, refundPrefix: bad }), bad).toBe(
        PAYMENT_MESSAGES.refundPrefix,
      );
    }
    expect(paymentSettingsProblem({ ...SUMMIT.payments, paymentPrefix: "PAY-", refundPrefix: "pay-" })).toBe(
      PAYMENT_MESSAGES.samePrefix,
    );
  });

  it("R5 expenseSettingsProblem: plain money or empty, with the field named", () => {
    expect(expenseSettingsProblem(SUMMIT.expenses)).toBeNull();
    expect(expenseSettingsProblem({ approvalRequired: false, approvalThreshold: "" })).toBeNull();
    for (const bad of ["12.", ".5", "1e3", "-5", "1000.123", " 5", "0x10"])
      expect(expenseSettingsProblem({ ...SUMMIT.expenses, approvalThreshold: bad }), bad).toBe(
        EXPENSE_MESSAGES.approvalThreshold,
      );
  });

  it("R6 the numbers wire: a list in NUMBER_KINDS order, no reserved name, and a tolerant read", () => {
    const settings = { ...defaultNumberSettings(), negativeStyle: "parens" as const };
    const wire = numbersToWire(settings);
    expect(numbersFromWire(wire)).toEqual(settings);
    expect(wire.decimals.map((entry) => entry.kind)).toEqual(Object.keys(NUMBER_KINDS));
    expect(wire.decimals).toHaveLength(7);
    expect(keysOf(wire).filter((key) => key in SENSITIVE_FIELDS)).toEqual([]);
    const odd = {
      ...wire,
      decimals: [...wire.decimals.filter((entry) => entry.kind !== "fxRate"), { kind: "weight", places: 9 }],
    } as NumberSettingsWire;
    const read = numbersFromWire(odd);
    expect(Object.keys(read.decimals).sort()).toEqual(Object.keys(NUMBER_KINDS).sort());
    expect(read.decimals.fxRate).toBe(NUMBER_KINDS.fxRate.default);
  });

  it("R7 the served sections: exactly five (part 4b adds shared costs), each with a rule and a reader rule", () => {
    expect([...API_SETTINGS_SECTIONS]).toEqual(["profile", "numbers", "payments", "expenses", "sharedCosts"]);
    for (const section of API_SETTINGS_SECTIONS) {
      expect(SETTINGS_SECTIONS[section], section).toBeDefined();
      expect(SETTINGS_READERS[section], section).toBeDefined();
      expect(isApiSettingsSection(section)).toBe(true);
    }
    expect(Object.keys(SETTINGS_READERS).sort()).toEqual([...API_SETTINGS_SECTIONS].sort());
    expect(isApiSettingsSection("localization")).toBe(false);
  });

  it("R8 settingsSectionProblem dispatches, numbers against the current value; Localization and tax is refused whole (part 3b)", () => {
    // Refused whole (WS1); the overtime rule is Payroll rules' own (LR5, LR6; D5 in the demo).
    expect(settingsSectionProblem("localization", SUMMIT.localization, SUMMIT.localization)).toBe(
      LOCALIZATION_SECTION_MESSAGE,
    );
    expect(settingsSectionProblem("hr", SUMMIT.hr, SUMMIT.hr)).toBeNull();
    expect(settingsSectionProblem("payments", { ...SUMMIT.payments, writeOffMax: "12." }, SUMMIT.payments)).toBe(
      PAYMENT_MESSAGES.writeOffMax,
    );
    const canadian = { ...SUMMIT.numbers, locale: "en-CA" };
    expect(settingsSectionProblem("numbers", SUMMIT.numbers, canadian)).toContain("(en-CA, USD)");
    expect(settingsSectionProblem("numbers", SUMMIT.numbers, SUMMIT.numbers)).toBeNull();
    expect(settingsSectionProblem("profile", { ...SUMMIT.profile, ein: "1" }, SUMMIT.profile)).toBe(
      PROFILE_MESSAGES.ein,
    );
    expect(settingsSectionProblem("expenses", { ...SUMMIT.expenses, approvalThreshold: "-1" }, SUMMIT.expenses)).toBe(
      EXPENSE_MESSAGES.approvalThreshold,
    );
  });

  it("WS1 the whole Localization and tax section is refused by its name, whatever it holds (ADR 0059, part 3b)", async () => {
    const whole = SUMMIT.localization;
    const refused = "Localization and tax saves one tab at a time.";
    expect(LOCALIZATION_SECTION_MESSAGE).toBe(refused);
    const values: CompanySettings["localization"][] = [
      whole,
      // A value a tab's rule refuses gets the section's words: no tab rule runs.
      { ...whole, documents: { ...whole.documents, lateFeePct: "12." } },
      // What the path let through before part 3b: a states change without the tax key, a tax block whole.
      { ...whole, region: { ...whole.region, statesOfOperation: ["CO"] } },
      { ...whole, tax: { ...whole.tax, pricesInclude: "inclusive" } },
      // By the name, so a value of no shape is refused too (D33).
      undefined as unknown as CompanySettings["localization"],
    ];
    for (const [i, value] of values.entries())
      expect(settingsSectionProblem("localization", value, whole), String(i)).toBe(refused);
    expect(settingsSectionProblem("numbers", SUMMIT.numbers, SUMMIT.numbers)).toBeNull();
    // The dynamic import reads the package's exports without a second static import of "../src" (S9c).
    expect(Object.keys(await import("../src"))).not.toContain("localizationProblem");
  });

  it("R10 readableSections: each section only to its readers, while its module and product switch are on", () => {
    const of = (product: ProductKey, key: DefaultRoleKey, on?: (key: FeatureKey) => boolean) =>
      readableSections(readerOf(product, key), on).sort();
    expect(of("flooring", "owner")).toEqual(["expenses", "numbers", "payments", "profile", "sharedCosts"]);
    expect(of("flooring", "accountant")).toEqual(["numbers", "payments", "profile"]);
    expect(of("flooring", "sales")).toEqual(["numbers", "payments", "profile"]);
    expect(of("flooring", "warehouse")).toEqual(["numbers", "profile"]);
    for (const key of PRODUCT_ROLES.flooring)
      expect(of("flooring", key), key).toEqual(expect.arrayContaining(["numbers", "profile"]));
    for (const key of PRODUCT_ROLES.hr) expect(of("hr", key), key).toEqual(["numbers", "profile"]);
    expect(of("flooring", "owner", without("sales.payments"))).toEqual([
      "expenses",
      "numbers",
      "profile",
      "sharedCosts",
    ]);
    expect(of("flooring", "owner", without("finance.expenses"))).toEqual(["numbers", "payments", "profile"]);
    expect(of("flooring", "owner", without("settings.company", "settings.number-format"))).toEqual([
      "expenses",
      "numbers",
      "payments",
      "profile",
      "sharedCosts",
    ]);
    const noCore = {
      permissions: new Set<PermissionKey>([
        "settings.payments.manage",
        "settings.expenses.manage",
        "sales.invoice.view",
      ]),
      modules: ["platform", "hr"] as ModuleKey[],
    };
    expect(readableSections(noCore).sort()).toEqual(["numbers", "profile"]);
    expect(readableSections(noCore)).toEqual(
      API_SETTINGS_SECTIONS.filter((section) => readableSections(noCore).includes(section)),
    );
  });

  it("R11 profileFor: the EIN only for settings.company.manage, every other field unchanged", () => {
    const hidden = profileFor(SUMMIT.profile, new Set<PermissionKey>(["sales.invoice.view"]));
    expect(hidden).toEqual({ ...SUMMIT.profile, ein: "" });
    expect(profileFor(SUMMIT.profile, new Set<PermissionKey>(["settings.company.manage"]))).toEqual(SUMMIT.profile);
  });
});
