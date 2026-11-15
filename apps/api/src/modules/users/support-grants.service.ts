import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { platformAuditLog, supportAccessGrants, user } from "@workspace/db/control";
import {
  SUPPORT_CLOSED_MESSAGES,
  SUPPORT_OWNER_ONLY_MESSAGE,
  supportGrantStatus,
  type CompanySupportGrant,
} from "@workspace/shared";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { AuditService } from "../../core/access/audit";
import { StepUpService } from "../../core/auth/step-up.service";
import { CONTROL_DB } from "../../core/database/control-db";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import type { Actor } from "../../core/access/request-actor";

/**
 * A support grant as an Owner sees it: the shared `CompanySupportGrant`, which the web's Support
 * access panel reads too (docs/specs/platform-admin.md, part 4). `status` is derived by the shared
 * `supportGrantStatus`, the same rule as the platform console's list.
 */
export type SupportGrantView = CompanySupportGrant;

/**
 * Read-only, time-limited support access, approved by the company's Owner (blueprint role rule 6;
 * draft spec "Support access"). A platform admin asks (SupportRequestsService, modules/platform);
 * an Owner approves with a step-up or revokes here. Both are writes, so TenantGuard refuses them
 * while the company is read only (403 `company_read_only`; ADR 0054, owner question 26). Approvals
 * and revocations go to platform_audit_log and the company's audit_log. Using a grant to open the
 * company waits for the owner (docs/specs/platform-admin.md, owner question 2); until then a grant
 * opens nothing.
 */
@Injectable()
export class SupportGrantsService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly auditLog: AuditService,
    private readonly stepUp: StepUpService,
  ) {}

  /** The company's grants, newest first, for its Owners. */
  async list(tenant: TenantContext, actor: Actor): Promise<SupportGrantView[]> {
    assertOwner(actor);
    const rows = await this.control.db
      .select({ grant: supportAccessGrants, adminName: user.name })
      .from(supportAccessGrants)
      .innerJoin(user, eq(user.id, supportAccessGrants.adminUserId))
      .where(and(eq(supportAccessGrants.tenantId, tenant.companyId), isNull(supportAccessGrants.deletedAt)))
      .orderBy(desc(supportAccessGrants.createdAt))
      .limit(100);
    const now = new Date();
    return rows.map(({ grant, adminName }) => ({
      id: grant.id,
      adminName,
      reason: grant.reason,
      requestedAt: grant.createdAt.toISOString(),
      expiresAt: grant.expiresAt.toISOString(),
      status: supportGrantStatus(grant, now),
    }));
  }

  /** An Owner approves a pending, unexpired grant, after a step-up. */
  async approve(tenant: TenantContext, actor: Actor, grantId: string): Promise<void> {
    assertOwner(actor);
    await this.stepUp.require(actor.session);
    await this.change(tenant, actor, grantId, "approve");
  }

  /** An Owner ends a pending or approved grant, with no step-up. */
  async revoke(tenant: TenantContext, actor: Actor, grantId: string): Promise<void> {
    assertOwner(actor);
    await this.change(tenant, actor, grantId, "revoke");
  }

  private async change(tenant: TenantContext, actor: Actor, grantId: string, step: "approve" | "revoke") {
    const now = new Date();
    const open = and(
      eq(supportAccessGrants.id, grantId),
      eq(supportAccessGrants.tenantId, tenant.companyId),
      isNull(supportAccessGrants.revokedAt),
      isNull(supportAccessGrants.deletedAt),
      gt(supportAccessGrants.expiresAt, now),
    );
    const [changed] = await this.control.db.transaction(async (tx) => {
      const rows = await tx
        .update(supportAccessGrants)
        .set(step === "approve" ? { approvedBy: actor.access.userId, approvedAt: now } : { revokedAt: now })
        .where(step === "approve" ? and(open, isNull(supportAccessGrants.approvedAt)) : open)
        .returning({ id: supportAccessGrants.id });
      if (rows.length > 0) {
        await tx.insert(platformAuditLog).values({
          actorUserId: actor.access.userId,
          tenantId: tenant.companyId,
          action: step === "approve" ? "support.approved" : "support.revoked",
          targetType: "support_access_grant",
          targetId: grantId,
        });
      }
      return rows;
    });
    if (!changed) {
      throw new ConflictException({ code: "grant_closed", message: SUPPORT_CLOSED_MESSAGES[step] });
    }
    await this.auditLog.record(tenant, actor.audit, {
      category: "security",
      action: step === "approve" ? "Approved support access" : "Revoked support access",
      targetType: "support_access_grant",
      targetId: grantId,
    });
  }
}

/** Only the company's Owner role approves, lists or revokes support access (blueprint role rule 6). */
function assertOwner(actor: Actor): void {
  if (!actor.access.isOwner) {
    throw new ForbiddenException({ code: "forbidden", message: SUPPORT_OWNER_ONLY_MESSAGE });
  }
}
