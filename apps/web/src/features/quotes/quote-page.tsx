"use client";

import { QueryFallback } from "@/components/query-fallback";
import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { defaultWarehouse } from "@workspace/shared";
import { loadSalesLedger } from "@/lib/sales-ledger";
import { newQuote, QuoteBuilder } from "./quote-builder";

/** Loads a quote (or starts a new one) with the catalog and customers, then opens the builder. */
export function QuotePage({ quoteId }: { quoteId: string | null }) {
  const can = useCan();
  const { user } = useWorkspace();
  const data = useApiQuery(
    async (client) => {
      const [sales, stock, settings] = await Promise.all([
        client.salesData(),
        client.inventoryData(),
        client.getSettings(),
      ]);
      const quote = quoteId ? sales.quotes.find((candidate) => candidate.id === quoteId) : undefined;
      const { customers, locations } = sales;
      const { products, rolls, reservations, stockMovements: movements } = stock;
      // A converted quote shows its invoice's status from the ledger (spec Appendix A "Quote").
      const invoiceLedger = quote?.invoiceId ? (await loadSalesLedger(client)).ledgers.get(quote.invoiceId) : undefined;
      return { quote, products, customers, settings, locations, invoiceLedger, rolls, reservations, movements };
    },
    [quoteId],
  );
  if (!can("sales.quote.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-[32rem]" label="Loading quote" />;
  const { quote, products, customers, settings, locations, invoiceLedger, rolls, reservations, movements } = data.data;
  if (quoteId && !quote)
    return <p className="text-muted-foreground">This quote does not exist or is outside what you can see.</p>;
  const showroom = locations.find((l) => l.kind === "showroom" && l.branchId === user.branchId);
  const initial =
    quote ?? newQuote(user, settings, api.today(), defaultWarehouse(locations, user)?.id ?? "", showroom?.id);
  return (
    <QuoteBuilder
      key={initial.id || "new"}
      initial={initial}
      products={products}
      customers={customers}
      settings={settings}
      locations={locations}
      invoiceLedger={invoiceLedger}
      rolls={rolls}
      reservations={reservations}
      movements={movements}
    />
  );
}
