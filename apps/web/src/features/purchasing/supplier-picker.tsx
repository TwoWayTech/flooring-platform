"use client";

import { ChevronsUpDown, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  CONTACT_ROLE_LABELS,
  findSimilarSupplier,
  searchSuppliers,
  supplierProfileGaps,
  SUPPLIER_TYPE_LABELS,
  type Supplier,
  type SupplierContact,
} from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@workspace/ui/components/command";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";

/** How many matches the picker lists before asking for more letters. */
const SHOWN = 8;

/** Adds what was typed as a new supplier: the name, saved at once (spec B2). */
function QuickAdd({
  typed,
  suppliers,
  onUse,
  onCancel,
}: {
  typed: string;
  suppliers: readonly Supplier[];
  onUse: (supplier: Supplier) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(typed);
  const [error, setError] = useState<string | null>(null);
  const similar = findSimilarSupplier(name, suppliers);

  async function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!name.trim()) return setError("Enter the supplier's name.");
    try {
      const supplier = await api.saveSupplier({ name, from: "order" });
      toast.success(`${supplier.name} added. Complete the profile from the directory.`);
      onUse(supplier);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The supplier was not added.");
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 p-3" noValidate aria-label="New supplier">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quick-supplier">Name</Label>
        <Input id="quick-supplier" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        {error ? <p className="text-danger-ink text-xs">{error}</p> : null}
      </div>
      {similar ? (
        <p className="text-warning-ink flex flex-wrap items-center gap-2 text-xs">
          Did you mean {similar.name}?
          <Button type="button" size="sm" variant="outline" onClick={() => onUse(similar)}>
            Use this one
          </Button>
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" size="sm">
          {similar ? "Add anyway" : "Add supplier"}
        </Button>
      </div>
    </form>
  );
}

/**
 * The supplier picker on a purchase order (spec B2): searches by name, account number, phone or
 * email and by any contact's details. The last option adds what was typed; it is saved to the
 * directory at once, marked profile incomplete, and a look-alike name only warns.
 */
export function SupplierPicker({
  id,
  suppliers,
  contacts,
  value,
  onSelect,
}: {
  id: string;
  suppliers: readonly Supplier[];
  contacts: readonly SupplierContact[];
  value: string;
  onSelect: (supplier: Supplier) => void;
}) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const selected = suppliers.find((s) => s.id === value);
  const found = searchSuppliers(query, suppliers, contacts);

  function choose(supplier: Supplier) {
    onSelect(supplier);
    setOpen(false);
    setAdding(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setAdding(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{selected ? selected.name : "Choose a supplier"}</span>
          <ChevronsUpDown aria-hidden="true" className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="bg-surface w-[min(26rem,calc(100vw-2rem))] p-0">
        {adding ? (
          <QuickAdd typed={query} suppliers={suppliers} onUse={choose} onCancel={() => setAdding(false)} />
        ) : (
          <Command shouldFilter={false} label="Search suppliers">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Name, contact, phone or email"
              aria-label="Search suppliers"
            />
            <CommandList className="max-h-80">
              <CommandGroup>
                {found.slice(0, SHOWN).map(({ supplier, via }) => (
                  <CommandItem
                    key={supplier.id}
                    value={supplier.id}
                    onSelect={() => choose(supplier)}
                    className="flex-col items-start gap-0.5"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="font-medium">{supplier.name}</span>
                      <span className="text-muted-foreground text-xs">{SUPPLIER_TYPE_LABELS[supplier.type]}</span>
                      {supplierProfileGaps(supplier, [...contacts]).length ? (
                        <Badge variant="outline" className="ml-auto">
                          Profile incomplete
                        </Badge>
                      ) : null}
                    </span>
                    {via ? (
                      <span className="text-muted-foreground text-xs">
                        {via.name}, {CONTACT_ROLE_LABELS[via.role]}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
                {found.length > SHOWN ? (
                  <p className="text-muted-foreground px-2 py-1.5 text-xs">
                    {found.length - SHOWN} more. Keep typing to narrow the list.
                  </p>
                ) : null}
                {query.trim() && can("purchasing.supplier.create") ? (
                  <CommandItem value="__add" onSelect={() => setAdding(true)}>
                    <UserPlus />
                    Add “{query.trim()}” as a new supplier
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
