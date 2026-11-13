import { createParamDecorator, Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { SessionService, type AuthSession } from "./session.service";

/** The request after SessionGuard has run. */
type SignedInRequest = Request & { authSession?: AuthSession };

const ALLOW_MFA_ENROLMENT = "auth:allow-mfa-enrolment";

/**
 * Lets a session that must enrol MFA first reach this route. Only for routes the web app needs to
 * show the enrolment step, such as GET /auth/context (ADR 0029, part 2).
 */
export const AllowMfaEnrolment = () => SetMetadata(ALLOW_MFA_ENROLMENT, true);

/**
 * Lets a request through only with a valid session, checked by SessionService, and attaches it for
 * `@CurrentSession()`. Opt-in for now; P9 makes guards global and deny-by-default with the tenant guard.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SignedInRequest>();
    const allowMfaEnrolment =
      this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_ENROLMENT, [context.getHandler(), context.getClass()]) ??
      false;
    request.authSession = await this.sessions.verify(fromNodeHeaders(request.headers), { allowMfaEnrolment });
    return true;
  }
}

/** The session SessionGuard verified for this request. */
export const CurrentSession = createParamDecorator((_data: unknown, context: ExecutionContext): AuthSession => {
  const session = context.switchToHttp().getRequest<SignedInRequest>().authSession;
  if (!session) throw new Error("CurrentSession used on a route without SessionGuard.");
  return session;
});
