import { Controller, Get, Header } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { CompanyAnswer } from "@workspace/shared";
import type { RequestAccess } from "../../core/access/access.service";
import { AnyCompanyMember } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { CompanyService } from "./company.service";

/** The shell's company (ADR 0051, "GET /company"; docs/api-contract.md, "Company and the shell"). */
@ApiTags("company")
@ApiCookieAuth()
@Controller("company")
export class CompanyController {
  constructor(private readonly company: CompanyService) {}

  /**
   * GET /company: who is signed in to the open company and what they may do, for the web shell.
   * `@AnyCompanyMember()` is used here for more than the person's own information, as `GET
   * /locations` does: every member gets the company's reference data (name, place, time zone,
   * modules, branches) and a names directory (id, name, active or disabled), because every screen
   * names people beside records. Only someone holding a role or user settings key also gets the
   * ceiling. The access is PermissionGuard's own for this request (`@CurrentAccess()`), so a disabled
   * profile or a role still to enrol MFA is refused before this runs. A read: not audited, and never
   * cached, since it carries the person's access. No module or feature switch: the shell needs it.
   */
  @Get()
  @AnyCompanyMember()
  @Header("Cache-Control", "no-store")
  answer(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess): Promise<CompanyAnswer> {
    return this.company.answer(tenant, access);
  }
}
