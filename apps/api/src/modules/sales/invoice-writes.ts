import type { CompanyDb } from "@workspace/db";
import { invoiceCommissionSplits, invoiceLines, invoices } from "@workspace/db/company";
import { nextNumber, type Invoice } from "@workspace/shared";
import { sql } from "drizzle-orm";

/** The first invoice number, as in the demo (`INV-1001`). */
export const FIRST_INVOICE = 1001;

/**
 * Takes the next invoice number with the company's prefix under the company-wide invoice-number
 * lock, held to the end of the transaction. Callers take it after the customer's lock and before
 * the stock lock and the ledger's, the order every invoice path keeps (PR #22 review).
 */
export async function takeInvoiceNumber(tx: CompanyDb, prefix: string): Promise<string> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sales:invoice-number'))`);
  const used = await tx.select({ number: invoices.number }).from(invoices);
  return nextNumber(
    prefix,
    used.map((row) => row.number),
    FIRST_INVOICE,
  );
}

/**
 * Writes an invoice with its lines and commission split, and the contract billing it belongs to
 * (contracts.md "Fields added to Invoice and Bill"). `issuedAt` is the moment the company's day
 * was read, so the stored invoice reads back on the day its entry posts, even when the write
 * waited on a lock past midnight (PR #18 review).
 */
export async function insertInvoice(tx: CompanyDb, invoice: Invoice, by: string, issuedAt: Date): Promise<void> {
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
    contractId: invoice.contractId ?? null,
    billingId: invoice.billingId ?? null,
    retainageWithheld: invoice.retainageWithheld ?? null,
    retainageReleased: invoice.retainageReleased ?? null,
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
