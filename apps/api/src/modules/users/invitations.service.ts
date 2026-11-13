import {
  BadRequestException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { userProfiles } from "@workspace/db/company";
import { account, tenants, user, userInvitations } from "@workspace/db/control";
import { and, eq, gt, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Auth } from "../../core/auth/auth";
import { AttemptLog } from "../../core/auth/attempts";
import { AUTH } from "../../core/auth/tokens";
import { CONTROL_DB } from "../../core/database/control-db";
import { JobTenants } from "../../core/jobs/job-tenants";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import { MAX_PASSWORD_LENGTH, tokenHash } from "./invitation-rules";

/** Shortest password accepted, as at sign-in (blueprint p27). */
const MIN_PASSWORD_LENGTH = 12;

/** What the accept page shows before the person chooses a password. */
export interface InvitationView {
  email: string;
  companyName: string;
  /** False when the account already has a password (an existing user joining another company). */
  needsPassword: boolean;
}

const GONE = {
  code: "invitation_invalid",
  message: "This invitation link has expired or was already used. Ask for a new one.",
};

/**
 * Accepting an invitation (draft spec docs/specs/settings-users-access.md, "Invitations"). The
 * token is looked up by its hash only. Accepting sets the password for a new account, marks the
 * email verified and the profile active; the invitation is claimed with one conditional update, so
 * a link works once even when used twice at the same moment. MFA enrolment follows at sign-in for
 * roles that need it (ADR 0029). Both endpoints share a per-IP limit.
 *
 * The company comes from the invitation row, which only an admin of that company could create;
 * the profile is reached through JobTenants, which applies the same checks as TenantGuard.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger("Invitations");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    @Inject(AUTH) private readonly auth: Auth,
    private readonly attempts: AttemptLog,
    private readonly jobTenants: JobTenants,
    private readonly tenancy: TenantConnectionService,
  ) {}

  /** The invitation behind a token, for the accept page. */
  async lookup(token: string, ip: string): Promise<InvitationView> {
    await this.limit(ip);
    const found = await this.open(token);
    if (!found) throw new GoneException(GONE);
    return {
      email: found.email,
      companyName: found.companyName,
      needsPassword: !(await this.hasPassword(found.userId)),
    };
  }

  /** Accepts an invitation; a new account must choose a password of 12 to 128 characters. */
  async accept(token: string, password: string | undefined, ip: string): Promise<void> {
    await this.limit(ip);
    const found = await this.open(token);
    if (!found) throw new GoneException(GONE);
    const needsPassword = !(await this.hasPassword(found.userId));
    if (
      needsPassword &&
      (!password || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH)
    ) {
      throw new BadRequestException({
        code: "weak_password",
        message: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
    }
    const hashed = needsPassword && password ? await (await this.auth.$context).password.hash(password) : null;
    await this.control.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(userInvitations)
        .set({ acceptedAt: new Date() })
        .where(
          and(eq(userInvitations.id, found.id), isNull(userInvitations.acceptedAt), isNull(userInvitations.revokedAt)),
        )
        .returning({ id: userInvitations.id });
      if (!claimed) throw new GoneException(GONE);
      const [existing] = await tx
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, found.userId), eq(account.providerId, "credential")));
      if (hashed && !existing) {
        await tx.insert(account).values({
          id: uuidv7(),
          accountId: found.userId,
          providerId: "credential",
          userId: found.userId,
          password: hashed,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      await tx.update(user).set({ emailVerified: true }).where(eq(user.id, found.userId));
    });
    await this.activateProfile(found.tenantId, found.userId);
  }

  /** The open invitation for a token: not used, not revoked, not expired, of a live company. */
  private async open(token: string) {
    const [row] = await this.control.db
      .select({
        id: userInvitations.id,
        tenantId: userInvitations.tenantId,
        userId: userInvitations.userId,
        email: user.email,
        companyName: tenants.name,
      })
      .from(userInvitations)
      .innerJoin(user, eq(user.id, userInvitations.userId))
      .innerJoin(tenants, eq(tenants.id, userInvitations.tenantId))
      .where(
        and(
          eq(userInvitations.tokenHash, tokenHash(token)),
          isNull(userInvitations.acceptedAt),
          isNull(userInvitations.revokedAt),
          isNull(userInvitations.deletedAt),
          gt(userInvitations.expiresAt, new Date()),
          isNull(tenants.deletedAt),
        ),
      );
    return row ?? null;
  }

  private async hasPassword(userId: string): Promise<boolean> {
    const [row] = await this.control.db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential")));
    return row !== undefined;
  }

  /**
   * Marks the profile active. A company that cannot be written now (read-only, maintenance) keeps
   * the profile `invited`; the person can still sign in, and the status is only a label.
   */
  private async activateProfile(companyId: string, userId: string): Promise<void> {
    const tenant = await this.jobTenants.contextFor(companyId);
    if (!tenant || tenant.readOnly) {
      this.logger.warn("An accepted invitation's profile stays invited: the company cannot be written now.");
      return;
    }
    const db = await this.tenancy.db(tenant);
    await db
      .update(userProfiles)
      .set({ status: "active" })
      .where(and(eq(userProfiles.userId, userId), eq(userProfiles.status, "invited")));
  }

  private async limit(ip: string): Promise<void> {
    if (!(await this.attempts.reserveInvitationAttempt(ip))) {
      throw new HttpException(
        { code: "rate_limited", message: "Too many tries. Wait a minute and try again." },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
