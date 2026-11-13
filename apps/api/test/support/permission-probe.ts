import { Body, Controller, Get, Module, Post } from "@nestjs/common";
import { branches } from "@workspace/db/company";
import { RequireModule, RequirePermission, AnyCompanyMember } from "../../src/core/access/permission.decorators";
import { CurrentAccess } from "../../src/core/access/permission.guard";
import type { RequestAccess } from "../../src/core/access/access.service";
import { TenantConnectionService } from "../../src/core/tenancy/tenant-connection.service";
import { CurrentTenant, type TenantContext } from "../../src/core/tenancy/tenant-context";

/**
 * A test-only controller with one route per guard outcome (P10): a permission any one of several
 * keys allows, a write the audit interceptor records, a module that may be off, a member-only
 * route, and a route that declares nothing. Its responses carry sensitive fields, so the tests can
 * see them stripped. It is mounted only by the tests.
 */
@Controller("permission-probe")
class PermissionProbeController {
  constructor(private readonly tenancy: TenantConnectionService) {}

  @Get("products")
  @RequirePermission("inventory.product.view")
  products() {
    return [
      { id: "p1", name: "Oak plank", cost: "2.5000", supplier: { name: "Northwind Mills", creditLimit: "5000.00" } },
    ];
  }

  @Post("branches")
  @RequirePermission("inventory.product.create")
  async createBranch(@CurrentTenant() tenant: TenantContext, @Body() body: { name?: string }) {
    const [row] = await (
      await this.tenancy.db(tenant)
    )
      .insert(branches)
      .values({ name: body.name ?? "New branch", city: "Austin", state: "TX" })
      .returning();
    return row;
  }

  @Get("contracts")
  @RequireModule("contracts")
  @RequirePermission("contracts.contract.view")
  contracts() {
    return [];
  }

  @Get("me")
  @AnyCompanyMember()
  me(@CurrentAccess() access: RequestAccess) {
    return { permissions: [...access.permissions].sort(), dataScope: access.dataScope, isOwner: access.isOwner };
  }

  @Get("undeclared")
  undeclared() {
    return { leaked: true };
  }
}

/** Mounts the permission probe; pass it to AuthHarness.start. */
@Module({ controllers: [PermissionProbeController] })
export class PermissionProbeModule {}
