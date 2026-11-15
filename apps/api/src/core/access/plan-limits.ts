import { Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { planLimits, tenantSubscriptions } from "@workspace/db/control";
import { and, eq, isNull } from "drizzle-orm";
import { CONTROL_DB } from "../database/control-db";

/** A company's user and branch limits; null means no limit (a trial with no plan). */
export interface CompanyLimits {
  userLimit: number | null;
  branchLimit: number | null;
}

/** The largest of the given limits, or null when there is none. */
function largest(limits: readonly (number | null)[]): number | null {
  const present = limits.filter((limit): limit is number => limit !== null);
  return present.length === 0 ? null : Math.max(...present);
}

/**
 * Reads a company's limits from the control database (blueprint p24, "Plans"; ADR 0031). Each
 * subscription row that is not deleted, cancelled ones included, gives its override, or else its
 * plan's limit; the company's limit is the largest of those, and null when no row gives one (a
 * trial with no plan has no seat limit, docs/blueprint-delta.md 2026-11-13). Invitations check the
 * user limit (Settings → Users) and the platform console shows both (docs/specs/platform-admin.md,
 * "Fields"). The branch limit is stored but not enforced until Settings → Locations moves to the API.
 */
@Injectable()
export class PlanLimits {
  constructor(@Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>) {}

  /** The company's limits; `db` lets a caller read inside its own control transaction. */
  async limitsOf(companyId: string, db: ControlDb = this.control.db): Promise<CompanyLimits> {
    const rows = await db
      .select({
        userOverride: tenantSubscriptions.userLimitOverride,
        branchOverride: tenantSubscriptions.branchLimitOverride,
        maxUsers: planLimits.maxUsers,
        maxBranches: planLimits.maxBranches,
      })
      .from(tenantSubscriptions)
      .leftJoin(planLimits, and(eq(planLimits.planId, tenantSubscriptions.planId), isNull(planLimits.deletedAt)))
      .where(and(eq(tenantSubscriptions.tenantId, companyId), isNull(tenantSubscriptions.deletedAt)));
    return {
      userLimit: largest(rows.map((row) => row.userOverride ?? row.maxUsers)),
      branchLimit: largest(rows.map((row) => row.branchOverride ?? row.maxBranches)),
    };
  }
}
