import { Module } from "@nestjs/common";
import { AuthModule } from "../../core/auth/auth.module";
import { InvitationsController, SupportGrantsController } from "./access-requests.controller";
import { AuditLogService } from "./audit-log.service";
import { CompanyController } from "./company.controller";
import { CompanyService } from "./company.service";
import { InvitationsService } from "./invitations.service";
import { RolesService } from "./roles.service";
import { SupportGrantsService } from "./support-grants.service";
import { AuditLogController, RolesController, UsersController } from "./users.controller";
import { UsersService } from "./users.service";

/**
 * Settings → Users and Roles, invitations, the audit log and support access (P10 part 2; draft
 * spec docs/specs/settings-users-access.md), and the shell's `GET /company` (ADR 0051, "GET /company").
 */
@Module({
  imports: [AuthModule],
  controllers: [
    UsersController,
    RolesController,
    AuditLogController,
    InvitationsController,
    SupportGrantsController,
    CompanyController,
  ],
  providers: [UsersService, RolesService, AuditLogService, InvitationsService, SupportGrantsService, CompanyService],
})
export class UsersModule {}
