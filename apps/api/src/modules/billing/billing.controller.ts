import { Controller, Get, Header } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { CompanyBilling } from "@workspace/shared";
import type { RequestAccess } from "../../core/access/access.service";
import { AnyCompanyMember } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { BillingService } from "./billing.service";

/**
 * The Owner's read-only billing page (docs/specs/platform-admin.md, part 4; ADR 0054). An ordinary
 * company route: SessionGuard, TenantGuard and PermissionGuard run unchanged, so a locked company
 * or one in maintenance never reaches it, and a read-only one may read. The handler lets any active
 * member past PermissionGuard; BillingService then checks the switch and the Owner.
 */
@ApiTags("billing")
@ApiCookieAuth()
@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** GET /billing: the plan, its period and standing, the limits and the Owner's notice, never cached. */
  @Get()
  @AnyCompanyMember()
  @Header("Cache-Control", "no-store")
  read(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess): Promise<CompanyBilling> {
    return this.billing.of(tenant, access);
  }
}
