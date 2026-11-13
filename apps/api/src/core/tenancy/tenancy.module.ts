import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module";
import { SessionGuard } from "../auth/session.guard";
import { TenantConnectionService } from "./tenant-connection.service";
import { TenantDirectory } from "./tenant-directory";
import { TenantGuard } from "./tenant.guard";

/**
 * Tenancy (blueprint P9): the global guards and TenantConnectionService. The guards run on every
 * Nest route in this order: SessionGuard, then TenantGuard. A route opts out only with `@Public()` or
 * `@SessionOnly()`, so a new route is closed until it says otherwise (CLAUDE.md rule 3).
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [
    TenantDirectory,
    TenantConnectionService,
    TenantGuard,
    { provide: APP_GUARD, useExisting: SessionGuard },
    { provide: APP_GUARD, useExisting: TenantGuard },
  ],
  exports: [TenantConnectionService],
})
export class TenancyModule {}
