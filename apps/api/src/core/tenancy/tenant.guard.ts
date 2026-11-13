import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PRODUCT_HEADER, type ProductKey } from "@workspace/shared";
import type { AuthSession } from "../auth/session.service";
import { accessLevel, requiredProduct } from "./access";
import { TenantContext, type TenantRequest } from "./tenant-context";
import { isReadOnly, TenantDirectory } from "./tenant-directory";

/** Methods that only read; everything else is a write. */
const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** What each tenancy refusal tells the person (docs/api-contract.md). */
export const TENANCY_REFUSALS = {
  company_required: "Choose a company to continue.",
  not_a_member: "You are no longer a member of this company. Sign in again.",
  product_not_enabled: "Your company does not have this product.",
  company_read_only: "Your company's account is read-only right now, so changes cannot be saved.",
} as const;

function refuse(code: keyof typeof TENANCY_REFUSALS): never {
  throw new ForbiddenException({ code, message: TENANCY_REFUSALS[code] });
}

/**
 * Runs after SessionGuard on every route that needs a company, which is every route unless it is
 * marked `@Public()` or `@SessionOnly()` (CLAUDE.md rules 2 and 3; blueprint P9). It sets the
 * request's TenantContext from the verified session only, after checking that:
 * - the session has an open company that exists and is not deleted (403 `company_required`);
 * - the person is still a member of it (403 `not_a_member`);
 * - the company has the product the web host serves and any product the route requires
 *   (403 `product_not_enabled`; blueprint p17 rule 2);
 * - a write is allowed: suspended, cancelled and maintenance-mode companies are read-only
 *   (403 `company_read_only`; blueprint p29, p40).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly directory: TenantDirectory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (accessLevel(this.reflector, context) !== "company") return true;
    const request = context.switchToHttp().getRequest<TenantRequest & { authSession?: AuthSession }>();
    const session = request.authSession;
    if (!session) throw new Error("TenantGuard ran without a verified session; SessionGuard must run first.");
    if (!session.companyId) refuse("company_required");
    const company = await this.directory.access(session.companyId);
    if (!company) refuse("company_required");
    if (!(await this.directory.isMember(session.user.id, company.id))) refuse("not_a_member");
    const needed = [hostProduct(request.headers[PRODUCT_HEADER]), requiredProduct(this.reflector, context)];
    if (needed.some((product) => product && !company.products.includes(product))) refuse("product_not_enabled");
    if (!READ_METHODS.has(request.method) && isReadOnly(company)) refuse("company_read_only");
    request.tenant = TenantContext.fromVerifiedSession(session, company);
    return true;
  }
}

/** The product the web host says it serves, when the header names one. */
function hostProduct(value: string | string[] | undefined): ProductKey | undefined {
  return value === "flooring" || value === "hr" ? value : undefined;
}
