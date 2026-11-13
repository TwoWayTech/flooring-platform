import { Injectable } from "@nestjs/common";
import { TenantContext } from "../tenancy/tenant-context";
import { isDatabaseUsable, TenantDirectory } from "../tenancy/tenant-directory";

/**
 * Gives background jobs a TenantContext for the company named in the job (ADR 0032). The company
 * id comes from the job's own data, which only our code queues, never from a request. The same
 * facts TenantGuard checks apply: a deleted company, or one whose database cannot serve now, gets
 * no context, and the job does nothing for it.
 */
@Injectable()
export class JobTenants {
  constructor(private readonly directory: TenantDirectory) {}

  /** The context for this company, or null when it is deleted or its database is not usable. */
  async contextFor(companyId: string): Promise<TenantContext | null> {
    const company = await this.directory.access(companyId);
    if (!company || !isDatabaseUsable(company.databaseStatus)) return null;
    return TenantContext.forJob(company);
  }
}
