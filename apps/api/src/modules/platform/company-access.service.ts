import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
  type HttpException,
} from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import {
  tenantModuleOverrides,
  tenantPermissionCeiling,
  tenantSubscriptions,
  tenants,
  type TenantStatus,
} from "@workspace/db/control";
import {
  accessDiff,
  accessPatchProblem,
  ceilingRowsFor,
  isModuleKey,
  isPermissionKey,
  limitOverrideFor,
  moduleOverridesFor,
  type AccessPatchInput,
  type AccessPatchProblem,
  type AccessState,
  type ModuleKey,
  type ModuleOverrideChange,
  type PermissionKey,
  type PlatformCompany,
  type ProductKey,
} from "@workspace/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { AccessService } from "../../core/access/access.service";
import { PlanLimits, type SubscriptionLimitRow } from "../../core/access/plan-limits";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantDirectory } from "../../core/tenancy/tenant-directory";
import type { PlatformActor } from "./platform-admin.guard";
import { PlatformAuditService } from "./platform-audit.service";
import { companyNotFound, PlatformCompaniesService } from "./platform-companies.service";

/** One subscription row's limit overrides as a save wrote them, for the audit row. */
interface LimitRowChange {
  subscriptionId: string;
  userLimitOverride: number | null;
  branchLimitOverride: number | null;
}

/** The API answer for a refusal from `accessPatchProblem`: 400 `invalid_request` or 422 `rule_broken`. */
function refusal(problem: AccessPatchProblem): HttpException {
  return problem.status === 400
    ? new BadRequestException({ code: "invalid_request", message: problem.message })
    : new UnprocessableEntityException({ code: "rule_broken", message: problem.message });
}

/**
 * "Change company access" on the API (product spec settings-and-permissions.md; docs/specs/
 * platform-admin.md, "Validations" and "What a save does"; blueprint p4 layers 2 and 3, role rule
 * 3). A save is one control transaction that locks the company row first, so saves for one company
 * run one at a time, checks the patch with the same shared rule as the demo store, writes only the
 * rows that change, and adds one `company.access_changed` row to `platform_audit_log` when any row
 * was written. Guards read modules, the ceiling and limits on every request with no cache, so a
 * change applies to the company's next request. No company database is read or written: the
 * company's own audit_log gets nothing (owner question 4; ADR 0052).
 */
@Injectable()
export class CompanyAccessService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly directory: TenantDirectory,
    private readonly access: AccessService,
    private readonly limits: PlanLimits,
    private readonly audit: PlatformAuditService,
    private readonly companies: PlatformCompaniesService,
  ) {}

  /** Applies a change of access and answers with the company read again. */
  async change(actor: PlatformActor, companyId: string, patch: AccessPatchInput): Promise<PlatformCompany> {
    // Products are set at provisioning and nothing in the console changes them.
    const company = await this.directory.access(companyId);
    if (!company) throw companyNotFound();
    await this.control.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ status: tenants.status })
        .from(tenants)
        .where(and(eq(tenants.id, companyId), isNull(tenants.deletedAt)))
        .for("update");
      if (!locked) throw companyNotFound();
      const limitRows = await this.limits.rowsOf(companyId, tx);
      const problem = accessPatchProblem({ products: company.products, hasSubscription: limitRows.length > 0 }, patch);
      if (problem) throw refusal(problem);
      const before = await this.stateOf(tx, companyId, locked.status, company.products);
      const now = new Date();
      const overrideRows =
        patch.modules === undefined
          ? []
          : await this.writeModules(tx, actor, companyId, locked.status, company.products, patch.modules, now);
      if (patch.ceiling !== undefined)
        await this.writeCeiling(tx, actor, companyId, company.products, patch.ceiling, now);
      const limitChanges = await this.writeLimits(tx, limitRows, patch, now);
      const diff = accessDiff(before, await this.stateOf(tx, companyId, locked.status, company.products));
      // A save can write a row without changing effective access (an override set back to what the
      // plan gives, a limit pinned on a cancelled row), so the audit row lists the written rows too.
      if (diff === null && overrideRows.length === 0 && limitChanges.length === 0) return;
      await this.audit.record(tx, actor, {
        action: "company.access_changed",
        tenantId: companyId,
        targetType: "tenant",
        targetId: companyId,
        before: diff?.before ?? {},
        after: {
          ...diff?.after,
          ...(overrideRows.length > 0 ? { overrideRows } : {}),
          ...(limitChanges.length > 0 ? { limitRows: limitChanges } : {}),
        },
      });
    });
    return this.companies.detail(companyId);
  }

  /** The company's effective access as the guards read it, inside the save's transaction. */
  private async stateOf(
    tx: ControlDb,
    companyId: string,
    status: TenantStatus,
    products: readonly ProductKey[],
  ): Promise<AccessState> {
    return {
      modules: await this.access.companyModules(companyId, status, products, tx),
      ceiling: await this.access.companyCeiling(companyId, tx),
      ...(await this.limits.limitsOf(companyId, tx)),
    };
  }

  /**
   * Module overrides (spec "What a save does", Modules; ADR 0031): an override only where the
   * choice differs from the plan, and a stored one soft-deleted when the choice is back to what the
   * plan gives, so an old "off" never outlives a change back (review A3). The unique index ignores
   * `deleted_at`, so a write clears it. Hidden modules and `platform` keep their stored rows.
   */
  private async writeModules(
    tx: ControlDb,
    actor: PlatformActor,
    companyId: string,
    status: TenantStatus,
    products: readonly ProductKey[],
    requested: readonly string[],
    now: Date,
  ): Promise<ModuleOverrideChange[]> {
    const wanted: ModuleKey[] = requested.filter(isModuleKey);
    const plan = await this.access.companyPlanModules(companyId, status, tx);
    const stored = await this.access.companyModuleOverrides(companyId, tx);
    const changes = moduleOverridesFor(products, plan, stored, wanted);
    for (const change of changes) {
      if (change.action === "write") {
        await tx
          .insert(tenantModuleOverrides)
          .values({ tenantId: companyId, module: change.module, enabled: change.enabled, createdBy: actor.userId })
          .onConflictDoUpdate({
            target: [tenantModuleOverrides.tenantId, tenantModuleOverrides.module],
            set: { enabled: change.enabled, deletedAt: null, updatedAt: now },
          });
      } else {
        await tx
          .update(tenantModuleOverrides)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(tenantModuleOverrides.tenantId, companyId),
              eq(tenantModuleOverrides.module, change.module),
              isNull(tenantModuleOverrides.deletedAt),
            ),
          );
      }
    }
    return changes;
  }

  /**
   * Ceiling rows (spec "What a save does", Ceiling; blueprint role rule 3): only the keys whose
   * allowed value changes, among the keys of the offered, visible modules. Roles keep their ticks,
   * so an unticked key is inactive until it is ticked again. The unique index ignores `deleted_at`,
   * so a write clears it.
   */
  private async writeCeiling(
    tx: ControlDb,
    actor: PlatformActor,
    companyId: string,
    products: readonly ProductKey[],
    requested: readonly string[],
    now: Date,
  ): Promise<void> {
    const wanted: PermissionKey[] = requested.filter(isPermissionKey);
    const rows = ceilingRowsFor(products, await this.access.companyCeiling(companyId, tx), wanted);
    if (rows.length === 0) return;
    await tx
      .insert(tenantPermissionCeiling)
      .values(
        rows.map((row) => ({
          tenantId: companyId,
          permissionKey: row.key,
          allowed: row.allowed,
          createdBy: actor.userId,
        })),
      )
      .onConflictDoUpdate({
        target: [tenantPermissionCeiling.tenantId, tenantPermissionCeiling.permissionKey],
        set: { allowed: sql`excluded.allowed`, deletedAt: null, updatedAt: now },
      });
  }

  /**
   * Limits (spec "What a save does", Limits; review A2): written to every subscription row that is
   * not deleted, cancelled ones included, because the company's limit is the largest across those
   * rows. The rows come from `PlanLimits.rowsOf`, the same rows `limitsOf` reads. A row whose plan
   * already gives the number gets null, so an unchanged save pins nothing. No row is ever created:
   * `accessPatchProblem` refuses limits with none (422).
   */
  private async writeLimits(
    tx: ControlDb,
    rows: readonly SubscriptionLimitRow[],
    patch: AccessPatchInput,
    now: Date,
  ): Promise<LimitRowChange[]> {
    const changes: LimitRowChange[] = [];
    for (const row of rows) {
      const change: LimitRowChange = {
        subscriptionId: row.id,
        userLimitOverride:
          patch.userLimit === undefined ? row.userLimitOverride : limitOverrideFor(row.maxUsers, patch.userLimit),
        branchLimitOverride:
          patch.branchLimit === undefined
            ? row.branchLimitOverride
            : limitOverrideFor(row.maxBranches, patch.branchLimit),
      };
      if (
        change.userLimitOverride === row.userLimitOverride &&
        change.branchLimitOverride === row.branchLimitOverride
      ) {
        continue;
      }
      await tx
        .update(tenantSubscriptions)
        .set({
          userLimitOverride: change.userLimitOverride,
          branchLimitOverride: change.branchLimitOverride,
          updatedAt: now,
        })
        .where(eq(tenantSubscriptions.id, row.id));
      changes.push(change);
    }
    return changes;
  }
}
