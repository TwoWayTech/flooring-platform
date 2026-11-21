import { Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { auditLog } from "@workspace/db/company";
import { user } from "@workspace/db/control";
import {
  canSeePayAudit,
  payAuditDetailsVisible,
  redactPayAudit,
  type AuditEntry,
  type PayAuditSubject,
  type ScopedPayAuditViewer,
} from "@workspace/shared";
import { desc, inArray } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { stripSensitive } from "../../core/access/sensitive-fields";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { viewerEmployeeId } from "../hr/hr-records";
import { COMPANY_SUBJECT, loadPayAuditSubjects } from "./pay-audit-subjects";

/** How many entries Settings → Audit log reads at once, newest first. */
const AUDIT_PAGE = 500;

/** A before or after value as the screen shows it: text, or null. */
function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Settings → Audit log (spec "AuditEntry"): the company's append-only audit_log as the screen
 * reads it, newest first, with the actor's name from the control database. Entries are passed
 * through the sensitive-field stripping like every company response, and pay-sensitive entries
 * (commission plan terms; commission adjustment, reversal decision, bonus and pay-run exclusion
 * reasons) keep their row but hide their before and after unless the viewer may read that entry
 * (`payAuditDetailsVisible`): the Owner always; a holder of the pay view_sensitive key only for
 * people inside their data scope, and only with company-wide scope for an entry about no single
 * person (owner decisions 2026-11-14 and 2026-11-15; ADR 0048 "Audit visibility"). The screen's CSV
 * export is built from this answer, so it hides the same.
 */
@Injectable()
export class AuditLogService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
  ) {}

  /**
   * The newest entries of the company's audit log. Before and after values are stripped of
   * sensitive fields the viewer may not see before they become text, because the response
   * interceptor cannot look inside a string (CLAUDE.md rule 5; PR #11 security review). Pay-sensitive
   * entries are then redacted, each by whom it is about (`redactPayAudit`).
   */
  async list(
    tenant: TenantContext,
    access: Pick<RequestAccess, "isOwner" | "permissions" | "dataScope" | "userId">,
  ): Promise<AuditEntry[]> {
    const held = access.permissions;
    const db = await this.tenancy.db(tenant);
    const rows = await db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(AUDIT_PAGE);
    const unscoped: ScopedPayAuditViewer = {
      isOwner: access.isOwner,
      permissions: held,
      dataScope: access.dataScope,
      employeeId: null,
    };
    // Whom each entry is about matters only to a pay viewer who can't read company-wide entries
    // (the strictest subject): anyone else reads all of them or none. Only then is the viewer's own
    // employee looked up, for their HR person scope (hr.md "Data scope").
    const scoped = canSeePayAudit(unscoped) && !payAuditDetailsVisible(unscoped, COMPANY_SUBJECT);
    const viewer = scoped ? { ...unscoped, employeeId: await viewerEmployeeId(db, access.userId) } : unscoped;
    const subjects = scoped ? await loadPayAuditSubjects(db, rows) : new Map<string, PayAuditSubject>();
    const actorIds = [...new Set(rows.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])))];
    const names =
      actorIds.length === 0
        ? []
        : await this.control.db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, actorIds));
    return rows.map((row) =>
      redactPayAudit(
        {
          id: row.id,
          at: row.at.toISOString(),
          actorName: names.find((name) => name.id === row.actorUserId)?.name ?? "Platform admin",
          actorRole: row.actorRole || "Super-admin",
          category: row.category,
          action: row.action,
          target: row.targetLabel || row.targetType,
          before: asText(stripSensitive(row.before, held)),
          after: asText(stripSensitive(row.after, held)),
        },
        payAuditDetailsVisible(viewer, subjects.get(row.id) ?? COMPANY_SUBJECT),
      ),
    );
  }
}
