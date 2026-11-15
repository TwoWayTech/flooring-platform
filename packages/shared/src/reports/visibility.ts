import type { BusinessVisibility } from "../business-report";
import { SENSITIVE, type PermissionKey } from "../permissions/catalog";

/** What a person may see inside reports (spec "Who uses it"; ADR 0055 S3, S4, S5, S6, S17, S18). */
export type ReportVisibility = BusinessVisibility;

/** Facts about the company's data that visibility depends on. */
export interface ReportFacts {
  /** Whether a live invoice has a contract: its cost is the contract's estimated cost share (ADR 0055 S4). */
  hasContractInvoices: boolean;
}

/**
 * What a person may see inside reports, worked out once on the server (and in the demo) from their
 * effective permissions, so a switched-off module's keys are already gone (ADR 0055 "Visibility").
 * The report builders leave out everything a false flag hides; nothing is blanked afterwards.
 */
export function reportVisibility(
  viewer: { permissions: ReadonlySet<PermissionKey> },
  facts: ReportFacts,
): ReportVisibility {
  const has = (key: PermissionKey) => viewer.permissions.has(key);
  // Stock on hand and purchases at order cost show product cost (spec "Who uses it", Stock on hand; S5).
  const stock = has(SENSITIVE.productCost);
  // Cost of goods and everything worked out from it (gross, operating expenses, net, Profit by
  // location, Margin columns, the COGS drill) needs the margin key (spec "Who uses it") and the
  // product-cost key, because invoice cost is product cost (blueprint p27; S17). While a live invoice
  // has a contract, its cost is the contract's estimated cost share, which only contract-cost holders
  // see on the sales routes (`contractCostShown`), so their key is needed too (S4).
  const margin =
    has(SENSITIVE.margin) && stock && (has("contracts.contract.view_sensitive") || !facts.hasContractInvoices);
  // Pay sight is the pay periods key, the rule GET /expenses and GET /pay-periods already use
  // (ADR 0041; S3): without it, no figure contains pay.
  const payroll = has("hr.payroll.view");
  // The People costs section lists each person's gross pay, so it also needs the pay-rate key
  // (spec "Who uses it", See People costs; S3).
  const people = payroll && has(SENSITIVE.payRate);
  return { margin, payroll, people, stock };
}
