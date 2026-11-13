import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { ProductKey } from "@workspace/shared";
import type { Request } from "express";
import type { AuthSession } from "../auth/session.service";
import { isReadOnly, type CompanyAccess } from "./tenant-directory";

/**
 * The company a request works in, as TenantGuard established it from the verified session
 * (CLAUDE.md rule 2). TenantConnectionService takes only this, never a bare id, so no route can hand
 * it a company from a path, query, body or header. The constructor is private: the one way to
 * make it is `fromVerifiedSession`, which TenantGuard calls after its checks.
 */
export class TenantContext {
  private constructor(
    /** The company (tenant) id. */
    readonly companyId: string,
    /** The person working in it. */
    readonly userId: string,
    /** The products the company has. */
    readonly products: readonly ProductKey[],
    /** True when the company may be read but not written (suspended, cancelled or in maintenance). */
    readonly readOnly: boolean,
  ) {}

  /**
   * Builds the context for the session's own open company. Throws when the access facts are for a
   * different company, which would be a programming error, never a client choice.
   */
  static fromVerifiedSession(session: AuthSession, company: CompanyAccess): TenantContext {
    if (!session.companyId || session.companyId !== company.id) {
      throw new Error("A tenant context must be for the session's open company.");
    }
    return new TenantContext(company.id, session.user.id, company.products, isReadOnly(company));
  }
}

/** The request after TenantGuard has run. */
export type TenantRequest = Request & { tenant?: TenantContext };

/** The tenant context TenantGuard set for this request. */
export const CurrentTenant = createParamDecorator((_data: unknown, context: ExecutionContext): TenantContext => {
  const tenant = context.switchToHttp().getRequest<TenantRequest>().tenant;
  if (!tenant) throw new Error("CurrentTenant used on a route that is public or session-only.");
  return tenant;
});
