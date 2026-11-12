import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { openControlDb, type ControlDb, type DbHandle } from "@workspace/db";
import type { ApiEnv } from "../config/env";

/** Injection token for the control database handle. */
export const CONTROL_DB = Symbol("CONTROL_DB");

/** Closes the control pool when the app stops, so tests and deploys leave no connections behind. */
class ControlDbLifecycle implements OnApplicationShutdown {
  constructor(@Inject(CONTROL_DB) private readonly handle: DbHandle<ControlDb>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

/**
 * The control database (companies, users, plans, branding). Company databases are reached only
 * through TenantConnectionService with the company from the verified session (P9, CLAUDE.md rule 1).
 */
@Global()
@Module({
  providers: [
    {
      provide: CONTROL_DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService<ApiEnv, true>) =>
        openControlDb(config.get("CONTROL_DATABASE_URL", { infer: true })),
    },
    ControlDbLifecycle,
  ],
  exports: [CONTROL_DB],
})
export class ControlDbModule {}
