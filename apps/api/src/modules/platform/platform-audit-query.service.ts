import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { platformAuditLog, tenants, user } from "@workspace/db/control";
import {
  MIGRATION_ERROR_CODE,
  PLATFORM_ADMIN_AUDIT_ACTIONS,
  PLATFORM_AUDIT_PAGE,
  PLATFORM_AUDIT_QUERY_MESSAGES,
  platformAuditView,
  seesAllSupportGrants,
  seesAuditNetwork,
  type PlatformAuditQuery,
  type PlatformAuditResult,
} from "@workspace/shared";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { CONTROL_DB } from "../../core/database/control-db";
import type { PlatformActor } from "./platform-admin.guard";

/**
 * Reads the platform audit log for the console (docs/specs/platform-admin.md, "GET
 * /platform/audit"; ADR 0053), newest first, a page at a time. Reads are not audited.
 *
 * What may leave the control database is narrowed in SQL first, so the text never reaches the
 * API's memory, then checked again by the shared `platformAuditView` (deny by default):
 * - a `company.migration_failed` row only ever carries `{ code }`, a string that fits the code
 *   pattern, and no `before`: older rows hold the driver's text, which can quote company data;
 * - the actor's id and name only on the two platform-admin actions, so a company Owner's id or
 *   name never leaves;
 * - the IP and user agent only for the owner role (`seesAuditNetwork`), and only on those actions;
 * - for a role that doesn't see every admin's requests, another admin's `support.requested` row
 *   has no `before` or `after`, so its reason stays hidden (`seesAllSupportGrants`,
 *   `seesSupportReason`).
 */
@Injectable()
export class PlatformAuditQueryService {
  constructor(@Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>) {}

  /** One page of entries for `viewer`, filtered by company and action, after the `before` cursor. */
  async page(viewer: PlatformActor, query: PlatformAuditQuery): Promise<PlatformAuditResult> {
    const limit = query.limit ?? PLATFORM_AUDIT_PAGE.default;
    if (query.before) await this.requireEntry(query.before);
    const log = platformAuditLog;
    const adminRow = inArray(log.action, [...PLATFORM_ADMIN_AUDIT_ACTIONS]);
    const failed = eq(log.action, "company.migration_failed");
    const otherRequest = seesAllSupportGrants(viewer.role)
      ? sql`false`
      : sql`(${log.action} = 'support.requested' and ${log.actorUserId} is distinct from ${viewer.userId})`;
    const network = seesAuditNetwork(viewer.role);
    const rows = await this.control.db
      .select({
        id: log.id,
        at: log.at,
        action: log.action,
        tenantId: log.tenantId,
        companyName: tenants.name,
        actorUserId: sql<string | null>`case when ${adminRow} then ${log.actorUserId} end`,
        actorName: user.name,
        targetType: log.targetType,
        targetId: log.targetId,
        before: sql<unknown>`case when ${failed} or ${otherRequest} then null else ${log.before} end`.mapWith(
          log.before,
        ),
        after: sql<unknown>`case
          when ${failed} then jsonb_build_object('code', case
            when jsonb_typeof(${log.after} -> 'code') = 'string' and ${log.after} ->> 'code' ~ ${MIGRATION_ERROR_CODE.source}
            then ${log.after} -> 'code' end)
          when ${otherRequest} then null
          else ${log.after} end`.mapWith(log.after),
        // Never selected for a role that doesn't see addresses: the value stays in the database.
        ip: network ? sql<string | null>`case when ${adminRow} then ${log.ip} end` : sql<string | null>`null::text`,
        userAgent: network
          ? sql<string | null>`case when ${adminRow} then ${log.userAgent} end`
          : sql<string | null>`null::text`,
      })
      .from(log)
      .leftJoin(tenants, eq(tenants.id, log.tenantId))
      .leftJoin(user, and(eq(user.id, log.actorUserId), adminRow))
      .where(and(...filtersOf(query)))
      .orderBy(desc(log.at), desc(log.id))
      .limit(limit + 1);
    const entries = rows.slice(0, limit).map((row) => platformAuditView(row, viewer));
    return { entries, nextCursor: rows.length > limit ? (entries.at(-1)?.id ?? null) : null };
  }

  /** 400 unless the cursor names an entry that exists, checked with a separate select. */
  private async requireEntry(id: string): Promise<void> {
    const [entry] = await this.control.db
      .select({ id: platformAuditLog.id })
      .from(platformAuditLog)
      .where(eq(platformAuditLog.id, id))
      .limit(1);
    if (!entry) {
      throw new BadRequestException({ code: "invalid_request", message: PLATFORM_AUDIT_QUERY_MESSAGES.before });
    }
  }
}

/**
 * The query's filters. The cursor is compared in SQL as `(at, id) < (the cursor's at, id)`, so `at`
 * keeps its microseconds and entries of the same millisecond page correctly; it works with any
 * filter, even one taken under another filter.
 */
function filtersOf(query: PlatformAuditQuery): SQL[] {
  const filters: SQL[] = [];
  if (query.companyId) filters.push(eq(platformAuditLog.tenantId, query.companyId));
  if (query.action) filters.push(eq(platformAuditLog.action, query.action));
  if (query.before) {
    filters.push(
      sql`(${platformAuditLog.at}, ${platformAuditLog.id}) < (select anchor.at, anchor.id from platform_audit_log anchor where anchor.id = ${query.before})`,
    );
  }
  return filters;
}
