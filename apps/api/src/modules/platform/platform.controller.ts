import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import {
  ALL_PERMISSION_KEYS,
  MODULES,
  type PlatformCompany,
  type PlatformCompanySummary,
  type PlatformDirectory,
  type PlatformMe,
} from "@workspace/shared";
import { z } from "zod";
import { parse } from "../../core/access/request-actor";
import { SessionOnly } from "../../core/tenancy/access";
import { CompanyAccessService } from "./company-access.service";
import {
  CurrentPlatformAdmin,
  PlatformAdminGuard,
  PlatformWriteRoles,
  type PlatformActor,
} from "./platform-admin.guard";
import { PlatformCompaniesService } from "./platform-companies.service";
import { MAX_SUPPORT_HOURS, SupportRequestsService } from "./support-requests.service";

/** A module or permission name as sent; `accessPatchProblem` checks it is a real one. */
const NAME = z.string().max(100);

/**
 * A change of company access (spec "PlatformAccessPatch"). The schema checks only the shape, with
 * lists no longer than the catalog; names, the protected keys and the 1 to 100,000 range are
 * checked by `accessPatchProblem`, so the person gets the spec's own messages.
 */
const ACCESS_PATCH = z
  .object({
    modules: z.array(NAME).max(MODULES.length).optional(),
    ceiling: z.array(NAME).max(ALL_PERMISSION_KEYS.length).optional(),
    userLimit: z.number().optional(),
    branchLimit: z.number().optional(),
  })
  .strict();

const SUPPORT_REQUEST = z
  .object({
    companyId: z.string().uuid(),
    reason: z.string().trim().min(10).max(500),
    hours: z.number().int().min(1).max(MAX_SUPPORT_HOURS),
  })
  .strict();

/*
 * Every /platform controller is session-only and carries PlatformAdminGuard at class level: the
 * guard is the only authorization layer of these routes (docs/specs/platform-admin.md, "The
 * platform guard"; ADR 0052). A route names its company by `:id`, a UUID, for control-database rows
 * only, never for a company database (the one exception to "the tenant comes from the session",
 * docs/api-contract.md, Tenancy).
 */

/** Who is using the console. */
@Controller("platform/me")
@SessionOnly()
@UseGuards(PlatformAdminGuard)
export class PlatformMeController {
  /** GET /platform/me: the signed-in platform admin and their role. */
  @Get()
  me(@CurrentPlatformAdmin() admin: PlatformActor): PlatformMe {
    return { userId: admin.userId, name: admin.name, email: admin.email, role: admin.role };
  }
}

/** Companies and their access (spec "Endpoints (part 1)"). */
@Controller("platform/companies")
@SessionOnly()
@UseGuards(PlatformAdminGuard)
export class PlatformCompaniesController {
  constructor(
    private readonly companies: PlatformCompaniesService,
    private readonly access: CompanyAccessService,
  ) {}

  /** GET /platform/companies: every company, by name. */
  @Get()
  list(): Promise<PlatformCompanySummary[]> {
    return this.companies.list();
  }

  /** GET /platform/companies/:id: one company in full. */
  @Get(":id")
  detail(@Param("id", new ParseUUIDPipe()) companyId: string): Promise<PlatformCompany> {
    return this.companies.detail(companyId);
  }

  /** PATCH /platform/companies/:id/access: the owner role changes modules, the ceiling and limits. */
  @Patch(":id/access")
  changeAccess(
    @CurrentPlatformAdmin() admin: PlatformActor,
    @Param("id", new ParseUUIDPipe()) companyId: string,
    @Body() body: unknown,
  ): Promise<PlatformCompany> {
    return this.access.change(admin, companyId, parse(ACCESS_PATCH, body));
  }

  /** GET /platform/companies/:id/directory: default roles and branding, no users (restricted). */
  @Get(":id/directory")
  directory(@Param("id", new ParseUUIDPipe()) companyId: string): Promise<PlatformDirectory> {
    return this.companies.directoryOf(companyId);
  }
}

/** Support access, from the platform admin's side (blueprint role rule 6; ADR 0034). */
@Controller("platform/support-grants")
@SessionOnly()
@UseGuards(PlatformAdminGuard)
export class PlatformSupportGrantsController {
  constructor(private readonly requests: SupportRequestsService) {}

  /** POST /platform/support-grants: any platform admin asks a company's Owner for access, after a step-up. */
  @Post()
  @PlatformWriteRoles("owner", "support")
  request(@CurrentPlatformAdmin() admin: PlatformActor, @Body() body: unknown): Promise<{ id: string }> {
    const input = parse(SUPPORT_REQUEST, body);
    return this.requests.request(admin, input.companyId, input.reason, input.hours);
  }
}
