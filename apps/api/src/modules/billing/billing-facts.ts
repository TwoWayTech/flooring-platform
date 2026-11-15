import { Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { plans, products, tenantDatabases, tenantSubscriptions, tenants } from "@workspace/db/control";
import type { BillingRow, LifecycleFacts } from "@workspace/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { CONTROL_DB } from "../../core/database/control-db";

/** What the Owner's billing answer is worked out from, read from control rows only. */
export interface BillingFactsRead {
  /** The life-cycle facts, the same input TenantDirectory gives `companyPhase`. */
  facts: LifecycleFacts;
  /** `tenant_databases.status` is `read_only`. */
  databaseReadOnly: boolean;
  /** Every subscription row, deleted ones too, oldest first, with no price. */
  rows: BillingRow[];
}

/**
 * Reads a company's billing facts from the control database, as the tables are (docs/specs/
 * platform-admin.md, part 4, "GET /billing", What it reads; ADR 0054). It reads the columns
 * TenantDirectory reads for the life-cycle phase (status, status change, and every subscription
 * row's status, period end, price and deletion), so the billing page and the guards agree; test
 * B-12 pins the two together. `price` is read only so the life-cycle rule can tell a paid row from
 * a trial: it goes into `facts` and never into `rows`, whose type has no price.
 */
@Injectable()
export class BillingFacts {
  constructor(@Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>) {}

  /** The company's facts, or null when it does not exist or is deleted. */
  async of(companyId: string): Promise<BillingFactsRead | null> {
    const [company] = await this.control.db
      .select({
        status: tenants.status,
        statusChangedAt: tenants.statusChangedAt,
        databaseStatus: tenantDatabases.status,
      })
      .from(tenants)
      .leftJoin(tenantDatabases, eq(tenantDatabases.tenantId, tenants.id))
      .where(and(eq(tenants.id, companyId), isNull(tenants.deletedAt)));
    if (!company) return null;
    // Every row, deleted ones too, as TenantDirectory counts them. The plan and product joins
    // drop none: both foreign keys are required.
    const subscriptions = await this.control.db
      .select({
        status: tenantSubscriptions.status,
        interval: tenantSubscriptions.interval,
        currentPeriodStart: tenantSubscriptions.currentPeriodStart,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
        price: tenantSubscriptions.price,
        deletedAt: tenantSubscriptions.deletedAt,
        planName: plans.name,
        product: products.key,
      })
      .from(tenantSubscriptions)
      .innerJoin(plans, eq(plans.id, tenantSubscriptions.planId))
      .innerJoin(products, eq(products.id, plans.productId))
      .where(eq(tenantSubscriptions.tenantId, companyId))
      .orderBy(asc(tenantSubscriptions.createdAt), asc(tenantSubscriptions.id));
    return {
      facts: {
        status: company.status,
        statusChangedAt: company.statusChangedAt,
        subscriptions: subscriptions.map((row) => ({
          status: row.status,
          currentPeriodEnd: row.currentPeriodEnd,
          price: row.price,
          deleted: row.deletedAt !== null,
        })),
      },
      databaseReadOnly: company.databaseStatus === "read_only",
      rows: subscriptions.map((row): BillingRow => ({
        planName: row.planName,
        product: row.product,
        interval: row.interval,
        currentPeriodStart: row.currentPeriodStart,
        currentPeriodEnd: row.currentPeriodEnd,
        status: row.status,
        deleted: row.deletedAt !== null,
      })),
    };
  }
}
