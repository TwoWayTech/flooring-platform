"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Product } from "@workspace/shared";
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
import { CATEGORY_LABELS } from "@/lib/labels";

/** A searchable list of products or services that adds the chosen one to the quote. */
export function ProductPicker({
  id,
  label,
  products,
  onPick,
}: {
  /** Lets a validation error focus the picker. */
  id?: string;
  label: string;
  products: Product[];
  onPick: (product: Product) => void;
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
                  .map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.name} ${p.brand} ${p.sku}`}
                      onSelect={() => {
                        onPick(p);
                        setOpen(false);
                      }}
                    >
                      <Swatch color={p.swatch} label={p.colorName || p.name} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <Num kind="money" value={p.price} className="text-muted-foreground text-xs" />
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
