import { ConflictException, HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { supportAccessGrants, tenants, user } from "@workspace/db/control";
import {
  FORMER_ADMIN_NAME,
  PLATFORM_ADMIN_ROLES,
  seesAllSupportGrants,
  seesSupportReason,
  supportGrantExpiresAt,
  supportGrantStatus,
  supportRequestFacts,
  supportRequestRefusal,
  supportWindowStart,
  type PlatformSupportGrant,
  type SupportRequestFacts,
  type SupportRequestInput,
  type SupportRequestRefusal,
} from "@workspace/shared";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { CONTROL_DB } from "../../core/database/control-db";
import { lockActingAdmin } from "./admin-lock";
import type { PlatformActor } from "./platform-admin.guard";
import { PlatformAuditService } from "./platform-audit.service";
import { companyNotFound } from "./platform-companies.service";

/** The most support requests `GET /platform/support-grants` answers with (spec "GET /platform/support-grants"). */
const LIST_LIMIT = 100;

/**
 * The platform side of support access (blueprint role rule 6; ADR 0034; docs/specs/platform-admin.md,
 * "Support requests"; ADR 0053). A platform admin asks a company's Owner for read-only access, for
 * a reason and 1 to 72 hours; the Owner approves or revokes in Settings (SupportGrantsService).
 * PlatformAdminGuard has already checked the admin, their role and, for a request, a fresh step-up.
 * - The list: the owner role sees every admin's requests, the support role only its own
 *   (`seesAllSupportGrants`, `seesSupportReason`); `approved_by`, a company user, is never read.
 * - The limits: one open grant per admin and company (409 `grant_open`) and 10 requests per admin
 *   in 24 hours (429 `rate_limited`), checked under a lock on the admin's own `platform_admins`
 *   row, which also re-checks that they are still an admin (403).
 * A grant still opens nothing: using one waits for the owner (owner question 2). Reads are not audited.
 */
@Injectable()
export class SupportRequestsService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly audit: PlatformAuditService,
  ) {}

  /**
   * The support requests the admin may see, newest first, at most 100: grants that are not
   * deleted, for one company when `companyId` is given, and for the support role only its own.
   * The status is derived by the shared `supportGrantStatus`, never stored.
   */
  async list(actor: PlatformActor, companyId?: string): Promise<PlatformSupportGrant[]> {
    const rows = await this.control.db
      .select({
        id: supportAccessGrants.id,
        companyId: supportAccessGrants.tenantId,
        companyName: tenants.name,
        adminUserId: supportAccessGrants.adminUserId,
        adminName: user.name,
        reason: supportAccessGrants.reason,
        createdAt: supportAccessGrants.createdAt,
        expiresAt: supportAccessGrants.expiresAt,
        approvedAt: supportAccessGrants.approvedAt,
        revokedAt: supportAccessGrants.revokedAt,
      })
      .from(supportAccessGrants)
      .innerJoin(tenants, eq(tenants.id, supportAccessGrants.tenantId))
      .leftJoin(user, eq(user.id, supportAccessGrants.adminUserId))
      .where(
        and(
          isNull(supportAccessGrants.deletedAt),
          companyId ? eq(supportAccessGrants.tenantId, companyId) : undefined,
          // Deny by default: unless the role sees every admin's requests, only the caller's own.
          seesAllSupportGrants(actor.role) ? undefined : eq(supportAccessGrants.adminUserId, actor.userId),
        ),
      )
      .orderBy(desc(supportAccessGrants.createdAt), desc(supportAccessGrants.id))
      .limit(LIST_LIMIT);
    const now = new Date();
    return rows
      .filter((row) => seesSupportReason(actor, row.adminUserId))
      .map((row) => ({
        id: row.id,
        company: { id: row.companyId, name: row.companyName },
        admin: { userId: row.adminUserId, name: row.adminName ?? FORMER_ADMIN_NAME },
        mine: row.adminUserId === actor.userId,
        reason: row.reason,
        requestedAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        approvedAt: row.approvedAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        status: supportGrantStatus(row, now),
      }));
  }

  /**
   * Records a pending grant and its `support.requested` audit row in one control transaction
   * under READ COMMITTED (spec "What a request does"): lock and re-check the admin (403), take
   * `now` after the lock, check the company (404), then the limits (409, then 429), insert and
   * audit. A refused request writes nothing and doesn't count toward the window.
   */
  async request(actor: PlatformActor, input: SupportRequestInput): Promise<{ id: string }> {
    return this.control.db.transaction(async (tx) => {
      // Any role the console accepts may ask (`@PlatformWriteRoles("owner", "support")`).
      await lockActingAdmin(tx, actor.userId, PLATFORM_ADMIN_ROLES);
      // After the lock, so a request that waited sees the insert of the one before it.
      const now = new Date();
      const [company] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.id, input.companyId), isNull(tenants.deletedAt)));
      if (!company) throw companyNotFound();
      const refusal = supportRequestRefusal(await requestFacts(tx, actor.userId, input.companyId, now));
      if (refusal) throw refusalOf(refusal);
      const expiresAt = supportGrantExpiresAt(now, input.hours);
      const [grant] = await tx
        .insert(supportAccessGrants)
        .values({
          tenantId: input.companyId,
          adminUserId: actor.userId,
          reason: input.reason,
          createdAt: now,
          expiresAt,
          createdBy: actor.userId,
        })
        .returning({ id: supportAccessGrants.id });
      await this.audit.record(tx, actor, {
        action: "support.requested",
        tenantId: input.companyId,
        targetType: "support_access_grant",
        targetId: grant.id,
        after: { reason: input.reason, expiresAt: expiresAt.toISOString() },
      });
      return { id: grant.id };
    });
  }
}

/**
 * The limit facts for a request (spec "What a request does", step 4): the admin's grants, deleted
 * ones included, that were created in the window or are for this company and not yet expired.
 * The SQL prefilter and the shared count use the same `supportWindowStart`, so they never disagree.
 */
async function requestFacts(tx: ControlDb, userId: string, companyId: string, now: Date): Promise<SupportRequestFacts> {
  const grants = await tx
    .select({
      companyId: supportAccessGrants.tenantId,
      createdAt: supportAccessGrants.createdAt,
      expiresAt: supportAccessGrants.expiresAt,
      revokedAt: supportAccessGrants.revokedAt,
      deletedAt: supportAccessGrants.deletedAt,
    })
    .from(supportAccessGrants)
    .where(
      and(
        eq(supportAccessGrants.adminUserId, userId),
        or(
          gt(supportAccessGrants.createdAt, supportWindowStart(now)),
          and(eq(supportAccessGrants.tenantId, companyId), gt(supportAccessGrants.expiresAt, now)),
        ),
      ),
    );
  return supportRequestFacts(grants, companyId, now);
}

/** The answer for a request the limits refuse: 409 `grant_open` or 429 `rate_limited`. */
function refusalOf(refusal: SupportRequestRefusal): HttpException {
  const body = { code: refusal.code, message: refusal.message };
  return refusal.status === 409 ? new ConflictException(body) : new HttpException(body, HttpStatus.TOO_MANY_REQUESTS);
}
