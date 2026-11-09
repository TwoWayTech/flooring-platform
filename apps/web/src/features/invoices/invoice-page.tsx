"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Banknote, Download, Printer } from "lucide-react";
import { dec, featureOn } from "@workspace/shared";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { QueryFallback } from "@/components/query-fallback";
import { NoAccess } from "@/components/no-access";
import { useCan } from "@/components/workspace/workspace-context";
import { useApiQuery } from "@/lib/api/use-api";
import { InvoiceStatusPills } from "@/lib/document-status";
import { loadSalesLedger } from "@/lib/sales-ledger";
import { buildInvoiceModel, type InvoiceModel } from "./invoice-model";
import { InvoiceDocument } from "./invoice-document";
import { saveBlob } from "./payments/file-viewer-dialog";
import { PaymentsSection } from "./payments/payments-section";
import { RecordPaymentSheet } from "./payments/record-payment-sheet";

/** Renders the PDF in the browser and saves it; @react-pdf/renderer loads only when asked. */
async function downloadPdf(model: InvoiceModel) {
  const [{ pdf }, { InvoicePdf }] = await Promise.all([import("@react-pdf/renderer"), import("./invoice-pdf")]);
  saveBlob(await pdf(<InvoicePdf model={model} />).toBlob(), `${model.number}.pdf`);
}

/**
 * An invoice as a document with Print and Download PDF (spec "Quote builder → invoice"), Record
 * payment while a balance is due, and its payments (spec Appendix A).
 */
export function InvoicePage({ invoiceId }: { invoiceId: string }) {
  const can = useCan();
  const [pending, setPending] = useState(false);
  const [recording, setRecording] = useState(false);
  const data = useApiQuery(
    async (client) => {
      const invoice = await client.get("invoices", invoiceId);
      if (!invoice) return null;
      const [customer, quote, sales, settings] = await Promise.all([
        client.get("customers", invoice.customerId),
        invoice.quoteId ? client.get("quotes", invoice.quoteId) : Promise.resolve(undefined),
        loadSalesLedger(client),
        client.getSettings(),
      ]);
      const payments = sales.payments.filter((p) => p.invoiceId === invoiceId);
      return { invoice, customer, quote, payments, sales, ledger: sales.ledgers.get(invoiceId)!, settings };
    },
    [invoiceId],
  );

  if (!can("sales.invoice.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-[40rem]" label="Loading invoice" />;
  if (!data.data || !data.data.customer) {
    return <p className="text-muted-foreground">This invoice does not exist or is outside what you can see.</p>;
  }
  const { invoice, customer, quote, payments, sales, ledger, settings } = data.data;
  const paymentsOn = featureOn("sales.payments");
  const canRecord =
    paymentsOn &&
    can("sales.payment.record") &&
    dec(ledger.balance).gt(0) &&
    ledger.state !== "void" &&
    ledger.state !== "return";
  const model = buildInvoiceModel(invoice, ledger, customer, quote, payments, settings);

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
        <InvoiceStatusPills ledger={ledger} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer />
            Print
          </Button>
          <Button variant={canRecord ? "outline" : "default"} onClick={() => void onDownload()} disabled={pending}>
            <Download />
            {pending ? "Preparing PDF" : "Download PDF"}
          </Button>
          {canRecord ? (
            <Button onClick={() => setRecording(true)}>
              <Banknote />
              Record payment
            </Button>
          ) : null}
        </div>
      </div>
      {paymentsOn && can("sales.payment.view") ? <PaymentsSection payments={payments} ledger={ledger} /> : null}
      {recording ? (
        <RecordPaymentSheet
          invoice={invoice}
          ledger={ledger}
          payments={sales.payments}
          adjustments={sales.adjustments}
          settings={settings.payments}
          onClose={() => setRecording(false)}
        />
      ) : null}
      <InvoiceDocument model={model} logoUrl={settings.branding.logoDataUrl} />
    </div>
  );
}
