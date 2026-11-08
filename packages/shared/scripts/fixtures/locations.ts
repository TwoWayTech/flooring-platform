import type { CompanyId, Location } from "../../src/types";

/**
 * Warehouses and showrooms per company (spec A1): Summit gets two warehouses and two showrooms,
 * Keystone two warehouses and one showroom, Harbor none. Names and addresses are invented
 * (CLAUDE.md rule 10); warehouses come first, the default one first of all.
 */
const LOCATIONS: Record<CompanyId, Location[]> = {
  summit: [
    {
      id: "sm-loc-denver",
      name: "Denver Central",
      kind: "warehouse",
      branchId: "sm-br-denver",
      address: { street: "4870 Quarry Lane", city: "Denver", state: "CO", zip: "80216", county: "Denver" },
      isDefault: true,
      displaySamples: 0,
    },
    {
      id: "sm-loc-springs",
      name: "Colorado Springs",
      kind: "warehouse",
      branchId: "sm-br-springs",
      address: {
        street: "1215 Foundry Way",
        city: "Colorado Springs",
        state: "CO",
        zip: "80907",
        county: "El Paso",
      },
      isDefault: false,
      displaySamples: 0,
    },
    {
      id: "sm-loc-studio",
      name: "Summit Design Studio",
      kind: "showroom",
      branchId: "sm-br-denver",
      address: { street: "220 Larkspur Avenue", city: "Denver", state: "CO", zip: "80206", county: "Denver" },
      isDefault: false,
      displaySamples: 142,
    },
    {
      id: "sm-loc-southgate",
      name: "Southgate Showroom",
      kind: "showroom",
      branchId: "sm-br-springs",
      address: {
        street: "3380 Meadowgate Drive",
        city: "Colorado Springs",
        state: "CO",
        zip: "80920",
        county: "El Paso",
      },
      isDefault: false,
      displaySamples: 96,
    },
  ],
  keystone: [
    {
      id: "ks-loc-harrisburg",
      name: "Harrisburg Distribution",
      kind: "warehouse",
      branchId: "ks-br-harrisburg",
      address: { street: "900 Keel Road", city: "Harrisburg", state: "PA", zip: "17111", county: "Dauphin" },
      isDefault: true,
      displaySamples: 0,
    },
    {
      id: "ks-loc-lancaster",
      name: "Lancaster Yard",
      kind: "warehouse",
      branchId: "ks-br-lancaster",
      address: { street: "41 Millrace Pike", city: "Lancaster", state: "PA", zip: "17601", county: "Lancaster" },
      isDefault: false,
      displaySamples: 0,
    },
    {
      id: "ks-loc-frontst",
      name: "Front Street Showroom",
      kind: "showroom",
      branchId: "ks-br-harrisburg",
      address: { street: "1600 Front Street", city: "Harrisburg", state: "PA", zip: "17102", county: "Dauphin" },
      isDefault: false,
      displaySamples: 64,
    },
  ],
  harbor: [],
};

/** A company's warehouses and showrooms, as fresh copies. */
export function buildLocations(companyId: CompanyId): Location[] {
  return LOCATIONS[companyId].map((l) => ({ ...l, address: { ...l.address } }));
}

/** Ids of a company's warehouses, default first. */
export function warehouseIds(companyId: CompanyId): string[] {
  return LOCATIONS[companyId].filter((l) => l.kind === "warehouse").map((l) => l.id);
}

/** The warehouse of a branch, or the company's default warehouse when the branch has none. */
export function branchWarehouse(companyId: CompanyId, branchId: string): string {
  const warehouses = LOCATIONS[companyId].filter((l) => l.kind === "warehouse");
  return (warehouses.find((l) => l.branchId === branchId) ?? warehouses[0])?.id ?? "";
}
