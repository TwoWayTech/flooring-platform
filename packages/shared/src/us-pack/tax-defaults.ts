import { momentInZone } from "../calendar/moments";
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
export const countyKey = (county: string | undefined) =>
  (county ?? "")
    .toLowerCase()
    .replace(/\s+county$/, "")
    .trim();

/**
 * The newest of several rows valid on a date: the latest `validFrom`, then the higher version, then
 * the higher id (a later uuid v7), so the tab (`taxInForce`) and the engine pick the same row even
 * when rows overlap (ADR 0059, part 3a, D26). Saves never make two rows of one state or county valid
 * on one day; only rows written outside the API can.
 */
function newest<T extends { validFrom: string; version?: number; id?: string }>(items: readonly T[]): T | undefined {
  return [...items].sort(
    (a, b) =>
      b.validFrom.localeCompare(a.validFrom) ||
      (b.version ?? 0) - (a.version ?? 0) ||
      (b.id ?? "").localeCompare(a.id ?? ""),
  )[0];
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
 * The Sales tax tab as in force on `day` (ADR 0059, part 3a, D7, D26): per state the rule
 * `resolveTaxRule` uses that day, and per county (`countyKey`) the rate it uses: `newest` among the
 * rows valid that day. Sorted by state, then county, so both modes answer one order. Rows closed
 * before `day` or starting after it are left out; the other fields are as given.
 */
export function taxInForce<T extends TaxDefaults>(tax: T, day: string): T {
  const pick = <R extends { validFrom: string; validTo?: string | null; version?: number; id?: string }>(
    rows: readonly R[],
    keyOf: (row: R) => string,
  ): R[] => {
    const groups = new Map<string, R[]>();
    for (const row of rows) if (validOn(row, day)) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
    return [...groups.keys()]
      .sort()
      .map((key) => newest(groups.get(key) ?? []))
      .filter((row): row is R => row !== undefined);
  };
  // Only the two lists are replaced, by rows of their own types, so the result is still a T.
  return {
    ...tax,
    rules: pick(tax.rules, (rule) => rule.state),
    jurisdictions: pick(tax.jurisdictions, (rate) => `${rate.state}:${countyKey(rate.county)}`),
  } as T;
}

/**
 * Applies a per-document change of rate (spec A5). The resolved rule keeps its taxability; with
 * no rule at all, materials are taxed at the new rate, from the company's day the change was made:
 * `override.at` is a moment, read on the company's clock in `zone` (ADR 0064), not as a UTC day.
 */
export function withOverride(
  resolved: { rule: TaxRule | undefined; source: TaxSource },
  state: string,
  override: TaxOverride | null | undefined,
  zone: string,
): { rule: TaxRule | undefined; source: TaxSource } {
  if (!override) return resolved;
  const base: TaxRule = resolved.rule ?? {
    state: state as StateCode,
    jurisdiction: "Changed on this document",
    ratePct: "0",
    taxable: { material: true, labor: false, freight: false, service: false },
    lumpSumLaborTaxable: false,
    validFrom: momentInZone(override.at, zone)?.wall.slice(0, 10) ?? override.at.slice(0, 10),
    version: 1,
    rationale: "Rate changed on this document.",
  };
  return {
    rule: { ...base, ratePct: override.ratePct },
    source: { kind: "override", label: `Changed by ${override.byName}: ${override.reason}` },
  };
}
