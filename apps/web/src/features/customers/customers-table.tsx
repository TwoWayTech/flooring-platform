"use client";

import { useState } from "react";
import { CircleAlert, ShieldCheck } from "lucide-react";
import {
  daysBetween,
  openAmounts,
  PAYMENT_TERM_LABELS,
  SENSITIVE,
  sum,
  type Customer,
  type CustomerType,
  defaultAddress,
} from "@workspace/shared";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { AgingPanel } from "@/components/aging-panel";
import { CERTIFICATE_WARNING_DAYS } from "@/lib/attention";
import type { SalesLedger } from "@/lib/sales-ledger";
import { CustomerDrawer } from "./customer-drawer";
import { IncompleteBadge } from "./customer-picker";

const TYPES: Record<CustomerType, string> = { homeowner: "Homeowner", dealer: "Dealer", contractor: "Contractor" };

/**
 * Customers and receivables (spec Tier 2): homeowners, dealers and contractors with open and
 * overdue balances, certificates and the aging above. Credit limit needs view_sensitive.
 */
export function CustomersTable({ customers, sales }: { customers: Customer[]; sales: SalesLedger }) {
  const can = useCan();
  const [open, setOpen] = useState<Customer | null>(null);
  const today = api.today();
  const daysLeft = (c: Customer) => (c.certificate ? daysBetween(today, c.certificate.expiresAt) : null);
  const expiringSoon = (c: Customer) => {
    const d = daysLeft(c);
    return d !== null && d >= 0 && d <= CERTIFICATE_WARNING_DAYS;
  };
  const own = (c: Customer) => sales.invoices.filter((i) => i.customerId === c.id).map((i) => sales.ledgers.get(i.id)!);

  const columns: ColumnSpec<Customer>[] = [
    {
      id: "name",
      header: "Customer",
      value: (c) => c.name,
      cell: (c) => (
        <span className="flex flex-col">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{c.name}</span>
            <IncompleteBadge customer={c} />
          </span>
          <span className="text-muted-foreground text-xs">{c.contactName !== c.name ? c.contactName : c.email}</span>
        </span>
      ),
    },
    { id: "type", header: "Type", value: (c) => TYPES[c.type] },
    {
      id: "place",
      header: "Location",
      value: (c) => {
        const a = defaultAddress(c, "billing");
        return a ? `${a.city}, ${a.state}` : "";
      },
    },
    { id: "terms", header: "Terms", value: (c) => PAYMENT_TERM_LABELS[c.terms], hidden: true },
    ...(can(SENSITIVE.creditLimit)
      ? [{ id: "credit", header: "Credit limit", kind: "money" as const, value: (c: Customer) => c.creditLimit }]
      : []),
    {
      id: "open",
      header: "Open balance",
      kind: "money",
      value: (c) => sum(own(c).map((l) => l.balance)).toString(),
      total: true,
    },
    {
      id: "overdue",
      header: "Overdue",
      kind: "money",
      value: (c) =>
        sum(
          own(c)
            .filter((l) => l.overdue)
            .map((l) => l.balance),
        ).toString(),
    },
    {
      id: "certificate",
      header: "Certificate",
      filter: "select",
      value: (c) => (!c.certificate ? null : expiringSoon(c) ? "Expires soon" : "Valid"),
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
      <AgingPanel title="Receivables aging" docs={openAmounts(sales.invoices, sales.ledgers)} today={today} />
      <DataTable
        id="sales-customers"
        rows={customers}
        columns={columns}
        getRowId={(c) => c.id}
        onRowClick={setOpen}
        rowLabel={(c) => `Open ${c.name}`}
        searchPlaceholder="Search customers"
        csvName="customers"
        initialSort={{ id: "open", desc: true }}
        empty={{ message: "No customers yet." }}
      />
      <CustomerDrawer
        customer={open ? (customers.find((c) => c.id === open.id) ?? null) : null}
        sales={sales}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
