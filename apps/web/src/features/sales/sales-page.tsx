"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { QueryFallback } from "@/components/query-fallback";
import { NoAccess } from "@/components/no-access";
import { useCan } from "@/components/workspace/workspace-context";
import { useApiQuery } from "@/lib/api/use-api";
import { loadSalesLedger } from "@/lib/sales-ledger";
import { CustomersTable } from "@/features/customers/customers-table";
import { InvoicesTable } from "./invoices-table";
import { QuotesTable } from "./quotes-table";
import { featureOn } from "@workspace/shared";

/** Sales: quotes and invoices, limited to the viewer's data scope by the ApiClient. */
export function SalesPage() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const data = useApiQuery(async (client) => {
    const [quotes, sales, customers, users, locations] = await Promise.all([
      client.list("quotes"),
      loadSalesLedger(client),
      client.list("customers"),
      client.list("users"),
      client.list("locations"),
    ]);
    return { quotes, sales, customers, users, locations };
  }, []);
  const canQuotes = can("sales.quote.view") && featureOn("sales.quotes");
  const canInvoices = can("sales.invoice.view") && featureOn("sales.invoices");
  const canCustomers = can("customers.customer.view") && featureOn("sales.customers");
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
          canQuotes && can("sales.quote.create") ? (
            <Button asChild>
              <Link href="/sales/quotes/new">
                <FilePlus2 />
                New quote
              </Link>
            </Button>
          ) : null
        }
      />
      <Tabs value={view} className="gap-6" onValueChange={(v) => router.replace(`/sales?view=${v}`)}>
        <TabsList aria-label="Sales view">
          {canQuotes ? <TabsTrigger value="quotes">Quotes</TabsTrigger> : null}
          {canInvoices ? <TabsTrigger value="invoices">Invoices</TabsTrigger> : null}
          {canCustomers ? <TabsTrigger value="customers">Customers and receivables</TabsTrigger> : null}
        </TabsList>
        <TabsContent value={view} className="flex flex-col gap-6">
          {data.status !== "ready" ? (
            <QueryFallback query={data} className="h-96" label="Loading sales" />
          ) : view === "customers" ? (
            <CustomersTable
              customers={data.data.customers}
              sales={data.data.sales}
              users={data.data.users}
              locations={data.data.locations}
            />
          ) : view === "invoices" ? (
            <InvoicesTable sales={data.data.sales} customers={data.data.customers} locations={data.data.locations} />
          ) : (
            <QuotesTable
              quotes={data.data.quotes}
              customers={data.data.customers}
              users={data.data.users}
              locations={data.data.locations}
            />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
