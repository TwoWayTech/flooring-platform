import { RequestMethod, type INestApplication, type Type } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { ExecutionContextHost } from "@nestjs/core/internal";
import type { ModuleKey, PermissionKey, ProductKey } from "@workspace/shared";
import { isAudited, permissionRequirement } from "../../src/core/access/permission.decorators";
import { SensitiveFieldKeys, type FieldKeys } from "../../src/core/access/sensitive-fields";
import { accessLevel, requiredProduct, type AccessLevel } from "../../src/core/tenancy/access";
import type { HttpMethod } from "./routes";

/** A controller method, as Nest calls it. */
export type RouteHandler = (...args: never[]) => unknown;

/**
 * One Nest route and everything its decorators declare, read through the same readers the guards
 * and interceptors use (core/access and core/tenancy), so the catalog sees what the guards see.
 */
export interface CatalogRoute {
  /** `GET /invoices/:id`: the key every reviewed list and snapshot uses. */
  name: string;
  /** Upper case, as Express lists it. */
  method: string;
  verb: HttpMethod;
  /** The Express path, with `:param` placeholders. */
  path: string;
  controller: Type<unknown>;
  handler: RouteHandler;
  level: AccessLevel;
  /** The product the route requires (`@RequireProduct`), if any. */
  product: ProductKey | undefined;
  /** The module the route declares (`@RequireModule`, handler or class), if any. */
  module: ModuleKey | undefined;
  /** The keys that let a person in, any one of them, as PermissionGuard reads them for this method. */
  anyOf: readonly PermissionKey[];
  anyMember: boolean;
  /** Whether the handler writes its own audit entry (`@Audited()`). */
  audited: boolean;
  /** The route's own sensitive-field rules (`@SensitiveFieldKeys`), if any. */
  sensitiveKeys: FieldKeys | undefined;
}

/** The metadata key `@SensitiveFieldKeys` writes, taken from the decorator so it never drifts. */
const SENSITIVE_KEYS_METADATA = SensitiveFieldKeys({}).KEY;

/** Methods that only read; every other method is a write. */
const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** Whether a route writes (anything but GET, HEAD and OPTIONS). */
export function isWrite(route: Pick<CatalogRoute, "method">): boolean {
  return !READ_METHODS.has(route.method);
}

/** Whether a route's path names a record (`:id`, `:kind`, ...). */
export function hasPathParameter(route: Pick<CatalogRoute, "path">): boolean {
  return route.path.includes("/:");
}

/** The path with every parameter replaced by `value`, ready to request. */
export function concretePath(route: Pick<CatalogRoute, "path">, value: string): string {
  return route.path.replace(/:[^/]+/g, value);
}

/** Nest's path segments joined as Express lists them: `/` plus the non-empty segments. */
function joinPath(...parts: (string | undefined)[]): string {
  const segments = parts.map((part) => (part ?? "").replace(/^\/+|\/+$/g, "")).filter((part) => part !== "");
  return `/${segments.join("/")}`;
}

/** A decorator's path, which Nest allows as one string or a list of them. */
function pathsOf(value: string | string[] | undefined): string[] {
  if (value === undefined) return [""];
  return Array.isArray(value) ? value : [value];
}

/**
 * Every Nest route of the running app, with what it declares (whole-product check, PM-1). The app
 * must have been started with `DiscoveryModule` mounted. The catalog must equal the routes Express
 * lists (`listRoutes`), less the API docs and Better Auth's mount, which are not Nest controllers.
 */
export function routeCatalog(app: INestApplication): CatalogRoute[] {
  const reflector = app.get(Reflector);
  const scanner = new MetadataScanner();
  const routes: CatalogRoute[] = [];
  for (const wrapper of app.get(DiscoveryService).getControllers()) {
    const controller = wrapper.metatype as Type<unknown> | null;
    if (!controller) continue;
    const prototype = controller.prototype as Record<string, unknown>;
    for (const methodName of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[methodName] as RouteHandler;
      const handlerPath = reflector.get<string | string[] | undefined>(PATH_METADATA, handler);
      if (handlerPath === undefined) continue;
      const requestMethod = reflector.get<RequestMethod>(METHOD_METADATA, handler);
      const method = RequestMethod[requestMethod];
      for (const base of pathsOf(reflector.get<string | string[] | undefined>(PATH_METADATA, controller))) {
        for (const own of pathsOf(handlerPath)) {
          const path = joinPath(base, own);
          const context = new ExecutionContextHost([{ method }], controller, handler);
          const requirement = permissionRequirement(reflector, context, method);
          routes.push({
            name: `${method} ${path}`,
            method,
            verb: method.toLowerCase() as HttpMethod,
            path,
            controller,
            handler,
            level: accessLevel(reflector, context),
            product: requiredProduct(reflector, context),
            module: requirement.module,
            anyOf: requirement.permissions,
            anyMember: requirement.anyMember,
            audited: isAudited(reflector, context),
            sensitiveKeys: reflector.get<FieldKeys | undefined>(SENSITIVE_KEYS_METADATA, handler),
          });
        }
      }
    }
  }
  return routes.sort((a, b) => byCodeUnit(a.name, b.name));
}

/** A sort order that never depends on the machine's locale, so snapshots read the same everywhere. */
export function byCodeUnit(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
