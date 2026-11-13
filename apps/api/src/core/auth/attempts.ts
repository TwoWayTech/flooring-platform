import type { ControlDb } from "@workspace/db";
import { authAttempts, type AuthAttemptKind } from "@workspace/db/control";
import { and, count, desc, eq, gt, inArray } from "drizzle-orm";

/**
 * Owner decisions, 2026-11-13 (ADR 0029, part 2): 5 failed passwords within 15 minutes lock the
 * account for 15 minutes; a successful sign-in resets the count; locks end on their own. At most
 * 3 verification or reset emails per address per hour.
 */
export const LOCKOUT = { failures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 } as const;
export const EMAIL_LIMIT = { perWindow: 3, windowMs: 60 * 60_000 } as const;

/** What the person is told while their account is locked. */
export const LOCKED_MESSAGE = "Too many failed sign-in attempts. Try again in 15 minutes.";

/** One password attempt, newest first, as lockEnd reads them. */
export interface PasswordAttempt {
  kind: Extract<AuthAttemptKind, "password_failed" | "password_ok">;
  at: Date;
}

/**
 * When the lock from these attempts ends, or null when there is none. Locked means the newest
 * LOCKOUT.failures attempts are all failures, all within LOCKOUT.windowMs of each other, and now
 * is within LOCKOUT.lockMs of the newest. A success among them resets the count. Attempts refused
 * while locked are never recorded, so the lock ends on its own.
 */
export function lockEnd(newestFirst: readonly PasswordAttempt[], now: Date): Date | null {
  const recent = newestFirst.slice(0, LOCKOUT.failures);
  if (recent.length < LOCKOUT.failures || recent.some((attempt) => attempt.kind !== "password_failed")) return null;
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
 * The auth_attempts log: password outcomes for the lockout and sent auth emails for the
 * per-address limit. Addresses with no account are counted the same way, so answers reveal nothing.
 */
export class AttemptLog {
  constructor(private readonly db: ControlDb) {}

  /** When this address's lock ends, or null when it may try a password now. */
  async lockedUntil(email: string, now: Date = new Date()): Promise<Date | null> {
    // A lock can only come from failures in the last window plus lock length.
    const since = new Date(now.getTime() - LOCKOUT.windowMs - LOCKOUT.lockMs);
    const rows = await this.db
      .select({ kind: authAttempts.kind, at: authAttempts.createdAt })
      .from(authAttempts)
      .where(
        and(
          eq(authAttempts.subject, attemptSubject(email)),
          inArray(authAttempts.kind, ["password_failed", "password_ok"]),
          gt(authAttempts.createdAt, since),
        ),
      )
      .orderBy(desc(authAttempts.createdAt))
      .limit(LOCKOUT.failures);
    return lockEnd(rows as PasswordAttempt[], now);
  }

  /** Records one attempt or sent email for an address. */
  async record(kind: AuthAttemptKind, email: string, ip: string | null): Promise<void> {
    await this.db.insert(authAttempts).values({ kind, subject: attemptSubject(email), ip });
  }

  /** Whether another verification or reset email may go to this address now. */
  async emailAllowed(email: string, now: Date = new Date()): Promise<boolean> {
    const [row] = await this.db
      .select({ n: count() })
      .from(authAttempts)
      .where(
        and(
          eq(authAttempts.subject, attemptSubject(email)),
          eq(authAttempts.kind, "verification_email"),
          gt(authAttempts.createdAt, new Date(now.getTime() - EMAIL_LIMIT.windowMs)),
        ),
      );
    return (row?.n ?? 0) < EMAIL_LIMIT.perWindow;
  }
}
