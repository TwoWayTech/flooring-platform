import { Injectable } from "@nestjs/common";
import type { ControlDb } from "@workspace/db";
import { platformAuditLog } from "@workspace/db/control";
import { sql } from "drizzle-orm";
import type { PlatformActor } from "./platform-admin.guard";

/** One platform audit row, as a platform service describes it. */
export interface PlatformAuditEntry {
  /** `object.verb`, such as `company.access_changed`. */
  action: string;
  /** The company the action is about, or null for one about the platform itself. */
  tenantId: string | null;
  targetType: string;
  targetId: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Writes `platform_audit_log`, the append-only record of what the platform team does (blueprint
 * p28; docs/specs/platform-admin.md, "Audit"). Every /platform write records who, the company,
 * the address and the device, in the same control transaction as the change. The AuditInterceptor
 * skips session-only routes, so platform services call this themselves. Reads are not audited:
 * part 1 reads no company data.
 */
@Injectable()
export class PlatformAuditService {
  /**
   * Appends one row inside the caller's control transaction. It is stamped by the database clock at
   * the insert, so a save that waited on the company row lock is stamped after the one that held it.
   */
  async record(tx: ControlDb, actor: PlatformActor, entry: PlatformAuditEntry): Promise<void> {
    await tx.insert(platformAuditLog).values({
      at: sql`clock_timestamp()`,
      actorUserId: actor.userId,
      createdBy: actor.userId,
      tenantId: entry.tenantId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
  }
}
