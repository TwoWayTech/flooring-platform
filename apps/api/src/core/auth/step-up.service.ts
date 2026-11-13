import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { APIError } from "better-auth/api";
import type { Auth } from "./auth";
import { AttemptLog, STEP_UP } from "./attempts";
import { AUTH } from "./tokens";
import type { AuthSession } from "./session.service";

/** What each step-up refusal tells the person (docs/api-contract.md). */
export const STEP_UP_REFUSALS = {
  step_up_required: "Confirm it's you with a code from your authenticator app, then try again.",
  step_up_mfa_required: "Set up an authenticator app or a passkey before you can make this change.",
  step_up_invalid: "That code is not right. Try the current code from your authenticator app.",
  step_up_locked: "Too many wrong codes. Try again in 15 minutes.",
} as const;

/** A step-up code: 6 digits from an authenticator app, or a backup code (letters, digits, a dash). */
const CODE = /^(\d{6}|[A-Za-z0-9-]{8,20})$/;

/**
 * Server-side step-up for sensitive changes (docs/specs/settings-users-access.md): changing roles,
 * resetting MFA, saving, resetting or deleting a role, and approving support access.
 *
 * - `verify` checks a code against the person's own second factor through Better Auth (TOTP, or
 *   a backup code, which it uses up) and records a pass against the session, valid 5 minutes.
 *   Wrong codes count per person; 5 in 15 minutes lock step-up.
 * - `require` lets a change through when the session has a fresh step-up, or, for someone whose
 *   only factor is a passkey, when the session itself is under 5 minutes old (a passkey sign-in is
 *   two factors on its own, ADR 0029). Someone with no factor cannot step up at all.
 */
@Injectable()
export class StepUpService {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    private readonly attempts: AttemptLog,
  ) {}

  /** Checks a code for the signed-in person and records a step-up for this session. */
  async verify(session: AuthSession, code: string, headers: Headers, ip: string | null): Promise<void> {
    if (!session.mfa.totp) throw refuse(session.mfa.passkeys > 0 ? "step_up_required" : "step_up_mfa_required");
    if (await this.attempts.stepUpLocked(session.user.id)) {
      throw new HttpException(
        { code: "step_up_locked", message: STEP_UP_REFUSALS.step_up_locked },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const trimmed = code.trim();
    const passed = CODE.test(trimmed) && (await this.checkCode(trimmed, headers));
    await this.attempts.recordStepUp(passed, session.sessionId, session.user.id, ip);
    if (!passed) throw refuse("step_up_invalid");
  }

  /** Refuses with 403 `step_up_required` unless the session stepped up in the last 5 minutes. */
  async require(session: AuthSession, now: Date = new Date()): Promise<void> {
    if (!session.mfa.totp && session.mfa.passkeys === 0) throw refuse("step_up_mfa_required");
    if (await this.attempts.hasFreshStepUp(session.sessionId, now)) return;
    const passkeyOnly = !session.mfa.totp && session.mfa.passkeys > 0;
    const fresh = now.getTime() - session.sessionCreatedAt.getTime() < STEP_UP.validMs;
    if (passkeyOnly && fresh) return;
    throw refuse("step_up_required");
  }

  /** A 6-digit TOTP code, or a backup code; Better Auth checks it against this session's user. */
  private async checkCode(code: string, headers: Headers): Promise<boolean> {
    try {
      if (/^\d{6}$/.test(code)) await this.auth.api.verifyTOTP({ body: { code }, headers });
      else await this.auth.api.verifyBackupCode({ body: { code }, headers });
      return true;
    } catch (error) {
      if (error instanceof APIError && error.statusCode < 500) return false;
      throw error;
    }
  }
}

function refuse(code: keyof typeof STEP_UP_REFUSALS): ForbiddenException {
  return new ForbiddenException({ code, message: STEP_UP_REFUSALS[code] });
}
