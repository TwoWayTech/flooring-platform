import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
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
import { HOURS, requireAnyFeature, SIGNED_HOURS } from "./hr-input";
import { TimeOffService } from "./time-off.service";

const REQUEST = z
  .object({
    employeeId: z.uuid(),
    policyId: z.uuid(),
    start: DAY,
    end: DAY,
    hours: HOURS,
    note: z.string().max(500),
  })
  .strict();

const DECISION = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }).strict(),
  z.object({ action: z.literal("deny"), reason: z.string().max(500) }).strict(),
]);

const ADJUSTMENT = z
  .object({ employeeId: z.uuid(), policyId: z.uuid(), hours: SIGNED_HOURS, note: z.string().max(500) })
  .strict();

const OPTIONAL_HOURS = z.union([z.literal(""), HOURS]);

/** A policy as Settings → HR sends it (hr.md "TimeOffPolicy"); an empty cap or limit means none. */
const POLICY = z
  .object({
    name: z.string().max(120),
    kind: z.enum(["vacation", "sick", "personal", "unpaid"]),
    paid: z.boolean(),
    accrualMethod: z.enum(["per_pay_period", "per_hour_worked", "annual_grant", "none"]),
    accrualRate: z
      .string()
      .trim()
      .regex(/^\d{1,6}(\.\d{1,8})?$/, "Enter the accrual rate, such as 3.08."),
    capHours: OPTIONAL_HOURS,
    annualUseLimitHours: OPTIONAL_HOURS,
    carryoverHours: OPTIONAL_HOURS,
    waitingPeriodDays: z.number().int().min(0).max(3650),
    allowNegative: z.boolean(),
  })
  .strict();

/**
 * HR → Time off and its policies (hr.md "Time off"; ADR 0046), in the `hr` module. Behind
 * `hr.time-off`; policies are saved from Settings → HR (`settings.hr`).
 */
@Controller()
@RequireModule("hr")
export class TimeOffController {
  constructor(private readonly timeOff: TimeOffService) {}

  /** GET /time-off-policies: the company's policies (reference data). */
  @Get("time-off-policies")
  @RequirePermission("hr.pto.view", "hr.employee.view", "settings.hr.manage")
  listPolicies(@CurrentTenant() tenant: TenantContext) {
    requireAnyFeature("hr.time-off", "settings.hr");
    return this.timeOff.listPolicies(tenant);
  }

  /** GET /time-off-entries: the balance ledger within the person's data scope. */
  @Get("time-off-entries")
  @RequirePermission("hr.pto.view")
  listEntries(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("hr.time-off");
    return this.timeOff.listEntries(tenant, access);
  }

  /** GET /pto-requests: requests within the person's data scope. */
  @Get("pto-requests")
  @RequirePermission("hr.pto.view")
  listRequests(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("hr.time-off");
    return this.timeOff.listRequests(tenant, access);
  }

  /** POST /pto-requests: one's own request with `hr.pto.request`, someone else's with `hr.pto.approve`. */
  @Post("pto-requests")
  @RequirePermission("hr.pto.request", "hr.pto.approve")
  @Audited()
  request(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("hr.time-off");
    return this.timeOff.request(tenant, actorOf(access, session, request), parse(REQUEST, body));
  }

  /** POST /pto-requests/:id/decision: approves or declines; never one's own. */
  @Post("pto-requests/:id/decision")
  @RequirePermission("hr.pto.approve")
  @Audited()
  decide(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("hr.time-off");
    return this.timeOff.decide(tenant, actorOf(access, session, request), id, parse(DECISION, body));
  }

  /** POST /pto-requests/:id/cancel: cancels a pending or approved request that has not started. */
  @Post("pto-requests/:id/cancel")
  @RequirePermission("hr.pto.request", "hr.pto.approve")
  @Audited()
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    requireFeature("hr.time-off");
    return this.timeOff.cancel(tenant, actorOf(access, session, request), id);
  }

  /** POST /time-off-adjustments: adds or takes hours from someone else's balance, with a reason. */
  @Post("time-off-adjustments")
  @RequirePermission("hr.pto.approve")
  @Audited()
  adjust(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("hr.time-off");
    return this.timeOff.adjust(tenant, actorOf(access, session, request), parse(ADJUSTMENT, body));
  }

  /** POST /time-off-policies: adds a policy (Settings → HR). */
  @Post("time-off-policies")
  @RequirePermission("settings.hr.manage")
  @Audited()
  addPolicy(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("settings.hr");
    return this.timeOff.savePolicy(tenant, actorOf(access, session, request), null, parse(POLICY, body));
  }

  /** PUT /time-off-policies/:id: edits a policy (Settings → HR). */
  @Put("time-off-policies/:id")
  @RequirePermission("settings.hr.manage")
  @Audited()
  editPolicy(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("settings.hr");
    return this.timeOff.savePolicy(tenant, actorOf(access, session, request), id, parse(POLICY, body));
  }
}
