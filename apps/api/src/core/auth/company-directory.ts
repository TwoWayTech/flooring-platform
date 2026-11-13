import type { ControlDb } from "@workspace/db";
import { member, organization, tenantBranding, tenants } from "@workspace/db/control";
import { and, eq, isNull } from "drizzle-orm";
import { DEFAULT_TIMEOUTS, type SessionTimeouts } from "./session-timeouts";

/** A company the user belongs to, as the sign-in chooser and /auth/context show it. */
export interface CompanySummary {
  id: string;
  slug: string;
  name: string;
}

/**
 * Reads companies and memberships from the control database for sign-in and session checks.
 * The organization id is the tenant id (blueprint p13), so these ids are tenant ids.
 */
export class CompanyDirectory {
  constructor(private readonly db: ControlDb) {}

  /**
   * The companies a user is a member of, by name. Deleted companies are left out. Suspended and
   * cancelled ones stay, because their users may still sign in to view and export (blueprint p29).
   */
  async membershipsOf(userId: string): Promise<CompanySummary[]> {
    const rows = await this.db
      .select({ id: organization.id, slug: organization.slug, name: organization.name })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .innerJoin(tenants, eq(tenants.id, organization.id))
      .where(and(eq(member.userId, userId), isNull(tenants.deletedAt)));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The id of the company with this slug, or null when there is none or it is deleted. */
  async idBySlug(slug: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: organization.id })
      .from(organization)
      .innerJoin(tenants, eq(tenants.id, organization.id))
      .where(and(eq(organization.slug, slug), isNull(tenants.deletedAt)))
      .limit(1);
    return row?.id ?? null;
  }

  /** The company's session timeouts, or the blueprint defaults when it has no branding row. */
  async timeoutsOf(companyId: string | null | undefined): Promise<SessionTimeouts> {
    if (!companyId) return DEFAULT_TIMEOUTS;
    const [row] = await this.db
      .select({ idleMin: tenantBranding.idleTimeoutMin, absoluteMin: tenantBranding.absoluteTimeoutMin })
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, companyId))
      .limit(1);
    return row ?? DEFAULT_TIMEOUTS;
  }
}
