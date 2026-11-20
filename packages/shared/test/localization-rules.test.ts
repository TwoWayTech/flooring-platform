import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  API_LOCALIZATION_TABS,
  CATEGORY_LABELS,
  CREDIT_NOTE_PREFIX,
  CURRENCY_MESSAGES,
  DOCUMENT_MESSAGES,
  DOCUMENT_PREFIX_MAX,
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
  PERCENT_TEXT,
  PERCENT_TEXT_MAX,
  permissionsForModules,
  PRODUCT_ROLES,
  readableTabs,
  REGION_MESSAGES,
  roleTemplate,
  SENSITIVE_FIELDS,
  SETTINGS_SECTIONS,
  TAX_MESSAGES,
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

  it("LR2 the served tabs: documents, payroll, since part 2b region and currency, and since part 3a tax, each with a reader rule", () => {
    expect([...API_LOCALIZATION_TABS]).toEqual(["documents", "payroll", "region", "currency", "tax"]);
    expect(Object.keys(LOCALIZATION_READERS).sort()).toEqual([...API_LOCALIZATION_TABS].sort());
    for (const tab of API_LOCALIZATION_TABS) expect(isApiLocalizationTab(tab), tab).toBe(true);
    expect(isApiLocalizationTab("tax")).toBe(true);
    expect(isApiLocalizationTab("localization")).toBe(false);
  });

  it("LR3 readableTabs: documents to quote, invoice and PO readers with core; payroll to HR readers with hr; region to everyone; currency to its managers; tax to quote readers and tax managers", () => {
    const of = (product: ProductKey, key: DefaultRoleKey, on?: (key: FeatureKey) => boolean) =>
      readableTabs(readerOf(product, key), on);
    for (const key of ["owner", "accountant"] as const)
      expect(of("flooring", key), key).toEqual(["documents", "payroll", "region", "currency", "tax"]);
    for (const key of ["manager", "sales"] as const)
      expect(of("flooring", key), key).toEqual(["documents", "payroll", "region", "tax"]);
    for (const key of ["purchasing", "warehouse"] as const)
      expect(of("flooring", key), key).toEqual(["documents", "payroll", "region"]);
    for (const key of ["installer", "hr", "employee"] as const)
      expect(of("flooring", key), key).toEqual(["payroll", "region"]);
    expect(of("hr", "owner")).toEqual(["payroll", "region", "currency", "tax"]);
    for (const key of PRODUCT_ROLES.hr.filter((role) => role !== "owner"))
      expect(of("hr", key), `hr ${key}`).toEqual(["payroll", "region"]);
    const keys = (...held: PermissionKey[]) => new Set<PermissionKey>(held);
    expect(
      readableTabs({
        permissions: keys("settings.localization.manage", "hr.timesheet.view"),
        modules: ["platform", "core"],
      }),
    ).toEqual(["documents", "region", "currency"]);
    expect(
      readableTabs({
        permissions: keys("settings.localization.manage", "sales.quote.view"),
        modules: ["platform", "hr"],
      }),
    ).toEqual(["payroll", "region", "currency", "tax"]);
    const meetingsOnly = new Set<PermissionKey>(permissionsForModules(["meetings"]));
    expect(readableTabs({ permissions: meetingsOnly, modules: ["platform", "hr", "meetings"] })).toEqual(["region"]);
    // Sales tax isn't hidden by the page switch: the quote builder reads it (part 3a, D7).
    expect(of("flooring", "owner", without("settings.localization"))).toEqual([
      "documents",
      "payroll",
      "region",
      "tax",
    ]);
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
    // Credit notes are numbered CR- in the invoices' one number index, so no prefix may start with
    // it, in any case (review round 1); "CR" without the hyphen numbers CR1001 and is taken.
    for (const field of ["quotePrefix", "invoicePrefix", "poPrefix"] as const)
      for (const prefix of [CREDIT_NOTE_PREFIX, "cr-", "Cr-5", "CR-INV"])
        expect(documentsProblem(documents({ [field]: prefix })), `${field} ${prefix}`).toBe(
          DOCUMENT_MESSAGES.creditNotePrefix,
        );
    expect(documentsProblem(documents({ invoicePrefix: "CR" }))).toBeNull();
    expect(DOCUMENT_MESSAGES.creditNotePrefix).toContain(CREDIT_NOTE_PREFIX);
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

  it("LR6 the dispatchers: each served tab's rule against the stored tab; tax runs taxProblem; the whole section is refused (WS1)", () => {
    const holds = () => true;
    expect(localizationTabProblem("documents", { ...DOCUMENTS, lateFeePct: "12." }, DOCUMENTS, holds)).toBe(
      DOCUMENT_MESSAGES.lateFeePct,
    );
    expect(
      localizationTabProblem("payroll", { overtimeRule: "federal", holidayState: "XX" }, SUMMIT.payroll, holds),
    ).toBe(PAYROLL_MESSAGES.holidayState);
    expect(localizationTabProblem("documents", DOCUMENTS, DOCUMENTS, holds)).toBeNull();
    expect(localizationTabProblem("payroll", SUMMIT.payroll, SUMMIT.payroll, holds)).toBeNull();
    expect(localizationTabProblem("region", SUMMIT.region, SUMMIT.region, holds)).toBeNull();
    expect(localizationTabProblem("currency", SUMMIT.currency, SUMMIT.currency, holds)).toBeNull();
    // Part 2b: Region and Currency have their rules (region-currency-rules.test.ts, RG7).
    expect(localizationTabProblem("region", { ...SUMMIT.region, timeZone: "Europe/Paris" }, SUMMIT.region, holds)).toBe(
      REGION_MESSAGES.timeZone,
    );
    expect(localizationTabProblem("currency", { ...SUMMIT.currency, locked: false }, SUMMIT.currency, holds)).toBe(
      CURRENCY_MESSAGES.base("USD"),
    );
    // Part 3a: Sales tax has its rule (tax-settings.test.ts, SR6).
    const odd = { anything: true } as unknown;
    expect(localizationTabProblem("tax", odd as LocalizationSettings["tax"], SUMMIT.tax, holds)).toBe(
      TAX_MESSAGES.pricesInclude,
    );
    expect(DOCUMENT_PREFIX_TEXT.test("PAY-")).toBe(true);
    expect(DOCUMENT_PREFIX_TEXT.test("-PAY")).toBe(false);
  });

  it("LR7 no property of Sales and documents or Payroll rules is a reserved sensitive name", () => {
    // Part 1's "Reserved names" note: the interceptor would strip such a property from the answer.
    expect(keysOf({ documents: DOCUMENTS, payroll: SUMMIT.payroll }).filter((key) => key in SENSITIVE_FIELDS)).toEqual(
      [],
    );
  });

  it("LR8 the input bounds are the longest text each rule takes, so a page's input never cuts a valid value", () => {
    expect(DOCUMENT_PREFIX_TEXT.test("A".repeat(DOCUMENT_PREFIX_MAX))).toBe(true);
    expect(DOCUMENT_PREFIX_TEXT.test("A".repeat(DOCUMENT_PREFIX_MAX + 1))).toBe(false);
    expect("100.00000000").toHaveLength(PERCENT_TEXT_MAX);
    expect(PERCENT_TEXT.test("100.00000000")).toBe(true);
    for (const longer of ["100.000000000", "1000.00000000"]) expect(PERCENT_TEXT.test(longer), longer).toBe(false);
    expect(PAYROLL_MESSAGES.overtimeRule).toBe(overtimeRuleProblem("weekly"));
  });
});
