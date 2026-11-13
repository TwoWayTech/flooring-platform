import { Body, Controller, Delete, Get, Module, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import { branches } from "@workspace/db/company";
import { eq } from "drizzle-orm";
import { AnyCompanyMember } from "../../src/core/access/permission.decorators";
import { TenantConnectionService } from "../../src/core/tenancy/tenant-connection.service";
import { CurrentTenant, type TenantContext } from "../../src/core/tenancy/tenant-context";

/** The fields the probe writes; anything else a client sends, such as a company id, is ignored. */
interface BranchInput {
  name?: string;
  city?: string;
  state?: string;
}

/**
 * A test-only controller with every endpoint pattern a module will have: list, get by id, create,
 * update and delete. It reaches company data the only allowed way, through
 * TenantConnectionService with the request's TenantContext. The isolation tests use it to prove
 * that a person signed in to company A can never read or change company B's rows (blueprint P9).
 * It is mounted only by the tests. It lets any member in, because it tests tenancy; the permission
 * probe tests permissions.
 */
@Controller("isolation-probe/branches")
class IsolationProbeController {
  constructor(private readonly tenancy: TenantConnectionService) {}

  @Get()
  @AnyCompanyMember()
  async list(@CurrentTenant() tenant: TenantContext) {
    return (await this.tenancy.db(tenant)).select().from(branches);
  }

  @Get(":id")
  @AnyCompanyMember()
  async get(@CurrentTenant() tenant: TenantContext, @Param("id") id: string) {
    const [row] = await (await this.tenancy.db(tenant)).select().from(branches).where(eq(branches.id, id));
    if (!row) throw new NotFoundException();
    return row;
  }

  @Post()
  @AnyCompanyMember()
  async create(@CurrentTenant() tenant: TenantContext, @Body() body: BranchInput) {
    const [row] = await (
      await this.tenancy.db(tenant)
    )
      .insert(branches)
      .values({ name: body.name ?? "New", city: body.city ?? "Austin", state: body.state ?? "TX" })
      .returning();
    return row;
  }

  @Patch(":id")
  @AnyCompanyMember()
  async update(@CurrentTenant() tenant: TenantContext, @Param("id") id: string, @Body() body: BranchInput) {
    const [row] = await (
      await this.tenancy.db(tenant)
    )
      .update(branches)
      .set({ name: body.name })
      .where(eq(branches.id, id))
      .returning();
    if (!row) throw new NotFoundException();
    return row;
  }

  @Delete(":id")
  @AnyCompanyMember()
  async remove(@CurrentTenant() tenant: TenantContext, @Param("id") id: string) {
    const [row] = await (await this.tenancy.db(tenant)).delete(branches).where(eq(branches.id, id)).returning();
    if (!row) throw new NotFoundException();
    return row;
  }
}

/** Mounts the probe; pass it to AuthHarness.start. */
@Module({ controllers: [IsolationProbeController] })
export class IsolationProbeModule {}
