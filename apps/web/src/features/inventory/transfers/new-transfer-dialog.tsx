"use client";

import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  boxedOnHand,
  defaultWarehouse,
  isBoxed,
  rollsAt,
  validateTransfer,
  warehousesOf,
  type Location,
  type Product,
  type Roll,
  type StockMovement,
  type TransferInput,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Textarea } from "@workspace/ui/components/textarea";
import { Field } from "@/components/field";
import { ProductPicker } from "@/features/quotes/product-picker";
import { AreaQuantityInput } from "@/components/quantity/area-quantity-input";
import { CartonHint } from "@/components/quantity/carton-hint";
import { WarehouseSelect } from "@/components/warehouse-select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";

interface NewTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: Location[];
  products: Product[];
  rolls: Roll[];
  movements: StockMovement[];
  /** Prefill from a quote line that is short (spec A2). */
  preset?: TransferPreset;
}

/** What the quote builder fills in when a line is short (spec A2). */
export interface TransferPreset {
  fromId: string;
  toId: string;
  line: TransferInput["lines"][number] | null;
}

/**
 * Starts a transfer (spec A1): pick the two warehouses, then whole rolls or quantities of boxed
 * goods held at the sender. The stock leaves the sender when the transfer is created.
 */
export function NewTransferDialog({
  open,
  onOpenChange,
  locations,
  products,
  rolls,
  movements,
  preset,
}: NewTransferDialogProps) {
  const { user } = useWorkspace();
  const warehouses = warehousesOf(locations);
  const start = defaultWarehouse(locations, user);
  const [fromId, setFromId] = useState(preset?.fromId ?? start?.id ?? "");
  const [toId, setToId] = useState(preset?.toId ?? warehouses.find((w) => w.id !== start?.id)?.id ?? "");
  const [lines, setLines] = useState<TransferInput["lines"]>(preset?.line ? [preset.line] : []);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const boxed = products.filter((p) => isBoxed(p) && boxedOnHand(movements, p.id, fromId).gt(0));
  const movable = rollsAt(rolls, fromId).filter((r) => !r.transferId && !lines.some((l) => l.rollId === r.id));
  const nameOf = (line: TransferInput["lines"][number]) =>
    line.rollId
      ? `Roll ${rolls.find((r) => r.id === line.rollId)?.rollNumber ?? ""}`
      : (products.find((p) => p.id === line.productId)?.name ?? "");

  const packOf = (line: TransferInput["lines"][number]) => products.find((p) => p.id === line.productId)?.sqFtPerCarton;

  function changeFrom(id: string) {
    setFromId(id);
    setLines([]);
    if (id === toId) setToId(warehouses.find((w) => w.id !== id)?.id ?? "");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = { fromId, toId, lines, note };
    const problem = validateTransfer(input, locations, rolls, movements, products);
    if (problem) return setError(problem);
    setSaving(true);
    try {
      const transfer = await api.createTransfer(input);
      toast.success(`${transfer.number} is on its way`);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The transfer was not started.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>New transfer</DialogTitle>
            <DialogDescription>
              The stock leaves the first warehouse now and arrives when the second one receives it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="transfer-from" label="From">
              <WarehouseSelect
                id="transfer-from"
                label="From"
                locations={locations}
                value={fromId}
                onChange={changeFrom}
                className="w-full"
              />
            </Field>
            <Field id="transfer-to" label="To">
              <WarehouseSelect
                id="transfer-to"
                label="To"
                locations={locations.filter((l) => l.id !== fromId)}
                value={toId}
                onChange={setToId}
                className="w-full"
              />
            </Field>
          </div>
          {lines.length > 0 ? (
            <ul className="flex flex-col gap-2" aria-label="Items to transfer">
              {lines.map((line, i) => (
                <li key={line.rollId ?? line.productId} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{nameOf(line)}</span>
                  {line.rollId ? (
                    <span className="text-muted-foreground text-xs">whole roll</span>
                  ) : (
                    <span className="flex flex-col items-end">
                      <AreaQuantityInput
                        aria-label={`${nameOf(line)} quantity`}
                        value={line.quantity}
                        sqFtPerCarton={packOf(line)}
                        onChange={(quantity) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, quantity } : l)))}
                        className="h-8 w-24 text-right tabular-nums"
                      />
                      <CartonHint quantity={line.quantity} sqFtPerCarton={packOf(line)} compact />
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${nameOf(line)}`}
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Add boxed goods</span>
              <ProductPicker
                label="Add boxed goods"
                products={boxed.filter((p) => !lines.some((l) => !l.rollId && l.productId === p.id))}
                stock={{ rolls, movements, reservations: [] }}
                locationId={fromId}
                onPick={(p) =>
                  setLines((ls) => [...ls, { productId: p.id, rollId: null, quantity: p.sqFtPerCarton ?? "1" }])
                }
              />
            </div>
            <Field id="transfer-add-roll" label="Add a roll">
              <Select
                value=""
                onValueChange={(id) => {
                  const roll = rolls.find((r) => r.id === id)!;
                  setLines((ls) => [
                    ...ls,
                    { productId: roll.productId, rollId: roll.id, quantity: roll.remainingLengthFt },
                  ]);
                }}
              >
                <SelectTrigger id="transfer-add-roll" className="w-full">
                  <SelectValue placeholder="Choose a roll" />
                </SelectTrigger>
                <SelectContent>
                  {movable.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.rollNumber}, {r.remainingLengthFt} ft
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field id="transfer-note" label="Note (optional)">
            <Textarea id="transfer-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </Field>
          {error ? (
            <p role="alert" className="text-danger-ink text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || lines.length === 0}>
              Start transfer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
