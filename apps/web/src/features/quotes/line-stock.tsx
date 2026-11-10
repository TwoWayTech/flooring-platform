"use client";

import { ArrowLeftRight } from "lucide-react";
import {
  availableToSell,
  dec,
  featureOn,
  lineWarehouse,
  locationName,
  stockAcrossWarehouses,
  stockUnit,
  type DocLine,
  type Location,
  type Product,
  type SaleStock,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { CartonHint } from "@/components/quantity/carton-hint";

interface LineStockProps {
  line: DocLine;
  product: Product;
  /** The quote's own warehouse, "Fulfilled from". */
  locationId: string;
  locations: readonly Location[];
  stock: SaleStock;
  /** Whether the person may start a transfer; without it the button is hidden. */
  canTransfer: boolean;
  onChange: (line: DocLine) => void;
  onTransfer: (line: DocLine, product: Product) => void;
}

/**
 * Availability under a product line (spec A2): what the line's warehouse can still promise, in sq
 * ft with cartons beside it. When that is not enough, it warns and offers the two ways out: take
 * this line from another warehouse, or start a transfer.
 */
export function LineStock({
  line,
  product,
  locationId,
  locations,
  stock,
  canTransfer,
  onChange,
  onTransfer,
}: LineStockProps) {
  if (!featureOn("sales.quote-availability") || !stockUnit(product)) return null;
  const from = lineWarehouse(line, locationId);
  const available = availableToSell(product, stock, from);
  if (!available) return null;
  const unit = product.unit === "sq_ft" ? "sq ft" : "each";
  const short = dec(line.quantity).gt(available);
  const others = stockAcrossWarehouses(product, stock, locations).filter((w) => w.location.id !== from);
  const name = locationName([...locations], from);
  return (
    <span className="mt-1 flex flex-col gap-1 text-xs">
      <span className={short ? "text-warning-ink" : "text-muted-foreground"}>
        {short ? "Only " : "Available at "}
        {short ? <Num kind="quantity" value={available.toString()} unit={unit} /> : `${name}: `}
        {short ? ` free at ${name}` : <Num kind="quantity" value={available.toString()} unit={unit} />}{" "}
        <CartonHint quantity={available.toString()} sqFtPerCarton={product.sqFtPerCarton} compact />
      </span>
      {short || line.locationId ? (
        <span className="flex flex-wrap items-center gap-2">
          <Select
            value={from}
            onValueChange={(id) => {
              const moved: DocLine = { ...line, locationId: id };
              if (id === locationId) delete moved.locationId;
              onChange(moved);
            }}
          >
            <SelectTrigger className="h-8 w-full max-w-72 text-xs" aria-label={`Warehouse for ${line.description}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={from}>Ship from {name}</SelectItem>
              {others.map((w) => (
                <SelectItem key={w.location.id} value={w.location.id}>
                  Ship from {w.location.name}, <Num kind="quantity" value={w.available.toString()} unit={unit} /> free
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {short && canTransfer ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onTransfer(line, product)}>
              <ArrowLeftRight />
              Create a transfer
            </Button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
