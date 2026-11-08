"use client";

import { useRouter } from "next/navigation";
import { balance, locationName, type Customer, type Invoice, type Location } from "@workspace/shared";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { api } from "@/lib/api";
import { invoiceState, InvoiceStatePill, invoiceStateLabel } from "@/lib/document-status";
import { useFormatDate } from "@/lib/use-format-date";

/** Invoices with their state today; "Needs attention" links here filtered to Overdue (spec A2). */
export function InvoicesTable({
  invoices,
  customers,
  locations,
}: {
  invoices: Invoice[];
  customers: Customer[];
  locations: Location[];
}) {
  const router = useRouter();
  const formatDate = useFormatDate();
  const today = api.today();
  const columns: ColumnSpec<Invoice>[] = [
    {
      id: "number",
      header: "Invoice",
      value: (i) => i.number,
      cell: (i) => <span className="font-medium">{i.number}</span>,
    },
    { id: "customer", header: "Customer", value: (i) => customers.find((c) => c.id === i.customerId)?.name ?? "" },
    { id: "issued", header: "Issued", value: (i) => i.issuedAt, cell: (i) => formatDate(i.issuedAt) },
    { id: "due", header: "Due", value: (i) => i.dueAt, cell: (i) => formatDate(i.dueAt) },
    { id: "warehouse", header: "Warehouse", value: (i) => locationName(locations, i.locationId) },
    {
      id: "state",
      header: "Status",
      value: (i) => invoiceStateLabel(invoiceState(i, today)),
      cell: (i) => <InvoiceStatePill state={invoiceState(i, today)} />,
    },
    { id: "total", header: "Total", kind: "money", value: (i) => i.total, total: true },
    {
      id: "balance",
      header: "Balance",
      kind: "money",
      value: (i) => (i.isReturn ? "0" : balance(i).toString()),
      total: true,
    },
  ];
  return (
    <DataTable
      id="sales-invoices"
      rows={invoices}
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
