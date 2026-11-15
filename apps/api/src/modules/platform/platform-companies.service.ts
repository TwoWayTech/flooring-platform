import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import {
  member,
  plans,
  products,
  tenantBranding,
  tenantDatabases,
  tenantSubscriptions,
  tenants,
  type TenantStatus,
} from "@workspace/db/control";
import {
  ALL_PERMISSION_KEYS,
  inModuleOrder,
  PRODUCT_ROLES,
  roleTemplate,
  type PlatformCompany,
  type PlatformCompanySummary,
  type PlatformDirectory,
  type PlatformSubscription,
} from "@workspace/shared";
import { and, asc, count, eq, isNull, sql, type SQL } from "drizzle-orm";
import { AccessService } from "../../core/access/access.service";
import { PlanLimits } from "../../core/access/plan-limits";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantDirectory } from "../../core/tenancy/tenant-directory";

/**
 * The company columns the console reads, from `tenants` and `tenant_databases` only. The database's
 * `last_error` is read only as "is there one": it holds the driver's message, which can quote a
 * company's own rows, so its text never leaves the control database (spec "Fields"; review A1).
 */
const COMPANY_COLUMNS = {
  id: tenants.id,
  slug: tenants.slug,
  name: tenants.name,
  legalName: tenants.legalName,
  city: tenants.city,
  state: tenants.state,
  timeZone: tenants.timeZone,
  region: tenants.region,
  createdAt: tenants.createdAt,
  statusChangedAt: tenants.statusChangedAt,
  maintenanceMode: tenants.maintenanceMode,
  maintenanceReason: tenants.maintenanceReason,
  databaseStatus: tenantDatabases.status,
  schemaVersion: tenantDatabases.schemaVersion,
  hasError: sql<boolean>`${tenantDatabases.lastError} is not null`,
};

/** One company row as COMPANY_COLUMNS reads it. */
type CompanyRow = Awaited<ReturnType<PlatformCompaniesService["rows"]>>[number];

/** The answer for a company id that names no company, or a deleted one (spec "Validations"). */
export function companyNotFound(): NotFoundException {
  return new NotFoundException({ code: "not_found", message: "That company does not exist." });
}

/**
 * The plan column (spec "Fields"): the plan names of the subscription rows that are not deleted, a
 * cancelled one marked, or "Trial, no plan" for a trial with none. A company that is not a trial and
 * has no rows has no plan modules at all (`planModulesOf`), so it reads "No plan", not "Trial".
 */
function planLabel(status: TenantStatus, subscriptions: readonly PlatformSubscription[]): string {
  if (subscriptions.length === 0) return status === "trial" ? "Trial, no plan" : "No plan";
  return subscriptions
    .map((subscription) =>
      subscription.status === "cancelled" ? `${subscription.planName} (cancelled)` : subscription.planName,
    )
    .join(", ");
}

/**
 * The companies of the platform console (docs/specs/platform-admin.md, "Endpoints" and "Fields").
 * A company is named by its id for control-database rows only: tenants, products, subscriptions,
 * module overrides, the ceiling, branding and member counts. Nothing here reaches a company
 * database (lint forbids the tenancy imports in this module), so a company whose database failed or
 * is in maintenance still answers. Modules, the ceiling, limits and the phase come from the same
 * readers the guards use, so the console shows exactly what is enforced.
 */
@Injectable()
export class PlatformCompaniesService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly directory: TenantDirectory,
    private readonly access: AccessService,
    private readonly limits: PlanLimits,
  ) {}

  /** Every company that is not deleted, by name. */
  async list(): Promise<PlatformCompanySummary[]> {
    const summaries: PlatformCompanySummary[] = [];
    // One company at a time: a few small control queries each, fine at today's company count.
    for (const row of await this.rows()) {
      const summary = await this.summaryOf(row, await this.subscriptionsOf(row.id));
      if (summary) summaries.push(summary);
    }
    return summaries;
  }

  /** One company in full; 404 when it does not exist or is deleted. */
  async detail(companyId: string): Promise<PlatformCompany> {
    const [row] = await this.rows(eq(tenants.id, companyId));
    if (!row) throw companyNotFound();
    const subscriptions = await this.subscriptionsOf(companyId);
    const summary = await this.summaryOf(row, subscriptions);
    if (!summary) throw companyNotFound();
    const allowed = new Set<string>(await this.access.companyCeiling(companyId));
    return {
      ...summary,
      legalName: row.legalName,
      timeZone: row.timeZone,
      region: row.region,
      createdAt: row.createdAt.toISOString(),
      ceiling: ALL_PERMISSION_KEYS.filter((key) => allowed.has(key)),
      subscriptions,
    };
  }

  /**
   * The company's directory, restricted (spec "PlatformDirectory"; owner question 3): the default
   * role templates of its products, its pre-sign-in branding and no users. Its own roles and users
   * live in its database, which needs support access, and using a grant opens nothing yet.
   */
  async directoryOf(companyId: string): Promise<PlatformDirectory> {
    const company = await this.directory.access(companyId);
    if (!company) throw companyNotFound();
    const roleKeys = [...new Set([...company.products].sort().flatMap((product) => PRODUCT_ROLES[product]))];
    const [branding] = await this.control.db
      .select({
        displayName: tenantBranding.displayName,
        monogram: tenantBranding.monogram,
        brandColor: tenantBranding.brandColor,
        pattern: tenantBranding.pattern,
        defaultTheme: tenantBranding.defaultTheme,
      })
      .from(tenantBranding)
      .where(and(eq(tenantBranding.tenantId, companyId), isNull(tenantBranding.deletedAt)))
      .limit(1);
    return { roles: roleKeys.map(roleTemplate), users: [], branding: branding ?? null, restricted: true };
  }

  private rows(filter?: SQL) {
    return this.control.db
      .select(COMPANY_COLUMNS)
      .from(tenants)
      .leftJoin(tenantDatabases, eq(tenantDatabases.tenantId, tenants.id))
      .where(and(isNull(tenants.deletedAt), filter))
      .orderBy(asc(tenants.name), asc(tenants.id));
  }

  /** The summary of one company, or null when it was deleted since its row was read. */
  private async summaryOf(
    row: CompanyRow,
    subscriptions: readonly PlatformSubscription[],
  ): Promise<PlatformCompanySummary | null> {
    // The status, products and life-cycle phase as TenantGuard reads them on every request.
    const company = await this.directory.access(row.id);
    if (!company) return null;
    const [members] = await this.control.db
      .select({ n: count() })
      .from(member)
      .where(eq(member.organizationId, row.id));
    const limits = await this.limits.limitsOf(row.id);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      city: row.city,
      state: row.state,
      products: company.products,
      status: company.status,
      statusChangedAt: row.statusChangedAt.toISOString(),
      phase: company.phase,
      maintenance: { on: row.maintenanceMode, reason: row.maintenanceReason },
      plan: planLabel(company.status, subscriptions),
      modules: inModuleOrder(await this.access.companyModules(row.id, company.status, company.products)),
      userLimit: limits.userLimit,
      branchLimit: limits.branchLimit,
      members: members?.n ?? 0,
      database: { status: row.databaseStatus, schemaVersion: row.schemaVersion, hasError: row.hasError === true },
    };
  }

  /** The company's subscription rows that are not deleted, oldest first. */
  private async subscriptionsOf(companyId: string): Promise<PlatformSubscription[]> {
    const rows = await this.control.db
      .select({
        id: tenantSubscriptions.id,
        planKey: plans.key,
        planName: plans.name,
        product: products.key,
        interval: tenantSubscriptions.interval,
        price: tenantSubscriptions.price,
        currentPeriodStart: tenantSubscriptions.currentPeriodStart,
        currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
        status: tenantSubscriptions.status,
        userLimitOverride: tenantSubscriptions.userLimitOverride,
        branchLimitOverride: tenantSubscriptions.branchLimitOverride,
      })
      .from(tenantSubscriptions)
      .innerJoin(plans, eq(plans.id, tenantSubscriptions.planId))
      .innerJoin(products, eq(products.id, plans.productId))
      .where(and(eq(tenantSubscriptions.tenantId, companyId), isNull(tenantSubscriptions.deletedAt)))
      .orderBy(asc(tenantSubscriptions.createdAt), asc(tenantSubscriptions.id));
    return rows.map((row) => ({
      ...row,
      currentPeriodStart: row.currentPeriodStart.toISOString(),
      currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    }));
  }
}
