import { Module } from "@nestjs/common";
import { AuthModule } from "../../core/auth/auth.module";
import { CompanyAccessService } from "./company-access.service";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformAdmins } from "./platform-admins";
import { PlatformAuditService } from "./platform-audit.service";
import { PlatformCompaniesService } from "./platform-companies.service";
import {
  PlatformCompaniesController,
  PlatformMeController,
  PlatformSupportGrantsController,
} from "./platform.controller";
import { SupportRequestsService } from "./support-requests.service";

/**
 * The platform console's API, part 1 (P11 module 17; docs/specs/platform-admin.md; ADR 0052):
 * the platform guard, /platform/me, companies and their access, the restricted directory and the
 * support-access request. Control database only: lint keeps the tenancy and company-schema imports
 * out of this folder. AuthModule gives StepUpService.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlatformMeController, PlatformCompaniesController, PlatformSupportGrantsController],
  providers: [
    PlatformAdmins,
    PlatformAdminGuard,
    PlatformAuditService,
    PlatformCompaniesService,
    CompanyAccessService,
    SupportRequestsService,
  ],
})
export class PlatformModule {}
