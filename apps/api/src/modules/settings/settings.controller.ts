import { Body, Controller, ForbiddenException, Get, Header, Put, Req } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import {
  companyProfileProblem,
  currencyProblem,
  datedRates,
  documentsProblem,
  expenseSettingsProblem,
  LOCALIZATION_TABS,
  numberSettingsProblem,
  numbersToWire,
  PAYMENT_CONTROLS_OWNER_ONLY,
  paymentControlsLoosened,
  paymentSettingsProblem,
  payrollProblem,
  regionKeyProblem,
  regionProblem,
  SETTINGS_SCOPE_MESSAGE,
  SETTINGS_SECTIONS,
  statesOfOperationChanged,
  taxProblem,
  type CompanyProfile,
  type CurrencyInput,
  type DocumentsInput,
  type ExpenseSettings,
  type LocalizationSettings,
  type NumberSettingsWire,
  type PaymentSettings,
  type PayrollInput,
  type RegionInput,
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
import {
  CURRENCY_INPUT,
  DOCUMENTS_INPUT,
  EXPENSES_INPUT,
  NUMBERS_INPUT,
  PAYMENTS_INPUT,
  PAYROLL_INPUT,
  PROFILE_INPUT,
  REGION_INPUT,
  TAX_INPUT,
} from "./settings-input";
import { settingsMissing, SettingsService } from "./settings.service";

/**
 * Settings bind the whole company, so a save needs data scope `all` (ADR 0059 D4), as the books do
 * (ADR 0040); anyone narrower gets 403, whatever key their role holds. Warehouses and showrooms use
 * it too (ADR 0059, part 4a, D23).
 */
export function requireWholeCompany(access: RequestAccess): void {
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
 * with its audit entry under a row lock. The company is only ever the session's. Part 2a adds Sales
 * and documents and Payroll rules, one tab of the localization row each. Part 2b adds Region and
 * Currency; their checks that read the stored tab run inside the save, under the row lock. Part 3a
 * adds Sales tax, whose save versions the rule and county-rate tables under the row's lock.
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
   * the last 5 minutes (ADR 0059 D5). Loosening one (approval off, a higher approval amount or
   * write-off limit, an empty write-off limit) is the Owner's alone, judged against the stored row
   * under its lock and before the code is asked for (owner's answer to Q10, ADR 0059 "2026-11-20").
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
    await this.settings.save(
      tenant,
      actorOf(access, session, request),
      "payments",
      payments,
      (value) => value,
      async (current) => {
        if (!access.isOwner && paymentControlsLoosened(payments, current)) {
          throw new ForbiddenException({ code: "owner_only", message: PAYMENT_CONTROLS_OWNER_ONLY });
        }
        await this.stepUp.require(session);
      },
    );
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

  /**
   * PUT /settings/localization/documents: Sales and documents (ADR 0059, part 2a). One key, never the
   * section's any-of; module `core`; no step-up (D6). Only this tab of the localization row changes,
   * and a company with no localization row gets 409 (D7). Answers the tab as saved.
   */
  @Put("localization/documents")
  @RequirePermission(...LOCALIZATION_TABS.documents.keys)
  @RequireModule(LOCALIZATION_TABS.documents.module)
  @Audited()
  async saveDocuments(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<DocumentsInput> {
    requireFeature(LOCALIZATION_TABS.documents.feature);
    requireWholeCompany(access);
    const documents = parse(DOCUMENTS_INPUT, body);
    check(documentsProblem(documents));
    return this.settings.saveLocalizationTab(tenant, actorOf(access, session, request), "documents", () => documents);
  }

  /**
   * PUT /settings/localization/payroll: the Payroll rules tab (ADR 0059, part 2a). One key; module
   * `hr`; the California rule is refused while its switch is off (ADR 0050). Only this tab of the
   * localization row changes, and a company with no localization row gets 409. Answers the tab as saved.
   */
  @Put("localization/payroll")
  @RequirePermission(...LOCALIZATION_TABS.payroll.keys)
  @RequireModule(LOCALIZATION_TABS.payroll.module)
  @Audited()
  async savePayroll(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<PayrollInput> {
    requireFeature(LOCALIZATION_TABS.payroll.feature);
    requireWholeCompany(access);
    const payroll = parse(PAYROLL_INPUT, body);
    check(payrollProblem(payroll));
    return this.settings.saveLocalizationTab(tenant, actorOf(access, session, request), "payroll", () => payroll);
  }

  /**
   * PUT /settings/localization/region (ADR 0059, part 2b). One key, `platform` (no module guard, as
   * profile and numbers). The zone must be the company's own (control `tenants.time_zone`), country
   * and locale the stored ones; a change of the states of operation also needs `settings.tax.manage`
   * (403) and a step-up, because the company default tax rate applies only in them. Every check that
   * reads the stored region runs under the row lock. Answers the tab as saved.
   */
  @Put("localization/region")
  @RequirePermission(...LOCALIZATION_TABS.region.keys)
  @Audited()
  async saveRegion(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<RegionInput> {
    requireFeature(LOCALIZATION_TABS.region.feature);
    requireWholeCompany(access);
    const region = parse(REGION_INPUT, body);
    return this.settings.saveLocalizationTab(tenant, actorOf(access, session, request), "region", async (current) => {
      if (!current) throw settingsMissing();
      check(regionProblem(region, current));
      const keys = regionKeyProblem(region, current, (key) => access.permissions.has(key));
      if (keys) throw new ForbiddenException({ code: "forbidden", message: keys });
      if (statesOfOperationChanged(region, current)) await this.stepUp.require(session);
      return region;
    });
  }

  /**
   * PUT /settings/localization/currency (ADR 0059, part 2b). The base currency, its lock and the codes
   * stay; rates change. Always a step-up, after the content checks (blueprint p21 rule 4, as
   * Payments), and a changed rate is dated the company's day. Every check that reads the stored
   * currency runs under the row lock. Answers the tab as saved.
   */
  @Put("localization/currency")
  @RequirePermission(...LOCALIZATION_TABS.currency.keys)
  @Audited()
  async saveCurrency(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<CurrencyInput> {
    requireFeature(LOCALIZATION_TABS.currency.feature);
    requireWholeCompany(access);
    const currency = parse(CURRENCY_INPUT, body);
    return this.settings.saveLocalizationTab(
      tenant,
      actorOf(access, session, request),
      "currency",
      async (current, clock) => {
        if (!current) throw settingsMissing();
        check(currencyProblem(currency, current));
        await this.stepUp.require(session);
        return datedRates(currency, current, clock.day);
      },
    );
  }

  /**
   * PUT /settings/localization/tax: the Sales tax tab (ADR 0059, part 3a). One key, `settings.tax.manage`
   * (an MFA key), `platform` (no module guard, D5); the page's switch, scope `all`, a strict body, then
   * under the row's lock the shared rules against the tab in force and always a step-up, after them
   * (blueprint p21 rule 4; Payments' order, so a refused value never costs a code). A changed rule or
   * county rate becomes a new row from the company's day and the rows it replaces end the day before,
   * so issued invoices keep the tax they used. Answers the tab in force after the save.
   */
  @Put("localization/tax")
  @RequirePermission(...LOCALIZATION_TABS.tax.keys)
  @Audited()
  async saveTax(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ): Promise<LocalizationSettings["tax"]> {
    requireFeature(LOCALIZATION_TABS.tax.feature);
    requireWholeCompany(access);
    const tax = parse(TAX_INPUT, body);
    return this.settings.saveTax(tenant, actorOf(access, session, request), async (current) => {
      check(taxProblem(tax, current));
      await this.stepUp.require(session);
      return tax;
    });
  }
}
