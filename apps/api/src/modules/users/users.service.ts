import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { branches, userProfiles } from "@workspace/db/company";
import {
  member,
  passkey,
  platformAdmins,
  session as sessionTable,
  tenants,
  twoFactor,
  user,
  userInvitations,
} from "@workspace/db/control";
import type { EmailProvider } from "@workspace/providers";
import {
  branchPlacementDenial,
  canAssignRole,
  canManageHolder,
  hasActiveOwner,
  type CompanyId,
  type PermissionKey,
  type User,
  type UserStatus,
} from "@workspace/shared";
import { and, count, eq, inArray, isNull, ne } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import { PlanLimits } from "../../core/access/plan-limits";
import type { Actor } from "../../core/access/request-actor";
import { AttemptLog } from "../../core/auth/attempts";
import { StepUpService } from "../../core/auth/step-up.service";
import { CONTROL_DB } from "../../core/database/control-db";
import { EMAIL, EMAIL_FROM } from "../../core/email/email.module";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { INVITATION_DAYS, newInvitationToken, seatProblem, tokenHash } from "./invitation-rules";
import { heldRoles, loadRoles, setUserRoles, syncMemberRoles, type RoleRecord } from "./role-records";

/** What an invitation carries (ApiClient `InviteUserInput`). */
export interface InviteInput {
  name: string;
  email: string;
  title: string;
  roleIds: string[];
  branchId: string;
}

/** What may change on a user (ApiClient `UserPatch`). */
export interface UserPatchInput {
  roleIds?: string[];
  status?: "active" | "disabled";
  mfaEnrolled?: false;
  branchId?: string;
  title?: string;
}

const ROLE_REFUSALS = {
  owner_only: "Only an Owner can make someone an Owner.",
  not_held: "You can only give a role whose permissions you hold yourself.",
  scope_wider: "You can only give a role whose data scope is no wider than your own.",
} as const;

/** What a refusal to change someone who holds more than the actor says. */
const HOLDER_REFUSALS = {
  owner_only: "Only an Owner can change an Owner.",
  not_held: "This person holds permissions you do not have, so you cannot change them.",
  scope_wider: "This person sees more records than you do, so you cannot change them.",
} as const;

/**
 * Settings → Users on the server (spec "Settings: Users", rules 11, 13 and 14; draft spec
 * docs/specs/settings-users-access.md): list, invite and change people. Every change checks the
 * no-escalation rule, the last active Owner and the seat limit, keeps `member.role` in sync, and
 * is audited. Changing roles and resetting MFA need a step-up.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly limits: PlanLimits,
    private readonly stepUp: StepUpService,
    private readonly attempts: AttemptLog,
    @Inject(EMAIL) private readonly email: EmailProvider,
    @Inject(EMAIL_FROM) private readonly emailFrom: string,
  ) {}

  /** Every person with a profile in the company, with their roles and MFA state. */
  async list(tenant: TenantContext): Promise<User[]> {
    const db = await this.tenancy.db(tenant);
    const profiles = await db.select().from(userProfiles).where(isNull(userProfiles.deletedAt));
    return this.usersOf(tenant, db, profiles);
  }

  /**
   * One person exactly as `list` shapes them (GET /company's `me`; ADR 0051, "GET /company"), reading
   * only their own profile, account, passkeys and roles; null without a live profile and an account.
   */
  async one(tenant: TenantContext, userId: string): Promise<User | null> {
    const db = await this.tenancy.db(tenant);
    const profiles = await db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.userId, userId), isNull(userProfiles.deletedAt)));
    return (await this.usersOf(tenant, db, profiles))[0] ?? null;
  }

  /** These profiles as `User`s, with their accounts' names, emails and MFA state and their live roles. */
  private async usersOf(
    tenant: TenantContext,
    db: CompanyDb,
    profiles: readonly (typeof userProfiles.$inferSelect)[],
  ): Promise<User[]> {
    if (profiles.length === 0) return [];
    const ids = profiles.map((profile) => profile.userId);
    const [accounts, keys, held] = await Promise.all([
      this.control.db
        .select({ id: user.id, name: user.name, email: user.email, totp: user.twoFactorEnabled })
        .from(user)
        .where(inArray(user.id, ids)),
      this.control.db
        .select({ userId: passkey.userId, n: count() })
        .from(passkey)
        .where(inArray(passkey.userId, ids))
        .groupBy(passkey.userId),
      heldRoles(db, ids),
    ]);
    return profiles.flatMap((profile) => {
      const account = accounts.find((row) => row.id === profile.userId);
      if (!account) return [];
      const passkeys = keys.find((row) => row.userId === profile.userId)?.n ?? 0;
      return [
        {
          id: profile.userId,
          companyId: tenant.companyId as CompanyId,
          name: account.name,
          email: account.email,
          title: profile.title,
          roleIds: held.get(profile.userId) ?? [],
          branchId: profile.branchId ?? "",
          status: profile.status,
          mfaEnrolled: account.totp === true || passkeys > 0,
          lastLoginAt: profile.lastLoginAt?.toISOString() ?? null,
          employeeId: profile.employeeId,
          defaultLocationId: profile.defaultLocationId,
        },
      ];
    });
  }

  /**
   * Invites a person (spec workflow "Invite a user"; draft spec "Invitations"): checks the seat
   * limit and that the inviter may give every role, creates the account if there is none, the
   * membership, the profile and the role links, then emails a one-time link valid for 7 days.
   */
  async invite(tenant: TenantContext, actor: Actor, input: InviteInput, origin: string): Promise<User> {
    // Inviting gives roles to a new account, so it needs the same step-up as a role change (PR #11 review).
    await this.stepUp.require(actor.session);
    const db = await this.tenancy.db(tenant);
    const branchId = await knownBranch(db, input.branchId);
    assertBranchPlacement(actor.access, branchId);
    const email = input.email.trim().toLowerCase();
    const allRoles = await loadRoles(db);
    this.assertCanAssign(actor.access, allRoles, input.roleIds, []);
    const statuses = await db
      .select({ status: userProfiles.status })
      .from(userProfiles)
      .where(isNull(userProfiles.deletedAt));
    const seats = seatProblem(
      statuses.map((row) => row.status),
      (await this.limits.limitsOf(tenant.companyId)).userLimit,
    );
    if (seats) throw new ConflictException({ code: "seat_limit", message: seats });
    const [already] = await this.control.db
      .select({ id: member.id })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(user.email, email), eq(member.organizationId, tenant.companyId)));
    if (already)
      throw new ConflictException({ code: "already_member", message: "This person is already in your company." });
    if (!(await this.attempts.reserveEmail(email))) {
      throw new HttpException(
        { code: "email_limit", message: "This address has had 3 emails in the last hour. Try again later." },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const token = newInvitationToken();
    const { userId, existing } = await this.control.db.transaction(async (tx) => {
      const [found] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
      const id = found?.id ?? uuidv7();
      if (found) {
        const [already] = await tx
          .select({ id: member.id })
          .from(member)
          .where(and(eq(member.userId, id), eq(member.organizationId, tenant.companyId)));
        if (already)
          throw new ConflictException({ code: "already_member", message: "This person is already in your company." });
      } else {
        await tx.insert(user).values({ id, name: input.name.trim(), email, emailVerified: false });
      }
      await tx.insert(member).values({
        id: uuidv7(),
        organizationId: tenant.companyId,
        userId: id,
        role: "",
        createdAt: new Date(),
      });
      await tx
        .update(userInvitations)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(userInvitations.tenantId, tenant.companyId),
            eq(userInvitations.userId, id),
            isNull(userInvitations.acceptedAt),
            isNull(userInvitations.revokedAt),
          ),
        );
      await tx.insert(userInvitations).values({
        tenantId: tenant.companyId,
        userId: id,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
        createdBy: actor.access.userId,
      });
      return { userId: id, existing: Boolean(found) };
    });

    await db.transaction(async (tx) => {
      await tx
        .insert(userProfiles)
        .values({
          userId,
          title: input.title.trim(),
          branchId,
          status: "invited",
          createdBy: actor.access.userId,
        })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: { title: input.title.trim(), branchId, status: "invited", deletedAt: null },
        });
      await setUserRoles(tx, userId, input.roleIds, actor.access.userId);
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "user",
          action: "Invited user",
          targetType: "user",
          targetId: userId,
          targetLabel: email,
          after: { roleIds: input.roleIds, branchId, title: input.title },
        },
        tx,
      );
    });
    await syncMemberRoles(this.control.db, tenant.companyId, new Map([[userId, input.roleIds]]), allRoles);
    await this.sendInvitation(tenant.companyId, email, `${origin}/accept-invite?token=${token}`, existing);
    const [invited] = (await this.list(tenant)).filter((row) => row.id === userId);
    if (!invited) throw new NotFoundException();
    return invited;
  }

  /**
   * Changes a person's roles, status, branch or title, or resets their MFA (spec workflows). Roles
   * and MFA resets need a step-up; new roles must pass the no-escalation rule; nothing may leave
   * the company without an active Owner.
   */
  async update(tenant: TenantContext, actor: Actor, userId: string, patch: UserPatchInput): Promise<User> {
    const db = await this.tenancy.db(tenant);
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.userId, userId), isNull(userProfiles.deletedAt)));
    if (!profile) throw new NotFoundException({ code: "not_found", message: "That person is not in your company." });
    // Roles, status and MFA change what someone can do or whether they can sign in: step-up first.
    // A branch decides what branch-scoped roles see, so moving someone needs it too (PR #11 review).
    const sensitive =
      patch.roleIds !== undefined ||
      patch.status !== undefined ||
      patch.branchId !== undefined ||
      patch.mfaEnrolled === false;
    if (sensitive) {
      await this.stepUp.require(actor.session);
    }

    const allRoles = await loadRoles(db);
    const held = await heldRoles(db);
    const current = held.get(userId) ?? [];
    if (userId !== actor.access.userId) this.assertCanManage(actor.access, allRoles, current);
    if (patch.roleIds !== undefined) this.assertCanAssign(actor.access, allRoles, patch.roleIds, current);
    await this.assertOwnerRemains(db, allRoles, held, userId, patch);
    if (patch.mfaEnrolled === false) await this.assertMfaResettable(tenant, userId);
    const branchId = patch.branchId === undefined ? undefined : await knownBranch(db, patch.branchId);
    if (branchId !== undefined) assertBranchPlacement(actor.access, branchId, profile.branchId);

    await db.transaction(async (tx) => {
      const changes: Partial<typeof userProfiles.$inferInsert> = {};
      if (patch.status !== undefined) changes.status = patch.status;
      if (branchId !== undefined) changes.branchId = branchId;
      if (patch.title !== undefined) changes.title = patch.title.trim();
      if (Object.keys(changes).length > 0) {
        await tx.update(userProfiles).set(changes).where(eq(userProfiles.userId, userId));
      }
      if (patch.roleIds !== undefined) await setUserRoles(tx, userId, patch.roleIds, actor.access.userId);
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: patch.mfaEnrolled === false ? "security" : patch.roleIds !== undefined ? "role" : "user",
          action: describePatch(patch),
          targetType: "user",
          targetId: userId,
          before: {
            roleIds: current,
            status: profile.status,
            branchId: profile.branchId,
            title: profile.title,
          },
          after: branchId === undefined ? patch : { ...patch, branchId },
        },
        tx,
      );
    });
    // The audit entry is written first, so an MFA reset never happens without one (PR #11 review).
    if (patch.mfaEnrolled === false) await this.resetMfa(userId);
    if (patch.roleIds !== undefined) {
      await syncMemberRoles(this.control.db, tenant.companyId, new Map([[userId, patch.roleIds]]), await loadRoles(db));
    }
    const [updated] = (await this.list(tenant)).filter((row) => row.id === userId);
    if (!updated) throw new NotFoundException();
    return updated;
  }

  /**
   * No escalation (spec rules 10 and 11): every role being added must be one the actor may give.
   * Roles the person already holds are not checked again, as in the demo.
   */
  private assertCanAssign(
    access: RequestAccess,
    allRoles: readonly RoleRecord[],
    roleIds: readonly string[],
    current: readonly string[],
  ): void {
    const ceiling: PermissionKey[] = [...access.ceiling];
    for (const roleId of roleIds) {
      const role = allRoles.find((candidate) => candidate.id === roleId);
      if (!role) throw new BadRequestException({ code: "invalid_role", message: "One of the roles does not exist." });
      if (current.includes(roleId)) continue;
      const denial = canAssignRole(
        { permissions: access.permissions, dataScope: access.dataScope, isOwner: access.isOwner },
        role,
        ceiling,
        access.modules,
      );
      if (denial) throw new ForbiddenException({ code: denial, message: ROLE_REFUSALS[denial] });
    }
  }

  /**
   * Nobody changes someone who holds more than they do (CLAUDE.md rule 4; PR #11 security review):
   * the actor must be able to give every role the person holds now, and only an Owner changes an
   * Owner. Changes to oneself are checked by the other rules only.
   */
  private assertCanManage(access: RequestAccess, allRoles: readonly RoleRecord[], current: readonly string[]): void {
    const denial = canManageHolder(
      { permissions: access.permissions, dataScope: access.dataScope, isOwner: access.isOwner },
      allRoles.filter((role) => current.includes(role.id)),
      access.ceiling,
      access.modules,
    );
    if (denial) throw new ForbiddenException({ code: `holder_${denial}`, message: HOLDER_REFUSALS[denial] });
  }

  /** Spec rule 13: the change may not leave the company without an active user holding the Owner role. */
  private async assertOwnerRemains(
    db: Awaited<ReturnType<TenantConnectionService["db"]>>,
    allRoles: readonly RoleRecord[],
    held: ReadonlyMap<string, readonly string[]>,
    userId: string,
    patch: UserPatchInput,
  ): Promise<void> {
    if (patch.roleIds === undefined && patch.status === undefined) return;
    const profiles = await db
      .select({ userId: userProfiles.userId, status: userProfiles.status })
      .from(userProfiles)
      .where(isNull(userProfiles.deletedAt));
    const after = profiles.map((profile) => ({
      id: profile.userId,
      status: (profile.userId === userId && patch.status ? patch.status : profile.status) as UserStatus,
      roleIds: profile.userId === userId && patch.roleIds ? patch.roleIds : [...(held.get(profile.userId) ?? [])],
    }));
    const ownerRoleIds = new Set(allRoles.filter((role) => role.owner).map((role) => role.id));
    const before = profiles.map((profile) => ({
      id: profile.userId,
      status: profile.status,
      roleIds: [...(held.get(profile.userId) ?? [])],
    }));
    if (hasActiveOwner(before, ownerRoleIds) && !hasActiveOwner(after, ownerRoleIds)) {
      throw new ConflictException({
        code: "last_owner",
        message: "This is the last active Owner. Make someone else an Owner first.",
      });
    }
  }

  /**
   * An MFA reset is refused for an account that also belongs to another company, so one company
   * can never weaken another's security, and for a platform admin, whose MFA only platform support
   * may reset (draft spec "MFA reset"; PR #11 security review).
   */
  private async assertMfaResettable(tenant: TenantContext, userId: string): Promise<void> {
    const [admin] = await this.control.db
      .select({ id: platformAdmins.id })
      .from(platformAdmins)
      .where(and(eq(platformAdmins.userId, userId), isNull(platformAdmins.deletedAt)));
    const [others] = await this.control.db
      .select({ n: count() })
      .from(member)
      .where(and(eq(member.userId, userId), ne(member.organizationId, tenant.companyId)));
    if (admin || (others?.n ?? 0) > 0) {
      throw new ConflictException({
        code: "shared_account",
        message: "This person also belongs to another company, so only our support team can reset their MFA.",
      });
    }
  }

  /** Removes the person's authenticator app, backup codes and passkeys, and ends their sessions. */
  private async resetMfa(userId: string): Promise<void> {
    await this.control.db.transaction(async (tx) => {
      await tx.delete(twoFactor).where(eq(twoFactor.userId, userId));
      await tx.delete(passkey).where(eq(passkey.userId, userId));
      await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId));
      await tx.delete(sessionTable).where(eq(sessionTable.userId, userId));
    });
  }

  private async sendInvitation(companyId: string, to: string, url: string, existing: boolean): Promise<void> {
    const [company] = await this.control.db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, companyId));
    const name = (company?.name ?? "your company").replace(/[\r\n]+/g, " ");
    await this.email.send({
      from: this.emailFrom,
      to: [to],
      subject: `You're invited to ${name}`,
      text: existing
        ? `You have been added to ${name}. Open this link to accept, then sign in with your usual password:\n\n${url}\n\nThe link works for ${INVITATION_DAYS} days.`
        : `You have been invited to ${name}. Open this link to choose your password:\n\n${url}\n\nThe link works for ${INVITATION_DAYS} days. If you did not expect this, ignore this email.`,
    });
  }
}

const UNKNOWN_BRANCH = {
  code: "unknown_branch",
  message: "That branch is not one of your company's branches. Reload the page and pick another.",
} as const;

/**
 * The branch id to store (ADR 0051, "2026-11-20"): an empty id is no branch; anything else must be
 * one of the company's live branches, or the request is refused (400), never stored as no branch.
 */
async function knownBranch(db: CompanyDb, branchId: string): Promise<string | null> {
  if (branchId === "") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(branchId)) {
    throw new BadRequestException(UNKNOWN_BRANCH);
  }
  const [row] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), isNull(branches.deletedAt)));
  if (!row) throw new BadRequestException(UNKNOWN_BRANCH);
  return row.id;
}

/**
 * A branch-scoped admin invites into, and moves people from and to, their own branch only (the
 * server half of D18; `branchPlacementDenial` in packages/shared). `from` is the person's branch
 * before a change, left out for an invitation.
 */
function assertBranchPlacement(access: RequestAccess, to: string | null, from?: string | null): void {
  if (branchPlacementDenial(access, to, from)) {
    throw new ForbiddenException({
      code: "branch_other",
      message: "You can only invite people to your own branch, or move people within it.",
    });
  }
}

/** The audit action for a user change, in words. */
function describePatch(patch: UserPatchInput): string {
  if (patch.mfaEnrolled === false) return "Reset MFA";
  if (patch.roleIds !== undefined) return "Changed roles";
  if (patch.status === "disabled") return "Disabled user";
  if (patch.status === "active") return "Enabled user";
  return "Updated user";
}
