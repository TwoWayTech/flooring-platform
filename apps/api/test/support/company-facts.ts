import { planLimits, plans, products, tenantDatabases, tenantSubscriptions, tenants } from "@workspace/db/control";
import type { TenantDatabaseStatus } from "@workspace/db/control";
import { backdateStatusChange } from "@workspace/db/testing";
import type { ProductKey } from "@workspace/shared";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { AuthHarness } from "../auth-harness";

/** One day in milliseconds. */
export const DAY_MS = 86_400_000;

/** A moment `days` days from now; negative days are in the past. */
export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

/** A moment `days` days after `from`. */
export function daysAfter(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/** A subscription row to plant, with every fact the life-cycle rule reads given explicitly. */
export interface PlantedSubscription {
  status: "trial" | "active" | "past_due" | "cancelled";
  /** A decimal string; above zero on a cancelled row means it was a paid plan. */
  price: string;
  interval: "monthly" | "yearly";
  /** Where the period ends, in days from now; negative is in the past. */
  endInDays: number;
  deleted?: boolean;
  planName?: string;
  product?: ProductKey;
  /** The plan's own limits; none when omitted. */
  limits?: { maxUsers: number; maxBranches: number };
  userLimitOverride?: number | null;
  branchLimitOverride?: number | null;
}

/** A planted row's id and its stored period. */
export interface PlantedRow {
  id: string;
  start: Date;
  end: Date;
}

/**
 * Helpers the standing and billing API tests share (docs/specs/platform-admin.md, part 4; ADR
 * 0054): they set a company's control rows behind the API's back, so each case reaches one
 * life-cycle state, and put the company back in full use afterwards. Tests only.
 */
export function companyFacts(harness: AuthHarness) {
  /** Changes the company's `tenants` row; a status change resets `status_changed_at` (trigger). */
  async function setTenant(companyId: string, values: Partial<typeof tenants.$inferInsert>): Promise<void> {
    await harness.control.db.update(tenants).set(values).where(eq(tenants.id, companyId));
  }

  /** Sets the status of the company's database row. */
  async function setDatabase(companyId: string, status: TenantDatabaseStatus): Promise<void> {
    await harness.control.db.update(tenantDatabases).set({ status }).where(eq(tenantDatabases.tenantId, companyId));
  }

  /** Sets the status and then moves its change back to `since`. */
  async function setStatusSince(companyId: string, status: "suspended" | "cancelled", since: Date): Promise<void> {
    await setTenant(companyId, { status });
    await backdateStatusChange(harness.control.db, companyId, since);
  }

  /** Plants a plan and one subscription row on it for the company. */
  async function addSubscription(companyId: string, input: PlantedSubscription): Promise<PlantedRow> {
    const [product] = await harness.control.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.key, input.product ?? "flooring"));
    const [plan] = await harness.control.db
      .insert(plans)
      .values({
        key: `plan-${uuidv7()}`,
        name: input.planName ?? "Flooring Pro",
        productId: product.id,
        monthlyPrice: "99",
        yearlyPrice: "990",
      })
      .returning({ id: plans.id });
    if (input.limits) await harness.control.db.insert(planLimits).values({ planId: plan.id, ...input.limits });
    const end = daysFromNow(input.endInDays);
    const start = daysAfter(end, input.interval === "yearly" ? -365 : -30);
    const [row] = await harness.control.db
      .insert(tenantSubscriptions)
      .values({
        tenantId: companyId,
        planId: plan.id,
        interval: input.interval,
        price: input.price,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        status: input.status,
        deletedAt: input.deleted ? new Date() : null,
        userLimitOverride: input.userLimitOverride ?? null,
        branchLimitOverride: input.branchLimitOverride ?? null,
      })
      .returning({ id: tenantSubscriptions.id });
    return { id: row.id, start, end };
  }

  /** Puts the company back in full use: a trial with no rows, no maintenance and a ready database. */
  async function reset(companyId: string): Promise<void> {
    await harness.control.db.delete(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, companyId));
    await setTenant(companyId, { status: "trial", maintenanceMode: false, maintenanceReason: null, deletedAt: null });
    await setDatabase(companyId, "ready");
  }

  return { setTenant, setDatabase, setStatusSince, addSubscription, reset };
}
