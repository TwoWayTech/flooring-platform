"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import {
  locationName,
  quoteAgeDays,
  quoteState,
  quoteStateLabel,
  type Customer,
  type Location,
  type Quote,
  type User,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { QuoteStatusPill } from "@/lib/document-status";
import { useFormatDate } from "@/lib/use-format-date";

interface QuotesTableProps {
  quotes: Quote[];
  customers: Customer[];
  users: User[];
  locations: Location[];
}

/**
 * Quotes, newest first; a row opens the quote builder. Status reads Expired for a pending quote
 * past its expiry date, and Age counts days since it was made (spec B1).
 */
export function QuotesTable({ quotes, customers, users, locations }: QuotesTableProps) {
  const router = useRouter();
  const can = useCan();
  const formatDate = useFormatDate();
  const today = api.today();
  const customer = (q: Quote) => customers.find((c) => c.id === q.customerId);
  const columns: ColumnSpec<Quote>[] = [
    {
      id: "number",
      header: "Quote",
      value: (q) => q.number,
      cell: (q) => <span className="font-medium">{q.number}</span>,
    },
    { id: "customer", header: "Customer", value: (q) => customer(q)?.name ?? "" },
    { id: "created", header: "Created", value: (q) => q.createdAt, cell: (q) => formatDate(q.createdAt) },
    { id: "site", header: "Job site", value: (q) => `${q.jobSite.city}, ${q.jobSite.state}` },
    { id: "warehouse", header: "Warehouse", value: (q) => locationName(locations, q.locationId) },
    {
      id: "status",
      header: "Status",
      value: (q) => quoteStateLabel(quoteState(q, today)),
      cell: (q) => <QuoteStatusPill state={quoteState(q, today)} />,
    },
    { id: "rep", header: "Salesperson", value: (q) => users.find((u) => u.id === q.salesRepId)?.name ?? "" },
    {
      id: "expires",
      header: "Expires",
      value: (q) => q.expiresAt,
      cell: (q) => (q.expiresAt ? formatDate(q.expiresAt) : <span className="text-muted-foreground">None</span>),
    },
    { id: "age", header: "Age", kind: "count", unit: "days", value: (q) => quoteAgeDays(q, today) },
    { id: "total", header: "Total", kind: "money", value: (q) => q.total, total: true },
  ];
  return (
    <DataTable
      id="sales-quotes"
      rows={quotes}
      columns={columns}
      getRowId={(q) => q.id}
      onRowClick={(q) => router.push(`/sales/quotes/${q.id}`)}
      rowLabel={(q) => `Open quote ${q.number}`}
      searchPlaceholder="Search quotes and customers"
      csvName="quotes"
      initialSort={{ id: "created", desc: true }}
      empty={{
        message: "No quotes yet.",
        action: can("sales.quote.create") ? (
          <Button asChild>
            <Link href="/sales/quotes/new">
              <FilePlus2 />
              New quote
            </Link>
          </Button>
        ) : undefined,
      }}
    />
  );
}
