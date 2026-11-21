import type { PermissionKey } from "@workspace/shared";
import { describe, expect, it } from "vitest";
import type { RequestAccess } from "../src/core/access/access.service";
import { Controller, Get, Post, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AnyCompanyMember, permissionRequirement, RequirePermission } from "../src/core/access/permission.decorators";
import { permissionDecision } from "../src/core/access/permission.guard";
import { stripSensitive } from "../src/core/access/sensitive-fields";

function access(keys: PermissionKey[], overrides: Partial<RequestAccess> = {}): RequestAccess {
  return {
    permissions: new Set(keys),
    modules: ["platform", "core"],
    ceiling: keys,
    dataScope: "own",
    isOwner: false,
    userId: "u1",
    branchId: null,
    roleNames: ["Sales"],
    disabled: false,
    mfaRequired: false,
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
      createdAt: "2026-11-13T00:00:00.000Z",
    });
  });

  it("uses a route's own keys for a field it names, and the shared map for the rest (PR #13 review)", () => {
    const own = { creditLimit: ["inventory.product.view_sensitive", "purchasing.bill.view"] as PermissionKey[] };
    const withBills = stripSensitive(body, new Set<PermissionKey>(["purchasing.bill.view"]), own) as typeof body;
    expect(withBills.supplier.creditLimit).toBe("5000.00");
    expect(withBills).not.toHaveProperty("cost");
    const customerKey = new Set<PermissionKey>(["customers.customer.view_sensitive"]);
    expect(stripSensitive(body, customerKey, own)).not.toHaveProperty("supplier.creditLimit");
  });

  it("keeps only the fields whose key the viewer holds", () => {
    const stripped = stripSensitive(body, new Set<PermissionKey>(["inventory.product.view_sensitive"])) as typeof body;
    expect(stripped.cost).toBe("2.5000");
    expect(stripped.lines[0]).toEqual({ sku: "A", unitCost: "1.0000" });
    expect(stripped.supplier).toEqual({ name: "Northwind Mills" });
  });

  it("strips fields from class instances and toJSON output exactly as they would be sent", () => {
    class ProductDto {
      constructor(
        readonly name: string,
        readonly cost: string,
      ) {}
    }
    const decimal = { toJSON: () => ({ unit_cost: "3.0000", qty: "2.000" }) };
    expect(stripSensitive([new ProductDto("Tile", "9.0000"), decimal], new Set())).toEqual([
      { name: "Tile" },
      { qty: "2.000" },
    ]);
  });

  it("keeps fields named like Object.prototype members, with and without a route's own keys (finding F-l)", () => {
    const named = { name: "Oak plank", constructor: "c", toString: "t", to_string: "s", valueOf: "v", cost: "2.5000" };
    const kept = { name: "Oak plank", constructor: "c", toString: "t", to_string: "s", valueOf: "v" };
    expect(stripSensitive(named, new Set())).toEqual(kept);
    const own = { creditLimit: ["purchasing.bill.view"] as PermissionKey[] };
    expect(stripSensitive(named, new Set(), own)).toEqual(kept);
  });

  it("strips a sales document's costs without margin sight, even with product cost (click-through #68)", () => {
    const invoice = { id: "i1", total: "450.00", cost: "210.00", lines: [{ unitPrice: "4.50", unitCost: "2.1000" }] };
    const costOnly = new Set<PermissionKey>(["inventory.product.view_sensitive"]);
    const both = new Set<PermissionKey>(["inventory.product.view_sensitive", "sales.margin.view_sensitive"]);
    expect(stripSensitive(invoice, costOnly)).toEqual(invoice);
    expect(stripSensitive(invoice, costOnly, undefined, true)).toEqual({
      id: "i1",
      total: "450.00",
      lines: [{ unitPrice: "4.50" }],
    });
    expect(stripSensitive(invoice, both, undefined, true)).toEqual(invoice);
  });

  it("does not change the original response", () => {
    stripSensitive(body, new Set());
    expect(body.cost).toBe("2.5000");
  });
});

describe("permissionRequirement (PR #7 review: class decorators never open writes)", () => {
  @Controller("x")
  @AnyCompanyMember()
  @RequirePermission("inventory.product.view")
  class Probe {
    @Get()
    read() {
      return [];
    }

    @Post()
    write() {
      return {};
    }

    @Post("member")
    @AnyCompanyMember()
    memberWrite() {
      return {};
    }
  }

  const context = (handler: keyof Probe) =>
    ({ getHandler: () => Probe.prototype[handler], getClass: () => Probe }) as unknown as ExecutionContext;
  const reflector = new Reflector();

  it("lets class permissions guard reads", () => {
    expect(permissionRequirement(reflector, context("read"), "GET").permissions).toEqual(["inventory.product.view"]);
  });

  it("treats a write without handler permissions as undeclared, despite the class decorators", () => {
    const requirement = permissionRequirement(reflector, context("write"), "POST");
    expect(requirement).toMatchObject({ permissions: [], anyMember: false });
    expect(permissionDecision(requirement, access(["inventory.product.view"]))).toBe("permission_undeclared");
  });

  it("counts AnyCompanyMember only on the handler", () => {
    expect(permissionRequirement(reflector, context("read"), "GET").anyMember).toBe(false);
    expect(permissionRequirement(reflector, context("memberWrite"), "POST").anyMember).toBe(true);
  });
});
