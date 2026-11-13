import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AccessModule } from "./access/access.module";
import { AuditInterceptor } from "./access/audit";
import { PermissionGuard } from "./access/permission.guard";
import { SensitiveFieldsInterceptor } from "./access/sensitive-fields";
import { AuthModule } from "./auth/auth.module";
import { SessionGuard } from "./auth/session.guard";
import { TenancyModule } from "./tenancy/tenancy.module";
import { TenantGuard } from "./tenancy/tenant.guard";

/**
 * What every Nest route passes through, in this order (CLAUDE.md rules 2 to 5 and 10):
 * 1. SessionGuard: a verified session, unless the route is `@Public()`;
 * 2. TenantGuard: the session's open company, unless `@Public()` or `@SessionOnly()`;
 * 3. PermissionGuard: the route's declared permissions and module, deny by default;
 * then, around the handler, the AuditInterceptor (outer) and the SensitiveFieldsInterceptor (inner).
 * Guards and interceptors are registered here only, so their order is fixed in one place.
 */
@Module({
  imports: [AuthModule, TenancyModule, AccessModule],
  providers: [
    { provide: APP_GUARD, useExisting: SessionGuard },
    { provide: APP_GUARD, useExisting: TenantGuard },
    { provide: APP_GUARD, useExisting: PermissionGuard },
    { provide: APP_INTERCEPTOR, useExisting: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useExisting: SensitiveFieldsInterceptor },
  ],
})
export class RequestPipelineModule {}
