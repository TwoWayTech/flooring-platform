import type { PermissionKey } from "@workspace/shared";
import { describe, expect, it } from "vitest";
import type { RequestAccess } from "../src/core/access/access.service";
import { permissionDecision } from "../src/core/access/permission.guard";
import { stripSensitive } from "../src/core/access/sensitive-fields";

function access(keys: PermissionKey[], overrides: Partial<RequestAccess> = {}): RequestAccess {
  return {
    permissions: new Set(keys),
    modules: ["platform", "core"],
    dataScope: "own",
    isOwner: false,
    userId: "u1",
    branchId: null,
    roleNames: ["Sales"],
    disabled: false,
    ...overrides,
  };
}

describe("permissionDecision (P10: deny by default)", () => {
  const route = (permissions: PermissionKey[], extra: { module?: "core" | "hr"; anyMember?: boolean } = {}) => ({
    permissions,
    module: extra.module,
    anyMember: extra.anyMember ?? false,
  });

  it("refuses a route that declares nothing", () => {
    expect(permissionDecision(route([]), access(["sales.quote.view"]))).toBe("permission_undeclared");
  });

  it("allows when any one of the listed keys is held, and refuses when none is", () => {
    const quote = route(["sales.quote.create", "sales.quote.edit"]);
    expect(permissionDecision(quote, access(["sales.quote.edit"]))).toBeNull();
    expect(permissionDecision(quote, access(["sales.quote.view"]))).toBe("forbidden");
  });

  it("refuses a route whose module is off, before looking at permissions", () => {
    expect(permissionDecision(route([], { module: "hr", anyMember: true }), access([]))).toBe("module_not_enabled");
  });

  it("refuses a disabled person even on member routes", () => {
    expect(permissionDecision(route([], { anyMember: true }), access([], { disabled: true }))).toBe("forbidden");
  });
});

describe("stripSensitive (CLAUDE.md rule 5: the server strips sensitive fields)", () => {
  const body = {
    id: "p1",
    name: "Oak plank",
    cost: "2.5000",
    lines: [{ sku: "A", unitCost: "1.0000", margin: "0.30" }],
    supplier: { creditLimit: "5000.00", name: "Northwind Mills" },
    createdAt: new Date("2026-11-13T00:00:00Z"),
  };

  it("removes every sensitive field at any depth for a viewer without the keys", () => {
    expect(stripSensitive(body, new Set())).toEqual({
      id: "p1",
      name: "Oak plank",
      lines: [{ sku: "A" }],
      supplier: { name: "Northwind Mills" },
      createdAt: body.createdAt,
    });
  });

  it("keeps only the fields whose key the viewer holds", () => {
    const stripped = stripSensitive(body, new Set<PermissionKey>(["inventory.product.view_sensitive"])) as typeof body;
    expect(stripped.cost).toBe("2.5000");
    expect(stripped.lines[0]).toEqual({ sku: "A", unitCost: "1.0000" });
    expect(stripped.supplier).toEqual({ name: "Northwind Mills" });
  });

  it("does not change the original response", () => {
    stripSensitive(body, new Set());
    expect(body.cost).toBe("2.5000");
  });
});
