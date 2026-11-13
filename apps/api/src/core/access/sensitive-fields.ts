import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { sensitiveKeyFor, type PermissionKey } from "@workspace/shared";
import { map, type Observable } from "rxjs";
import type { AccessRequest } from "./permission.guard";

/** Bodies that are not JSON (files and streams). Modules that export files strip the data first. */
function isBinary(value: unknown): boolean {
  return value instanceof StreamableFile || Buffer.isBuffer(value) || value instanceof Uint8Array;
}

/** Removes the sensitive fields from data that is already plain JSON (objects, arrays and values). */
function stripJson(value: unknown, held: ReadonlySet<PermissionKey>): unknown {
  if (Array.isArray(value)) return value.map((item) => stripJson(item, held));
  if (typeof value !== "object" || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const [field, inner] of Object.entries(value)) {
    const key = sensitiveKeyFor(field);
    if (key && !held.has(key)) continue;
    result[field] = stripJson(inner, held);
  }
  return result;
}

/**
 * The response as it will be sent, with every sensitive field the viewer may not see left out
 * (CLAUDE.md rule 5: the server strips cost, margin, pay rate and credit limit; hiding them on screen
 * is not enough). The body is first turned into the JSON the client would receive, so class
 * instances, `toJSON` methods, Dates and decimals are covered exactly as serialised (PR #7 review).
 * Fields are matched by name at any depth, camelCase or snake_case. The original is not changed.
 * Files and streams pass unchanged: a module that exports data strips it with this function first.
 */
export function stripSensitive(value: unknown, held: ReadonlySet<PermissionKey>): unknown {
  if (value === undefined || isBinary(value)) return value;
  return stripJson(JSON.parse(JSON.stringify(value)) as unknown, held);
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
