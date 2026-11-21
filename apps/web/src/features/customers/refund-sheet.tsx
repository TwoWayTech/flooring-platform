"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  formatNumber,
  PAYMENT_METHOD_LABELS,
  validateRefund,
  type Customer,
  type PaymentMethod,
  type RefundErrors,
  type RefundInput,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
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
import { api } from "@/lib/api";
import { retryToast } from "@/lib/api/retry";
import { ProofFilesField } from "@/features/invoices/payments/proof-files-field";

const ORDER: (keyof RefundErrors)[] = ["amount", "date", "reference"];
const NO_FILE = "Attach the refund confirmation to continue.";

/**
 * Refund customer credit (spec Appendix A "Refund"): an outgoing payment with method, reference
 * and mandatory proof, never more than the credit the customer has.
 */
export function RefundSheet({
  customer,
  credit,
  onClose,
}: {
  customer: Customer;
  credit: string;
  onClose: () => void;
}) {
  const numbers = useNumberSettings();
  const today = api.today();
  const [input, setInput] = useState<RefundInput>({
    customerId: customer.id,
    amount: credit,
    date: today,
    method: "ach",
    reference: "",
    note: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<RefundErrors>({});
  const [pending, setPending] = useState(false);
  const set = (patch: Partial<RefundInput>) => setInput((prev) => ({ ...prev, ...patch }));
  const formatMoney = (v: string) => formatNumber(v, "money", numbers);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const found = validateRefund(input, { credit, today, formatMoney });
    setErrors(found);
    const first = ORDER.find((k) => found[k]);
    if (first) return document.getElementById(`refund-${first}`)?.focus();
    setPending(true);
    try {
      const refund = await api.refundCredit(input, files);
      toast.success(`${refund.number} recorded for ${customer.name}`);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The refund was not saved.",
        retryToast(error, () => void submit()),
      );
    } finally {
      setPending(false);
    }
  }

  const fieldError = (key: keyof RefundErrors) =>
    errors[key] ? (
      <p id={`refund-${key}-error`} className="text-danger-ink text-xs">
        {errors[key]}
      </p>
    ) : null;
  const aria = (key: keyof RefundErrors) =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `refund-${key}-error` } : {};

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex min-h-full flex-col">
          <SheetHeader>
            <SheetTitle>Refund credit</SheetTitle>
            <SheetDescription>
              {customer.name} has {formatMoney(credit)} of credit. The refund lowers it.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <Field id="refund-amount" label="Amount">
              <Input
                id="refund-amount"
                inputMode="decimal"
                value={input.amount}
                onChange={(e) => set({ amount: e.target.value.replace(/[^\d.]/g, "") })}
                className="w-40 text-right tabular-nums"
                {...aria("amount")}
              />
              {fieldError("amount")}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="refund-date" label="Refund date">
                <Input
                  id="refund-date"
                  type="date"
                  max={today}
                  value={input.date}
                  onChange={(e) => set({ date: e.target.value })}
                  {...aria("date")}
                />
                {fieldError("date")}
              </Field>
              <Field id="refund-method" label="Method">
                <Select value={input.method} onValueChange={(method: PaymentMethod) => set({ method })}>
                  <SelectTrigger id="refund-method" className="w-full">
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
              </Field>
            </div>
            <Field
              id="refund-reference"
              label={input.method === "cash" ? "Reference (optional)" : "Reference or transaction ID"}
            >
              <Input
                id="refund-reference"
                value={input.reference}
                onChange={(e) => set({ reference: e.target.value })}
                {...aria("reference")}
              />
              {fieldError("reference")}
            </Field>
            <ProofFilesField
              id="refund-files"
              label="Proof of refund"
              files={files}
              onChange={setFiles}
              message={files.length ? undefined : NO_FILE}
            />
            <Field id="refund-note" label="Note (optional)">
              <Textarea id="refund-note" rows={2} value={input.note} onChange={(e) => set({ note: e.target.value })} />
            </Field>
          </div>
          <SheetFooter className="mt-auto">
            {files.length === 0 ? <p className="text-muted-foreground text-xs">{NO_FILE}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || files.length === 0}>
                {pending ? "Saving" : "Save refund"}
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
