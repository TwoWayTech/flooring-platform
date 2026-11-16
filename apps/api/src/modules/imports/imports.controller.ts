import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import type { ImportBatchSummary, ImportMapping, ImportOverview, ImportPreview, ImportResult } from "@workspace/shared";
import type { Request } from "express";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { requireFeature } from "../sales/sales-common";
import { IMPORT_COMMIT, IMPORT_REQUEST, MAPPING_SAVE, parseKind } from "./import-input";
import { ImportsService } from "./imports.service";

/** Import answers hold a company's records and file contents: never kept by a browser or a shared cache (S-15). */
const NO_STORE = "private, no-store";

/**
 * Data import on the API, part 1 (docs/product-spec/import.md; ADR 0057). Both products, and no
 * module on the class: `settings.import.manage` is in the always-on `platform` module, and each
 * request's kind is checked against its own module, switch, data scope and keys in the service.
 * In each handler: the guards (401, then 403 for the company, MFA or the permission), the switch
 * (404), the body (400), then the service's checks. The company is only ever the session's.
 * Writes and the dry run write their own audit entries, or none, so they carry `@Audited()`.
 */
@Controller()
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** GET /imports: the kinds this person may import, the saved column choices and the history. */
  @Get("imports")
  @RequirePermission("settings.import.manage")
  @Header("Cache-Control", NO_STORE)
  overview(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess): Promise<ImportOverview> {
    requireFeature("settings.import");
    return this.imports.overview(tenant, access);
  }

  /** POST /imports/check: the dry run; writes nothing, so it makes no audit entry (spec). */
  @Post("imports/check")
  @HttpCode(200)
  @RequirePermission("settings.import.manage")
  @Audited()
  @Header("Cache-Control", NO_STORE)
  check(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<ImportPreview> {
    requireFeature("settings.import");
    return this.imports.check(tenant, actorOf(access, session, request), parse(IMPORT_REQUEST, body));
  }

  /** POST /imports: imports the valid rows after a step-up, if every row still does what the dry run showed. */
  @Post("imports")
  @RequirePermission("settings.import.manage")
  @Audited()
  @Header("Cache-Control", NO_STORE)
  commit(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<ImportResult> {
    requireFeature("settings.import");
    return this.imports.commit(tenant, actorOf(access, session, request), parse(IMPORT_COMMIT, body));
  }

  /** POST /imports/:id/undo: undoes one import after a step-up, or refuses with why. */
  @Post("imports/:id/undo")
  @RequirePermission("settings.import.manage")
  @Audited()
  @Header("Cache-Control", NO_STORE)
  undo(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ): Promise<ImportBatchSummary> {
    requireFeature("settings.import");
    return this.imports.undo(tenant, actorOf(access, session, request), id);
  }

  /** PUT /imports/mappings/:kind: keeps the column choices for the next file of this kind. */
  @Put("imports/mappings/:kind")
  @RequirePermission("settings.import.manage")
  @Audited()
  @Header("Cache-Control", NO_STORE)
  saveMapping(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("kind") kind: string,
    @Body() body: unknown,
  ): Promise<ImportMapping> {
    requireFeature("settings.import");
    const { columns } = parse(MAPPING_SAVE, body);
    return this.imports.saveMapping(tenant, actorOf(access, session, request), parseKind(kind), columns);
  }
}
