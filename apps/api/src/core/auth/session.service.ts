import { ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { session as sessionTable } from "@workspace/db/control";
import { eq } from "drizzle-orm";
import { CONTROL_DB } from "../database/control-db";
import type { Auth } from "./auth";
import { AUTH_REFUSALS } from "./auth-hooks";
import { CompanyDirectory } from "./company-directory";
import { MfaPolicy, type MfaStatus } from "./mfa-policy";
import { SESSION_ENDED_MESSAGES, sessionExpiry, shouldRecordActivity } from "./session-timeouts";
import { AUTH } from "./tokens";

/** The signed-in person and their session, as guarded endpoints receive them. */
export interface AuthSession {
  user: { id: string; name: string; email: string };
  sessionId: string;
  /** The open company (tenant id), or null until the user chooses one. */
  companyId: string | null;
  /** Where the user stands on MFA (blueprint p27). */
  mfa: MfaStatus;
}

/** How a route lets sessions through. */
export interface VerifyOptions {
  /** Let in a session that must enrol MFA first (only /auth/context, so the web app can tell). */
  allowMfaEnrolment?: boolean;
  now?: Date;
}

/**
 * Checks the session cookie on a request: Better Auth verifies it, then the company's idle and
 * absolute timeouts apply (blueprint p28). An ended session is deleted and the request is refused;
 * a valid one records activity at most once a minute. A session whose user must enrol MFA first is
 * refused with 403 `mfa_enrolment_required` unless the route allows it (ADR 0029, part 2).
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly companies: CompanyDirectory,
    private readonly mfa: MfaPolicy,
  ) {}

  /**
   * The request's session, or 401 `unauthenticated` (`session_expired` when a timeout ended it), or
   * 403 `mfa_enrolment_required`.
   */
  async verify(headers: Headers, options: VerifyOptions = {}): Promise<AuthSession> {
    const now = options.now ?? new Date();
    const result = await this.auth.api.getSession({ headers });
    if (!result) throw new UnauthorizedException("Sign in to continue.");
    const { session, user } = result;
    const companyId = session.activeOrganizationId ?? null;
    const ended = sessionExpiry(session, await this.companies.timeoutsOf(companyId), now);
    if (ended) {
      await this.control.db.delete(sessionTable).where(eq(sessionTable.id, session.id));
      throw new UnauthorizedException({ code: "session_expired", message: SESSION_ENDED_MESSAGES[ended] });
    }
    const mfa = await this.mfa.statusOf(user.id);
    if (mfa.state === "enrolment_required" && !options.allowMfaEnrolment) {
      throw new ForbiddenException({ code: "mfa_enrolment_required", message: AUTH_REFUSALS.mfa_enrolment_required });
    }
    if (shouldRecordActivity(session, now)) {
      await this.control.db.update(sessionTable).set({ updatedAt: now }).where(eq(sessionTable.id, session.id));
    }
    return { user: { id: user.id, name: user.name, email: user.email }, sessionId: session.id, companyId, mfa };
  }
}
