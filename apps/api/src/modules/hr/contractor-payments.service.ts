import { Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { contractorPayments } from "@workspace/db/company";
import {
  cashAccountFor,
  contractorPaymentPosting,
  dec,
  type ContractorPayment,
  type PaymentMethod,
} from "@workspace/shared";
import { eq } from "drizzle-orm";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { loadAccountingForPosting } from "../../core/ledger/accounting-settings";
import { LedgerService } from "../../core/ledger/ledger.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { companyClock, notFound, refuse } from "../sales/sales-common";
import { auditHr, lockEmployee, requireLinkedDecider } from "./hr-common";
import { selfCheck, type EmployeeRow } from "./hr-records";
import { loadContractorPayments } from "./pay-records";

/** A contractor payment as the form sends it (hr.md "ContractorPayment"). */
export interface ContractorPaymentFields {
  employeeId: string;
  date: string;
  description: string;
  amount: string;
}

type PaymentRow = typeof contractorPayments.$inferSelect;

const PAID = { sourceType: "contractor_payment", event: "contractor_payment.paid" } as const;

/**
 * Payments to 1099 contractors on the API (hr.md "ContractorPayment"; ADR 0047). They are never in
 * a pay period. One person approves a payment to make (`approved`), someone else pays it (`paid`):
 * paying posts Contract Labor against the bank account for its method; a void retires the row and,
 * once paid, posts the reversal on the void day (CLAUDE.md rule 9). Nobody records, pays or voids
 * their own payment, and only a linked sign-in or the Owner acts. Audit entries carry no amounts.
 */
@Injectable()
export class ContractorPaymentsService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly books: LedgerService,
  ) {}

  /** Every live contractor payment. */
  async list(tenant: TenantContext): Promise<ContractorPayment[]> {
    return loadContractorPayments(await this.tenancy.db(tenant));
  }

  /** Records a payment to make to a 1099 contractor, dated today or earlier; it posts when paid. */
  async add(tenant: TenantContext, actor: Actor, input: ContractorPaymentFields): Promise<ContractorPayment> {
    const description = input.description.trim();
    if (!dec(input.amount).gt(0)) throw refuse("Enter the amount.");
    if (description.length < 3) throw refuse("Say what the payment is for.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    if (input.date > clock.day) throw refuse("A contractor payment can't be dated in the future.");
    const id = await db.transaction(async (tx) => {
      const employee = await this.lockPerson(tx, actor, input.employeeId);
      if (employee.workerType !== "1099") {
        throw refuse("Only a 1099 contractor is paid this way; employees are paid through pay periods.");
      }
      const [row] = await tx
        .insert(contractorPayments)
        .values({
          employeeId: employee.id,
          date: input.date,
          description,
          amount: input.amount,
          status: "approved",
          createdBy: actor.access.userId,
        })
        .returning({ id: contractorPayments.id });
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Added contractor payment",
        targetType: "contractor_payment",
        targetId: row!.id,
        targetLabel: employee.name,
        before: null,
        after: { date: input.date, description, status: "approved" },
      });
      return row!.id;
    });
    return (await loadContractorPayments(db, [id]))[0]!;
  }

  /**
   * Pays an approved payment by a method, today (maker-checker: not by whoever recorded it, unless
   * the Owner). Posts Contract Labor against the method's bank account, read under the accounting
   * settings lock (ADR 0040).
   */
  async pay(tenant: TenantContext, actor: Actor, id: string, method: PaymentMethod): Promise<ContractorPayment> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      const { row, employee } = await this.lockPayment(tx, actor, id);
      if (row.status !== "approved") throw refuse("This payment is already paid.");
      if (!actor.access.isOwner && row.createdBy === actor.access.userId) {
        throw refuse("Someone else must pay a contractor payment you recorded.");
      }
      const cash = cashAccountFor(await loadAccountingForPosting(tx), method);
      await this.books.post(tx, contractorPaymentPosting(row, clock.day, cash), actor.access.userId);
      await tx
        .update(contractorPayments)
        .set({ status: "paid", updatedAt: new Date() })
        .where(eq(contractorPayments.id, row.id));
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Paid contractor payment",
        targetType: "contractor_payment",
        targetId: row.id,
        targetLabel: employee.name,
        before: { status: "approved" },
        after: { status: "paid", method, paidOn: clock.day },
      });
    });
    return (await loadContractorPayments(db, [id]))[0]!;
  }

  /**
   * Voids a payment with a reason. A paid one is reversed on the void day into the bank account it
   * came from; one paid before the books started (seeded or imported, no entry) is refused, because
   * its void would post nothing and leave the books apart from the record (PR #16 review).
   */
  async void(tenant: TenantContext, actor: Actor, id: string, reason: string): Promise<void> {
    const why = reason.trim();
    if (why.length < 3) throw refuse("Say why the payment is voided.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      const { row, employee } = await this.lockPayment(tx, actor, id);
      if (row.status === "paid") {
        const posted = await this.books.postedCashAccount(tx, { ...PAID, sourceId: row.id });
        if (!posted) throw refuse("This payment was paid before the books started, so it can't be voided here.");
        await this.books.reverse(tx, { ...PAID, sourceId: row.id }, clock.day, actor.access.userId);
      }
      const now = new Date();
      await tx
        .update(contractorPayments)
        .set({ deletedAt: now, updatedAt: now })
        .where(eq(contractorPayments.id, row.id));
      await auditHr(this.auditLog, tenant, actor, tx, {
        action: "Voided contractor payment",
        targetType: "contractor_payment",
        targetId: row.id,
        targetLabel: employee.name,
        before: { status: row.status },
        after: { reason: why },
      });
    });
  }

  /** Locks the contractor, then the payment; never one's own. */
  private async lockPayment(
    tx: CompanyDb,
    actor: Actor,
    id: string,
  ): Promise<{ row: PaymentRow; employee: EmployeeRow }> {
    const [peek] = await tx
      .select({ employeeId: contractorPayments.employeeId })
      .from(contractorPayments)
      .where(eq(contractorPayments.id, id));
    if (!peek) throw notFound("contractor payment");
    const employee = await this.lockPerson(tx, actor, peek.employeeId);
    const [row] = await tx.select().from(contractorPayments).where(eq(contractorPayments.id, id)).for("update");
    if (!row || row.deletedAt) throw notFound("contractor payment");
    return { row, employee };
  }

  private async lockPerson(tx: CompanyDb, actor: Actor, employeeId: string): Promise<EmployeeRow> {
    const employee = await lockEmployee(tx, employeeId);
    if ((await selfCheck(tx, actor))(employee.id)) throw refuse("Someone else must handle your own payment.");
    await requireLinkedDecider(tx, actor.access);
    return employee;
  }
}
