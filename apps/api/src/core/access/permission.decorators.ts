import { SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { ModuleKey, PermissionKey } from "@workspace/shared";

const PERMISSIONS_KEY = "access:permissions";
const MODULE_KEY = "access:module";
const ANY_MEMBER_KEY = "access:any-member";
const AUDITED_KEY = "access:audited";

/**
 * The permissions a company route needs: any one of them (spec rule 5, `assertCan`). The keys come
 * from the catalog in packages/shared, so the API and the screens use the same engine (rule 4).
 */
export const RequirePermission = (...keys: [PermissionKey, ...PermissionKey[]]) => SetMetadata(PERMISSIONS_KEY, keys);

/** The module that must be switched on for the company (blueprint "Four layers of control"). */
export const RequireModule = (module: ModuleKey) => SetMetadata(MODULE_KEY, module);

/**
 * Lets any member of the company in, with no permission. Only for routes that return the person's
 * own information, such as their access. Every other company route must name its permissions.
 */
export const AnyCompanyMember = () => SetMetadata(ANY_MEMBER_KEY, true);

/**
 * Marks a write whose handler writes its own audit entry through AuditService, inside its
 * transaction, so the AuditInterceptor does not add a second one.
 */
export const Audited = () => SetMetadata(AUDITED_KEY, true);

/** What a route declares about permissions, as PermissionGuard reads it. */
export interface PermissionRequirement {
  permissions: readonly PermissionKey[];
  module: ModuleKey | undefined;
  anyMember: boolean;
}

function read<T>(reflector: Reflector, key: string, context: ExecutionContext): T | undefined {
  return reflector.getAllAndOverride<T>(key, [context.getHandler(), context.getClass()]);
}

/** The permission requirement of the route a request is for. */
export function permissionRequirement(reflector: Reflector, context: ExecutionContext): PermissionRequirement {
  return {
    permissions: read<PermissionKey[]>(reflector, PERMISSIONS_KEY, context) ?? [],
    module: read<ModuleKey>(reflector, MODULE_KEY, context),
    anyMember: read<boolean>(reflector, ANY_MEMBER_KEY, context) ?? false,
  };
}

/** Whether the route's handler writes its own audit entry. */
export function isAudited(reflector: Reflector, context: ExecutionContext): boolean {
  return read<boolean>(reflector, AUDITED_KEY, context) ?? false;
}
