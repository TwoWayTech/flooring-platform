import { Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { rolePermissions, roles, userProfiles, userRoles } from "@workspace/db/company";
import {
  planModules,
  tenantModuleOverrides,
  tenantPermissionCeiling,
  tenantSubscriptions,
  type TenantStatus,
} from "@workspace/db/control";
import {
  enabledModules,
  planModulesOf,
  resolveAccess,
  roleRequiresMfa,
  type DataScope,
  type ModuleKey,
  type ModuleOverride,
  type PermissionKey,
  type PlanModules,
  type ProductKey,
  type RoleLike,
} from "@workspace/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { CONTROL_DB } from "../database/control-db";
import { TenantConnectionService } from "../tenancy/tenant-connection.service";
import type { TenantContext } from "../tenancy/tenant-context";

/** What a signed-in person may do in the open company, as the guards and handlers see it. */
export interface RequestAccess {
  /** Effective permissions = role permissions ∩ company ceiling ∩ enabled modules (CLAUDE.md rule 4). */
  permissions: ReadonlySet<PermissionKey>;
  modules: readonly ModuleKey[];
  /** The company's permission ceiling, for the no-escalation rules (spec rule 11). */
  ceiling: readonly PermissionKey[];
  /** The widest data scope across the person's roles. */
  dataScope: DataScope;
  isOwner: boolean;
  userId: string;
  /** The person's branch in this company, for `branch` data scope; null when they have none. */
  branchId: string | null;
  /** The names of the person's roles, as audit entries record them. */
  roleNames: readonly string[];
  /** Whether the person's profile in this company is disabled; a disabled person holds nothing. */
  disabled: boolean;
  /**
   * Whether any role the person holds needs MFA by content (packages/shared `roleRequiresMfa`).
   * PermissionGuard checks it on every request, as a backstop for `member.role` (PR #11 review).
   */
  mfaRequired: boolean;
}

/** What a person holds in the company, as `rolesOf` reads it for the shared engine. */
interface HeldRoles {
  roles: RoleLike[];
  names: string[];
  branchId: string | null;
  disabled: boolean;
}

/**
 * Works out a person's access in their open company with the shared engine (`resolveAccess` in
 * packages/shared, spec rules 1 to 3): their roles and role permissions from the company
 * database, the ceiling and the modules from the control database. Nothing is cached between
 * requests, so a change to roles, the ceiling or modules applies to the next request.
 */
@Injectable()
export class AccessService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
  ) {}

  /** The access of the request's person in the request's company. */
  async resolve(tenant: TenantContext): Promise<RequestAccess> {
    const [held, ceiling, modules] = await Promise.all([
      this.rolesOf(tenant, [tenant.userId]),
      this.companyCeiling(tenant.companyId),
      this.modulesOf(tenant),
    ]);
    return this.accessOf(tenant.userId, held.get(tenant.userId)!, ceiling, modules);
  }

  /**
   * The effective access of other members of the request's company, by the same engine, for
   * choosing who is told about a record (HR notifications to approvers; security review of PR #25).
   * It never authorises the request itself: that is `resolve` in PermissionGuard. Everyone's roles
   * are read in three company queries whatever their number, so a list of members never queues a
   * few queries per person on the company's small pool (final review of PR #33).
   */
  async membersAccess(tenant: TenantContext, userIds: readonly string[]): Promise<RequestAccess[]> {
    if (userIds.length === 0) return [];
    const [held, ceiling, modules] = await Promise.all([
      this.rolesOf(tenant, userIds),
      this.companyCeiling(tenant.companyId),
      this.modulesOf(tenant),
    ]);
    return userIds.map((userId) => this.accessOf(userId, held.get(userId)!, ceiling, modules));
  }

  private accessOf(userId: string, held: HeldRoles, ceiling: PermissionKey[], modules: ModuleKey[]): RequestAccess {
    const access = resolveAccess(held.roles, held.disabled ? [] : ceiling, modules);
    return {
      permissions: access.permissions,
      modules,
      ceiling,
      dataScope: access.dataScope,
      isOwner: access.isOwner && !held.disabled,
      userId,
      branchId: held.branchId,
      roleNames: held.names,
      disabled: held.disabled,
      mfaRequired: !held.disabled && held.roles.some(roleRequiresMfa),
    };
  }

  /**
   * Each person's roles with their permissions, role names, branch and status in the request's
   * company, in three queries for any number of people, keyed by user id; every id asked for is in it.
   */
  private async rolesOf(tenant: TenantContext, userIds: readonly string[]): Promise<Map<string, HeldRoles>> {
    const db = await this.tenancy.db(tenant);
    const ids = [...new Set(userIds)];
    const profiles = await db
      .select({ userId: userProfiles.userId, branchId: userProfiles.branchId, status: userProfiles.status })
      .from(userProfiles)
      .where(and(inArray(userProfiles.userId, ids), isNull(userProfiles.deletedAt)));
    const roleRows = await db
      .select({
        userId: userRoles.userId,
        id: roles.id,
        name: roles.name,
        dataScope: roles.dataScope,
        owner: roles.owner,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(inArray(userRoles.userId, ids), isNull(userRoles.deletedAt), isNull(roles.deletedAt)));
    const roleIds = [...new Set(roleRows.map((role) => role.id))];
    const keys =
      roleIds.length === 0
        ? []
        : await db
            .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
            .from(rolePermissions)
            .where(and(inArray(rolePermissions.roleId, roleIds), isNull(rolePermissions.deletedAt)));
    return new Map(
      ids.map((userId) => {
        const profile = profiles.find((row) => row.userId === userId);
        const mine = roleRows.filter((role) => role.userId === userId);
        const held: HeldRoles = {
          roles: mine.map((role) => ({
            id: role.id,
            dataScope: role.dataScope,
            owner: role.owner,
            permissions: keys.filter((row) => row.roleId === role.id).map((row) => row.key as PermissionKey),
          })),
          names: mine.map((role) => role.name),
          branchId: profile?.branchId ?? null,
          // No profile means the person was never set up in this company, which counts as disabled.
          disabled: !profile || profile.status === "disabled",
        };
        return [userId, held];
      }),
    );
  }

  /**
   * The company's permission ceiling: its allowed keys (blueprint role rule 3). Public, with an
   * optional `db` for a caller's own control transaction, so the platform console shows and diffs
   * exactly what the guards enforce (docs/specs/platform-admin.md). Control database only.
   */
  async companyCeiling(companyId: string, db: ControlDb = this.control.db): Promise<PermissionKey[]> {
    const rows = await db
      .select({ key: tenantPermissionCeiling.permissionKey })
      .from(tenantPermissionCeiling)
      .where(
        and(
          eq(tenantPermissionCeiling.tenantId, companyId),
          eq(tenantPermissionCeiling.allowed, true),
          isNull(tenantPermissionCeiling.deletedAt),
        ),
      );
    return rows.map((row) => row.key as PermissionKey);
  }

  /**
   * The plan modules that limit a company (`planModulesOf`; ADR 0031): null for a fresh trial, which
   * gets all of its products' modules. Public for the platform console, like `companyCeiling`.
   */
  async companyPlanModules(
    companyId: string,
    status: TenantStatus,
    db: ControlDb = this.control.db,
  ): Promise<PlanModules> {
    const allSubscriptions = await db
      .select({
        planId: tenantSubscriptions.planId,
        status: tenantSubscriptions.status,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
        deletedAt: tenantSubscriptions.deletedAt,
      })
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, companyId));
    // Soft-deleted rows still prove the company once had a subscription, so soft-deleting them
    // never makes it a fresh trial again (PR #8 review); only live rows give plan modules. Rows are
    // never hard-deleted (CLAUDE.md rule 8, deleted_at on business tables).
    const freshTrial = status === "trial" && allSubscriptions.length === 0;
    const subscriptions = allSubscriptions.filter((subscription) => subscription.deletedAt === null);
    const planIds = [...new Set(subscriptions.map((subscription) => subscription.planId))];
    const moduleRows =
      planIds.length === 0
        ? []
        : await db
            .select({ planId: planModules.planId, module: planModules.module })
            .from(planModules)
            .where(and(inArray(planModules.planId, planIds), isNull(planModules.deletedAt)));
    return planModulesOf(
      subscriptions.map((subscription) => ({
        ...subscription,
        modules: moduleRows.filter((row) => row.planId === subscription.planId).map((row) => row.module),
      })),
      freshTrial,
    );
  }

  /** The company's live module overrides (`tenant_module_overrides`). Public for the platform console. */
  async companyModuleOverrides(companyId: string, db: ControlDb = this.control.db): Promise<ModuleOverride[]> {
    return db
      .select({ module: tenantModuleOverrides.module, enabled: tenantModuleOverrides.enabled })
      .from(tenantModuleOverrides)
      .where(and(eq(tenantModuleOverrides.tenantId, companyId), isNull(tenantModuleOverrides.deletedAt)));
  }

  /**
   * The modules switched on for a company (blueprint p4, layer 2): its products, limited by its
   * plan, then its overrides (`enabledModules`). Public for the platform console, which reads it by
   * company id from the control database only; requests go through `resolve` with their context.
   */
  async companyModules(
    companyId: string,
    status: TenantStatus,
    products: readonly ProductKey[],
    db: ControlDb = this.control.db,
  ): Promise<ModuleKey[]> {
    const plan = await this.companyPlanModules(companyId, status, db);
    const overrides = await this.companyModuleOverrides(companyId, db);
    return enabledModules(products, plan, overrides);
  }

  private async modulesOf(tenant: TenantContext): Promise<ModuleKey[]> {
    return this.companyModules(tenant.companyId, tenant.status, tenant.products);
  }
}
