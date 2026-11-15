import { Module } from "@nestjs/common";
import { AuthModule } from "../../core/auth/auth.module";
import { CompanyAccessService } from "./company-access.service";
import { PlatformCompanyStatusController } from "./company-status.controller";
import { CompanyStatusService } from "./company-status.service";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformAdmins } from "./platform-admins";
import { PlatformAuditController } from "./platform-audit.controller";
import { PlatformAuditQueryService } from "./platform-audit-query.service";
import { PlatformAuditService } from "./platform-audit.service";
import { PlatformCompaniesService } from "./platform-companies.service";
import {
  PlatformCompaniesController,
  PlatformMeController,
  PlatformSupportGrantsController,
} from "./platform.controller";
import { PlatformPlansController } from "./plans.controller";
import { PlatformPlansService } from "./plans.service";
import { SupportRequestsService } from "./support-requests.service";

/**
 * The platform console's API (P11 module 17; docs/specs/platform-admin.md; ADR 0052, ADR 0053 and
 * ADR 0056): the platform guard, /platform/me, companies and their access, and the restricted
 * directory (part 1); plans as data and a company's status (suspend, reinstate, cancel) behind
 * `admin.billing` (part 2); the platform audit log and support requests with their list and limits
 * (part 3). Control database only: lint keeps the tenancy and company-schema imports out of this
 * folder. AuthModule gives StepUpService.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    PlatformMeController,
    PlatformCompaniesController,
    PlatformSupportGrantsController,
    PlatformAuditController,
    PlatformPlansController,
    PlatformCompanyStatusController,
  ],
  providers: [
    PlatformAdmins,
    PlatformAdminGuard,
    PlatformAuditService,
    PlatformAuditQueryService,
    PlatformCompaniesService,
    CompanyAccessService,
    SupportRequestsService,
    PlatformPlansService,
    CompanyStatusService,
  ],
})
export class PlatformModule {}
