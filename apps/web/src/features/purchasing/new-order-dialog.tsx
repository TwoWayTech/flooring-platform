"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  addDays,
  dec,
  defaultWarehouse,
  formatNumber,
  poTotal,
  roundMoney,
  UNIT_LABELS,
  UNIT_SINGULAR,
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
import { Num } from "@workspace/ui/components/num";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { Field } from "@/components/field";
import { AreaQuantityInput } from "@/components/quantity/area-quantity-input";
import { CartonHint } from "@/components/quantity/carton-hint";
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

/** A line being ordered, with its product for the carton hint and roll width. */
interface DraftLine {
  line: PoLine;
  product: Product;
}

/**
 * New purchase order (spec D1): one supplier, one warehouse, lines from that supplier's catalog.
 * Area goods are ordered in sq ft with their cartons or roll length shown next to it (spec A1);
 * typing cartons converts, and partial cartons round up. Long names wrap to two lines then truncate with a tooltip; the lines scroll inside
 * their own box with a sticky header and totals, so the page never overflows. Save as draft or
 * place the order.
 */
export function NewOrderDialog({ open, onOpenChange, suppliers, products, locations }: NewOrderDialogProps) {
  const { user } = useWorkspace();
  const numbers = useNumberSettings();
  const [locationId, setLocationId] = useState(defaultWarehouse(locations, user)?.id ?? "");
  const stocked = suppliers.filter((s) => products.some((p) => p.supplierId === s.id && p.category !== "service"));
  const [supplierId, setSupplierId] = useState(stocked[0]?.id ?? "");
  const [drafts, setDrafts] = useState<DraftLine[]>([]);
  const [pending, setPending] = useState(false);
  const offered = products.filter((p) => p.supplierId === supplierId && p.category !== "service");
  const lines = drafts.map((d) => d.line);
  const fmt = (v: string) => formatNumber(v, "quantity", numbers);

  function add(p: Product) {
    setDrafts((ds) => [
      ...ds,
      {
        product: p,
        line: {
          id: `pol-${crypto.randomUUID().slice(0, 8)}`,
          productId: p.id,
          description: `${p.brand} ${p.name}`,
          quantity: p.sqFtPerCarton ?? (p.unit === "sq_ft" ? "100" : "10"),
          unit: p.unit,
          unitCost: p.cost,
          ...(p.sqFtPerCarton ? { sqFtPerCarton: p.sqFtPerCarton } : {}),
        },
      },
    ]);
  }

  const update = (i: number, patch: Partial<DraftLine> | ((d: DraftLine) => DraftLine)) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? (typeof patch === "function" ? patch(d) : { ...d, ...patch }) : d)));

  /** The roll length a broadloom area needs, in words. */
  function rollLength(d: DraftLine): string {
    const ft = dec(d.line.quantity || "0")
      .div(d.product.widthFt!)
      .toDecimalPlaces(1);
    return `${fmt(ft.toString())} ft of a ${d.product.widthFt} ft roll`;
  }

  async function submit(asDraft: boolean) {
    setPending(true);
    try {
      const po = await api.createPurchaseOrder({
        supplierId,
        expectedAt: addDays(api.today(), LEAD_DAYS),
        locationId,
        lines,
        asDraft,
      });
      toast.success(asDraft ? `Draft ${po.number} saved` : `Purchase order ${po.number} created`);
      setDrafts([]);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The purchase order was not created.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface flex max-h-[90dvh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>
            Order from one supplier into one warehouse. Area goods are ordered in sq ft; type 22c for 22 cartons.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="po-supplier" label="Supplier">
            <Select
              value={supplierId}
              onValueChange={(v) => {
                setSupplierId(v);
                setDrafts([]);
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
        </div>
        <div
          role="region"
          aria-label="Order lines"
          tabIndex={0}
          className="border-hairline min-h-0 flex-1 overflow-auto rounded-md border"
        >
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-raised text-muted-foreground sticky top-0 z-10 text-xs">
              <tr>
                <th scope="col" className="h-9 px-3 text-left font-medium">
                  Item
                </th>
                <th scope="col" className="px-3 text-right font-medium">
                  Order
                </th>
                <th scope="col" className="px-3 text-right font-medium">
                  Cost
                </th>
                <th scope="col" className="px-3 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="w-10">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {drafts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted-foreground h-16 px-3 text-center">
                    Add products from this supplier.
                  </td>
                </tr>
              ) : null}
              {drafts.map((d, i) => {
                const line = lines[i]!;
                return (
                  <tr key={line.id} className="border-hairline border-t align-top">
                    <td className="max-w-64 px-3 py-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="line-clamp-2 break-words">
                            {line.description}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{line.description}</TooltipContent>
                      </Tooltip>
                      <CartonHint
                        quantity={line.quantity}
                        sqFtPerCarton={line.sqFtPerCarton}
                        className="mt-0.5 block"
                      />
                      {d.product.widthFt ? (
                        <span className="text-muted-foreground mt-0.5 block text-xs">{rollLength(d)}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <AreaQuantityInput
                          aria-label={`${line.description} ${line.unit === "sq_ft" ? "area in sq ft" : "quantity"}`}
                          value={line.quantity}
                          sqFtPerCarton={line.sqFtPerCarton}
                          onChange={(quantity) => update(i, (x) => ({ ...x, line: { ...x.line, quantity } }))}
                          className="h-8 w-24 text-right tabular-nums"
                        />
                        <span className="text-muted-foreground w-12 text-left text-xs">{UNIT_LABELS[line.unit]}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Num kind="unitCost" value={line.unitCost} /> per {UNIT_SINGULAR[line.unit]}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      <Num kind="money" value={roundMoney(dec(line.quantity || "0").times(line.unitCost)).toString()} />
                    </td>
                    <td className="py-1.5 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${line.description}`}
                        onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {drafts.length > 0 ? (
              <tfoot className="bg-raised sticky bottom-0 z-10">
                <tr className="border-hairline border-t font-semibold">
                  <td colSpan={3} className="h-10 px-3">
                    Total
                  </td>
                  <td className="px-3 text-right">
                    <Num kind="money" value={poTotal(lines)} />
                  </td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <ProductPicker label="Add product" products={offered} onPick={add} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending || drafts.length === 0}
            onClick={() => void submit(true)}
          >
            Save as draft
          </Button>
          <Button type="button" disabled={pending || drafts.length === 0} onClick={() => void submit(false)}>
            Create purchase order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
