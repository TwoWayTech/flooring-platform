import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { productPermissions } from "@workspace/db";
import { roles } from "@workspace/db/company";
import {
  escalations,
  isDefaultRoleKey,
  roleTemplate,
  type DataScope,
  type PermissionKey,
  type Role,
} from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { StepUpService } from "../../core/auth/step-up.service";
import { AuditService } from "../../core/access/audit";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { heldRoles, loadRoles, roleView, setRolePermissions, syncMemberRoles, type RoleRecord } from "./role-records";
import type { Actor } from "./users.service";

/** A role as the screens send it to be saved (ApiClient `saveRole`). */
export interface RoleInput {
  id?: string;
  name: string;
  description: string;
  dataScope: DataScope;
  permissions: PermissionKey[];
}

/**
 * Settings → Security roles on the server (spec "Create or duplicate a role", "Edit", "Reset",
 * "Delete"; rules 10, 12 and 15). Every change needs a step-up, may add only keys the actor holds
 * (keys the role already had may stay), never touches the Owner role, keeps `member.role` in sync
 * for everyone holding the role, and is audited with the permissions before and after.
 */
@Injectable()
export class RolesService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly stepUp: StepUpService,
  ) {}

  /** Every live role of the company. */
  async list(tenant: TenantContext): Promise<Role[]> {
    return (await loadRoles(await this.tenancy.db(tenant))).map((role) => roleView(role, tenant.companyId));
  }

  /** Creates a custom role, or changes one; a system role's name stays as shipped. */
  async save(tenant: TenantContext, actor: Actor, input: RoleInput): Promise<Role> {
    await this.stepUp.require(actor.session);
    const db = await this.tenancy.db(tenant);
    const allRoles = await loadRoles(db);
    const existing = input.id ? allRoles.find((role) => role.id === input.id) : undefined;
    if (input.id && !existing) throw new NotFoundException({ code: "not_found", message: "That role does not exist." });
    if (existing?.owner) throw ownerLocked();
    const proposed = [...new Set(input.permissions)];
    this.assertNoEscalation(actor, proposed, existing?.permissions ?? []);
    const name = existing?.system ? existing.name : input.name.trim();
    if (!name) throw new BadRequestException({ code: "invalid_request", message: "Give the role a name." });

    const id = existing?.id ?? uuidv7();
    await db.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(roles)
          .set({ name, description: input.description.trim(), dataScope: input.dataScope })
          .where(eq(roles.id, id));
      } else {
        await tx.insert(roles).values({
          id,
          key: `custom-${id}`,
          name,
          description: input.description.trim(),
          dataScope: input.dataScope,
          system: false,
          owner: false,
          createdBy: actor.access.userId,
        });
      }
      await setRolePermissions(tx, id, proposed, actor.access.userId);
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "role",
          action: existing ? "Changed role" : "Created role",
          targetType: "role",
          targetId: id,
          targetLabel: name,
          before: existing ? permissionDiffSource(existing) : null,
          after: { name, dataScope: input.dataScope, permissions: proposed },
        },
        tx,
      );
    });
    return this.afterChange(tenant, id);
  }

  /**
   * Puts a default role back to its shipped name, description, scope and permissions, limited to
   * the company's products (spec A3). It goes through the same checks as a save.
   */
  async reset(tenant: TenantContext, actor: Actor, roleId: string): Promise<Role> {
    const db = await this.tenancy.db(tenant);
    const role = (await loadRoles(db)).find((candidate) => candidate.id === roleId);
    if (!role) throw new NotFoundException({ code: "not_found", message: "That role does not exist." });
    if (role.owner) throw ownerLocked();
    if (!role.system || !isDefaultRoleKey(role.key)) {
      throw new ConflictException({ code: "not_default", message: "Only a default role can be reset." });
    }
    const template = roleTemplate(role.key);
    const allowed = new Set(productPermissions(tenant.products));
    return this.save(tenant, actor, {
      id: roleId,
      name: template.name,
      description: template.description,
      dataScope: template.dataScope,
      permissions: template.permissions.filter((key) => allowed.has(key)),
    });
  }

  /** Deletes a custom role that nobody holds (spec rule 15). */
  async remove(tenant: TenantContext, actor: Actor, roleId: string): Promise<void> {
    await this.stepUp.require(actor.session);
    const db = await this.tenancy.db(tenant);
    const role = (await loadRoles(db)).find((candidate) => candidate.id === roleId);
    if (!role) throw new NotFoundException({ code: "not_found", message: "That role does not exist." });
    if (role.system || role.owner) {
      throw new ConflictException({ code: "system_role", message: "Default roles can be copied but not deleted." });
    }
    const holders = [...(await heldRoles(db)).values()].filter((ids) => ids.includes(roleId));
    if (holders.length > 0) {
      throw new ConflictException({
        code: "role_in_use",
        message: "Users still hold this role. Move them to another role first.",
      });
    }
    await db.transaction(async (tx) => {
      await tx
        .update(roles)
        .set({ deletedAt: new Date() })
        .where(and(eq(roles.id, roleId), isNull(roles.deletedAt)));
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "role",
          action: "Deleted role",
          targetType: "role",
          targetId: roleId,
          targetLabel: role.name,
          before: permissionDiffSource(role),
        },
        tx,
      );
    });
  }

  /** Spec rule 10: a save may keep the role's keys but add only keys the actor holds. */
  private assertNoEscalation(actor: Actor, proposed: readonly PermissionKey[], current: readonly PermissionKey[]) {
    const access = actor.access;
    const added = escalations(
      { permissions: access.permissions, dataScope: access.dataScope, isOwner: access.isOwner },
      proposed,
      current,
    );
    if (added.length > 0) {
      throw new ForbiddenException({
        code: "not_held",
        message: `You can only grant permissions you hold. Not held: ${added.slice(0, 3).join(", ")}${added.length > 3 ? ` and ${added.length - 3} more` : ""}.`,
      });
    }
  }

  /** Re-syncs `member.role` for everyone holding the role, then returns it. */
  private async afterChange(tenant: TenantContext, roleId: string): Promise<Role> {
    const db = await this.tenancy.db(tenant);
    const allRoles = await loadRoles(db);
    const held = await heldRoles(db);
    const affected = new Map([...held].filter(([, ids]) => ids.includes(roleId)));
    await syncMemberRoles(this.control.db, tenant.companyId, affected, allRoles);
    const role = allRoles.find((candidate) => candidate.id === roleId);
    if (!role) throw new NotFoundException();
    return roleView(role, tenant.companyId);
  }
}

function ownerLocked(): ForbiddenException {
  return new ForbiddenException({
    code: "owner_locked",
    message: "The Owner role is locked. It always holds everything in your plan.",
  });
}

/** What the audit entry keeps of a role before a change. */
function permissionDiffSource(role: RoleRecord) {
  return { name: role.name, dataScope: role.dataScope, permissions: role.permissions };
}
