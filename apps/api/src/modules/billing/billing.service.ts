import { ForbiddenException, Injectable } from "@nestjs/common";
import { BILLING_OWNER_ONLY_MESSAGE, companyBillingView, type CompanyBilling } from "@workspace/shared";
import type { RequestAccess } from "../../core/access/access.service";
import { PlanLimits } from "../../core/access/plan-limits";
import { TENANCY_REFUSALS } from "../../core/tenancy/tenant.guard";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { requireFeature } from "../sales/sales-common";
import { BillingFacts } from "./billing-facts";

/**
 * The Owner's read-only billing (docs/specs/platform-admin.md, part 4, "GET /billing"; ADR 0054):
 * the stored status, the life-cycle phase, the live subscription rows with their standing, the
 * limits and the Owner's notice, from control rows only. Nothing here writes: billing writes wait
 * for the owner (ADR 0052, "For the owner" 7).
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly facts: BillingFacts,
    private readonly limits: PlanLimits,
  ) {}

  /**
   * The open company's billing, after the guards (spec part 4, "GET /billing", Refusal order):
   * 1. `settings.billing` off: 404 for everyone, the Owner included, before the Owner check
   *    (CLAUDE.md rule 13);
   * 2. anyone but the Owner (`access.isOwner`, false for a disabled profile): 403 `forbidden`;
   * 3. a company deleted since TenantGuard ran: 403 `company_required`.
   */
  async of(tenant: TenantContext, access: RequestAccess): Promise<CompanyBilling> {
    requireFeature("settings.billing");
    if (!access.isOwner) throw new ForbiddenException({ code: "forbidden", message: BILLING_OWNER_ONLY_MESSAGE });
    const [read, limits] = await Promise.all([this.facts.of(tenant.companyId), this.limits.limitsOf(tenant.companyId)]);
    if (!read) {
      throw new ForbiddenException({ code: "company_required", message: TENANCY_REFUSALS.company_required });
    }
    return companyBillingView({ ...read, limits, now: new Date() });
  }
}
