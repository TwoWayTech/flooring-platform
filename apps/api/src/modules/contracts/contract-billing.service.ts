import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  contractBillingLines,
  contractBillingReleases,
  contractBillings,
  invoices,
  paymentAllocations,
  paymentsMade,
  paymentsReceived,
  supplierBills,
} from "@workspace/db/company";
import {
  featureOn,
  allocateRelease,
  billingFigures,
  billingProblem,
  contractBill,
  contractBillPosting,
  contractInvoice,
  contractInvoicePosting,
  dec,
  heldByLine,
  lineRates,
  moneyString,
  sum,
  type BillingLine,
  type BillingRef,
  type Contract,
  type ContractBilling,
  type ContractLine,
  type Invoice,
} from "@workspace/shared";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { LedgerService } from "../../core/ledger/ledger.service";
import { NotificationService } from "../../core/notifications/notification.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { loadSuppliers } from "../purchasing/purchasing-records";
import { creditNow, invoiceState, lockCustomer } from "../sales/invoice-ledger";
import { loadMoneyFormat } from "../sales/invoice-records";
import { insertInvoice, takeInvoiceNumber } from "../sales/invoice-writes";
import { companyClock, notFound, refuse, type CompanyClock } from "../sales/sales-common";
import { loadCustomers, loadLocalization } from "../sales/sales-records";
import { auditContract, lockContract, type ContractRow } from "./contract-common";
import { loadBillings, loadContractLines, loadContracts } from "./contract-records";

/** A progress billing as the form sends it (contracts.md "Steps in the screens", item 4). */
export interface BillingFields {
  periodEnd: string;
  lines: { contractLineId: string; completedToDate: string; storedBalance: string }[];
}

/** What one billing adds per contract line, as the invoice is built from (rule 12). */
interface LineAmount {
  lineId: string;
  gross: string;
  withheld: string;
  released: string;
}

/** A billing about to be filed, before its invoice or bill exists. */
interface NewBilling {
  id: string;
  kind: "progress" | "release";
  number: number;
  periodEnd: string;
  gross: string;
  withheld: string;
  released: string;
  lines: BillingLine[];
  releases: { lineId: string; amount: string }[];
}

/** Who to tell about a new customer invoice once the billing has committed. */
interface InvoiceNotice {
  invoice: Invoice;
  contract: Contract;
}

const POSTED_EVENT = "contract_billing.posted" as const;

/**
 * Contract billings on the API, part 2 (contracts.md rules 4 to 16 and 19; ADR 0045): progress
 * billings and retainage releases, each raising one invoice (customer contract) or one bill
 * (subcontract) posted to the ledger in the same transaction, and voids that reverse them. Every
 * write locks the contract first (404 outside the person's data scope), then the customer's lock
 * and the invoice-number lock, then the ledger, and is audited in the same transaction. Estimated
 * costs only shape the invoice's cost share; they never appear in a response, an audit entry or
 * an error.
 */
/** A billing whose retainage outruns its gross and tax would make a negative document (PR #24 review). */
const NEGATIVE_DOCUMENT =
  "This billing would hold back more retainage than it bills. Bill the work and stored materials together, or lower the retainage.";

@Injectable()
export class ContractBillingService {
  private readonly logger = new Logger("ContractBilling");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly books: LedgerService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Posts a progress billing (spec "Billing status"; rules 4 to 8): the contract is an active or
   * completed project, the cumulative figures pass `billingProblem`, and the rates are the line's
   * own or the contract's, taken here and snapshotted (fixing edge case 16). A billing that comes
   * to less than zero is refused (ADR 0045).
   */
  async postBilling(tenant: TenantContext, actor: Actor, contractId: string, input: BillingFields) {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const id = uuidv7();
    const notice = await db.transaction(async (tx) => {
      const row = await lockContract(tx, actor.access, contractId);
      if (row.kind !== "project") throw refuse("A master agreement is not billed. Bill its project contracts.");
      if (row.status !== "active" && row.status !== "completed") {
        throw refuse("Only an active or completed contract can be billed.");
      }
      const { contract, lines, past } = await this.contractState(tx, clock, contractId);
      const inputs = billingInputs(input, lines, contract);
      const problem = billingProblem(inputs, lines, past);
      if (problem) throw refuse(problem);
      const figures = billingFigures(inputs, past);
      if (figures.gross.lt(0)) {
        throw refuse(
          "This billing comes to less than zero. Void the last billing, or lower a line along with new work.",
        );
      }
      // A period can't end in the future, nor before the last billing's (PR #24 review).
      const lastPeriod = past
        .filter((entry) => entry.status === "posted")
        .reduce<string | null>(
          (latest, entry) => (!latest || entry.periodEnd > latest ? entry.periodEnd : latest),
          null,
        );
      if (input.periodEnd > clock.day) throw refuse("A billing period can't end in the future.");
      if (lastPeriod && input.periodEnd < lastPeriod) throw refuse("This period ends before the last billing's.");
      const billing: NewBilling = {
        id,
        kind: "progress",
        number: past.length + 1,
        periodEnd: input.periodEnd,
        gross: moneyString(figures.gross),
        withheld: moneyString(figures.withheld),
        released: "0.00",
        lines: inputs,
        releases: [],
      };
      const amounts = figures.lines.map((line) => ({
        lineId: line.lineId,
        gross: moneyString(line.gross),
        withheld: moneyString(line.withheld),
        released: "0.00",
      }));
      const filed = await this.file(tenant, tx, actor, clock, row, contract, lines, billing, amounts);
      // Revenue figures of a customer billing are audited as the demo does; a subcontract's are what
      // the company pays, which the audit log leaves out like other supplier money (CLAUDE.md rule 5).
      await auditContract(this.auditLog, tenant, actor, tx, "Posted contract billing", row, null, {
        number: billing.number,
        ...(row.direction === "customer"
          ? { gross: billing.gross, withheld: billing.withheld, invoice: filed.document }
          : { bill: filed.document }),
      });
      return filed.notice;
    });
    if (notice) await this.tellCustomer(tenant, actor, notice);
    return this.one(db, contractId, id);
  }

  /**
   * Releases held retainage on its own invoice or bill (rules 9 and 10): an amount above zero and
   * no more than held, shared over the lines by what each holds. A release has no status guard, so
   * retainage on a terminated or closed contract can still be paid out (edge case 4).
   */
  async releaseRetainage(tenant: TenantContext, actor: Actor, contractId: string, amount: string) {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const id = uuidv7();
    const notice = await db.transaction(async (tx) => {
      const row = await lockContract(tx, actor.access, contractId);
      if (row.kind !== "project") throw refuse("A master agreement holds no retainage.");
      const { contract, lines, past } = await this.contractState(tx, clock, contractId);
      const held = heldByLine(past, lines);
      const totalHeld = sum([...held.values()]);
      const value = dec(amount);
      if (value.lte(0) || value.gt(totalHeld)) throw refuse("Enter an amount up to what is held.");
      const releases = allocateRelease(moneyString(value), held);
      const billing: NewBilling = {
        id,
        kind: "release",
        number: past.length + 1,
        periodEnd: clock.day,
        gross: "0.00",
        withheld: "0.00",
        released: moneyString(value),
        lines: [],
        releases,
      };
      const amounts = releases.map((release) => ({
        lineId: release.lineId,
        gross: "0.00",
        withheld: "0.00",
        released: release.amount,
      }));
      const filed = await this.file(tenant, tx, actor, clock, row, contract, lines, billing, amounts);
      await auditContract(
        this.auditLog,
        tenant,
        actor,
        tx,
        "Released retainage",
        row,
        row.direction === "customer" ? { held: moneyString(totalHeld) } : null,
        row.direction === "customer"
          ? { number: billing.number, released: billing.released, invoice: filed.document }
          : { number: billing.number, bill: filed.document },
      );
      return filed.notice;
    });
    if (notice) await this.tellCustomer(tenant, actor, notice);
    return this.one(db, contractId, id);
  }

  /**
   * Voids the contract's latest posted billing (rule 19; edge cases 11 and 12; ADR 0045). On a
   * customer billing the invoice is voided, refused while a payment is confirmed or credit or a
   * write-off was applied, and its pending payments are voided with it. On a subcontract billing
   * the bill row is locked as a supplier payment locks it, refused while a pending or confirmed
   * payment is allocated to it, and soft-deleted. Either way the entry is reversed on the void day.
   */
  async voidBilling(tenant: TenantContext, actor: Actor, billingId: string, reason: string) {
    const why = reason.trim();
    if (why.length < 3) throw refuse("Say why this billing is being voided.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const [found] = await db
      .select({ contractId: contractBillings.contractId })
      .from(contractBillings)
      .where(and(eq(contractBillings.id, billingId), isNull(contractBillings.deletedAt)));
    if (!found) throw notFound("billing");
    await db.transaction(async (tx) => {
      const row = await lockContract(tx, actor.access, found.contractId).catch((error: unknown) => {
        // Out of scope reads as missing; any other failure stays what it is.
        if (error instanceof NotFoundException) throw notFound("billing");
        throw error;
      });
      if (row.status === "closed") throw refuse("This contract is closed, so its billings can't be voided.");
      const [billing] = await tx
        .select()
        .from(contractBillings)
        .where(eq(contractBillings.id, billingId))
        .for("update");
      if (!billing || billing.deletedAt) throw notFound("billing");
      if (billing.status !== "posted") throw refuse("This billing is already void.");
      const [latest] = await tx
        .select({ id: contractBillings.id })
        .from(contractBillings)
        .where(
          and(
            eq(contractBillings.contractId, row.id),
            eq(contractBillings.status, "posted"),
            isNull(contractBillings.deletedAt),
          ),
        )
        .orderBy(desc(contractBillings.number))
        .limit(1);
      if (latest?.id !== billingId) throw refuse("Only the latest billing can be voided.");
      if (billing.invoiceId) await this.voidInvoice(tenant, actor, tx, clock, billing.invoiceId, why);
      if (billing.billId) {
        await this.dropBill(tx, billing.billId);
        // The bill's own trail, with no money (supplier money stays out of the audit, ADR 0042).
        await this.auditLog.record(
          tenant,
          actor.audit,
          {
            category: "data",
            action: "Deleted bill for a voided contract billing",
            targetType: "bill",
            targetId: billing.billId,
            targetLabel: `${row.number} #${billing.number}`,
            after: { reason: why },
          },
          tx,
        );
      }
      await this.books.reverse(
        tx,
        { sourceType: "contract_billing", sourceId: billingId, event: POSTED_EVENT },
        clock.day,
        actor.access.userId,
      );
      await tx
        .update(contractBillings)
        .set({ status: "void", updatedAt: new Date() })
        .where(eq(contractBillings.id, billingId));
      await auditContract(
        this.auditLog,
        tenant,
        actor,
        tx,
        "Voided contract billing",
        row,
        { number: billing.number, status: "posted" },
        { status: "void", reason: why },
      );
    });
    return this.one(db, found.contractId, billingId);
  }

  /** The contract with its lines and billings, read under its row lock. */
  private async contractState(tx: CompanyDb, clock: CompanyClock, contractId: string) {
    const [[contract], lines, past] = await Promise.all([
      loadContracts(tx, this.control.db, clock.zone, [contractId]),
      loadContractLines(tx, [contractId]),
      loadBillings(tx, this.control.db, [contractId]),
    ]);
    return { contract: contract!, lines, past };
  }

  /**
   * Stores a billing with its lines or release shares, raises its invoice or bill and posts the
   * entry (rules 12 and 14; ADR 0045). The billing goes in first, since its document points at it.
   */
  private async file(
    tenant: TenantContext,
    tx: CompanyDb,
    actor: Actor,
    clock: CompanyClock,
    row: ContractRow,
    contract: Contract,
    lines: readonly ContractLine[],
    billing: NewBilling,
    amounts: readonly LineAmount[],
  ): Promise<{ document: string; notice: InvoiceNotice | null }> {
    // A billing raises an invoice or a bill, so their own switches must be on too (CLAUDE.md rule 13).
    if (!featureOn(row.direction === "customer" ? "sales.invoices" : "purchasing.orders")) {
      throw refuse(
        row.direction === "customer"
          ? "Invoices are switched off for this company."
          : "Bills are switched off for this company.",
      );
    }
    const by = actor.access.userId;
    await tx.insert(contractBillings).values({
      id: billing.id,
      contractId: row.id,
      number: billing.number,
      kind: billing.kind,
      periodEnd: billing.periodEnd,
      status: "posted",
      gross: billing.gross,
      withheld: billing.withheld,
      released: billing.released,
      postedAt: clock.now,
      postedById: by,
      createdBy: by,
    });
    if (billing.lines.length > 0) {
      await tx.insert(contractBillingLines).values(
        billing.lines.map((line) => ({
          billingId: billing.id,
          contractLineId: line.lineId,
          completedToDate: line.completedToDate,
          storedBalance: line.storedBalance,
          retainagePct: line.retainagePct,
          storedRetainagePct: line.storedRetainagePct,
          createdBy: by,
        })),
      );
    }
    if (billing.releases.length > 0) {
      await tx.insert(contractBillingReleases).values(
        billing.releases.map((release) => ({
          billingId: billing.id,
          contractLineId: release.lineId,
          amount: release.amount,
          createdBy: by,
        })),
      );
    }
    const ref: BillingRef = {
      id: billing.id,
      contractNumber: row.number,
      number: billing.number,
      kind: billing.kind,
    };
    if (row.direction === "customer") {
      const invoice = await this.raiseInvoice(tx, actor, clock, row, contract, lines, billing, amounts);
      // Retainage can outrun the gross when lines carry different rates; a negative invoice would read
      // as overpaid and become refundable credit, so it is refused and the transaction rolls back
      // (PR #24 review). A negative amount is a credit note's job.
      if (dec(invoice.total).lt(0)) throw refuse(NEGATIVE_DOCUMENT);
      await this.books.post(tx, contractInvoicePosting(ref, invoice), by);
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Created invoice for a contract billing",
          targetType: "invoice",
          targetId: invoice.id,
          targetLabel: `${invoice.number} for ${row.number} #${billing.number}`,
          // The invoice cost (the estimated cost share) stays out (CLAUDE.md rule 5).
          after: { total: invoice.total, tax: invoice.tax, taxRule: invoice.taxRule, dueAt: invoice.dueAt },
        },
        tx,
      );
      return { document: invoice.number, notice: { invoice, contract } };
    }
    const [supplier] = await loadSuppliers(tx, [row.supplierId ?? ""]);
    if (!supplier) throw refuse("This contract's subcontractor no longer exists.");
    const bill = contractBill(
      contract,
      supplier,
      { gross: billing.gross, withheld: billing.withheld, released: billing.released },
      { id: uuidv7(), number: `${row.number}-${billing.number}`, issuedAt: clock.day, billingId: billing.id },
    );
    if (dec(bill.total).lt(0)) throw refuse(NEGATIVE_DOCUMENT);
    await tx.insert(supplierBills).values({
      id: bill.id,
      number: bill.number,
      supplierId: supplier.id,
      poId: null,
      issuedAt: bill.issuedAt,
      dueAt: bill.dueAt,
      total: bill.total,
      matchIssues: [],
      contractId: row.id,
      billingId: billing.id,
      kind: bill.kind ?? "progress",
      gross: billing.gross,
      retainageWithheld: billing.withheld,
      retainageReleased: billing.released,
      createdBy: by,
    });
    await tx
      .update(contractBillings)
      .set({ billId: bill.id, updatedAt: new Date() })
      .where(eq(contractBillings.id, billing.id));
    await this.books.post(
      tx,
      contractBillPosting(
        ref,
        {
          number: bill.number,
          issuedAt: bill.issuedAt,
          total: bill.total,
          gross: billing.gross,
          retainageWithheld: billing.withheld,
          retainageReleased: billing.released,
          supplierName: supplier.name,
        },
        row.locationId,
      ),
      by,
    );
    await this.auditLog.record(
      tenant,
      actor.audit,
      {
        category: "data",
        action: "Entered bill for a contract billing",
        targetType: "bill",
        targetId: bill.id,
        targetLabel: `${bill.number} from ${supplier.name}`,
        // No money: the audit log is read by roles that may not see supplier money (CLAUDE.md rule 5).
        after: { kind: bill.kind ?? "progress", dueAt: bill.dueAt },
      },
      tx,
    );
    return { document: bill.number, notice: null };
  }

  /**
   * The customer invoice for a billing (rules 12, 13 and 15): taxed by the company's tax rules for
   * the job site on the company's date, numbered under the customer's lock and then the
   * invoice-number lock, and linked to the billing. Its lines carry each line's cost share.
   */
  private async raiseInvoice(
    tx: CompanyDb,
    actor: Actor,
    clock: CompanyClock,
    row: ContractRow,
    contract: Contract,
    lines: readonly ContractLine[],
    billing: NewBilling,
    amounts: readonly LineAmount[],
  ): Promise<Invoice> {
    const customerId = row.customerId ?? "";
    await lockCustomer(tx, customerId);
    const [[customer], localization] = await Promise.all([loadCustomers(tx, [customerId]), loadLocalization(tx)]);
    if (!customer) throw refuse("This contract's customer no longer exists.");
    const number = await takeInvoiceNumber(tx, localization.documents.invoicePrefix);
    const drafted = contractInvoice(contract, customer, lines, amounts, localization, {
      id: uuidv7(),
      number,
      issuedAt: clock.day,
      createdBy: actor.access.userId,
      billingId: billing.id,
    });
    // Invoice lines get their own ids; nothing points at a contract line through them.
    const invoice: Invoice = { ...drafted, lines: drafted.lines.map((line) => ({ ...line, id: uuidv7() })) };
    await insertInvoice(tx, invoice, actor.access.userId, clock.now);
    await tx
      .update(contractBillings)
      .set({ invoiceId: invoice.id, updatedAt: new Date() })
      .where(eq(contractBillings.id, billing.id));
    return invoice;
  }

  /**
   * Voids a billing's invoice under the customer's lock (rule 19), with the same refusals as any
   * invoice void: no confirmed payment, no credit applied, no write-off and no live credit note.
   * Pending payments are voided with it and audited. The billing's reversal undoes its entry.
   */
  private async voidInvoice(
    tenant: TenantContext,
    actor: Actor,
    tx: CompanyDb,
    clock: CompanyClock,
    invoiceId: string,
    why: string,
  ): Promise<void> {
    const [owner] = await tx
      .select({ customerId: invoices.customerId })
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    if (!owner) throw notFound("invoice");
    await lockCustomer(tx, owner.customerId);
    const { invoice, payments, ledger } = await invoiceState(tx, this.control.db, invoiceId, clock);
    if (invoice.voidedAt) throw refuse(`Invoice ${invoice.number} is already void.`);
    if (ledger.locked) throw refuse("This billing has a confirmed payment, so it can't be voided.");
    if (dec(ledger.credited).gt(0) || dec(ledger.writtenOff).gt(0)) {
      throw refuse(`Invoice ${invoice.number} has credit applied or a write-off, so the billing can't be voided.`);
    }
    const [liveNote] = await tx
      .select({ number: invoices.number })
      .from(invoices)
      .where(and(eq(invoices.creditForInvoiceId, invoiceId), isNull(invoices.voidedAt), isNull(invoices.deletedAt)))
      .limit(1);
    if (liveNote) throw refuse(`Void credit note ${liveNote.number} first.`);
    // Credit this invoice gave the customer that was already spent can't be taken back (as voidInvoice).
    // A guard: overpaid needs a confirmed payment, which the locked check above already refuses.
    if (
      dec(ledger.overpaid).gt(0) &&
      (await creditNow(tx, this.control.db, invoice.customerId, clock)).lt(ledger.overpaid)
    ) {
      throw refuse(
        `Credit from invoice ${invoice.number} was already applied or refunded, so the billing can't be voided.`,
      );
    }
    const now = new Date();
    const pending = payments.filter((payment) => payment.status === "pending");
    if (pending.length > 0) {
      await tx
        .update(paymentsReceived)
        .set({ status: "voided", voidedById: actor.access.userId, voidedAt: now, voidReason: why, updatedAt: now })
        .where(
          inArray(
            paymentsReceived.id,
            pending.map((payment) => payment.id),
          ),
        );
      for (const voided of pending) {
        await this.auditLog.record(
          tenant,
          actor.audit,
          {
            category: "payment",
            action: "Voided payment",
            targetType: "payment",
            targetId: voided.id,
            targetLabel: `${voided.number} on ${invoice.number}`,
            before: { amount: voided.amount, status: "pending" },
            after: { status: "voided", reason: why, withInvoice: true },
          },
          tx,
        );
      }
    }
    await tx.update(invoices).set({ voidedAt: now, voidReason: why, updatedAt: now }).where(eq(invoices.id, invoiceId));
    await this.auditLog.record(
      tenant,
      actor.audit,
      {
        category: "data",
        action: "Voided invoice",
        targetType: "invoice",
        targetId: invoiceId,
        targetLabel: invoice.number,
        before: { total: invoice.total, state: ledger.state },
        after: { reason: why, pendingPaymentsVoided: pending.length, withContractBilling: true },
      },
      tx,
    );
  }

  /**
   * Removes a subcontract billing's bill (rule 19): the bill row is locked as a supplier payment
   * and an expense void lock it (ADR 0042), and a pending or confirmed payment allocated to it
   * blocks the void. A bill has no void state, so it is soft-deleted.
   */
  private async dropBill(tx: CompanyDb, billId: string): Promise<void> {
    await tx.select({ id: supplierBills.id }).from(supplierBills).where(eq(supplierBills.id, billId)).for("update");
    const [paid] = await tx
      .select({ id: paymentsMade.id })
      .from(paymentAllocations)
      .innerJoin(paymentsMade, eq(paymentsMade.id, paymentAllocations.paymentId))
      .where(
        and(
          eq(paymentAllocations.billId, billId),
          isNull(paymentAllocations.deletedAt),
          isNull(paymentsMade.deletedAt),
          // Only a live payment blocks the void: a rejected or voided one paid nothing.
          inArray(paymentsMade.status, ["pending", "confirmed"]),
        ),
      )
      .limit(1);
    if (paid) throw refuse("This billing has a payment to the subcontractor, so it can't be voided.");
    await tx
      .update(supplierBills)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(supplierBills.id, billId));
  }

  /** Emails the customer the new invoice (`milestone.invoiced`); a failure never undoes the billing. */
  private async tellCustomer(tenant: TenantContext, actor: Actor, notice: InvoiceNotice): Promise<void> {
    try {
      const db = await this.tenancy.db(tenant);
      const [[customer], money] = await Promise.all([
        loadCustomers(db, [notice.invoice.customerId]),
        loadMoneyFormat(db),
      ]);
      if (!customer) return;
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "milestone.invoiced",
        source: { type: "invoice", id: notice.invoice.id },
        to: [{ kind: "customer", id: customer.id, name: customer.name, email: customer.email }],
        values: {
          "party.name": customer.name,
          "invoice.number": notice.invoice.number,
          "invoice.total": money(notice.invoice.total),
          "contract.title": notice.contract.title,
        },
      });
    } catch {
      this.logger.warn("A contract billing was posted, but its invoice email could not be queued.");
    }
  }

  private async one(db: CompanyDb, contractId: string, id: string): Promise<ContractBilling> {
    return (await loadBillings(db, this.control.db, [contractId])).find((billing) => billing.id === id)!;
  }
}

/**
 * The billing's lines with the rates in force, taken on the server from the line's override or the
 * contract (rule 4; edge case 16). Each contract line may appear once; a line that is not this
 * contract's is left for `billingProblem` to refuse.
 */
function billingInputs(input: BillingFields, lines: readonly ContractLine[], contract: Contract): BillingLine[] {
  if (input.lines.length === 0) throw refuse("Enter the work to date on at least one line.");
  const ids = input.lines.map((line) => line.contractLineId);
  if (new Set(ids).size !== ids.length) throw refuse("Each line can appear once on a billing.");
  return input.lines.map((entry) => {
    const line = lines.find((candidate) => candidate.id === entry.contractLineId);
    const rates = line ? lineRates(line, contract) : { retainagePct: "0", storedRetainagePct: "0" };
    return {
      lineId: entry.contractLineId,
      completedToDate: moneyString(entry.completedToDate),
      storedBalance: moneyString(entry.storedBalance),
      retainagePct: rates.retainagePct,
      storedRetainagePct: rates.storedRetainagePct,
    };
  });
}
