"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleCheck, Paperclip, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  PAYMENT_METHOD_LABELS,
  type Bill,
  type BillLedger,
  type FileMeta,
  type GoodsReceipt,
  type PurchaseOrder,
  type Supplier,
  type SupplierPayment,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { ReasonDialog } from "@/components/reason-dialog";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { FileViewerDialog } from "@/features/invoices/payments/file-viewer-dialog";
import { api } from "@/lib/api";
import { useFormatDate } from "@/lib/use-format-date";

const STATUS = {
  pending: { tone: "warning", icon: CircleCheck, label: "Pending verification" },
  confirmed: { tone: "success", icon: CircleCheck, label: "Confirmed" },
  rejected: { tone: "neutral", icon: XCircle, label: "Rejected" },
  voided: { tone: "neutral", icon: XCircle, label: "Voided" },
} as const;

/**
 * A supplier bill and everything around it (spec D3, audit U-04, U-12): its order, its receipts
 * and each payment with proof, Confirm, Reject and Void. A payment waiting for a second person is
 * visible here, so a bill cannot be paid twice by accident.
 */
export function BillDrawer({
  bill,
  ledger,
  supplier,
  order,
  receipts,
  payments,
  onClose,
}: {
  bill: Bill;
  ledger: BillLedger;
  supplier: Supplier | undefined;
  order: PurchaseOrder | undefined;
  receipts: readonly GoodsReceipt[];
  payments: readonly SupplierPayment[];
  onClose: () => void;
}) {
  const can = useCan();
  const { user } = useWorkspace();
  const formatDate = useFormatDate();
  const [viewing, setViewing] = useState<FileMeta | null>(null);
  const [rejecting, setRejecting] = useState<SupplierPayment | null>(null);
  const [voiding, setVoiding] = useState<SupplierPayment | null>(null);
  const own = payments.filter((p) => p.allocations.some((a) => a.billId === bill.id));
  const linked = receipts.filter((r) => bill.receiptIds.includes(r.id));
  const amountOn = (p: SupplierPayment) => p.allocations.find((a) => a.billId === bill.id)!.amount;
  const confirm = (p: SupplierPayment) =>
    void api
      .reviewSupplierPayment(p.id, { action: "confirm" })
      .then(() => toast.success(`${p.number} confirmed`))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Not saved."));
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Bill {bill.number}</SheetTitle>
          <SheetDescription>
            {supplier?.name}, issued {formatDate(bill.issuedAt)}, due {formatDate(bill.dueAt)}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6 text-sm">
          <dl className="grid grid-cols-4 gap-3">
            <div>
              <dt className="text-muted-foreground text-xs">Total</dt>
              <dd>
                <Num kind="money" value={bill.total} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Paid</dt>
              <dd>
                <Num kind="money" value={ledger.paid} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Waiting</dt>
              <dd>
                <Num kind="money" value={ledger.pending} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Remaining</dt>
              <dd className="font-semibold">
                <Num kind="money" value={ledger.balance} />
              </dd>
            </div>
          </dl>
          {order ? (
            <p>
              Order:{" "}
              <Link
                href={`/purchasing?view=orders&po=${order.id}`}
                className="text-brand-ink underline-offset-4 hover:underline"
              >
                {order.number}
              </Link>
              {linked.length ? `, received on ${linked.map((r) => r.number).join(", ")}` : ""}
            </p>
          ) : null}
          {bill.matchIssues.length ? <p className="text-warning-ink">{bill.matchIssues.join(" ")}</p> : null}
          {bill.files.length ? (
            <ul className="flex flex-col gap-1" aria-label="Supplier's invoice">
              {bill.files.map((f) => (
                <li key={f.id}>
                  <Button variant="ghost" size="sm" onClick={() => setViewing(f)}>
                    <Paperclip />
                    {f.name}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <section aria-label="Payments on this bill" className="flex flex-col gap-2">
            <h3 className="font-semibold">Payments</h3>
            {own.length === 0 ? <p className="text-muted-foreground">No payments yet.</p> : null}
            {own.map((p) => (
              <div key={p.id} className="border-hairline flex flex-col gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{p.number}</span>
                  <Num kind="money" value={amountOn(p)} />
                  <StatusPill {...STATUS[p.status]} />
                </div>
                <p className="text-muted-foreground text-xs">
                  {formatDate(p.date)}, {PAYMENT_METHOD_LABELS[p.method]}, {p.reference || "no reference"}, recorded by{" "}
                  {p.recordedBy}
                  {p.rejectReason ? `. Rejected: ${p.rejectReason}` : ""}
                  {p.voidReason ? `. Voided: ${p.voidReason}` : ""}
                </p>
                <span className="flex flex-wrap gap-1.5">
                  {p.files.map((f) => (
                    <Button key={f.id} variant="ghost" size="sm" onClick={() => setViewing(f)}>
                      <Paperclip />
                      {f.name}
                    </Button>
                  ))}
                  {p.status === "pending" && can("purchasing.payment.approve") ? (
                    p.recordedById === user.id ? (
                      <span className="text-muted-foreground self-center text-xs">Someone else verifies it</span>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => confirm(p)}>
                          Confirm
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setRejecting(p)}>
                          Reject
                        </Button>
                      </>
                    )
                  ) : null}
                  {(p.status === "pending" || p.status === "confirmed") && can("purchasing.payment.void") ? (
                    <Button size="sm" variant="ghost" onClick={() => setVoiding(p)}>
                      Void
                    </Button>
                  ) : null}
                </span>
              </div>
            ))}
          </section>
        </div>
        {viewing ? <FileViewerDialog file={viewing} onClose={() => setViewing(null)} /> : null}
        {rejecting ? (
          <ReasonDialog
            title={`Reject ${rejecting.number}`}
            description="The bill's balance stays as it is."
            confirmLabel="Reject payment"
            destructive
            onConfirm={(reason) =>
              api.reviewSupplierPayment(rejecting.id, { action: "reject", reason }).then(() => {
                toast.success(`${rejecting.number} rejected`);
              })
            }
            onClose={() => setRejecting(null)}
          />
        ) : null}
        {voiding ? (
          <ReasonDialog
            title={`Void ${voiding.number}`}
            description="The payment stays on record and the bill's balance comes back."
            confirmLabel="Void payment"
            destructive
            onConfirm={(reason) =>
              api.voidSupplierPayment(voiding.id, reason).then(() => {
                toast.success(`${voiding.number} voided`);
              })
            }
            onClose={() => setVoiding(null)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
