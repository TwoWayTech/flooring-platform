import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { tenants } from "@workspace/db/control";
import { featureOn } from "@workspace/shared";
import { isNull } from "drizzle-orm";
import { AuditService } from "../../core/access/audit";
import { CONTROL_DB } from "../../core/database/control-db";
import { JobTenants } from "../../core/jobs/job-tenants";
import { JobsService } from "../../core/jobs/jobs.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import { companyToday } from "../sales/sales-common";
import { raiseRecurringDrafts } from "./expenses.service";

/** The daily queue that raises recurring expense drafts in every company (spec rule 13). */
export const RECURRING_EXPENSES_QUEUE = "finance.recurring-expenses";

/**
 * Raises the drafts recurring expenses owe, once a day for every company that is served and
 * writable, each in its own day (spec rule 13; ADR 0041). The demo raised them whenever someone
 * opened the company; a job needs no reader and writes nothing on a read. Saving a template also
 * raises what it owes at once. Safe to repeat: a period raises one draft, ever.
 */
@Injectable()
export class RecurringExpensesJob implements OnApplicationBootstrap {
  private readonly logger = new Logger("RecurringExpenses");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly jobs: JobsService,
    private readonly jobTenants: JobTenants,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    // Not awaited, like the notification queues: pg-boss starts once the database answers.
    void this.register().catch(() => this.logger.error("Could not register the recurring expenses queue."));
  }

  private async register(): Promise<void> {
    await this.jobs.register<object>(RECURRING_EXPENSES_QUEUE, () => this.runAll());
    // 11:05 UTC is early morning in every US time zone.
    await this.jobs.schedule(RECURRING_EXPENSES_QUEUE, "5 11 * * *");
  }

  /** Raises the drafts for every company; one company's failure never stops the others. */
  async runAll(): Promise<void> {
    if (!featureOn("finance.expenses")) return;
    const companies = await this.control.db.select({ id: tenants.id }).from(tenants).where(isNull(tenants.deletedAt));
    for (const company of companies) {
      try {
        const tenant = await this.jobTenants.contextFor(company.id);
        if (!tenant || tenant.readOnly) continue;
        const today = await companyToday(this.control.db, tenant);
        await raiseRecurringDrafts(await this.tenancy.db(tenant), today, this.auditLog);
      } catch (error) {
        // The company id only: a message could quote a template's values.
        this.logger.error(`Recurring drafts failed for company ${company.id}: ${(error as Error).name}`);
      }
    }
  }
}
