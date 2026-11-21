"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  ADDRESS_LABELS,
  plainAddress,
  zipProblem,
  type Address,
  type Customer,
  type CustomerAddress,
  type CustomerAddressLabel,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Label } from "@workspace/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { AddressFields } from "@/components/address/address-fields";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";

/** Field errors of an address, or none when it is complete enough to save. */
function addressErrors(a: Address): Partial<Record<keyof Address, string>> {
  const errors: Partial<Record<keyof Address, string>> = {};
  if (!a.street.trim()) errors.street = "Enter the street address.";
  if (!a.city.trim()) errors.city = "Enter the city.";
  if (!a.state) errors.state = "Choose the state.";
  const zip = zipProblem(a.zip);
  if (zip) errors.zip = zip;
  return errors;
}

interface AddressDialogProps {
  customer: Customer;
  /** The address to edit, or null to add one. */
  address: CustomerAddress | null;
  /** The label a new address starts with, such as Job site from the quote builder. */
  initialLabel?: CustomerAddressLabel;
  onClose: () => void;
  onSaved: (customer: Customer, address: CustomerAddress) => void;
}

/**
 * Adds or edits one of a customer's addresses (spec A6): a label, the address with suggestions
 * or typed by hand, and whether it is the default for billing or job sites. Focus moves to the
 * first field with an error.
 */
export function AddressDialog({ customer, address, initialLabel = "job_site", onClose, onSaved }: AddressDialogProps) {
  const { settings } = useWorkspace();
  const [label, setLabel] = useState<CustomerAddressLabel>(address?.label ?? initialLabel);
  const [value, setValue] = useState<Address>(plainAddress(address ?? undefined));
  const [billing, setBilling] = useState(
    address ? customer.defaultBillingId === address.id : customer.addresses.length === 0,
  );
  const [jobSite, setJobSite] = useState(address ? customer.defaultJobSiteId === address.id : true);
  const [errors, setErrors] = useState<Partial<Record<keyof Address, string>>>({});
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = addressErrors(value);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) return document.getElementById(`cust-address-${first}`)?.focus();
    const saved: CustomerAddress = {
      id: address?.id ?? `${customer.id}-addr-${crypto.randomUUID().slice(0, 6)}`,
      label,
      ...value,
    };
    const addresses = address
      ? customer.addresses.map((a) => (a.id === address.id ? saved : a))
      : [...customer.addresses, saved];
    setSaving(true);
    try {
      const next = await api.saveCustomer({
        ...customer,
        addresses,
        defaultBillingId: billing ? saved.id : customer.defaultBillingId,
        defaultJobSiteId: jobSite ? saved.id : customer.defaultJobSiteId,
      });
      toast.success(`Address saved for ${customer.name}`);
      onSaved(next, saved);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The address was not saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{address ? "Edit address" : "Add new address"}</DialogTitle>
            <DialogDescription>{customer.name}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cust-address-label">Label</Label>
            <Select value={label} onValueChange={(v) => setLabel(v as CustomerAddressLabel)}>
              <SelectTrigger id="cust-address-label" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ADDRESS_LABELS) as CustomerAddressLabel[]).map((l) => (
                  <SelectItem key={l} value={l}>
                    {ADDRESS_LABELS[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <AddressFields
            idPrefix="cust-address"
            value={value}
            onChange={setValue}
            near={settings.localization.region.primaryState}
            errors={errors}
          />
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={billing} onCheckedChange={(on) => setBilling(on === true)} />
              Default for billing
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={jobSite} onCheckedChange={(on) => setJobSite(on === true)} />
              Default job site
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save address
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
