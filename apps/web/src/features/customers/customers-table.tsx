"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { CircleAlert, ShieldCheck } from "lucide-react";
import {
  customerReceivable,
  daysBetween,
  locationName,
  overCreditLimit,
  PAYMENT_TERM_LABELS,
  SENSITIVE,
  type Customer,
  type CustomerType,
  type Location,
  type User,
  defaultAddress,
} from "@workspace/shared";
import { Label } from "@workspace/ui/components/label";
import { Num } from "@workspace/ui/components/num";
import { Switch } from "@workspace/ui/components/switch";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { CERTIFICATE_WARNING_DAYS } from "@/lib/attention";
import type { SalesLedger } from "@/lib/sales-ledger";
import { useFormatDate } from "@/lib/use-format-date";
import { CustomerDrawer } from "./customer-drawer";
import { IncompleteBadge } from "./customer-picker";
import { ReceivablesSummary } from "./receivables-summary";

const TYPES: Record<CustomerType, string> = { homeowner: "Homeowner", dealer: "Dealer", contractor: "Contractor" };

/**
 * Customers and receivables (spec Tier 2, B5): Current, Overdue and Due in the next 7 days above a
 * simple list of who owes what: open balance, overdue amount, oldest days overdue, next due date and
 * last payment, filterable by type, warehouse, salesperson, or overdue only. Credit limit needs
 * view_sensitive, and so do the "Over credit limit" badge and filter (click-through #18). The
 * detailed aging is in Reports.
 */
export function CustomersTable({
  customers,
  sales,
  users,
  locations,
}: {
  customers: Customer[];
  sales: SalesLedger;
  users: User[];
  locations: Location[];
}) {
  const can = useCan();
  const params = useSearchParams();
  const linked = customers.find((c) => c.id === params.get("customer")) ?? null;
  const [open, setOpen] = useState<Customer | null>(linked);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [overLimitOnly, setOverLimitOnly] = useState(false);
  const formatDate = useFormatDate();
  const today = api.today();
  const daysLeft = (c: Customer) => (c.certificate ? daysBetween(today, c.certificate.expiresAt) : null);
  const expiringSoon = (c: Customer) => {
    const d = daysLeft(c);
    return d !== null && d >= 0 && d <= CERTIFICATE_WARNING_DAYS;
  };
  const owed = new Map(customers.map((c) => [c.id, customerReceivable(c.id, sales.invoices, sales.ledgers)]));
  const owes = (c: Customer) => owed.get(c.id)!;
  // A customer's warehouse is where their latest invoice ships from.
  const latest = (c: Customer) =>
    sales.invoices.filter((i) => i.customerId === c.id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
  const date = (iso: string | null) => (iso ? formatDate(iso) : <span className="text-muted-foreground">None</span>);
  // The credit limit is sensitive (CLAUDE.md rule 5): only people who see it see the warning.
  const seesLimit = can(SENSITIVE.creditLimit);
  const overLimit = (c: Customer) => seesLimit && overCreditLimit(owes(c).open, c.creditLimit);
  const overLimitCount = customers.filter(overLimit).length;
  const rows = customers.filter(
    (c) => (!overdueOnly || owes(c).overdue !== "0.00") && (!overLimitOnly || overLimit(c)),
  );

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
            {overLimit(c) ? <StatusPill tone="danger" icon={CircleAlert} label="Over credit limit" /> : null}
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
    ...(seesLimit
      ? [{ id: "credit", header: "Credit limit", kind: "money" as const, value: (c: Customer) => c.creditLimit }]
      : []),
    { id: "open", header: "Open balance", kind: "money", value: (c) => owes(c).open, total: true },
    { id: "overdue", header: "Overdue", kind: "money", value: (c) => owes(c).overdue, total: true },
    { id: "daysOverdue", header: "Days overdue", kind: "count", value: (c) => owes(c).oldestDaysOverdue },
    { id: "nextDue", header: "Next due", value: (c) => owes(c).nextDueAt, cell: (c) => date(owes(c).nextDueAt) },
    {
      id: "lastPayment",
      header: "Last payment",
      value: (c) => owes(c).lastPaymentAt,
      cell: (c) => date(owes(c).lastPaymentAt),
    },
    { id: "warehouse", header: "Warehouse", value: (c) => locationName(locations, latest(c)?.locationId) || null },
    {
      id: "rep",
      header: "Salesperson",
      value: (c) => users.find((u) => u.id === c.salesRepId)?.name ?? null,
      hidden: true,
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
      <ReceivablesSummary invoices={sales.invoices} ledgers={sales.ledgers} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Switch id="customers-overdue-only" checked={overdueOnly} onCheckedChange={setOverdueOnly} />
          <Label htmlFor="customers-overdue-only">Overdue only</Label>
        </div>
        {seesLimit ? (
          <div className="flex items-center gap-2">
            <Switch id="customers-over-limit-only" checked={overLimitOnly} onCheckedChange={setOverLimitOnly} />
            <Label htmlFor="customers-over-limit-only">
              Over credit limit only (<Num kind="count" value={String(overLimitCount)} />)
            </Label>
          </div>
        ) : null}
      </div>
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
