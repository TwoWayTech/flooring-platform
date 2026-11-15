import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_AUDIT_PAGE,
  PLATFORM_AUDIT_QUERY_MESSAGES as MESSAGES,
  type PlatformAuditResult,
} from "@workspace/shared";
import { z } from "zod";
import { parse } from "../../core/access/request-actor";
import { SessionOnly } from "../../core/tenancy/access";
import { CurrentPlatformAdmin, PlatformAdminGuard, type PlatformActor } from "./platform-admin.guard";
import { PlatformAuditQueryService } from "./platform-audit-query.service";
import { COMPANY_ID } from "./platform-params";

/**
 * The audit log's query (spec "GET /platform/audit", Query), strict: an unknown parameter, or one
 * sent twice (it arrives as a list), is a 400. `limit` is digits only, 1 to 100; the cursor's
 * existence is checked by the service.
 */
const AUDIT_QUERY = z
  .object({
    companyId: COMPANY_ID.optional(),
    action: z.enum(PLATFORM_AUDIT_ACTIONS, { error: MESSAGES.action }).optional(),
    before: z.string({ error: MESSAGES.before }).uuid(MESSAGES.before).optional(),
    limit: z
      .string({ error: MESSAGES.limit })
      .regex(/^[1-9][0-9]{0,2}$/, MESSAGES.limit)
      .transform(Number)
      .refine((limit) => limit >= PLATFORM_AUDIT_PAGE.min && limit <= PLATFORM_AUDIT_PAGE.max, MESSAGES.limit)
      .optional(),
  })
  .strict();

/**
 * The platform audit log (docs/specs/platform-admin.md, "GET /platform/audit"; ADR 0053). Like
 * every /platform controller it is session-only behind PlatformAdminGuard at class level, so 401,
 * the switch-off 404 and the non-admin 403 come before the query is read. Any platform admin may
 * read it; what each role sees is narrowed by PlatformAuditQueryService. Reads are not audited.
 */
@Controller("platform/audit")
@SessionOnly()
@UseGuards(PlatformAdminGuard)
export class PlatformAuditController {
  constructor(private readonly audit: PlatformAuditQueryService) {}

  /** GET /platform/audit: one page of entries, newest first. */
  @Get()
  page(@CurrentPlatformAdmin() admin: PlatformActor, @Query() query: unknown): Promise<PlatformAuditResult> {
    return this.audit.page(admin, parse(AUDIT_QUERY, query));
  }
}
