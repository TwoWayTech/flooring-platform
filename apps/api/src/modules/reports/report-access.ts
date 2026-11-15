import { ForbiddenException } from "@nestjs/common";
import { REPORT_CATALOG, REPORT_WHOLE_COMPANY, type ReportKey } from "@workspace/shared";
import type { RequestAccess } from "../../core/access/access.service";
import { requireFeature } from "../sales/sales-common";

/**
 * A report's switches (CLAUDE.md rule 13): the hub's, then the report's own when one is named.
 * Either off answers 404, so a switched-off report is hidden on the API as on the screens (ADR 0055
 * "Switches").
 */
export function requireReport(key?: ReportKey): void {
  requireFeature("reports.hub");
  if (key) requireFeature(REPORT_CATALOG[key].feature);
}

/**
 * The Business report and Profit and loss cover the whole company, so only data scope `all` opens
 * them (ADR 0055 S1): shared costs, balances, cash, taxes and people costs have no branch version,
 * and a branch's share of a company-wide cost would give away the other branches' revenue. Anyone
 * else gets 403, whatever permission their role holds, as for the books (`requireCompanyWide`).
 */
export function requireWholeCompany(access: Pick<RequestAccess, "dataScope">): void {
  if (access.dataScope !== "all") {
    throw new ForbiddenException({ code: "forbidden", message: REPORT_WHOLE_COMPANY });
  }
}
