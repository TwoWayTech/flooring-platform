import { Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { bonuses } from "@workspace/db/company";
import { dec, type Bonus } from "@workspace/shared";
import { eq } from "drizzle-orm";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { notFound, refuse } from "../sales/sales-common";
import { auditHr, inClosedPayPeriod, lockEmployee, requireLinkedDecider } from "./hr-common";
import { selfCheck, type EmployeeRow } from "./hr-records";
import { loadBonuses } from "./pay-records";

/** A bonus as the form sends it (hr.md "Bonus"). */
export interface BonusFields {
  employeeId: string;
  amount: string;
  kind: Bonus["kind"];
  periodStart: string;
  periodEnd: string;
  reason: string;
}

type BonusRow = typeof bonuses.$inferSelect;

/** Why a bonus in a closed run can't change. */
const CLOSED_RUN = "The pay run for that period is approved. Reopen it first.";

/**
 * Bonuses on the API (hr.md "Bonus"; ADR 0047). A bonus joins the run where its own period ends and
 * is paid as wages through it, so it posts nothing by itself. Whoever adds it approves it
 * (`approvedById`, the column the spec has), and separation of duties comes at the run: they may
 * not approve the run that pays it. Nobody adds or voids their own bonus, and nothing changes in a
 * run that is approved or exported. Audit entries carry no amounts (CLAUDE.md rule 5).
 */
@Injectable()
export class BonusesService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
  ) {}

  /** Every live bonus. */
  async list(tenant: TenantContext): Promise<Bonus[]> {
    return loadBonuses(await this.tenancy.db(tenant), this.control.db);
  }

  /** Adds an approved bonus for a W-2 person who has not left, never one's own. */
  async add(tenant: TenantContext, actor: Actor, input: BonusFields): Promise<Bonus> {
    const reason = input.reason.trim();
    if (!dec(input.amount).gt(0)) throw refuse("Enter the bonus amount.");
    if (input.periodEnd < input.periodStart) throw refuse("The bonus period ends before it starts.");
    if (reason.length < 3) throw refuse("Say what the bonus is for.");
    const db = await this.tenancy.db(tenant);
    const id = await db.transaction(async (tx) => {
      const employee = await this.lockPerson(tx, actor, input.employeeId);
      if (employee.workerType !== "w2") throw refuse("A contractor is paid by contractor payment, not a bonus.");
      if (employee.status === "terminated") throw refuse("Someone who has left is not in a pay run.");
      if (await inClosedPayPeriod(tx, input.periodEnd, input.periodEnd)) throw refuse(CLOSED_RUN);
      const [row] = await tx
        .insert(bonuses)
        .values({
          employeeId: employee.id,
          amount: input.amount,
          kind: input.kind,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          approvedById: actor.access.userId,
          reason,
          createdBy: actor.access.userId,
        })
        .returning({ id: bonuses.id });
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Added bonus",
        targetType: "bonus",
        targetId: row!.id,
        targetLabel: employee.name,
        before: null,
        after: { kind: input.kind, periodStart: input.periodStart, periodEnd: input.periodEnd, reason },
      });
      return row!.id;
    });
    return (await loadBonuses(db, this.control.db, [id]))[0]!;
  }

  /** Voids a bonus whose run is not approved, with a reason; the row is retired, never edited. */
  async void(tenant: TenantContext, actor: Actor, id: string, reason: string): Promise<void> {
    const why = reason.trim();
    if (why.length < 3) throw refuse("Say why the bonus is voided.");
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const [peek] = await tx.select({ employeeId: bonuses.employeeId }).from(bonuses).where(eq(bonuses.id, id));
      if (!peek) throw notFound("bonus");
      const employee = await this.lockPerson(tx, actor, peek.employeeId);
      const [row] = (await tx.select().from(bonuses).where(eq(bonuses.id, id)).for("update")) as BonusRow[];
      if (!row || row.deletedAt) throw notFound("bonus");
      if (await inClosedPayPeriod(tx, row.periodEnd, row.periodEnd)) throw refuse(CLOSED_RUN);
      const now = new Date();
      await tx.update(bonuses).set({ deletedAt: now, updatedAt: now }).where(eq(bonuses.id, id));
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Voided bonus",
        targetType: "bonus",
        targetId: id,
        targetLabel: employee.name,
        before: { kind: row.kind, periodStart: row.periodStart, periodEnd: row.periodEnd },
        after: { reason: why },
      });
    });
  }

  /** Locks the person a bonus is for; never one's own, and only from a linked sign-in or the Owner. */
  private async lockPerson(tx: CompanyDb, actor: Actor, employeeId: string): Promise<EmployeeRow> {
    const employee = await lockEmployee(tx, employeeId);
    if ((await selfCheck(tx, actor))(employee.id)) throw refuse("Someone else must decide your own bonus.");
    await requireLinkedDecider(tx, actor.access);
    return employee;
  }
}
