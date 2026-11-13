"use client";

import { useState } from "react";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { featureOn, PAYMENT_METHOD_LABELS, type FileMeta, type PaymentMethod } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { QueryFallback } from "@/components/query-fallback";
import { ReasonDialog } from "@/components/reason-dialog";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { FileViewerDialog } from "@/features/invoices/payments/file-viewer-dialog";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";

/** One payment waiting for a second person, customer or supplier (audit U-15). */
interface QueueRow {
  id: string;
  kind: "customer" | "supplier";
  number: string;
  party: string;
  document: string;
  href: string;
  amount: string;
  date: string;
  method: PaymentMethod;
  reference: string;
  recordedBy: string;
  recordedById: string;
  files: FileMeta[];
}

/**
 * Payments to verify (audit U-04, U-15): every customer and supplier payment waiting for a second
 * person in one list, with the proof one click away and Confirm or Reject in place. Nobody can
 * confirm a payment they recorded themselves.
 */
export function PaymentsQueue() {
  const can = useCan();
  const { user } = useWorkspace();
  const formatDate = useFormatDate();
  const [viewing, setViewing] = useState<FileMeta | null>(null);
  const [rejecting, setRejecting] = useState<QueueRow | null>(null);
  const data = useApiQuery(async (client): Promise<QueueRow[]> => {
    // Customers come through salesData, so their ids match the payments' with the real API (ADR 0038).
    const [payments, invoices, { customers }, supplierPayments, suppliers, bills] = await Promise.all([
      client.list("payments"),
      client.list("invoices"),
      client.salesData(),
      client.list("supplierPayments"),
      client.list("suppliers"),
      client.list("bills"),
    ]);
    const incoming: QueueRow[] = can("sales.payment.approve")
      ? payments
          .filter((p) => p.status === "pending")
          .map((p) => ({
            id: p.id,
            kind: "customer",
            number: p.number,
            party: customers.find((c) => c.id === p.customerId)?.name ?? "",
            document: invoices.find((i) => i.id === p.invoiceId)?.number ?? "",
            href: `/sales/invoices/${p.invoiceId}`,
            amount: p.amount,
            date: p.date,
            method: p.method,
            reference: p.reference,
            recordedBy: p.recordedBy,
            recordedById: p.recordedById,
            files: p.files,
          }))
      : [];
    const outgoing: QueueRow[] = can("purchasing.payment.approve")
      ? supplierPayments
          .filter((p) => p.status === "pending")
          .map((p) => ({
            id: p.id,
            kind: "supplier",
            number: p.number,
            party: suppliers.find((s) => s.id === p.supplierId)?.name ?? "",
            document: p.allocations.map((a) => bills.find((b) => b.id === a.billId)?.number ?? "").join(", "),
            href: "/purchasing?view=bills",
            amount: p.amount,
            date: p.date,
            method: p.method,
            reference: p.reference,
            recordedBy: p.recordedBy,
            recordedById: p.recordedById,
            files: p.files,
          }))
      : [];
    return [...incoming, ...outgoing];
  }, []);

  function confirm(row: QueueRow) {
    const work =
      row.kind === "customer"
        ? api.reviewPayment(row.id, { action: "confirm" })
        : api.reviewSupplierPayment(row.id, { action: "confirm" });
    void work
      .then(() => toast.success(`${row.number} confirmed`))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Not saved."));
  }

  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading payments" />;
  const columns: ColumnSpec<QueueRow>[] = [
    { id: "number", header: "Payment", value: (r) => r.number },
    { id: "kind", header: "Type", filter: "select", value: (r) => (r.kind === "customer" ? "Customer" : "Supplier") },
    { id: "party", header: "From or to", value: (r) => r.party },
    {
      id: "document",
      header: "On",
      value: (r) => r.document,
      cell: (r) => (
        <Link href={r.href} className="text-brand-ink underline-offset-4 hover:underline">
          {r.document}
        </Link>
      ),
    },
    { id: "date", header: "Date", value: (r) => r.date, cell: (r) => formatDate(r.date) },
    { id: "method", header: "Method", value: (r) => PAYMENT_METHOD_LABELS[r.method] },
    { id: "reference", header: "Reference", value: (r) => r.reference },
    { id: "amount", header: "Amount", kind: "money", value: (r) => r.amount, total: true },
    { id: "by", header: "Recorded by", value: (r) => r.recordedBy },
    {
      id: "proof",
      header: "Proof",
      visualOnly: true,
      value: () => null,
      cell: (r) => (
        <span className="flex flex-col items-start">
          {r.files.map((f) => (
            <Button key={f.id} variant="ghost" size="sm" onClick={() => setViewing(f)}>
              <Paperclip />
              {f.name}
            </Button>
          ))}
        </span>
      ),
    },
    {
      id: "decide",
      header: "Decide",
      visualOnly: true,
      value: () => null,
      cell: (r) =>
        r.recordedById === user.id ? (
          <span className="text-muted-foreground text-xs">Someone else verifies it</span>
        ) : (
          <span className="flex gap-1.5">
            <Button size="sm" aria-label={`Confirm ${r.number}`} onClick={() => confirm(r)}>
              Confirm
            </Button>
            <Button size="sm" variant="outline" aria-label={`Reject ${r.number}`} onClick={() => setRejecting(r)}>
              Reject
            </Button>
          </span>
        ),
    },
  ];
  return (
    <>
      <p className="text-muted-foreground text-sm">
        <Num kind="count" value={data.data.filter((r) => r.recordedById !== user.id).length} /> waiting for you to
        check.
      </p>
      <DataTable
        id="finance-payments"
        rows={data.data}
        columns={columns}
        getRowId={(r) => r.id}
        searchPlaceholder="Search payments"
        empty={{ message: "Nothing to verify. Payments above the approval limit wait here for a second person." }}
      />
      {viewing ? <FileViewerDialog file={viewing} onClose={() => setViewing(null)} /> : null}
      {rejecting ? (
        <ReasonDialog
          title={`Reject ${rejecting.number}`}
          description="The balance stays as it is, and whoever recorded it can see why."
          confirmLabel="Reject payment"
          destructive
          onConfirm={(reason) =>
            (rejecting.kind === "customer"
              ? api.reviewPayment(rejecting.id, { action: "reject", reason })
              : api.reviewSupplierPayment(rejecting.id, { action: "reject", reason })
            ).then(() => {
              toast.success(`${rejecting.number} rejected`);
            })
          }
          onClose={() => setRejecting(null)}
        />
      ) : null}
    </>
  );
}

/** Whether the viewer can open the queue. */
export function usePaymentsQueueAllowed(): boolean {
  const can = useCan();
  return featureOn("finance.payments-queue") && (can("sales.payment.approve") || can("purchasing.payment.approve"));
}
