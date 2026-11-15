import { Global, Module } from "@nestjs/common";
import { AccessService } from "./access.service";
import { AuditInterceptor, AuditService } from "./audit";
import { PermissionGuard } from "./permission.guard";
import { PlanLimits } from "./plan-limits";
import { SensitiveFieldsInterceptor } from "./sensitive-fields";

/**
 * Permissions, sensitive fields, audit and plan limits (blueprint P10). Business modules inject
 * AuditService to write full entries inside their transactions. RequestPipelineModule registers the
 * guard and the interceptors globally.
 */
@Global()
@Module({
  providers: [AccessService, AuditService, PermissionGuard, PlanLimits, SensitiveFieldsInterceptor, AuditInterceptor],
  exports: [AccessService, AuditService, PermissionGuard, PlanLimits, SensitiveFieldsInterceptor, AuditInterceptor],
})
export class AccessModule {}
