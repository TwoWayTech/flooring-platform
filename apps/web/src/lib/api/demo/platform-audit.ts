import {
  isPlatformAuditAction,
  PLATFORM_AUDIT_PAGE,
  PLATFORM_AUDIT_QUERY_MESSAGES,
  platformAuditActionOn,
  platformAuditView,
  type PlatformAdminRole,
  type PlatformAuditQuery,
  type PlatformAuditResult,
} from "@workspace/shared";
import { DemoRuleError } from "./admin-rules";

/**
 * The demo's platform admin, the "Platform admin (you)" card (docs/specs/platform-admin.md, part 3,
 * "Demo mode"). It has the owner role, as the demo's platform gate says.
 */
export const DEMO_PLATFORM_ADMIN: { userId: string; name: string; role: PlatformAdminRole } = {
  userId: "platform",
  name: "Platform admin",
  role: "owner",
};

/**
 * One platform audit row as the demo keeps it in local storage (key `platform-audit`). It is the
 * shape of `platform_audit_log` without the actor and the address: every demo row is the demo
 * admin's, and the demo records no IP or device. A plan row names no company (part 2).
 */
export interface DemoPlatformAuditRow {
  id: string;
  /** ISO moment. */
  at: string;
  tenantId: string | null;
  companyName: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  before: unknown;
  after: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMoment(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * Whether a stored value is a demo audit row. Local storage can be edited by hand, so a row that
 * doesn't fit is left out, and the rows that do still pass the shared redaction.
 */
function isDemoAuditRow(value: unknown): value is DemoPlatformAuditRow {
  if (!isRecord(value)) return false;
  const { id, at, tenantId, companyName, action, targetType, targetId } = value;
  return (
    typeof id === "string" &&
    isMoment(at) &&
    (tenantId === null || typeof tenantId === "string") &&
    (companyName === null || typeof companyName === "string") &&
    typeof action === "string" &&
    typeof targetType === "string" &&
    (targetId === null || typeof targetId === "string")
  );
}

/** Newest first: `at` descending, then `id` descending, as the API orders its pages. */
function newerFirst(a: DemoPlatformAuditRow, b: DemoPlatformAuditRow): number {
  const byTime = Date.parse(b.at) - Date.parse(a.at);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Refuses an action filter the API's `action` check refuses (part 3; part 2, "Audit (part 2)"): one
 * that isn't among the thirteen, or one of the seven plan and status actions while `admin.billing`
 * is off. Their stored rows still list when no action is asked for.
 */
function assertActionOn(action: string | undefined): void {
  if (action === undefined) return;
  if (!isPlatformAuditAction(action) || !platformAuditActionOn(action)) {
    throw new DemoRuleError(PLATFORM_AUDIT_QUERY_MESSAGES.action);
  }
}

/** The page size asked for, or the default; anything else is the API's 400. */
function pageSize(limit: number | undefined): number {
  const size = limit ?? PLATFORM_AUDIT_PAGE.default;
  if (!Number.isInteger(size) || size < PLATFORM_AUDIT_PAGE.min || size > PLATFORM_AUDIT_PAGE.max) {
    throw new DemoRuleError(PLATFORM_AUDIT_QUERY_MESSAGES.limit);
  }
  return size;
}

/**
 * One page of the demo's platform audit log (spec "GET /platform/audit"), the API's rules on the
 * stored rows:
 * - filtered by company and action, newest first; an action the API's check refuses is refused
 *   with its message;
 * - `before` names the last entry of the previous page, among all rows whatever the filters, and
 *   an unknown cursor is refused with the API's message;
 * - every row is mapped through the shared `platformAuditView` as the demo admin sees it, so a
 *   migration row only ever shows its code and anything outside its allow-list reads hidden.
 */
export function demoAuditPage(stored: readonly unknown[], query: PlatformAuditQuery): PlatformAuditResult {
  assertActionOn(query.action);
  const size = pageSize(query.limit);
  const rows = stored.filter(isDemoAuditRow).sort(newerFirst);
  let candidates = rows;
  if (query.before !== undefined) {
    const cursor = rows.find((row) => row.id === query.before);
    if (!cursor) throw new DemoRuleError(PLATFORM_AUDIT_QUERY_MESSAGES.before);
    // Rows that sort after the cursor: older, or as old with a smaller id, as `(at, id) < cursor`.
    candidates = rows.filter((row) => newerFirst(cursor, row) < 0);
  }
  const matching = candidates.filter(
    (row) =>
      (query.companyId === undefined || row.tenantId === query.companyId) &&
      (query.action === undefined || row.action === query.action),
  );
  const page = matching.slice(0, size);
  const viewer = { role: DEMO_PLATFORM_ADMIN.role, userId: DEMO_PLATFORM_ADMIN.userId };
  return {
    entries: page.map((row) =>
      platformAuditView(
        {
          id: row.id,
          at: new Date(row.at).toISOString(),
          action: row.action,
          tenantId: row.tenantId,
          companyName: row.companyName,
          targetType: row.targetType,
          targetId: row.targetId,
          before: row.before,
          after: row.after,
          actorUserId: DEMO_PLATFORM_ADMIN.userId,
          actorName: DEMO_PLATFORM_ADMIN.name,
          ip: null,
          userAgent: null,
        },
        viewer,
      ),
    ),
    nextCursor: matching.length > size ? (page.at(-1)?.id ?? null) : null,
  };
}
