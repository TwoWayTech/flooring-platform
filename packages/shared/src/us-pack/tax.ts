import type { StateCode } from "./states";

/** Every invoice line carries one tax category (blueprint "Sales tax engine", rule 1). */
export type TaxCategory = "material" | "labor" | "freight" | "service";

/** Display labels for tax categories. */
export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  material: "Materials",
  labor: "Installation labor",
  freight: "Freight and delivery",
  service: "Other services",
};

/**
 * A jurisdiction rule: whether each category is taxable there and at what combined rate
 * (state + county + city). Rules carry a version and validity dates so a posted document
 * keeps the rule it used (blueprint "Localization", rule 1).
 */
export interface TaxRule {
  state: StateCode;
  jurisdiction: string;
  /** Combined rate in percent, e.g. "8.81". */
  ratePct: string;
  taxable: Record<TaxCategory, boolean>;
  /** States where lump-sum billing makes labor taxable even when it is otherwise exempt. */
  lumpSumLaborTaxable: boolean;
  validFrom: string;
  version: number;
  /** Why the rule reads as it does, shown in settings. */
  rationale: string;
}

/** Label shown beside every example rule (spec section 4). */
export const EXAMPLE_RULE_NOTE = "Example: confirm with your accountant";

/**
 * Example rules for the six demo states. Installation labor is the interesting difference:
 * New Jersey taxes floor-covering installation, Maryland does not tax labor to install real
 * property, and Texas treats residential hard-floor installation as a real-property
 * improvement (blueprint "Sales tax engine"). Rates are illustrative combined rates.
 */
export const EXAMPLE_TAX_RULES: readonly TaxRule[] = [
  {
    state: "CO",
    jurisdiction: "Denver combined",
    ratePct: "8.81",
    taxable: { material: true, labor: false, freight: false, service: false },
    lumpSumLaborTaxable: true,
    validFrom: "2026-01-01",
    version: 1,
    rationale: "Separately stated installation and delivery are not taxed; materials are.",
  },
  {
    state: "PA",
    jurisdiction: "Dauphin County combined",
    ratePct: "6",
    taxable: { material: true, labor: false, freight: true, service: false },
    lumpSumLaborTaxable: false,
    validFrom: "2026-01-01",
    version: 1,
    rationale: "Floor installation is a real-property improvement; materials and delivery are taxed.",
  },
  {
    state: "FL",
    jurisdiction: "Hillsborough County combined",
    ratePct: "7.5",
    taxable: { material: true, labor: false, freight: true, service: false },
    lumpSumLaborTaxable: true,
    validFrom: "2026-01-01",
    version: 1,
    rationale: "Separately stated installation is not taxed; materials and delivery are.",
  },
  {
    state: "NJ",
    jurisdiction: "New Jersey statewide",
    ratePct: "6.625",
    taxable: { material: true, labor: true, freight: true, service: true },
    lumpSumLaborTaxable: true,
    validFrom: "2026-01-01",
    version: 1,
    rationale: "Floor-covering installation is a taxable service in New Jersey.",
  },
  {
    state: "MD",
    jurisdiction: "Maryland statewide",
    ratePct: "6",
    taxable: { material: true, labor: false, freight: false, service: false },
    lumpSumLaborTaxable: false,
    validFrom: "2026-01-01",
    version: 1,
    rationale: "Labor to install real property is not taxed in Maryland.",
  },
  {
    state: "TX",
    jurisdiction: "Houston combined",
    ratePct: "8.25",
    taxable: { material: true, labor: false, freight: true, service: false },
    lumpSumLaborTaxable: false,
    validFrom: "2026-01-01",
    version: 1,
    rationale: "Residential hard-floor installation is a real-property improvement; labor is untaxed.",
  },
];

/** The rule for a job-site state, or undefined when the company does not collect there. */
export function ruleForState(rules: readonly TaxRule[], state: string): TaxRule | undefined {
  return rules.find((r) => r.state === state);
}
