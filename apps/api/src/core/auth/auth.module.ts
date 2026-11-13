import { Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ControlDb, DbHandle } from "@workspace/db";
import type { EmailProvider } from "@workspace/providers";
import type { ApiEnv } from "../config/env";
import { CONTROL_DB } from "../database/control-db";
import { EMAIL, EMAIL_FROM } from "../email/email.module";
import { AttemptLog } from "./attempts";
import { createAuth } from "./auth";
import { AuthController } from "./auth.controller";
import { CompanyDirectory } from "./company-directory";
import { MfaPolicy } from "./mfa-policy";
import { SessionGuard } from "./session.guard";
import { SessionService } from "./session.service";
import { StepUpService } from "./step-up.service";
import { AUTH } from "./tokens";

/**
 * Sign-in (P8): the Better Auth instance with MFA, lockout and rate limits, mounted on /api/auth/* by app.ts, plus the session
 * check that guarded endpoints use.
 */
@Module({
  providers: [
    {
      provide: CompanyDirectory,
      inject: [CONTROL_DB],
      useFactory: (control: DbHandle<ControlDb>) => new CompanyDirectory(control.db),
    },
    {
      provide: MfaPolicy,
      inject: [CONTROL_DB],
      useFactory: (control: DbHandle<ControlDb>) => new MfaPolicy(control.db),
    },
    {
      provide: AttemptLog,
      inject: [CONTROL_DB],
      useFactory: (control: DbHandle<ControlDb>) => new AttemptLog(control.db),
    },
    {
      provide: AUTH,
      inject: [ConfigService, CONTROL_DB, CompanyDirectory, MfaPolicy, AttemptLog, EMAIL, EMAIL_FROM],
      useFactory: (
        config: ConfigService<ApiEnv, true>,
        control: DbHandle<ControlDb>,
        companies: CompanyDirectory,
        mfa: MfaPolicy,
        attempts: AttemptLog,
        email: EmailProvider,
        emailFrom: string,
      ) => {
        const logger = new Logger("Auth");
        return createAuth({
          db: control.db,
          companies,
          mfa,
          attempts,
          email,
          emailFrom,
          secret: config.get("BETTER_AUTH_SECRET", { infer: true }),
          allowedHosts: config.get("AUTH_ALLOWED_HOSTS", { infer: true }),
          trustedOrigins: config.get("CORS_ORIGINS", { infer: true }),
          secureCookies: config.get("NODE_ENV", { infer: true }) === "production",
          passkeyRpId: config.get("PASSKEY_RP_ID", { infer: true }) ?? "localhost",
          logError: (message) => logger.error(message),
        });
      },
    },
    SessionService,
    SessionGuard,
    StepUpService,
  ],
  controllers: [AuthController],
  exports: [AUTH, SessionService, SessionGuard, CompanyDirectory, AttemptLog, MfaPolicy, StepUpService],
})
export class AuthModule {}
