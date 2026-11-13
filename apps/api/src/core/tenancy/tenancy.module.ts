import { Global, Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TenantConnectionService } from "./tenant-connection.service";
import { TenantDirectory } from "./tenant-directory";
import { TenantGuard } from "./tenant.guard";

/**
 * Tenancy (blueprint P9): TenantGuard and TenantConnectionService, the only way to a company
 * database. RequestPipelineModule registers the guard globally, in order with the others.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [TenantDirectory, TenantConnectionService, TenantGuard],
  exports: [TenantConnectionService, TenantGuard, TenantDirectory],
})
export class TenancyModule {}
