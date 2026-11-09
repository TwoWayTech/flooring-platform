"use client";

import { useState, type FormEvent } from "react";
import { ChevronsUpDown, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { addressLine, defaultAddress, profileIncomplete, type Customer, type CustomerType } from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@workspace/ui/components/command";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";

const TYPES: Record<CustomerType, string> = { homeowner: "Homeowner", dealer: "Dealer", contractor: "Contractor" };
/** How many matches the picker lists before asking for more letters. */
const SHOWN = 8;

/** Whether a customer matches what was typed: name, contact, phone (digits only) or email. */
function matches(customer: Customer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  return (
    customer.name.toLowerCase().includes(q) ||
    customer.contactName.toLowerCase().includes(q) ||
    customer.email.toLowerCase().includes(q) ||
    (digits.length >= 3 && customer.phone.replace(/\D/g, "").includes(digits))
  );
}

/** The "New, profile incomplete" mark (spec A6). */
export function IncompleteBadge({ customer }: { customer: Customer }) {
  return profileIncomplete(customer) ? <Badge variant="outline">New, profile incomplete</Badge> : null;
}

interface QuickAddProps {
  name: string;
  onCancel: () => void;
  onCreated: (customer: Customer) => void;
}

/** The small inline form behind "Add as a new customer": name required, the rest optional. */
function QuickAdd({ name: typed, onCancel, onCreated }: QuickAddProps) {
  const [name, setName] = useState(typed);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [type, setType] = useState<CustomerType>("homeowner");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!name.trim()) return setError("Enter the customer's name.");
    try {
      const customer = await api.createCustomer({ name, phone, email, type });
      toast.success(`${customer.name} added. Complete the profile from the customer list.`);
      onCreated(customer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The customer was not added.");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-1" noValidate aria-label="New customer">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quick-name">Name</Label>
        <Input
          id="quick-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? "quick-name-error" : undefined}
          autoFocus
        />
        {error ? (
          <p id="quick-name-error" className="text-danger-ink text-xs">
            {error}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quick-phone">Phone (optional)</Label>
          <Input id="quick-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="quick-type">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as CustomerType)}>
            <SelectTrigger id="quick-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(TYPES) as CustomerType[]).map((t) => (
                <SelectItem key={t} value={t}>
                  {TYPES[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="quick-email">Email (optional)</Label>
        <Input id="quick-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Back
        </Button>
        <Button type="submit" size="sm">
          Add customer
        </Button>
      </div>
    </form>
  );
}

interface CustomerPickerProps {
  id: string;
  customers: Customer[];
  value: string;
  disabled?: boolean;
  onSelect: (customer: Customer) => void;
  /** Set by a form whose validation found a problem with the customer. */
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

/**
 * The call-centre customer picker (spec A6): search by name, phone, email or company; each
 * result shows its type and primary address. The last option adds what was typed as a new
 * customer, saved at once and completed later from the customer drawer.
 */
export function CustomerPicker({
  id,
  customers,
  value,
  disabled,
  onSelect,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: CustomerPickerProps) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const selected = customers.find((c) => c.id === value);
  const found = customers.filter((c) => matches(c, query));

  function choose(customer: Customer) {
    onSelect(customer);
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
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{selected ? selected.name : "Choose a customer"}</span>
          <ChevronsUpDown aria-hidden="true" className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="bg-surface w-[min(26rem,calc(100vw-2rem))] p-0">
        {adding ? (
          <QuickAdd name={query} onCancel={() => setAdding(false)} onCreated={choose} />
        ) : (
          <Command shouldFilter={false} label="Search customers">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Name, phone, email or company"
              aria-label="Search customers"
            />
            <CommandList className="max-h-80">
              <CommandGroup>
                {found.slice(0, SHOWN).map((c) => {
                  const primary = defaultAddress(c, "billing");
                  return (
                    <CommandItem
                      key={c.id}
                      value={c.id}
                      onSelect={() => choose(c)}
                      className="flex-col items-start gap-0.5"
                    >
                      <span className="flex w-full items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground text-xs">{TYPES[c.type]}</span>
                        <span className="ml-auto">
                          <IncompleteBadge customer={c} />
                        </span>
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {primary ? addressLine(primary) : "No address yet"}
                      </span>
                    </CommandItem>
                  );
                })}
                {found.length > SHOWN ? (
                  <p className="text-muted-foreground px-2 py-1.5 text-xs">
                    {found.length - SHOWN} more. Keep typing to narrow the list.
                  </p>
                ) : null}
                {query.trim() && can("customers.customer.create") ? (
                  <CommandItem value="__add" onSelect={() => setAdding(true)}>
                    <UserPlus />
                    Add “{query.trim()}” as a new customer
                  </CommandItem>
                ) : null}
                {found.length === 0 && !query.trim() ? (
                  <p className="text-muted-foreground px-2 py-1.5 text-xs">No customers yet. Type a name to add one.</p>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
