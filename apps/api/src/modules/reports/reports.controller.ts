import { Controller, Get, Header, Query } from "@nestjs/common";
import type { BusinessReport, Report, ReportOptions } from "@workspace/shared";
import type { RequestAccess } from "../../core/access/access.service";
import { RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { RequireProduct } from "../../core/tenancy/access";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { requireReport, requireWholeCompany } from "./report-access";
import {
  parseBusinessQuery,
  parseOptionsQuery,
  parsePaymentsQuery,
  parsePnlQuery,
  parseSalesQuery,
} from "./report-params";
import { ReportsService } from "./reports.service";

/** Reports hold a company's figures: never kept by a browser or a shared cache (ADR 0055 S11). */
const NO_STORE = "private, no-store";

/**
 * The reports hub on the API (spec docs/product-spec/reports.md; ADR 0055). Flooring Suite only and
 * module `core` (S13). Every route only reads, so the AuditInterceptor writes nothing and nobody is
 * notified. In each handler: the guards (401, then 403 for product, module, MFA or permission), the
 * switches (404), the whole-company check where the report needs it (403), the query (400), then
 * the report. The removed reports have no route (S14), and exports stay in the browser (S15).
 */
@Controller("reports")
@RequireProduct("flooring")
@RequireModule("core")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** GET /reports/options: which reports this person may open and export, and the pickers (S1, S15). */
  @Get("options")
  @RequirePermission("reports.sales.view", "reports.financial.view")
  @Header("Cache-Control", NO_STORE)
  async options(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @Query() query: unknown,
  ): Promise<ReportOptions> {
    requireReport();
    parseOptionsQuery(query);
    return this.reports.options(tenant, access);
  }

  /** GET /reports/business?from=&to=&…: the Business report (spec F2, rules 1 to 23; S1, S8). */
  @Get("business")
  @RequirePermission("reports.financial.view")
  @Header("Cache-Control", NO_STORE)
  async business(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @Query() query: unknown,
  ): Promise<BusinessReport> {
    requireReport("business");
    requireWholeCompany(access);
    return this.reports.business(tenant, access, parseBusinessQuery(query));
  }

  /** GET /reports/pnl?range=&locationId=: Profit and loss by month (spec rule 24; S1, S18). */
  @Get("pnl")
  @RequirePermission("reports.financial.view")
  @Header("Cache-Control", NO_STORE)
  async pnl(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @Query() query: unknown,
  ): Promise<Report> {
    requireReport("pnl");
    requireWholeCompany(access);
    return this.reports.pnl(tenant, access, parsePnlQuery(query));
  }

  /** GET /reports/sales-by-category?range=&locationId=&category=: in the person's data scope (rule 24; S2, S6). */
  @Get("sales-by-category")
  @RequirePermission("reports.sales.view")
  @Header("Cache-Control", NO_STORE)
  async salesByCategory(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @Query() query: unknown,
  ): Promise<Report> {
    requireReport("sales");
    return this.reports.salesByCategory(tenant, access, parseSalesQuery(query));
  }

  /** GET /reports/payments?range=&locationId=&method=&customer=: in the person's data scope (rule 24; S2). */
  @Get("payments")
  @RequirePermission("reports.financial.view")
  @Header("Cache-Control", NO_STORE)
  async payments(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @Query() query: unknown,
  ): Promise<Report> {
    requireReport("payments");
    return this.reports.payments(tenant, access, parsePaymentsQuery(query));
  }
}
