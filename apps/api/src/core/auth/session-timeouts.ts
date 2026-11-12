/**
 * Session timeout rules (blueprint p28 "Security": idle timeout, default 30 minutes, and absolute
 * timeout, default 12 hours, set per company in tenant_branding). Better Auth has one global
 * expiry, so the API enforces the company's values itself on every guarded request (ADR 0029).
 */

/** A company's timeouts in minutes. */
export interface SessionTimeouts {
  idleMin: number;
  absoluteMin: number;
}

/** The blueprint defaults, used before a company is active and when a company has no branding row. */
export const DEFAULT_TIMEOUTS: SessionTimeouts = { idleMin: 30, absoluteMin: 720 };

/**
 * Better Auth's own expiry, in seconds: only a ceiling, longer than any company timeout should be.
 * The real limits are the company's, checked by `sessionExpiry`.
 */
export const SESSION_CEILING_SECONDS = 7 * 24 * 60 * 60;

/** Activity is recorded at most once a minute, so "idle" is accurate to one minute. */
export const ACTIVITY_STEP_MS = 60_000;

/** The session times the rules read: when it started and when it last saw activity. */
export interface SessionTimes {
  createdAt: Date;
  updatedAt: Date;
}

/** Why a session ended. */
export type SessionEnd = "idle" | "absolute";

/** What the person is told when a timeout ends their session. */
export const SESSION_ENDED_MESSAGES: Record<SessionEnd, string> = {
  idle: "You were signed out after a period of inactivity. Sign in again.",
  absolute: "Your session has reached its time limit. Sign in again.",
};

/** Why a session has ended, or null while it is still valid. */
export function sessionExpiry(session: SessionTimes, timeouts: SessionTimeouts, now: Date): SessionEnd | null {
  const minutes = (since: Date) => (now.getTime() - since.getTime()) / 60_000;
  if (minutes(session.createdAt) > timeouts.absoluteMin) return "absolute";
  if (minutes(session.updatedAt) > timeouts.idleMin) return "idle";
  return null;
}

/** Whether this request should record activity on the session (at most once per ACTIVITY_STEP_MS). */
export function shouldRecordActivity(session: SessionTimes, now: Date): boolean {
  return now.getTime() - session.updatedAt.getTime() >= ACTIVITY_STEP_MS;
}
