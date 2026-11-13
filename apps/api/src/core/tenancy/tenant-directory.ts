import { Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import {
  member,
  products,
  tenantDatabases,
  tenantProducts,
  tenantSubscriptions,
  tenants,
  type TenantDatabaseStatus,
  type TenantStatus,
} from "@workspace/db/control";
import { companyPhase, type CompanyPhase, type ProductKey } from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";
import { CONTROL_DB } from "../database/control-db";

/** What the API needs to know about a company before a request reaches its data. */
export interface CompanyAccess {
  id: string;
  status: TenantStatus;
  products: ProductKey[];
  /**
   * True while the company is moved between providers (blueprint p12) or after its database failed
   * a migration (owner decision, 2026-11-13): no reads or writes.
   */
  maintenanceMode: boolean;
  /** Where the company stands in its life cycle: full, read-only, or locked (packages/shared `companyPhase`). */
  phase: CompanyPhase;
  /** The company database's status, or null when it has none yet. */
  databaseStatus: TenantDatabaseStatus | null;
}

/** Database statuses a request may use; `read_only` also makes the company read-only. */
const USABLE_DATABASE_STATUSES: ReadonlySet<TenantDatabaseStatus> = new Set(["ready", "read_only"]);

/**
 * Whether the company's database may serve requests now. Checked on every request, not only when a
 * pool opens, so a database that starts migrating or fails stops serving at once (PR #6 review).
 */
export function isDatabaseUsable(status: TenantDatabaseStatus | null): boolean {
  return status !== null && USABLE_DATABASE_STATUSES.has(status);
}

/**
 * Whether a company may only be read: its life-cycle phase (a suspended, cancelled or lapsed
 * company; blueprint p29, p40; owner decisions 2026-11-13) or a read-only database.
 */
export function isReadOnly(company: CompanyAccess): boolean {
  return company.phase !== "full" || company.databaseStatus === "read_only";
}

/**
 * Whether the company may be served at all, by a request or a job: its database is usable, it is
 * not in maintenance mode, and its life cycle has not locked it.
 */
export function isServing(company: CompanyAccess): boolean {
  return isDatabaseUsable(company.databaseStatus) && !company.maintenanceMode && company.phase !== "locked";
}

/** Reads company access facts from the control database (P9). */
@Injectable()
export class TenantDirectory {
  constructor(@Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>) {}

  /**
   * The company's access facts, or null when it does not exist or is deleted. The life-cycle phase
   * is worked out from its status and every subscription row, deleted ones included, on each call,
   * so it changes the moment a period ends.
   */
  async access(companyId: string): Promise<CompanyAccess | null> {
    const [company] = await this.control.db
      .select({
        id: tenants.id,
        status: tenants.status,
        maintenanceMode: tenants.maintenanceMode,
        statusChangedAt: tenants.statusChangedAt,
        databaseStatus: tenantDatabases.status,
      })
      .from(tenants)
      .leftJoin(tenantDatabases, eq(tenantDatabases.tenantId, tenants.id))
      .where(and(eq(tenants.id, companyId), isNull(tenants.deletedAt)));
    if (!company) return null;
    const productRows = await this.control.db
      .select({ key: products.key })
      .from(tenantProducts)
      .innerJoin(products, eq(products.id, tenantProducts.productId))
      .where(and(eq(tenantProducts.tenantId, companyId), isNull(tenantProducts.deletedAt)));
    const subscriptions = await this.control.db
      .select({
        status: tenantSubscriptions.status,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
        price: tenantSubscriptions.price,
        deletedAt: tenantSubscriptions.deletedAt,
      })
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, companyId));
    const { statusChangedAt, ...facts } = company;
    const phase = companyPhase({
      status: company.status,
      statusChangedAt,
      subscriptions: subscriptions.map(({ deletedAt, ...row }) => ({ ...row, deleted: deletedAt !== null })),
    });
    return { ...facts, phase, products: productRows.map((row) => row.key) };
  }

  /** Whether the person is still a member of the company; membership can end during a session. */
  async isMember(userId: string, companyId: string): Promise<boolean> {
    const [row] = await this.control.db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, companyId)))
      .limit(1);
    return row !== undefined;
  }
}
