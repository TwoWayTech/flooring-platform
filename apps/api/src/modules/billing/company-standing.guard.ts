import {
  createParamDecorator,
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { PRODUCT_HEADER, type ProductKey } from "@workspace/shared";
import type { Request } from "express";
import type { AuthSession } from "../../core/auth/session.service";
import { TENANCY_REFUSALS } from "../../core/tenancy/tenant.guard";
import { TenantDirectory, type CompanyAccess } from "../../core/tenancy/tenant-directory";

/** The request as the standing route reads it: SessionGuard's session, then this guard's company. */
type StandingRequest = Request & { authSession?: AuthSession; standingCompany?: CompanyAccess };

/** The refusals this guard can give: TenantGuard's own membership refusals. */
type StandingRefusal = "company_required" | "not_a_member" | "product_not_enabled";

/** Refuses with TenantGuard's code and words, so the route reveals nothing TenantGuard would not. */
function refuse(code: StandingRefusal): never {
  throw new ForbiddenException({ code, message: TENANCY_REFUSALS[code] });
}

/**
 * The membership checks of `GET /company/standing` (docs/specs/platform-admin.md, part 4, "GET
 * /company/standing", Refusal order; ADR 0054). The route is `@SessionOnly()`, because TenantGuard
 * refuses a company route in the very states the standing screens show (maintenance, an unusable
 * database, locked). So this guard, set at class level, repeats TenantGuard's checks before those
 * states, in TenantGuard's order and with its codes and words:
 * 1. the session has no open company: 403 `company_required`;
 * 2. the open company is unknown or deleted: 403 `company_required`;
 * 3. the person is no longer a member of it: 403 `not_a_member`;
 * 4. the web host's product header names a product the company lacks: 403 `product_not_enabled`
 *    (a request without the header skips this check, as in TenantGuard).
 * The company always comes from the verified session (CLAUDE.md rule 2); nothing in the path,
 * query, body or headers names it. Both reads are control rows only: the guard never builds a
 * TenantContext and never opens the company database, which lint enforces for this module.
 */
@Injectable()
export class StandingMemberGuard implements CanActivate {
  constructor(private readonly directory: TenantDirectory) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StandingRequest>();
    const session = request.authSession;
    if (!session) throw new Error("StandingMemberGuard ran without a verified session; SessionGuard must run first.");
    if (!session.companyId) refuse("company_required");
    const company = await this.directory.access(session.companyId);
    if (!company) refuse("company_required");
    if (!(await this.directory.isMember(session.user.id, company.id))) refuse("not_a_member");
    const product = hostProduct(request.headers[PRODUCT_HEADER]);
    if (product && !company.products.includes(product)) refuse("product_not_enabled");
    request.standingCompany = company;
    return true;
  }
}

/** The session's own company, as StandingMemberGuard checked it for this request. */
export const MemberCompany = createParamDecorator((_data: unknown, context: ExecutionContext): CompanyAccess => {
  const company = context.switchToHttp().getRequest<StandingRequest>().standingCompany;
  if (!company) throw new Error("StandingMemberGuard must run first.");
  return company;
});

/**
 * The product the web host says it serves, when the header names one. A copy of TenantGuard's
 * private helper (core/tenancy/tenant.guard.ts), because part 4 changes nothing in core (ADR 0054).
 */
function hostProduct(value: string | string[] | undefined): ProductKey | undefined {
  return value === "flooring" || value === "hr" ? value : undefined;
}
