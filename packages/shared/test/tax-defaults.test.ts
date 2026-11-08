import { describe, expect, it } from "vitest";
import {
  EXAMPLE_COMPANY_DEFAULT,
  EXAMPLE_JURISDICTIONS,
  EXAMPLE_TAX_RULES,
  resolveTaxRule,
  withOverride,
  type TaxDefaults,
} from "../src";

const tax: TaxDefaults = {
  rules: EXAMPLE_TAX_RULES,
  jurisdictions: EXAMPLE_JURISDICTIONS,
  companyDefault: EXAMPLE_COMPANY_DEFAULT,
};
const operating = ["CO", "WY"];
const on = "2026-11-07";

describe("default tax rates (spec A5)", () => {
  it("uses the county rate first, keeping the state's taxability", () => {
    const { rule, source } = resolveTaxRule(tax, operating, { state: "CO", county: "El Paso County" }, on);
    expect(rule?.ratePct).toBe("8.25");
    expect(rule?.taxable.labor).toBe(EXAMPLE_TAX_RULES.find((r) => r.state === "CO")!.taxable.labor);
    expect(source).toEqual({ kind: "jurisdiction", label: "Colorado Springs combined rate (example)" });
  });

  it("falls back to the state default when the county has no rate", () => {
    const { rule, source } = resolveTaxRule(tax, operating, { state: "CO", county: "Denver" }, on);
    expect(rule?.ratePct).toBe("8.81");
    expect(source.label).toBe("Default rate for Colorado (example)");
  });

  it("uses the company default only in states of operation without a state rule", () => {
    const wyoming = resolveTaxRule(tax, operating, { state: "WY" }, on);
    expect(wyoming.rule?.ratePct).toBe("4");
    expect(wyoming.source.kind).toBe("company");
    const oregon = resolveTaxRule(tax, operating, { state: "OR" }, on);
    expect(oregon.rule).toBeUndefined();
    expect(oregon.source.label).toBe("Not collected in Oregon");
  });

  it("respects effective dates", () => {
    const ended = { ...tax, jurisdictions: [{ ...EXAMPLE_JURISDICTIONS[0]!, validTo: "2026-06-30" }] };
    expect(resolveTaxRule(ended, operating, { state: "CO", county: "El Paso" }, on).source.kind).toBe("state");
    expect(resolveTaxRule(ended, operating, { state: "CO", county: "El Paso" }, "2026-06-01").source.kind).toBe(
      "jurisdiction",
    );
  });

  it("lets one document change the rate, naming who and why", () => {
    const resolved = resolveTaxRule(tax, operating, { state: "CO" }, on);
    const override = { ratePct: "0", reason: "Church, exempt by letter", byName: "Grace Liu", at: "2026-11-07T10:00" };
    const { rule, source } = withOverride(resolved, "CO", override);
    expect(rule?.ratePct).toBe("0");
    expect(source).toEqual({ kind: "override", label: "Changed by Grace Liu: Church, exempt by letter" });
  });
});
