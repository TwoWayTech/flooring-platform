"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, ShieldCheck } from "lucide-react";
import {
  balance,
  daysBetween,
  isOverdue,
  PAYMENT_TERM_LABELS,
  SENSITIVE,
  sum,
  type Customer,
  type CustomerType,
  type Invoice,
  type Payment,
} from "@workspace/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { CERTIFICATE_WARNING_DAYS } from "@/lib/attention";
import { CustomerDrawer } from "./customer-drawer";
import { ReceivablesPanel } from "./receivables-panel";

const TYPES: Record<CustomerType, string> = { homeowner: "Homeowner", dealer: "Dealer", contractor: "Contractor" };
type Filter = CustomerType | "all" | "certificates";

/**
 * Customers and receivables (spec Tier 2): homeowners, dealers and contractors with open and
 * overdue balances, certificates and the aging above. Credit limit needs view_sensitive.
 */
export function CustomersTable({
  customers,
  invoices,
  payments,
}: {
  customers: Customer[];
  invoices: Invoice[];
  payments: Payment[];
}) {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState<Customer | null>(null);
  const today = api.today();
  const filter = (params.get("filter") as Filter | null) ?? "all";
  const daysLeft = (c: Customer) => (c.certificate ? daysBetween(today, c.certificate.expiresAt) : null);
  const expiringSoon = (c: Customer) => {
    const d = daysLeft(c);
    return d !== null && d >= 0 && d <= CERTIFICATE_WARNING_DAYS;
  };
  const rows = customers.filter((c) =>
    filter === "all" ? true : filter === "certificates" ? expiringSoon(c) : c.type === filter,
  );
  const own = (c: Customer) => invoices.filter((i) => i.customerId === c.id && !i.isReturn && i.status !== "void");

  const columns: ColumnSpec<Customer>[] = [
    {
      id: "name",
      header: "Customer",
      value: (c) => c.name,
      cell: (c) => (
        <span className="flex flex-col">
          <span className="font-medium">{c.name}</span>
          <span className="text-muted-foreground text-xs">{c.contactName !== c.name ? c.contactName : c.email}</span>
        </span>
      ),
    },
    { id: "type", header: "Type", value: (c) => TYPES[c.type] },
    { id: "place", header: "Location", value: (c) => `${c.address.city}, ${c.address.state}` },
    { id: "terms", header: "Terms", value: (c) => PAYMENT_TERM_LABELS[c.terms], hidden: true },
    ...(can(SENSITIVE.creditLimit)
      ? [{ id: "credit", header: "Credit limit", kind: "money" as const, value: (c: Customer) => c.creditLimit }]
      : []),
    { id: "open", header: "Open balance", kind: "money", value: (c) => sum(own(c).map(balance)).toString() },
    {
      id: "overdue",
      header: "Overdue",
      kind: "money",
      value: (c) =>
        sum(
          own(c)
            .filter((i) => isOverdue(i, today))
            .map(balance),
        ).toString(),
    },
    {
      id: "certificate",
      header: "Certificate",
      value: (c) => c.certificate?.expiresAt ?? null,
      cell: (c) =>
        !c.certificate ? null : expiringSoon(c) ? (
          <StatusPill tone="warning" icon={CircleAlert} label={`Expires in ${daysLeft(c)} days`} />
        ) : (
          <StatusPill tone="success" icon={ShieldCheck} label="Valid" />
        ),
    },
  ];

  return (
    <>
      <ReceivablesPanel invoices={invoices} today={today} />
      <DataTable
        id="sales-customers"
        rows={rows}
        columns={columns}
        getRowId={(c) => c.id}
        onRowClick={setOpen}
        rowLabel={(c) => `Open ${c.name}`}
        searchPlaceholder="Search customers"
        csvName="customers"
        initialSort={{ id: "open", desc: true }}
        empty={{
          message:
            filter === "certificates" ? "No certificates expire in the next 30 days." : "No customers in this group.",
        }}
        toolbar={
          <Select
            value={filter}
            onValueChange={(v) => router.replace(`/sales?view=customers${v === "all" ? "" : `&filter=${v}`}`)}
          >
            <SelectTrigger className="bg-surface h-9 w-52" aria-label="Show">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All customers</SelectItem>
              {(Object.keys(TYPES) as CustomerType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPES[t]}s
                </SelectItem>
              ))}
              <SelectItem value="certificates">Certificates expiring</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <CustomerDrawer customer={open} invoices={invoices} payments={payments} onClose={() => setOpen(null)} />
    </>
  );
}
