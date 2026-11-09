"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  ADJUSTMENT_REASON_LABELS,
  warehousesOf,
  type AdjustmentReason,
  type Location,
  type Product,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Textarea } from "@workspace/ui/components/textarea";
import { Field } from "@/components/field";
import { WarehouseSelect } from "@/components/warehouse-select";
import { api } from "@/lib/api";

/**
 * Adjust stock of a boxed product (spec C1): the only change without a sale, a receipt or a
 * transfer. A signed quantity, a reason, and above the company's limit it waits for approval.
 */
export function AdjustStockDialog({
  product,
  locations,
  onClose,
}: {
  product: Product;
  locations: Location[];
  onClose: () => void;
}) {
  const [locationId, setLocationId] = useState(warehousesOf(locations)[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<AdjustmentReason>("count");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^-?\d+(\.\d{1,2})?$/.test(quantity.trim()) || Number(quantity) === 0) {
      setError("Enter the change, for example -3 to remove 3 or 12 to add 12.");
      document.getElementById("adjust-quantity")?.focus();
      return;
    }
    setPending(true);
    try {
      const adj = await api.recordAdjustment({
        productId: product.id,
        rollId: null,
        locationId,
        quantity,
        reason,
        note,
      });
      toast.success(adj.status === "pending" ? `${adj.number} waits for approval` : `${adj.number} recorded`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Not saved. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
            <DialogDescription>
              {product.name}. Sales, receipts and transfers change stock on their own; use this for damage, a count or
              samples.
            </DialogDescription>
          </DialogHeader>
          <Field id="adjust-location" label="Warehouse">
            <WarehouseSelect
              id="adjust-location"
              label="Warehouse"
              className="w-full"
              locations={warehousesOf(locations)}
              value={locationId}
              onChange={setLocationId}
            />
          </Field>
          <Field id="adjust-quantity" label="Change" hint="Negative takes stock out.">
            <Input
              id="adjust-quantity"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/[^\d.-]/g, ""))}
              aria-invalid={!!error}
              aria-describedby={error ? "adjust-quantity-error" : "adjust-quantity-hint"}
              className="w-32 tabular-nums"
            />
            {error ? (
              <p id="adjust-quantity-error" className="text-danger-ink text-xs">
                {error}
              </p>
            ) : null}
          </Field>
          <Field id="adjust-reason" label="Reason">
            <Select value={reason} onValueChange={(v) => setReason(v as AdjustmentReason)}>
              <SelectTrigger id="adjust-reason" className="w-full">
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
          <Field id="adjust-note" label={reason === "other" ? "What happened" : "Note (optional)"}>
            <Textarea id="adjust-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Record adjustment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
