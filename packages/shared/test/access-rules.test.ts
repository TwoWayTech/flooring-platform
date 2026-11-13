import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_KEYS } from "../src/permissions/catalog";
import { enabledModules, scopeAllows, SENSITIVE_FIELDS, separateDuties } from "../src/permissions/access-rules";

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
