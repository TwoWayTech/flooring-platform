import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { TAX_MESSAGES, type CompanySettings, type HoldsKey, type LocalizationSettings } from "@workspace/shared";
import { taxForm } from "@/features/settings/localization/tax-tab";

type Tax = LocalizationSettings["tax"];

/** Summit's fixture Sales tax tab: the demo's originals, which Reset to default reads. */
const ORIGINAL: Tax = (
  JSON.parse(
    readFileSync(createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json"), "utf8"),
  ) as { settings: CompanySettings }
).settings.localization.tax;

/**
 * The company's tab as the API can answer it: Colorado at a new version from a later day, a county
 * rate with a server id, a dated company default, and its own filing and certificate types.
 */
const CURRENT: Tax = {
  ...ORIGINAL,
  rules: ORIGINAL.rules.map((rule) =>
    rule.state === "CO" ? { ...rule, ratePct: "8.50000000", version: 2, validFrom: "2026-11-17", validTo: null } : rule,
  ),
  jurisdictions: ORIGINAL.jurisdictions.map((rate) =>
    rate.id === "jur-co-el-paso" ? { ...rate, id: "0193a6d2-0000-7000-8000-000000000001" } : rate,
  ),
  companyDefault: { ...ORIGINAL.companyDefault!, validFrom: "2026-11-01" },
  filing: [{ state: "CO", frequency: "quarterly" }],
  certificateTypes: ["Resale certificate"],
};

const all: HoldsKey = () => true;

describe("the Sales tax form (ADR 0059, part 3a)", () => {
  it("TP1 the rule before the code, a Reset that keeps what the tab can't change, and a remount when the tab in force changes", () => {
    const form = taxForm(CURRENT, ORIGINAL, all);

    expect(form.problem(CURRENT)).toBeNull();
    const sixPlaces = {
      ...CURRENT,
      rules: CURRENT.rules.map((rule) => (rule.state === "CO" ? { ...rule, ratePct: "8.123456" } : rule)),
    };
    expect(form.problem(sixPlaces)).toBe(TAX_MESSAGES.rulePercent("CO"));
    expect(form.problem({ ...CURRENT, pricesInclude: "inclusive" })).toBe(TAX_MESSAGES.pricesInclude);

    // Reset: the originals, but filing and certificate types from the company's own copy.
    expect(form.defaults).toEqual({
      ...ORIGINAL,
      filing: CURRENT.filing,
      certificateTypes: CURRENT.certificateTypes,
    });
    expect(form.defaults.pricesInclude).toBe("exclusive");
    expect(form.problem(form.defaults)).toBeNull();

    // The form remounts when the tab in force changes (D27), and only then.
    expect(taxForm(structuredClone(CURRENT), ORIGINAL, all).revision).toBe(form.revision);
    const changes: Tax[] = [
      { ...CURRENT, rules: CURRENT.rules.map((rule) => (rule.state === "CO" ? { ...rule, version: 3 } : rule)) },
      {
        ...CURRENT,
        jurisdictions: CURRENT.jurisdictions.map((rate, i) => (i === 0 ? { ...rate, id: "other" } : rate)),
      },
      {
        ...CURRENT,
        jurisdictions: CURRENT.jurisdictions.map((rate, i) => (i === 0 ? { ...rate, validFrom: "2026-11-18" } : rate)),
      },
      { ...CURRENT, companyDefault: { ...CURRENT.companyDefault!, validFrom: "2026-11-18" } },
    ];
    for (const changed of changes) expect(taxForm(changed, ORIGINAL, all).revision).not.toBe(form.revision);
  });
});
