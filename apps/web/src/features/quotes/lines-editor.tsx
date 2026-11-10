"use client";

import { Trash2 } from "lucide-react";
import {
  lineAmount,
  quantityKind,
  stockUnit,
  TAX_CATEGORY_LABELS,
  UNIT_LABELS,
  UNIT_SINGULAR,
  type DocLine,
  type DocumentTotals,
  type Location,
  type Product,
  type Room,
  type SaleStock,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { LineStock } from "./line-stock";
import { ProductPicker } from "./product-picker";
import { RollPicker, type RollStock } from "./roll-picker";
import { AreaQuantityInput } from "@/components/quantity/area-quantity-input";
import { CartonHint } from "@/components/quantity/carton-hint";
import { ScrollRegion } from "@/components/scroll-region";

interface LinesEditorProps {
  lines: DocLine[];
  rooms: Room[];
  products: Product[];
  totals: DocumentTotals;
  editable: boolean;
  onAdd: (product: Product) => void;
  onChange: (line: DocLine) => void;
  onRemove: (lineId: string) => void;
  /** Full validation's message when the quote has no lines (spec B1). */
  error?: string;
  /** Waste % is internal (spec B3): without sales.waste.view the column is gone and defaults apply. */
  showWaste: boolean;
  /** Rolls at the quote's warehouse, for the roll picker on carpet lines (spec C2). */
  rollStock?: RollStock;
  /** Availability per line (spec A2). */
  stock: SaleStock;
  locationId: string;
  locations: readonly Location[];
  canTransfer: boolean;
  onTransfer: (line: DocLine, product: Product) => void;
}

/** The roll picker for a line whose product comes off a roll; nothing for boxed goods. */
function RollLine({
  line,
  products,
  stock,
  onChange,
}: {
  line: DocLine;
  products: readonly Product[];
  stock: RollStock;
  onChange: (line: DocLine) => void;
}) {
  const product = products.find((p) => p.id === line.productId);
  if (!product || stockUnit(product) !== "ft") return null;
  return (
    <RollPicker line={line} product={product} stock={stock} onChange={(rollId) => onChange({ ...line, rollId })} />
  );
}

/** Which rooms a line is measured from, in words. */
function roomsNote(line: DocLine, rooms: readonly Room[]): string | null {
  if (!line.roomIds?.length) return null;
  if (line.roomIds.length === rooms.length && rooms.length > 1) return "All rooms";
  return rooms
    .filter((r) => line.roomIds!.includes(r.id))
    .map((r) => r.name)
    .join(", ");
}

/**
 * Quote lines (spec "Quote builder", A1, B3): materials in sq ft with a carton hint and a waste % (shown only
 * with sales.waste.view; the quantity already includes it), labor and services. Lines measured from rooms update when a room changes; others take a typed quantity.
 */
export function LinesEditor({
  lines,
  rooms,
  products,
  totals,
  editable,
  onAdd,
  onChange,
  onRemove,
  error,
  showWaste,
  rollStock,
  stock,
  locationId,
  locations,
  canTransfer,
  onTransfer,
}: LinesEditorProps) {
  const goods = products.filter((p) => p.category !== "service");
  const services = products.filter((p) => p.category === "service");
  return (
    <div className="flex flex-col gap-3">
      <ScrollRegion label="Quote lines">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="text-muted-foreground text-xs">
            <tr className="border-hairline border-b">
              <th scope="col" className="h-9 pr-3 text-left font-medium">
                Item
              </th>
              <th scope="col" className="px-3 text-right font-medium">
                Quantity
              </th>
              {showWaste ? (
                <th scope="col" className="px-3 text-right font-medium">
                  Waste
                </th>
              ) : null}
              <th scope="col" className="px-3 text-right font-medium">
                Price
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
            {lines.map((line) => {
              const linked = roomsNote(line, rooms);
              const product = products.find((p) => p.id === line.productId);
              const taxable = totals.lines.find((t) => t.id === line.id)?.taxable;
              return (
                <tr key={line.id} className="border-hairline border-b align-top">
                  <td className="py-2 pr-3">
                    <span className="block font-medium">{line.description}</span>
                    <span className="text-muted-foreground text-xs">
                      {TAX_CATEGORY_LABELS[line.category]}
                      {taxable ? ", taxed" : ", not taxed"}
                      {linked ? `, from ${linked}` : ""}
                    </span>
                    {editable && rollStock && line.category === "material" ? (
                      <RollLine line={line} products={products} stock={rollStock} onChange={onChange} />
                    ) : null}
                    {editable && product ? (
                      <LineStock
                        line={line}
                        product={product}
                        locationId={locationId}
                        locations={locations}
                        stock={stock}
                        canTransfer={canTransfer}
                        onChange={onChange}
                        onTransfer={onTransfer}
                      />
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {linked || !editable ? (
                      <Num kind={quantityKind(line.unit)} value={line.quantity} unit={UNIT_LABELS[line.unit]} />
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <AreaQuantityInput
                          aria-label={`${line.description} quantity`}
                          value={line.quantity}
                          sqFtPerCarton={line.sqFtPerCarton}
                          onChange={(quantity) => onChange({ ...line, quantity })}
                          className="h-8 w-24 text-right tabular-nums"
                        />
                        <span className="text-muted-foreground text-xs">{UNIT_LABELS[line.unit]}</span>
                      </span>
                    )}
                    <CartonHint quantity={line.quantity} sqFtPerCarton={line.sqFtPerCarton} className="block" />
                  </td>
                  {showWaste ? (
                    <td className="px-3 py-2 text-right">
                      {line.category === "material" && line.unit !== "each" && editable ? (
                        <span className="inline-flex items-center gap-1">
                          <Input
                            aria-label={`${line.description} waste percent`}
                            inputMode="decimal"
                            defaultValue={line.wastePct ?? "0"}
                            key={line.wastePct}
                            onBlur={(e) =>
                              onChange({ ...line, wastePct: e.target.value.replace(/[^\d.]/g, "") || "0" })
                            }
                            className="h-8 w-14 text-right tabular-nums"
                          />
                          <span className="text-muted-foreground text-xs">%</span>
                        </span>
                      ) : line.wastePct ? (
                        <Num kind="percent" value={line.wastePct} />
                      ) : null}
                    </td>
                  ) : null}
                  <td className="px-3 py-2 text-right">
                    <Num kind="money" value={line.unitPrice} />
                    <span className="text-muted-foreground block text-xs">per {UNIT_SINGULAR[line.unit]}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    <Num kind="money" value={lineAmount(line)} />
                  </td>
                  <td className="py-1.5 text-right">
                    {editable ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${line.description}`}
                        onClick={() => onRemove(line.id)}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {lines.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center">No lines yet. Add a product, then labor.</p>
        ) : null}
      </ScrollRegion>
      {editable ? (
        <div className="flex flex-wrap gap-2">
          <ProductPicker
            id="quote-add-product"
            label="Add product"
            products={goods}
            onPick={onAdd}
            stock={stock}
            locationId={locationId}
          />
          <ProductPicker label="Add labor or service" products={services} onPick={onAdd} />
        </div>
      ) : null}
      {error ? (
        <p id="quote-add-product-error" className="text-danger-ink text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
