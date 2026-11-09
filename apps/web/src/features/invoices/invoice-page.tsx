"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ArrowLeft, Ban, Banknote, Download, FileDown, Printer } from "lucide-react";
import { toast } from "sonner";
import { dec, featureOn, type Payment } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { QueryFallback } from "@/components/query-fallback";
import { NoAccess } from "@/components/no-access";
import { ReasonDialog } from "@/components/reason-dialog";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useRecordPaymentRequest } from "@/lib/record-payment-request";
import { creditOf, loadSalesLedger } from "@/lib/sales-ledger";
import { InvoiceDocument } from "./invoice-document";
import { buildInvoiceModel, type InvoiceModel } from "./invoice-model";
import { InvoiceSummary } from "./invoice-summary";
import { InvoiceTimeline, timelineSteps } from "./invoice-timeline";
import { saveBlob } from "./payments/file-viewer-dialog";
import { PaymentsSection } from "./payments/payments-section";
import type { ReceiptModel } from "./payments/receipt-pdf";
import { RecordPaymentSheet } from "./payments/record-payment-sheet";
import { UpdateStatusMenu } from "./update-status-menu";

/** Renders the invoice PDF in the browser and saves it; @react-pdf/renderer loads only when asked. */
async function downloadPdf(model: InvoiceModel) {
  const [{ pdf }, { InvoicePdf }] = await Promise.all([import("@react-pdf/renderer"), import("./invoice-pdf")]);
  saveBlob(await pdf(<InvoicePdf model={model} />).toBlob(), `${model.number}.pdf`);
}

/** Renders one payment's receipt PDF (spec Appendix A "Download receipt"). */
async function downloadReceipt(model: ReceiptModel) {
  const [{ pdf }, { ReceiptPdf }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./payments/receipt-pdf"),
  ]);
  saveBlob(await pdf(<ReceiptPdf model={model} />).toBlob(), `${model.number}-receipt.pdf`);
}

/**
 * An invoice (spec "Quote builder → invoice", B2, Appendix A): the money summary and facts in
 * front, Update status with only the valid next actions, Record payment, the lifecycle timeline,
 * its payments with their corrections, and the document with Print and Download PDF.
 */
export function InvoicePage({ invoiceId }: { invoiceId: string }) {
  const can = useCan();
  const [pending, setPending] = useState(false);
  const [recording, setRecording] = useState<"payment" | "deposit" | null>(null);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  // The palette's Record payment opens the drawer; the page decides whether a payment is possible.
  useRecordPaymentRequest(useCallback(() => setRecording("payment"), []));
  const data = useApiQuery(
    async (client) => {
      const invoice = await client.get("invoices", invoiceId);
      if (!invoice) return null;
      const [customer, quote, sales, settings, locations, jobs, users] = await Promise.all([
        client.get("customers", invoice.customerId),
        invoice.quoteId ? client.get("quotes", invoice.quoteId) : Promise.resolve(undefined),
        loadSalesLedger(client),
        client.getSettings(),
        client.list("locations"),
        client.list("jobs"),
        client.list("users"),
      ]);
      const job = jobs.find((j) => j.invoiceId === invoiceId);
      return { invoice, customer, quote, sales, settings, locations, job, users };
    },
    [invoiceId],
  );

  if (!can("sales.invoice.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-[40rem]" label="Loading invoice" />;
  if (!data.data || !data.data.customer) {
    return <p className="text-muted-foreground">This invoice does not exist or is outside what you can see.</p>;
  }
  const { invoice, customer, quote, sales, settings, locations, job, users } = data.data;
  const ledger = sales.ledgers.get(invoiceId)!;
  const payments = sales.payments.filter((p) => p.invoiceId === invoiceId);
  const model = buildInvoiceModel(invoice, ledger, customer, quote, payments, settings);
  const paymentsOn = featureOn("sales.payments");
  const open = dec(ledger.balance).gt(0) && ledger.state !== "void" && ledger.state !== "return";
  const canRecord = paymentsOn && open && can("sales.payment.record");
  const installs = featureOn("installation.calendar") && can("installation.job.view");

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

  async function onReceipt(payment: Payment) {
    try {
      const { buildReceiptModel } = await import("./payments/receipt-pdf");
      await downloadReceipt(buildReceiptModel(payment, invoice, ledger, customer!, settings));
      toast.success(`${payment.number}-receipt.pdf downloaded`);
    } catch {
      toast.error("The receipt could not be created. Try again.");
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
      <div className="flex flex-wrap justify-end gap-2">
        {paymentsOn ? (
          <UpdateStatusMenu
            invoice={invoice}
            ledger={ledger}
            credit={creditOf(sales, invoice.customerId)}
            settings={settings.payments}
            onRecord={(asDeposit) => setRecording(asDeposit ? "deposit" : "payment")}
          />
        ) : null}
        <Button variant="outline" onClick={() => window.print()}>
          <Printer />
          Print
        </Button>
        <Button variant={canRecord ? "outline" : "default"} onClick={() => void onDownload()} disabled={pending}>
          <Download />
          {pending ? "Preparing PDF" : "Download PDF"}
        </Button>
        {canRecord ? (
          <Button onClick={() => setRecording("payment")}>
            <Banknote />
            Record payment
          </Button>
        ) : null}
      </div>
      <InvoiceSummary invoice={invoice} ledger={ledger} locations={locations} job={installs ? job : undefined} />
      <InvoiceTimeline steps={timelineSteps(invoice, ledger, payments, job, users, installs)} />
      {paymentsOn && can("sales.payment.view") ? (
        <PaymentsSection
          payments={payments}
          ledger={ledger}
          actions={{
            extra: (p) => (
              <>
                {p.status === "confirmed" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void onReceipt(p)}
                    aria-label={`Download receipt ${p.number}`}
                  >
                    <FileDown />
                    Receipt
                  </Button>
                ) : null}
                {(p.status === "confirmed" || p.status === "pending") && can("sales.payment.void") ? (
                  <Button variant="ghost" size="sm" onClick={() => setVoiding(p)} aria-label={`Void ${p.number}`}>
                    <Ban />
                    Void
                  </Button>
                ) : null}
              </>
            ),
          }}
        />
      ) : null}
      <InvoiceDocument model={model} logoUrl={settings.branding.logoDataUrl} />
      {recording && canRecord ? (
        <RecordPaymentSheet
          invoice={invoice}
          ledger={ledger}
          payments={sales.payments}
          adjustments={sales.adjustments}
          settings={settings.payments}
          asDeposit={recording === "deposit"}
          onClose={() => setRecording(null)}
        />
      ) : null}
      {voiding ? (
        <ReasonDialog
          title={`Void ${voiding.number}`}
          description="Use this for a bounced check or a mistake. The payment stays on the invoice, struck through, and the balance comes back. To correct an amount, void it and record it again."
          confirmLabel="Void payment"
          destructive
          onConfirm={(reason) =>
            api.voidPayment(voiding.id, reason).then(() => toast.success(`${voiding.number} voided`))
          }
          onClose={() => setVoiding(null)}
        />
      ) : null}
    </div>
  );
}
