import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { platformAdmins, platformAuditLog, supportAccessGrants, tenants, user } from "@workspace/db/control";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { AuditService } from "../../core/access/audit";
import type { AuthSession } from "../../core/auth/session.service";
import { StepUpService } from "../../core/auth/step-up.service";
import { CONTROL_DB } from "../../core/database/control-db";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import type { Actor } from "./users.service";

/** The longest support access a platform admin may ask for (draft spec "Support access"). */
export const MAX_SUPPORT_HOURS = 72;

/** A support grant as an Owner sees it. */
export interface SupportGrantView {
  id: string;
  adminName: string;
  reason: string;
  requestedAt: string;
  expiresAt: string;
  status: "pending" | "approved" | "revoked" | "expired";
}

/**
 * Read-only, time-limited support access, approved by the company's Owner (blueprint role rule 6;
 * draft spec "Support access"). A platform admin asks; an Owner approves with a step-up or revokes
 * at any time. Every step goes to platform_audit_log and the company's audit_log. Using a grant to
 * open the company comes with the platform-admin screens (P17); until then a grant opens nothing.
 */
@Injectable()
export class SupportGrantsService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly auditLog: AuditService,
    private readonly stepUp: StepUpService,
  ) {}

  /** A platform admin asks for read-only access to a company for a reason and up to 72 hours. */
  async request(session: AuthSession, companyId: string, reason: string, hours: number): Promise<{ id: string }> {
    const [admin] = await this.control.db
      .select({ id: platformAdmins.id })
      .from(platformAdmins)
      .where(
        and(
          eq(platformAdmins.userId, session.user.id),
          eq(platformAdmins.active, true),
          isNull(platformAdmins.deletedAt),
        ),
      );
    if (!admin)
      throw new ForbiddenException({ code: "forbidden", message: "Only platform admins can ask for support access." });
    const [company] = await this.control.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, companyId), isNull(tenants.deletedAt)));
    if (!company) throw new NotFoundException({ code: "not_found", message: "That company does not exist." });
    const expiresAt = new Date(Date.now() + Math.min(hours, MAX_SUPPORT_HOURS) * 3_600_000);
    return this.control.db.transaction(async (tx) => {
      const [grant] = await tx
        .insert(supportAccessGrants)
        .values({ tenantId: companyId, adminUserId: session.user.id, reason, expiresAt, createdBy: session.user.id })
        .returning({ id: supportAccessGrants.id });
      await tx.insert(platformAuditLog).values({
        actorUserId: session.user.id,
        tenantId: companyId,
        action: "support.requested",
        targetType: "support_access_grant",
        targetId: grant.id,
        after: { reason, expiresAt: expiresAt.toISOString() },
      });
      return { id: grant.id };
    });
  }

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
      status: grant.revokedAt
        ? "revoked"
        : grant.expiresAt <= now
          ? "expired"
          : grant.approvedAt
            ? "approved"
            : "pending",
    }));
  }

  /** An Owner approves a pending, unexpired grant, after a step-up. */
  async approve(tenant: TenantContext, actor: Actor, grantId: string): Promise<void> {
    assertOwner(actor);
    await this.stepUp.require(actor.session);
    await this.change(tenant, actor, grantId, "approve");
  }

  /** An Owner revokes a grant at any time. */
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
      throw new ConflictException({
        code: "grant_closed",
        message:
          step === "approve" ? "This request is no longer waiting for approval." : "This access has already ended.",
      });
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
    throw new ForbiddenException({ code: "forbidden", message: "Only an Owner can manage support access." });
  }
}
