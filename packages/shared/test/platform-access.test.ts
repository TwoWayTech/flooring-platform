import { describe, expect, it } from "vitest";
import { enabledModules, type ModuleOverride, type PlanModules } from "../src/permissions/access-rules";
import { ALL_PERMISSION_KEYS, isPermissionKey, permissionDef, type PermissionKey } from "../src/permissions/catalog";
import {
  ACCESS_LIMIT_MESSAGE,
  accessDiff,
  accessPatchProblem,
  ceilingRowsFor,
  isAccessLimit,
  limitOverrideFor,
  moduleOverridesFor,
  offeredKeys,
  offeredModules,
  PROTECTED_CEILING_KEYS,
  type AccessPatchInput,
  type AccessState,
  type ModuleOverrideChange,
} from "../src/platform/access-patch";
import { isPlatformAdminRole, PLATFORM_ADMIN_ROLES } from "../src/platform/admin-roles";
import { inModuleOrder, isModuleKey, PRODUCT_MODULES, type ModuleKey, type ProductKey } from "../src/products";

const FLOORING: ProductKey[] = ["flooring"];
const HR: ProductKey[] = ["hr"];
const BOTH: ProductKey[] = ["flooring", "hr"];
const PAID = { products: FLOORING, hasSubscription: true };
const HR_PAID = { products: HR, hasSubscription: true };
const TRIAL = { products: FLOORING, hasSubscription: false };
/** Every module visible, as when the Installation switch is on. */
const ALL_VISIBLE: ModuleKey[] = [
  "platform",
  "core",
  "retail",
  "wholesale",
  "installation",
  "contracts",
  "hr",
  "meetings",
];

const PLATFORM_LOCKED = { status: 400, message: "The Platform module can't be switched off." };
const PROTECTED_MISSING = {
  status: 400,
  message:
    "A company always keeps the Users, Security roles and Audit log permissions, so it can manage its own people.",
};
const LIMIT_RANGE = { status: 400, message: "Enter a whole number from 1 to 100,000." };
const NO_PLAN = { status: 422, message: "This company is on a trial with no plan, so it has no limits to change." };

/** The overrides a company holds after a save applies its changes to the stored rows. */
function applied(stored: readonly ModuleOverride[], changes: readonly ModuleOverrideChange[]): ModuleOverride[] {
  const rows = new Map(stored.map((row) => [row.module, row.enabled]));
  for (const change of changes) {
    if (change.action === "remove") rows.delete(change.module);
    else rows.set(change.module, change.enabled);
  }
  return [...rows].map(([module, enabled]) => ({ module, enabled }));
}

/** The effective modules after a save, the way `enabledModules` reads them on the next request. */
function modulesAfter(
  products: readonly ProductKey[],
  plan: PlanModules,
  stored: readonly ModuleOverride[],
  requested: readonly ModuleKey[],
  visible?: readonly ModuleKey[],
): ModuleKey[] {
  const changes = moduleOverridesFor(products, plan, stored, requested, visible);
  return enabledModules(products, plan, applied(stored, changes)).sort();
}

describe("PROTECTED_CEILING_KEYS (platform-admin spec, Validations; review A5)", () => {
  it("are the Users, Security roles and Audit log keys of the Platform module", () => {
    expect([...PROTECTED_CEILING_KEYS]).toEqual([
      "settings.users.view",
      "settings.users.manage",
      "settings.roles.view",
      "settings.roles.manage",
      "settings.audit.view",
    ]);
    for (const key of PROTECTED_CEILING_KEYS) expect(permissionDef(key)?.module).toBe("platform");
  });

  it("are offered to every product, whatever the feature switches hide", () => {
    for (const products of [FLOORING, HR, BOTH]) {
      for (const visible of [undefined, ["platform"] as ModuleKey[]]) {
        expect(offeredKeys(products, visible)).toEqual(expect.arrayContaining([...PROTECTED_CEILING_KEYS]));
      }
    }
  });
});

describe("offeredModules and offeredKeys (product spec rule 18)", () => {
  it("gives the product's modules in display order and hides Installation while its switch is off", () => {
    expect(offeredModules(FLOORING)).toEqual([
      "platform",
      "core",
      "retail",
      "wholesale",
      "contracts",
      "hr",
      "meetings",
    ]);
    expect(offeredModules(FLOORING, ALL_VISIBLE)).toEqual([...PRODUCT_MODULES.flooring]);
    expect(offeredModules(HR)).toEqual(["platform", "hr", "meetings"]);
  });

  it("joins two products without duplicates and gives nothing for no product", () => {
    expect(offeredModules(BOTH)).toEqual(offeredModules(FLOORING));
    expect(offeredModules(["hr", "flooring"])).toEqual(offeredModules(FLOORING));
    expect(offeredModules([])).toEqual([]);
  });

  it("gives only the keys of those modules, in catalog order", () => {
    const hrKeys = offeredKeys(HR);
    expect(hrKeys).toContain("hr.employee.view");
    expect(hrKeys).not.toContain("sales.quote.view");
    expect(hrKeys).toEqual(ALL_PERMISSION_KEYS.filter((key) => hrKeys.includes(key)));
    expect(offeredKeys(FLOORING)).not.toContain("installation.job.view");
    expect(offeredKeys(FLOORING, ALL_VISIBLE)).toContain("installation.job.view");
  });
});

describe("accessPatchProblem (platform-admin spec, Validations)", () => {
  it("accepts an empty patch and a full, valid one", () => {
    expect(accessPatchProblem(PAID, {})).toBeNull();
    const patch = { modules: offeredModules(FLOORING), ceiling: offeredKeys(FLOORING), userLimit: 12, branchLimit: 3 };
    expect(accessPatchProblem(PAID, patch)).toBeNull();
  });

  it("refuses a module list that lacks platform, even an empty one", () => {
    expect(accessPatchProblem(PAID, { modules: ["core", "retail"] })).toEqual(PLATFORM_LOCKED);
    expect(accessPatchProblem(PAID, { modules: [] })).toEqual(PLATFORM_LOCKED);
  });

  it("refuses a module the company's products don't offer, by its label", () => {
    expect(accessPatchProblem(HR_PAID, { modules: ["platform", "hr", "contracts"] })).toEqual({
      status: 400,
      message: "The Contracts module isn't offered to this company.",
    });
  });

  it("refuses a hidden module (rule 18) until its switch is on", () => {
    const patch = { modules: ["platform", "core", "installation"] };
    expect(accessPatchProblem(PAID, patch)).toEqual({
      status: 400,
      message: "The Installation module isn't offered to this company.",
    });
    expect(accessPatchProblem(PAID, patch, ALL_VISIBLE)).toBeNull();
  });

  it("refuses a name that is not a module", () => {
    expect(accessPatchProblem(PAID, { modules: ["platform", "billing"] })).toEqual({
      status: 400,
      message: "The billing module isn't offered to this company.",
    });
  });

  it("refuses a key that is not in the catalog, or a retired one", () => {
    const ceiling = [...PROTECTED_CEILING_KEYS, "sales.quote.fly"];
    expect(accessPatchProblem(PAID, { ceiling })).toEqual({
      status: 400,
      message: "sales.quote.fly is not a permission.",
    });
    expect(accessPatchProblem(PAID, { ceiling: [...PROTECTED_CEILING_KEYS, "sales.payment.create"] })).toEqual({
      status: 400,
      message: "sales.payment.create is not a permission.",
    });
  });

  it("refuses a key outside the products, and a key of a hidden module", () => {
    expect(accessPatchProblem(HR_PAID, { ceiling: [...PROTECTED_CEILING_KEYS, "sales.quote.view"] })).toEqual({
      status: 400,
      message: "sales.quote.view is outside this company's products.",
    });
    const hidden = [...PROTECTED_CEILING_KEYS, "installation.job.view"];
    expect(accessPatchProblem(PAID, { ceiling: hidden })).toEqual({
      status: 400,
      message: "installation.job.view is outside this company's products.",
    });
    expect(accessPatchProblem(PAID, { ceiling: hidden }, ALL_VISIBLE)).toBeNull();
  });

  it("refuses a ceiling without any one of the protected keys, the empty one included", () => {
    for (const missing of PROTECTED_CEILING_KEYS) {
      const ceiling = offeredKeys(FLOORING).filter((key) => key !== missing);
      expect(accessPatchProblem(PAID, { ceiling })).toEqual(PROTECTED_MISSING);
    }
    expect(accessPatchProblem(PAID, { ceiling: [] })).toEqual(PROTECTED_MISSING);
    expect(accessPatchProblem(PAID, { ceiling: [...PROTECTED_CEILING_KEYS] })).toBeNull();
  });

  it("ignores duplicates in a list", () => {
    const patch = {
      modules: ["platform", "platform", "core", "core"],
      ceiling: [...PROTECTED_CEILING_KEYS, "settings.users.view"],
    };
    expect(accessPatchProblem(PAID, patch)).toBeNull();
  });

  it("accepts limits from 1 to 100,000 and refuses anything else", () => {
    for (const limit of [1, 16, 100_000]) {
      expect(accessPatchProblem(PAID, { userLimit: limit })).toBeNull();
      expect(accessPatchProblem(PAID, { branchLimit: limit })).toBeNull();
    }
    for (const limit of [0, -1, 100_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(accessPatchProblem(PAID, { userLimit: limit })).toEqual(LIMIT_RANGE);
      expect(accessPatchProblem(PAID, { userLimit: 5, branchLimit: limit })).toEqual(LIMIT_RANGE);
    }
  });

  it("shares its limit check and message with the console's field (isAccessLimit)", () => {
    expect(ACCESS_LIMIT_MESSAGE).toBe(LIMIT_RANGE.message);
    for (const limit of [1, 16, 100_000]) expect(isAccessLimit(limit)).toBe(true);
    for (const limit of [0, -1, 100_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(isAccessLimit(limit)).toBe(false);
  });

  it("refuses a null or text limit that slipped past the schema", () => {
    const nullLimit: AccessPatchInput = JSON.parse('{"userLimit": null}');
    const textLimit: AccessPatchInput = JSON.parse('{"branchLimit": "5"}');
    expect(accessPatchProblem(PAID, nullLimit)).toEqual(LIMIT_RANGE);
    expect(accessPatchProblem(PAID, textLimit)).toEqual(LIMIT_RANGE);
  });

  it("refuses limits with 422 when no subscription row holds them, never by creating one", () => {
    expect(accessPatchProblem(TRIAL, { userLimit: 10 })).toEqual(NO_PLAN);
    expect(accessPatchProblem(TRIAL, { branchLimit: 2 })).toEqual(NO_PLAN);
    expect(accessPatchProblem(TRIAL, { modules: offeredModules(FLOORING), ceiling: offeredKeys(FLOORING) })).toBeNull();
  });

  it("checks modules, then the ceiling, then limits, with every 400 before the 422", () => {
    expect(accessPatchProblem(TRIAL, { modules: ["core"], ceiling: [], userLimit: 0 })).toEqual(PLATFORM_LOCKED);
    expect(accessPatchProblem(TRIAL, { ceiling: [], userLimit: 0 })).toEqual(PROTECTED_MISSING);
    expect(accessPatchProblem(TRIAL, { userLimit: 0 })).toEqual(LIMIT_RANGE);
  });

  it("lets a company with both products use either product's modules and keys", () => {
    const facts = { products: BOTH, hasSubscription: true };
    const patch = {
      modules: ["platform", "contracts", "hr"],
      ceiling: [...PROTECTED_CEILING_KEYS, "sales.quote.view", "hr.employee.view"],
    };
    expect(accessPatchProblem(facts, patch)).toBeNull();
  });
});

describe("moduleOverridesFor (platform-admin spec, What a save does: Modules)", () => {
  const plan: PlanModules = ["core", "retail", "hr"];

  it("writes an override only where the request differs from the plan", () => {
    const changes = moduleOverridesFor(FLOORING, plan, [], ["platform", "core", "hr", "wholesale"]);
    expect(changes).toEqual([
      { module: "retail", action: "write", enabled: false },
      { module: "wholesale", action: "write", enabled: true },
    ]);
  });

  it("needs no override when the request matches the plan", () => {
    expect(moduleOverridesFor(FLOORING, plan, [], ["platform", "core", "retail", "hr"])).toEqual([]);
  });

  it("treats a fresh trial's plan as every module", () => {
    expect(moduleOverridesFor(FLOORING, null, [], offeredModules(FLOORING))).toEqual([]);
    expect(moduleOverridesFor(HR, null, [], ["platform", "hr"])).toEqual([
      { module: "meetings", action: "write", enabled: false },
    ]);
  });

  it("writes every requested module for a company with no plan modules", () => {
    expect(moduleOverridesFor(HR, [], [], ["platform", "hr"])).toEqual([
      { module: "hr", action: "write", enabled: true },
    ]);
  });

  it("removes an override once the module is back to what the plan gives (review A3)", () => {
    const stored: ModuleOverride[] = [{ module: "retail", enabled: false }];
    expect(moduleOverridesFor(FLOORING, plan, stored, ["platform", "core", "retail", "hr"])).toEqual([
      { module: "retail", action: "remove" },
    ]);
  });

  it("never lets an old off outlive the plan: off, back to the plan, then the plan adds the module", () => {
    const narrow: PlanModules = ["core"];
    const stale: ModuleOverride[] = [{ module: "retail", enabled: false }];
    const changes = moduleOverridesFor(FLOORING, narrow, stale, ["platform", "core"]);
    expect(changes).toEqual([{ module: "retail", action: "remove" }]);
    const wider: PlanModules = ["core", "retail"];
    expect(enabledModules(FLOORING, wider, applied(stale, changes))).toContain("retail");
  });

  it("writes nothing when the stored override already holds the requested state", () => {
    const stored: ModuleOverride[] = [{ module: "retail", enabled: false }];
    expect(moduleOverridesFor(FLOORING, plan, stored, ["platform", "core", "hr"])).toEqual([]);
  });

  it("flips a stored override that now points the other way", () => {
    const stored: ModuleOverride[] = [{ module: "wholesale", enabled: false }];
    expect(moduleOverridesFor(FLOORING, ["core"], stored, ["platform", "core", "wholesale"])).toEqual([
      { module: "wholesale", action: "write", enabled: true },
    ]);
  });

  it("leaves hidden modules, modules outside the products and platform exactly as stored", () => {
    const stored: ModuleOverride[] = [
      { module: "installation", enabled: false },
      { module: "platform", enabled: false },
    ];
    const changes = moduleOverridesFor(FLOORING, plan, stored, ["platform", "core", "retail", "hr"]);
    expect(changes).toEqual([]);
    const hrStored: ModuleOverride[] = [{ module: "contracts", enabled: true }];
    expect(moduleOverridesFor(HR, ["hr", "meetings"], hrStored, ["platform", "hr", "meetings"])).toEqual([]);
  });

  it("ignores a requested module outside the offered, visible ones", () => {
    expect(moduleOverridesFor(HR, null, [], ["platform", "hr", "meetings", "contracts", "installation"])).toEqual([]);
  });

  it("changes a hidden module once its switch is on", () => {
    const stored: ModuleOverride[] = [{ module: "installation", enabled: false }];
    const changes = moduleOverridesFor(FLOORING, null, stored, offeredModules(FLOORING, ALL_VISIBLE), ALL_VISIBLE);
    expect(changes).toEqual([{ module: "installation", action: "remove" }]);
  });

  it("leaves the company with exactly the requested modules, plus what it hides", () => {
    const stored: ModuleOverride[] = [
      { module: "installation", enabled: true },
      { module: "meetings", enabled: false },
    ];
    for (const requested of [
      ["platform"],
      ["platform", "core", "wholesale"],
      ["platform", "retail", "contracts", "meetings"],
      offeredModules(FLOORING),
    ] as ModuleKey[][]) {
      const expected = [...new Set([...requested, "installation" as const])].sort();
      expect(modulesAfter(FLOORING, plan, stored, requested)).toEqual(expected);
    }
  });

  it("works across both products of a company", () => {
    const changes = moduleOverridesFor(BOTH, ["core", "hr"], [], ["platform", "core", "meetings"]);
    expect(changes).toEqual([
      { module: "hr", action: "write", enabled: false },
      { module: "meetings", action: "write", enabled: true },
    ]);
  });
});

describe("ceilingRowsFor (platform-admin spec, What a save does: Ceiling)", () => {
  const stored = offeredKeys(FLOORING);

  it("writes a row only for a key whose allowed value changes", () => {
    const requested = stored.filter((key) => key !== "retail.sample.view");
    expect(ceilingRowsFor(FLOORING, stored, requested)).toEqual([{ key: "retail.sample.view", allowed: false }]);
    expect(ceilingRowsFor(FLOORING, requested, stored)).toEqual([{ key: "retail.sample.view", allowed: true }]);
    expect(ceilingRowsFor(FLOORING, stored, stored)).toEqual([]);
  });

  it("counts a missing row as not allowed", () => {
    expect(ceilingRowsFor(HR, [], [...PROTECTED_CEILING_KEYS])).toEqual(
      PROTECTED_CEILING_KEYS.map((key) => ({ key, allowed: true })),
    );
    expect(ceilingRowsFor(HR, [], [])).toEqual([]);
  });

  it("keeps the rows of hidden modules, of other products and of retired keys", () => {
    const kept = ["installation.job.view", "sales.quote.view", "sales.payment.create"];
    const hrStored = [...PROTECTED_CEILING_KEYS, ...kept];
    expect(ceilingRowsFor(HR, hrStored, [...PROTECTED_CEILING_KEYS])).toEqual([]);
    const withInstallation = [...stored, "installation.job.view"];
    expect(ceilingRowsFor(FLOORING, withInstallation, stored)).toEqual([]);
  });

  it("changes a hidden module's keys once its switch is on", () => {
    expect(ceilingRowsFor(FLOORING, [...stored, "installation.job.view"], stored, ALL_VISIBLE)).toEqual([
      { key: "installation.job.view", allowed: false },
    ]);
  });

  it("lists the rows in catalog order and ignores duplicates", () => {
    const requested: PermissionKey[] = [
      "settings.audit.view",
      "hr.employee.view",
      "sales.quote.view",
      "sales.quote.view",
    ];
    const rows = ceilingRowsFor(BOTH, [], requested);
    expect(rows.map((row) => row.key)).toEqual(ALL_PERMISSION_KEYS.filter((key) => requested.includes(key)));
  });
});

describe("limitOverrideFor (platform-admin spec, What a save does: Limits; review A2)", () => {
  it("pins nothing when the plan already gives the number", () => {
    expect(limitOverrideFor(16, 16)).toBeNull();
    expect(limitOverrideFor(16, 10)).toBe(10);
    expect(limitOverrideFor(16, 40)).toBe(40);
  });

  it("always overrides a row whose plan has no limit row", () => {
    expect(limitOverrideFor(null, 5)).toBe(5);
  });

  it("makes the requested number the effective limit when written to every row, cancelled ones included", () => {
    const rows = [
      { status: "active", planLimit: 16 },
      { status: "cancelled", planLimit: 50 },
    ];
    const effective = (requested: number) =>
      Math.max(...rows.map((row) => limitOverrideFor(row.planLimit, requested) ?? row.planLimit));
    for (const requested of [1, 10, 16, 30, 50, 80]) expect(effective(requested)).toBe(requested);
    expect(rows.map((row) => limitOverrideFor(row.planLimit, 16))).toEqual([null, 16]);
  });
});

describe("accessDiff (platform-admin spec, Audit)", () => {
  const before: AccessState = {
    modules: ["platform", "core", "retail"],
    ceiling: ["settings.users.view", "sales.quote.view", "retail.sample.view"],
    userLimit: 16,
    branchLimit: 3,
  };

  it("is null when nothing changed, whatever the order or duplicates", () => {
    const same: AccessState = {
      modules: ["retail", "core", "platform", "core"],
      ceiling: ["retail.sample.view", "sales.quote.view", "settings.users.view"],
      userLimit: 16,
      branchLimit: 3,
    };
    expect(accessDiff(before, same)).toBeNull();
  });

  it("lists modules switched on and off in display order and keys sorted", () => {
    const after: AccessState = {
      ...before,
      modules: ["meetings", "platform", "wholesale", "core"],
      ceiling: ["wholesale.price_list.view", "settings.users.view", "customers.customer.view"],
    };
    expect(accessDiff(before, after)).toEqual({
      before: {},
      after: {
        modulesSwitchedOn: ["wholesale", "meetings"],
        modulesSwitchedOff: ["retail"],
        keysAdded: ["customers.customer.view", "wholesale.price_list.view"],
        keysRemoved: ["retail.sample.view", "sales.quote.view"],
      },
    });
  });

  it("holds a limit in before and after only when it changed", () => {
    expect(accessDiff(before, { ...before, userLimit: 10 })).toEqual({
      before: { userLimit: 16 },
      after: { userLimit: 10 },
    });
    expect(accessDiff({ ...before, branchLimit: null }, before)).toEqual({
      before: { branchLimit: null },
      after: { branchLimit: 3 },
    });
  });
});

describe("isPlatformAdminRole (platform-admin spec, Who uses it; review A4)", () => {
  it("accepts only owner and support", () => {
    expect(PLATFORM_ADMIN_ROLES).toEqual(["owner", "support"]);
    expect(isPlatformAdminRole("owner")).toBe(true);
    expect(isPlatformAdminRole("support")).toBe(true);
  });

  it("denies any other stored value", () => {
    for (const role of ["billing", "admin", "", "Owner", "owner ", "support\n"])
      expect(isPlatformAdminRole(role)).toBe(false);
  });
});

describe("inModuleOrder", () => {
  it("gives modules in display order without duplicates, from a list or a set", () => {
    expect(inModuleOrder(["meetings", "platform", "retail", "platform"])).toEqual(["platform", "retail", "meetings"]);
    expect(inModuleOrder(new Set<ModuleKey>(["hr", "core"]))).toEqual(["core", "hr"]);
    expect(inModuleOrder([])).toEqual([]);
  });
});

describe("isModuleKey and isPermissionKey", () => {
  it("accept only names that exist", () => {
    expect(isModuleKey("installation")).toBe(true);
    expect(isModuleKey("billing")).toBe(false);
    expect(isPermissionKey("settings.audit.view")).toBe(true);
    expect(isPermissionKey("settings.audit.edit")).toBe(false);
    expect(isPermissionKey("sales.payment.create")).toBe(false);
  });
});
