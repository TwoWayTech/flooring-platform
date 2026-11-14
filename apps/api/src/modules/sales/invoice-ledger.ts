import type { CompanyDb, ControlDb } from "@workspace/db";
import {
  customerCredit,
  invoiceLedger,
  ledgerIndex,
  type Dec,
  type Invoice,
  type InvoiceAdjustment,
  type InvoiceLedger,
  type Payment,
} from "@workspace/shared";
import { sql } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { loadAdjustments, loadInvoices, loadPayments, loadRefunds } from "./invoice-records";
import { notFound, seesDocument, type CompanyClock } from "./sales-common";

/** An invoice with its payments and the ledger derived from them (ADR 0013: never stored). */
export interface InvoiceState {
  invoice: Invoice;
  payments: Payment[];
  adjustments: InvoiceAdjustment[];
  ledger: InvoiceLedger;
}

/**
 * Money on one customer's invoices changes one write at a time, under a transaction-level
 * advisory lock: a balance, a credit or a refund is read and written in the same turn, so two
 * payments cannot both pass the balance check and two refunds cannot both spend one credit.
 */
export async function lockCustomer(tx: CompanyDb, customerId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sales:customer:${customerId}`}))`);
}

/** An invoice the person's data scope covers, or 404 (spec "Data scope"). */
export async function invoiceInScope(
  db: CompanyDb,
  access: RequestAccess,
  invoiceId: string,
  zone: string,
): Promise<Invoice> {
  const [invoice] = await loadInvoices(db, zone, { ids: [invoiceId] });
  if (!invoice || !seesDocument(access, invoice)) throw notFound("invoice");
  return invoice;
}

/** An invoice's ledger now, from its confirmed payments, credits and write-offs (spec rule 23). */
export async function invoiceState(
  tx: CompanyDb,
  control: ControlDb,
  invoiceId: string,
  clock: CompanyClock,
): Promise<InvoiceState> {
  const [invoice] = await loadInvoices(tx, clock.zone, { ids: [invoiceId] });
  if (!invoice) throw notFound("invoice");
  const [payments, adjustments] = await Promise.all([
    loadPayments(tx, control, { invoiceIds: [invoiceId] }),
    loadAdjustments(tx, control, { invoiceIds: [invoiceId] }),
  ]);
  return { invoice, payments, adjustments, ledger: invoiceLedger(invoice, { payments, adjustments }, clock.day) };
}

/** A customer's credit now (spec rule 35): overpayments and open credit notes, less what was used or refunded. */
export async function creditNow(
  tx: CompanyDb,
  control: ControlDb,
  customerId: string,
  clock: CompanyClock,
): Promise<Dec> {
  const [invoices, payments, adjustments, refunds] = await Promise.all([
    loadInvoices(tx, clock.zone, { customerId }),
    loadPayments(tx, control, { customerId }),
    loadAdjustments(tx, control, { customerId }),
    loadRefunds(tx, control, { customerId }),
  ]);
  const ledgers = ledgerIndex(invoices, { payments, adjustments }, clock.day);
  return customerCredit(customerId, invoices, ledgers, adjustments, refunds);
}
