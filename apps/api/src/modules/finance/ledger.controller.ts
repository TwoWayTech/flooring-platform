import { Body, Controller, ForbiddenException, Get, Header, Inject, Post, Query, Req } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { seesTrialBalance, TRIAL_BALANCE_HIDDEN, type TrialBalance } from "@workspace/shared";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { StepUpService } from "../../core/auth/step-up.service";
import { CONTROL_DB } from "../../core/database/control-db";
import { LedgerService } from "../../core/ledger/ledger.service";
import { RequireProduct } from "../../core/tenancy/access";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { requireReport } from "../reports/report-access";
import { readSnapshot } from "../reports/report-records";
import { companyToday, DAY, refuse } from "../sales/sales-common";
import { requireCompanyWide } from "./company-wide";

const THROUGH = z.object({ through: DAY.optional() });

/** The books are a company's figures: never kept by a browser or a shared cache (ADR 0055 S11). */
const NO_STORE = "private, no-store";

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
    private readonly stepUp: StepUpService,
  ) {}

  /**
   * GET /ledger/trial-balance?through=: every account's totals, and whether debits equal credits.
   * The Reports hub's Trial balance (ADR 0055 "Trial balance"): Flooring Suite like the hub (403
   * `product_not_enabled`), the hub's switch (404), company-wide scope (403), the query (400), then
   * the sight rule (403), all before any figure is read. The rule and the figures come from one
   * read-only snapshot, so a pay or contract posting that lands between them can't reach someone
   * the rule would now refuse.
   */
  @Get("trial-balance")
  @RequireProduct("flooring")
  @RequirePermission("reports.financial.view")
  @Header("Cache-Control", NO_STORE)
  async trialBalance(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @Query() query: unknown,
  ): Promise<TrialBalance> {
    requireReport("trial-balance");
    requireCompanyWide(access);
    const { through } = parse(THROUGH, query);
    return readSnapshot(await this.tenancy.db(tenant), async (tx) => {
      if (!seesTrialBalance(access, await this.ledger.trialBalanceFacts(tx))) {
        throw new ForbiddenException({ code: "forbidden", message: TRIAL_BALANCE_HIDDEN });
      }
      return this.ledger.trialBalance(tx, through);
    });
  }

  /** GET /ledger/period-close: the last closed day, or null. */
  @Get("period-close")
  @RequirePermission("reports.financial.view", "settings.company.manage")
  async closedThrough(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireCompanyWide(access);
    return { closedThrough: await this.ledger.closedThrough(await this.tenancy.db(tenant)) };
  }

  /**
   * POST /ledger/period-close: closes the books through a day, or reopens to an earlier one, which
   * needs a step-up (ADR 0063). Audited.
   */
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
      // Reopening lets entries back into days already closed, a loosening of a control, so it needs a
      // step-up, judged under the period lock against the day closed before (ADR 0063). Closing
      // tightens, so it needs none.
      const before = await this.ledger.closePeriod(tx, through, note.trim(), access.userId, async (closed) => {
        if (closed && through < closed) await this.stepUp.require(session);
      });
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
