import { Body, Controller, ForbiddenException, Get, Inject, Post, Query, Req } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CONTROL_DB } from "../../core/database/control-db";
import { LedgerService } from "../../core/ledger/ledger.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { companyToday, DAY, refuse } from "../sales/sales-common";

const THROUGH = z.object({ through: DAY.optional() });

/**
 * The books are company-wide totals and cannot be cut to one branch, so they are for people whose
 * data scope is the whole company (CLAUDE.md rule 3; PR #16 review). Anyone else gets 403.
 */
function requireCompanyWide(access: RequestAccess): void {
  if (access.dataScope !== "all") {
    throw new ForbiddenException({ code: "forbidden", message: "The books cover the whole company." });
  }
}
const CLOSE = z.object({ through: DAY, note: z.string().max(500) });

/**
 * The ledger's reads and the period close (blueprint page 48; ADR 0039). People never see debits
 * and credits on their own screens (blueprint page 24); the trial balance is for the accountant.
 */
@Controller("ledger")
@RequireModule("core")
export class LedgerController {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly ledger: LedgerService,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
  ) {}

  /** GET /ledger/trial-balance?through=: every account's totals, and whether debits equal credits. */
  @Get("trial-balance")
  @RequirePermission("reports.financial.view")
  async trialBalance(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @Query() query: unknown,
  ) {
    requireCompanyWide(access);
    const { through } = parse(THROUGH, query);
    return this.ledger.trialBalance(await this.tenancy.db(tenant), through);
  }

  /** GET /ledger/period-close: the last closed day, or null. */
  @Get("period-close")
  @RequirePermission("reports.financial.view", "settings.company.manage")
  async closedThrough(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireCompanyWide(access);
    return { closedThrough: await this.ledger.closedThrough(await this.tenancy.db(tenant)) };
  }

  /** POST /ledger/period-close: closes the books through a day, or reopens to an earlier one. Audited. */
  @Post("period-close")
  @RequirePermission("settings.company.manage")
  @Audited()
  async close(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    const { through, note } = parse(CLOSE, body);
    requireCompanyWide(access);
    // Closing a day that has not come would stop all recording until someone reopens it. Today may
    // be closed at the end of the day.
    if (through > (await companyToday(this.control.db, tenant))) {
      throw refuse("Close only today or an earlier day.");
    }
    const actor = actorOf(access, session, request);
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const before = await this.ledger.closePeriod(tx, through, note.trim(), access.userId);
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "settings",
          action: before && through < before ? "Reopened books" : "Closed books",
          targetType: "ledger",
          targetLabel: `through ${through}`,
          before: { closedThrough: before },
          after: { closedThrough: through, note: note.trim() },
        },
        tx,
      );
    });
    return { closedThrough: through };
  }
}
