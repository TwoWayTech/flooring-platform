"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  addDays,
  contactsOf,
  dec,
  defaultWarehouse,
  editableDecimal,
  formatNumber,
  poTotal,
  roundMoney,
  UNIT_LABELS,
  UNIT_SINGULAR,
  type Location,
  type PoLine,
  type Product,
  type Supplier,
  type SupplierContact,
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
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { Field } from "@/components/field";
import { AreaQuantityInput } from "@/components/quantity/area-quantity-input";
import { CartonHint } from "@/components/quantity/carton-hint";
import { ProductPicker } from "@/features/quotes/product-picker";
import { api } from "@/lib/api";
import { WarehouseSelect } from "@/components/warehouse-select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { ContactPicker } from "./contact-picker";
import { SupplierPicker } from "./supplier-picker";

/** Days a supplier usually takes to deliver, for the expected date. */
const LEAD_DAYS = 10;

interface NewOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: Supplier[];
  contacts: SupplierContact[];
  products: Product[];
  locations: Location[];
}

/** A line being ordered, with its product for the carton hint and roll width. */
interface DraftLine {
  line: PoLine;
  product: Product;
}

/**
 * New purchase order (spec B2): find or add the supplier and its sales rep, then lines in sq ft
 * with cartons beside them, a cost per sq ft and a warehouse per line. Anything added here is
 * saved to the directory at once. Long names wrap to two lines then truncate with a tooltip, and
 * the dialog scrolls as a whole on a short window, so the lines keep their height and scroll only
 * sideways (click-through #22). An order with no email on file is marked as phoned in.
 */
export function NewOrderDialog({ open, onOpenChange, suppliers, contacts, products, locations }: NewOrderDialogProps) {
  const { user } = useWorkspace();
  const numbers = useNumberSettings();
  const [locationId, setLocationId] = useState(defaultWarehouse(locations, user)?.id ?? "");
  const [supplierId, setSupplierId] = useState("");
  const [contactId, setContactId] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [drafts, setDrafts] = useState<DraftLine[]>([]);
  const [pending, setPending] = useState(false);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const contact = contacts.find((c) => c.id === contactId);
  const goods = products.filter((p) => p.category !== "service");
  const own = goods.filter((p) => p.supplierId === supplierId);
  const offered = own.length ? own : goods;
  const lines = drafts.map((d) => d.line);
  const fmt = (v: string) => formatNumber(v, "quantity", numbers);
  const hasEmail = !!(contact?.email || supplier?.email);

  function chooseSupplier(next: Supplier) {
    setSupplierId(next.id);
    setContactId(contactsOf(next.id, contacts)[0]?.id ?? "");
    setDrafts([]);
  }

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
          unitCost: editableDecimal(p.cost),
          ...(p.sqFtPerCarton ? { sqFtPerCarton: p.sqFtPerCarton } : {}),
        },
      },
    ]);
  }

  const update = (i: number, patch: Partial<PoLine>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, line: { ...d.line, ...patch } } : d)));

  /** The roll length a broadloom area needs, in words. */
  function rollLength(d: DraftLine): string {
    const ft = dec(d.line.quantity || "0")
      .div(d.product.widthFt!)
      .toDecimalPlaces(1);
    return `${fmt(ft.toString())} ft of a ${fmt(d.product.widthFt!)} ft roll`;
  }

  async function submit(asDraft: boolean) {
    setPending(true);
    try {
      const po = await api.createPurchaseOrder({
        supplierId,
        contactId: contactId || null,
        supplierRef,
        expectedAt: addDays(api.today(), LEAD_DAYS),
        locationId,
        lines,
        asDraft,
        placedVia: asDraft ? null : hasEmail ? "email" : "phone",
      });
      toast.success(asDraft ? `Draft ${po.number} saved` : `Purchase order ${po.number} created`);
      setDrafts([]);
      setSupplierId("");
      setContactId("");
      setSupplierRef("");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The purchase order was not created.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>
            Find or add the supplier and sales rep. Area goods are ordered in sq ft; type 22c for 22 cartons.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="po-supplier" label="Supplier">
            <SupplierPicker
              id="po-supplier"
              suppliers={suppliers}
              contacts={contacts}
              value={supplierId}
              onSelect={chooseSupplier}
            />
          </Field>
          <Field id="po-contact" label="Sales rep">
            <ContactPicker
              id="po-contact"
              supplier={supplier}
              contacts={contacts}
              value={contactId}
              onChange={setContactId}
            />
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
          <Field id="po-ref" label="Supplier's order number (optional)">
            <Input id="po-ref" value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
          </Field>
        </div>
        <div
          role="region"
          aria-label="Order lines"
          tabIndex={0}
          className="border-hairline shrink-0 overflow-x-auto rounded-md border"
        >
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="bg-raised text-muted-foreground text-xs">
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
                <th scope="col" className="px-3 text-left font-medium">
                  Receive into
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
                  <td colSpan={6} className="text-muted-foreground h-16 px-3 text-center">
                    {supplier ? "Add products below." : "Choose a supplier, then add products."}
                  </td>
                </tr>
              ) : null}
              {drafts.map((d, i) => {
                const line = d.line;
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
                          onChange={(quantity) => update(i, { quantity })}
                          className="h-8 w-24 text-right tabular-nums"
                        />
                        <span className="text-muted-foreground w-12 text-left text-xs">{UNIT_LABELS[line.unit]}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <Input
                          aria-label={`${line.description} cost per ${UNIT_SINGULAR[line.unit]}`}
                          inputMode="decimal"
                          value={line.unitCost}
                          onChange={(e) => update(i, { unitCost: e.target.value.replace(/[^\d.]/g, "") })}
                          className="h-8 w-20 text-right tabular-nums"
                        />
                        <span className="text-muted-foreground text-xs">per {UNIT_SINGULAR[line.unit]}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <WarehouseSelect
                        label={`Receive ${line.description} into`}
                        className="h-8 w-44"
                        locations={locations}
                        value={line.locationId ?? locationId}
                        onChange={(id) => update(i, { locationId: id === locationId ? undefined : id })}
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      <Num
                        kind="money"
                        value={roundMoney(dec(line.quantity || "0").times(line.unitCost || "0")).toString()}
                      />
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
              <tfoot className="bg-raised">
                <tr className="border-hairline border-t font-semibold">
                  <td colSpan={4} className="h-10 px-3">
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
        {supplier ? (
          <>
            <ProductPicker label="Add product" products={offered} onPick={add} />
            {own.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                {supplier.name} has no catalog of its own yet, so every product is offered.
              </p>
            ) : null}
          </>
        ) : null}
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
            {hasEmail ? "Create purchase order" : "Mark as ordered by phone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
