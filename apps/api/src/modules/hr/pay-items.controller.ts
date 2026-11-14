import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { PAYMENT_METHODS } from "@workspace/shared";
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
import { BonusesService } from "./bonuses.service";
import { ContractorPaymentsService } from "./contractor-payments.service";
import { MONEY } from "./hr-input";
import { requireCompanyWidePayroll } from "./pay-records";

const BONUS = z
  .object({
    employeeId: z.uuid(),
    amount: MONEY,
    kind: z.enum(["production", "flat_sum", "discretionary"]),
    periodStart: DAY,
    periodEnd: DAY,
    reason: z.string().max(500),
  })
  .strict();

const CONTRACTOR_PAYMENT = z
  .object({ employeeId: z.uuid(), date: DAY, description: z.string().max(200), amount: MONEY })
  .strict();

const PAY = z.object({ method: z.enum(PAYMENT_METHODS) }).strict();

const VOID = z.object({ reason: z.string().max(500) }).strict();

/** Every payroll route: the `hr.pay-periods` switch (CLAUDE.md rule 13) and company-wide data scope. */
function payroll(access: RequestAccess): void {
  requireFeature("hr.pay-periods");
  requireCompanyWidePayroll(access);
}

/**
 * Bonuses and contractor payments (hr.md "Bonus", "ContractorPayment"; ADR 0047), shown on the Pay
 * periods screen, so behind `hr.pay-periods`. hr.md has no keys of their own: reading needs
 * `hr.payroll.view`, adding and voiding `hr.payroll.approve`, and paying a contractor
 * `hr.payroll.export`, the key that hands pay to the outside world.
 */
@Controller()
@RequireModule("hr")
export class PayItemsController {
  constructor(
    private readonly bonuses: BonusesService,
    private readonly contractors: ContractorPaymentsService,
  ) {}

  /** GET /bonuses: every live bonus. */
  @Get("bonuses")
  @RequirePermission("hr.payroll.view")
  listBonuses(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    payroll(access);
    return this.bonuses.list(tenant);
  }

  /** POST /bonuses: adds an approved bonus for someone else. */
  @Post("bonuses")
  @RequirePermission("hr.payroll.approve")
  @Audited()
  addBonus(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    payroll(access);
    return this.bonuses.add(tenant, actorOf(access, session, request), parse(BONUS, body));
  }

  /** POST /bonuses/:id/void: voids a bonus whose run is not approved. */
  @Post("bonuses/:id/void")
  @RequirePermission("hr.payroll.approve")
  @Audited()
  async voidBonus(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    payroll(access);
    await this.bonuses.void(tenant, actorOf(access, session, request), id, parse(VOID, body).reason);
    return { ok: true };
  }

  /** GET /contractor-payments: every live contractor payment. */
  @Get("contractor-payments")
  @RequirePermission("hr.payroll.view")
  listContractorPayments(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    payroll(access);
    return this.contractors.list(tenant);
  }

  /** POST /contractor-payments: records an approved payment to make to a 1099 contractor. */
  @Post("contractor-payments")
  @RequirePermission("hr.payroll.approve")
  @Audited()
  addContractorPayment(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    payroll(access);
    return this.contractors.add(tenant, actorOf(access, session, request), parse(CONTRACTOR_PAYMENT, body));
  }

  /** POST /contractor-payments/:id/pay: pays it by a method today and posts it; not by whoever recorded it. */
  @Post("contractor-payments/:id/pay")
  @RequirePermission("hr.payroll.export")
  @Audited()
  payContractor(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    payroll(access);
    return this.contractors.pay(tenant, actorOf(access, session, request), id, parse(PAY, body).method);
  }

  /** POST /contractor-payments/:id/void: voids it, reversing a paid one on the void day. */
  @Post("contractor-payments/:id/void")
  @RequirePermission("hr.payroll.approve")
  @Audited()
  async voidContractorPayment(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    payroll(access);
    await this.contractors.void(tenant, actorOf(access, session, request), id, parse(VOID, body).reason);
    return { ok: true };
  }
}
