"use client";

import { useRef, useState, type ReactNode } from "react";
import { Ban, CircleCheck, Paperclip, ScanSearch, XCircle, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  PAYMENT_METHOD_LABELS,
  type FileMeta,
  type InvoiceLedger,
  type Payment,
  type PaymentStatus,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { StatusPill, type StatusTone } from "@workspace/ui/components/status-pill";
import { cn } from "@workspace/ui/lib/utils";
import { ReasonDialog } from "@/components/reason-dialog";
import { ScrollRegion } from "@/components/scroll-region";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useFormatDate } from "@/lib/use-format-date";
import { FileViewerDialog } from "./file-viewer-dialog";

const STATUS: Record<PaymentStatus, { tone: StatusTone; icon: LucideIcon; label: string }> = {
  pending: { tone: "warning", icon: ScanSearch, label: "Pending" },
  confirmed: { tone: "success", icon: CircleCheck, label: "Confirmed" },
  rejected: { tone: "neutral", icon: XCircle, label: "Rejected" },
  voided: { tone: "neutral", icon: Ban, label: "Voided" },
};

/** Who may act on a payment row, and what each action does. */
export interface PaymentRowActions {
  /** Extra buttons for a row, such as Void or Download receipt (spec Appendix A "Corrections"). */
  extra?: (payment: Payment) => ReactNode;
}

/** Adds proof files to a payment from a hidden picker. */
function AddFiles({ payment }: { payment: Payment }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
        <Paperclip />
        Add file
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label={`Add files to ${payment.number}`}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length === 0) return;
          api
            .attachPaymentFiles(payment.id, files)
            .then(() => toast.success(`Added to ${payment.number}`))
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Not added."));
        }}
      />
    </>
  );
}

/**
 * The invoice's payments (spec Appendix A "Payments on the invoice"): number, date, method,
 * reference, amount, status, who recorded it and the attachments, with Paid and Balance due.
 * A payment waiting for verification can be confirmed or rejected by someone with approval
 * permission who did not record it. Voided payments stay visible, struck through.
 */
export function PaymentsSection({
  payments,
  ledger,
  actions,
}: {
  payments: Payment[];
  ledger: InvoiceLedger;
  actions?: PaymentRowActions;
}) {
  const can = useCan();
  const { user } = useWorkspace();
  const formatDate = useFormatDate();
  const [viewing, setViewing] = useState<FileMeta | null>(null);
  const [rejecting, setRejecting] = useState<Payment | null>(null);
  const canApprove = can("sales.payment.approve");
  const canRecord = can("sales.payment.record");

  const confirm = (p: Payment) =>
    api
      .reviewPayment(p.id, { action: "confirm" })
      .then(() => toast.success(`${p.number} confirmed`))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Not confirmed."));

  return (
    <Panel title="Payments">
      {payments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No payments recorded yet.</p>
      ) : (
        <ScrollRegion label="Payments">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="text-muted-foreground border-hairline border-b text-xs">
              <tr>
                {["Payment", "Date", "Method", "Reference", "Amount", "Status", "Recorded by", "Files", ""].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className={cn("py-2 pr-3 font-medium", h === "Amount" ? "text-right" : "text-left")}
                  >
                    {h || <span className="sr-only">Actions</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const voided = p.status === "voided" || p.status === "rejected";
                const mine = p.recordedById === user.id;
                return (
                  <tr key={p.id} className="border-hairline border-b align-top">
                    <td className={cn("py-2 pr-3 font-medium whitespace-nowrap", voided && "line-through")}>
                      {p.number}
                      {p.kind === "deposit" ? (
                        <span className="text-muted-foreground block text-xs">Deposit</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDate(p.date)}</td>
                    <td className="py-2 pr-3">
                      {PAYMENT_METHOD_LABELS[p.method]}
                      {p.method === "card" && p.cardLast4 ? ` ending ${p.cardLast4}` : ""}
                      {p.method === "check" && p.checkNumber ? ` #${p.checkNumber}` : ""}
                    </td>
                    <td className="py-2 pr-3 break-all">{p.reference || "None"}</td>
                    <td className={cn("py-2 pr-3 text-right", voided && "line-through")}>
                      <Num kind="money" value={p.amount} />
                    </td>
                    <td className="py-2 pr-3">
                      <StatusPill {...STATUS[p.status]} />
                      {p.rejectReason || p.voidReason ? (
                        <span className="text-muted-foreground block text-xs">{p.rejectReason ?? p.voidReason}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      {p.recordedBy}
                      {p.reviewedBy ? (
                        <span className="text-muted-foreground block text-xs">Checked by {p.reviewedBy}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      <ul className="flex flex-col gap-1">
                        {p.files.map((f) => (
                          <li key={f.id}>
                            <button
                              type="button"
                              className="text-brand-ink max-w-40 truncate text-left underline-offset-4 hover:underline"
                              onClick={() => setViewing(f)}
                            >
                              {f.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        {p.status === "pending" && canApprove && !mine ? (
                          <>
                            <Button size="sm" aria-label={`Confirm ${p.number}`} onClick={() => void confirm(p)}>
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`Reject ${p.number}`}
                              onClick={() => setRejecting(p)}
                            >
                              Reject
                            </Button>
                          </>
                        ) : null}
                        {p.status === "pending" && mine ? (
                          <span className="text-muted-foreground text-xs">Someone else verifies it</span>
                        ) : null}
                        {canRecord && !voided ? <AddFiles payment={p} /> : null}
                        {actions?.extra?.(p)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      <dl className="mt-4 flex flex-wrap justify-end gap-x-8 gap-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Paid</dt>
          <dd className="font-medium">
            <Num kind="money" value={ledger.paid} />
          </dd>
        </div>
        {ledger.pendingVerification ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Waiting for verification</dt>
            <dd>
              <Num kind="money" value={ledger.pending} />
            </dd>
          </div>
        ) : null}
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Balance due</dt>
          <dd className="font-semibold">
            <Num kind="money" value={ledger.balance} />
          </dd>
        </div>
      </dl>
      {viewing ? <FileViewerDialog file={viewing} onClose={() => setViewing(null)} /> : null}
      {rejecting ? (
        <ReasonDialog
          title={`Reject ${rejecting.number}`}
          description="The payment stays on the invoice as rejected and the balance does not change."
          confirmLabel="Reject payment"
          destructive
          onConfirm={(reason) => api.reviewPayment(rejecting.id, { action: "reject", reason })}
          onClose={() => setRejecting(null)}
        />
      ) : null}
    </Panel>
  );
}
