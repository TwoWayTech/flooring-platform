import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { DAY, requireFeature } from "../sales/sales-common";
import { TimesheetsService } from "./timesheets.service";

/**
 * A week of hours: seven decimal strings such as "7.5" from the company's workweek day (hr.md
 * rules 5 and 6; CLAUDE.md rule 6). The service checks 0 to 24 and two decimals (ADR 0046).
 */
const TIMESHEET = z
  .object({
    employeeId: z.uuid(),
    weekStart: DAY,
    days: z.array(z.string().max(12, "Enter hours as a number, such as 8 or 7.5.")).length(7, "A week has seven days."),
  })
  .strict();

const IDS = z.array(z.uuid()).min(1, "Choose at least one timesheet.").max(200);

const DECISION = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), ids: IDS }).strict(),
  z.object({ action: z.literal("reject"), ids: IDS, reason: z.string().max(500) }).strict(),
]);

const REASON = z.object({ reason: z.string().max(500) }).strict();

/** The template as a table of text cells; the shared import rules read it (hr.md rule 22). */
const UPLOAD = z
  .object({
    table: z
      .object({
        headers: z.array(z.string().max(100)).max(50),
        rows: z.array(z.array(z.string().max(200)).max(50)).max(2000, "Upload at most 2,000 rows at a time."),
      })
      .strict(),
    fileName: z.string().max(200),
    apply: z.boolean(),
    own: z.boolean(),
  })
  .strict();

/**
 * HR → Timesheets and the clock (hr.md "Timesheets"; ADR 0046), in the `hr` module. Behind
 * `hr.timesheets`; the clock is behind `hr.clock` and the company's clock setting.
 */
@Controller()
@RequireModule("hr")
export class TimesheetsController {
  constructor(private readonly sheets: TimesheetsService) {}

  /** GET /timesheets: own sheets, a manager's reports at branch scope, all at company-wide scope. */
  @Get("timesheets")
  @RequirePermission("hr.timesheet.view")
  list(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("hr.timesheets");
    return this.sheets.list(tenant, access);
  }

  /** GET /clock-entries: own punches, or everyone's with company-wide scope. */
  @Get("clock-entries")
  @RequirePermission("hr.timesheet.view")
  listClock(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("hr.timesheets");
    requireFeature("hr.clock");
    return this.sheets.listClock(tenant, access);
  }

  /** PUT /timesheets: saves a week's hours; one's own with edit, anyone else's with approve. */
  @Put("timesheets")
  @RequirePermission("hr.timesheet.edit", "hr.timesheet.approve")
  @Audited()
  save(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("hr.timesheets");
    return this.sheets.save(tenant, actorOf(access, session, request), parse(TIMESHEET, body));
  }

  /** POST /timesheets/:id/submit: sends a sheet for approval. */
  @Post("timesheets/:id/submit")
  @RequirePermission("hr.timesheet.edit", "hr.timesheet.approve")
  @Audited()
  submit(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    requireFeature("hr.timesheets");
    return this.sheets.submit(tenant, actorOf(access, session, request), id);
  }

  /** POST /timesheets/decisions: approves or sends back submitted sheets, all or none; never one's own. */
  @Post("timesheets/decisions")
  @RequirePermission("hr.timesheet.approve")
  @Audited()
  async decide(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("hr.timesheets");
    const { ids, ...decision } = parse(DECISION, body);
    await this.sheets.decide(tenant, actorOf(access, session, request), ids, decision);
    return { ok: true };
  }

  /** POST /timesheets/:id/reopen: an approved sheet back to draft, with a reason. */
  @Post("timesheets/:id/reopen")
  @RequirePermission("hr.timesheet.approve")
  @Audited()
  reopen(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("hr.timesheets");
    return this.sheets.reopen(tenant, actorOf(access, session, request), id, parse(REASON, body).reason);
  }

  /** POST /timesheets/upload: the template, checked (apply false) or saved (apply true). */
  @Post("timesheets/upload")
  @RequirePermission("hr.timesheet.edit", "hr.timesheet.approve")
  @Audited()
  upload(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("hr.timesheets");
    const input = parse(UPLOAD, body);
    // Someone else's rows need approve; one's own upload needs edit (hr.md "Who uses it"). The
    // service also refuses one's own rows in an approver's upload without edit.
    if (!access.permissions.has(input.own ? "hr.timesheet.edit" : "hr.timesheet.approve")) {
      throw new ForbiddenException({ code: "forbidden", message: "You can't upload these hours." });
    }
    return this.sheets.upload(tenant, actorOf(access, session, request), input);
  }

  /** POST /clock/in: the signed-in person clocks in. */
  @Post("clock/in")
  @RequirePermission("hr.portal.view")
  @Audited()
  clockIn(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
  ) {
    requireFeature("hr.timesheets");
    requireFeature("hr.clock");
    return this.sheets.clockIn(tenant, actorOf(access, session, request));
  }

  /** POST /clock/out: the signed-in person clocks out; the hours join that week's draft. */
  @Post("clock/out")
  @RequirePermission("hr.portal.view")
  @Audited()
  clockOut(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
  ) {
    requireFeature("hr.timesheets");
    requireFeature("hr.clock");
    return this.sheets.clockOut(tenant, actorOf(access, session, request));
  }
}
