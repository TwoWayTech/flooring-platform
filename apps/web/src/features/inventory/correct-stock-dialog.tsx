"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { stockUnit, STOCK_UNIT_LABELS, warehousesOf, type Location, type Product, type Roll } from "@workspace/shared";
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
import { Textarea } from "@workspace/ui/components/textarea";
import { Field } from "@/components/field";
import { WarehouseSelect } from "@/components/warehouse-select";
import { api } from "@/lib/api";

/**
 * Correct stock count (plan A-1): the Owner's one way to change stock outside a sale, a receipt or
 * a transfer. It takes what was counted, and a reason, and the store audits the difference. There
 * is no page and no queue, because the Adjustments page is switched off.
 */
export function CorrectStockDialog({
  product,
  roll,
  locations,
  onClose,
}: {
  product: Product;
  /** Set when correcting one roll; otherwise a warehouse is chosen. */
  roll?: Roll;
  locations: Location[];
  onClose: () => void;
}) {
  const warehouses = warehousesOf(locations);
  const [locationId, setLocationId] = useState(warehouses[0]?.id ?? "");
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const unit = STOCK_UNIT_LABELS[stockUnit(product) ?? "each"];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d+(\.\d{1,2})?$/.test(counted.trim())) {
      setError(`Enter what was counted, in ${unit}.`);
      document.getElementById("correct-counted")?.focus();
      return;
    }
    if (reason.trim().length < 3) {
      setError("Say why the count is being corrected.");
      document.getElementById("correct-reason")?.focus();
      return;
    }
    setPending(true);
    try {
      const done = await api.correctStockCount({
        productId: product.id,
        rollId: roll?.id ?? null,
        locationId: roll?.locationId ?? locationId,
        counted: counted.trim(),
        reason: reason.trim(),
      });
      toast.success(`Stock count corrected (${done.number})`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not saved. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Correct stock count</DialogTitle>
            <DialogDescription>
              {roll ? `Roll ${roll.rollNumber}` : product.name}. Sales, receipts and transfers change stock on their
              own; use this only when a physical count disagrees. The change is audited.
            </DialogDescription>
          </DialogHeader>
          {roll ? null : (
            <Field id="correct-location" label="Warehouse">
              <WarehouseSelect
                id="correct-location"
                label="Warehouse"
                className="w-full"
                locations={warehouses}
                value={locationId}
                onChange={setLocationId}
              />
            </Field>
          )}
          <Field id="correct-counted" label={`Counted (${unit})`}>
            <Input
              id="correct-counted"
              inputMode="decimal"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              className="w-32 tabular-nums"
            />
          </Field>
          <Field id="correct-reason" label="Reason">
            <Textarea id="correct-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {error ? (
            <p role="alert" className="text-danger-ink text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Correct stock count
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
