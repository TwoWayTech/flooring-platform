import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import {
  ALL_PERMISSION_KEYS,
  MODULES,
  SUPPORT_HOURS,
  SUPPORT_HOURS_MESSAGE,
  SUPPORT_REASON,
  SUPPORT_REASON_MESSAGE,
  type PlatformCompany,
  type PlatformCompanySummary,
  type PlatformDirectory,
  type PlatformMe,
  type PlatformSupportGrant,
} from "@workspace/shared";
import { z } from "zod";
import { parse } from "../../core/access/request-actor";
import { SessionOnly } from "../../core/tenancy/access";
import { CompanyAccessService } from "./company-access.service";
import {
  CurrentPlatformAdmin,
  PlatformAdminGuard,
  PlatformFeature,
  PlatformWriteRoles,
  type PlatformActor,
} from "./platform-admin.guard";
import { PlatformCompaniesService } from "./platform-companies.service";
import { COMPANY_ID } from "./platform-params";
import { SupportRequestsService } from "./support-requests.service";

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

/**
 * A support-access request (spec "POST /platform/support-grants", Body), strict, with the bounds
 * and messages the dialog and the demo share (`SUPPORT_REASON`, `SUPPORT_HOURS`).
 */
const SUPPORT_REQUEST = z
  .object({
    companyId: COMPANY_ID,
    reason: z
      .string({ error: SUPPORT_REASON_MESSAGE })
      .trim()
      .min(SUPPORT_REASON.min, SUPPORT_REASON_MESSAGE)
      .max(SUPPORT_REASON.max, SUPPORT_REASON_MESSAGE),
    hours: z
      .number({ error: SUPPORT_HOURS_MESSAGE })
      .int(SUPPORT_HOURS_MESSAGE)
      .min(SUPPORT_HOURS.min, SUPPORT_HOURS_MESSAGE)
      .max(SUPPORT_HOURS.max, SUPPORT_HOURS_MESSAGE),
  })
  .strict();

/** The support list's query (spec "GET /platform/support-grants"), strict. */
const GRANTS_QUERY = z.object({ companyId: COMPANY_ID.optional() }).strict();

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

/** Support access, from the platform admin's side (blueprint role rule 6; ADR 0034; ADR 0053). */
@Controller("platform/support-grants")
@SessionOnly()
@UseGuards(PlatformAdminGuard)
export class PlatformSupportGrantsController {
  constructor(private readonly requests: SupportRequestsService) {}

  /** GET /platform/support-grants: the owner role lists every admin's requests, the support role its own. */
  @Get()
  list(@CurrentPlatformAdmin() admin: PlatformActor, @Query() query: unknown): Promise<PlatformSupportGrant[]> {
    return this.requests.list(admin, parse(GRANTS_QUERY, query).companyId);
  }

  /**
   * POST /platform/support-grants: any platform admin asks a company's Owner for access, after a
   * step-up; one open grant per admin and company (409) and 10 per admin in 24 hours (429).
   * Hidden (404) while `settings.users` is off: the Owner answers on Settings → Users, so no request
   * may start that no Owner could see, approve or revoke (CLAUDE.md rule 13; finding F-h, 2026-11-20).
   */
  @Post()
  @PlatformWriteRoles("owner", "support")
  @PlatformFeature("settings.users")
  request(@CurrentPlatformAdmin() admin: PlatformActor, @Body() body: unknown): Promise<{ id: string }> {
    return this.requests.request(admin, parse(SUPPORT_REQUEST, body));
  }
}
