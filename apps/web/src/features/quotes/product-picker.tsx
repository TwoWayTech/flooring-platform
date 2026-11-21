"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { availableToSell, featureOn, UNIT_SINGULAR, type Product, type SaleStock } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";
import { Num } from "@workspace/ui/components/num";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Swatch } from "@workspace/ui/components/swatch";
import { CartonHint } from "@/components/quantity/carton-hint";
import { CATEGORY_LABELS } from "@workspace/shared";

/**
 * A searchable list of products or services that adds the chosen one to the document. Each result
 * shows brand, SKU and price per unit, and, given stock and a warehouse, what is available there (spec
 * A2), so two colorways with the same name cannot be confused (audit U-19).
 */
export function ProductPicker({
  id,
  label,
  products,
  onPick,
  stock,
  locationId,
}: {
  /** Lets a validation error focus the picker. */
  id?: string;
  label: string;
  products: Product[];
  onPick: (product: Product) => void;
  stock?: SaleStock;
  locationId?: string;
}) {
  const [open, setOpen] = useState(false);
  const groups = [...new Set(products.map((p) => p.category))];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" size="sm">
          <Plus />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder="Search by name, color or brand" />
          <CommandList className="max-h-80">
            <CommandEmpty>No product matches.</CommandEmpty>
            {groups.map((category) => (
              <CommandGroup key={category} heading={CATEGORY_LABELS[category]}>
                {products
                  .filter((p) => p.category === category)
                  .map((p) => {
                    const free =
                      stock && locationId && featureOn("sales.quote-availability")
                        ? availableToSell(p, stock, locationId)
                        : null;
                    return (
                      <CommandItem
                        key={p.id}
                        value={`${p.name} ${p.brand} ${p.sku}`}
                        onSelect={() => {
                          onPick(p);
                          setOpen(false);
                        }}
                      >
                        <Swatch color={p.swatch} label={p.colorName || p.name} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{p.name}</span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {p.category === "service" ? "Service" : `${p.brand}, ${p.sku}`}
                          </span>
                        </span>
                        <span className="text-muted-foreground shrink-0 text-right text-xs">
                          <span className="block">
                            <Num kind="money" value={p.price} /> per {UNIT_SINGULAR[p.unit]}
                          </span>
                          {free ? (
                            <span className="block">
                              <Num
                                kind={p.unit === "each" ? "count" : "quantity"}
                                value={free.toString()}
                                unit={p.unit === "each" ? undefined : "sq ft"}
                              />{" "}
                              available
                              {free.gt(0) ? (
                                <>
                                  {" "}
                                  <CartonHint quantity={free.toString()} sqFtPerCarton={p.sqFtPerCarton} compact />
                                </>
                              ) : null}
                            </span>
                          ) : null}
                        </span>
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
