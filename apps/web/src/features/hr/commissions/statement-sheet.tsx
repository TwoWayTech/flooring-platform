"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { Field } from "@/components/field";
import { ReasonDialog } from "@/components/reason-dialog";
import { ScrollRegion } from "@/components/scroll-region";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { Pick } from "@/features/hr/pick";
import { api } from "@/lib/api";
import type { CommissionInvoiceRef, CommissionStatementRow } from "@/lib/api/contract";
import { useFormatDate } from "@/lib/use-format-date";
import { monthName } from "./month-name";

function Line({ label, value, strong }: { label: ReactNode; value: string; strong?: boolean }) {
  return (
    <div
      className={
        strong ? "border-hairline flex justify-between gap-3 border-t pt-2 font-medium" : "flex justify-between gap-3"
      }
    >
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd>
        <Num kind="money" value={value} />
      </dd>
    </div>
  );
}

const KIND = { earned: "Earned", override: "Manager override", reversal: "Reversal" } as const;

const NO_INVOICE = "none";

/** Adds a manual change with a reason; a deduction names its invoice (spec C1, ADR 0025). */
function AdjustForm({ row, invoices }: { row: CommissionStatementRow; invoices: readonly CommissionInvoiceRef[] }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [invoiceId, setInvoiceId] = useState(NO_INVOICE);
  const own = invoices.filter((i) => i.salesRepId === row.userId && !i.isReturn && !i.voidedAt);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api.addCommissionAdjustment({
        userId: row.userId,
        month: row.month,
        amount,
        reason,
        invoiceId: invoiceId === NO_INVOICE ? null : invoiceId,
      });
      toast.success("Adjustment added");
      setAmount("");
      setReason("");
      setInvoiceId(NO_INVOICE);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add this adjustment.");
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Add an adjustment</h3>
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
        <Field id="adj-amount" label="Amount">
          <Input
            id="adj-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="150 or -75"
          />
        </Field>
        {/* The reason goes to the audit log; amounts stay out of it (owner decision 2026-11-14, ADR 0048). */}
        <Field id="adj-reason" label="Reason" hint="Say why. The amount goes in the Amount field.">
          <Input
            id="adj-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby="adj-reason-hint"
          />
        </Field>
      </div>
      {amount.trim().startsWith("-") ? (
        <Field id="adj-invoice" label="Invoice this relates to">
          <Pick
            id="adj-invoice"
            value={invoiceId}
            onChange={setInvoiceId}
            options={[[NO_INVOICE, "Choose an invoice"], ...own.map((i) => [i.id, i.number] as const)]}
          />
        </Field>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger-ink text-sm">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" variant="outline">
          Add adjustment
        </Button>
      </div>
    </form>
  );
}

/** One person's statement for a month (spec C1, ADR 0025): lines, adjustments and approval. */
export function StatementSheet({
  row,
  invoices,
  onClose,
}: {
  row: CommissionStatementRow;
  invoices: readonly CommissionInvoiceRef[];
  onClose: () => void;
}) {
  const can = useCan();
  const { user } = useWorkspace();
  const formatDate = useFormatDate();
  const [deciding, setDeciding] = useState<{ lineId: string; outcome: "applied" | "waived" } | null>(null);
  const numberOf = (id: string) => invoices.find((i) => i.id === id)?.number ?? "Invoice";
  const canApprove = can("hr.commission.approve") && row.userId !== user.id;

  async function approve() {
    try {
      await api.approveStatement(row.userId, row.month);
      toast.success(`Statement approved for ${row.name}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not approve this statement.");
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {row.name}, {monthName(row.month)}
          </SheetTitle>
          <SheetDescription>{row.planName ?? "No plan for this month"}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">
          <dl className="flex flex-col gap-1.5 text-sm">
            <Line label="Earned" value={row.earned} />
            <Line label="Manager overrides" value={row.override} />
            <Line label="Reversals" value={row.reversal} />
            <Line label="Adjustments" value={row.adjustment} />
            <Line label="Net" value={row.net} strong />
            <Line label="Carried in" value={row.carryIn} />
            <Line label="Draw" value={row.draw} />
            <Line label="Payable" value={row.payable} strong />
            <Line label="Carried to next month" value={row.carryOut} />
          </dl>
          {row.status === "draft" && canApprove ? (
            <div>
              <Button onClick={() => void approve()} disabled={!row.monthEnded || row.needsReview}>
                <Check />
                Approve statement
              </Button>
              {!row.monthEnded ? (
                <p className="text-muted-foreground mt-1 text-sm">This month has not ended yet.</p>
              ) : null}
            </div>
          ) : null}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Lines</h3>
            {row.lines.length === 0 ? (
              <p className="text-muted-foreground text-sm">No commission this month.</p>
            ) : (
              <ScrollRegion label="Commission lines">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="text-muted-foreground text-left text-xs">
                    <tr>
                      <th className="py-1 font-medium">Invoice</th>
                      <th className="py-1 font-medium">Type</th>
                      <th className="py-1 font-medium">Confirmed</th>
                      <th className="py-1 text-right font-medium">Base</th>
                      <th className="py-1 text-right font-medium">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.lines.map((l) => (
                      <tr key={l.id} className="border-hairline border-t">
                        <td className="py-1.5">{numberOf(l.invoiceId)}</td>
                        <td className="py-1.5">
                          {KIND[l.kind]}
                          {l.reversalState === "needs_review" && canApprove ? (
                            <span className="ml-2 inline-flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDeciding({ lineId: l.id, outcome: "applied" })}
                              >
                                Accept
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDeciding({ lineId: l.id, outcome: "waived" })}
                              >
                                Waive
                              </Button>
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1.5">{formatDate(l.confirmedOn)}</td>
                        <td className="py-1.5 text-right">
                          {/* Margin dollars are hidden without the margin key (ADR 0048). */}
                          {l.base === null ? (
                            <span className="text-muted-foreground">Hidden</span>
                          ) : (
                            <Num kind="money" value={l.base} />
                          )}
                        </td>
                        <td className="py-1.5 text-right">
                          <Num kind="money" value={l.commission} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            )}
          </section>
          {row.status === "draft" && can("hr.commission.adjust") ? <AdjustForm row={row} invoices={invoices} /> : null}
        </div>
        {deciding ? (
          <ReasonDialog
            title={deciding.outcome === "applied" ? "Accept this reversal" : "Waive this reversal"}
            description="This reversal arrived after its window closed, so HR decides. The reason stays on the statement."
            confirmLabel={deciding.outcome === "applied" ? "Accept" : "Waive"}
            onConfirm={(reason) => api.decideReversal({ userId: row.userId, month: row.month, ...deciding, reason })}
            onClose={() => setDeciding(null)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
