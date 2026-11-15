import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { AnyCompanyMember, Audited } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { Public } from "../../core/tenancy/access";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { InvitationsService } from "./invitations.service";
import { actorOf, parse } from "../../core/access/request-actor";
import { SupportGrantsService } from "./support-grants.service";

/** A token as emailed: 43 URL-safe characters (32 bytes); anything else is not a token. */
const TOKEN = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, "This invitation link is not valid.");

const ACCEPT = z.object({ token: TOKEN, password: z.string().max(200).optional() });

/**
 * Invitation acceptance, open to anyone with the emailed link (draft spec "Invitations"). The
 * per-IP limit applies; the client IP is the one the web proxy vouches for (ADR 0029, part 2).
 */
@Controller("public/invitations")
@Public()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  /** GET /public/invitations/:token: the company and email for the accept page. */
  @Get(":token")
  lookup(@Param("token") token: string, @Req() request: Request) {
    return this.invitations.lookup(parse(TOKEN, token), clientIp(request));
  }

  /** POST /public/invitations/accept: sets the password of a new account and activates the profile. */
  @Post("accept")
  @HttpCode(204)
  async accept(@Body() body: unknown, @Req() request: Request) {
    const input = parse(ACCEPT, body);
    await this.invitations.accept(input.token, input.password, clientIp(request));
  }
}

/**
 * Support access, from the Owner's side (blueprint role rule 6). Platform admins ask for it through
 * POST /platform/support-grants, behind the platform guard (modules/platform).
 */
@Controller("support-grants")
export class SupportGrantsController {
  constructor(private readonly grants: SupportGrantsService) {}

  /** GET /support-grants: the company's grants, for Owners. */
  @Get()
  @AnyCompanyMember()
  list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
  ) {
    return this.grants.list(tenant, actorOf(access, session, request));
  }

  /** POST /support-grants/:id/approve: an Owner approves, after a step-up. */
  @Post(":id/approve")
  @HttpCode(204)
  @AnyCompanyMember()
  @Audited()
  async approve(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) grantId: string,
  ) {
    await this.grants.approve(tenant, actorOf(access, session, request), grantId);
  }

  /** POST /support-grants/:id/revoke: an Owner ends support access. */
  @Post(":id/revoke")
  @HttpCode(204)
  @AnyCompanyMember()
  @Audited()
  async revoke(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) grantId: string,
  ) {
    await this.grants.revoke(tenant, actorOf(access, session, request), grantId);
  }
}

/** The client IP for limits: Express's view, which trusts only the web proxy (ADR 0029, part 2). */
function clientIp(request: Request): string {
  return request.ip ?? "unknown";
}
