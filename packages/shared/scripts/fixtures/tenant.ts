import { addDays } from "../../src/dates";
import { defaultNumberSettings } from "../../src/numbers";
import { ALL_PERMISSION_KEYS, permissionsForModules } from "../../src/permissions/catalog";
import { PRODUCT_ROLES, roleTemplate } from "../../src/permissions/roles";
import { PRODUCT_MODULES } from "../../src/products";
import type { Company, CompanySettings, Employee, Role, User } from "../../src/types";
import { EXAMPLE_TAX_RULES } from "../../src/us-pack/tax";
import { EXAMPLE_COMPANY_DEFAULT, EXAMPLE_JURISDICTIONS } from "../../src/us-pack/tax-examples";
import { ANCHOR_DATE, type CompanySeed } from "./companies";
import type { GenContext } from "./context";
import { branchWarehouse } from "./locations";
import { emailFor } from "./random";

const TIME_ZONES: Record<string, string> = { CO: "America/Denver", PA: "America/New_York", FL: "America/New_York" };

/**
 * The company record the super-admin manages. The ceiling is every permission the product
 * offers minus what the plan leaves out (blueprint "Permission ceiling").
 */
export function buildCompany(seed: CompanySeed): Company {
  const offered = new Set(permissionsForModules(PRODUCT_MODULES[seed.product]));
  const excluded = new Set(seed.ceilingExclusions);
  return {
    id: seed.id,
    name: seed.name,
    city: seed.city,
    state: seed.state,
    product: seed.product,
    modules: [...seed.modules],
    plan: seed.plan,
    status: "active",
    userLimit: seed.userLimit,
    branchLimit: seed.branchLimit,
    ceiling: ALL_PERMISSION_KEYS.filter((k) => offered.has(k) && !excluded.has(k)),
    branches: seed.branches,
    createdAt: addDays(ANCHOR_DATE, (-seed.seed % 400) - 420),
  };
}

/** Default roles for the company's product, limited to permissions the product offers. */
export function buildRoles(seed: CompanySeed): Role[] {
  const offered = new Set(permissionsForModules(PRODUCT_MODULES[seed.product]));
  return PRODUCT_ROLES[seed.product].map((key) => {
    const template = roleTemplate(key);
    return {
      id: roleId(seed, key),
      companyId: seed.id,
      key,
      name: template.name,
      description: template.description,
      permissions: template.permissions.filter((p) => offered.has(p)),
      dataScope: template.dataScope,
      system: true,
      owner: template.owner,
    };
  });
}

/** Stable id of a default role inside a company. */
export function roleId(seed: CompanySeed, key: string): string {
  return `${seed.idPrefix}-role-${key}`;
}

/** Roles whose holders must use MFA (blueprint: Owner, Accountant and HR). */
const MFA_REQUIRED = new Set(["owner", "accountant", "hr"]);

/** Users from the company's people; the first employees are the same people. */
export function buildUsers(ctx: GenContext, employees: readonly Employee[]): User[] {
  const { company: seed, rng } = ctx;
  return seed.people.map((person, i) => {
    const status = person.status ?? "active";
    return {
      id: `${seed.idPrefix}-usr-${String(i + 1).padStart(2, "0")}`,
      companyId: seed.id,
      name: person.name,
      email: emailFor(person.name, seed.domain),
      title: person.title,
      roleIds: [roleId(seed, person.role)],
      branchId: seed.branches[person.branch]!.id,
      status,
      mfaEnrolled: status !== "invited" && (MFA_REQUIRED.has(person.role) || rng.chance(0.6)),
      lastLoginAt:
        person.lastLoginDaysAgo === undefined
          ? null
          : `${addDays(ctx.anchor, -person.lastLoginDaysAgo)}T${String(rng.int(7, 17)).padStart(2, "0")}:${String(rng.int(0, 59)).padStart(2, "0")}`,
      employeeId: employees[i]?.id ?? null,
      defaultLocationId:
        person.role === "warehouse" ? branchWarehouse(seed.id, seed.branches[person.branch]!.id) : null,
    };
  });
}

/** Settings for branding, localization and tax, number format and the company profile. */
export function buildSettings(ctx: GenContext): CompanySettings {
  const { company: seed, rng } = ctx;
  const retail = seed.modules.includes("retail");
  return {
    branding: {
      displayName: seed.name,
      monogram: seed.monogram,
      brandColor: seed.brandColor,
      pattern: seed.pattern,
      logoDataUrl: null,
      defaultTheme: "system",
    },
    localization: {
      region: {
        country: "US",
        primaryState: seed.state,
        statesOfOperation: [...seed.statesOfOperation],
        timeZone: TIME_ZONES[seed.state] ?? "America/New_York",
        locale: "en-US",
        dateFormat: "MMM d, yyyy",
        firstDayOfWeek: "monday",
        fiscalYearStartMonth: 1,
        areaUnit: "sq_ft",
      },
      currency: {
        base: "USD",
        locked: true,
        extra: seed.id === "keystone" ? [{ code: "CAD", rate: "1.3870", asOf: ctx.anchor }] : [],
      },
      tax: {
        pricesInclude: "exclusive",
        rounding: "invoice",
        rules: EXAMPLE_TAX_RULES.map((r) => ({ ...r, taxable: { ...r.taxable } })),
        jurisdictions: EXAMPLE_JURISDICTIONS.map((j) => ({ ...j })),
        companyDefault: { ...EXAMPLE_COMPANY_DEFAULT, taxable: { ...EXAMPLE_COMPANY_DEFAULT.taxable } },
        filing: seed.statesOfOperation.map((state) => ({ state, frequency: "monthly" as const })),
        certificateTypes: ["Resale certificate", "Exemption certificate"],
      },
      payroll: {
        overtimeRule: "federal",
        payFrequency: "biweekly",
        ptoAccrualHoursPerMonth: "6.67",
        holidayState: seed.state,
      },
      documents: {
        defaultTerms: retail ? "due_on_receipt" : "net_30",
        lateFeePct: "1.5",
        quotePrefix: "Q-",
        invoicePrefix: "INV-",
        poPrefix: "PO-",
        legalFooter: `${seed.legalName}. Licensed and insured in ${seed.statesOfOperation.join(", ")}.`,
        defaultDepositPct: retail ? "50" : "0",
        quoteExpiryDays: 30,
      },
    },
    numbers: defaultNumberSettings(),
    profile: {
      legalName: seed.legalName,
      dba: seed.name,
      ein: `${rng.int(20, 89)}-${rng.int(1000000, 9999999)}`,
      phone: rng.phone(seed.areaCode),
      email: `office@${seed.domain}`,
      website: `https://${seed.domain}`,
      address: ctx.address(seed.places[0]),
    },
  };
}
