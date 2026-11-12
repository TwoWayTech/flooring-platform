import { createParamDecorator, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { SessionService, type AuthSession } from "./session.service";

/** The request after SessionGuard has run. */
type SignedInRequest = Request & { authSession?: AuthSession };

/**
 * Lets a request through only with a valid session, checked by SessionService, and attaches it for
 * `@CurrentSession()`. Opt-in for now; P9 makes guards global and deny-by-default with the tenant guard.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SignedInRequest>();
    request.authSession = await this.sessions.verify(fromNodeHeaders(request.headers));
    return true;
  }
}

/** The session SessionGuard verified for this request. */
export const CurrentSession = createParamDecorator((_data: unknown, context: ExecutionContext): AuthSession => {
  const session = context.switchToHttp().getRequest<SignedInRequest>().authSession;
  if (!session) throw new Error("CurrentSession used on a route without SessionGuard.");
  return session;
});
