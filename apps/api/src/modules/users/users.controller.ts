import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ALL_PERMISSION_KEYS, type PermissionKey } from "@workspace/shared";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import type { ApiEnv } from "../../core/config/env";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { AuditLogService } from "./audit-log.service";
import { actorOf, parse } from "../../core/access/request-actor";
import { linkOrigin } from "./invitation-rules";
import { RolesService } from "./roles.service";
import { UsersService } from "./users.service";

const PERMISSION_KEY = z
  .string()
  .refine((key): key is PermissionKey => (ALL_PERMISSION_KEYS as readonly string[]).includes(key), {
    message: "Unknown permission.",
  });

/** POST /users/invite (Zod at the boundary). */
const INVITE = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  title: z.string().max(200).default(""),
  roleIds: z.array(z.string().uuid()).min(1).max(20),
  branchId: z.string().max(100).default(""),
});

/** PATCH /users/:id: only these fields; MFA can only be reset, never set. */
const USER_PATCH = z
  .object({
    roleIds: z.array(z.string().uuid()).max(20).optional(),
    status: z.enum(["active", "disabled"]).optional(),
    mfaEnrolled: z.literal(false).optional(),
    branchId: z.string().max(100).optional(),
    title: z.string().max(200).optional(),
  })
  .strict();

/** POST /roles and PUT /roles/:id. */
const ROLE = z.object({
  name: z.string().trim().max(100),
  description: z.string().max(500).default(""),
  dataScope: z.enum(["own", "branch", "all"]),
  permissions: z.array(PERMISSION_KEY).max(1000),
});

/** Settings → Users (spec "Settings: Users"; draft spec docs/specs/settings-users-access.md). */
@Controller("users")
export class UsersController {
  constructor(
    private readonly users: UsersService,
    @Inject(ConfigService) private readonly config: ConfigService<ApiEnv, true>,
  ) {}

  /** GET /users: everyone in the company. */
  @Get()
  @RequirePermission("settings.users.view", "settings.users.manage")
  list(@CurrentTenant() tenant: TenantContext) {
    return this.users.list(tenant);
  }

  /** POST /users/invite: invites a person and emails them a link (seat limit, no escalation). */
  @Post("invite")
  @RequirePermission("settings.users.manage")
  @Audited()
  invite(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    const origin = linkOrigin(
      request.get("x-forwarded-host") ?? request.get("host"),
      this.config.get("AUTH_ALLOWED_HOSTS", { infer: true }),
      this.config.get("NODE_ENV", { infer: true }) === "production",
    );
    if (!origin)
      throw new BadRequestException({ code: "no_link_host", message: "No sign-in host is set up for links." });
    return this.users.invite(tenant, actorOf(access, session, request), parse(INVITE, body), origin);
  }

  /** PATCH /users/:id: roles, status, branch, title, or an MFA reset (step-up for roles and MFA). */
  @Patch(":id")
  @RequirePermission("settings.users.manage")
  @Audited()
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) userId: string,
    @Body() body: unknown,
  ) {
    return this.users.update(tenant, actorOf(access, session, request), userId, parse(USER_PATCH, body));
  }
}

/** Settings → Security roles (spec "Create or duplicate a role" to "Delete a role"). */
@Controller("roles")
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** GET /roles: the company's roles; Users needs them to show who holds what. */
  @Get()
  @RequirePermission("settings.roles.view", "settings.roles.manage", "settings.users.view", "settings.users.manage")
  list(@CurrentTenant() tenant: TenantContext) {
    return this.roles.list(tenant);
  }

  /** POST /roles: creates a custom role (step-up, no escalation). */
  @Post()
  @RequirePermission("settings.roles.manage")
  @Audited()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    return this.roles.save(tenant, actorOf(access, session, request), parse(ROLE, body));
  }

  /** PUT /roles/:id: changes a role (step-up, no escalation, Owner role locked). */
  @Put(":id")
  @RequirePermission("settings.roles.manage")
  @Audited()
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) roleId: string,
    @Body() body: unknown,
  ) {
    return this.roles.save(tenant, actorOf(access, session, request), { ...parse(ROLE, body), id: roleId });
  }

  /** POST /roles/:id/reset: puts a default role back to its shipped permissions (step-up). */
  @Post(":id/reset")
  @RequirePermission("settings.roles.manage")
  @Audited()
  reset(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) roleId: string,
  ) {
    return this.roles.reset(tenant, actorOf(access, session, request), roleId);
  }

  /** DELETE /roles/:id: deletes a custom role nobody holds (step-up). */
  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("settings.roles.manage")
  @Audited()
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) roleId: string,
  ) {
    await this.roles.remove(tenant, actorOf(access, session, request), roleId);
  }
}

/** Settings → Audit log (spec "Read the audit log"). */
@Controller("audit")
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  /** GET /audit: the newest entries; pay-sensitive ones without their details unless the viewer can see pay. */
  @Get()
  @RequirePermission("settings.audit.view")
  list(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    return this.audit.list(tenant, access);
  }
}
