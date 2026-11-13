import { Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import {
  member,
  products,
  tenantDatabases,
  tenantProducts,
  tenants,
  type TenantDatabaseStatus,
  type TenantStatus,
} from "@workspace/db/control";
import type { ProductKey } from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";
import { CONTROL_DB } from "../database/control-db";

/** What the API needs to know about a company before a request reaches its data. */
export interface CompanyAccess {
  id: string;
  status: TenantStatus;
  products: ProductKey[];
  /** True while the company is moved between providers (blueprint p12). */
  maintenanceMode: boolean;
  /** The company database's status, or null when it has none yet. */
  databaseStatus: TenantDatabaseStatus | null;
}

/**
 * Statuses that keep a company readable but not writable. A suspended company can sign in, view
 * and export, but not create (blueprint p40). A cancelled company is read-only for 90 days (p29).
 */
const READ_ONLY_STATUSES: ReadonlySet<TenantStatus> = new Set(["suspended", "cancelled"]);

/** Whether a company may only be read: its status, maintenance mode, or a read-only database. */
export function isReadOnly(company: CompanyAccess): boolean {
  return READ_ONLY_STATUSES.has(company.status) || company.maintenanceMode || company.databaseStatus === "read_only";
}

/** Reads company access facts from the control database (P9). */
@Injectable()
export class TenantDirectory {
  constructor(@Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>) {}

  /** The company's access facts, or null when it does not exist or is deleted. */
  async access(companyId: string): Promise<CompanyAccess | null> {
    const [company] = await this.control.db
      .select({
        id: tenants.id,
        status: tenants.status,
        maintenanceMode: tenants.maintenanceMode,
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
    return { ...company, products: productRows.map((row) => row.key) };
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
