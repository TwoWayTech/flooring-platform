import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  changeOrderLines,
  changeOrders,
  contractLines,
  insuranceCertificates,
  insuranceCoverages,
  lienWaivers,
  paymentsMade,
  paymentsReceived,
} from "@workspace/db/company";
import {
  changeOrderDeltas,
  changeOrderProblem,
  dec,
  moneyString,
  waiverProblem,
  type ChangeOrder,
  type InsuranceCertificate,
  type InsuranceCoverage,
  type LienWaiver,
  type LienWaiverType,
  type TaxCategory,
} from "@workspace/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { companyClock, notFound, refuse } from "../sales/sales-common";
import { auditContract, lockContract, type ContractRow } from "./contract-common";
import { loadBillings, loadCertificates, loadChangeOrders, loadContractLines, loadWaivers } from "./contract-records";

/** A change order as the dialog sends it (spec "Change order status"). */
export interface ChangeOrderFields {
  reason: string;
  lines: { contractLineId: string | null; description: string; category: TaxCategory; amountDelta: string }[];
}

/** A lien waiver as the dialog sends it (spec rule 21). */
export interface WaiverFields {
  type: LienWaiverType;
  paymentId: string | null;
  supplierPaymentId: string | null;
  amount: string;
  throughDate: string;
  statutoryForm: boolean;
}

/** A certificate of insurance as the dialog sends it (spec rule 22). */
export interface CertificateFields {
  producer: string;
  holder: string;
  additionalInsured: boolean;
  coverages: InsuranceCoverage[];
}

/** Change orders take effect only while work can still be billed (spec "Change order status"). */
const takesChanges = (row: ContractRow) =>
  row.kind === "project" && (row.status === "active" || row.status === "completed");

/**
 * Change orders, lien waivers and certificates of insurance on the API (contracts.md; ADR 0044).
 * Each locks its contract, so numbers and line values can't race, checks the contract's data scope
 * (404 outside it) and writes audit_log in the same transaction.
 */
@Injectable()
export class ContractChangesService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
  ) {}

  /**
   * Submits a change order for approval (spec "Change order status"): an active or completed
   * project, a reason, and rows that name a line of this contract or none (a new line).
   */
  async submitChangeOrder(
    tenant: TenantContext,
    actor: Actor,
    contractId: string,
    input: ChangeOrderFields,
  ): Promise<ChangeOrder> {
    const reason = input.reason.trim();
    if (!reason) throw refuse("Say what is changing and why.");
    if (input.lines.length === 0 || input.lines.some((line) => !line.description.trim())) {
      throw refuse("Each line needs a description and an amount.");
    }
    const db = await this.tenancy.db(tenant);
    const id = uuidv7();
    await db.transaction(async (tx) => {
      const contract = await lockContract(tx, actor.access, contractId);
      if (!takesChanges(contract)) throw refuse("Only an active or completed project takes change orders.");
      const own = new Set((await loadContractLines(tx, [contractId])).map((line) => line.id));
      if (input.lines.some((line) => line.contractLineId && !own.has(line.contractLineId))) {
        throw refuse("A line on this change order is not on the contract.");
      }
      const [count] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(changeOrders)
        .where(eq(changeOrders.contractId, contractId));
      const number = `CO-${(count?.count ?? 0) + 1}`;
      await tx.insert(changeOrders).values({
        id,
        number,
        contractId,
        status: "pending",
        reason,
        submittedAt: new Date(),
        createdBy: actor.access.userId,
      });
      await tx.insert(changeOrderLines).values(
        input.lines.map((line) => ({
          id: uuidv7(),
          changeOrderId: id,
          contractLineId: line.contractLineId,
          description: line.description.trim(),
          category: line.category,
          amountDelta: moneyString(line.amountDelta),
          createdBy: actor.access.userId,
        })),
      );
      await auditContract(this.auditLog, tenant, actor, tx, "Submitted change order", contract, null, {
        changeOrder: number,
        reason,
      });
    });
    return (await loadChangeOrders(db, this.control.db, { ids: [id] }))[0]!;
  }

  /**
   * Approves or rejects a pending change order (spec rule 17). Approval runs `changeOrderProblem`,
   * then raises line values or adds new lines at once; issued invoices never change. Rejection
   * needs a reason of at least 3 characters.
   */
  async decideChangeOrder(
    tenant: TenantContext,
    actor: Actor,
    id: string,
    decision: { action: "approve" | "reject"; reason: string },
  ): Promise<ChangeOrder> {
    const reason = decision.reason.trim();
    const db = await this.tenancy.db(tenant);
    const [found] = await loadChangeOrders(db, this.control.db, { ids: [id] });
    if (!found) throw notFound("change order");
    await db.transaction(async (tx) => {
      const contract = await lockContract(tx, actor.access, found.contractId).catch((error: unknown) => {
        // Out of scope reads as missing; any other failure stays what it is.
        if (error instanceof NotFoundException) throw notFound("change order");
        throw error;
      });
      const [order] = await loadChangeOrders(tx, this.control.db, { ids: [id] });
      if (!order) throw notFound("change order");
      if (order.status !== "pending") throw refuse("This change order has already been decided.");
      const approve = decision.action === "approve";
      if (!approve && reason.length < 3) throw refuse("Say why it is rejected.");
      if (approve) await this.apply(tx, actor, contract, order);
      await tx
        .update(changeOrders)
        .set({
          status: approve ? "approved" : "rejected",
          decidedAt: new Date(),
          decidedById: actor.access.userId,
          decisionReason: reason || null,
          updatedAt: new Date(),
        })
        .where(eq(changeOrders.id, id));
      await auditContract(
        this.auditLog,
        tenant,
        actor,
        tx,
        approve ? "Approved change order" : "Rejected change order",
        contract,
        { changeOrder: order.number, status: "pending" },
        { status: approve ? "approved" : "rejected", reason: reason || null },
      );
    });
    return (await loadChangeOrders(db, this.control.db, { ids: [id] }))[0]!;
  }

  /**
   * Records a lien waiver on a project (spec rule 21): above zero, and an unconditional one only
   * after a confirmed payment. A payment must be the contract party's own: a customer payment on a
   * customer contract, a supplier payment on a subcontract.
   */
  async recordWaiver(
    tenant: TenantContext,
    actor: Actor,
    contractId: string,
    input: WaiverFields,
  ): Promise<LienWaiver> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const id = uuidv7();
    await db.transaction(async (tx) => {
      const contract = await lockContract(tx, actor.access, contractId);
      if (contract.kind !== "project") throw refuse("Lien waivers are recorded on project contracts.");
      const paymentConfirmed = await this.paymentConfirmed(tx, contract, input);
      const problem = waiverProblem(input, paymentConfirmed);
      if (problem) throw refuse(problem);
      const amount = moneyString(input.amount);
      await tx.insert(lienWaivers).values({
        id,
        contractId,
        direction: contract.direction === "customer" ? "given" : "received",
        type: input.type,
        paymentId: input.paymentId,
        supplierPaymentId: input.supplierPaymentId,
        amount,
        throughDate: input.throughDate,
        state: contract.jobSite.state,
        statutoryForm: input.statutoryForm,
        signedOn: clock.day,
        status: "received",
        createdBy: actor.access.userId,
      });
      await auditContract(this.auditLog, tenant, actor, tx, "Recorded lien waiver", contract, null, {
        type: input.type.replaceAll("_", " "),
        amount,
      });
    });
    return (await loadWaivers(db, { ids: [id] }))[0]!;
  }

  /**
   * Saves a subcontract's certificate of insurance (spec rule 22): at least one coverage, each with
   * an expiry on or after its effective date. A contract has one certificate, replaced on save.
   */
  async saveCertificate(
    tenant: TenantContext,
    actor: Actor,
    contractId: string,
    input: CertificateFields,
  ): Promise<InsuranceCertificate> {
    if (input.coverages.length === 0) throw refuse("Each coverage needs an expiry date.");
    if (input.coverages.some((coverage) => coverage.expiresOn < coverage.effectiveOn)) {
      throw refuse("A coverage can't expire before it takes effect.");
    }
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const contract = await lockContract(tx, actor.access, contractId);
      if (contract.direction !== "subcontractor" || !contract.supplierId) {
        throw refuse("Insurance certificates belong on a subcontract.");
      }
      const [existing] = await tx
        .select()
        .from(insuranceCertificates)
        .where(and(eq(insuranceCertificates.contractId, contractId), isNull(insuranceCertificates.deletedAt)));
      const values = {
        supplierId: contract.supplierId,
        producer: input.producer.trim(),
        holder: input.holder.trim(),
        additionalInsured: input.additionalInsured,
      };
      const certificateId = existing?.id ?? uuidv7();
      if (existing) {
        await tx
          .update(insuranceCertificates)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(insuranceCertificates.id, existing.id));
        await tx
          .update(insuranceCoverages)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(insuranceCoverages.certificateId, existing.id), isNull(insuranceCoverages.deletedAt)));
      } else {
        await tx
          .insert(insuranceCertificates)
          .values({ id: certificateId, contractId, ...values, createdBy: actor.access.userId });
      }
      await tx.insert(insuranceCoverages).values(
        input.coverages.map((coverage) => ({
          id: uuidv7(),
          certificateId,
          ...coverage,
          insurer: coverage.insurer.trim(),
          policyNumber: coverage.policyNumber.trim(),
          limits: coverage.limits.trim(),
          createdBy: actor.access.userId,
        })),
      );
      await auditContract(
        this.auditLog,
        tenant,
        actor,
        tx,
        "Saved insurance certificate",
        contract,
        existing ? { producer: existing.producer } : null,
        { producer: values.producer, coverages: input.coverages.map((c) => `${c.type} to ${c.expiresOn}`) },
      );
    });
    return (await loadCertificates(db, [contractId]))[0]!;
  }

  /** Applies an approved change order to the schedule in the caller's transaction (spec rule 17). */
  private async apply(tx: CompanyDb, actor: Actor, contract: ContractRow, order: ChangeOrder): Promise<void> {
    if (!takesChanges(contract)) throw refuse("This contract no longer takes change orders.");
    const lines = await loadContractLines(tx, [contract.id]);
    const problem = changeOrderProblem(order, lines, await loadBillings(tx, this.control.db, [contract.id]));
    if (problem) throw refuse(problem);
    // Each line moves once by the sum of its rows, so two rows on one line both count (PR #23 review).
    for (const [lineId, delta] of changeOrderDeltas(order)) {
      const line = lines.find((l) => l.id === lineId)!;
      await tx
        .update(contractLines)
        .set({ scheduledValue: moneyString(dec(line.scheduledValue).plus(delta)), updatedAt: new Date() })
        .where(eq(contractLines.id, line.id));
    }
    for (const [index, change] of order.lines.entries()) {
      if (change.lineId) continue;
      // A new line: code `<CO number>.<row>`, percent billing, the contract's rates, no estimated cost.
      await tx.insert(contractLines).values({
        id: uuidv7(),
        contractId: contract.id,
        code: `${order.number}.${index + 1}`,
        description: change.description,
        category: change.category,
        billing: "percent",
        scheduledValue: moneyString(change.amountDelta),
        retainagePct: null,
        storedRetainagePct: null,
        milestoneDueAt: null,
        changeOrderId: order.id,
        estimatedCost: "0.00",
        createdBy: actor.access.userId,
      });
    }
  }

  /** Whether the waiver's payment is a confirmed one from or to this contract's party; refuses one that isn't theirs. */
  private async paymentConfirmed(tx: CompanyDb, contract: ContractRow, input: WaiverFields): Promise<boolean> {
    if (input.paymentId && input.supplierPaymentId) throw refuse("Choose one payment.");
    if (input.paymentId) {
      const [payment] = await tx
        .select({ status: paymentsReceived.status, customerId: paymentsReceived.customerId })
        .from(paymentsReceived)
        .where(and(eq(paymentsReceived.id, input.paymentId), isNull(paymentsReceived.deletedAt)));
      if (!payment || !contract.customerId || payment.customerId !== contract.customerId) {
        throw refuse("Choose a payment from this contract's customer.");
      }
      return payment.status === "confirmed";
    }
    if (input.supplierPaymentId) {
      const [payment] = await tx
        .select({ status: paymentsMade.status, supplierId: paymentsMade.supplierId })
        .from(paymentsMade)
        .where(and(eq(paymentsMade.id, input.supplierPaymentId), isNull(paymentsMade.deletedAt)));
      if (!payment || !contract.supplierId || payment.supplierId !== contract.supplierId) {
        throw refuse("Choose a payment to this contract's subcontractor.");
      }
      return payment.status === "confirmed";
    }
    return false;
  }
}
