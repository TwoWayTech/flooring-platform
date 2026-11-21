import {
  Injectable,
  SetMetadata,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { MARGIN_REVEALING_FIELDS, seesMargin, sensitiveKeyFor, type PermissionKey } from "@workspace/shared";
import { map, type Observable } from "rxjs";
import type { AccessRequest } from "./permission.guard";

/** Bodies that are not JSON (files and streams). Modules that export files strip the data first. */
function isBinary(value: unknown): boolean {
  return value instanceof StreamableFile || Buffer.isBuffer(value) || value instanceof Uint8Array;
}

/**
 * A route's own rule for a reserved field name: the keys, any one of which reveals it. Used where a
 * name means something else on that route, such as a supplier's credit limit, which the purchasing
 * spec shows to holders of product cost or bills, not of customer credit (PR #13 security review).
 */
export type FieldKeys = Readonly<Record<string, readonly PermissionKey[]>>;

const FIELD_KEYS = "sensitive:field-keys";
const MARGIN_FIELDS = "sensitive:margin-fields";

/** Sets a route's own keys for some sensitive field names (handler level). Fields not named keep the default. */
export const SensitiveFieldKeys = (keys: FieldKeys) => SetMetadata(FIELD_KEYS, keys);

/**
 * Marks a controller (or a handler) whose answers are sales documents: their cost fields
 * (`MARGIN_REVEALING_FIELDS`) are stripped as well unless the viewer may see the margin
 * (`seesMargin`; click-through #68). It only ever hides more, so it may sit on a class.
 */
export const MarginRevealingFields = () => SetMetadata(MARGIN_FIELDS, true);

/** The field names hidden on top of the shared map: the margin-revealing ones, for a viewer without margin sight. */
function hiddenFor(marked: boolean, held: ReadonlySet<PermissionKey>): ReadonlySet<string> {
  return marked && !seesMargin((key) => held.has(key)) ? new Set(MARGIN_REVEALING_FIELDS) : new Set();
}

/**
 * Whether the viewer may see a field: never one the route hides, then the route's own keys when it
 * has them, else the shared map. Only the route's own names count, never Object.prototype's, such
 * as `toString` (finding F-l).
 */
function visible(
  field: string,
  held: ReadonlySet<PermissionKey>,
  own: FieldKeys | undefined,
  hidden: ReadonlySet<string>,
): boolean {
  if (hidden.has(field)) return false;
  const routeKeys = own && Object.hasOwn(own, field) ? own[field] : undefined;
  if (routeKeys) return routeKeys.some((key) => held.has(key));
  const key = sensitiveKeyFor(field);
  return !key || held.has(key);
}

/** Removes the sensitive fields from data that is already plain JSON (objects, arrays and values). */
function stripJson(
  value: unknown,
  held: ReadonlySet<PermissionKey>,
  own: FieldKeys | undefined,
  hidden: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) return value.map((item) => stripJson(item, held, own, hidden));
  if (typeof value !== "object" || value === null) return value;
  // No prototype, so a field named __proto__ stays data instead of changing the object.
  const result = Object.create(null) as Record<string, unknown>;
  for (const [field, inner] of Object.entries(value)) {
    if (!visible(field, held, own, hidden)) continue;
    result[field] = stripJson(inner, held, own, hidden);
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
 * `marginRevealing` marks sales documents, whose cost fields also need margin sight (#68).
 */
export function stripSensitive(
  value: unknown,
  held: ReadonlySet<PermissionKey>,
  own?: FieldKeys,
  marginRevealing = false,
): unknown {
  if (value === undefined || isBinary(value)) return value;
  return stripJson(JSON.parse(JSON.stringify(value)) as unknown, held, own, hiddenFor(marginRevealing, held));
}

/**
 * Applies stripSensitive to every company response, with the permissions PermissionGuard
 * resolved. Public and session-only routes return no company data, so they pass unchanged.
 */
@Injectable()
export class SensitiveFieldsInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const access = context.switchToHttp().getRequest<AccessRequest>().access;
    if (!access) return next.handle();
    // Handler level only, so a class can never loosen every route at once.
    const own = this.reflector.get<FieldKeys | undefined>(FIELD_KEYS, context.getHandler());
    // Handler or class: marking a route this way only ever hides more (#68).
    const targets = [context.getHandler(), context.getClass()];
    const marginRevealing = this.reflector.getAllAndOverride<boolean | undefined>(MARGIN_FIELDS, targets) === true;
    return next.handle().pipe(map((body: unknown) => stripSensitive(body, access.permissions, own, marginRevealing)));
  }
}
