import { addDays, mondayOf } from "../../src/dates";
import { defaultNumberSettings } from "../../src/numbers";
import { ALL_PERMISSION_KEYS, permissionsForModules } from "../../src/permissions/catalog";
import { PRODUCT_ROLES, roleTemplate } from "../../src/permissions/roles";
import { PRODUCT_MODULES } from "../../src/products";
import type { Company, CompanyFixtures, CompanySettings, Employee, Role, User } from "../../src/types";
import { federalHolidays } from "../../src/us-pack/holidays";
import { EXAMPLE_TAX_RULES } from "../../src/us-pack/tax";
import { EXAMPLE_COMPANY_DEFAULT, EXAMPLE_JURISDICTIONS } from "../../src/us-pack/tax-examples";
import { ANCHOR_DATE, type CompanySeed } from "./companies";
import type { GenContext } from "./context";
import { branchWarehouse } from "./locations";
import { emailFor } from "./random";

/** The time zone of each seed state. */
export const TIME_ZONES: Record<string, string> = {
  CO: "America/Denver",
  PA: "America/New_York",
  FL: "America/New_York",
};

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

/**
 * Adds the Purchasing persona (plan K-1). It runs after every generator and draws no random
 * numbers, so the records generated before it keep their values.
 */
export function withBuyer(ctx: GenContext, fixtures: CompanyFixtures): CompanyFixtures {
  const { company: seed, anchor } = ctx;
  const buyer = seed.buyer;
  if (!buyer) return fixtures;
  const employeeId = ctx.id("emp");
  const email = emailFor(buyer.name, seed.domain);
  const employee: Employee = {
    id: employeeId,
    companyId: seed.id,
    name: buyer.name,
    title: buyer.title,
    department: "Purchasing",
    workerType: "w2",
    payType: "salary",
    payRate: "64000.00",
    state: seed.branches[buyer.branch]!.state,
    email,
    phone: buyer.phone,
    hiredAt: addDays(anchor, -812),
    status: "active",
    managerId: fixtures.employees[0]!.id,
    flsaStatus: "not_applicable",
    exemptionBasis: null,
    salaryHoursPerWeek: 40,
    commissionVisible: null,
    homeLocationId: null,
    birthDate: null,
    emergencyContact: null,
    documents: [],
    onboarding: [],
    offboarding: [],
  };
  ctx.openingPto.set(employeeId, 52);
  const user: User = {
    id: `${seed.idPrefix}-usr-${String(seed.people.length + 1).padStart(2, "0")}`,
    companyId: seed.id,
    name: buyer.name,
    email,
    title: buyer.title,
    roleIds: [roleId(seed, "purchasing")],
    branchId: seed.branches[buyer.branch]!.id,
    status: "active",
    mfaEnrolled: true,
    lastLoginAt: `${addDays(anchor, -1)}T09:12`,
    employeeId,
    defaultLocationId: branchWarehouse(seed.id, seed.branches[buyer.branch]!.id),
  };
  return { ...fixtures, employees: [...fixtures.employees, employee], users: [...fixtures.users, user] };
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
        balanceDueDays: 30,
        // Carpet and tile cut more than plank (the waste the quote builder always started with).
        defaultWastePct: {
          carpet: "12",
          carpet_tile: "8",
          lvp: "8",
          laminate: "8",
          engineered_hardwood: "8",
          solid_hardwood: "8",
          porcelain_tile: "10",
          pad: "8",
          adhesive_trim: "8",
        },
      },
    },
    numbers: defaultNumberSettings(),
    payments: {
      // Summit checks larger payments twice; Keystone confirms at once (spec Appendix A "Approval").
      approvalRequired: retail,
      approvalThreshold: retail ? "1000.00" : "",
      writeOffMax: "5.00",
      paymentPrefix: "PAY-",
      refundPrefix: "RF-",
    },
    inventory: { adjustmentApprovalQty: "1000" },
    hr: {
      workweekStartDay: 1,
      payFrequency: seed.id === "harbor" ? "weekly" : "biweekly",
      payPeriodAnchor: addDays(mondayOf(ctx.anchor), -42),
      holidays: [...federalHolidays(2026), ...federalHolidays(2027)],
      showPayToEmployees: true,
      showCommissionToEmployees: false,
      showRatesToEmployees: false,
      showTeamCalendarToEmployees: false,
      clockEnabled: seed.id !== "keystone",
    },
    expenses: { approvalRequired: retail, approvalThreshold: retail ? "1000.00" : "" },
    sharedCosts: { rule: "revenue", fixedPct: {} },
    meetings: { defaultReminderMin: 15, newGuestHandling: "contact", allowProposals: true, hideGuestList: false },
    email: { senderName: seed.name, replyTo: `office@${seed.domain}`, signature: `The team at ${seed.name}` },
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
