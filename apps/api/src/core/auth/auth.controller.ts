import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { z } from "zod";
import { ApiCookieAuth, ApiOkResponse, ApiProperty, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { CompanyDirectory } from "./company-directory";
import { SessionOnly } from "../tenancy/access";
import { AllowMfaEnrolment, CurrentSession } from "./session.guard";
import type { AuthSession } from "./session.service";
import { StepUpService } from "./step-up.service";

/** The body of POST /auth/step-up (Zod at the boundary). */
const STEP_UP_BODY = z.object({ code: z.string().min(6).max(20) });

/** A company in the session context. */
export class CompanyView {
  @ApiProperty({ format: "uuid" })
  id: string;

  @ApiProperty({ example: "summit" })
  slug: string;

  @ApiProperty({ example: "Summit Floor Co." })
  name: string;
}

/** The signed-in user. */
export class UserView {
  @ApiProperty({ format: "uuid" })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;
}

/** Where the user stands on MFA (blueprint p27; ADR 0029, part 2). */
export class MfaView {
  @ApiProperty({ description: "Whether MFA is mandatory for this user (Owner, Accountant, HR, platform admin)." })
  required: boolean;

  @ApiProperty({ description: "Whether an authenticator app is enrolled." })
  totp: boolean;

  @ApiProperty({ description: "How many passkeys are registered." })
  passkeys: number;

  @ApiProperty({
    enum: ["ok", "enrolment_required"],
    description: "`enrolment_required`: the session may only set up a second factor until one exists.",
  })
  state: "ok" | "enrolment_required";
}

/** Who is signed in, the open company, and the companies they can switch to. */
export class SessionContext {
  @ApiProperty({ type: UserView })
  user: UserView;

  @ApiProperty({ type: CompanyView, nullable: true, description: "Null until the user chooses a company." })
  company: CompanyView | null;

  @ApiProperty({ type: [CompanyView] })
  companies: CompanyView[];

  @ApiProperty({ type: MfaView })
  mfa: MfaView;
}

/**
 * The session as the web app needs it. Signing in and out, verification and choosing a company
 * are Better Auth's own endpoints under /api/auth (docs/api-contract.md, Authentication).
 */
@ApiTags("auth")
@ApiCookieAuth()
@Controller("auth")
@SessionOnly()
export class AuthController {
  constructor(
    private readonly companies: CompanyDirectory,
    private readonly stepUp: StepUpService,
  ) {}

  /**
   * GET /auth/context: the signed-in user, the open company, their other companies and their MFA
   * state. It answers a session that must enrol MFA first, so the web app can show that step.
   */
  @Get("context")
  @AllowMfaEnrolment()
  @ApiOkResponse({ type: SessionContext })
  @ApiUnauthorizedResponse({ description: "No session, or a timeout ended it (`session_expired`)." })
  async context(@CurrentSession() session: AuthSession): Promise<SessionContext> {
    const companies = await this.companies.membershipsOf(session.user.id);
    return {
      user: session.user,
      company: companies.find((company) => company.id === session.companyId) ?? null,
      companies,
      mfa: session.mfa,
    };
  }

  /**
   * POST /auth/step-up: confirms it is the signed-in person with a code from their authenticator
   * app or a backup code, so sensitive changes in the next 5 minutes may go ahead (draft spec
   * docs/specs/settings-users-access.md). 403 `step_up_invalid` for a wrong code, 429 after 5.
   */
  @Post("step-up")
  @HttpCode(204)
  async verifyStepUp(@CurrentSession() session: AuthSession, @Body() body: unknown, @Req() request: Request) {
    const parsed = STEP_UP_BODY.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException({ code: "invalid_request", message: "Enter the code." });
    await this.stepUp.verify(session, parsed.data.code, fromNodeHeaders(request.headers), request.ip ?? null);
  }
}
