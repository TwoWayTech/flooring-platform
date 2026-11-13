import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { SENSITIVE_FIELDS, type PermissionKey } from "@workspace/shared";
import { map, type Observable } from "rxjs";
import type { AccessRequest } from "./permission.guard";

/** Whether a value is a plain object (not a Date, Buffer or class instance), to walk into. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A copy of a response with every sensitive field the viewer may not see left out (CLAUDE.md rule 5:
 * the server strips cost, margin, pay rate and credit limit; hiding them on screen is not enough).
 * Fields are matched by name at any depth, in objects and arrays. The response itself is not changed.
 */
export function stripSensitive(value: unknown, held: ReadonlySet<PermissionKey>): unknown {
  if (Array.isArray(value)) return value.map((item) => stripSensitive(item, held));
  if (!isPlainObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [field, inner] of Object.entries(value)) {
    const key = SENSITIVE_FIELDS[field];
    if (key && !held.has(key)) continue;
    result[field] = stripSensitive(inner, held);
  }
  return result;
}

/**
 * Applies stripSensitive to every company response, with the permissions PermissionGuard
 * resolved. Public and session-only routes return no company data, so they pass unchanged.
 */
@Injectable()
export class SensitiveFieldsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const access = context.switchToHttp().getRequest<AccessRequest>().access;
    if (!access) return next.handle();
    return next.handle().pipe(map((body: unknown) => stripSensitive(body, access.permissions)));
  }
}
