import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnprocessableEntityException,
  type HttpException,
} from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { tenantSubscriptions, tenants } from "@workspace/db/control";
import {
  COMPANY_STATUS_AUDIT_ACTIONS,
  companyStatusAuditBody,
  companyStatusView,
  confirmNameProblem,
  PLATFORM_DEFAULT_WRITE_ROLES,
  STATUS_ACTION_MESSAGES,
  staleStatusRefusal,
  statusAfter,
  type CompanyStatusAction,
  type LifecycleSubscription,
  type PlatformCompany,
  type PlatformCompanyStatus,
  type StatusActionRefusal,
} from "@workspace/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { CONTROL_DB } from "../../core/database/control-db";
import { lockActingAdmin } from "./admin-lock";
import type { PlatformActor } from "./platform-admin.guard";
import { PlatformAuditService } from "./platform-audit.service";
import { companyNotFound, PlatformCompaniesService } from "./platform-companies.service";

/** A status action's body as the controller's schema and `statusActionBodyProblem` let it through. */
export interface StatusActionBody {
  /** The status text the admin saw in the preview. */
  expectedStatus: string;
  reason: string;
  /** Cancel only: the company's name, typed. */
  confirmName?: string;
}

/** The API answer for a refusal of the shared status rule: 409 `conflict` or 422 `rule_broken`. */
function refusal(refused: StatusActionRefusal): HttpException {
  const body = { code: refused.code, message: refused.message };
  return refused.status === 409 ? new ConflictException(body) : new UnprocessableEntityException(body);
}

/** The 409 for a status that changed after the admin read it (spec part 2, "Stale status"). */
function changedMeanwhile(): HttpException {
  return new ConflictException({ code: "conflict", message: STATUS_ACTION_MESSAGES.changedMeanwhile });
}

/**
 * `now()`, the database's transaction time: the moment the `tenants_status_changed` trigger stamps
 * (control migration 0003). Read as `status_changed_at` is read, so the two compare alike.
 */
const TRANSACTION_NOW = sql<Date>`now()`.mapWith(tenants.statusChangedAt);

/**
 * Every subscription row of the company, deleted ones included, with the columns TenantDirectory
 * reads for the life-cycle phase (status, period end, price, deletion), so the status rule and the
 * guards read the same facts. The price only tells a paid row from a trial and never leaves.
 */
async function lifecycleRowsOf(tx: ControlDb, companyId: string): Promise<LifecycleSubscription[]> {
  const rows = await tx
    .select({
      status: tenantSubscriptions.status,
      currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
      price: tenantSubscriptions.price,
      deletedAt: tenantSubscriptions.deletedAt,
    })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, companyId));
  return rows.map(({ deletedAt, ...row }) => ({ ...row, deleted: deletedAt !== null }));
}

/**
 * Suspend, reinstate and cancel a company from the console, and the status preview
 * (docs/specs/platform-admin.md, part 2, "Company status"; ADR 0056). PlatformAdminGuard has
 * already checked the switches, the admin, the owner role and, for an action, a fresh step-up; the
 * controller has checked the body. The shared `statusAfter` decides, at the database's time, from
 * every subscription row, deleted ones included, exactly as TenantDirectory reads them.
 * - An action writes `tenants.status` and `updated_at` only (the trigger stamps `status_changed_at`)
 *   and one `platform_audit_log` row, in one control transaction. No subscription row, override,
 *   ceiling, product, member, session or database row changes: cancel deletes nothing, and
 *   reinstate undoes it. A refusal writes nothing.
 * - The company is named by `:id` for control rows only. No company database is opened and the
 *   company's own audit_log is not written: reaching it needs a TenantContext from the verified
 *   session (CLAUDE.md rule 2), and lint keeps tenancy out of this module (owner question 42).
 */
@Injectable()
export class CompanyStatusService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly audit: PlatformAuditService,
    private readonly companies: PlatformCompaniesService,
  ) {}

  /**
   * The status preview (spec "GET /platform/companies/:id/status"): the stored status as it is, the
   * phase and dates now, and what each action would do or why it is refused, at the database's
   * time. One read-only transaction, so the company row, its subscription rows and `now()` are one
   * snapshot; nothing is locked or written. 404 for an unknown or deleted company.
   */
  async preview(companyId: string): Promise<PlatformCompanyStatus> {
    return this.control.db.transaction(
      async (tx) => {
        const [company] = await tx
          .select({ status: tenants.status, statusChangedAt: tenants.statusChangedAt, now: TRANSACTION_NOW })
          .from(tenants)
          .where(and(eq(tenants.id, companyId), isNull(tenants.deletedAt)));
        if (!company) throw companyNotFound();
        const subscriptions = await lifecycleRowsOf(tx, companyId);
        return companyStatusView(companyId, company.status, {
          statusChangedAt: company.statusChangedAt,
          subscriptions,
          now: company.now,
        });
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  /**
   * Suspends, reinstates or cancels a company (spec "POST /platform/companies/:id/suspend, /reinstate
   * and /cancel", One control transaction):
   * - lock and re-check the acting admin's own row (403);
   * - lock the company row (404), so parallel actions on one company run one after the other, and
   *   read `now()` with it: the transaction's start, which the trigger will stamp;
   * - cancel: the typed name against the locked row's name (400);
   * - the stale check (409): the status the admin saw must still be stored, and no later change may
   *   have won the race. The shared check compares milliseconds; the database also compares the
   *   microseconds it stores, so a change inside the same millisecond is caught too;
   * - every subscription row, deleted ones included, then `statusAfter` (409 or 422);
   * - the update, only while the status is still the one read (409 otherwise; the lock makes it
   *   unreachable);
   * - one `company.suspended`, `.reinstated` or `.cancelled` row with the trimmed reason.
   * After the commit, the company's detail read again: its phase comes from TenantDirectory, so the
   * answer shows exactly what the guards now enforce.
   */
  async act(
    actor: PlatformActor,
    companyId: string,
    action: CompanyStatusAction,
    body: StatusActionBody,
  ): Promise<PlatformCompany> {
    await this.control.db.transaction(async (tx) => {
      await lockActingAdmin(tx, actor.userId, PLATFORM_DEFAULT_WRITE_ROLES);
      const [company] = await tx
        .select({
          name: tenants.name,
          status: tenants.status,
          statusChangedAt: tenants.statusChangedAt,
          now: TRANSACTION_NOW,
          changedSinceStart: sql<boolean>`${tenants.statusChangedAt} > now()`,
        })
        .from(tenants)
        .where(and(eq(tenants.id, companyId), isNull(tenants.deletedAt)))
        .for("update");
      if (!company) throw companyNotFound();
      if (action === "cancel") {
        const nameProblem = confirmNameProblem(body, company.name);
        if (nameProblem) throw new BadRequestException({ code: "invalid_request", message: nameProblem });
      }
      const { now } = company;
      const stale = staleStatusRefusal(body.expectedStatus, company.status, company.statusChangedAt, now);
      if (stale) throw refusal(stale);
      if (company.changedSinceStart === true) throw changedMeanwhile();
      const subscriptions = await lifecycleRowsOf(tx, companyId);
      const result = statusAfter(action, company.status, {
        statusChangedAt: company.statusChangedAt,
        subscriptions,
        now,
      });
      if (!result.ok) throw refusal(result.refusal);
      const [updated] = await tx
        .update(tenants)
        .set({ status: result.status, updatedAt: now })
        .where(and(eq(tenants.id, companyId), eq(tenants.status, company.status)))
        .returning({ statusChangedAt: tenants.statusChangedAt });
      if (!updated) throw changedMeanwhile();
      await this.audit.record(tx, actor, {
        action: COMPANY_STATUS_AUDIT_ACTIONS[action],
        tenantId: companyId,
        targetType: "tenant",
        targetId: companyId,
        ...companyStatusAuditBody(
          { status: company.status, statusChangedAt: company.statusChangedAt },
          { status: result.status, statusChangedAt: updated.statusChangedAt },
          body.reason,
        ),
      });
    });
    return this.companies.detail(companyId);
  }
}
