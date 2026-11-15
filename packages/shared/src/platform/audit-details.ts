import { featureOn, FEATURES, type FeatureRegister } from "../features";
import { ALL_PERMISSION_KEYS } from "../permissions/catalog";
import type { LifecycleStatus } from "../permissions/company-lifecycle";
import { MODULES } from "../products";
import type {
  PlatformAuditAction,
  PlatformAuditActor,
  PlatformAuditDetails,
  PlatformAuditLimitChange,
  PlatformAuditPlanChange,
  PlatformAuditView,
} from "../types/platform";
import { isAccessLimit } from "./access-patch";
import { ADMIN_REASON } from "./admin-reason";
import { seesAdminReason, seesAuditNetwork, seesSupportReason, type SupportReasonViewer } from "./admin-roles";
import { isLifecycleStatus } from "./company-status";
import { isPlanProduct, PLAN_CHANGE_FIELDS, PLAN_KEY, PLAN_NAME, PLAN_PRICE, type PlanChangeField } from "./plans";

/*
 * The platform audit log as the console reads it (docs/specs/platform-admin.md, "GET
 * /platform/audit"; ADR 0053). Stored rows are never trusted: every field the console shows passes
 * an allow-list for its action, and anything that doesn't fit reads "Details hidden". A migration
 * failure only ever shows its error code, because the driver's text can quote company data.
 */

/** Who makes an audit entry of a known action. */
export type PlatformAuditActorKind = "platform_admin" | "company_user" | "system";

/**
 * Who makes each action (spec "The six actions"; "Audit (part 2)" adds seven, all by a platform
 * admin). The actor kind comes from the action, never from today's `platform_admins` rows, so a
 * company Owner who later becomes a platform admin still shows as the company's Owner on an approval.
 */
export const PLATFORM_AUDIT_ACTOR: Readonly<Record<PlatformAuditAction, PlatformAuditActorKind>> = {
  "company.access_changed": "platform_admin",
  "support.requested": "platform_admin",
  "support.approved": "company_user",
  "support.revoked": "company_user",
  "company.migration_failed": "system",
  "company.migration_recovered": "system",
  "company.suspended": "platform_admin",
  "company.reinstated": "platform_admin",
  "company.cancelled": "platform_admin",
  "plan.created": "platform_admin",
  "plan.changed": "platform_admin",
  "plan.retired": "platform_admin",
  "plan.restored": "platform_admin",
};

/** The thirteen actions, in the order of `PLATFORM_AUDIT_ACTOR` (the one copy of the list). */
export const PLATFORM_AUDIT_ACTIONS = Object.keys(PLATFORM_AUDIT_ACTOR) as readonly PlatformAuditAction[];

/** Whether a stored or requested action is one of the thirteen. */
export function isPlatformAuditAction(value: string): value is PlatformAuditAction {
  return PLATFORM_AUDIT_ACTIONS.some((action) => action === value);
}

/**
 * The actions a platform admin makes. Only their entries carry the actor's id and name, and, for
 * the owner role, the address and device (spec "Narrowed in SQL first").
 */
export const PLATFORM_ADMIN_AUDIT_ACTIONS: readonly PlatformAuditAction[] = PLATFORM_AUDIT_ACTIONS.filter(
  (action) => PLATFORM_AUDIT_ACTOR[action] === "platform_admin",
);

/**
 * The seven plan and status actions, which belong to the `admin.billing` switch (spec "Audit (part
 * 2)", The filter and the switch).
 */
export const BILLING_AUDIT_ACTIONS: readonly PlatformAuditAction[] = [
  "company.suspended",
  "company.reinstated",
  "company.cancelled",
  "plan.created",
  "plan.changed",
  "plan.retired",
  "plan.restored",
];

/**
 * Whether the audit log offers and accepts this action as a filter (spec "Audit (part 2)"; CLAUDE.md
 * rule 13): every action but the seven, and those only while `admin.billing` is on. The web's Action
 * filter, the demo and the API's `action` check all call it, per call, so a switch flipped at run
 * time counts. Stored rows of the seven still list and render while it is off: they are history
 * (owner question 47).
 */
export function platformAuditActionOn(action: PlatformAuditAction, register: FeatureRegister = FEATURES): boolean {
  return !BILLING_AUDIT_ACTIONS.includes(action) || featureOn("admin.billing", register);
}

/** The name an admin's entries and requests show once the admin's user row is gone. */
export const FORMER_ADMIN_NAME = "Former admin";

/** How many entries one page of the audit log may hold, and how many it holds when none is asked for. */
export const PLATFORM_AUDIT_PAGE = { min: 1, max: 100, default: 50 } as const;

/** The 400 messages of `GET /platform/audit` (spec "Validations and messages (part 3)"); the demo uses `before`. */
export const PLATFORM_AUDIT_QUERY_MESSAGES = {
  action: "Choose an action from the list.",
  before: "That page of the audit log does not exist. Start from the newest entries.",
  limit: `Ask for ${PLATFORM_AUDIT_PAGE.min} to ${PLATFORM_AUDIT_PAGE.max} entries at a time.`,
} as const;

/**
 * A SQLSTATE or system error code (spec "Redaction": `company.migration_failed`). `pnpm db:migrate`
 * stores only a code that fits it, and the API's SQL (by `.source`) and read keep only such codes.
 */
export const MIGRATION_ERROR_CODE = /^[A-Z0-9_]{1,32}$/;

/** A company migration tag, such as `0006_foreign_key_indexes` (spec "Redaction": `company.migration_recovered`). */
export const MIGRATION_VERSION = /^\d{4}_[a-z0-9_]{1,80}$/;

/** The value when it is a string that fits `MIGRATION_ERROR_CODE`, else null: never any other text. */
export function migrationErrorCode(value: unknown): string | null {
  return typeof value === "string" && MIGRATION_ERROR_CODE.test(value) ? value : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_TYPE = /^[a-z_]{1,64}$/;
const ACTION_NAME = /^[a-z_]{1,40}\.[a-z_]{1,40}$/;
const UNKNOWN = "unknown";

/** The stored target id when it is a UUID of any version, else null (spec "PlatformAuditView"). */
export function auditTargetId(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/** The stored target type when it fits `^[a-z_]{1,64}$`, else "unknown" (spec "PlatformAuditView"). */
export function auditTargetType(value: unknown): string {
  return typeof value === "string" && TARGET_TYPE.test(value) ? value : UNKNOWN;
}

/** The stored action when it fits `object.verb` (`^[a-z_]{1,40}\.[a-z_]{1,40}$`), else "unknown". */
export function auditActionName(value: unknown): string {
  return typeof value === "string" && ACTION_NAME.test(value) ? value : UNKNOWN;
}

/** Who makes entries of this action, or "unknown" for an action this build doesn't know. */
export function platformAuditActorKind(action: unknown): PlatformAuditActorKind | "unknown" {
  return typeof action === "string" && isPlatformAuditAction(action) ? PLATFORM_AUDIT_ACTOR[action] : UNKNOWN;
}

/**
 * The actor of an entry (spec "PlatformAuditActor"). A platform admin is named from the control
 * `user` row, or "Former admin" when it is gone, and needs the stored actor id (else "unknown").
 * The company's Owner and the migration runner carry no id and no name, even when one is passed.
 */
export function platformAuditActor(
  action: unknown,
  actorUserId: string | null,
  actorName: string | null,
): PlatformAuditActor {
  const kind = platformAuditActorKind(action);
  if (kind === "platform_admin") {
    return actorUserId ? { kind, userId: actorUserId, name: actorName ?? FORMER_ADMIN_NAME } : { kind: UNKNOWN };
  }
  return { kind };
}

/** A fresh "Details hidden", so no caller can change another entry's details. */
function hidden(): PlatformAuditDetails {
  return { kind: "hidden" };
}

/** The largest limit an access entry may show; a stored limit above it hides the entry. */
const MAX_AUDIT_LIMIT = 1_000_000;
/** The most override or limit rows an access entry may list. */
const MAX_WRITTEN_ROWS = 50;
/** The longest permission or module key an access entry may list. */
const MAX_KEY_LENGTH = 100;
/** A permission or module key; a pattern, not the catalog, so a retired key still shows. */
const ACCESS_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){0,3}$/;
/** An ISO moment as `toISOString()` and PostgreSQL write it. */
const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

const LIMIT_KEYS = ["userLimit", "branchLimit"] as const;
const LIST_KEYS = ["modulesSwitchedOn", "modulesSwitchedOff", "keysAdded", "keysRemoved"] as const;
const ACCESS_AFTER_KEYS: readonly string[] = [...LIST_KEYS, ...LIMIT_KEYS, "overrideRows", "limitRows"];

type LimitKey = (typeof LIMIT_KEYS)[number];
type AccessBefore = Partial<Record<LimitKey, number | null>>;
type AccessAfter = AccessBefore &
  Partial<Record<(typeof LIST_KEYS)[number], string[]>> & { overrideRows?: unknown[]; limitRows?: unknown[] };

/** A plain JSON object: not null, not an array, not a class instance. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(record);
  return present.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

/** A list of at most `max` items that all pass `check`; holes count as items that fail. */
function isListOf(value: unknown, max: number, check: (item: unknown) => boolean): value is unknown[] {
  if (!Array.isArray(value) || value.length > max) return false;
  for (let index = 0; index < value.length; index += 1) if (!check(value[index])) return false;
  return true;
}

function isAuditLimit(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_AUDIT_LIMIT;
}

function isAccessKey(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_KEY_LENGTH && ACCESS_KEY.test(value);
}

/** Exactly `{ module, action: "write", enabled }` or `{ module, action: "remove" }` (`ModuleOverrideChange`). */
function isOverrideRow(value: unknown): boolean {
  if (!isPlainRecord(value) || !isAccessKey(value.module)) return false;
  if (value.action === "write")
    return hasExactKeys(value, ["module", "action", "enabled"]) && typeof value.enabled === "boolean";
  return value.action === "remove" && hasExactKeys(value, ["module", "action"]);
}

/** Exactly `{ subscriptionId, userLimitOverride, branchLimitOverride }`, as the access save writes it. */
function isLimitRow(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["subscriptionId", "userLimitOverride", "branchLimitOverride"]) &&
    auditTargetId(value.subscriptionId) !== null &&
    isAuditLimit(value.userLimitOverride) &&
    isAuditLimit(value.branchLimitOverride)
  );
}

function isAccessBefore(value: unknown): value is AccessBefore {
  return isPlainRecord(value) && hasOnlyKeys(value, LIMIT_KEYS) && LIMIT_KEYS.every((key) => isLimitField(value, key));
}

function isLimitField(record: Record<string, unknown>, key: LimitKey): boolean {
  return !Object.hasOwn(record, key) || isAuditLimit(record[key]);
}

function isAccessAfter(value: unknown): value is AccessAfter {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ACCESS_AFTER_KEYS)) return false;
  const listsFit = LIST_KEYS.every(
    (key) => !Object.hasOwn(value, key) || isListOf(value[key], ALL_PERMISSION_KEYS.length, isAccessKey),
  );
  return (
    listsFit &&
    LIMIT_KEYS.every((key) => isLimitField(value, key)) &&
    (!Object.hasOwn(value, "overrideRows") || isListOf(value.overrideRows, MAX_WRITTEN_ROWS, isOverrideRow)) &&
    (!Object.hasOwn(value, "limitRows") || isListOf(value.limitRows, MAX_WRITTEN_ROWS, isLimitRow))
  );
}

/** A limit as `{ from, to }` only when the entry changed it; `from` is null when `before` lacks it. */
function limitChange(before: AccessBefore, after: AccessAfter, key: LimitKey): PlatformAuditLimitChange | null {
  if (!Object.hasOwn(after, key)) return null;
  return { from: before[key] ?? null, to: after[key] ?? null };
}

/** `company.access_changed`: the allow-list of spec "Redaction", else hidden. */
function accessChangedDetails(before: unknown, after: unknown): PlatformAuditDetails {
  if (!isAccessBefore(before) || !isAccessAfter(after)) return hidden();
  return {
    kind: "access_changed",
    modulesSwitchedOn: [...(after.modulesSwitchedOn ?? [])],
    modulesSwitchedOff: [...(after.modulesSwitchedOff ?? [])],
    keysAdded: [...(after.keysAdded ?? [])],
    keysRemoved: [...(after.keysRemoved ?? [])],
    userLimit: limitChange(before, after, "userLimit"),
    branchLimit: limitChange(before, after, "branchLimit"),
    overrideRows: after.overrideRows?.length ?? 0,
    limitRows: after.limitRows?.length ?? 0,
  };
}

function isIsoMoment(value: unknown): value is string {
  return typeof value === "string" && ISO_MOMENT.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * `support.requested`: no `before`, and `after` exactly `{ reason, expiresAt }` with a reason of 1
 * to 500 characters and an ISO moment (safer than "parses as a date": `Date.parse` reads text such
 * as "1" as a date). Else hidden.
 */
function supportRequestedDetails(before: unknown, after: unknown): PlatformAuditDetails {
  if (before !== null && before !== undefined) return hidden();
  if (!isPlainRecord(after) || !hasExactKeys(after, ["reason", "expiresAt"])) return hidden();
  const { reason, expiresAt } = after;
  if (typeof reason !== "string" || reason.length < 1 || reason.length > ADMIN_REASON.max) return hidden();
  if (!isIsoMoment(expiresAt)) return hidden();
  return { kind: "support_requested", reason, expiresAt: new Date(expiresAt).toISOString() };
}

/** `support.approved` and `support.revoked`: only when they carry no `before` or `after`. */
function supportDecidedDetails(
  decision: "approved" | "revoked",
  before: unknown,
  after: unknown,
): PlatformAuditDetails {
  const empty = (value: unknown) => value === null || value === undefined;
  return empty(before) && empty(after) ? { kind: "support_decided", decision } : hidden();
}

/** A stored reason: a string of 1 to 500 characters, or null where the API's SQL narrowed it away. */
function isAuditReason(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length >= 1 && value.length <= ADMIN_REASON.max);
}

/** The status each status action may write; anything else hides the entry. */
const STATUS_TARGETS: Readonly<Record<StatusAuditAction, readonly LifecycleStatus[]>> = {
  "company.suspended": ["suspended"],
  "company.reinstated": ["active", "trial"],
  "company.cancelled": ["cancelled"],
};

type StatusAuditAction = "company.suspended" | "company.reinstated" | "company.cancelled";

/**
 * `company.suspended`, `.reinstated` and `.cancelled` (spec "Audit (part 2)"): `before` exactly
 * `{ status, statusChangedAt }` and `after` exactly `{ status, statusChangedAt, reason }`, with
 * statuses among the five, a real change to a status the action writes, ISO moments and a reason
 * of 1 to 500 characters or null. Else hidden.
 */
function statusChangedDetails(action: StatusAuditAction, before: unknown, after: unknown): PlatformAuditDetails {
  if (!isPlainRecord(before) || !hasExactKeys(before, ["status", "statusChangedAt"])) return hidden();
  if (!isPlainRecord(after) || !hasExactKeys(after, ["status", "statusChangedAt", "reason"])) return hidden();
  const from = before.status;
  const to = after.status;
  if (!isLifecycleStatus(from) || !isLifecycleStatus(to) || from === to) return hidden();
  if (!STATUS_TARGETS[action].includes(to)) return hidden();
  if (!isIsoMoment(before.statusChangedAt) || !isIsoMoment(after.statusChangedAt)) return hidden();
  if (!isAuditReason(after.reason)) return hidden();
  return { kind: "status_changed", from, to, reason: after.reason };
}

/** A plan's stored name: 1 to 80 characters, not only spaces. */
function isPlanNameText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= PLAN_NAME.min && value.length <= PLAN_NAME.max;
}

function isPlanPriceText(value: unknown): value is string {
  return typeof value === "string" && PLAN_PRICE.test(value);
}

/** A plan limit as stored: a whole number from 1 to 100,000. */
function isPlanLimit(value: unknown): value is number {
  return typeof value === "number" && isAccessLimit(value);
}

/** A plan's module list: up to one per module, each a key by pattern, so a retired module still shows. */
function isPlanModuleList(value: unknown): value is string[] {
  return isListOf(value, MODULES.length, isAccessKey);
}

const PLAN_CREATED_KEYS = [
  "key",
  "name",
  "product",
  "monthlyPrice",
  "yearlyPrice",
  "modules",
  "maxUsers",
  "maxBranches",
  "reason",
] as const;

/**
 * `plan.created` (spec "Audit (part 2)"): no `before`, and `after` exactly the plan's fields and the
 * reason, each by the plan rules' patterns, with at least one module. Else hidden.
 */
function planCreatedDetails(before: unknown, after: unknown): PlatformAuditDetails {
  if (before !== null && before !== undefined) return hidden();
  if (!isPlainRecord(after) || !hasExactKeys(after, PLAN_CREATED_KEYS)) return hidden();
  const { key, name, product, monthlyPrice, yearlyPrice, modules, maxUsers, maxBranches, reason } = after;
  if (typeof key !== "string" || !PLAN_KEY.test(key) || !isPlanNameText(name) || !isPlanProduct(product)) {
    return hidden();
  }
  if (!isPlanPriceText(monthlyPrice) || !isPlanPriceText(yearlyPrice)) return hidden();
  if (!isPlanModuleList(modules) || modules.length === 0) return hidden();
  if (!isPlanLimit(maxUsers) || !isPlanLimit(maxBranches) || !isAuditReason(reason)) return hidden();
  return {
    kind: "plan_created",
    key,
    name,
    product,
    monthlyPrice,
    yearlyPrice,
    modules: [...modules],
    maxUsers,
    maxBranches,
    reason,
  };
}

function isPlanChangeField(value: string): value is PlanChangeField {
  return PLAN_CHANGE_FIELDS.some((field) => field === value);
}

/** One changed field with its old and new value, each by its rule, or null when either doesn't fit. */
function planChange(field: PlanChangeField, from: unknown, to: unknown): PlatformAuditPlanChange | null {
  switch (field) {
    case "name":
      return isPlanNameText(from) && isPlanNameText(to) ? { field, from, to } : null;
    case "monthlyPrice":
    case "yearlyPrice":
      return isPlanPriceText(from) && isPlanPriceText(to) ? { field, from, to } : null;
    case "modules":
      return isPlanModuleList(from) && isPlanModuleList(to) ? { field, from: [...from], to: [...to] } : null;
    case "maxUsers":
    case "maxBranches":
      // The old side is null when the plan had no limits row; a change always sets a number.
      return (from === null || isPlanLimit(from)) && isPlanLimit(to) ? { field, from, to } : null;
  }
}

/**
 * `plan.changed` (spec "Audit (part 2)"): `before` holds one or more changeable fields and nothing
 * else, `after` exactly the same fields plus the reason, each value by its rule. The changes come in
 * `PLAN_CHANGE_FIELDS` order. Else hidden.
 */
function planChangedDetails(before: unknown, after: unknown): PlatformAuditDetails {
  if (!isPlainRecord(before) || !isPlainRecord(after)) return hidden();
  const fields = Object.keys(before);
  if (fields.length === 0 || !fields.every(isPlanChangeField)) return hidden();
  if (!hasExactKeys(after, [...fields, "reason"]) || !isAuditReason(after.reason)) return hidden();
  const changes: PlatformAuditPlanChange[] = [];
  for (const field of PLAN_CHANGE_FIELDS) {
    if (!Object.hasOwn(before, field)) continue;
    const change = planChange(field, before[field], after[field]);
    if (!change) return hidden();
    changes.push(change);
  }
  return { kind: "plan_changed", changes, reason: after.reason };
}

/**
 * `plan.retired` and `plan.restored` (spec "Audit (part 2)"): `before` exactly `{ active }` and
 * `after` exactly `{ active, reason }`, with `active` flipping the way the action says. Else hidden.
 */
function planActiveDetails(active: boolean, before: unknown, after: unknown): PlatformAuditDetails {
  if (!isPlainRecord(before) || !hasExactKeys(before, ["active"]) || before.active !== !active) return hidden();
  if (!isPlainRecord(after) || !hasExactKeys(after, ["active", "reason"]) || after.active !== active) return hidden();
  return isAuditReason(after.reason) ? { kind: "plan_active", active, reason: after.reason } : hidden();
}

/**
 * What an audit entry may show (docs/specs/platform-admin.md, "Redaction (deny by default)"):
 * - `company.migration_failed`: every row, whatever its shape, shows only `after.code`, and only
 *   when it is an error code. Rows written before part 3 hold the driver's text in `after.error`,
 *   which is never read, so they show `code: null`. `before` is never read.
 * - `company.migration_recovered`: only `after.version`, and only when it is a migration tag.
 * - `company.access_changed`, `support.requested`, `support.approved`, `support.revoked`, and the
 *   seven plan and status actions of part 2: only when `before` and `after` fit the action's
 *   allow-list exactly, else hidden.
 * - any other action: hidden.
 * The API narrows the same fields in SQL first; this is the second layer, and the demo's only one.
 */
export function platformAuditDetails(action: string, before: unknown, after: unknown): PlatformAuditDetails {
  switch (action) {
    case "company.migration_failed":
      return {
        kind: "migration_failed",
        code: migrationErrorCode(isPlainRecord(after) && Object.hasOwn(after, "code") ? after.code : undefined),
      };
    case "company.migration_recovered": {
      const version = isPlainRecord(after) && Object.hasOwn(after, "version") ? after.version : undefined;
      return {
        kind: "migration_recovered",
        version: typeof version === "string" && MIGRATION_VERSION.test(version) ? version : null,
      };
    }
    case "company.access_changed":
      return accessChangedDetails(before, after);
    case "support.requested":
      return supportRequestedDetails(before, after);
    case "support.approved":
      return supportDecidedDetails("approved", before, after);
    case "support.revoked":
      return supportDecidedDetails("revoked", before, after);
    case "company.suspended":
    case "company.reinstated":
    case "company.cancelled":
      return statusChangedDetails(action, before, after);
    case "plan.created":
      return planCreatedDetails(before, after);
    case "plan.changed":
      return planChangedDetails(before, after);
    case "plan.retired":
      return planActiveDetails(false, before, after);
    case "plan.restored":
      return planActiveDetails(true, before, after);
    default:
      return hidden();
  }
}

/** The details with an admin's reason taken out, for a viewer who may not read it. Other kinds are unchanged. */
function withoutReason(details: PlatformAuditDetails): PlatformAuditDetails {
  switch (details.kind) {
    case "status_changed":
    case "plan_created":
    case "plan_changed":
    case "plan_active":
      return { ...details, reason: null };
    default:
      return details;
  }
}

/**
 * One `platform_audit_log` row as read for the console: the API reads it after its SQL narrowing,
 * the demo from its store. `actorName` and `companyName` come from the control `user` and
 * `tenants` rows; `ip` and `userAgent` are null when they were not selected.
 */
export interface PlatformAuditRow {
  id: string;
  at: Date | string;
  action: string;
  tenantId: string | null;
  companyName: string | null;
  actorUserId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
}

/**
 * An audit row as `viewer` may see it (spec "PlatformAuditView"; ADR 0053), the one mapping the
 * API and the demo share:
 * - the action, target type and target id only when they fit their patterns;
 * - the actor from the action (`platformAuditActor`), so company people are never identified;
 * - `details` from `platformAuditDetails`, and hidden on another admin's `support.requested` entry
 *   unless the viewer sees every reason (`seesSupportReason`);
 * - on the plan and status entries, `reason: null` unless the viewer may read it (`seesAdminReason`:
 *   the owner role, or the author). The API's SQL nulls it first; this is the second layer;
 * - `network` only for a role that sees addresses (`seesAuditNetwork`) and only on a platform
 *   admin's own entry; the key is absent otherwise.
 */
export function platformAuditView(row: PlatformAuditRow, viewer: SupportReasonViewer): PlatformAuditView {
  const actor = platformAuditActor(row.action, row.actorUserId, row.actorName);
  const reasonHidden = row.action === "support.requested" && !seesSupportReason(viewer, row.actorUserId);
  const details = reasonHidden ? hidden() : platformAuditDetails(row.action, row.before, row.after);
  const view: PlatformAuditView = {
    id: row.id,
    at: row.at instanceof Date ? row.at.toISOString() : row.at,
    action: auditActionName(row.action),
    company: row.tenantId && row.companyName ? { id: row.tenantId, name: row.companyName } : null,
    actor,
    targetType: auditTargetType(row.targetType),
    targetId: auditTargetId(row.targetId),
    details: seesAdminReason(viewer, row.actorUserId) ? details : withoutReason(details),
  };
  if (seesAuditNetwork(viewer.role) && actor.kind === "platform_admin") {
    view.network = { ip: row.ip, userAgent: row.userAgent };
  }
  return view;
}
