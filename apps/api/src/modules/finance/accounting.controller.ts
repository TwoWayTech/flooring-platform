import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { ACCOUNTING_INPUT, loadAccounting } from "../../core/ledger/accounting-settings";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { AccountingService } from "./accounting.service";

/**
 * How the company keeps its books: costing method, sales tax basis and bank accounts (owner
 * decision 2026-11-14; ADR 0040). The Accountant and the Owner manage it with
 * `settings.payments.manage`, which needs MFA, because it decides where money posts.
 */
@Controller("settings/accounting")
@RequireModule("core")
export class AccountingController {
  constructor(
    private readonly tenancy: TenantConnectionService,
    private readonly accounting: AccountingService,
    private readonly auditLog: AuditService,
  ) {}

  /** GET /settings/accounting: the saved settings, or the defaults. */
  @Get()
  @RequirePermission("settings.payments.manage")
  async read(@CurrentTenant() tenant: TenantContext) {
    return loadAccounting(await this.tenancy.db(tenant));
  }

  /** PUT /settings/accounting: saves the settings and the bank ledger accounts. Audited. */
  @Put()
  @RequirePermission("settings.payments.manage")
  @Audited()
  async save(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    const input = parse(ACCOUNTING_INPUT, body);
    const actor = actorOf(access, session, request);
    const db = await this.tenancy.db(tenant);
    return db.transaction(async (tx) => {
      const { before, after } = await this.accounting.save(tx, input, access.userId);
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "settings",
          action: "Changed accounting settings",
          targetType: "settings",
          targetLabel: "Accounting",
          before,
          after,
        },
        tx,
      );
      return after;
    });
  }
}
