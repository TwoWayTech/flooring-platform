import type { Company, CompanyBilling, CompanyStanding } from "@workspace/shared";
import { DEMO_PHASE, demoSubscription } from "./platform-console";

/**
 * Where a demo company stands (docs/specs/platform-admin.md, part 4, "Demo mode"): always in full
 * use. The demo has no life cycle, maintenance switch or company database, so it never shows the
 * standing screens, the overlay or the Owner's banner.
 */
export function demoStanding(): CompanyStanding {
  return { state: "full" };
}

/**
 * The Owner's billing in the demo (spec part 4, "Demo mode"): the company's stand-in plan
 * (`demoSubscription`) as `current`, the demo's phase, its limits and no notice. It takes no clock,
 * so the end of a month in UTC can never show a false "Payment overdue" (critic C5).
 */
export function demoBilling(company: Company, today: string): CompanyBilling {
  const row = demoSubscription(company, today);
  return {
    status: company.status,
    phase: DEMO_PHASE,
    subscriptions: [
      {
        planName: row.planName,
        product: row.product,
        interval: row.interval,
        currentPeriodStart: row.currentPeriodStart,
        currentPeriodEnd: row.currentPeriodEnd,
        standing: "current",
      },
    ],
    limits: { userLimit: company.userLimit, branchLimit: company.branchLimit },
    notice: null,
  };
}
