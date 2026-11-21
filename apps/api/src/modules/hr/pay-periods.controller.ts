import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
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
import { PayPeriodsService } from "./pay-periods.service";
import { requireCompanyWidePayroll } from "./pay-records";

const OPEN = z.object({ date: DAY.optional() }).strict();

const EXCLUSION = z.object({ employeeId: z.uuid(), reason: z.string().max(500).nullable() }).strict();

/** Every payroll route: the `hr.pay-periods` switch (CLAUDE.md rule 13) and company-wide data scope. */
function payroll(access: RequestAccess): void {
  requireFeature("hr.pay-periods");
  requireCompanyWidePayroll(access);
}

/**
 * HR → Pay periods (hr.md "Pay periods"; ADR 0047), in the `hr` module, behind `hr.pay-periods`.
 * Keys are hr.md's "Who uses it": `hr.payroll.view` reads, `hr.payroll.approve` leaves people out,
 * approves and reopens, `hr.payroll.export` exports.
 */
@Controller("pay-periods")
@RequireModule("hr")
export class PayPeriodsController {
  constructor(private readonly periods: PayPeriodsService) {}

  /** GET /pay-periods: every period, newest first, with frozen lines once approved. */
  @Get()
  @RequirePermission("hr.payroll.view")
  list(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    payroll(access);
    return this.periods.list(tenant);
  }

  /** POST /pay-periods: opens the period holding a day (today by default) on the pay schedule; safe to repeat. */
  @Post()
  @RequirePermission("hr.payroll.view")
  @Audited()
  open(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    payroll(access);
    return this.periods.open(tenant, actorOf(access, session, request), parse(OPEN, body ?? {}).date ?? null);
  }

  /** GET /pay-periods/:id/review: the lines, who is left out, the blockers and contractor payments. */
  @Get(":id/review")
  @RequirePermission("hr.payroll.view")
  review(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    payroll(access);
    return this.periods.review(tenant, id);
  }

  /** POST /pay-periods/:id/exclusions: leaves someone out with a reason, or brings them back (null). */
  @Post(":id/exclusions")
  @RequirePermission("hr.payroll.approve")
  @Audited()
  exclude(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    payroll(access);
    const input = parse(EXCLUSION, body);
    return this.periods.setExclusion(tenant, actorOf(access, session, request), id, input.employeeId, input.reason);
  }

  /** POST /pay-periods/:id/approve: freezes the lines and posts the payroll accrual, after a step-up (ADR 0063). */
  @Post(":id/approve")
  @RequirePermission("hr.payroll.approve")
  @Audited()
  approve(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    payroll(access);
    return this.periods.approve(tenant, actorOf(access, session, request), id);
  }

  /** POST /pay-periods/:id/reopen: returns an approved run to review, reversing its postings, after a step-up (ADR 0063). */
  @Post(":id/reopen")
  @RequirePermission("hr.payroll.approve")
  @Audited()
  reopen(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    payroll(access);
    return this.periods.reopen(tenant, actorOf(access, session, request), id);
  }

  /** POST /pay-periods/:id/export: marks an approved run exported, which locks it. */
  @Post(":id/export")
  @RequirePermission("hr.payroll.export")
  @Audited()
  export(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    payroll(access);
    return this.periods.export(tenant, actorOf(access, session, request), id);
  }
}
