import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_KEYS, SENSITIVE, type PermissionKey } from "../src/permissions/catalog";
import {
  enabledModules,
  planModulesOf,
  scopeAllows,
  seesMargin,
  SENSITIVE_FIELDS,
  sensitiveKeyFor,
  separateDuties,
} from "../src/permissions/access-rules";
import { PRODUCT_ROLES, roleTemplate } from "../src/permissions/roles";

describe("enabledModules (P10: blueprint layer 2, modules)", () => {
  it("turns on all of the product's modules while there is no subscription", () => {
    expect(enabledModules(["hr"], null, []).sort()).toEqual(["hr", "meetings", "platform"]);
  });

  it("limits to the plan's modules and always keeps platform", () => {
    expect(enabledModules(["flooring"], ["core", "retail"], []).sort()).toEqual(["core", "platform", "retail"]);
  });

  it("applies overrides, but never outside the company's products", () => {
    const modules = enabledModules(
      ["hr"],
      ["hr"],
      [
        { module: "meetings", enabled: true },
        { module: "hr", enabled: false },
        { module: "contracts", enabled: true },
      ],
    );
    expect(modules.sort()).toEqual(["meetings", "platform"]);
  });

  it("cannot switch platform off", () => {
    expect(enabledModules(["hr"], null, [{ module: "platform", enabled: false }])).toContain("platform");
  });
});

describe("SENSITIVE_FIELDS (CLAUDE.md rule 5)", () => {
  it("maps every field to a real view_sensitive key", () => {
    for (const key of Object.values(SENSITIVE_FIELDS)) {
      expect(ALL_PERMISSION_KEYS).toContain(key);
      expect(key.endsWith(".view_sensitive")).toBe(true);
    }
  });

  it("covers cost, margin, pay rate and credit limit", () => {
    for (const field of ["cost", "margin", "payRate", "creditLimit", "estimatedCost"]) {
      expect(SENSITIVE_FIELDS[field]).toBeDefined();
    }
  });
});

describe("scopeAllows (spec rule 4, data scope)", () => {
  const viewer = { userId: "u1", branchId: "b1" };

  it("lets all see everything, own see only their records, branch see their branch and their own", () => {
    const mine = { ownerUserId: "u1", branchId: "b2" };
    const branchmate = { ownerUserId: "u2", branchId: "b1" };
    const other = { ownerUserId: "u3", branchId: "b9" };
    expect([mine, branchmate, other].map((row) => scopeAllows("all", viewer, row))).toEqual([true, true, true]);
    expect([mine, branchmate, other].map((row) => scopeAllows("own", viewer, row))).toEqual([true, false, false]);
    expect([mine, branchmate, other].map((row) => scopeAllows("branch", viewer, row))).toEqual([true, true, false]);
  });

  it("never widens access when the viewer or the record has no owner or branch", () => {
    const noBranchViewer = { userId: "u1", branchId: null };
    expect(scopeAllows("branch", noBranchViewer, { ownerUserId: "u2", branchId: null })).toBe(false);
    expect(scopeAllows("own", viewer, { ownerUserId: null, branchId: "b1" })).toBe(false);
  });
});

describe("separateDuties (blueprint Security: a second person approves)", () => {
  it("refuses the person who recorded it and allows anyone else", () => {
    expect(separateDuties("u1", "u1")).toBe("same_person");
    expect(separateDuties("u1", "u2")).toBeNull();
    expect(separateDuties(null, "u2")).toBeNull();
  });
});

describe("planModulesOf (PR #7 reviews: only a trial company gets all modules)", () => {
  const now = new Date(Date.UTC(2026, 10, 13));
  const at = (day: number) => new Date(Date.UTC(2026, 10, day));

  it("gives a trial company with no current subscription all of its products' modules", () => {
    expect(planModulesOf([], true, now)).toBeNull();
  });

  it("gives a company that is not a trial and has no subscription rows no plan modules", () => {
    expect(planModulesOf([], false, now)).toEqual([]);
    expect(enabledModules(["flooring"], planModulesOf([], false, now), [])).toEqual(["platform"]);
  });

  it("unions the plans of current subscriptions, one per product", () => {
    const modules = planModulesOf(
      [
        { status: "active", currentPeriodEnd: at(30), modules: ["core", "retail"] },
        { status: "trial", currentPeriodEnd: at(20), modules: ["hr"] },
        { status: "cancelled", currentPeriodEnd: at(29), modules: ["contracts"] },
      ],
      false,
      now,
    );
    expect([...(modules ?? [])].sort()).toEqual(["core", "hr", "retail"]);
  });

  it("keeps only the latest plan when no subscription is current, and never turns into a trial", () => {
    const subscriptions = [
      { status: "cancelled" as const, currentPeriodEnd: at(1), modules: ["core", "contracts"] as const },
      { status: "trial" as const, currentPeriodEnd: at(5), modules: ["core"] as const },
    ];
    expect(planModulesOf(subscriptions, false, now)).toEqual(["core"]);
    expect(enabledModules(["flooring"], planModulesOf(subscriptions, false, now), []).sort()).toEqual([
      "core",
      "platform",
    ]);
  });
});

describe("seesMargin (ADR 0037, 2026-11-16 and 2026-11-17)", () => {
  const holding =
    (...keys: PermissionKey[]) =>
    (key: PermissionKey) =>
      keys.includes(key);

  it("needs the margin key and the product-cost key, because margin gives the cost away", () => {
    expect(seesMargin(holding(SENSITIVE.margin, SENSITIVE.productCost))).toBe(true);
    expect(seesMargin(holding(SENSITIVE.margin))).toBe(false);
    expect(seesMargin(holding(SENSITIVE.productCost))).toBe(false);
    expect(seesMargin(holding())).toBe(false);
  });

  it.each(PRODUCT_ROLES.flooring)("changes nothing for the default %s role: it follows the margin key", (key) => {
    const held = new Set(roleTemplate(key).permissions);
    const has = (permission: PermissionKey) => held.has(permission);
    expect(seesMargin(has)).toBe(held.has(SENSITIVE.margin));
  });
});

describe("sensitiveKeyFor", () => {
  it("matches snake_case columns from raw SQL as their camelCase names", () => {
    expect(sensitiveKeyFor("unit_cost")).toBe(SENSITIVE_FIELDS.unitCost);
    expect(sensitiveKeyFor("credit_limit")).toBe(SENSITIVE_FIELDS.creditLimit);
    expect(sensitiveKeyFor("name")).toBeUndefined();
  });

  it("matches only the map's own names, never Object.prototype's (finding F-l)", () => {
    const inherited = ["constructor", "toString", "to_string", "valueOf", "hasOwnProperty", "__proto__"];
    for (const field of [...inherited, "isPrototypeOf", "__defineGetter__"]) {
      expect(sensitiveKeyFor(field), field).toBeUndefined();
    }
  });
});

/**
 * Fields in the shared types that look like money a role may not see but are deliberately not
 * stripped by name, with the reason. A new cost, margin, rate, wage or limit field must be added to
 * SENSITIVE_FIELDS or here, so nothing is forgotten (PR #7 review).
 */
const NOT_SENSITIVE: Readonly<Record<string, string>> = {
  costingMethod: "the name of the stock costing method (ADR 0040), not a cost",
  ratePct: "commission and tax percentages",
  baseRatePct: "a commission plan's base rate, not a pay rate",
  taxRate: "sales tax",
  fxRate: "currency exchange",
  accrualRate: "time-off accrual hours",
  rates: "the portal flag for whether a person may see their own rate (ADR 0049), not a rate",
  limit: "a generic count",
  limits: "plan limits",
  userLimit: "plan seats",
  branchLimit: "plan branches",
  userLimitOverride: "a platform admin's seat override on a subscription row",
  branchLimitOverride: "a platform admin's branch override on a subscription row",
  limitRows: "how many subscription rows an access save wrote, in the platform audit log",
  annualUseLimitHours: "time-off hours",
  salaryHoursPerWeek: "working hours",
  grossPay: "payroll amounts; payroll routes need hr.payroll.view",
  straightTimePay: "payroll amounts; payroll routes need hr.payroll.view",
  commissionPay: "payroll amounts; payroll routes need hr.payroll.view",
  paidLeavePay: "payroll amounts; payroll routes need hr.payroll.view",
  salaryDeduction: "payroll amounts; payroll routes need hr.payroll.view",
  costExpenses: "the business report's expense total; reports need their own permission",
  sharedCosts: "a settings section name",
  payments: "a collection name",
  supplierPayments: "a collection name",
  contractorPayments: "a collection name",
  payroll: "a section name",
  payType: "salary or hourly, not an amount",
  payPeriodId: "an id",
  payPeriods: "a collection name",
  payPeriodAnchor: "a date",
  payLines: "a collection name",
  payFrequency: "a schedule",
  payDate: "a date",
  pay: "a section name",
  payable: "a flag",
  payment: "a record name",
  paymentId: "an id",
  paymentMethod: "a method",
  paymentPrefix: "a document number prefix",
  lastPaymentAt: "a date",
  paymentsTo: "a date bound of the Payments received report (ADR 0055)",
  supplierPaymentId: "an id",
  showRatesToEmployees: "a setting flag",
  showPayToEmployees: "a setting flag",
  hasPayPostings: "a fact of the journal that decides who may read the trial balance (ADR 0055), not an amount",
};

describe("every cost, margin, rate, wage and limit field in packages/shared is classified", () => {
  it("is in SENSITIVE_FIELDS or listed as not sensitive", () => {
    const pattern =
      /^\s+(?:readonly )?([a-zA-Z]*(?:[Cc]ost|[Mm]argin|[Rr]ate|[Ss]alary|[Ww]age|[Ll]imit|[Pp]ay)[a-zA-Z]*)\??:/gm;
    const fields = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts"))
          for (const match of readFileSync(path, "utf8").matchAll(pattern)) fields.add(match[1]);
      }
    };
    walk(join(import.meta.dirname, "../src"));
    const unclassified = [...fields].filter((field) => !SENSITIVE_FIELDS[field] && !NOT_SENSITIVE[field]).sort();
    expect(unclassified).toEqual([]);
  });
});
