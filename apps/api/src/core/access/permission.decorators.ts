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
 * own information, such as their access. Every other company route must name its permissions. It
 * counts only on a handler, never on a controller class.
 */
export const AnyCompanyMember = () => SetMetadata(ANY_MEMBER_KEY, true);

/**
 * Marks a write whose handler writes its own audit entry through AuditService, inside its
 * transaction, so the AuditInterceptor does not add a second one. It counts only on a handler.
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

/** Methods that only read; a write must declare its permissions on its own handler. */
const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The permission requirement of the route a request is for. Class-level decorators are defaults for
 * reads only (PR #7 review): `@AnyCompanyMember()` counts only on the handler itself, and a write
 * (POST, PUT, PATCH or DELETE) counts only permissions set on its own handler. So a controller that
 * lets members read can never let them write by accident.
 */
export function permissionRequirement(
  reflector: Reflector,
  context: ExecutionContext,
  method: string,
): PermissionRequirement {
  const handlerOnly = <T>(key: string) => reflector.get<T | undefined>(key, context.getHandler());
  const permissions = READ_METHODS.has(method)
    ? read<PermissionKey[]>(reflector, PERMISSIONS_KEY, context)
    : handlerOnly<PermissionKey[]>(PERMISSIONS_KEY);
  return {
    permissions: permissions ?? [],
    module: read<ModuleKey>(reflector, MODULE_KEY, context),
    anyMember: handlerOnly<boolean>(ANY_MEMBER_KEY) ?? false,
  };
}

/** Whether the route's handler writes its own audit entry. */
export function isAudited(reflector: Reflector, context: ExecutionContext): boolean {
  // Handler only: a class-level @Audited() would silence the safety net for every write in the
  // controller (PR #7 re-review).
  return reflector.get<boolean | undefined>(AUDITED_KEY, context.getHandler()) ?? false;
}
