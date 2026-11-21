import { ConflictException, ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  attachments,
  contracts,
  employees,
  invoices,
  paymentsReceived,
  refunds,
  rolePermissions,
  userRoles,
} from "@workspace/db/company";
import type { StorageProvider } from "@workspace/providers";
import {
  cashAccountFor,
  featureOn,
  dec,
  invoiceLedger,
  paymentPosting,
  paymentVoidLines,
  refundPosting,
  moneyString,
  needsApproval,
  nextPaymentNumber,
  validatePayment,
  validateRefund,
  type Payment,
  type PermissionKey,
  type RecordPaymentInput,
  type Refund,
  type RefundInput,
} from "@workspace/shared";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { StepUpService } from "../../core/auth/step-up.service";
import { CONTROL_DB } from "../../core/database/control-db";
import { loadAccountingForPosting } from "../../core/ledger/accounting-settings";
import { loadExpenses, locationBranches, seesExpense, seesPayroll } from "../finance/expense-records";
import { viewerEmployeeId } from "../hr/hr-records";
import { LedgerService } from "../../core/ledger/ledger.service";
import { NotificationService } from "../../core/notifications/notification.service";
import { STORAGE } from "../../core/storage/storage.module";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { creditNow, invoiceInScope, invoiceState, lockCustomer } from "./invoice-ledger";
import { loadMoneyFormat, loadPaymentSettings, loadPayments, loadRefunds } from "./invoice-records";
import { checkProofs, withStoredProofs, type ProofUpload } from "./proof-files";
import { companyClock, notFound, refuse, seesCustomer, seesDocument } from "./sales-common";
import { loadBranches, loadCustomers } from "./sales-records";

/** A reviewer's decision on a pending payment (spec rule 28). */
export type PaymentDecision = { action: "confirm" } | { action: "reject"; reason: string };

/** A stored proof file as the viewer opens it. */
export interface ProofFile {
  name: string;
  contentType: string;
  body: Uint8Array;
}

/** The first error of a form check, as one refusal. */
function firstProblem(errors: Record<string, string | undefined>): void {
  const problem = Object.values(errors).find(Boolean);
  if (problem) throw refuse(problem);
}

/**
 * Customer payments and refunds on the server (docs/product-spec/sales.md "Payments",
 * "Corrections"; ADR 0038). Proof is required and checked by its real type; the two-person check
 * decides whether a payment waits; a reviewer is never the recorder. Each write takes the
 * customer's lock and reads the balance or credit again inside it, and is audited. Ledger postings
 * arrive with P12.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger("Payments");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    @Inject(STORAGE) private readonly storage: StorageProvider,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly notifications: NotificationService,
    private readonly books: LedgerService,
    private readonly stepUp: StepUpService,
  ) {}

  /**
   * Records a payment with its proof (spec rules 25 to 28): checked again here, a duplicate
   * reference only once the person confirmed it, the extra above the balance only as credit and
   * with `sales.payment.apply_credit`. It waits for a second person when approval needs it, or
   * when the recorder sees only their own sales (plan N-1).
   */
  async record(
    tenant: TenantContext,
    actor: Actor,
    input: RecordPaymentInput,
    files: readonly ProofUpload[],
  ): Promise<Payment> {
    const proofs = checkProofs(files);
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const found = await invoiceInScope(db, actor.access, input.invoiceId, clock.zone);
    const [settings, money] = await Promise.all([loadPaymentSettings(db), loadMoneyFormat(db)]);
    const id = uuidv7();
    const recorded = await withStoredProofs(this.storage, tenant.companyId, proofs, (attach) =>
      db.transaction(async (tx) => {
        await lockCustomer(tx, found.customerId);
        const { invoice, ledger } = await invoiceState(tx, this.control.db, found.id, clock);
        if (ledger.state === "void" || ledger.state === "return" || dec(ledger.balance).lte(0)) {
          throw refuse(`Invoice ${invoice.number} has nothing left to pay.`);
        }
        firstProblem(
          validatePayment(input, {
            issuedAt: invoice.issuedAt,
            today: clock.day,
            balance: ledger.balance,
            canCredit: actor.access.permissions.has("sales.payment.apply_credit"),
            formatMoney: money,
          }),
        );
        const reference = input.reference.trim();
        // Company-wide, so two payments for different customers cannot both take one reference.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sales:payment-number'))`);
        if (input.method !== "cash" && reference) {
          const [duplicate] = await tx
            .select({ id: paymentsReceived.id })
            .from(paymentsReceived)
            .where(
              and(
                sql`lower(trim(${paymentsReceived.reference})) = ${reference.toLowerCase()}`,
                ne(paymentsReceived.status, "voided"),
                isNull(paymentsReceived.deletedAt),
              ),
            )
            .limit(1);
          if (duplicate && !input.allowDuplicateReference) {
            throw new ConflictException({
              code: "duplicate_reference",
              message: `Another payment already uses reference ${reference}. Check it, then confirm to record it anyway.`,
            });
          }
        }
        const used = await tx.select({ number: paymentsReceived.number }).from(paymentsReceived);
        const waits = needsApproval(settings, input.amount) || actor.access.dataScope === "own";
        const now = new Date();
        const row = {
          id,
          number: nextPaymentNumber(
            settings.paymentPrefix,
            used.map((r) => r.number),
          ),
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          kind: input.kind,
          amount: moneyString(input.amount.trim()),
          date: input.date,
          method: input.method,
          checkNumber: input.method === "check" ? input.checkNumber.trim() : "",
          cardLast4: input.method === "card" ? input.cardLast4.trim() : "",
          reference,
          note: input.note.trim(),
          status: waits ? ("pending" as const) : ("confirmed" as const),
          recordedById: actor.access.userId,
          recordedAt: now,
          createdBy: actor.access.userId,
        };
        await tx.insert(paymentsReceived).values(row);
        await attach(tx, "payment", id, actor.access.userId);
        if (row.status === "confirmed") {
          // A payment counts, and posts, once confirmed; a pending one waits for its reviewer.
          const [saved] = await loadPayments(tx, this.control.db, { ids: [id] });
          const cash = cashAccountFor(await loadAccountingForPosting(tx), saved!.method);
          await this.books.post(tx, paymentPosting(saved!, invoice.number, ledger.balance, cash), actor.access.userId);
        }
        await this.auditLog.record(
          tenant,
          actor.audit,
          {
            category: "payment",
            action: row.kind === "deposit" ? "Recorded deposit" : "Recorded payment",
            targetType: "payment",
            targetId: id,
            targetLabel: `${row.number} on ${invoice.number}`,
            before: { balance: ledger.balance },
            after: {
              amount: row.amount,
              method: row.method,
              reference: row.reference,
              status: row.status,
              files: proofs.length,
            },
          },
          tx,
        );
        return { number: row.number, status: row.status, invoice };
      }),
    );
    const [payment] = await loadPayments(db, this.control.db, { ids: [id] });
    if (recorded.status === "pending")
      await this.askToVerify(tenant, actor, db, recorded.invoice.number, payment!, money);
    else await this.sendReceipt(tenant, actor, payment!, money);
    return payment!;
  }

  /**
   * Confirms or rejects a pending payment (spec rule 28): never by the person who recorded it, and
   * a rejection needs a reason of at least 3 characters.
   */
  async review(tenant: TenantContext, actor: Actor, paymentId: string, decision: PaymentDecision): Promise<Payment> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const before = await this.paymentInScope(db, actor.access, paymentId, clock.zone);
    const reason = decision.action === "reject" ? decision.reason.trim() : "";
    if (decision.action === "reject" && reason.length < 3) throw refuse("Say why the payment is rejected.");
    await db.transaction(async (tx) => {
      await lockCustomer(tx, before.customerId);
      const [payment] = await loadPayments(tx, this.control.db, { ids: [paymentId] });
      if (!payment) throw notFound("payment");
      if (payment.status !== "pending") throw refuse(`Payment ${payment.number} is not waiting for verification.`);
      if (payment.recordedById === actor.access.userId) {
        throw new ForbiddenException({
          code: "forbidden",
          message: "Someone other than the person who recorded a payment must verify it.",
        });
      }
      const state =
        decision.action === "confirm" ? await invoiceState(tx, this.control.db, payment.invoiceId, clock) : null;
      if (state) {
        const { ledger } = state;
        if (dec(payment.amount).gt(ledger.balance) && !actor.access.permissions.has("sales.payment.apply_credit")) {
          throw refuse(
            `Payment ${payment.number} is more than the balance now. Someone who may give customer credit must confirm it.`,
          );
        }
      }
      const now = new Date();
      await tx
        .update(paymentsReceived)
        .set({
          status: decision.action === "confirm" ? "confirmed" : "rejected",
          reviewedById: actor.access.userId,
          reviewedAt: now,
          rejectReason: reason || null,
          updatedAt: now,
        })
        .where(eq(paymentsReceived.id, paymentId));
      if (state) {
        const cash = cashAccountFor(await loadAccountingForPosting(tx), payment.method);
        await this.books.post(
          tx,
          paymentPosting(payment, state.invoice.number, state.ledger.balance, cash),
          actor.access.userId,
        );
      }
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "payment",
          action: decision.action === "confirm" ? "Confirmed payment" : "Rejected payment",
          targetType: "payment",
          targetId: paymentId,
          targetLabel: payment.number,
          before: { status: "pending", amount: payment.amount },
          after: decision.action === "confirm" ? { status: "confirmed" } : { status: "rejected", reason },
        },
        tx,
      );
    });
    const [reviewed] = await loadPayments(db, this.control.db, { ids: [paymentId] });
    if (reviewed!.status === "confirmed") await this.sendReceipt(tenant, actor, reviewed!, await loadMoneyFormat(db));
    return reviewed!;
  }

  /**
   * Voids a pending or confirmed payment with a reason (spec rule 32): it stays with its files and
   * the balance comes back. A payment whose extra already became credit that was applied or
   * refunded cannot be voided, or the customer's credit would go below what was spent.
   */
  async voidPayment(tenant: TenantContext, actor: Actor, paymentId: string, reason: string): Promise<Payment> {
    const why = reason.trim();
    if (why.length < 3) throw refuse("Say why the payment is voided.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const before = await this.paymentInScope(db, actor.access, paymentId, clock.zone);
    await db.transaction(async (tx) => {
      await lockCustomer(tx, before.customerId);
      const { invoice, payments, adjustments, ledger } = await invoiceState(
        tx,
        this.control.db,
        before.invoiceId,
        clock,
      );
      const payment = payments.find((p) => p.id === paymentId);
      if (!payment) throw notFound("payment");
      if (payment.status !== "confirmed" && payment.status !== "pending") {
        throw refuse(`Payment ${payment.number} is already ${payment.status}.`);
      }
      const after = invoiceLedger(
        invoice,
        { payments: payments.map((p) => (p.id === paymentId ? { ...p, status: "voided" as const } : p)), adjustments },
        clock.day,
      );
      // A credit note on the invoice may have become credit only because this payment counted.
      const [liveNote] = await tx
        .select({ number: invoices.number })
        .from(invoices)
        .where(and(eq(invoices.creditForInvoiceId, invoice.id), isNull(invoices.voidedAt), isNull(invoices.deletedAt)))
        .limit(1);
      if (liveNote && payment.status === "confirmed") {
        throw refuse(`Invoice ${invoice.number} has credit note ${liveNote.number}, so its payments can't be voided.`);
      }
      const lostCredit = dec(ledger.overpaid).minus(after.overpaid);
      if (lostCredit.gt(0) && (await creditNow(tx, this.control.db, invoice.customerId, clock)).lt(lostCredit)) {
        throw refuse(`Credit from payment ${payment.number} was already applied or refunded, so it can't be voided.`);
      }
      const now = new Date();
      await tx
        .update(paymentsReceived)
        .set({ status: "voided", voidedById: actor.access.userId, voidedAt: now, voidReason: why, updatedAt: now })
        .where(eq(paymentsReceived.id, paymentId));
      // Only a confirmed payment posted; a pending one has nothing to reverse.
      if (payment.status === "confirmed") {
        const posted = { sourceType: "payment", sourceId: paymentId, event: "payment.confirmed" } as const;
        // Credit the bank the money went into, whatever the method's bank account is now (ADR 0040).
        // Null only when the payment never posted, and then `reverse` posts nothing either.
        const cash = (await this.books.postedCashAccount(tx, posted)) ?? "cash";
        await this.books.reverse(
          tx,
          posted,
          clock.day,
          actor.access.userId,
          paymentVoidLines(payment, moneyString(lostCredit), cash),
        );
      }
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "payment",
          action: "Voided payment",
          targetType: "payment",
          targetId: paymentId,
          targetLabel: `${payment.number} on ${invoice.number}`,
          before: { amount: payment.amount, status: payment.status },
          after: { status: "voided", reason: why, balance: after.balance },
        },
        tx,
      );
    });
    return (await loadPayments(db, this.control.db, { ids: [paymentId] }))[0]!;
  }

  /** Adds proof files to a payment that is not voided or rejected, up to 3 in all (spec rule 27). */
  async attachFiles(
    tenant: TenantContext,
    actor: Actor,
    paymentId: string,
    files: readonly ProofUpload[],
  ): Promise<Payment> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const before = await this.paymentInScope(db, actor.access, paymentId, clock.zone);
    const proofs = checkProofs(files, before.files.length);
    await withStoredProofs(this.storage, tenant.companyId, proofs, (attach) =>
      db.transaction(async (tx) => {
        await lockCustomer(tx, before.customerId);
        const [payment] = await loadPayments(tx, this.control.db, { ids: [paymentId] });
        if (!payment) throw notFound("payment");
        if (payment.status === "voided" || payment.status === "rejected") {
          throw refuse(`Payment ${payment.number} is ${payment.status}; files can't be added.`);
        }
        checkProofs(files, payment.files.length);
        await attach(tx, "payment", paymentId, actor.access.userId);
        await this.auditLog.record(
          tenant,
          actor.audit,
          {
            category: "payment",
            action: "Attached file to payment",
            targetType: "payment",
            targetId: paymentId,
            targetLabel: payment.number,
            before: { files: payment.files.length },
            after: { files: payment.files.length + proofs.length, names: proofs.map((proof) => proof.name) },
          },
          tx,
        );
      }),
    );
    return (await loadPayments(db, this.control.db, { ids: [paymentId] }))[0]!;
  }

  /**
   * Refunds customer credit with proof (spec rule 37): at most the credit, a date not in the
   * future, a reference for anything but cash. It lowers the credit and touches no invoice.
   */
  async refund(
    tenant: TenantContext,
    actor: Actor,
    input: RefundInput,
    files: readonly ProofUpload[],
  ): Promise<Refund> {
    const proofs = checkProofs(files);
    const db = await this.tenancy.db(tenant);
    const [[customer], branches] = await Promise.all([loadCustomers(db, [input.customerId]), loadBranches(db)]);
    if (!customer || !seesCustomer(actor.access, customer, branches)) throw notFound("customer");
    const clock = await companyClock(this.control.db, tenant);
    const [settings, money] = await Promise.all([loadPaymentSettings(db), loadMoneyFormat(db)]);
    const id = uuidv7();
    await withStoredProofs(this.storage, tenant.companyId, proofs, (attach) =>
      db.transaction(async (tx) => {
        await lockCustomer(tx, customer.id);
        const credit = moneyString(await creditNow(tx, this.control.db, customer.id, clock));
        firstProblem(validateRefund(input, { credit, today: clock.day, formatMoney: money }));
        // A refund sends money out, so it needs a fresh step-up, asked after its checks (ADR 0063).
        await this.stepUp.require(actor.session);
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sales:refund-number'))`);
        const used = await tx.select({ number: refunds.number }).from(refunds);
        const now = new Date();
        const row = {
          id,
          number: nextPaymentNumber(
            settings.refundPrefix,
            used.map((r) => r.number),
          ),
          customerId: customer.id,
          amount: moneyString(input.amount.trim()),
          date: input.date,
          method: input.method,
          reference: input.reference.trim(),
          note: input.note.trim(),
          status: "completed" as const,
          byUserId: actor.access.userId,
          at: now,
          createdBy: actor.access.userId,
        };
        await tx.insert(refunds).values(row);
        await attach(tx, "refund", id, actor.access.userId);
        const [saved] = await loadRefunds(tx, this.control.db, { ids: [id] });
        const cash = cashAccountFor(await loadAccountingForPosting(tx), saved!.method);
        await this.books.post(tx, refundPosting(saved!, cash), actor.access.userId);
        await this.auditLog.record(
          tenant,
          actor.audit,
          {
            category: "payment",
            action: "Refunded customer credit",
            targetType: "refund",
            targetId: id,
            targetLabel: `${row.number} to ${customer.name}`,
            before: { credit },
            after: { amount: row.amount, method: row.method, reference: row.reference, files: proofs.length },
          },
          tx,
        );
      }),
    );
    return (await loadRefunds(db, this.control.db, { ids: [id] }))[0]!;
  }

  /**
   * A stored proof file, for someone whose data scope covers its payment's invoice or its refund's
   * customer. Anything else answers 404, so a file id never reveals another record.
   */
  async file(tenant: TenantContext, access: RequestAccess, fileId: string): Promise<ProofFile> {
    const db = await this.tenancy.db(tenant);
    const [row] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, fileId), isNull(attachments.deletedAt)));
    if (!row) throw notFound("file");
    const may = (...keys: PermissionKey[]) => keys.some((key) => access.permissions.has(key));
    // The route asks only for `platform` (HR Suite has no `core`), so each owner type checks its module.
    const core = access.modules.includes("core");
    const payments = featureOn("sales.payments") && core;
    if (row.ownerType === "employee") {
      // An employee document is HR's (hr.md "Who uses it": People needs hr.employee.view; no data
      // scope). The person it is about opens it in My documents with hr.portal.view: only a document
      // on the employee linked to their own sign-in (employee-portal.md known limits; ADR 0049).
      const hrReader = may("hr.employee.view") && featureOn("hr.employees");
      const ownReader =
        !hrReader &&
        may("hr.portal.view") &&
        featureOn("hr.portal") &&
        (await viewerEmployeeId(db, access.userId)) === row.ownerId;
      if ((!hrReader && !ownReader) || !access.modules.includes("hr")) throw notFound("file");
      const [person] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.id, row.ownerId), isNull(employees.deletedAt)));
      if (!person) throw notFound("file");
    } else if (!core) {
      throw notFound("file");
    } else if (row.ownerType === "payment" && payments && may("sales.payment.view", "sales.payment.approve")) {
      await this.paymentInScope(db, access, row.ownerId, (await companyClock(this.control.db, tenant)).zone).catch(
        () => {
          throw notFound("file");
        },
      );
    } else if (row.ownerType === "refund" && payments && may("sales.payment.view", "sales.payment.refund")) {
      const [refund] = await loadRefunds(db, this.control.db, { ids: [row.ownerId] });
      const [[customer], branches] = await Promise.all([
        loadCustomers(db, refund ? [refund.customerId] : []),
        loadBranches(db),
      ]);
      if (!customer || !seesCustomer(access, customer, branches)) throw notFound("file");
    } else if (row.ownerType === "expense" && may("finance.expense.view") && featureOn("finance.expenses")) {
      // An expense receipt is read only within the expense's data scope (blueprint-delta 2026-11-14).
      const [[expense], branches] = await Promise.all([
        loadExpenses(db, this.control.db, [row.ownerId]),
        locationBranches(db),
      ]);
      if (!expense || !seesExpense(access, expense, branches) || !seesPayroll(access, expense)) throw notFound("file");
    } else if (
      (row.ownerType === "bill" || row.ownerType === "supplier_payment") &&
      featureOn("purchasing.orders") &&
      may("purchasing.bill.view", "purchasing.payment.record", "purchasing.payment.approve")
    ) {
      // Purchasing has no data scope (purchasing.md "Who uses it"); the keys decide.
    } else if (row.ownerType === "contract" && may("contracts.contract.view") && featureOn("contracts.register")) {
      // A contract document is read only within the contract's data scope (contracts.md "Who uses it").
      const [contract] = await db
        .select({ salesRepId: contracts.salesRepId, branchId: contracts.branchId })
        .from(contracts)
        .where(and(eq(contracts.id, row.ownerId), isNull(contracts.deletedAt)));
      if (!contract || !seesDocument(access, contract) || !access.modules.includes("contracts")) throw notFound("file");
    } else {
      throw notFound("file");
    }
    // The key is the company's own: stored under its id when the file was written.
    if (!row.storageKey.startsWith(`${tenant.companyId}/`)) throw notFound("file");
    const stored = await this.storage.get(row.storageKey);
    if (!stored) throw notFound("file");
    return { name: row.name, contentType: row.contentType, body: stored.body };
  }

  /** A payment whose invoice the person's data scope covers, or 404. */
  private async paymentInScope(
    db: CompanyDb,
    access: RequestAccess,
    paymentId: string,
    zone: string,
  ): Promise<Payment> {
    const [payment] = await loadPayments(db, this.control.db, { ids: [paymentId] });
    if (!payment) throw notFound("payment");
    await invoiceInScope(db, access, payment.invoiceId, zone).catch(() => {
      throw notFound("payment");
    });
    return payment;
  }

  /** Tells the people who may approve payments that one waits (`payment.to_verify`, in-app). */
  private async askToVerify(
    tenant: TenantContext,
    actor: Actor,
    db: CompanyDb,
    invoiceNumber: string,
    payment: Payment,
    money: (value: string) => string,
  ): Promise<void> {
    try {
      const holders = await db
        .selectDistinct({ userId: userRoles.userId })
        .from(userRoles)
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
        .where(
          and(
            eq(rolePermissions.permissionKey, "sales.payment.approve"),
            isNull(userRoles.deletedAt),
            isNull(rolePermissions.deletedAt),
          ),
        );
      const title = `Payment to verify on ${invoiceNumber}`;
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "payment.to_verify",
        source: { type: "payment", id: payment.id },
        inApp: holders.map((holder) => ({
          userId: holder.userId,
          title,
          href: `/sales/invoices/${payment.invoiceId}`,
        })),
        values: {
          "actor.name": actor.session.user.name,
          "document.number": invoiceNumber,
          "payment.amount": money(payment.amount),
        },
      });
    } catch {
      this.logger.warn("A payment waits for verification, but the approvers could not be told.");
    }
  }

  /** Emails the customer a receipt (`payment.receipt`) once a payment counts. */
  private async sendReceipt(
    tenant: TenantContext,
    actor: Actor,
    payment: Payment,
    money: (value: string) => string,
  ): Promise<void> {
    try {
      const db = await this.tenancy.db(tenant);
      const clock = await companyClock(this.control.db, tenant);
      const [[customer], state] = await Promise.all([
        loadCustomers(db, [payment.customerId]),
        invoiceState(db, this.control.db, payment.invoiceId, clock),
      ]);
      if (!customer?.email) return;
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "payment.receipt",
        source: { type: "payment", id: payment.id },
        to: [{ kind: "customer", id: customer.id, name: customer.name, email: customer.email }],
        values: {
          "customer.name": customer.name,
          "invoice.number": state.invoice.number,
          "invoice.balance": money(state.ledger.balance),
          "payment.amount": money(payment.amount),
        },
      });
    } catch {
      this.logger.warn("A payment counts now, but its receipt could not be queued.");
    }
  }
}
