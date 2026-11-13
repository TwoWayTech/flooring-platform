import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOkResponse, ApiProperty, ApiTags, ApiUnauthorizedResponse } from "@nestjs/swagger";
import { CompanyDirectory } from "./company-directory";
import { AllowMfaEnrolment, CurrentSession, SessionGuard } from "./session.guard";
import type { AuthSession } from "./session.service";

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
@UseGuards(SessionGuard)
export class AuthController {
  constructor(private readonly companies: CompanyDirectory) {}

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
}
