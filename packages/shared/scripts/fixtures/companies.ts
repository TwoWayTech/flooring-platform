import type { DefaultRoleKey } from "../../src/permissions/roles";
import type { PermissionKey } from "../../src/permissions/catalog";
import type { ModuleKey, ProductKey } from "../../src/products";
import type { Branch, CompanyId, CustomerType, FloorPattern, UserStatus } from "../../src/types";

/** A place customers and job sites are drawn from. */
export interface Place {
  city: string;
  state: string;
  zipPrefix: string;
  /** The county, which picks a jurisdiction tax rate (spec A5). */
  county: string;
}

/** A named person who becomes a user of the company (and the persona for their role). */
export interface PersonSeed {
  name: string;
  title: string;
  role: DefaultRoleKey;
  branch: number;
  status?: UserStatus;
  /** Days since last login; omitted means never. */
  lastLoginDaysAgo?: number;
}

/** Everything the generator needs to know about one demo company (spec section 3). */
export interface CompanySeed {
  id: CompanyId;
  idPrefix: string;
  seed: number;
  name: string;
  legalName: string;
  city: string;
  state: string;
  product: ProductKey;
  modules: ModuleKey[];
  plan: string;
  userLimit: number;
  branchLimit: number;
  brandColor: string;
  pattern: FloorPattern;
  monogram: string;
  domain: string;
  areaCode: string;
  branches: Branch[];
  places: Place[];
  statesOfOperation: string[];
  /** Permissions the super-admin left out of this company's plan, shown greyed in Security roles. */
  ceilingExclusions: PermissionKey[];
  people: PersonSeed[];
  /** The Purchasing persona (plan K-1), flooring companies only; added after every generator has run. */
  buyer?: { name: string; title: string; branch: number; phone: string };
  employeeCount: number;
  customerMix: Record<CustomerType, number>;
  /** Number of quotes and invoices; null for an HR-only company. */
  sales: { quotes: number; invoices: number } | null;
}

/** The three demo companies. Names are invented (CLAUDE.md rule 10). */
export const COMPANY_SEEDS: readonly CompanySeed[] = [
  {
    id: "summit",
    idPrefix: "sm",
    seed: 4471,
    name: "Summit Floor Co.",
    legalName: "Summit Floor Company LLC",
    city: "Denver",
    state: "CO",
    product: "flooring",
    modules: ["platform", "core", "retail", "installation", "contracts", "hr", "meetings"],
    plan: "Flooring Pro",
    userLimit: 16,
    branchLimit: 3,
    brandColor: "#2E8B7E",
    pattern: "herringbone",
    monogram: "SF",
    domain: "summitfloor.example",
    areaCode: "303",
    branches: [
      { id: "sm-br-denver", name: "Denver", city: "Denver", state: "CO" },
      { id: "sm-br-springs", name: "Colorado Springs", city: "Colorado Springs", state: "CO" },
    ],
    places: [
      { city: "Denver", state: "CO", zipPrefix: "802", county: "Denver" },
      { city: "Aurora", state: "CO", zipPrefix: "800", county: "Arapahoe" },
      { city: "Lakewood", state: "CO", zipPrefix: "802", county: "Jefferson" },
      { city: "Littleton", state: "CO", zipPrefix: "801", county: "Arapahoe" },
      { city: "Arvada", state: "CO", zipPrefix: "800", county: "Jefferson" },
      { city: "Boulder", state: "CO", zipPrefix: "803", county: "Boulder" },
    ],
    statesOfOperation: ["CO", "WY"],
    ceilingExclusions: ["customers.customer.delete", "inventory.product.delete"],
    buyer: { name: "Renata Kowalski", title: "Purchasing coordinator", branch: 0, phone: "(303) 555-0177" },
    people: [
      { name: "Dana Whitfield", title: "Owner", role: "owner", branch: 0, lastLoginDaysAgo: 0 },
      { name: "Luis Ortega", title: "Store manager", role: "manager", branch: 0, lastLoginDaysAgo: 0 },
      { name: "Priya Natarajan", title: "Flooring consultant", role: "sales", branch: 0, lastLoginDaysAgo: 0 },
      { name: "Cole Brennan", title: "Warehouse lead", role: "warehouse", branch: 1, lastLoginDaysAgo: 1 },
      { name: "Marcus Bell", title: "Lead installer", role: "installer", branch: 1, lastLoginDaysAgo: 0 },
      { name: "Grace Liu", title: "Bookkeeper", role: "accountant", branch: 0, lastLoginDaysAgo: 2 },
      { name: "Tamara Reyes", title: "HR coordinator", role: "hr", branch: 0, lastLoginDaysAgo: 3 },
      { name: "Evan Shaw", title: "Flooring consultant", role: "sales", branch: 0, lastLoginDaysAgo: 1 },
      { name: "Nadia Petrov", title: "Commercial sales", role: "sales", branch: 0, lastLoginDaysAgo: 4 },
      { name: "Sam Okafor", title: "Warehouse associate", role: "warehouse", branch: 1, lastLoginDaysAgo: 6 },
      { name: "Ray Duncan", title: "Installer", role: "installer", branch: 1, lastLoginDaysAgo: 2 },
      { name: "Hannah Cole", title: "Design consultant", role: "sales", branch: 0, status: "invited" },
      {
        name: "Victor Sims",
        title: "Former estimator",
        role: "sales",
        branch: 0,
        status: "disabled",
        lastLoginDaysAgo: 140,
      },
      { name: "Bri Alvarez", title: "Office assistant", role: "employee", branch: 0, lastLoginDaysAgo: 5 },
    ],
    employeeCount: 18,
    customerMix: { homeowner: 50, dealer: 18, contractor: 12 },
    sales: { quotes: 300, invoices: 220 },
  },
  {
    id: "keystone",
    idPrefix: "ks",
    seed: 1787,
    name: "Keystone Flooring Supply",
    legalName: "Keystone Flooring Supply Inc.",
    city: "Harrisburg",
    state: "PA",
    product: "flooring",
    modules: ["platform", "core", "wholesale", "contracts", "hr", "meetings"],
    plan: "Flooring Wholesale",
    userLimit: 13,
    branchLimit: 2,
    brandColor: "#2F6B45",
    pattern: "running-bond",
    monogram: "KF",
    domain: "keystoneflooring.example",
    areaCode: "717",
    branches: [
      { id: "ks-br-harrisburg", name: "Harrisburg", city: "Harrisburg", state: "PA" },
      { id: "ks-br-lancaster", name: "Lancaster", city: "Lancaster", state: "PA" },
    ],
    places: [
      { city: "Harrisburg", state: "PA", zipPrefix: "171", county: "Dauphin" },
      { city: "Lancaster", state: "PA", zipPrefix: "176", county: "Lancaster" },
      { city: "York", state: "PA", zipPrefix: "174", county: "York" },
      { city: "Carlisle", state: "PA", zipPrefix: "170", county: "Cumberland" },
      { city: "Cherry Hill", state: "NJ", zipPrefix: "080", county: "Camden" },
      { city: "Trenton", state: "NJ", zipPrefix: "086", county: "Mercer" },
      { city: "Frederick", state: "MD", zipPrefix: "217", county: "Frederick" },
      { city: "Baltimore", state: "MD", zipPrefix: "212", county: "Baltimore City" },
    ],
    statesOfOperation: ["PA", "NJ", "MD"],
    ceilingExclusions: ["customers.customer.delete", "reports.financial.export", "retail.room.measure"],
    buyer: { name: "Owen Achterberg", title: "Purchasing lead", branch: 0, phone: "(717) 555-0163" },
    people: [
      { name: "Martin Hale", title: "Owner", role: "owner", branch: 0, lastLoginDaysAgo: 0 },
      { name: "Rosa Delgado", title: "Operations manager", role: "manager", branch: 0, lastLoginDaysAgo: 0 },
      { name: "Kevin Brandt", title: "Account manager", role: "sales", branch: 0, lastLoginDaysAgo: 0 },
      { name: "Ana Sousa", title: "Warehouse supervisor", role: "warehouse", branch: 0, lastLoginDaysAgo: 1 },
      { name: "Philip Moore", title: "Controller", role: "accountant", branch: 0, lastLoginDaysAgo: 1 },
      { name: "Joyce Kim", title: "HR generalist", role: "hr", branch: 0, lastLoginDaysAgo: 5 },
      { name: "Derek Lutz", title: "Account manager", role: "sales", branch: 1, lastLoginDaysAgo: 2 },
      { name: "Imani Brooks", title: "Inside sales", role: "sales", branch: 1, lastLoginDaysAgo: 3 },
      { name: "Tomás Rivera", title: "Forklift operator", role: "warehouse", branch: 1, lastLoginDaysAgo: 2 },
      { name: "Lena Fischer", title: "Purchasing clerk", role: "employee", branch: 0, status: "invited" },
    ],
    employeeCount: 12,
    customerMix: { homeowner: 0, dealer: 50, contractor: 30 },
    sales: { quotes: 240, invoices: 180 },
  },
  {
    id: "harbor",
    idPrefix: "hb",
    seed: 3361,
    name: "Harbor Staffing Co.",
    legalName: "Harbor Staffing Company LLC",
    city: "Tampa",
    state: "FL",
    product: "hr",
    modules: ["platform", "hr", "meetings"],
    plan: "HR Standard",
    userLimit: 10,
    branchLimit: 2,
    brandColor: "#1F6FA8",
    pattern: "basketweave",
    monogram: "HS",
    domain: "harborstaffing.example",
    areaCode: "813",
    branches: [
      { id: "hb-br-tampa", name: "Tampa office", city: "Tampa", state: "FL" },
      { id: "hb-br-sandiego", name: "San Diego placements", city: "San Diego", state: "CA" },
    ],
    places: [
      { city: "Tampa", state: "FL", zipPrefix: "336", county: "Hillsborough" },
      { city: "St. Petersburg", state: "FL", zipPrefix: "337", county: "Pinellas" },
      { city: "San Diego", state: "CA", zipPrefix: "921", county: "San Diego" },
    ],
    statesOfOperation: ["FL", "CA"],
    ceilingExclusions: ["hr.payroll.export"],
    people: [
      { name: "Elena Brooks", title: "Owner", role: "owner", branch: 0, lastLoginDaysAgo: 0 },
      { name: "Andre Wallace", title: "HR manager", role: "hr", branch: 0, lastLoginDaysAgo: 0 },
      { name: "Mia Chen", title: "Recruiter", role: "employee", branch: 0, lastLoginDaysAgo: 0 },
      { name: "Jamal Pierce", title: "Senior recruiter", role: "employee", branch: 0, lastLoginDaysAgo: 1 },
      { name: "Olivia Grant", title: "Payroll specialist", role: "hr", branch: 0, lastLoginDaysAgo: 2 },
      { name: "Diego Navarro", title: "Placement coordinator", role: "employee", branch: 1, lastLoginDaysAgo: 3 },
      { name: "Kara Lindqvist", title: "Account lead", role: "employee", branch: 1, lastLoginDaysAgo: 8 },
      { name: "Ben Asher", title: "Recruiter", role: "employee", branch: 0, status: "invited" },
    ],
    employeeCount: 30,
    customerMix: { homeowner: 0, dealer: 0, contractor: 0 },
    sales: null,
  },
];

/** The date fixtures are generated against. DemoStore shifts every date so this becomes today. */
export const ANCHOR_DATE = "2026-11-04";
