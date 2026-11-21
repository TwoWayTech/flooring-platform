import {
  createParamDecorator,
  ForbiddenException,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { holdsAny } from "@workspace/shared";
import { accessLevel } from "../tenancy/access";
import type { TenantRequest } from "../tenancy/tenant-context";
import type { AuthSession } from "../auth/session.service";
import { AccessService, type RequestAccess } from "./access.service";

/** Said when a role needs MFA and the person has no factor yet (the sign-in refusal's words). */
const MFA_FIRST = "Set up two-step sign-in to continue.";
import { permissionRequirement, type PermissionRequirement } from "./permission.decorators";

/** The request after PermissionGuard has run. */
export type AccessRequest = TenantRequest & { access?: RequestAccess };

/** What each permission refusal tells the person (docs/api-contract.md, Permissions). */
export const PERMISSION_REFUSALS = {
  forbidden: "Your role does not allow this. Ask an Owner to change your security role.",
  module_not_enabled: "This part of the product is not switched on for your company.",
  permission_undeclared: "This action is not available.",
} as const;

/** Why a request is refused, or null when it may go on (pure, so it is unit-tested on its own). */
export function permissionDecision(
  requirement: PermissionRequirement,
  access: RequestAccess,
): keyof typeof PERMISSION_REFUSALS | null {
  if (requirement.permissions.length === 0 && !requirement.anyMember) return "permission_undeclared";
  if (requirement.module && !access.modules.includes(requirement.module)) return "module_not_enabled";
  if (requirement.permissions.length > 0 && !holdsAny(access.permissions, requirement.permissions)) {
    return "forbidden";
  }
  if (access.disabled) return "forbidden";
  return null;
}

/**
 * Runs after SessionGuard and TenantGuard on every company route (CLAUDE.md rules 3 and 4,
 * blueprint P10). A route must name the permissions it needs with `@RequirePermission()` (any one
 * of them), or say `@AnyCompanyMember()`. A route that says neither is refused, so a forgotten
 * decorator fails closed. Effective permissions come from AccessService, which uses the shared
 * engine. A permission's module must be on, so a route never serves a company whose products lack
 * it. The access is kept on the request for `@CurrentAccess()`, the sensitive-field interceptor and
 * the audit interceptor.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger("Permissions");

  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (accessLevel(this.reflector, context) !== "company") return true;
    const request = context.switchToHttp().getRequest<AccessRequest>();
    if (!request.tenant) throw new Error("PermissionGuard ran without a tenant; TenantGuard must run first.");
    const requirement = permissionRequirement(this.reflector, context, request.method);
    if (requirement.permissions.length === 0 && !requirement.anyMember) {
      this.logger.error(`${context.getClass().name}.${context.getHandler().name} declares no permission.`);
    }
    const access = await this.access.resolve(request.tenant);
    // A role that needs MFA by content needs a factor, whatever member.role says (PR #11 review).
    const mfa = (request as AccessRequest & { authSession?: AuthSession }).authSession?.mfa;
    if (access.mfaRequired && mfa && !mfa.totp && mfa.passkeys === 0) {
      throw new ForbiddenException({ code: "mfa_enrolment_required", message: MFA_FIRST });
    }
    const refusal = permissionDecision(requirement, access);
    if (refusal) throw new ForbiddenException({ code: refusal, message: PERMISSION_REFUSALS[refusal] });
    request.access = access;
    return true;
  }
}

/** The access PermissionGuard resolved for this request. */
export const CurrentAccess = createParamDecorator((_data: unknown, context: ExecutionContext): RequestAccess => {
  const access = context.switchToHttp().getRequest<AccessRequest>().access;
  if (!access) throw new Error("CurrentAccess used on a route that is public or session-only.");
  return access;
});
