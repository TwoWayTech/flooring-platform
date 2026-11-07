"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { NoAccess } from "@/components/no-access";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { invoiceState, InvoiceStatePill } from "@/lib/document-status";
import { buildInvoiceModel, type InvoiceModel } from "./invoice-model";
import { InvoiceDocument } from "./invoice-document";

/** Renders the PDF in the browser and saves it; @react-pdf/renderer loads only when asked. */
async function downloadPdf(model: InvoiceModel) {
  const [{ pdf }, { InvoicePdf }] = await Promise.all([import("@react-pdf/renderer"), import("./invoice-pdf")]);
  const blob = await pdf(<InvoicePdf model={model} />).toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${model.number}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

/** An invoice as a document with Download PDF and Print (spec "Quote builder → invoice"). */
export function InvoicePage({ invoiceId }: { invoiceId: string }) {
  const can = useCan();
  const [pending, setPending] = useState(false);
  const data = useApiQuery(
    async (client) => {
      const invoice = await client.get("invoices", invoiceId);
      if (!invoice) return null;
      const [customer, quote, payments, settings] = await Promise.all([
        client.get("customers", invoice.customerId),
        invoice.quoteId ? client.get("quotes", invoice.quoteId) : Promise.resolve(undefined),
        client.list("payments"),
        client.getSettings(),
      ]);
      return { invoice, customer, quote, payments: payments.filter((p) => p.invoiceId === invoiceId), settings };
    },
    [invoiceId],
  );

  if (!can("sales.invoice.view")) return <NoAccess />;
  if (data.status !== "ready") return <Skeleton className="h-[40rem]" aria-label="Loading invoice" />;
  if (!data.data || !data.data.customer) {
    return <p className="text-muted-foreground">This invoice does not exist or is outside what you can see.</p>;
  }
  const { invoice, customer, quote, payments, settings } = data.data;
  const model = buildInvoiceModel(invoice, customer, quote, payments, settings);

  async function onDownload() {
    setPending(true);
    try {
      await downloadPdf(model);
      toast.success(`${model.number}.pdf downloaded`);
    } catch {
      toast.error("The PDF could not be created. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <Link
        href="/sales?view=invoices"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Invoices
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InvoiceStatePill state={invoiceState(invoice, api.today())} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer />
            Print
          </Button>
          <Button onClick={() => void onDownload()} disabled={pending}>
            <Download />
            {pending ? "Preparing PDF" : "Download PDF"}
          </Button>
        </div>
      </div>
      <InvoiceDocument model={model} logoUrl={settings.branding.logoDataUrl} />
    </div>
  );
}
