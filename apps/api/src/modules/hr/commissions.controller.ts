import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from "@nestjs/common";
import { ADJUSTMENT_AMOUNT, dec } from "@workspace/shared";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { DAY, refuse, requireFeature } from "../sales/sales-common";
import { requireCommissions } from "./commission-records";
import { CommissionsService } from "./commissions.service";

/** A month as the screens send it, `yyyy-MM`. */
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month.");

const TEXT = z.string().max(500);
const FIGURE = z.string().trim().max(20);

/** An adjustment in dollars and cents, up to twelve digits; `adjustmentProblem` caps it at 1,000,000.00 (ADR 0048). */
const ADJUSTMENT = z.string().trim().regex(ADJUSTMENT_AMOUNT, "Enter an amount, for example 150 or -75.");

const APPROVE = z.object({ userId: z.uuid(), month: MONTH }).strict();

const ADJUST = z
  .object({ userId: z.uuid(), month: MONTH, amount: ADJUSTMENT, invoiceId: z.uuid().nullable(), reason: TEXT })
  .strict();

const DECIDE = z
  .object({
    userId: z.uuid(),
    month: MONTH,
    lineId: z.string().max(300),
    outcome: z.enum(["applied", "waived"]),
    reason: TEXT,
  })
  .strict();

const PLAN = z
  .object({
    name: z.string().max(120),
    basis: z.enum(["paid_revenue", "gross_margin"]),
    baseRatePct: FIGURE,
    monthlyTarget: FIGURE,
    tierMode: z.enum(["marginal", "retroactive"]),
    tiers: z.array(z.object({ fromPctOfTarget: FIGURE, ratePct: FIGURE }).strict()).max(10),
    overridePct: FIGURE,
    draw: z.object({ kind: z.enum(["none", "recoverable", "non_recoverable"]), monthlyAmount: FIGURE }).strict(),
    clawbackDays: z.number().int(),
  })
  .strict();

const ASSIGN = z
  .object({
    userId: z.uuid(),
    planId: z.uuid(),
    effectiveFrom: DAY,
    monthlyTargetOverride: FIGURE.nullable().optional(),
  })
  .strict();

const RANGE = z.object({ from: DAY, to: DAY }).strict();

/** An own monthly target, or null for the plan's: blank means none; otherwise money above zero. */
function ownTarget(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value) || !dec(value).gt(0)) {
    throw refuse("Enter the monthly target in dollars and cents, or leave it blank.");
  }
  return value;
}

/**
 * HR → Commissions (commissions.md; ADR 0048), in the `hr` module, behind `hr.commissions`, for a
 * Flooring Suite company and company-wide data scope (`requireCommissions`). Keys are commissions.md
 * "Who uses it": `hr.commission.view` reads, `hr.commission.manage` saves plans and assigns them,
 * `hr.commission.approve` approves statements and decides reversals, `hr.commission.adjust` adds
 * adjustments. A statement is paid through a pay run (`/pay-periods`).
 */
@Controller()
@RequireModule("hr")
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}

  /** GET /commissions: statements for the last twelve months, plans, assignments, people and invoice numbers. */
  @Get("commissions")
  @RequirePermission("hr.commission.view")
  data(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireCommissions(access);
    return this.commissions.data(tenant, access);
  }

  /** POST /commission-statements/approve: approves one person's month and accrues its payable. */
  @Post("commission-statements/approve")
  @RequirePermission("hr.commission.approve")
  @Audited()
  approve(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireCommissions(access);
    const input = parse(APPROVE, body);
    return this.commissions.approve(tenant, actorOf(access, session, request), input.userId, input.month);
  }

  /** POST /commission-adjustments: a manual change to an open statement, with a reason. */
  @Post("commission-adjustments")
  @RequirePermission("hr.commission.adjust")
  @Audited()
  async adjust(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireCommissions(access);
    await this.commissions.adjust(tenant, actorOf(access, session, request), parse(ADJUST, body));
    return { ok: true };
  }

  /** POST /commission-reversals/decide: accepts or waives a reversal that arrived after its window. */
  @Post("commission-reversals/decide")
  @RequirePermission("hr.commission.approve")
  @Audited()
  async decide(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireCommissions(access);
    await this.commissions.decide(tenant, actorOf(access, session, request), parse(DECIDE, body));
    return { ok: true };
  }

  /** POST /commission-plans: adds a plan, version 1 from today. */
  @Post("commission-plans")
  @RequirePermission("hr.commission.manage")
  @Audited()
  addPlan(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireCommissions(access);
    return this.commissions.savePlan(tenant, actorOf(access, session, request), null, parse(PLAN, body));
  }

  /** PUT /commission-plans/:id: saves a plan; one already used becomes a new version from today. */
  @Put("commission-plans/:id")
  @RequirePermission("hr.commission.manage")
  @Audited()
  savePlan(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireCommissions(access);
    return this.commissions.savePlan(tenant, actorOf(access, session, request), id, parse(PLAN, body));
  }

  /** POST /commission-assignments: puts someone on a plan from a date. */
  @Post("commission-assignments")
  @RequirePermission("hr.commission.manage")
  @Audited()
  assign(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireCommissions(access);
    const input = parse(ASSIGN, body);
    return this.commissions.assign(tenant, actorOf(access, session, request), {
      ...input,
      monthlyTargetOverride: ownTarget(input.monthlyTargetOverride),
    });
  }
}

/**
 * Sales → Team's commission column (commissions.md rule 17, `teamCommission`; ADR 0048): in the
 * `core` module, behind `sales.team`, for holders of `sales.commission.view`, narrowed by data scope.
 */
@Controller()
@RequireModule("core")
export class CommissionTotalsController {
  constructor(private readonly commissions: CommissionsService) {}

  /** GET /commission-totals?from&to: earned, paid and pending commission per person in the range. */
  @Get("commission-totals")
  @RequirePermission("sales.commission.view")
  totals(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @Query() query: Record<string, unknown>,
  ) {
    requireFeature("sales.team");
    return this.commissions.totals(tenant, access, parse(RANGE, query));
  }
}
