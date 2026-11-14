import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  invoiceAdjustments,
  invoiceCommissionSplits,
  invoiceLines,
  invoices,
  paymentsReceived,
  quotes,
  reservations,
  userProfiles,
} from "@workspace/db/company";
import {
  adjustmentPosting,
  creditNotePosting,
  dec,
  defaultAddress,
  invoiceFromQuote,
  invoiceFromRoll,
  invoicePosting,
  minDec,
  moneyString,
  nextNumber,
  planReservations,
  quoteIsOpen,
  quoteSendProblems,
  rollAvailable,
  roundMoney,
  sum,
  type Invoice,
  type InvoiceAdjustment,
  type Payment,
  type Refund,
  type Reservation,
} from "@workspace/shared";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { LedgerService } from "../../core/ledger/ledger.service";
import { NotificationService } from "../../core/notifications/notification.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { loadMovements, loadProducts, loadRolls } from "../inventory/inventory-records";
import { lockStock } from "../inventory/stock-lock";
import { creditNow, invoiceInScope, invoiceState, lockCustomer } from "./invoice-ledger";
import {
  loadAdjustments,
  loadInvoices,
  loadMoneyFormat,
  loadPaymentSettings,
  loadPayments,
  loadRefunds,
  loadReservations,
} from "./invoice-records";
import { companyClock, notFound, refuse, seesCustomer, seesDocument, type CompanyClock } from "./sales-common";
import { loadBranches, loadCustomers, loadLocalization, loadQuotes } from "./sales-records";

/** The first invoice number, as in the demo (`INV-1001`), and the credit note series (`CR-5001`, spec rule 22). */
const FIRST_INVOICE = 1001;
const CREDIT_PREFIX = "CR-";
const FIRST_CREDIT = 5001;

/** What a credit note carries (spec rule 38): the amount before tax and why. */
export interface CreditNoteRequest {
  subtotal: string;
  reason: string;
}

/** A reason of at least 3 characters, trimmed, or the rule's refusal (spec rules 32 to 34, 38). */
function reasonFor(reason: string, what: string): string {
  const why = reason.trim();
  if (why.length < 3) throw refuse(`Say why ${what}.`);
  return why;
}

/**
 * Sales on the server, part 2: invoices (docs/product-spec/sales.md "Conversion and invoices",
 * "Corrections"; ADR 0038). Invoices are read through data scope like quotes. Status, paid and
 * balance are derived from payments, credits and write-offs, never stored (ADR 0013). Money on one
 * customer changes under that customer's lock, stock under the stock lock, and every write is
 * audited in its transaction. Ledger postings arrive with P12.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger("Invoices");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly notifications: NotificationService,
    private readonly books: LedgerService,
  ) {}

  /** Invoices and credit notes the person may see. */
  async invoices(tenant: TenantContext, access: RequestAccess): Promise<Invoice[]> {
    const { zone } = await companyClock(this.control.db, tenant);
    const list = await loadInvoices(await this.tenancy.db(tenant), zone);
    return list.filter((invoice) => seesDocument(access, invoice));
  }

  /** Payments on invoices the person may see. */
  async payments(tenant: TenantContext, access: RequestAccess): Promise<Payment[]> {
    const db = await this.tenancy.db(tenant);
    const seen = await this.visibleInvoiceIds(db, access);
    return (await loadPayments(db, this.control.db)).filter((payment) => seen.has(payment.invoiceId));
  }

  /** Write-offs and credit applied on invoices the person may see. */
  async adjustments(tenant: TenantContext, access: RequestAccess): Promise<InvoiceAdjustment[]> {
    const db = await this.tenancy.db(tenant);
    const seen = await this.visibleInvoiceIds(db, access);
    return (await loadAdjustments(db, this.control.db)).filter((adjustment) => seen.has(adjustment.invoiceId));
  }

  /** Refunds to customers the person may see. */
  async refunds(tenant: TenantContext, access: RequestAccess): Promise<Refund[]> {
    const db = await this.tenancy.db(tenant);
    const [list, customers, branches] = await Promise.all([
      loadRefunds(db, this.control.db),
      loadCustomers(db),
      loadBranches(db),
    ]);
    const seen = new Set(customers.filter((c) => seesCustomer(access, c, branches)).map((c) => c.id));
    return list.filter((refund) => seen.has(refund.customerId));
  }

  /**
   * Stock held for invoices. Stock viewers see every hold, because availability counts them
   * (inventory spec C2), but a hold on an invoice outside their data scope comes without its
   * invoice, line or override reason (PR #15 review). Anyone else sees the holds of their own invoices.
   */
  async reservations(tenant: TenantContext, access: RequestAccess): Promise<Reservation[]> {
    const db = await this.tenancy.db(tenant);
    const [list, seen] = await Promise.all([loadReservations(db), this.visibleInvoiceIds(db, access)]);
    const stockViewer =
      access.permissions.has("inventory.product.view") || access.permissions.has("inventory.roll.view");
    if (!stockViewer) return list.filter((reservation) => seen.has(reservation.invoiceId));
    return list.map((reservation) =>
      seen.has(reservation.invoiceId)
        ? reservation
        : { ...reservation, invoiceId: "", lineId: "", overrideReason: null },
    );
  }

  /**
   * Converts an accepted quote into an invoice dated today (spec rule 19): the quote must still
   * pass every send check, totals are computed again here under the job site's tax rule on the
   * company's date, and the stock is held under the stock lock. A short line is recorded as short
   * and does not block the sale.
   */
  async convert(tenant: TenantContext, actor: Actor, quoteId: string): Promise<Invoice> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const id = uuidv7();
    await db.transaction(async (tx) => {
      // The quote row is locked, so two conversions of one quote cannot both pass the checks.
      await tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, quoteId)).for("update");
      const [quote] = await loadQuotes(tx, [quoteId]);
      if (!quote || !seesDocument(actor.access, quote)) throw notFound("quote");
      if (quote.invoiceId)
        throw new ConflictException({ code: "conflict", message: "This quote is already invoiced." });
      if (quote.status !== "accepted" || !quoteIsOpen(quote)) {
        throw refuse("Mark the quote accepted before converting it to an invoice.");
      }
      const problem = Object.values(quoteSendProblems(quote, null, clock.day))[0];
      if (problem) throw refuse(problem);
      const [customer] = await loadCustomers(tx, [quote.customerId]);
      if (!customer) throw refuse("This quote's customer no longer exists.");
      const localization = await loadLocalization(tx);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sales:invoice-number'))`);
      const used = await tx.select({ number: invoices.number }).from(invoices);
      const drafted = invoiceFromQuote(quote, customer, localization, {
        id,
        number: nextNumber(
          localization.documents.invoicePrefix,
          used.map((row) => row.number),
          FIRST_INVOICE,
        ),
        issuedAt: clock.day,
        createdBy: actor.access.userId,
        balanceDueDays: localization.documents.balanceDueDays,
      });
      // Invoice lines get their own ids; nothing points at a quote line (ADR 0037).
      const invoice: Invoice = { ...drafted, lines: drafted.lines.map((line) => ({ ...line, id: uuidv7() })) };
      await this.insertInvoice(tx, invoice, actor.access.userId, clock.now);
      // The invoice and its journal entry commit together (CLAUDE.md rule 10; ADR 0039).
      // Stock before the ledger's shared locks, the order every path takes (PR #22 review).
      await lockStock(tx);
      await this.books.post(tx, invoicePosting(invoice), actor.access.userId);
      const [products, rolls, movements, held] = await Promise.all([
        loadProducts(tx),
        loadRolls(tx),
        loadMovements(tx),
        loadReservations(tx),
      ]);
      const drafts = planReservations(invoice, products, {
        rolls,
        movements,
        reservations: held.filter((reservation) => reservation.status === "active"),
      });
      if (drafts.length > 0) {
        await tx.insert(reservations).values(
          drafts.map((draft) => ({
            invoiceId: id,
            invoiceLineId: draft.lineId,
            productId: draft.productId,
            rollId: draft.rollId,
            locationId: draft.locationId,
            quantity: draft.quantity,
            shortBy: draft.shortBy,
            status: draft.status,
            createdBy: actor.access.userId,
          })),
        );
      }
      await tx
        .update(quotes)
        .set({
          status: "converted",
          sentAt: quote.sentAt ? undefined : new Date(),
          total: invoice.total,
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, quoteId));
      const short = drafts.filter((draft) => dec(draft.shortBy).gt(0)).length;
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Converted quote to invoice",
          targetType: "invoice",
          targetId: id,
          targetLabel: invoice.number,
          before: { quote: quote.number, status: quote.status },
          after: {
            quote: quote.number,
            total: invoice.total,
            tax: invoice.tax,
            taxRule: invoice.taxRule,
            dueAt: invoice.dueAt,
            reservations: drafts.length,
            short,
          },
        },
        tx,
      );
    });
    return (await loadInvoices(db, clock.zone, { ids: [id] }))[0]!;
  }

  /**
   * A quick invoice for a length of one roll (inventory rule 18): the roll's product at its price,
   * by the sq ft at the roll's cost, taxed like any invoice, posted, and the roll reserved for it.
   * The cut follows once the deposit or payment is in. Number and stock locks in the same order
   * as converting a quote.
   */
  async rollInvoice(
    tenant: TenantContext,
    actor: Actor,
    input: { rollId: string; customerId: string; lengthFt: string },
  ): Promise<Invoice> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const length = dec(input.lengthFt);
    if (length.lte(0)) throw refuse("Enter the length to cut, in ft.");
    const id = uuidv7();
    await db.transaction(async (tx) => {
      const [[customer], branches] = await Promise.all([loadCustomers(tx, [input.customerId]), loadBranches(tx)]);
      if (!customer || !seesCustomer(actor.access, customer, branches)) throw refuse("Choose a customer.");
      // Tax is priced from the job site; without one it would quietly be nothing (PR #22 review).
      const site = defaultAddress(customer, "job_site");
      if (!site || !/^[A-Z]{2}$/.test(site.state.trim()) || !/^\d{5}(-\d{4})?$/.test(site.zip.trim())) {
        throw refuse("Add the customer's job site address with its state and ZIP first, so tax can be priced.");
      }
      const branchId = actor.access.branchId ?? branches.get(customer.salesRepId) ?? null;
      if (!branchId) throw refuse("This invoice needs a branch: set yours, or the customer's sales rep's.");
      const localization = await loadLocalization(tx);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sales:invoice-number'))`);
      await lockStock(tx);
      const [[roll], products, held] = await Promise.all([
        loadRolls(tx, [input.rollId]),
        loadProducts(tx),
        loadReservations(tx),
      ]);
      if (!roll) throw refuse("This roll no longer exists.");
      if (roll.transferId) throw refuse(`Roll ${roll.rollNumber} is on a transfer; receive it first.`);
      const product = products.find((candidate) => candidate.id === roll.productId);
      if (!product) throw refuse("This roll's product no longer exists.");
      const free = rollAvailable(
        roll,
        held.filter((reservation) => reservation.status === "active"),
      );
      if (length.gt(free)) throw refuse(`Only ${free.toString()} ft of ${roll.rollNumber} is free.`);
      const used = await tx.select({ number: invoices.number }).from(invoices);
      const invoice = invoiceFromRoll(roll, product, customer, length.toString(), localization, {
        id,
        lineId: uuidv7(),
        number: nextNumber(
          localization.documents.invoicePrefix,
          used.map((row) => row.number),
          FIRST_INVOICE,
        ),
        issuedAt: clock.day,
        createdBy: actor.access.userId,
        branchId,
      });
      await this.insertInvoice(tx, invoice, actor.access.userId, clock.now);
      await this.books.post(tx, invoicePosting(invoice), actor.access.userId);
      await tx.insert(reservations).values({
        invoiceId: id,
        invoiceLineId: invoice.lines[0]!.id,
        productId: roll.productId,
        rollId: roll.id,
        locationId: roll.locationId,
        quantity: length.toString(),
        shortBy: "0",
        status: "active",
        createdBy: actor.access.userId,
      });
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Created invoice for a roll cut",
          targetType: "invoice",
          targetId: id,
          targetLabel: `${invoice.number} for roll ${roll.rollNumber}`,
          after: { lengthFt: length.toString(), total: invoice.total, reservations: 1 },
        },
        tx,
      );
    });
    return (await loadInvoices(db, clock.zone, { ids: [id] }))[0]!;
  }

  /**
   * Shares an invoice's commission between at most two people, 100% in all (sales rule 39). It
   * locks at the first confirmed payment, because commission is earned from then on. Audited.
   */
  async setCommissionSplit(
    tenant: TenantContext,
    actor: Actor,
    invoiceId: string,
    split: readonly { userId: string; pct: string }[],
  ): Promise<void> {
    if (split.length > 2) throw refuse("An invoice can be shared between two people at most.");
    if (new Set(split.map((share) => share.userId)).size !== split.length) throw refuse("Name each person once.");
    if (split.length > 0 && !sum(split.map((share) => share.pct)).eq(100))
      throw refuse("The shares must add up to 100%.");
    if (split.some((share) => dec(share.pct).lte(0))) throw refuse("Each share must be above 0%.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const found = await invoiceInScope(db, actor.access, invoiceId, clock.zone);
    await db.transaction(async (tx) => {
      await lockCustomer(tx, found.customerId);
      const { invoice, payments } = await invoiceState(tx, this.control.db, invoiceId, clock);
      if (invoice.voidedAt) throw refuse(`Invoice ${invoice.number} is void.`);
      if (invoice.isReturn) throw refuse("A credit note follows its invoice's split.");
      if (payments.some((payment) => payment.status === "confirmed")) {
        throw refuse("A confirmed payment has been recorded, so the split is locked.");
      }
      // Only active people of this company, and the rep keeps a share unless commissions are managed
      // here (sales rule 39; ADR 0025; PR #22 review), so nobody moves a commission to themselves.
      if (split.length > 0) {
        const people = await tx
          .select({ userId: userProfiles.userId })
          .from(userProfiles)
          .where(
            and(
              inArray(
                userProfiles.userId,
                split.map((share) => share.userId),
              ),
              eq(userProfiles.status, "active"),
              isNull(userProfiles.deletedAt),
            ),
          );
        if (people.length !== split.length) throw refuse("Choose active people of this company.");
      }
      // Commission is pay, so without commission rights only the invoice's own rep shares it: the
      // rep keeps at least half, and a split anyone else set is left alone (sales rule 39; CLAUDE.md
      // rule 4; PR #22 reviews; blueprint-delta).
      if (!actor.access.permissions.has("hr.commission.manage")) {
        if (actor.access.userId !== invoice.salesRepId) {
          throw refuse("Only the invoice's sales rep or someone who manages commissions may change its split.");
        }
        const rep = split.find((share) => share.userId === invoice.salesRepId);
        if (split.length > 0 && (!rep || dec(rep.pct).lt(50))) {
          throw refuse("The invoice's sales rep keeps at least half of the commission.");
        }
        const current = await tx
          .select({ createdBy: invoiceCommissionSplits.createdBy })
          .from(invoiceCommissionSplits)
          .where(and(eq(invoiceCommissionSplits.invoiceId, invoiceId), isNull(invoiceCommissionSplits.deletedAt)));
        if (current.some((share) => share.createdBy !== actor.access.userId)) {
          throw refuse("Someone who manages commissions set this split; ask them to change it.");
        }
      }
      const before = await tx
        .select({ userId: invoiceCommissionSplits.userId, pct: invoiceCommissionSplits.pct })
        .from(invoiceCommissionSplits)
        .where(and(eq(invoiceCommissionSplits.invoiceId, invoiceId), isNull(invoiceCommissionSplits.deletedAt)));
      await tx
        .update(invoiceCommissionSplits)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(invoiceCommissionSplits.invoiceId, invoiceId), isNull(invoiceCommissionSplits.deletedAt)));
      if (split.length > 0) {
        await tx
          .insert(invoiceCommissionSplits)
          .values(
            split.map((share) => ({ invoiceId, userId: share.userId, pct: share.pct, createdBy: actor.access.userId })),
          );
      }
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Changed commission split",
          targetType: "invoice",
          targetId: invoiceId,
          targetLabel: invoice.number,
          before: { split: before },
          after: { split },
        },
        tx,
      );
    });
  }

  /** Marks an invoice as sent (spec B2) and emails it to the customer (`invoice.sent`). */
  async markSent(tenant: TenantContext, actor: Actor, invoiceId: string): Promise<Invoice> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const found = await invoiceInScope(db, actor.access, invoiceId, clock.zone);
    await db.transaction(async (tx) => {
      await lockCustomer(tx, found.customerId);
      const [invoice] = await loadInvoices(tx, clock.zone, { ids: [invoiceId] });
      if (!invoice) throw notFound("invoice");
      if (invoice.voidedAt) throw refuse(`Invoice ${invoice.number} is void.`);
      if (invoice.sentAt) throw refuse(`Invoice ${invoice.number} was already sent.`);
      const now = new Date();
      await tx
        .update(invoices)
        .set({ sentAt: now, sentBy: actor.access.userId, updatedAt: now })
        .where(eq(invoices.id, invoiceId));
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Marked invoice sent",
          targetType: "invoice",
          targetId: invoiceId,
          targetLabel: invoice.number,
          after: { sentAt: now.toISOString() },
        },
        tx,
      );
    });
    const [sent] = await loadInvoices(db, clock.zone, { ids: [invoiceId] });
    await this.emailInvoice(tenant, actor, sent!);
    return sent!;
  }

  /**
   * Voids an invoice (spec rule 33): a reason, and only while no payment is confirmed. Pending
   * payments are voided with it and its active holds are released; stock already cut stays out. A
   * credit note whose credit was already used or refunded cannot be voided, or the customer's
   * credit would go below what was spent.
   */
  async voidInvoice(tenant: TenantContext, actor: Actor, invoiceId: string, reason: string): Promise<Invoice> {
    const why = reasonFor(reason, "the invoice is voided");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const found = await invoiceInScope(db, actor.access, invoiceId, clock.zone);
    await db.transaction(async (tx) => {
      await lockCustomer(tx, found.customerId);
      const { invoice, payments, ledger } = await invoiceState(tx, this.control.db, invoiceId, clock);
      if (invoice.voidedAt) throw refuse(`Invoice ${invoice.number} is already void.`);
      if (ledger.locked) {
        throw refuse(`Invoice ${invoice.number} has confirmed payments. Void them first, or issue a credit note.`);
      }
      // Applied credit and write-offs have no reversal, so voiding would lose them (spec "Edge cases").
      if (dec(ledger.credited).gt(0) || dec(ledger.writtenOff).gt(0)) {
        throw refuse(`Invoice ${invoice.number} has credit applied or a write-off, so it can't be voided.`);
      }
      // Its credit notes would stay customer credit for an invoice that no longer exists (PR #15 review).
      const [liveNote] = await tx
        .select({ number: invoices.number })
        .from(invoices)
        .where(and(eq(invoices.creditForInvoiceId, invoiceId), isNull(invoices.voidedAt), isNull(invoices.deletedAt)))
        .limit(1);
      if (liveNote) throw refuse(`Void credit note ${liveNote.number} first.`);
      // Goods that left posted their cost; they come back only through a return (ADR 0043).
      const [issued] = await tx
        .select({ id: reservations.id })
        .from(reservations)
        .where(
          and(eq(reservations.invoiceId, invoiceId), eq(reservations.status, "issued"), isNull(reservations.deletedAt)),
        )
        .limit(1);
      if (issued) throw refuse(`Stock was already cut or issued for invoice ${invoice.number}, so it can't be voided.`);
      // A note that settled its own invoice has no reversal for that settlement (ADR 0039).
      if (invoice.isReturn && invoice.creditForInvoiceId) {
        const [settlement] = await tx
          .select({ id: invoiceAdjustments.id })
          .from(invoiceAdjustments)
          .where(
            and(
              eq(invoiceAdjustments.invoiceId, invoice.creditForInvoiceId),
              eq(invoiceAdjustments.reason, `Credit note ${invoice.number}`),
              isNull(invoiceAdjustments.deletedAt),
            ),
          )
          .limit(1);
        if (settlement) throw refuse(`Credit note ${invoice.number} settled its invoice, so it can't be voided.`);
      }
      if (invoice.isReturn && (await creditNow(tx, this.control.db, invoice.customerId, clock)).lt(invoice.total)) {
        throw refuse(`Credit from ${invoice.number} was already applied or refunded, so it can't be voided.`);
      }
      const now = new Date();
      const pending = payments.filter((payment) => payment.status === "pending").map((payment) => payment.id);
      if (pending.length > 0) {
        await tx
          .update(paymentsReceived)
          .set({ status: "voided", voidedById: actor.access.userId, voidedAt: now, voidReason: why, updatedAt: now })
          .where(inArray(paymentsReceived.id, pending));
        for (const voided of payments.filter((payment) => payment.status === "pending")) {
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
      await tx
        .update(invoices)
        .set({ voidedAt: now, voidReason: why, updatedAt: now })
        .where(eq(invoices.id, invoiceId));
      const event = invoice.isReturn ? "credit_note.issued" : "invoice.issued";
      await lockStock(tx);
      await this.books.reverse(
        tx,
        { sourceType: "invoice", sourceId: invoiceId, event },
        clock.day,
        actor.access.userId,
      );
      const released = await tx
        .update(reservations)
        .set({ status: "released", closedAt: now, updatedAt: now })
        .where(
          and(eq(reservations.invoiceId, invoiceId), eq(reservations.status, "active"), isNull(reservations.deletedAt)),
        )
        .returning({ id: reservations.id });
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
          after: { reason: why, pendingPaymentsVoided: pending.length, reservationsReleased: released.length },
        },
        tx,
      );
    });
    return (await loadInvoices(db, clock.zone, { ids: [invoiceId] }))[0]!;
  }

  /**
   * Issues a credit note for part of an invoice (spec rule 38): an amount before tax up to what is
   * not yet credited, with tax and cost in proportion. It settles its own invoice's open balance
   * first, and only the rest becomes customer credit (ADR 0039).
   */
  async creditNote(
    tenant: TenantContext,
    actor: Actor,
    invoiceId: string,
    request: CreditNoteRequest,
  ): Promise<Invoice> {
    const why = reasonFor(request.reason, "the credit note is issued");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const found = await invoiceInScope(db, actor.access, invoiceId, clock.zone);
    const id = uuidv7();
    await db.transaction(async (tx) => {
      await lockCustomer(tx, found.customerId);
      const [invoice] = await loadInvoices(tx, clock.zone, { ids: [invoiceId] });
      if (!invoice || invoice.voidedAt || invoice.isReturn) throw refuse("A credit note needs a live invoice.");
      // A written-off balance was never paid; a note on it would turn the write-off into refundable
      // credit (PR #16 review). With no write-off, notes become credit only up to money received.
      const { ledger: current } = await invoiceState(tx, this.control.db, invoiceId, clock);
      if (dec(current.writtenOff).gt(0)) {
        throw refuse(`Invoice ${invoice.number} has a write-off, so it can't take a credit note.`);
      }
      const amount = dec(request.subtotal);
      const notes = await tx
        .select({ subtotal: invoices.subtotal, tax: invoices.tax })
        .from(invoices)
        .where(and(eq(invoices.creditForInvoiceId, invoiceId), isNull(invoices.voidedAt), isNull(invoices.deletedAt)));
      const already = sum(notes.map((note) => note.subtotal));
      if (amount.lte(0) || amount.plus(already).gt(invoice.subtotal) || dec(invoice.subtotal).lte(0)) {
        throw refuse("Enter an amount up to what is left on this invoice before tax.");
      }
      const share = (value: string) => roundMoney(dec(value).times(amount).dividedBy(invoice.subtotal));
      const taxLeft = dec(invoice.tax).minus(sum(notes.map((n) => n.tax)));
      const tax = amount.plus(already).eq(invoice.subtotal) ? taxLeft : minDec(share(invoice.tax), taxLeft);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sales:invoice-number'))`);
      const used = await tx.select({ number: invoices.number }).from(invoices).where(eq(invoices.isReturn, true));
      const note: Invoice = {
        ...invoice,
        id,
        number: nextNumber(
          CREDIT_PREFIX,
          used.map((row) => row.number),
          FIRST_CREDIT,
        ),
        quoteId: null,
        isReturn: true,
        creditForInvoiceId: invoice.id,
        issuedAt: clock.day,
        dueAt: clock.day,
        sentAt: clock.day,
        sentBy: actor.access.userId,
        createdBy: actor.access.userId,
        refundedAt: null,
        depositPct: "0",
        subtotal: moneyString(amount),
        tax: moneyString(tax),
        cost: moneyString(share(invoice.cost)),
        total: moneyString(amount.plus(tax)),
        lines: [],
      };
      await this.insertInvoice(tx, note, actor.access.userId, clock.now);
      await this.books.post(tx, creditNotePosting(note), actor.access.userId);
      // A note settles its own invoice's open balance first, so only money received can become
      // refundable credit (ADR 0039; PR #15 security review).
      const settled = await this.settleWithNote(tx, actor.access.userId, invoice, note, clock);
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Issued credit note",
          targetType: "invoice",
          targetId: id,
          targetLabel: note.number,
          after: {
            for: invoice.number,
            subtotal: note.subtotal,
            tax: note.tax,
            total: note.total,
            settledOnInvoice: settled,
            reason: why,
          },
        },
        tx,
      );
    });
    return (await loadInvoices(db, clock.zone, { ids: [id] }))[0]!;
  }

  /**
   * Writes off the whole balance (spec rule 34): a reason, and only up to the company's write-off
   * maximum. The invoice then reads Paid.
   */
  async writeOff(tenant: TenantContext, actor: Actor, invoiceId: string, reason: string): Promise<InvoiceAdjustment> {
    const why = reasonFor(reason, "the balance is written off");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const found = await invoiceInScope(db, actor.access, invoiceId, clock.zone);
    const [settings, money] = await Promise.all([loadPaymentSettings(db), loadMoneyFormat(db)]);
    return this.adjust(tenant, actor, found, clock, "Wrote off balance", ({ balance, pending }) => {
      if (balance.lte(0)) throw refuse(`Invoice ${found.number} has nothing left to write off.`);
      // A payment that waits could still settle it; writing off first would turn it into credit.
      if (pending.gt(0)) throw refuse(`Verify or reject the payment waiting on ${found.number} first.`);
      const max = settings.writeOffMax.trim();
      if (max && balance.gt(max)) {
        throw refuse(
          `Only balances up to ${money(max)} can be written off; this one is ${money(moneyString(balance))}.`,
        );
      }
      return { kind: "write_off", amount: moneyString(balance), reason: why };
    });
  }

  /** Applies the customer's credit to an invoice (spec rule 36): as much as the balance takes. */
  async applyCredit(tenant: TenantContext, actor: Actor, invoiceId: string): Promise<InvoiceAdjustment> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const found = await invoiceInScope(db, actor.access, invoiceId, clock.zone);
    return this.adjust(tenant, actor, found, clock, "Applied customer credit", ({ balance, credit }) => {
      if (credit.lte(0)) throw refuse("This customer has no credit to apply.");
      if (balance.lte(0)) throw refuse(`Invoice ${found.number} has nothing left to pay.`);
      return {
        kind: "credit_applied",
        amount: moneyString(minDec(credit, balance)),
        reason: "Customer credit applied",
      };
    });
  }

  /** Writes one adjustment decided from the balance and credit read under the customer's lock. */
  private async adjust(
    tenant: TenantContext,
    actor: Actor,
    found: Invoice,
    clock: CompanyClock,
    action: string,
    decide: (now: {
      balance: ReturnType<typeof dec>;
      credit: ReturnType<typeof dec>;
      pending: ReturnType<typeof dec>;
    }) => Pick<InvoiceAdjustment, "kind" | "amount" | "reason">,
  ): Promise<InvoiceAdjustment> {
    const db = await this.tenancy.db(tenant);
    const id = uuidv7();
    await db.transaction(async (tx) => {
      await lockCustomer(tx, found.customerId);
      const { invoice, ledger } = await invoiceState(tx, this.control.db, found.id, clock);
      if (ledger.state === "void" || ledger.state === "return") throw refuse(`Invoice ${invoice.number} owes nothing.`);
      const credit = await creditNow(tx, this.control.db, invoice.customerId, clock);
      const decided = decide({ balance: dec(ledger.balance), credit, pending: dec(ledger.pending) });
      const now = new Date();
      await tx.insert(invoiceAdjustments).values({
        id,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        ...decided,
        byUserId: actor.access.userId,
        at: now,
        createdBy: actor.access.userId,
      });
      await this.books.post(
        tx,
        adjustmentPosting(
          { id, invoiceId: invoice.id, customerId: invoice.customerId, ...decided, byName: "", at: "" },
          invoice.number,
          clock.day,
        ),
        actor.access.userId,
      );
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "payment",
          action,
          targetType: "invoice",
          targetId: invoice.id,
          targetLabel: invoice.number,
          before: { balance: ledger.balance },
          after: { amount: decided.amount, reason: decided.reason },
        },
        tx,
      );
    });
    return (await loadAdjustments(db, this.control.db, { ids: [id] }))[0]!;
  }

  /**
   * Applies a new credit note to its own invoice, up to the open balance, as credit applied with its
   * posting. Returns what it settled, "0.00" when the invoice was already paid.
   */
  private async settleWithNote(
    tx: CompanyDb,
    by: string,
    invoice: Invoice,
    note: Invoice,
    clock: CompanyClock,
  ): Promise<string> {
    const { ledger } = await invoiceState(tx, this.control.db, invoice.id, clock);
    const amount = minDec(dec(note.total), dec(ledger.balance));
    if (amount.lte(0)) return "0.00";
    const adjustment: InvoiceAdjustment = {
      id: uuidv7(),
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      kind: "credit_applied",
      amount: moneyString(amount),
      reason: `Credit note ${note.number}`,
      byName: "",
      at: "",
    };
    await tx.insert(invoiceAdjustments).values({
      id: adjustment.id,
      invoiceId: adjustment.invoiceId,
      customerId: adjustment.customerId,
      kind: adjustment.kind,
      amount: adjustment.amount,
      reason: adjustment.reason,
      byUserId: by,
      at: new Date(),
      createdBy: by,
    });
    await this.books.post(tx, adjustmentPosting(adjustment, invoice.number, clock.day), by);
    return adjustment.amount;
  }

  /**
   * Writes an invoice with its lines and commission split. `issuedAt` is the moment the company's
   * day was read, so the stored invoice reads back on the day its entry posts, even when the
   * conversion waited on a lock past midnight (PR #18 review).
   */
  private async insertInvoice(tx: CompanyDb, invoice: Invoice, by: string, issuedAt: Date): Promise<void> {
    await tx.insert(invoices).values({
      id: invoice.id,
      number: invoice.number,
      quoteId: invoice.quoteId,
      customerId: invoice.customerId,
      salesRepId: invoice.salesRepId,
      branchId: invoice.branchId,
      issuedAt,
      dueAt: invoice.dueAt,
      sentAt: invoice.sentAt ? issuedAt : null,
      sentBy: invoice.sentAt ? invoice.sentBy : null,
      depositPct: invoice.depositPct,
      isReturn: invoice.isReturn,
      creditForInvoiceId: invoice.creditForInvoiceId,
      locationId: invoice.locationId,
      soldAtLocationId: invoice.soldAtLocationId ?? null,
      jobSite: invoice.jobSite,
      taxRule: invoice.taxRule,
      taxSource: invoice.taxSource,
      taxOverride: invoice.taxOverride,
      taxExempt: invoice.taxExempt,
      subtotal: invoice.subtotal,
      tax: invoice.tax,
      total: invoice.total,
      cost: invoice.cost,
      createdBy: by,
    });
    if (invoice.lines.length > 0) {
      await tx.insert(invoiceLines).values(
        invoice.lines.map((line, position) => ({
          id: line.id,
          invoiceId: invoice.id,
          position,
          productId: line.productId ?? null,
          description: line.description,
          category: line.category,
          unit: line.unit,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitCost: line.unitCost,
          wastePct: line.wastePct ?? null,
          rollId: line.rollId ?? null,
          sqFtPerCarton: line.sqFtPerCarton ?? null,
          locationId: line.locationId ?? null,
          createdBy: by,
        })),
      );
    }
    if (invoice.commissionSplit?.length) {
      await tx.insert(invoiceCommissionSplits).values(
        invoice.commissionSplit.map((share) => ({
          invoiceId: invoice.id,
          userId: share.userId,
          pct: share.pct,
          createdBy: by,
        })),
      );
    }
  }

  /** Ids of the invoices the person's data scope covers. */
  private async visibleInvoiceIds(db: CompanyDb, access: RequestAccess): Promise<Set<string>> {
    const rows = await db
      .select({ id: invoices.id, salesRepId: invoices.salesRepId, branchId: invoices.branchId })
      .from(invoices)
      .where(isNull(invoices.deletedAt));
    return new Set(rows.filter((row) => seesDocument(access, row)).map((row) => row.id));
  }

  /** Emails the invoice to the customer (`invoice.sent`); a failure is logged and never undoes the send. */
  private async emailInvoice(tenant: TenantContext, actor: Actor, invoice: Invoice): Promise<void> {
    try {
      const db = await this.tenancy.db(tenant);
      const [[customer], money] = await Promise.all([loadCustomers(db, [invoice.customerId]), loadMoneyFormat(db)]);
      if (!customer?.email) return;
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "invoice.sent",
        source: { type: "invoice", id: invoice.id },
        to: [{ kind: "customer", id: customer.id, name: customer.name, email: customer.email }],
        values: {
          "customer.name": customer.name,
          "invoice.number": invoice.number,
          "invoice.total": money(invoice.total),
          "invoice.due": invoice.dueAt ?? "",
        },
      });
    } catch {
      this.logger.warn("An invoice was marked sent, but its email could not be queued.");
    }
  }
}
