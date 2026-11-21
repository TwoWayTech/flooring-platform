"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  dec,
  maxDec,
  depositAmount,
  duplicateReference,
  formatNumber,
  INVOICE_STATUS_LABELS,
  invoiceLedger,
  invoiceStatus,
  moneyString,
  needsApproval,
  PAYMENT_METHOD_LABELS,
  validatePayment,
  type Invoice,
  type InvoiceAdjustment,
  type InvoiceLedger,
  type Payment,
  type PaymentErrors,
  type PaymentMethod,
  type PaymentSettings,
  type RecordPaymentInput,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import { Textarea } from "@workspace/ui/components/textarea";
import { Field } from "@/components/field";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { retryToast } from "@/lib/api/retry";
import { balanceAfterLabel } from "./payment-words";
import { ProofFilesField } from "./proof-files-field";

/** The fields in the order the form shows them, for focusing the first error. */
const ORDER: (keyof PaymentErrors | "files")[] = [
  "amount",
  "date",
  "method",
  "checkNumber",
  "cardLast4",
  "reference",
  "files",
];
const fieldId = (key: string) => `pay-${key}`;
const NO_FILE = "Attach the receipt, bank confirmation or check photo to continue.";

interface RecordPaymentSheetProps {
  invoice: Invoice;
  ledger: InvoiceLedger;
  /** Every payment in the company the viewer can see, for the duplicate-reference warning. */
  payments: readonly Payment[];
  adjustments: readonly InvoiceAdjustment[];
  settings: PaymentSettings;
  /** Start as a deposit (Update status → Record deposit). */
  asDeposit?: boolean;
  onClose: () => void;
}

/** One line of the live summary. */
function SummaryRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold" : undefined}>
        <Num kind="money" value={value} />
      </dd>
    </div>
  );
}

/**
 * Record payment (spec Appendix A): amount with Full balance and Deposit shortcuts, date, method
 * with check number or the card's last 4 digits, reference, mandatory proof, note, and a live
 * summary of the balance after and the resulting status. Save stays disabled until a file is
 * attached; errors appear next to their fields and the first one takes focus.
 */
export function RecordPaymentSheet({
  invoice,
  ledger,
  payments,
  adjustments,
  settings,
  asDeposit = false,
  onClose,
}: RecordPaymentSheetProps) {
  const can = useCan();
  const numbers = useNumberSettings();
  const today = api.today();
  const deposit = depositAmount(invoice.total, invoice.depositPct);
  const offerDeposit = dec(invoice.depositPct).gt(0) && dec(ledger.paid).isZero() && dec(deposit).lt(ledger.balance);
  // A payment already waiting for its check is not asked for again (audit U-18).
  const suggested = moneyString(maxDec(dec(ledger.balance).minus(ledger.pending), 0));
  const [input, setInput] = useState<RecordPaymentInput>({
    invoiceId: invoice.id,
    kind: asDeposit && offerDeposit ? "deposit" : "payment",
    amount: asDeposit && offerDeposit ? deposit : suggested,
    date: today,
    method: "ach",
    checkNumber: "",
    cardLast4: "",
    reference: "",
    note: "",
    extraAsCredit: false,
    allowDuplicateReference: false,
  });
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<PaymentErrors>({});
  const [pending, setPending] = useState(false);
  const canCredit = can("sales.payment.apply_credit");
  const formatMoney = (v: string) => formatNumber(v, "money", numbers);
  const set = (patch: Partial<RecordPaymentInput>) => setInput((prev) => ({ ...prev, ...patch }));

  const amount = /^\d+(\.\d{1,2})?$/.test(input.amount.trim()) ? input.amount.trim() : "0";
  const over = dec(amount).gt(ledger.balance);
  const duplicate = input.method === "cash" ? undefined : duplicateReference(input.reference, payments);
  const waits = needsApproval(settings, amount);
  // The balance after counts this payment as confirmed; the status says whether it waits first.
  const previewAs = (status: Payment["status"]) =>
    invoiceLedger(
      invoice,
      {
        payments: [
          ...payments.filter((p) => p.invoiceId === invoice.id),
          { invoiceId: invoice.id, amount, status, kind: input.kind } as Payment,
        ],
        adjustments: adjustments.filter((a) => a.invoiceId === invoice.id),
      },
      today,
    );
  const after = previewAs("confirmed");
  const statusAfter = waits ? previewAs("pending") : after;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const found = validatePayment(input, {
      issuedAt: invoice.issuedAt,
      today,
      balance: ledger.balance,
      canCredit,
      formatMoney,
    });
    setErrors(found);
    const first = ORDER.find((key) => key !== "files" && found[key]);
    if (first) {
      document.getElementById(fieldId(first))?.focus();
      return;
    }
    if (duplicate && !input.allowDuplicateReference) {
      document.getElementById("pay-duplicate")?.focus();
      return;
    }
    setPending(true);
    try {
      const saved = await api.recordPayment({ ...input, amount: moneyString(amount) }, files);
      toast.success(
        saved.status === "pending"
          ? `${saved.number} recorded; it waits for verification`
          : `${saved.number} recorded on ${invoice.number}`,
      );
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The payment was not saved.",
        retryToast(error, () => void submit()),
      );
    } finally {
      setPending(false);
    }
  }

  const fieldError = (key: keyof PaymentErrors) =>
    errors[key] ? (
      <p id={`${fieldId(key)}-error`} className="text-danger-ink text-xs">
        {errors[key]}
      </p>
    ) : null;
  const aria = (key: keyof PaymentErrors) =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${fieldId(key)}-error` } : {};

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex min-h-full flex-col">
          <SheetHeader>
            <SheetTitle>{input.kind === "deposit" ? "Record deposit" : "Record payment"}</SheetTitle>
            <SheetDescription>
              Invoice {invoice.number}. The balance drops once the payment is confirmed.
              {ledger.pendingVerification ? (
                <span className="text-warning-ink mt-1 block">
                  <Num kind="money" value={ledger.pending} /> is already waiting for verification on this invoice.
                </span>
              ) : null}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <Field id={fieldId("amount")} label="Amount">
              <Input
                id={fieldId("amount")}
                inputMode="decimal"
                value={input.amount}
                onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, ""), kind: "payment" })}
                className="w-40 text-right tabular-nums"
                {...aria("amount")}
              />
              {fieldError("amount")}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => set({ amount: ledger.balance, kind: "payment" })}
                >
                  Full balance
                </Button>
                {offerDeposit ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => set({ amount: deposit, kind: "deposit" })}
                  >
                    Deposit ({formatNumber(invoice.depositPct, "percent", numbers)})
                  </Button>
                ) : null}
              </div>
              {over && canCredit ? (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={input.extraAsCredit}
                    onCheckedChange={(v) => set({ extraAsCredit: v === true })}
                    className="mt-0.5"
                  />
                  Record the extra <Num kind="money" value={dec(amount).minus(ledger.balance).toString()} /> as customer
                  credit
                </label>
              ) : null}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={fieldId("date")} label="Payment date">
                <Input
                  id={fieldId("date")}
                  type="date"
                  value={input.date}
                  min={invoice.issuedAt}
                  max={today}
                  onChange={(e) => set({ date: e.target.value })}
                  {...aria("date")}
                />
                {fieldError("date")}
              </Field>
              <Field id={fieldId("method")} label="Method">
                <Select value={input.method} onValueChange={(method: PaymentMethod) => set({ method })}>
                  <SelectTrigger id={fieldId("method")} className="w-full" {...aria("method")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                      <SelectItem key={m} value={m}>
                        {PAYMENT_METHOD_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldError("method")}
              </Field>
            </div>
            {input.method === "check" ? (
              <Field id={fieldId("checkNumber")} label="Check number">
                <Input
                  id={fieldId("checkNumber")}
                  inputMode="numeric"
                  value={input.checkNumber}
                  onChange={(e) => set({ checkNumber: e.target.value.replace(/\D/g, "") })}
                  className="w-40"
                  {...aria("checkNumber")}
                />
                {fieldError("checkNumber")}
              </Field>
            ) : null}
            {input.method === "card" ? (
              <Field id={fieldId("cardLast4")} label="Card, last 4 digits" hint="Never the full card number.">
                <Input
                  id={fieldId("cardLast4")}
                  inputMode="numeric"
                  maxLength={4}
                  value={input.cardLast4}
                  onChange={(e) => set({ cardLast4: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                  className="w-24"
                  {...aria("cardLast4")}
                />
                {fieldError("cardLast4")}
              </Field>
            ) : null}
            <Field
              id={fieldId("reference")}
              label={input.method === "cash" ? "Reference (optional)" : "Reference or transaction ID"}
            >
              <Input
                id={fieldId("reference")}
                value={input.reference}
                onChange={(e) => set({ reference: e.target.value, allowDuplicateReference: false })}
                {...aria("reference")}
              />
              {fieldError("reference")}
              {duplicate ? (
                <div
                  className="border-warning bg-warning/10 flex flex-col gap-2 rounded-md border p-3 text-sm"
                  role="status"
                >
                  <p>Payment {duplicate.number} already uses this reference. Check it before you continue.</p>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      id="pay-duplicate"
                      checked={input.allowDuplicateReference}
                      onCheckedChange={(v) => set({ allowDuplicateReference: v === true })}
                    />
                    The reference is right; record it anyway
                  </label>
                </div>
              ) : null}
            </Field>
            <ProofFilesField
              id={fieldId("files")}
              files={files}
              onChange={setFiles}
              message={files.length ? undefined : NO_FILE}
            />
            <Field id={fieldId("note")} label="Note (optional)">
              <Textarea
                id={fieldId("note")}
                rows={2}
                value={input.note}
                onChange={(e) => set({ note: e.target.value })}
              />
            </Field>
            <section aria-label="Payment summary" className="bg-muted/50 rounded-md p-3 text-sm">
              <dl className="flex flex-col gap-1.5">
                <SummaryRow label="Invoice total" value={ledger.total} />
                <SummaryRow label="Already paid" value={ledger.paid} />
                <SummaryRow label="This payment" value={amount} />
                <SummaryRow label={balanceAfterLabel(waits)} value={after.balance} strong />
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Status after</dt>
                  <dd className="font-medium">{INVOICE_STATUS_LABELS[invoiceStatus(statusAfter).main]}</dd>
                </div>
              </dl>
              {waits ? (
                <p className="text-muted-foreground mt-2 text-xs">
                  Payments{settings.approvalThreshold ? ` above ${formatMoney(settings.approvalThreshold)}` : ""} wait
                  for a second person to verify them; until then the balance stays.
                </p>
              ) : null}
            </section>
          </div>
          <SheetFooter className="mt-auto">
            {files.length === 0 ? <p className="text-muted-foreground text-xs">{NO_FILE}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || files.length === 0}>
                {pending ? "Saving" : input.kind === "deposit" ? "Save deposit" : "Save payment"}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
