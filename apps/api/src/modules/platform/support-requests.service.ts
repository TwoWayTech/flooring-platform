import { Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { supportAccessGrants, tenants } from "@workspace/db/control";
import { and, eq, isNull } from "drizzle-orm";
import { CONTROL_DB } from "../../core/database/control-db";
import type { PlatformActor } from "./platform-admin.guard";
import { PlatformAuditService } from "./platform-audit.service";
import { companyNotFound } from "./platform-companies.service";

/** The longest support access a platform admin may ask for (draft spec settings-users-access.md, "Support access"). */
export const MAX_SUPPORT_HOURS = 72;

/**
 * The platform side of support access (blueprint role rule 6; ADR 0034): a platform admin asks a
 * company's Owner for read-only access, for a reason and up to 72 hours. PlatformAdminGuard has
 * already checked the admin, their role and a fresh step-up (docs/specs/platform-admin.md). The
 * Owner approves or revokes in Settings (SupportGrantsService). A grant still opens nothing: using
 * one waits for the owner (owner question 2).
 */
@Injectable()
export class SupportRequestsService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly audit: PlatformAuditService,
  ) {}

  /** Records a pending grant and its `support.requested` audit row in one control transaction. */
  async request(actor: PlatformActor, companyId: string, reason: string, hours: number): Promise<{ id: string }> {
    return this.control.db.transaction(async (tx) => {
      const [company] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.id, companyId), isNull(tenants.deletedAt)));
      if (!company) throw companyNotFound();
      const expiresAt = new Date(Date.now() + Math.min(hours, MAX_SUPPORT_HOURS) * 3_600_000);
      const [grant] = await tx
        .insert(supportAccessGrants)
        .values({ tenantId: companyId, adminUserId: actor.userId, reason, expiresAt, createdBy: actor.userId })
        .returning({ id: supportAccessGrants.id });
      await this.audit.record(tx, actor, {
        action: "support.requested",
        tenantId: companyId,
        targetType: "support_access_grant",
        targetId: grant.id,
        after: { reason, expiresAt: expiresAt.toISOString() },
      });
      return { id: grant.id };
    });
  }
}
