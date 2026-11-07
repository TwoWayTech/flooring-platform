"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { NoAccess } from "@/components/no-access";
import { useCan } from "@/components/workspace/workspace-context";
import { useApiQuery } from "@/lib/api/use-api";
import { CustomersTable } from "@/features/customers/customers-table";
import { InvoicesTable } from "./invoices-table";
import { QuotesTable } from "./quotes-table";

/** Sales: quotes and invoices, limited to the viewer's data scope by the ApiClient. */
export function SalesPage() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const data = useApiQuery(async (client) => {
    const [quotes, invoices, customers, users, payments] = await Promise.all([
      client.list("quotes"),
      client.list("invoices"),
      client.list("customers"),
      client.list("users"),
      client.list("payments"),
    ]);
    return { quotes, invoices, customers, users, payments };
  }, []);
  const canQuotes = can("sales.quote.view");
  const canInvoices = can("sales.invoice.view");
  const canCustomers = can("customers.customer.view");
  if (!canQuotes && !canInvoices && !canCustomers) return <NoAccess />;
  const requested = params.get("view");
  const allowed = { quotes: canQuotes, invoices: canInvoices, customers: canCustomers };
  const view =
    (Object.keys(allowed) as (keyof typeof allowed)[]).find((v) => v === requested && allowed[v]) ??
    (Object.keys(allowed) as (keyof typeof allowed)[]).find((v) => allowed[v])!;

  return (
    <>
      <PageHeader
        title="Sales"
        actions={
          can("sales.quote.create") ? (
            <Button asChild>
              <Link href="/sales/quotes/new">
                <FilePlus2 />
                New quote
              </Link>
            </Button>
          ) : null
        }
      />
      <Tabs value={view} onValueChange={(v) => router.replace(`/sales?view=${v}`)}>
        <TabsList aria-label="Sales view">
          {canQuotes ? <TabsTrigger value="quotes">Quotes</TabsTrigger> : null}
          {canInvoices ? <TabsTrigger value="invoices">Invoices</TabsTrigger> : null}
          {canCustomers ? <TabsTrigger value="customers">Customers and receivables</TabsTrigger> : null}
        </TabsList>
      </Tabs>
      {data.status !== "ready" ? (
        <Skeleton className="h-96" aria-label="Loading sales" />
      ) : view === "customers" ? (
        <CustomersTable customers={data.data.customers} invoices={data.data.invoices} payments={data.data.payments} />
      ) : view === "invoices" ? (
        <InvoicesTable invoices={data.data.invoices} customers={data.data.customers} />
      ) : (
        <QuotesTable quotes={data.data.quotes} customers={data.data.customers} users={data.data.users} />
      )}
    </>
  );
}
