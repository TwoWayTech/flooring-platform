"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  allocate,
  dec,
  moneyString,
  PAYMENT_METHOD_LABELS,
  type Bill,
  type BillLedger,
  type PaymentMethod,
  type Supplier,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";
import { Field } from "@/components/field";
import { api } from "@/lib/api";
import { ProofFilesField } from "@/features/invoices/payments/proof-files-field";
import { useFormatDate } from "@/lib/use-format-date";

const NO_FILE = "Attach the remittance, bank confirmation or check photo to continue.";

/**
 * The warning before paying bills whose total differs from the goods received, or null when every
 * chosen bill matches. The spec flags a difference without blocking it (purchasing.md rule 21) and
 * says nothing of holding the payment, so paying stays allowed after an explicit "Pay anyway"
 * (click-through #25), one sentence per flagged bill with its stored match line.
 */
export function payAnywayWarning(bills: readonly Pick<Bill, "number" | "matchIssues">[]): string | null {
  const flagged = bills.filter((b) => b.matchIssues.length > 0);
  if (flagged.length === 0) return null;
  const lines = flagged.map((b) => `Bill ${b.number} differs from the goods received: ${b.matchIssues.join(" ")}`);
  return `${lines.join(" ")} Pay anyway?`;
}

/**
 * Pay a supplier (spec D3, mirroring Appendix A): pick the open bills, the amount (partial is
 * fine; it goes to the oldest due first), method, reference and mandatory proof. With approval on,
 * a second person confirms it before the bills count as paid. A bill flagged as differing from
 * the goods received needs "Pay anyway" ticked before Save.
 */
export function SupplierPaymentSheet({
  supplier,
  bills,
  ledgers,
  onClose,
}: {
  supplier: Supplier;
  bills: Bill[];
  ledgers: ReadonlyMap<string, BillLedger>;
  onClose: () => void;
}) {
  const formatDate = useFormatDate();
  const open = bills.filter((b) => b.supplierId === supplier.id && dec(ledgers.get(b.id)?.unpaid ?? "0").gt(0));
  const [picked, setPicked] = useState<string[]>(open.map((b) => b.id));
  const chosen = open.filter((b) => picked.includes(b.id)).map((b) => ({ ...b, balance: ledgers.get(b.id)!.unpaid }));
  const owed = moneyString(chosen.reduce((s, b) => s.plus(b.balance), dec(0)));
  const [amount, setAmount] = useState(owed);
  const [date, setDate] = useState(api.today());
  const [method, setMethod] = useState<PaymentMethod>("ach");
  const [reference, setReference] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [payAnyway, setPayAnyway] = useState(false);
  const warning = payAnywayWarning(chosen);
  const split = allocate(/^\d+(\.\d{1,2})?$/.test(amount) ? amount : "0", chosen);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setPending(true);
    try {
      const payment = await api.recordSupplierPayment(
        { supplierId: supplier.id, amount, date, method, reference, note: "", billIds: picked },
        files,
      );
      toast.success(
        payment.status === "pending"
          ? `${payment.number} recorded; it waits for verification`
          : `${payment.number} recorded`,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The payment was not saved.", {
        action: { label: "Try again", onClick: () => void submit() },
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex min-h-full flex-col">
          <SheetHeader>
            <SheetTitle>Pay {supplier.name}</SheetTitle>
            <SheetDescription>
              <Num kind="money" value={owed} /> owed on the bills chosen.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-sm font-medium">Bills</legend>
              {open.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={picked.includes(b.id)}
                    onCheckedChange={(v) => setPicked((p) => (v === true ? [...p, b.id] : p.filter((x) => x !== b.id)))}
                  />
                  <span className="flex-1">
                    {b.number}, due {formatDate(b.dueAt)}
                  </span>
                  <Num kind="money" value={ledgers.get(b.id)!.unpaid} />
                </label>
              ))}
            </fieldset>
            <Field id="sp-amount" label="Amount">
              <Input
                id="sp-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                className="w-40 text-right tabular-nums"
              />
            </Field>
            {split.length > 1 ? (
              <p className="text-muted-foreground text-xs">
                Split oldest due first:{" "}
                {split.map((a) => `${open.find((b) => b.id === a.billId)?.number} ${a.amount}`).join(", ")}
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="sp-date" label="Payment date">
                <Input
                  id="sp-date"
                  type="date"
                  max={api.today()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field id="sp-method" label="Method">
                <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                  <SelectTrigger id="sp-method" className="w-full">
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
            <Field id="sp-reference" label={method === "cash" ? "Reference (optional)" : "Reference or transaction ID"}>
              <Input id="sp-reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <ProofFilesField
              id="sp-files"
              files={files}
              onChange={setFiles}
              message={files.length ? undefined : NO_FILE}
            />
            {warning ? (
              <div role="alert" className="bg-warning/12 flex flex-col gap-2 rounded-md px-3 py-2 text-sm">
                <p className="text-warning-ink">{warning}</p>
                <label className="flex items-center gap-2 font-medium">
                  <Checkbox checked={payAnyway} onCheckedChange={(v) => setPayAnyway(v === true)} />
                  Pay anyway
                </label>
              </div>
            ) : null}
          </div>
          <SheetFooter className="mt-auto">
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={pending || files.length === 0 || picked.length === 0 || (!!warning && !payAnyway)}
              >
                Save payment
              </Button>
            </div>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
