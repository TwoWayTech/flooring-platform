import {
  customerCredit,
  ledgerIndex,
  moneyString,
  type Invoice,
  type InvoiceAdjustment,
  type InvoiceLedger,
  type Payment,
  type Refund,
} from "@workspace/shared";
import type { ApiClient } from "./api/contract";

/** Invoices with everything that settles them, and the ledger of each (spec Appendix A). */
export interface SalesLedger {
  invoices: Invoice[];
  payments: Payment[];
  adjustments: InvoiceAdjustment[];
  refunds: Refund[];
  ledgers: Map<string, InvoiceLedger>;
}

/**
 * Loads the viewer's invoices, payments, credits, write-offs and refunds through the ApiClient
 * and computes every invoice's ledger once. Every screen that shows a balance or a status reads
 * it from here, so lists, customers, the dashboard and notifications always agree.
 */
export async function loadSalesLedger(client: Pick<ApiClient, "list" | "today">): Promise<SalesLedger> {
  const [invoices, payments, adjustments, refunds] = await Promise.all([
    client.list("invoices"),
    client.list("payments"),
    client.list("invoiceAdjustments"),
    client.list("refunds"),
  ]);
  return {
    invoices,
    payments,
    adjustments,
    refunds,
    ledgers: ledgerIndex(invoices, { payments, adjustments }, client.today()),
  };
}

/** A customer's credit from the loaded ledger: overpayments and open credit notes, less what was used. */
export function creditOf(sales: SalesLedger, customerId: string): string {
  return moneyString(customerCredit(customerId, sales.invoices, sales.ledgers, sales.adjustments, sales.refunds));
}
