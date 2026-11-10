"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  ADJUSTMENT_REASON_LABELS,
  dec,
  REMNANT_THRESHOLD_FT,
  rollAvailable,
  validateCut,
  type AdjustmentReason,
  type Customer,
  type Reservation,
  type Roll,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Num } from "@workspace/ui/components/num";
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Segmented } from "@workspace/ui/components/segmented";
import { Textarea } from "@workspace/ui/components/textarea";
import { Field } from "@/components/field";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import type { StockHold } from "@/lib/api/contract";
import { CustomerPicker } from "@/features/customers/customer-picker";

/** What the cut will leave, in words, before the person confirms it. */
function Preview({ roll, length }: { roll: Roll; length: string }) {
  const problem = length ? validateCut(roll, length) : null;
  if (!length) return <p className="text-muted-foreground">Enter how much to cut.</p>;
  if (problem) return <p className="text-danger-ink">{problem}</p>;
  const left = dec(roll.remainingLengthFt).minus(length);
  if (left.isZero()) return <p className="text-muted-foreground">Uses up the roll.</p>;
  if (!roll.isRemnant && left.lt(REMNANT_THRESHOLD_FT)) {
    return (
      <p className="text-warning-ink">
        Leaves <Num kind="quantity" value={left.toString()} unit="ft" />, which becomes a remnant (under{" "}
        {REMNANT_THRESHOLD_FT} ft).
      </p>
    );
  }
  return (
    <p className="text-muted-foreground">
      Leaves <Num kind="quantity" value={left.toString()} unit="ft" /> on the roll.
    </p>
  );
}

type Mode = "invoice" | "new" | "adjust";

interface CutRollDialogProps {
  roll: Roll;
  reservations: Reservation[];
  holds: StockHold[];
  customers: Customer[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Cut roll (spec C1, C2): every cut has a source. Cut for an invoice that holds this roll (once
 * its deposit or payment is confirmed, or with an override reason), create a new invoice for a
 * length of it, or, with inventory.stock.adjust, record an adjustment with a reason.
 */
export function CutRollDialog({ roll, reservations, holds, customers, open, onOpenChange }: CutRollDialogProps) {
  const can = useCan();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("invoice");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string>("");
  const [override, setOverride] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [length, setLength] = useState("");
  const [reason, setReason] = useState<AdjustmentReason>("damage");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  const held = holds.filter((h) => h.rollId === roll.id);
  const shown = held.filter((h) =>
    `${h.invoiceNumber} ${h.customerName}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const chosen = held.find((h) => h.reservationId === picked);
  const paid = chosen?.mayIssue ?? false;
  const free = rollAvailable(roll, reservations).toString();
  const modes: (readonly [Mode, string])[] = [
    ["invoice", "For an invoice"],
    ...(can("sales.invoice.create") ? [["new", "New invoice"] as const] : []),
    ...(can("inventory.stock.adjust") ? [["adjust", "Adjustment"] as const] : []),
  ];

  async function run(work: () => Promise<string>) {
    setPending(true);
    try {
      const done = await work();
      toast.success(done);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Not saved. Try again.");
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === "invoice" && chosen) {
      void run(async () => {
        await api.issueReservation(chosen.reservationId, paid ? undefined : override);
        return `Cut ${chosen.quantity} ft for ${chosen.invoiceNumber}`;
      });
    } else if (mode === "new") {
      void run(async () => {
        const invoice = await api.createRollInvoice({ rollId: roll.id, customerId, lengthFt: length });
        router.push(`/sales/invoices/${invoice.id}`);
        return `Invoice ${invoice.number} created; the roll is held for it`;
      });
    } else if (mode === "adjust") {
      void run(async () => {
        const adj = await api.recordAdjustment({
          productId: roll.productId,
          rollId: roll.id,
          locationId: roll.locationId,
          quantity: `-${length}`,
          reason,
          note,
        });
        return adj.status === "pending" ? `${adj.number} waits for approval` : `${adj.number} recorded`;
      });
    }
  }

  const ready =
    mode === "invoice"
      ? !!chosen && (paid || (can("inventory.reservation.override") && override.trim().length >= 3))
      : mode === "new"
        ? !!customerId && !!length && !validateCut(roll, length)
        : !!length && !validateCut(roll, length) && (reason !== "other" || note.trim().length >= 3);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Cut roll {roll.rollNumber}</DialogTitle>
            <DialogDescription>
              <Num kind="quantity" value={roll.remainingLengthFt} unit="ft" /> left,{" "}
              <Num kind="quantity" value={free} unit="ft" /> not held for an invoice. Every cut needs an invoice or a
              reason.
            </DialogDescription>
          </DialogHeader>
          {modes.length > 1 ? (
            <Segmented label="Cut for" value={mode} options={modes} onChange={(v) => setMode(v as Mode)} />
          ) : null}
          {mode === "invoice" ? (
            <div className="flex flex-col gap-3">
              <Field id="cut-search" label="Find the invoice">
                <Input
                  id="cut-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Invoice number or customer"
                />
              </Field>
              {held.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No invoice holds this roll yet. Create a new invoice, or pick this roll on the quote.
                </p>
              ) : (
                <RadioGroup value={picked} onValueChange={setPicked} aria-label="Invoices holding this roll">
                  {shown.map((h) => (
                    <label key={h.reservationId} className="flex items-center gap-3 text-sm">
                      <RadioGroupItem value={h.reservationId} />
                      <span className="flex-1">
                        {h.invoiceNumber}, {h.customerName}
                      </span>
                      <Num kind="quantity" value={h.quantity} unit="ft" />
                    </label>
                  ))}
                </RadioGroup>
              )}
              {chosen ? <Preview roll={roll} length={chosen.quantity} /> : null}
              {chosen && !paid ? (
                can("inventory.reservation.override") ? (
                  <Field id="cut-override" label="Cut before payment: reason">
                    <Textarea
                      id="cut-override"
                      rows={2}
                      value={override}
                      onChange={(e) => setOverride(e.target.value)}
                    />
                    <p className="text-warning-ink text-xs">
                      {chosen.invoiceNumber} has no confirmed payment yet. The override is audited.
                    </p>
                  </Field>
                ) : (
                  <p className="text-warning-ink text-sm">
                    {chosen.invoiceNumber} has no confirmed payment yet. Cut once the deposit is in.
                  </p>
                )
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {mode === "new" ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cut-customer">Customer</Label>
                  <CustomerPicker
                    id="cut-customer"
                    customers={customers}
                    value={customerId}
                    onSelect={(c) => setCustomerId(c.id)}
                  />
                </div>
              ) : null}
              <Field id="cut-length" label={mode === "new" ? "Length to sell" : "Length to remove"}>
                <Input
                  id="cut-length"
                  inputMode="decimal"
                  value={length}
                  onChange={(e) => setLength(e.target.value.replace(/[^\d.]/g, ""))}
                  className="w-32 tabular-nums"
                />
              </Field>
              <Preview roll={roll} length={length} />
              {mode === "adjust" ? (
                <>
                  <Field id="cut-reason" label="Reason">
                    <Select value={reason} onValueChange={(v) => setReason(v as AdjustmentReason)}>
                      <SelectTrigger id="cut-reason" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ADJUSTMENT_REASON_LABELS) as AdjustmentReason[]).map((r) => (
                          <SelectItem key={r} value={r}>
                            {ADJUSTMENT_REASON_LABELS[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id="cut-note" label={reason === "other" ? "What happened" : "Note (optional)"}>
                    <Textarea id="cut-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                </>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !ready}>
              {mode === "invoice"
                ? chosen
                  ? `Cut for ${chosen.invoiceNumber}`
                  : "Cut"
                : mode === "new"
                  ? "Create invoice"
                  : "Record adjustment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
