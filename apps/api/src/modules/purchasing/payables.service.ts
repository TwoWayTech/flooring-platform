import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  billReceipts,
  paymentAllocations,
  paymentsMade,
  rolePermissions,
  supplierBills,
  suppliers,
  userRoles,
} from "@workspace/db/company";
import type { StorageProvider } from "@workspace/providers";
import {
  allocate,
  billLedger,
  billPosting,
  cashAccountFor,
  dec,
  matchIssues,
  moneyString,
  needsApproval,
  nextPaymentNumber,
  receivedValue,
  separateDuties,
  supplierDueDate,
  supplierPaymentPosting,
  type Bill,
  type PaymentMethod,
  type SupplierPayment,
} from "@workspace/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { loadAccountingForPosting } from "../../core/ledger/accounting-settings";
import { LedgerService } from "../../core/ledger/ledger.service";
import { NotificationService } from "../../core/notifications/notification.service";
import { STORAGE } from "../../core/storage/storage.module";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { loadMoneyFormat, loadPaymentSettings } from "../sales/invoice-records";
import { checkProofs, withStoredProofs, type ProofUpload } from "../sales/proof-files";
import { companyClock, refuse } from "../sales/sales-common";
import { loadBills, loadSupplierPayments } from "./payables-records";
import { loadOrders, loadReceipts } from "./purchasing-records";

/** A supplier's bill as the screen sends it (purchasing rule 20). */
export interface BillInput {
  number: string;
  issuedAt: string;
  total: string;
}

/** A supplier payment as the screen sends it (purchasing rule 25). */
export interface SupplierPaymentInput {
  supplierId: string;
  amount: string;
  date: string;
  method: PaymentMethod;
  reference: string;
  note: string;
  /** The bills to pay, oldest due first; without them, the supplier's oldest open bills. */
  billIds?: string[];
}

/** A decision on a pending supplier payment. */
export type SupplierPaymentReview = { action: "confirm" } | { action: "reject"; reason: string };

/** Supplier payment numbers are company-wide, so one lock serialises taking them. */
const PAYMENT_NUMBER_LOCK = sql`select pg_advisory_xact_lock(hashtext('purchasing:payment-number'))`;

/** Bills are entered one at a time per company, so an order's receipts go on one bill only. */
const BILL_LOCK = sql`select pg_advisory_xact_lock(hashtext('purchasing:bill'))`;

/**
 * Bills and supplier payments on the API (purchasing.md rules 20 to 34; P12 part 3; ADR 0042). A
 * bill for received goods posts the payable; a confirmed payment posts the money out of the bank
 * for its method; a void posts the reversal. Bills a pay-later expense raised (ADR 0041) are paid
 * the same way, but never post as bills, because the expense posted the payable.
 */
@Injectable()
export class PayablesService {
  private readonly logger = new Logger("Payables");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    @Inject(STORAGE) private readonly storage: StorageProvider,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly books: LedgerService,
    private readonly notifications: NotificationService,
  ) {}

  /** Every bill. Purchasing has no data scope (purchasing.md "Who uses it"). */
  async bills(tenant: TenantContext): Promise<Bill[]> {
    return loadBills(await this.tenancy.db(tenant), this.control.db);
  }

  /** Every supplier payment. */
  async payments(tenant: TenantContext): Promise<SupplierPayment[]> {
    return loadSupplierPayments(await this.tenancy.db(tenant), this.control.db);
  }

  /**
   * Enters the supplier's bill for an order's received goods (rules 20 to 22): every receipt not
   * yet billed goes on it, a difference from the received value is flagged and never blocks, the
   * supplier's invoice is required, and the bill posts.
   */
  async enterBill(
    tenant: TenantContext,
    actor: Actor,
    poId: string,
    input: BillInput,
    files: readonly ProofUpload[],
  ): Promise<Bill> {
    const proofs = checkProofs(files);
    const number = input.number.trim();
    if (!number) throw refuse("Enter the supplier's bill number.");
    if (dec(input.total).lte(0)) throw refuse("Enter the bill total.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    if (input.issuedAt > clock.day) throw refuse("A bill can't be dated in the future.");
    const money = await loadMoneyFormat(db);
    const id = uuidv7();
    await withStoredProofs(this.storage, tenant.companyId, proofs, (attach) =>
      db.transaction(async (tx) => {
        await tx.execute(BILL_LOCK);
        const [po] = await loadOrders(tx, [poId]);
        if (!po) throw new NotFoundException({ code: "not_found", message: "This purchase order no longer exists." });
        const receipts = await loadReceipts(tx, [poId]);
        const billed = await tx
          .select({ receiptId: billReceipts.receiptId })
          .from(billReceipts)
          .where(isNull(billReceipts.deletedAt));
        const billedIds = new Set(billed.map((row) => row.receiptId));
        // What was received is what can be billed (rule 20): every receipt not yet on a bill.
        const open = receipts.filter((receipt) => !billedIds.has(receipt.id));
        if (open.length === 0) throw refuse("Every receipt of this order is already billed.");
        const [supplier] = await tx
          .select({ id: suppliers.id, name: suppliers.name, terms: suppliers.terms })
          .from(suppliers)
          .where(eq(suppliers.id, po.supplierId));
        if (!supplier) throw refuse("This order's supplier no longer exists.");
        const expected = receivedValue(po, open);
        const issues = matchIssues(input.total, expected, money);
        const total = moneyString(input.total);
        await tx.insert(supplierBills).values({
          id,
          number,
          supplierId: supplier.id,
          poId: po.id,
          issuedAt: input.issuedAt,
          dueAt: supplierDueDate(input.issuedAt, supplier.terms),
          total,
          matchIssues: issues,
          createdBy: actor.access.userId,
        });
        await tx
          .insert(billReceipts)
          .values(open.map((receipt) => ({ billId: id, receiptId: receipt.id, createdBy: actor.access.userId })));
        await attach(tx, "bill", id, actor.access.userId);
        await this.books.post(
          tx,
          billPosting(
            { id, number, issuedAt: input.issuedAt, total, supplierName: supplier.name },
            moneyString(expected),
          ),
          actor.access.userId,
        );
        await this.auditLog.record(
          tenant,
          actor.audit,
          {
            category: "data",
            action: "Entered bill",
            targetType: "bill",
            targetId: id,
            targetLabel: `${number} for ${po.number}`,
            // No money here: the audit log is read by roles that may not see order costs (rule 5;
            // PR #21 review), as the order's own audit leaves its total out.
            after: { receipts: open.length, matched: issues.length === 0 },
          },
          tx,
        );
      }),
    );
    return (await loadBills(db, this.control.db, [id]))[0]!;
  }

  /**
   * Records a payment to a supplier with its proof (rules 25 to 28): allocated oldest due first up
   * to what each bill still has unpaid, never more than that in all. Each bill row is locked, so
   * two payments, or a payment and an expense void, can't pass the same balance together. Above
   * the approval rule it waits for a second person; once it counts it posts.
   */
  async recordPayment(
    tenant: TenantContext,
    actor: Actor,
    input: SupplierPaymentInput,
    files: readonly ProofUpload[],
  ): Promise<SupplierPayment> {
    const proofs = checkProofs(files);
    const amount = dec(input.amount);
    if (amount.lte(0)) throw refuse("Enter the amount.");
    const reference = input.reference.trim();
    if (input.method !== "cash" && !reference) throw refuse("Enter the reference, such as the check number.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    if (input.date > clock.day) throw refuse("A payment can't be dated in the future.");
    const settings = await loadPaymentSettings(db);
    const id = uuidv7();
    const recorded = await withStoredProofs(this.storage, tenant.companyId, proofs, (attach) =>
      db.transaction(async (tx) => {
        await tx.execute(PAYMENT_NUMBER_LOCK);
        const bills = await this.lockSupplierBills(tx, input.supplierId, input.billIds);
        const payments = await loadSupplierPayments(tx, this.control.db);
        const open = bills
          .map((bill) => ({ ...bill, balance: billLedger(bill, payments, clock.day).unpaid }))
          .filter((bill) => dec(bill.balance).gt(0));
        const unpaid = open.reduce((total, bill) => total.plus(bill.balance), dec(0));
        if (amount.gt(unpaid)) throw refuse("That is more than the bills chosen still owe.");
        const allocations = allocate(moneyString(amount), open);
        const used = await tx.select({ number: paymentsMade.number }).from(paymentsMade);
        const status = needsApproval(settings, input.amount) ? ("pending" as const) : ("confirmed" as const);
        const number = nextPaymentNumber(
          "SP-",
          used.map((row) => row.number),
        );
        await tx.insert(paymentsMade).values({
          id,
          number,
          supplierId: input.supplierId,
          date: input.date,
          method: input.method,
          reference,
          note: input.note.trim(),
          amount: moneyString(amount),
          status,
          recordedById: actor.access.userId,
          recordedAt: new Date(),
          createdBy: actor.access.userId,
        });
        await tx
          .insert(paymentAllocations)
          .values(allocations.map((entry) => ({ paymentId: id, ...entry, createdBy: actor.access.userId })));
        await attach(tx, "supplier_payment", id, actor.access.userId);
        const supplierName = await this.supplierName(tx, input.supplierId);
        if (status === "confirmed")
          await this.post(
            tx,
            { id, number, date: input.date, amount: moneyString(amount), method: input.method, supplierName },
            actor,
          );
        await this.auditLog.record(
          tenant,
          actor.audit,
          {
            category: "payment",
            action: "Paid supplier",
            targetType: "supplier_payment",
            targetId: id,
            targetLabel: `${number} to ${supplierName}`,
            after: { amount: moneyString(amount), method: input.method, reference, status, allocations },
          },
          tx,
        );
        return { number, status, supplierName };
      }),
    );
    const [payment] = await loadSupplierPayments(db, this.control.db, [id]);
    if (recorded.status === "pending") await this.askToVerify(tenant, actor, db, payment!, recorded.supplierName);
    return payment!;
  }

  /** Confirms or rejects a pending supplier payment (rule 29): never by its recorder. */
  async review(
    tenant: TenantContext,
    actor: Actor,
    id: string,
    decision: SupplierPaymentReview,
  ): Promise<SupplierPayment> {
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const row = await this.lockPayment(tx, id);
      if (row.status !== "pending") throw refuse("This payment is not waiting for a check.");
      if (separateDuties(row.recordedById, actor.access.userId)) {
        throw refuse("Someone else must confirm a payment you recorded.");
      }
      const supplierName = await this.supplierName(tx, row.supplierId);
      if (decision.action === "confirm") {
        await tx
          .update(paymentsMade)
          .set({ status: "confirmed", reviewedById: actor.access.userId, reviewedAt: new Date() })
          .where(eq(paymentsMade.id, id));
        await this.post(tx, { ...row, supplierName }, actor);
      } else {
        const reason = decision.reason.trim();
        if (reason.length < 3) throw refuse("Say why the payment is rejected.");
        await tx
          .update(paymentsMade)
          .set({ status: "rejected", reviewedById: actor.access.userId, reviewedAt: new Date(), rejectReason: reason })
          .where(eq(paymentsMade.id, id));
      }
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "payment",
          action: decision.action === "confirm" ? "Confirmed supplier payment" : "Rejected supplier payment",
          targetType: "supplier_payment",
          targetId: id,
          targetLabel: `${row.number} to ${supplierName}`,
          before: { status: "pending" },
          after:
            decision.action === "confirm"
              ? { status: "confirmed" }
              : { status: "rejected", reason: decision.reason.trim() },
        },
        tx,
      );
    });
    return (await loadSupplierPayments(db, this.control.db, [id]))[0]!;
  }

  /**
   * Voids a pending or confirmed supplier payment with a reason (rule 29). A confirmed one posts
   * the reversal on the void day, crediting back the bank it was paid from (ADR 0040), and its
   * amount goes back on the bills.
   */
  async void(tenant: TenantContext, actor: Actor, id: string, reason: string): Promise<SupplierPayment> {
    const why = reason.trim();
    if (why.length < 3) throw refuse("Say why the payment is being voided.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    await db.transaction(async (tx) => {
      const row = await this.lockPayment(tx, id);
      if (row.status !== "pending" && row.status !== "confirmed") throw refuse("This payment can't be voided.");
      if (row.status === "confirmed") {
        const source = { sourceType: "supplier_payment", sourceId: id, event: "supplier_payment.confirmed" } as const;
        await this.books.reverse(tx, source, clock.day, actor.access.userId);
      }
      await tx
        .update(paymentsMade)
        .set({ status: "voided", voidedById: actor.access.userId, voidedAt: new Date(), voidReason: why })
        .where(eq(paymentsMade.id, id));
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "payment",
          action: "Voided supplier payment",
          targetType: "supplier_payment",
          targetId: id,
          targetLabel: `${row.number} to ${await this.supplierName(tx, row.supplierId)}`,
          before: { status: row.status },
          after: { reason: why },
        },
        tx,
      );
    });
    return (await loadSupplierPayments(db, this.control.db, [id]))[0]!;
  }

  /** Posts a confirmed payment: Accounts Payable against the bank for its method (ADR 0040). */
  private async post(
    tx: CompanyDb,
    payment: { id: string; number: string; date: string; amount: string; method: PaymentMethod; supplierName: string },
    actor: Actor,
  ): Promise<void> {
    const cash = cashAccountFor(await loadAccountingForPosting(tx), payment.method);
    await this.books.post(tx, supplierPaymentPosting(payment, cash), actor.access.userId);
  }

  /**
   * The supplier's bills, chosen ones or all, locked FOR UPDATE: a payment and an expense void
   * (ADR 0041) take the same row lock, so neither acts on a balance the other is changing.
   */
  private async lockSupplierBills(tx: CompanyDb, supplierId: string, billIds?: readonly string[]): Promise<Bill[]> {
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)));
    if (!supplier) throw refuse("Choose the supplier.");
    const rows = await tx
      .select({ id: supplierBills.id })
      .from(supplierBills)
      .where(
        and(
          eq(supplierBills.supplierId, supplierId),
          isNull(supplierBills.deletedAt),
          billIds && billIds.length > 0 ? inArray(supplierBills.id, [...billIds]) : undefined,
        ),
      )
      .orderBy(supplierBills.id)
      .for("update");
    if (billIds && billIds.length > 0 && rows.length !== new Set(billIds).size) {
      throw refuse("A bill chosen is not this supplier's, or no longer exists.");
    }
    return loadBills(
      tx,
      this.control.db,
      rows.map((row) => row.id),
    );
  }

  private async lockPayment(tx: CompanyDb, id: string) {
    const [row] = await tx.select().from(paymentsMade).where(eq(paymentsMade.id, id)).for("update");
    if (!row || row.deletedAt)
      throw new NotFoundException({ code: "not_found", message: "This payment no longer exists." });
    return row;
  }

  private async supplierName(tx: CompanyDb, supplierId: string): Promise<string> {
    const [row] = await tx.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, supplierId));
    return row?.name ?? "";
  }

  /** Tells the holders of `purchasing.payment.approve` that a payment waits (spec "Events"). */
  private async askToVerify(
    tenant: TenantContext,
    actor: Actor,
    db: CompanyDb,
    payment: SupplierPayment,
    supplierName: string,
  ): Promise<void> {
    try {
      const holders = await db
        .selectDistinct({ userId: userRoles.userId })
        .from(userRoles)
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
        .where(
          and(
            eq(rolePermissions.permissionKey, "purchasing.payment.approve"),
            isNull(userRoles.deletedAt),
            isNull(rolePermissions.deletedAt),
          ),
        );
      const money = await loadMoneyFormat(db);
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "payment.to_verify",
        source: { type: "supplier_payment", id: payment.id },
        inApp: holders.map((holder) => ({
          userId: holder.userId,
          title: `Payment to verify for ${supplierName}`,
          href: "/finance?view=payments",
        })),
        values: {
          "actor.name": actor.session.user.name,
          "document.number": payment.number,
          "payment.amount": money(payment.amount),
        },
      });
    } catch {
      this.logger.warn("A supplier payment waits for verification, but the approvers could not be told.");
    }
  }
}
