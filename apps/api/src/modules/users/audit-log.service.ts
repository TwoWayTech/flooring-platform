import { Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { auditLog } from "@workspace/db/company";
import { user } from "@workspace/db/control";
import type { AuditEntry } from "@workspace/shared";
import { desc, inArray } from "drizzle-orm";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";

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
 * through the sensitive-field stripping like every company response.
 */
@Injectable()
export class AuditLogService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
  ) {}

  /** The newest entries of the company's audit log. */
  async list(tenant: TenantContext): Promise<AuditEntry[]> {
    const db = await this.tenancy.db(tenant);
    const rows = await db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(AUDIT_PAGE);
    const actorIds = [...new Set(rows.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])))];
    const names =
      actorIds.length === 0
        ? []
        : await this.control.db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, actorIds));
    return rows.map((row) => ({
      id: row.id,
      at: row.at.toISOString().slice(0, 16),
      actorName: names.find((name) => name.id === row.actorUserId)?.name ?? "Platform admin",
      actorRole: row.actorRole || "Super-admin",
      category: row.category,
      action: row.action,
      target: row.targetLabel || row.targetType,
      before: asText(row.before),
      after: asText(row.after),
    }));
  }
}
