"use client";

import { US_STATES, type Address, type Customer, type Location } from "@workspace/shared";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { WarehouseSelect } from "@/components/warehouse-select";
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
 * Customer, job site and the warehouse the goods ship from. The job-site state picks the tax rule
 * (spec "Quote builder", A1).
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
  const field = (key: keyof Address, label: string, className: string) => (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <Label htmlFor={`site-${key}`}>{label}</Label>
      <Input
        id={`site-${key}`}
        defaultValue={jobSite[key]}
        key={`${key}-${jobSite[key]}`}
        disabled={!editable}
        onBlur={(e) => e.target.value !== jobSite[key] && onJobSite({ ...jobSite, [key]: e.target.value })}
      />
    </div>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <div className="flex flex-col gap-1.5 sm:col-span-6 lg:col-span-2">
        <Label htmlFor="quote-customer">Customer</Label>
        <Select
          value={customerId || undefined}
          onValueChange={(id) => onCustomer(customers.find((c) => c.id === id)!)}
          disabled={!editable}
        >
          <SelectTrigger id="quote-customer" className="w-full">
            <SelectValue placeholder="Choose a customer" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {customers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {field("street", "Job site street", "sm:col-span-3 lg:col-span-2")}
      {field("city", "City", "sm:col-span-3 lg:col-span-1")}
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
              <SelectLabel>Other states, no tax collected</SelectLabel>
              {US_STATES.filter(([code]) => !taxedStates.includes(code)).map(([code, name]) => (
                <SelectItem key={code} value={code}>
                  {name}
                </SelectItem>
              ))}
            </SelectGroup>
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
    </div>
  );
}
