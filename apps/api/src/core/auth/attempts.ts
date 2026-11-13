import type { ControlDb } from "@workspace/db";
import { authAttempts, type AuthAttemptKind } from "@workspace/db/control";
import { and, count, desc, eq, gt, inArray, sql } from "drizzle-orm";

/**
 * Owner decisions, 2026-11-13 (ADR 0029, part 2): 5 failed passwords within 15 minutes lock the
 * account for 15 minutes; a successful sign-in resets the count; locks end on their own. At most
 * 3 verification or reset emails per address per hour.
 */
export const LOCKOUT = { failures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 } as const;
export const EMAIL_LIMIT = { perWindow: 3, windowMs: 60 * 60_000 } as const;

/** A step-up lasts 5 minutes; 5 wrong codes in 15 minutes lock step-up for 15 minutes (draft spec). */
export const STEP_UP = { validMs: 5 * 60_000, failures: 5, windowMs: 15 * 60_000 } as const;

/** Invitation lookups and acceptances per IP: the sign-in limit, 10 a minute. */
export const INVITATION_LIMIT = { perWindow: 10, windowMs: 60_000 } as const;

/** What the person is told while their account is locked. */
export const LOCKED_MESSAGE = "Too many failed sign-in attempts. Try again in 15 minutes.";

/** One password row, newest first, as lockEnd reads them. */
export interface PasswordAttempt {
  kind: Extract<AuthAttemptKind, "password_attempt" | "password_ok">;
  at: Date;
}

/**
 * When the lock from these rows ends, or null when there is none. Every attempt counts as a
 * failure until a `password_ok` follows it. Locked means the newest LOCKOUT.failures rows are all
 * attempts with no success among them, all within LOCKOUT.windowMs of each other, and now is within
 * LOCKOUT.lockMs of the newest. Attempts refused while locked are never recorded, so the lock ends
 * on its own.
 */
export function lockEnd(newestFirst: readonly PasswordAttempt[], now: Date): Date | null {
  const recent = newestFirst.slice(0, LOCKOUT.failures);
  if (recent.length < LOCKOUT.failures || recent.some((attempt) => attempt.kind !== "password_attempt")) return null;
  const newest = recent[0].at.getTime();
  if (newest - recent[recent.length - 1].at.getTime() > LOCKOUT.windowMs) return null;
  const end = new Date(newest + LOCKOUT.lockMs);
  return end > now ? end : null;
}

/** The email address as the lockout and email limits count it: trimmed and lowercased. */
export function attemptSubject(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The auth_attempts log: password attempts and successes for the lockout, and sent auth emails for
 * the per-address limit. Addresses with no account are counted the same way, so answers reveal
 * nothing.
 */
export class AttemptLog {
  constructor(private readonly db: ControlDb) {}

  /**
   * Checks the lock and, when there is none, records this attempt, as one step per address: a
   * transaction-level advisory lock on the address serialises parallel guesses, so at most
   * LOCKOUT.failures of them are ever checked before the lock applies. Returns when the lock ends,
   * or null when the password may be checked now.
   */
  async reservePasswordAttempt(email: string, ip: string | null, now: Date = new Date()): Promise<Date | null> {
    const subject = attemptSubject(email);
    // A lock can only come from attempts in the last window plus lock length.
    const since = new Date(now.getTime() - LOCKOUT.windowMs - LOCKOUT.lockMs);
    return this.db.transaction(async (tx) => {
      await lockSubject(tx, subject);
      const rows = await tx
        .select({ kind: authAttempts.kind, at: authAttempts.createdAt })
        .from(authAttempts)
        .where(
          and(
            eq(authAttempts.subject, subject),
            inArray(authAttempts.kind, ["password_attempt", "password_ok"]),
            gt(authAttempts.createdAt, since),
          ),
        )
        .orderBy(desc(authAttempts.createdAt))
        .limit(LOCKOUT.failures);
      const locked = lockEnd(rows as PasswordAttempt[], now);
      if (!locked) await tx.insert(authAttempts).values({ kind: "password_attempt", subject, ip });
      return locked;
    });
  }

  /** Records a sent email or a correct password for an address. */
  async record(kind: "password_ok" | "verification_email", email: string, ip: string | null): Promise<void> {
    await this.db.insert(authAttempts).values({ kind, subject: attemptSubject(email), ip });
  }

  /** Whether a step-up passed for this session in the last STEP_UP.validMs. */
  async hasFreshStepUp(sessionId: string, now: Date = new Date()): Promise<boolean> {
    const [row] = await this.db
      .select({ n: count() })
      .from(authAttempts)
      .where(
        and(
          eq(authAttempts.subject, sessionId),
          eq(authAttempts.kind, "step_up_ok"),
          gt(authAttempts.createdAt, new Date(now.getTime() - STEP_UP.validMs)),
        ),
      );
    return (row?.n ?? 0) > 0;
  }

  /** Whether this user's step-up is locked by STEP_UP.failures wrong codes in STEP_UP.windowMs. */
  async stepUpLocked(userId: string, now: Date = new Date()): Promise<boolean> {
    const [row] = await this.db
      .select({ n: count() })
      .from(authAttempts)
      .where(
        and(
          eq(authAttempts.subject, userId),
          eq(authAttempts.kind, "step_up_failed"),
          gt(authAttempts.createdAt, new Date(now.getTime() - STEP_UP.windowMs)),
        ),
      );
    return (row?.n ?? 0) >= STEP_UP.failures;
  }

  /** Records a step-up: a pass against the session, a failure against the user. */
  async recordStepUp(passed: boolean, sessionId: string, userId: string, ip: string | null): Promise<void> {
    await this.db
      .insert(authAttempts)
      .values(
        passed ? { kind: "step_up_ok", subject: sessionId, ip } : { kind: "step_up_failed", subject: userId, ip },
      );
  }

  /**
   * Reserves one invitation lookup or acceptance for this IP, or returns false when it has had
   * INVITATION_LIMIT.perWindow in the last minute. Runs under a per-IP lock like reserveEmail.
   */
  async reserveInvitationAttempt(ip: string, now: Date = new Date()): Promise<boolean> {
    const subject = `ip:${ip}`;
    return this.db.transaction(async (tx) => {
      await lockSubject(tx, subject);
      const [row] = await tx
        .select({ n: count() })
        .from(authAttempts)
        .where(
          and(
            eq(authAttempts.subject, subject),
            eq(authAttempts.kind, "invitation_attempt"),
            gt(authAttempts.createdAt, new Date(now.getTime() - INVITATION_LIMIT.windowMs)),
          ),
        );
      if ((row?.n ?? 0) >= INVITATION_LIMIT.perWindow) return false;
      await tx.insert(authAttempts).values({ kind: "invitation_attempt", subject, ip });
      return true;
    });
  }

  /**
   * Reserves one verification, password-reset or invitation email for this address, or returns false when it
   * has had EMAIL_LIMIT.perWindow in the last hour. Count and insert run under the same per-address
   * lock as password attempts, so parallel requests cannot send more than the limit.
   */
  async reserveEmail(email: string, now: Date = new Date()): Promise<boolean> {
    const subject = attemptSubject(email);
    return this.db.transaction(async (tx) => {
      await lockSubject(tx, subject);
      const [row] = await tx
        .select({ n: count() })
        .from(authAttempts)
        .where(
          and(
            eq(authAttempts.subject, subject),
            eq(authAttempts.kind, "verification_email"),
            gt(authAttempts.createdAt, new Date(now.getTime() - EMAIL_LIMIT.windowMs)),
          ),
        );
      if ((row?.n ?? 0) >= EMAIL_LIMIT.perWindow) return false;
      await tx.insert(authAttempts).values({ kind: "verification_email", subject, ip: null });
      return true;
    });
  }
}

/** A transaction on the control database, as Drizzle passes it to `transaction`. */
type ControlTx = Parameters<Parameters<ControlDb["transaction"]>[0]>[0];

/**
 * Takes a transaction-level advisory lock on one address, so checks and inserts for it run one at
 * a time across API instances. It is released when the transaction ends. Plain PostgreSQL (rule 11).
 */
async function lockSubject(tx: ControlTx, subject: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`auth_attempts:${subject}`}))`);
}
