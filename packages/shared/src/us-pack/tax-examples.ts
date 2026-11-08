import type { CompanyDefaultRate, JurisdictionRate } from "./tax-defaults";

/**
 * Example county rates that replace a state default (spec A5). Like every seeded rate they are
 * examples: confirm with your accountant. The counties are ones the seeded customers do not live
 * in, so the generated documents keep their state rates.
 */
export const EXAMPLE_JURISDICTIONS: readonly JurisdictionRate[] = [
  {
    id: "jur-co-el-paso",
    state: "CO",
    county: "El Paso",
    name: "Colorado Springs combined",
    ratePct: "8.25",
    validFrom: "2025-01-01",
    validTo: null,
  },
  {
    id: "jur-pa-philadelphia",
    state: "PA",
    county: "Philadelphia",
    name: "Philadelphia combined",
    ratePct: "8",
    validFrom: "2025-01-01",
    validTo: null,
  },
  {
    id: "jur-pa-allegheny",
    state: "PA",
    county: "Allegheny",
    name: "Allegheny County combined",
    ratePct: "7",
    validFrom: "2025-01-01",
    validTo: null,
  },
];

/** An example company default rate: materials taxed, labor and services not. */
export const EXAMPLE_COMPANY_DEFAULT: CompanyDefaultRate = {
  ratePct: "4",
  taxable: { material: true, labor: false, freight: false, service: false },
  validFrom: "2025-01-01",
};
