"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { balance, type Customer, type Invoice } from "@workspace/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { api } from "@/lib/api";
import { invoiceState, InvoiceStatePill, invoiceStateLabel, type InvoiceState } from "@/lib/document-status";
import { useFormatDate } from "@/lib/use-format-date";

const FILTERS: (InvoiceState | "all")[] = ["all", "open", "overdue", "partial", "paid", "return"];

/** Invoices with their state today; `?status=overdue` comes from "Needs attention". */
export function InvoicesTable({ invoices, customers }: { invoices: Invoice[]; customers: Customer[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const formatDate = useFormatDate();
  const today = api.today();
  const filter = (params.get("status") as InvoiceState | null) ?? "all";
  const rows = invoices.filter((i) => filter === "all" || invoiceState(i, today) === filter);
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
    {
      id: "state",
      header: "Status",
      value: (i) => invoiceStateLabel(invoiceState(i, today)),
      cell: (i) => <InvoiceStatePill state={invoiceState(i, today)} />,
    },
    { id: "total", header: "Total", kind: "money", value: (i) => i.total },
    { id: "balance", header: "Balance", kind: "money", value: (i) => (i.isReturn ? "0" : balance(i).toString()) },
  ];
  return (
    <DataTable
      id="sales-invoices"
      rows={rows}
      columns={columns}
      getRowId={(i) => i.id}
      onRowClick={(i) => router.push(`/sales/invoices/${i.id}`)}
      rowLabel={(i) => `Open invoice ${i.number}`}
      searchPlaceholder="Search invoices and customers"
      csvName="invoices"
      initialSort={{ id: "issued", desc: true }}
      empty={{ message: "No invoices match this filter." }}
      toolbar={
        <Select
          value={filter}
          onValueChange={(v) => router.replace(`/sales?view=invoices${v === "all" ? "" : `&status=${v}`}`)}
        >
          <SelectTrigger className="bg-surface h-9 w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f} value={f}>
                {f === "all" ? "All statuses" : invoiceStateLabel(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}
