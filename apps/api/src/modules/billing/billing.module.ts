import { Module } from "@nestjs/common";
import { BillingFacts } from "./billing-facts";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { CompanyStandingController } from "./company-standing.controller";
import { StandingMemberGuard } from "./company-standing.guard";

/**
 * The company side of platform admin, part 4 (docs/specs/platform-admin.md; ADR 0054): the
 * session-only `GET /company/standing` behind StandingMemberGuard, and the Owner's read-only
 * `GET /billing`. Control database only: lint keeps the company schema and TenantConnectionService
 * out of this folder, and TenantContext out of the standing files. TenancyModule and AccessModule
 * are global, so TenantDirectory and PlanLimits need no import here.
 */
@Module({
  controllers: [CompanyStandingController, BillingController],
  providers: [StandingMemberGuard, BillingService, BillingFacts],
})
export class BillingModule {}
