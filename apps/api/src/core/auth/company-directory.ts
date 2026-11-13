import type { ControlDb } from "@workspace/db";
import { member, organization, tenantBranding } from "@workspace/db/control";
import { eq } from "drizzle-orm";
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

  /** The companies a user is a member of, by name. */
  async membershipsOf(userId: string): Promise<CompanySummary[]> {
    const rows = await this.db
      .select({ id: organization.id, slug: organization.slug, name: organization.name })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, userId));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The id of the company with this slug, or null when there is none. */
  async idBySlug(slug: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, slug))
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
