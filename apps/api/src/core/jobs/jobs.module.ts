import { Global, Module } from "@nestjs/common";
import { JobTenants } from "./job-tenants";
import { JobsService } from "./jobs.service";

/**
 * Background jobs on pg-boss (ADR 0032) and the tenant context jobs work in. JobTenants can build
 * a context for any company, so lint keeps it to core/jobs and the job handlers in core/notifications.
 */
@Global()
@Module({
  providers: [JobsService, JobTenants],
  exports: [JobsService, JobTenants],
})
export class JobsModule {}
