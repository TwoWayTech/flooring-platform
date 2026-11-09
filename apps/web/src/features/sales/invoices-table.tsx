"use client";

import { useRouter } from "next/navigation";
import { invoiceStatusLabel, locationName, type Customer, type Invoice, type Location } from "@workspace/shared";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { InvoiceStatusPills } from "@/lib/document-status";
import type { SalesLedger } from "@/lib/sales-ledger";
import { HELD_LABEL } from "@/features/invoices/invoice-model";
import { useFormatDate } from "@/lib/use-format-date";

/**
 * Invoices with their status, paid, remaining and last payment from the ledger (spec Appendix A,
 * B4), each column filterable with totals for the filtered rows; "Needs attention" links here
 * filtered to Overdue or Pending verification (spec A2).
 */
export function InvoicesTable({
  sales,
  customers,
  locations,
}: {
  sales: SalesLedger;
  customers: Customer[];
  locations: Location[];
}) {
  const router = useRouter();
  const formatDate = useFormatDate();
  const ledger = (i: Invoice) => sales.ledgers.get(i.id)!;
  const columns: ColumnSpec<Invoice>[] = [
    {
      id: "number",
      header: "Invoice",
      value: (i) => i.number,
      cell: (i) => <span className="font-medium">{i.number}</span>,
    },
    { id: "customer", header: "Customer", value: (i) => customers.find((c) => c.id === i.customerId)?.name ?? "" },
    { id: "issued", header: "Issued", value: (i) => i.issuedAt, cell: (i) => formatDate(i.issuedAt) },
    {
      id: "due",
      header: "Due",
      value: (i) => i.dueAt,
      cell: (i) => (i.dueAt ? formatDate(i.dueAt) : <span className="text-muted-foreground">{HELD_LABEL}</span>),
    },
    {
      id: "state",
      header: "Status",
      value: (i) => invoiceStatusLabel(ledger(i)),
      cell: (i) => <InvoiceStatusPills ledger={ledger(i)} />,
    },
    { id: "total", header: "Total", kind: "money", value: (i) => i.total, total: true },
    { id: "paid", header: "Paid", kind: "money", value: (i) => ledger(i).paid, total: true },
    { id: "balance", header: "Remaining", kind: "money", value: (i) => ledger(i).balance, total: true },
    {
      id: "lastPayment",
      header: "Last payment",
      value: (i) => ledger(i).lastPaymentAt,
      cell: (i) => {
        const at = ledger(i).lastPaymentAt;
        return at ? formatDate(at) : <span className="text-muted-foreground">None</span>;
      },
    },
    { id: "warehouse", header: "Warehouse", value: (i) => locationName(locations, i.locationId) },
  ];
  return (
    <DataTable
      id="sales-invoices"
      rows={sales.invoices}
      columns={columns}
      getRowId={(i) => i.id}
      onRowClick={(i) => router.push(`/sales/invoices/${i.id}`)}
      rowLabel={(i) => `Open invoice ${i.number}`}
      searchPlaceholder="Search invoices and customers"
      csvName="invoices"
      initialSort={{ id: "issued", desc: true }}
      empty={{ message: "No invoices yet. Convert a quote to create one." }}
    />
  );
}
