"use client";

import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  addDays,
  defaultWarehouse,
  poTotal,
  UNIT_LABELS,
  type Location,
  type PoLine,
  type Product,
  type Supplier,
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
import { Num } from "@workspace/ui/components/num";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Field } from "@/components/field";
import { ProductPicker } from "@/features/quotes/product-picker";
import { api } from "@/lib/api";
import { WarehouseSelect } from "@/components/warehouse-select";
import { useWorkspace } from "@/components/workspace/workspace-context";

/** Days a supplier usually takes to deliver, for the expected date. */
const LEAD_DAYS = 10;

interface NewOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: Supplier[];
  products: Product[];
  locations: Location[];
}

/** Orders goods from one supplier into one warehouse: pick lines from that supplier's catalog and quantities. */
export function NewOrderDialog({ open, onOpenChange, suppliers, products, locations }: NewOrderDialogProps) {
  const { user } = useWorkspace();
  const [locationId, setLocationId] = useState(defaultWarehouse(locations, user)?.id ?? "");
  const stocked = suppliers.filter((s) => products.some((p) => p.supplierId === s.id && p.category !== "service"));
  const [supplierId, setSupplierId] = useState(stocked[0]?.id ?? "");
  const [lines, setLines] = useState<PoLine[]>([]);
  const offered = products.filter((p) => p.supplierId === supplierId && p.category !== "service");

  function add(p: Product) {
    setLines((ls) => [
      ...ls,
      {
        id: `pol-${crypto.randomUUID().slice(0, 8)}`,
        productId: p.id,
        description: `${p.brand} ${p.name}`,
        quantity: "10",
        unit: p.unit,
        unitCost: p.cost,
      },
    ]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const po = await api.createPurchaseOrder({
        supplierId,
        expectedAt: addDays(api.today(), LEAD_DAYS),
        locationId,
        lines,
      });
      toast.success(`Purchase order ${po.number} created`);
      setLines([]);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The purchase order was not created.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New purchase order</DialogTitle>
            <DialogDescription>Order goods from one supplier. It is sent to them when you create it.</DialogDescription>
          </DialogHeader>
          <Field id="po-supplier" label="Supplier">
            <Select
              value={supplierId}
              onValueChange={(v) => {
                setSupplierId(v);
                setLines([]);
              }}
            >
              <SelectTrigger id="po-supplier" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stocked.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="po-location" label="Receive into">
            <WarehouseSelect
              id="po-location"
              label="Receive into"
              className="w-full"
              locations={locations}
              value={locationId}
              onChange={setLocationId}
            />
          </Field>
          <ul className="flex flex-col gap-2">
            {lines.map((line, i) => (
              <li key={line.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{line.description}</span>
                <Input
                  aria-label={`${line.description} quantity`}
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((ls) =>
                      ls.map((l, j) =>
                        j === i ? { ...l, quantity: e.target.value.replace(/[^\d.]/g, "") || "0" } : l,
                      ),
                    )
                  }
                  className="h-8 w-20 text-right tabular-nums"
                />
                <span className="text-muted-foreground w-14 text-xs">{UNIT_LABELS[line.unit]}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${line.description}`}
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3">
            <ProductPicker label="Add product" products={offered} onPick={add} />
            {lines.length > 0 ? (
              <span className="text-sm font-semibold">
                Total <Num kind="money" value={poTotal(lines)} />
              </span>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={lines.length === 0}>
              Create purchase order
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
