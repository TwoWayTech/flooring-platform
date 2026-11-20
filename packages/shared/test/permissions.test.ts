import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  PRODUCT_MODULES,
  branchPlacementDenial,
  canAssignRole,
  canGrant,
  canManageHolder,
  dataScope,
  effectivePermissions,
  escalations,
  hasActiveOwner,
  permissionDef,
  permissionsForModules,
  resolveAccess,
  roleTemplate,
  scopeWidens,
  SENSITIVE,
  type ModuleKey,
  type PermissionKey,
  type RoleLike,
} from "../src";

const asRole = (key: Parameters<typeof roleTemplate>[0], id = key): RoleLike => ({ id, ...roleTemplate(key) });
const FLOORING: ModuleKey[] = ["platform", "core", "retail", "installation", "hr", "meetings"];
const FULL_CEILING = ALL_PERMISSION_KEYS;

describe("permission catalog", () => {
  it("writes every key as module.resource.action and keeps keys unique", () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
    for (const key of ALL_PERMISSION_KEYS) expect(key.split(".")).toHaveLength(3);
  });

  it("gives the HR product no flooring permissions", () => {
    const hrKeys = permissionsForModules(PRODUCT_MODULES.hr);
    expect(hrKeys.some((k) => k.startsWith("inventory.") || k.startsWith("sales."))).toBe(false);
    expect(hrKeys).toContain("hr.employee.view");
  });
});

describe("effectivePermissions", () => {
  it("is the union of roles capped by ceiling and modules", () => {
    const eff = effectivePermissions([asRole("sales"), asRole("warehouse")], FULL_CEILING, FLOORING);
    expect(eff.has("sales.quote.create")).toBe(true);
    expect(eff.has("inventory.roll.cut")).toBe(true);
    expect(eff.has(SENSITIVE.margin)).toBe(false);
  });

  it("drops permissions outside the ceiling at once", () => {
    const ceiling = FULL_CEILING.filter((k) => k !== "reports.sales.export");
    const eff = effectivePermissions([asRole("owner")], ceiling, FLOORING);
    expect(eff.has("reports.sales.export")).toBe(false);
    expect(eff.has("reports.sales.view")).toBe(true);
  });

  it("drops permissions of disabled modules", () => {
    const eff = effectivePermissions([asRole("owner")], FULL_CEILING, [
      "platform",
      "core",
      "wholesale",
      "hr",
      "meetings",
    ]);
    expect(eff.has("installation.job.view")).toBe(false);
    expect(eff.has("retail.room.measure")).toBe(false);
    expect(eff.has("wholesale.credit.approve")).toBe(true);
  });

  it("hides cost and margin from Sales", () => {
    const sales = resolveAccess([asRole("sales")], FULL_CEILING, FLOORING);
    expect(sales.permissions.has(SENSITIVE.productCost)).toBe(false);
    expect(sales.permissions.has(SENSITIVE.margin)).toBe(false);
  });
});

describe("dataScope", () => {
  it("takes the widest scope across roles", () => {
    expect(dataScope([asRole("sales")])).toBe("own");
    expect(dataScope([asRole("sales"), asRole("warehouse")])).toBe("branch");
    expect(dataScope([asRole("sales"), asRole("accountant")])).toBe("all");
  });
});

describe("no privilege escalation", () => {
  const manager = resolveAccess([asRole("manager")], FULL_CEILING, FLOORING);

  it("blocks granting a permission the granter does not hold", () => {
    expect(canGrant(manager, "sales.quote.create")).toBe(true);
    expect(canGrant(manager, "settings.roles.manage")).toBe(false);
    const proposed: PermissionKey[] = ["sales.quote.view", "settings.roles.manage"];
    expect(escalations(manager, proposed, ["sales.quote.view"])).toEqual(["settings.roles.manage"]);
  });

  it("allows assigning only roles inside the granter's own access", () => {
    expect(canAssignRole(manager, asRole("sales"), FULL_CEILING, FLOORING)).toBeNull();
    expect(canAssignRole(manager, asRole("accountant"), FULL_CEILING, FLOORING)).toBe("not_held");
  });

  it("lets only an Owner make someone an Owner", () => {
    const owner = resolveAccess([asRole("owner")], FULL_CEILING, FLOORING);
    expect(canAssignRole(manager, asRole("owner"), FULL_CEILING, FLOORING)).toBe("owner_only");
    expect(canAssignRole(owner, asRole("owner"), FULL_CEILING, FLOORING)).toBeNull();
  });
});

describe("last owner rule", () => {
  it("requires at least one active owner", () => {
    const owners = new Set(["r-owner"]);
    const users = [
      { id: "a", status: "active" as const, roleIds: ["r-owner"] },
      { id: "b", status: "active" as const, roleIds: ["r-sales"] },
    ];
    expect(hasActiveOwner(users, owners)).toBe(true);
    expect(
      hasActiveOwner(
        users.map((u) => (u.id === "a" ? { ...u, status: "disabled" as const } : u)),
        owners,
      ),
    ).toBe(false);
  });
});

describe("default roles", () => {
  it("only reference catalog keys", () => {
    for (const key of [
      "owner",
      "manager",
      "accountant",
      "sales",
      "warehouse",
      "installer",
      "hr",
      "employee",
    ] as const) {
      for (const p of roleTemplate(key).permissions) expect(permissionDef(p), `${key}: ${p}`).toBeDefined();
    }
  });
});

describe("data scope and managing holders (PR #11 security review)", () => {
  const branchAdmin = resolveAccess(
    [{ id: "b", owner: false, dataScope: "branch", permissions: ["settings.roles.manage", "sales.quote.view"] }],
    FULL_CEILING,
    FLOORING,
  );

  it("never lets a non-Owner widen a role's data scope past their own", () => {
    expect(scopeWidens(branchAdmin, "all", "branch")).toBe(true);
    expect(scopeWidens(branchAdmin, "all", "all")).toBe(false);
    expect(scopeWidens(branchAdmin, "own", "all")).toBe(false);
    const wide: RoleLike = { id: "w", owner: false, dataScope: "all", permissions: ["sales.quote.view"] };
    expect(canAssignRole(branchAdmin, wide, FULL_CEILING, FLOORING)).toBe("scope_wider");
    const owner = resolveAccess([asRole("owner")], FULL_CEILING, FLOORING);
    expect(scopeWidens(owner, "all", "own")).toBe(false);
  });

  it("lets a person change someone only when they could give every role that person holds", () => {
    const manager = resolveAccess([asRole("manager")], FULL_CEILING, FLOORING);
    expect(canManageHolder(manager, [asRole("sales")], FULL_CEILING, FLOORING)).toBeNull();
    expect(canManageHolder(manager, [asRole("owner")], FULL_CEILING, FLOORING)).toBe("owner_only");
    expect(canManageHolder(manager, [asRole("accountant")], FULL_CEILING, FLOORING)).not.toBeNull();
  });
});

describe("branch placement (D18 server half, ADR 0051 2026-11-20)", () => {
  const north = "0190a000-0000-7000-8000-000000000001";
  const south = "0190a000-0000-7000-8000-000000000002";

  it("lets an all-scope admin place anyone in any branch or none", () => {
    const admin = { dataScope: "all" as const, branchId: null };
    expect(branchPlacementDenial(admin, south)).toBeNull();
    expect(branchPlacementDenial(admin, null, north)).toBeNull();
  });

  it("keeps a branch admin's invitations to their own branch", () => {
    const admin = { dataScope: "branch" as const, branchId: north };
    expect(branchPlacementDenial(admin, north)).toBeNull();
    expect(branchPlacementDenial(admin, south)).toBe("branch_other");
    expect(branchPlacementDenial(admin, null)).toBe("branch_other");
  });

  it("moves only people from and to the branch admin's own branch", () => {
    const admin = { dataScope: "branch" as const, branchId: north };
    expect(branchPlacementDenial(admin, north, north)).toBeNull();
    expect(branchPlacementDenial(admin, north, south)).toBe("branch_other");
    expect(branchPlacementDenial(admin, north, null)).toBe("branch_other");
    expect(branchPlacementDenial(admin, south, north)).toBe("branch_other");
  });

  it("lets a narrower admin without a branch place nobody, own scope included", () => {
    expect(branchPlacementDenial({ dataScope: "branch", branchId: null }, null)).toBe("branch_other");
    expect(branchPlacementDenial({ dataScope: "own", branchId: north }, north)).toBeNull();
    expect(branchPlacementDenial({ dataScope: "own", branchId: north }, south)).toBe("branch_other");
  });
});
