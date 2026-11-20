import { Body, Controller, ForbiddenException, Get, Header, Put, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import {
  companyProfileProblem,
  expenseSettingsProblem,
  numberSettingsProblem,
  numbersToWire,
  paymentSettingsProblem,
  SETTINGS_SCOPE_MESSAGE,
  SETTINGS_SECTIONS,
  type CompanyProfile,
  type ExpenseSettings,
  type NumberSettingsWire,
  type PaymentSettings,
  type SettingsAnswer,
} from "@workspace/shared";
import type { Request } from "express";
import type { RequestAccess } from "../../core/access/access.service";
import { AnyCompanyMember, Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { StepUpService } from "../../core/auth/step-up.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { refuse, requireFeature } from "../sales/sales-common";
import { EXPENSES_INPUT, NUMBERS_INPUT, PAYMENTS_INPUT, PROFILE_INPUT } from "./settings-input";
import { SettingsService } from "./settings.service";

/**
 * Settings bind the whole company, so a save needs data scope `all` (ADR 0059 D4), as the books do
 * (ADR 0040); anyone narrower gets 403, whatever key their role holds.
 */
function requireWholeCompany(access: RequestAccess): void {
  if (access.dataScope !== "all") throw new ForbiddenException({ code: "forbidden", message: SETTINGS_SCOPE_MESSAGE });
}

/** Refuses a body the shared content rules refuse, with their words (400 `invalid_request`). */
function check(problem: string | null): void {
  if (problem) throw refuse(problem);
}

/**
 * Settings part 1 on the API (ADR 0059; module 4 of docs/real-build-plan.md): the company profile,
 * number format, payment rules and expense approval. Each PUT takes its keys and module from the
 * shared `SETTINGS_SECTIONS` (CLAUDE.md rule 4), so the guards answer 401, then 403 for the company,
 * MFA, the module or the key. In the handler, in order: the page's switch (404), data scope `all`
 * (403), the strict body (400), the shared content rules (400), for Payments a step-up (403
 * `step_up_required`, after the content checks so a refused value never costs a code), then the save
 * with its audit entry under a row lock. The company is only ever the session's.
 */
@ApiTags("settings")
@ApiCookieAuth()
@Controller("settings")
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly stepUp: StepUpService,
  ) {}

  /**
   * GET /settings: the served sections this person reads (ADR 0059 D3). `@AnyCompanyMember()` is
   * used for company reference data every screen reads, as on `GET /locations` and `GET /company`:
   * the answer is cut per person by `readableSections` and `profileFor`, so a member gets the profile
   * (the EIN only with `settings.company.manage`) and the number format, and payment rules and
   * expense approval only with a key whose screens read them. The sensitive-field interceptor still
   * runs, and no property is a reserved name (the number format's decimals are a list). A read: not
   * audited, and never cached.
   */
  @Get()
  @AnyCompanyMember()
  @Header("Cache-Control", "no-store")
  read(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess): Promise<SettingsAnswer> {
    return this.settings.answer(tenant, access);
  }

  /** PUT /settings/profile: the company profile printed on documents. Answers it as saved. */
  @Put("profile")
  @RequirePermission(...SETTINGS_SECTIONS.profile.keys)
  @Audited()
  async saveProfile(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<CompanyProfile> {
    requireFeature(SETTINGS_SECTIONS.profile.feature);
    requireWholeCompany(access);
    const profile = parse(PROFILE_INPUT, body);
    check(companyProfileProblem(profile));
    await this.settings.save(tenant, actorOf(access, session, request), "profile", profile, (value) => value);
    return profile;
  }

  /** PUT /settings/numbers: the number format, sent and answered with its decimals as a list. */
  @Put("numbers")
  @RequirePermission(...SETTINGS_SECTIONS.numbers.keys)
  @Audited()
  async saveNumbers(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<NumberSettingsWire> {
    requireFeature(SETTINGS_SECTIONS.numbers.feature);
    requireWholeCompany(access);
    const numbers = parse(NUMBERS_INPUT, body);
    check(numberSettingsProblem(numbers, await this.settings.current(tenant, "numbers")));
    await this.settings.save(tenant, actorOf(access, session, request), "numbers", numbers, numbersToWire);
    return numbersToWire(numbers);
  }

  /**
   * PUT /settings/payments: the two-person check, the write-off limit and the payment and refund
   * prefixes, which customer payments, write-offs and supplier payments read on the server. These
   * are fraud controls over money in and out under an MFA key, so a save also needs a step-up from
   * the last 5 minutes (ADR 0059 D5).
   */
  @Put("payments")
  @RequirePermission(...SETTINGS_SECTIONS.payments.keys)
  @RequireModule(SETTINGS_SECTIONS.payments.module)
  @Audited()
  async savePayments(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<PaymentSettings> {
    requireFeature(SETTINGS_SECTIONS.payments.feature);
    requireWholeCompany(access);
    const payments = parse(PAYMENTS_INPUT, body);
    check(paymentSettingsProblem(payments));
    await this.stepUp.require(session);
    await this.settings.save(tenant, actorOf(access, session, request), "payments", payments, (value) => value);
    return payments;
  }

  /** PUT /settings/expenses: expense approval, which the API's expenses apply. No step-up (ADR 0059 Q1). */
  @Put("expenses")
  @RequirePermission(...SETTINGS_SECTIONS.expenses.keys)
  @RequireModule(SETTINGS_SECTIONS.expenses.module)
  @Audited()
  async saveExpenses(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<ExpenseSettings> {
    requireFeature(SETTINGS_SECTIONS.expenses.feature);
    requireWholeCompany(access);
    const expenses = parse(EXPENSES_INPUT, body);
    check(expenseSettingsProblem(expenses));
    await this.settings.save(tenant, actorOf(access, session, request), "expenses", expenses, (value) => value);
    return expenses;
  }
}
