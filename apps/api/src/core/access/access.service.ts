import { Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { rolePermissions, roles, userProfiles, userRoles } from "@workspace/db/company";
import {
  planModules,
  tenantModuleOverrides,
  tenantPermissionCeiling,
  tenantSubscriptions,
} from "@workspace/db/control";
import {
  enabledModules,
  planModulesOf,
  resolveAccess,
  roleRequiresMfa,
  type DataScope,
  type ModuleKey,
  type PermissionKey,
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
      this.rolesOf(tenant),
      this.ceilingOf(tenant.companyId),
      this.modulesOf(tenant),
    ]);
    const access = resolveAccess(held.roles, held.disabled ? [] : ceiling, modules);
    return {
      permissions: access.permissions,
      modules,
      ceiling,
      dataScope: access.dataScope,
      isOwner: access.isOwner && !held.disabled,
      userId: tenant.userId,
      branchId: held.branchId,
      roleNames: held.names,
      disabled: held.disabled,
      mfaRequired: !held.disabled && held.roles.some(roleRequiresMfa),
    };
  }

  private async rolesOf(tenant: TenantContext) {
    const db = await this.tenancy.db(tenant);
    const [profile] = await db
      .select({ branchId: userProfiles.branchId, status: userProfiles.status })
      .from(userProfiles)
      .where(and(eq(userProfiles.userId, tenant.userId), isNull(userProfiles.deletedAt)));
    const roleRows = await db
      .select({ id: roles.id, name: roles.name, dataScope: roles.dataScope, owner: roles.owner })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, tenant.userId), isNull(userRoles.deletedAt), isNull(roles.deletedAt)));
    const keys =
      roleRows.length === 0
        ? []
        : await db
            .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
            .from(rolePermissions)
            .where(
              and(
                inArray(
                  rolePermissions.roleId,
                  roleRows.map((role) => role.id),
                ),
                isNull(rolePermissions.deletedAt),
              ),
            );
    const held: RoleLike[] = roleRows.map((role) => ({
      id: role.id,
      dataScope: role.dataScope,
      owner: role.owner,
      permissions: keys.filter((row) => row.roleId === role.id).map((row) => row.key as PermissionKey),
    }));
    return {
      roles: held,
      names: roleRows.map((role) => role.name),
      branchId: profile?.branchId ?? null,
      // No profile means the person was never set up in this company, which counts as disabled.
      disabled: !profile || profile.status === "disabled",
    };
  }

  private async ceilingOf(companyId: string): Promise<PermissionKey[]> {
    const rows = await this.control.db
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

  private async modulesOf(tenant: TenantContext): Promise<ModuleKey[]> {
    const allSubscriptions = await this.control.db
      .select({
        planId: tenantSubscriptions.planId,
        status: tenantSubscriptions.status,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
        deletedAt: tenantSubscriptions.deletedAt,
      })
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, tenant.companyId));
    // Soft-deleted rows still prove the company once had a subscription, so soft-deleting them
    // never makes it a fresh trial again (PR #8 review); only live rows give plan modules. Rows are
    // never hard-deleted (CLAUDE.md rule 8, deleted_at on business tables).
    const freshTrial = tenant.status === "trial" && allSubscriptions.length === 0;
    const subscriptions = allSubscriptions.filter((subscription) => subscription.deletedAt === null);
    const planIds = [...new Set(subscriptions.map((subscription) => subscription.planId))];
    const moduleRows =
      planIds.length === 0
        ? []
        : await this.control.db
            .select({ planId: planModules.planId, module: planModules.module })
            .from(planModules)
            .where(and(inArray(planModules.planId, planIds), isNull(planModules.deletedAt)));
    const plan = planModulesOf(
      subscriptions.map((subscription) => ({
        ...subscription,
        modules: moduleRows.filter((row) => row.planId === subscription.planId).map((row) => row.module),
      })),
      freshTrial,
    );
    const overrides = await this.control.db
      .select({ module: tenantModuleOverrides.module, enabled: tenantModuleOverrides.enabled })
      .from(tenantModuleOverrides)
      .where(and(eq(tenantModuleOverrides.tenantId, tenant.companyId), isNull(tenantModuleOverrides.deletedAt)));
    return enabledModules(tenant.products, plan, overrides);
  }
}
