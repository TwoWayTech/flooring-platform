import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { session as sessionTable } from "@workspace/db/control";
import { eq } from "drizzle-orm";
import { CONTROL_DB } from "../database/control-db";
import type { Auth } from "./auth";
import { CompanyDirectory } from "./company-directory";
import { sessionExpiry, shouldRecordActivity } from "./session-timeouts";
import { AUTH } from "./tokens";

/** The signed-in person and their session, as guarded endpoints receive them. */
export interface AuthSession {
  user: { id: string; name: string; email: string };
  sessionId: string;
  /** The open company (tenant id), or null until the user chooses one. */
  companyId: string | null;
}

const ENDED_MESSAGES = {
  idle: "You were signed out after a period of inactivity. Sign in again.",
  absolute: "Your session has reached its time limit. Sign in again.",
} as const;

/**
 * Checks the session cookie on a request: Better Auth verifies it, then the company's idle and
 * absolute timeouts apply (blueprint p28). An ended session is deleted and the request is refused;
 * a valid one records activity at most once a minute.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly companies: CompanyDirectory,
  ) {}

  /** The request's session, or 401 `unauthenticated` (`session_expired` when a timeout ended it). */
  async verify(headers: Headers, now: Date = new Date()): Promise<AuthSession> {
    const result = await this.auth.api.getSession({ headers });
    if (!result) throw new UnauthorizedException("Sign in to continue.");
    const { session, user } = result;
    const companyId = session.activeOrganizationId ?? null;
    const ended = sessionExpiry(session, await this.companies.timeoutsOf(companyId), now);
    if (ended) {
      await this.control.db.delete(sessionTable).where(eq(sessionTable.id, session.id));
      throw new UnauthorizedException({ code: "session_expired", message: ENDED_MESSAGES[ended] });
    }
    if (shouldRecordActivity(session, now)) {
      await this.control.db.update(sessionTable).set({ updatedAt: now }).where(eq(sessionTable.id, session.id));
    }
    return { user: { id: user.id, name: user.name, email: user.email }, sessionId: session.id, companyId };
  }
}
