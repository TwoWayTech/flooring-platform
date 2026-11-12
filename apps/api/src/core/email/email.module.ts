import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { emailFor, type EmailProvider } from "@workspace/providers";
import type { ApiEnv } from "../config/env";

/** Injection token for the EmailProvider chosen by EMAIL_PROVIDER (memory locally, Resend in production). */
export const EMAIL = Symbol("EMAIL");

/** Injection token for the sender address of system email such as verification links. */
export const EMAIL_FROM = Symbol("EMAIL_FROM");

/** Sender used when EMAIL_FROM is not set, which only the memory adapter allows; nothing is sent. */
const LOCAL_SENDER = "no-reply@localhost";

/** Email through packages/providers only (CLAUDE.md rule 11). */
@Global()
@Module({
  providers: [
    {
      provide: EMAIL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnv, true>): EmailProvider =>
        emailFor(config.get("providers", { infer: true }).email),
    },
    {
      provide: EMAIL_FROM,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnv, true>): string => {
        const email = config.get("providers", { infer: true }).email;
        return email.EMAIL_PROVIDER === "resend" ? email.EMAIL_FROM : LOCAL_SENDER;
      },
    },
  ],
  exports: [EMAIL, EMAIL_FROM],
})
export class EmailModule {}
