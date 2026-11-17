import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  API_LOCALIZATION_TABS,
  CATEGORY_LABELS,
  DOCUMENT_MESSAGES,
  DOCUMENT_PREFIX_TEXT,
  documentsProblem,
  effectivePermissions,
  enabledModules,
  featureOn,
  isApiLocalizationTab,
  LEGAL_FOOTER_MAX,
  LOCALIZATION_READERS,
  LOCALIZATION_TABS,
  localizationTabProblem,
  MODULES,
  overtimeRuleProblem,
  PAYROLL_MESSAGES,
  payrollProblem,
  permissionsForModules,
  PRODUCT_ROLES,
  readableTabs,
  roleTemplate,
  SENSITIVE_FIELDS,
  SETTINGS_SECTIONS,
  settingsSectionProblem,
  WASTE_CATEGORIES,
  type CompanySettings,
  type DefaultRoleKey,
  type DocumentsInput,
  type FeatureKey,
  type LocalizationSettings,
  type ModuleKey,
  type PermissionKey,
  type ProductKey,
} from "../src";

const summit = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/summit.json", import.meta.url)), "utf8")) as {
  settings: CompanySettings;
};
const SUMMIT = summit.settings.localization;
const DOCUMENTS = SUMMIT.documents;

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

/** Summit's documents with one change. */
function documents(patch: Partial<DocumentsInput>): DocumentsInput {
  return { ...DOCUMENTS, ...patch };
}

/** Summit's documents with one waste default replaced, or (`undefined`) left out. */
function waste(category: string, value: string | undefined): DocumentsInput {
  const map: Record<string, string> = { ...DOCUMENTS.defaultWastePct };
  if (value === undefined) delete map[category];
  else map[category] = value;
  return documents({ defaultWastePct: map });
}

/** Percents the quote API refuses: a bare point, no leading digit, an exponent, a sign, over 100, spaces, empty, hex. */
const BAD_PERCENTS = ["12.", ".5", "1e3", "-1", "100.5", " 5", "", "0x10"];

describe("Settings part 2a: Localization tabs and their rules (ADR 0059)", () => {
  it("LR1 LOCALIZATION_TABS: every tab once, exactly one key each, the section's switch, its module and label", () => {
    expect(Object.keys(LOCALIZATION_TABS).sort()).toEqual(Object.keys(SUMMIT).sort());
    const moduleKeys = MODULES.map((module) => module.key);
    for (const [tab, rule] of Object.entries(LOCALIZATION_TABS)) {
      expect(rule.keys, tab).toHaveLength(1);
      expect(ALL_PERMISSION_KEYS, tab).toContain(rule.keys[0]);
      expect(rule.feature, tab).toBe(SETTINGS_SECTIONS.localization.feature);
      expect(moduleKeys, tab).toContain(rule.module);
    }
    expect(LOCALIZATION_TABS.tax.keys).toEqual(["settings.tax.manage"]);
    for (const tab of ["region", "currency", "payroll", "documents"] as const)
      expect(LOCALIZATION_TABS[tab].keys, tab).toEqual(["settings.localization.manage"]);
    expect(LOCALIZATION_TABS.documents.module).toBe("core");
    expect(LOCALIZATION_TABS.payroll.module).toBe("hr");
    for (const tab of ["region", "currency", "tax"] as const)
      expect(LOCALIZATION_TABS[tab].module, tab).toBe("platform");
    expect(Object.values(LOCALIZATION_TABS).map((rule) => rule.label)).toEqual([
      "Region",
      "Currency",
      "Sales tax",
      "Payroll rules",
      "Sales and documents",
    ]);
  });

  it("LR2 the served tabs: documents and payroll, each with a reader rule", () => {
    expect([...API_LOCALIZATION_TABS]).toEqual(["documents", "payroll"]);
    expect(Object.keys(LOCALIZATION_READERS).sort()).toEqual([...API_LOCALIZATION_TABS].sort());
    for (const tab of API_LOCALIZATION_TABS) expect(isApiLocalizationTab(tab), tab).toBe(true);
    for (const tab of ["tax", "region", "currency", "localization"]) expect(isApiLocalizationTab(tab), tab).toBe(false);
  });

  it("LR3 readableTabs: documents to quote, invoice and PO readers with core; payroll to HR readers with hr", () => {
    const of = (product: ProductKey, key: DefaultRoleKey, on?: (key: FeatureKey) => boolean) =>
      readableTabs(readerOf(product, key), on);
    for (const key of ["owner", "manager", "accountant", "sales", "purchasing", "warehouse"] as const)
      expect(of("flooring", key), key).toEqual(["documents", "payroll"]);
    for (const key of ["installer", "hr", "employee"] as const) expect(of("flooring", key), key).toEqual(["payroll"]);
    for (const key of PRODUCT_ROLES.hr) expect(of("hr", key), `hr ${key}`).toEqual(["payroll"]);
    const keys = (...held: PermissionKey[]) => new Set<PermissionKey>(held);
    expect(
      readableTabs({
        permissions: keys("settings.localization.manage", "hr.timesheet.view"),
        modules: ["platform", "core"],
      }),
    ).toEqual(["documents"]);
    expect(
      readableTabs({
        permissions: keys("settings.localization.manage", "sales.quote.view"),
        modules: ["platform", "hr"],
      }),
    ).toEqual(["payroll"]);
    const meetingsOnly = new Set<PermissionKey>(permissionsForModules(["meetings"]));
    expect(readableTabs({ permissions: meetingsOnly, modules: ["platform", "hr", "meetings"] })).toEqual([]);
    expect(of("flooring", "owner", without("settings.localization"))).toEqual(["documents", "payroll"]);
  });

  it("LR4 documentsProblem: Summit passes; each refused field gets its own words", () => {
    expect(documentsProblem(DOCUMENTS)).toBeNull();
    for (const pct of ["0", "100", "50.00000000"]) {
      expect(documentsProblem(documents({ lateFeePct: pct })), pct).toBeNull();
      expect(documentsProblem(documents({ defaultDepositPct: pct })), pct).toBeNull();
      expect(documentsProblem(waste("carpet", pct)), pct).toBeNull();
    }
    expect(documentsProblem(documents({ balanceDueDays: 0 }))).toBeNull();
    expect(documentsProblem(documents({ legalFooter: "x".repeat(LEGAL_FOOTER_MAX) }))).toBeNull();

    expect(documentsProblem(documents({ defaultTerms: "net_60" }))).toBe(DOCUMENT_MESSAGES.defaultTerms);
    for (const pct of BAD_PERCENTS) {
      expect(documentsProblem(documents({ lateFeePct: pct })), pct).toBe(DOCUMENT_MESSAGES.lateFeePct);
      expect(documentsProblem(documents({ defaultDepositPct: pct })), pct).toBe(DOCUMENT_MESSAGES.defaultDepositPct);
      expect(documentsProblem(waste("carpet", pct)), pct).toBe(DOCUMENT_MESSAGES.waste(CATEGORY_LABELS.carpet));
    }
    expect(DOCUMENT_MESSAGES.waste(CATEGORY_LABELS.carpet)).toContain("Carpet");
    expect(documentsProblem(waste("lvp", undefined))).toBe(DOCUMENT_MESSAGES.wasteCategories);
    expect(documentsProblem(waste("service", "8"))).toBe(DOCUMENT_MESSAGES.wasteCategories);
    for (const days of [0, 366, 2.5])
      expect(documentsProblem(documents({ quoteExpiryDays: days })), String(days)).toBe(
        DOCUMENT_MESSAGES.quoteExpiryDays,
      );
    for (const days of [-1, 366, 1.5])
      expect(documentsProblem(documents({ balanceDueDays: days })), String(days)).toBe(
        DOCUMENT_MESSAGES.balanceDueDays,
      );
    for (const prefix of ["", "Q 1", "-Q", "ABCDEFGHIJK"]) {
      expect(documentsProblem(documents({ quotePrefix: prefix })), prefix).toBe(DOCUMENT_MESSAGES.quotePrefix);
      expect(documentsProblem(documents({ invoicePrefix: prefix })), prefix).toBe(DOCUMENT_MESSAGES.invoicePrefix);
      expect(documentsProblem(documents({ poPrefix: prefix })), prefix).toBe(DOCUMENT_MESSAGES.poPrefix);
    }
    expect(documentsProblem(documents({ quotePrefix: "INV-", invoicePrefix: "inv-" }))).toBe(
      DOCUMENT_MESSAGES.samePrefix,
    );
    expect(documentsProblem(documents({ poPrefix: DOCUMENTS.quotePrefix }))).toBe(DOCUMENT_MESSAGES.samePrefix);
    expect(documentsProblem(documents({ legalFooter: "x".repeat(LEGAL_FOOTER_MAX + 1) }))).toBe(
      DOCUMENT_MESSAGES.legalFooter,
    );
    expect(WASTE_CATEGORIES).toEqual(Object.keys(CATEGORY_LABELS).filter((category) => category !== "service"));
    expect([...WASTE_CATEGORIES].sort()).toEqual(Object.keys(DOCUMENTS.defaultWastePct).sort());
  });

  it("LR5 payrollProblem: the overtime rule as ADR 0050 allows it, and a US state's holidays", () => {
    expect(payrollProblem({ overtimeRule: "federal", holidayState: "CO" })).toBeNull();
    expect(payrollProblem({ overtimeRule: "california", holidayState: "CO" })).toBe(overtimeRuleProblem("california"));
    expect(payrollProblem({ overtimeRule: "weekly", holidayState: "CO" })).toBe(
      "Choose the federal or the California overtime rule.",
    );
    for (const holidayState of ["XX", "co", ""])
      expect(payrollProblem({ overtimeRule: "federal", holidayState }), holidayState).toBe(
        PAYROLL_MESSAGES.holidayState,
      );
  });

  it("LR6 the dispatchers: each served tab's rule; region, currency and tax have none yet; the whole section runs them", () => {
    expect(localizationTabProblem("documents", { ...DOCUMENTS, lateFeePct: "12." })).toBe(DOCUMENT_MESSAGES.lateFeePct);
    expect(localizationTabProblem("payroll", { overtimeRule: "federal", holidayState: "XX" })).toBe(
      PAYROLL_MESSAGES.holidayState,
    );
    expect(localizationTabProblem("documents", DOCUMENTS)).toBeNull();
    expect(localizationTabProblem("payroll", SUMMIT.payroll)).toBeNull();
    const odd = { anything: true } as unknown;
    expect(localizationTabProblem("region", odd as LocalizationSettings["region"])).toBeNull();
    expect(localizationTabProblem("currency", odd as LocalizationSettings["currency"])).toBeNull();
    expect(localizationTabProblem("tax", odd as LocalizationSettings["tax"])).toBeNull();
    expect(
      settingsSectionProblem("localization", { ...SUMMIT, documents: { ...DOCUMENTS, lateFeePct: "12." } }, SUMMIT),
    ).toBe(DOCUMENT_MESSAGES.lateFeePct);
    expect(settingsSectionProblem("localization", SUMMIT, SUMMIT)).toBeNull();
    expect(DOCUMENT_PREFIX_TEXT.test("PAY-")).toBe(true);
    expect(DOCUMENT_PREFIX_TEXT.test("-PAY")).toBe(false);
  });

  it("LR7 no property of Sales and documents or Payroll rules is a reserved sensitive name", () => {
    // Part 1's "Reserved names" note: the interceptor would strip such a property from the answer.
    expect(keysOf({ documents: DOCUMENTS, payroll: SUMMIT.payroll }).filter((key) => key in SENSITIVE_FIELDS)).toEqual(
      [],
    );
  });
});
