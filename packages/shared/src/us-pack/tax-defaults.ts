import type { Address } from "../types/company";
import { stateName, type StateCode } from "./states";
import type { TaxCategory, TaxRule } from "./tax";

/** A county rate that replaces the state default for job sites in that county (spec A5). */
export interface JurisdictionRate {
  id: string;
  state: StateCode;
  /** County name without the word "County", matched without regard to case. */
  county: string;
  name: string;
  ratePct: string;
  validFrom: string;
  validTo: string | null;
}

/**
 * The company's own default rate (spec A5). It applies only in the company's states of operation
 * that have no state rule, so states where the company does not sell stay "not collected"
 * (plan K-5).
 */
export interface CompanyDefaultRate {
  ratePct: string;
  taxable: Record<TaxCategory, boolean>;
  validFrom: string;
}

/** A rate changed on one document, with who changed it and why (spec A5: needs sales.tax.override). */
export interface TaxOverride {
  ratePct: string;
  reason: string;
  byName: string;
  at: string;
}

/** Where a document's tax rate came from, shown under its tax line (spec A5). */
export interface TaxSource {
  kind: "jurisdiction" | "state" | "company" | "override" | "none";
  label: string;
}

/** The tax settings resolution reads. */
export interface TaxDefaults {
  rules: readonly TaxRule[];
  jurisdictions: readonly JurisdictionRate[];
  companyDefault: CompanyDefaultRate | null;
}

const validOn = (r: { validFrom: string; validTo?: string | null }, on: string) =>
  r.validFrom <= on && (!r.validTo || r.validTo >= on);

/** "El Paso County" and "el paso" name the same county. */
const countyKey = (county: string | undefined) =>
  (county ?? "")
    .toLowerCase()
    .replace(/\s+county$/, "")
    .trim();

/** The newest of several rules valid on a date. */
function newest<T extends { validFrom: string }>(items: T[]): T | undefined {
  return [...items].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
}

/** The company default as a rule for one state, so the tax engine can use it unchanged. */
function companyRule(state: string, rate: CompanyDefaultRate): TaxRule {
  return {
    state: state as StateCode,
    jurisdiction: "Company default",
    ratePct: rate.ratePct,
    taxable: { ...rate.taxable },
    lumpSumLaborTaxable: false,
    validFrom: rate.validFrom,
    version: 1,
    rationale: "The company default rate for states of operation without a state rule.",
  };
}

/**
 * The rule for a job site on a date (spec A5): a jurisdiction rate for the site's county, else
 * the state default, else the company default (in states of operation only), else nothing is
 * collected. A jurisdiction keeps the state's taxability and replaces only the rate.
 */
export function resolveTaxRule(
  tax: TaxDefaults,
  statesOfOperation: readonly string[],
  site: Pick<Address, "state" | "county">,
  on: string,
): { rule: TaxRule | undefined; source: TaxSource } {
  const state = site.state;
  const stateRule = newest(tax.rules.filter((r) => r.state === state && validOn(r, on)));
  const company =
    tax.companyDefault && validOn(tax.companyDefault, on) && statesOfOperation.includes(state)
      ? companyRule(state, tax.companyDefault)
      : undefined;
  const base = stateRule ?? company;
  const county = countyKey(site.county);
  const jurisdiction = county
    ? newest(tax.jurisdictions.filter((j) => j.state === state && countyKey(j.county) === county && validOn(j, on)))
    : undefined;
  if (base && jurisdiction) {
    return {
      rule: { ...base, jurisdiction: jurisdiction.name, ratePct: jurisdiction.ratePct },
      source: { kind: "jurisdiction", label: `${jurisdiction.name} rate (example)` },
    };
  }
  if (stateRule)
    return { rule: stateRule, source: { kind: "state", label: `Default rate for ${stateName(state)} (example)` } };
  if (company) return { rule: company, source: { kind: "company", label: "Company default rate (example)" } };
  return { rule: undefined, source: { kind: "none", label: `Not collected in ${stateName(state)}` } };
}

/**
 * Applies a per-document change of rate (spec A5). The resolved rule keeps its taxability; with
 * no rule at all, materials are taxed at the new rate.
 */
export function withOverride(
  resolved: { rule: TaxRule | undefined; source: TaxSource },
  state: string,
  override: TaxOverride | null | undefined,
): { rule: TaxRule | undefined; source: TaxSource } {
  if (!override) return resolved;
  const base: TaxRule = resolved.rule ?? {
    state: state as StateCode,
    jurisdiction: "Changed on this document",
    ratePct: "0",
    taxable: { material: true, labor: false, freight: false, service: false },
    lumpSumLaborTaxable: false,
    validFrom: override.at.slice(0, 10),
    version: 1,
    rationale: "Rate changed on this document.",
  };
  return {
    rule: { ...base, ratePct: override.ratePct },
    source: { kind: "override", label: `Changed by ${override.byName}: ${override.reason}` },
  };
}
