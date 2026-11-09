"use client";

import { receivablesSummary, type Invoice, type InvoiceLedger } from "@workspace/shared";
import { DueSummary } from "@/components/due-summary";
import { api } from "@/lib/api";

/**
 * Receivables in two clear figures (spec B5): Current and Overdue from each invoice's due date,
 * plus what falls due in the next 7 days. The detailed aging lives in Reports.
 */
export function ReceivablesSummary({
  invoices,
  ledgers,
}: {
  invoices: readonly Invoice[];
  ledgers: ReadonlyMap<string, InvoiceLedger>;
}) {
  const summary = receivablesSummary(invoices, ledgers, api.today());
  return <DueSummary title="Receivables" basis="invoice" {...summary} />;
}
