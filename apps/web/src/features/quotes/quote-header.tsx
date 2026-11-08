"use client";

import { useState } from "react";
import {
  ADDRESS_LABELS,
  addressLine,
  plainAddress,
  US_STATES,
  type Address,
  type Customer,
  type Location,
} from "@workspace/shared";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { WarehouseSelect } from "@/components/warehouse-select";
import { useCan } from "@/components/workspace/workspace-context";
import { AddressDialog } from "@/features/customers/address-dialog";
import { CustomerPicker } from "@/features/customers/customer-picker";

/** The value of the "Add new address" choice in the job-site list. */
const NEW_ADDRESS = "__new";

interface QuoteHeaderProps {
  customers: Customer[];
  customerId: string;
  jobSite: Address;
  locations: Location[];
  /** Fulfilled from (spec A1). */
  locationId: string;
  editable: boolean;
  /** States the company has tax rules for, marked in the state list. */
  taxedStates: string[];
  onCustomer: (customer: Customer) => void;
  onJobSite: (jobSite: Address) => void;
  onLocation: (locationId: string) => void;
}

/**
 * Customer, job site and the warehouse the goods ship from (spec "Quote builder", A1, A6). The
 * customer picker searches like a call centre and adds new customers inline; the job site comes
 * from the customer's addresses or a new one, and its fields stay editable by hand. The job site
 * picks the tax rule.
 */
export function QuoteHeader({
  customers,
  customerId,
  jobSite,
  locations,
  locationId,
  editable,
  taxedStates,
  onCustomer,
  onJobSite,
  onLocation,
}: QuoteHeaderProps) {
  const can = useCan();
  const [adding, setAdding] = useState(false);
  const customer = customers.find((c) => c.id === customerId);
  const chosen = customer?.addresses.find((a) => a.street === jobSite.street && a.zip === jobSite.zip);

  const field = (key: "street" | "city" | "county" | "zip", label: string, className: string) => {
    const value = jobSite[key] ?? "";
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <Label htmlFor={`site-${key}`}>{label}</Label>
        <Input
          id={`site-${key}`}
          defaultValue={value}
          key={`${key}-${value}`}
          disabled={!editable}
          onBlur={(e) => e.target.value !== value && onJobSite({ ...jobSite, [key]: e.target.value })}
        />
      </div>
    );
  };
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <div className="flex flex-col gap-1.5 sm:col-span-3 lg:col-span-2">
        <Label htmlFor="quote-customer">Customer</Label>
        <CustomerPicker
          id="quote-customer"
          customers={customers}
          value={customerId}
          disabled={!editable}
          onSelect={onCustomer}
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-3 lg:col-span-2">
        <Label htmlFor="quote-site-address">Job-site address</Label>
        <Select
          value={chosen?.id ?? ""}
          disabled={!editable || !customer}
          onValueChange={(id) => {
            if (id === NEW_ADDRESS) return setAdding(true);
            const address = customer?.addresses.find((a) => a.id === id);
            if (address) onJobSite(plainAddress(address));
          }}
        >
          <SelectTrigger id="quote-site-address" className="w-full">
            <SelectValue placeholder={customer ? "Typed by hand" : "Choose a customer first"} />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {customer?.addresses.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {ADDRESS_LABELS[a.label]}: {addressLine(a)}
              </SelectItem>
            ))}
            {can("customers.customer.edit") ? (
              <>
                {customer?.addresses.length ? <SelectSeparator /> : null}
                <SelectItem value={NEW_ADDRESS}>Add new address</SelectItem>
              </>
            ) : null}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-3 lg:col-span-2">
        <Label htmlFor="quote-location">Fulfilled from</Label>
        <WarehouseSelect
          id="quote-location"
          label="Fulfilled from"
          className="w-full"
          locations={locations}
          value={locationId}
          onChange={onLocation}
          disabled={!editable}
        />
      </div>
      {field("street", "Job site street", "sm:col-span-3 lg:col-span-2")}
      {field("city", "City", "sm:col-span-3 lg:col-span-1")}
      {field("county", "County", "sm:col-span-3 lg:col-span-1")}
      <div className="flex flex-col gap-1.5 sm:col-span-3 lg:col-span-1">
        <Label htmlFor="site-state">State</Label>
        <Select value={jobSite.state} onValueChange={(state) => onJobSite({ ...jobSite, state })} disabled={!editable}>
          <SelectTrigger id="site-state" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectGroup>
              <SelectLabel>States with a tax rule</SelectLabel>
              {US_STATES.filter(([code]) => taxedStates.includes(code)).map(([code, name]) => (
                <SelectItem key={code} value={code}>
                  {name}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Other states</SelectLabel>
              {US_STATES.filter(([code]) => !taxedStates.includes(code)).map(([code, name]) => (
                <SelectItem key={code} value={code}>
                  {name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {field("zip", "ZIP", "sm:col-span-3 lg:col-span-1")}
      {adding && customer ? (
        <AddressDialog
          customer={customer}
          address={null}
          onClose={() => setAdding(false)}
          onSaved={(_, saved) => {
            setAdding(false);
            onJobSite(plainAddress(saved));
          }}
        />
      ) : null}
    </div>
  );
}
