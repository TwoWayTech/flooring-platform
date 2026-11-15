import { describe, expect, it } from "vitest";
import type { ModuleKey } from "../src/products";
import { ACCESS_LIMIT_MESSAGE, visibleModuleKeys } from "../src/platform/access-patch";
import { ADMIN_REASON_MESSAGE } from "../src/platform/admin-reason";
import { platformAuditDetails } from "../src/platform/audit-details";
import {
  newPlanValues,
  PLAN_MESSAGES,
  planAuditBody,
  planChanges,
  planModulesAfter,
  planPatchProblem,
  planProblem,
  storedPlanPrice,
  type PlanState,
} from "../src/platform/plans";
import type { PlatformPlanInput } from "../src/types/platform";

/** The visible modules while Installation's switch is off (rule 18), as today. */
const VISIBLE: ModuleKey[] = ["platform", "core", "retail", "wholesale", "contracts", "hr", "meetings"];
const REASON = "Starter plan for small stores";

const input = (overrides: Record<string, unknown> = {}) => ({
  key: "e2e-starter",
  name: "Starter",
  product: "flooring",
  monthlyPrice: "49.00",
  yearlyPrice: "490.00",
  modules: ["core", "retail"],
  maxUsers: 5,
  maxBranches: 1,
  reason: REASON,
  ...overrides,
});

const problem = (overrides: Record<string, unknown>) => planProblem(input(overrides), VISIBLE);
const refused = (message: string) => ({ status: 400, message });

/** Flooring Pro as seeded: prices zero, a hidden Installation row stored, 16 users and 3 branches. */
const FLOORING_PRO: PlanState = {
  name: "Flooring Pro",
  product: "flooring",
  monthlyPrice: "0.00",
  yearlyPrice: "0.00",
  modules: ["core", "retail", "wholesale", "installation", "contracts", "hr", "meetings"],
  maxUsers: 16,
  maxBranches: 3,
};
const PRO_VISIBLE: ModuleKey[] = ["core", "retail", "wholesale", "contracts", "hr", "meetings"];

describe("planProblem: keys (spec part 2, The plan rules; PL-1)", () => {
  it("accepts 2 to 40 lowercase letters, digits and dashes starting with a letter", () => {
    for (const key of ["flooring-pro", "a1", `a${"b".repeat(39)}`, "hr-standard-2"]) {
      expect(problem({ key }), key).toBeNull();
    }
  });

  it("refuses anything else exactly as sent, never trimmed", () => {
    for (const key of [
      "A",
      "1abc",
      "-x",
      "x",
      `a${"b".repeat(40)}`,
      "flooring_pro",
      " flooring-pro",
      "pro\n",
      7,
      null,
    ]) {
      expect(problem({ key }), String(key)).toEqual(refused(PLAN_MESSAGES.key));
    }
  });
});

describe("planProblem: names and products (PL-2, PL-3)", () => {
  it("needs a name of 1 to 80 characters after trimming", () => {
    expect(problem({ name: "   " })).toEqual(refused(PLAN_MESSAGES.name));
    expect(problem({ name: "n".repeat(81) })).toEqual(refused(PLAN_MESSAGES.name));
    expect(problem({ name: 12 })).toEqual(refused(PLAN_MESSAGES.name));
    expect(problem({ name: "n".repeat(80) })).toBeNull();
    expect(problem({ name: `  ${"n".repeat(80)}  ` })).toBeNull();
    expect(PLAN_MESSAGES.name).toBe("Enter a name of 1 to 80 characters.");
  });

  it("takes flooring or hr only", () => {
    expect(problem({ product: "hr", modules: ["hr"] })).toBeNull();
    for (const product of ["both", "Flooring", "", "toString", 1, null]) {
      expect(problem({ product }), String(product)).toEqual(refused(PLAN_MESSAGES.product));
    }
  });
});

describe("planProblem: prices (PL-4)", () => {
  it("accepts digits with up to two decimals, trimmed, inside numeric(14,2)", () => {
    for (const price of ["0", "0.00", "49", "49.5", "99999999999.99", " 49.00 "]) {
      expect(problem({ monthlyPrice: price, yearlyPrice: price }), price).toBeNull();
    }
  });

  it("refuses a sign, too many decimals, an exponent, a comma, a leading dot, a number or nothing", () => {
    for (const price of ["-1", "1.234", "1e3", "", "49,00", ".5", "999999999999", 49, null, undefined]) {
      expect(problem({ monthlyPrice: price }), String(price)).toEqual(refused(PLAN_MESSAGES.monthlyPrice));
      expect(problem({ yearlyPrice: price }), String(price)).toEqual(refused(PLAN_MESSAGES.yearlyPrice));
    }
  });

  it("stores and audits a price with two decimals by decimal.js", () => {
    expect(storedPlanPrice("49")).toBe("49.00");
    expect(storedPlanPrice(" 49.5 ")).toBe("49.50");
    expect(storedPlanPrice("99999999999.99")).toBe("99999999999.99");
    expect(storedPlanPrice("0")).toBe("0.00");
  });
});

describe("planProblem: modules (PL-5)", () => {
  it("accepts Platform and drops it, collapses duplicates and stores the catalog order", () => {
    const sent = input({ modules: ["platform", "retail", "core", "core"] });
    expect(planProblem(sent, VISIBLE)).toBeNull();
    expect(newPlanValues(sent as PlatformPlanInput, VISIBLE).modules).toEqual(["core", "retail"]);
  });

  it("needs a module besides Platform", () => {
    expect(problem({ modules: [] })).toEqual(refused(PLAN_MESSAGES.modulesEmpty));
    expect(problem({ modules: ["platform"] })).toEqual(refused(PLAN_MESSAGES.modulesEmpty));
  });

  it("refuses another product's module, a hidden one and an unknown key, with their messages", () => {
    expect(planProblem(input({ product: "hr", modules: ["hr", "retail"] }), VISIBLE)).toEqual(
      refused("The Retail module isn't offered with HR Suite."),
    );
    expect(problem({ modules: ["core", "installation"] })).toEqual(
      refused("The Installation module isn't offered with Flooring Suite."),
    );
    expect(problem({ modules: ["bogus"] })).toEqual(refused("bogus is not a module."));
  });

  it("refuses modules that are not a list of strings", () => {
    const withHole: unknown[] = [];
    withHole[1] = "core";
    for (const modules of ["core", [1], null, { 0: "core" }, withHole]) {
      expect(problem({ modules }), JSON.stringify(modules)).toEqual(refused(PLAN_MESSAGES.modules));
    }
  });

  it("follows the Installation switch by default", () => {
    expect(planProblem(input({ modules: ["installation"] }))).toEqual(
      refused("The Installation module isn't offered with Flooring Suite."),
    );
    expect(visibleModuleKeys()).not.toContain("installation");
    expect(planProblem(input({ modules: ["installation"] }), [...VISIBLE, "installation"])).toBeNull();
  });
});

describe("planProblem: limits, the reason and the order (PL-6)", () => {
  it("takes whole numbers from 1 to 100,000 for both limits", () => {
    expect(problem({ maxUsers: 1, maxBranches: 100_000 })).toBeNull();
    for (const limit of [0, 100_001, 1.5, "5", null, Number.NaN]) {
      expect(problem({ maxUsers: limit }), String(limit)).toEqual(refused(ACCESS_LIMIT_MESSAGE));
      expect(problem({ maxBranches: limit }), String(limit)).toEqual(refused(ACCESS_LIMIT_MESSAGE));
    }
  });

  it("needs a reason of 10 to 500 characters", () => {
    expect(problem({ reason: "too short" })).toEqual(refused(ADMIN_REASON_MESSAGE));
    expect(problem({ reason: undefined })).toEqual(refused(ADMIN_REASON_MESSAGE));
  });

  it("checks key, name, product, prices, modules, limits, then the reason", () => {
    const bad = {
      key: "X",
      name: "",
      product: "both",
      monthlyPrice: "x",
      yearlyPrice: "x",
      modules: [],
      maxUsers: 0,
      maxBranches: 0,
      reason: "",
    };
    const order = [
      ["key", PLAN_MESSAGES.key],
      ["name", PLAN_MESSAGES.name],
      ["product", PLAN_MESSAGES.product],
      ["monthlyPrice", PLAN_MESSAGES.monthlyPrice],
      ["yearlyPrice", PLAN_MESSAGES.yearlyPrice],
      ["modules", PLAN_MESSAGES.modulesEmpty],
      ["maxUsers", ACCESS_LIMIT_MESSAGE],
      ["maxBranches", ACCESS_LIMIT_MESSAGE],
      ["reason", ADMIN_REASON_MESSAGE],
    ] as const;
    let sent: Record<string, unknown> = { ...bad };
    for (const [field, message] of order) {
      expect(planProblem(sent, VISIBLE), field).toEqual(refused(message));
      sent = { ...sent, [field]: input()[field] };
    }
    expect(planProblem(sent, VISIBLE)).toBeNull();
  });

  it("gives the values to store: name and prices trimmed, prices with two decimals", () => {
    const sent = input({ name: "  Starter  ", monthlyPrice: " 49 ", yearlyPrice: "490.5" }) as PlatformPlanInput;
    expect(newPlanValues(sent, VISIBLE)).toEqual({
      key: "e2e-starter",
      name: "Starter",
      product: "flooring",
      monthlyPrice: "49.00",
      yearlyPrice: "490.50",
      modules: ["core", "retail"],
      maxUsers: 5,
      maxBranches: 1,
    });
  });
});

describe("planPatchProblem and planChanges (PL-7)", () => {
  const patchProblem = (patch: Record<string, unknown>, inUse = false) =>
    planPatchProblem(FLOORING_PRO, { reason: REASON, ...patch }, inUse, VISIBLE);

  it("refuses the key, the product or any unknown field", () => {
    for (const patch of [{ key: "pro-2" }, { product: "hr" }, { color: "red" }, { active: false }]) {
      expect(patchProblem(patch), JSON.stringify(patch)).toEqual(refused(PLAN_MESSAGES.patchFields));
    }
  });

  it("checks each field sent by its rule, then the reason", () => {
    expect(patchProblem({ name: "" })).toEqual(refused(PLAN_MESSAGES.name));
    expect(patchProblem({ monthlyPrice: "1e3" })).toEqual(refused(PLAN_MESSAGES.monthlyPrice));
    expect(patchProblem({ yearlyPrice: -1 })).toEqual(refused(PLAN_MESSAGES.yearlyPrice));
    expect(patchProblem({ modules: ["core", "hr"] })).toBeNull();
    expect(patchProblem({ modules: [] })).toEqual(refused(PLAN_MESSAGES.modulesEmpty));
    expect(patchProblem({ maxUsers: 0 })).toEqual(refused(ACCESS_LIMIT_MESSAGE));
    expect(patchProblem({ reason: "short" })).toEqual(refused(ADMIN_REASON_MESSAGE));
    expect(planPatchProblem(FLOORING_PRO, {}, false, VISIBLE)).toEqual(refused(ADMIN_REASON_MESSAGE));
    expect(patchProblem({})).toBeNull();
  });

  it("finds nothing to change in a patch that says what is stored", () => {
    expect(planChanges(FLOORING_PRO, { reason: REASON }, VISIBLE)).toBeNull();
    expect(
      planChanges(
        FLOORING_PRO,
        {
          name: "  Flooring Pro ",
          monthlyPrice: "0",
          yearlyPrice: "0.0",
          modules: [...PRO_VISIBLE].reverse(),
          maxUsers: 16,
          maxBranches: 3,
          reason: REASON,
        },
        VISIBLE,
      ),
    ).toBeNull();
    const priced = { ...FLOORING_PRO, monthlyPrice: "49.00" };
    expect(planChanges(priced, { monthlyPrice: "49", reason: REASON }, VISIBLE)).toBeNull();
  });
});

describe("a plan in use (PL-8)", () => {
  const inUse = (patch: Record<string, unknown>, plan: PlanState = FLOORING_PRO) =>
    planPatchProblem(plan, { reason: REASON, ...patch }, true, VISIBLE);
  const IN_USE = { status: 422, message: PLAN_MESSAGES.inUse };

  it("keeps its modules and limits", () => {
    expect(inUse({ modules: ["core"] })).toEqual(IN_USE);
    expect(inUse({ maxUsers: 17 })).toEqual(IN_USE);
    expect(inUse({ maxBranches: 4 })).toEqual(IN_USE);
    expect(inUse({ maxUsers: 5 }, { ...FLOORING_PRO, maxUsers: null })).toEqual(IN_USE);
  });

  it("allows the same modules in another order, with Platform, without the hidden one, and the same limits", () => {
    expect(inUse({ modules: ["platform", ...[...PRO_VISIBLE].reverse()] })).toBeNull();
    expect(inUse({ maxUsers: 16, maxBranches: 3 })).toBeNull();
  });

  it("allows a new name and new prices", () => {
    expect(inUse({ name: "Flooring Pro Plus", monthlyPrice: "49.00", yearlyPrice: "490.00" })).toBeNull();
  });

  it("allows everything on a plan no company uses", () => {
    expect(
      planPatchProblem(
        FLOORING_PRO,
        { modules: ["core"], maxUsers: 2, maxBranches: 1, reason: REASON },
        false,
        VISIBLE,
      ),
    ).toBeNull();
  });

  it("keeps a stored hidden module whatever the change asks", () => {
    expect(planModulesAfter("flooring", FLOORING_PRO.modules, ["retail", "core"], VISIBLE)).toEqual([
      "core",
      "retail",
      "installation",
    ]);
    expect(planModulesAfter("flooring", FLOORING_PRO.modules, ["core", "installation"], VISIBLE)).toEqual([
      "core",
      "installation",
    ]);
    expect(planModulesAfter("hr", ["hr", "retail"], ["meetings"], VISIBLE)).toEqual(["retail", "meetings"]);
  });
});

describe("plan audit bodies (spec Audit (part 2); PL-9)", () => {
  it("records only the changed fields and the trimmed reason, as the allow-list reads them", () => {
    const changes = planChanges(
      FLOORING_PRO,
      { name: "Flooring Pro Plus", monthlyPrice: "49", yearlyPrice: "0.00", maxUsers: 16, reason: REASON },
      VISIBLE,
    );
    expect(changes).toEqual({
      before: { name: "Flooring Pro", monthlyPrice: "0.00" },
      after: { name: "Flooring Pro Plus", monthlyPrice: "49.00" },
    });
    const body = planAuditBody({ action: "plan.changed", changes: changes!, reason: "  Renamed for the catalog  " });
    expect(body).toEqual({
      before: { name: "Flooring Pro", monthlyPrice: "0.00" },
      after: { name: "Flooring Pro Plus", monthlyPrice: "49.00", reason: "Renamed for the catalog" },
    });
    expect(platformAuditDetails("plan.changed", body.before, body.after)).toEqual({
      kind: "plan_changed",
      changes: [
        { field: "name", from: "Flooring Pro", to: "Flooring Pro Plus" },
        { field: "monthlyPrice", from: "0.00", to: "49.00" },
      ],
      reason: "Renamed for the catalog",
    });
  });

  it("records module and limit changes with the stored hidden module kept", () => {
    const plan = { ...FLOORING_PRO, maxBranches: null };
    const changes = planChanges(plan, { modules: ["core"], maxBranches: 2, reason: REASON }, VISIBLE);
    expect(changes).toEqual({
      before: { modules: FLOORING_PRO.modules, maxBranches: null },
      after: { modules: ["core", "installation"], maxBranches: 2 },
    });
    const body = planAuditBody({ action: "plan.changed", changes: changes!, reason: REASON });
    expect(platformAuditDetails("plan.changed", body.before, body.after)).toMatchObject({
      kind: "plan_changed",
      changes: [
        { field: "modules", from: FLOORING_PRO.modules, to: ["core", "installation"] },
        { field: "maxBranches", from: null, to: 2 },
      ],
    });
  });

  it("records a created plan and a retire or restore", () => {
    const plan = newPlanValues(input() as PlatformPlanInput, VISIBLE);
    const created = planAuditBody({ action: "plan.created", plan, reason: ` ${REASON} ` });
    expect(created).toEqual({ before: null, after: { ...plan, reason: REASON } });
    expect(platformAuditDetails("plan.created", created.before, created.after)).toEqual({
      kind: "plan_created",
      ...plan,
      reason: REASON,
    });
    expect(planAuditBody({ action: "plan.retired", reason: REASON })).toEqual({
      before: { active: true },
      after: { active: false, reason: REASON },
    });
    expect(planAuditBody({ action: "plan.restored", reason: REASON })).toEqual({
      before: { active: false },
      after: { active: true, reason: REASON },
    });
  });

  it("words the plan messages as the spec does", () => {
    expect(PLAN_MESSAGES.keyTaken).toBe(
      "A plan with this key already exists. A key can't be reused, even after its plan is retired.",
    );
    expect(PLAN_MESSAGES.notFound).toBe("That plan does not exist.");
    expect(PLAN_MESSAGES.alreadyRetired).toBe("This plan is already retired.");
    expect(PLAN_MESSAGES.notRetired).toBe("This plan isn't retired.");
    expect(PLAN_MESSAGES.inUseEffect).toContain("doesn't change what any company on this plan pays");
  });
});
