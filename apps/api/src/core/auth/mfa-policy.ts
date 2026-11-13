import type { ControlDb } from "@workspace/db";
import { member, passkey, platformAdmins, user } from "@workspace/db/control";
import { decodeMemberRoles, rolesRequireMfa } from "@workspace/shared";
import { and, count, eq, isNull } from "drizzle-orm";

/**
 * Where a person stands on MFA. `enrolment_required` means MFA is mandatory for them and they
 * have no factor yet, so their session may only enrol one (ADR 0029, part 2).
 */
export type MfaState = "ok" | "enrolment_required";

/** A person's MFA position, as /auth/context reports it. */
export interface MfaStatus {
  /** Whether MFA is mandatory for this person (blueprint p27). */
  required: boolean;
  /** Whether an authenticator app (TOTP) is enrolled and verified. */
  totp: boolean;
  /** How many passkeys they have registered. */
  passkeys: number;
  state: MfaState;
}

/** The MFA state that follows from the facts: mandatory with no factor means enrol first. */
export function mfaState(required: boolean, totp: boolean, passkeys: number): MfaState {
  return required && !totp && passkeys === 0 ? "enrolment_required" : "ok";
}

/**
 * Decides who must use MFA and whether they have it. Blueprint p27: mandatory for Owner,
 * Accountant, HR and platform admins. Company roles are read from `member.role` (role keys,
 * comma-separated) across every company the person belongs to, so switching company never changes
 * the answer. Active platform admins always need it.
 */
export class MfaPolicy {
  constructor(private readonly db: ControlDb) {}

  /** Whether MFA is mandatory for this user. */
  async isRequired(userId: string): Promise<boolean> {
    const [admin] = await this.db
      .select({ id: platformAdmins.id })
      .from(platformAdmins)
      .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.active, true), isNull(platformAdmins.deletedAt)))
      .limit(1);
    if (admin) return true;
    const memberships = await this.db.select({ role: member.role }).from(member).where(eq(member.userId, userId));
    return memberships.some((row) => rolesRequireMfa(decodeMemberRoles(row.role)));
  }

  /** The user's full MFA position. */
  async statusOf(userId: string): Promise<MfaStatus> {
    const [[account], [keys], required] = await Promise.all([
      this.db.select({ totp: user.twoFactorEnabled }).from(user).where(eq(user.id, userId)).limit(1),
      this.db.select({ n: count() }).from(passkey).where(eq(passkey.userId, userId)),
      this.isRequired(userId),
    ]);
    const totp = account?.totp === true;
    const passkeys = keys?.n ?? 0;
    return { required, totp, passkeys, state: mfaState(required, totp, passkeys) };
  }
}
