import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { TenantStatus } from "@workspace/db/control";
import type { ProductKey } from "@workspace/shared";
import type { Request } from "express";
import type { AuthSession } from "../auth/session.service";
import { isReadOnly, type CompanyAccess } from "./tenant-directory";

/**
 * The company a request works in, as TenantGuard established it from the verified session
 * (CLAUDE.md rule 2). TenantConnectionService takes only this, never a bare id, so no route can hand
 * it a company from a path, query, body or header. The constructor is private: the one way to
 * make it is `fromVerifiedSession`, which TenantGuard calls after its checks.
 *
 * The `#verified` field makes the type nominal. TypeScript compares classes by shape, so without a
 * truly private member a plain object such as `{ companyId: params.id, ... }` would compile where a
 * TenantContext is expected (PR #6 re-review). TenantConnectionService also checks `instanceof` at
 * run time.
 */
export class TenantContext {
  readonly #verified = true;

  private constructor(
    /** The company (tenant) id. */
    readonly companyId: string,
    /** The person working in it. */
    readonly userId: string,
    /** The products the company has. */
    readonly products: readonly ProductKey[],
    /** The company's status; `trial` decides whether it gets all of its products' modules. */
    readonly status: TenantStatus,
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
    return new TenantContext(company.id, session.user.id, company.products, company.status, isReadOnly(company));
  }

  /** Whether a value is a TenantContext made by `fromVerifiedSession`, not a look-alike object. */
  static isVerified(value: unknown): value is TenantContext {
    return value instanceof TenantContext && value.#verified;
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
