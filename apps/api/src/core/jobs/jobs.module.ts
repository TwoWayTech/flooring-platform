import { Global, Module } from "@nestjs/common";
import { JobTenants } from "./job-tenants";
import { JobsService } from "./jobs.service";

/** Background jobs on pg-boss (ADR 0032) and the tenant context jobs work in. */
@Global()
@Module({
  providers: [JobsService, JobTenants],
  exports: [JobsService, JobTenants],
})
export class JobsModule {}
