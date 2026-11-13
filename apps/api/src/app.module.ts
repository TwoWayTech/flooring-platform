import { Module, type DynamicModule } from "@nestjs/common";
import { AuthModule } from "./core/auth/auth.module";
import { BrandingModule } from "./core/branding/branding.module";
import { ApiConfigModule } from "./core/config/config.module";
import { ControlDbModule } from "./core/database/control-db";
import { EmailModule } from "./core/email/email.module";
import { HealthController } from "./core/health/health.controller";

/**
 * The API's root module. core/ holds what every request passes through (config, database,
 * email, health, sign-in and public branding; tenancy, permissions and audit arrive in P9 and P10). Business modules go in
 * src/modules/, one folder each, in the order of docs/real-build-plan.md.
 */
@Module({})
export class AppModule {
  /** The module with its settings read now, from the current environment. */
  static forRoot(): DynamicModule {
    return {
      module: AppModule,
      imports: [ApiConfigModule.forRoot(), ControlDbModule, EmailModule, AuthModule, BrandingModule],
      controllers: [HealthController],
    };
  }
}
