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
      const [quote, products, customers, settings, locations, rolls, reservations] = await Promise.all([
        quoteId ? client.get("quotes", quoteId) : Promise.resolve(undefined),
        client.list("products"),
        client.list("customers"),
        client.getSettings(),
        client.list("locations"),
        client.list("rolls"),
        client.list("reservations"),
      ]);
      // A converted quote shows its invoice's status from the ledger (spec Appendix A "Quote").
      const invoiceLedger = quote?.invoiceId ? (await loadSalesLedger(client)).ledgers.get(quote.invoiceId) : undefined;
      return { quote, products, customers, settings, locations, invoiceLedger, rolls, reservations };
    },
    [quoteId],
  );
  if (!can("sales.quote.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-[32rem]" label="Loading quote" />;
  const { quote, products, customers, settings, locations, invoiceLedger, rolls, reservations } = data.data;
  if (quoteId && !quote)
    return <p className="text-muted-foreground">This quote does not exist or is outside what you can see.</p>;
  const initial = quote ?? newQuote(user, settings, api.today(), defaultWarehouse(locations, user)?.id ?? "");
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
    />
  );
}
