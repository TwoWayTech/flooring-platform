"use client";

import { US_STATES, type Address } from "@workspace/shared";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { AddressSearchField } from "./address-search-field";

interface AddressFieldsProps {
  /** Prefix for field ids, so two address forms can share a page. */
  idPrefix: string;
  value: Address;
  onChange: (address: Address) => void;
  near?: string;
  /** Field errors by name, shown next to the field. */
  errors?: Partial<Record<keyof Address, string>>;
}

/**
 * An address with suggestions (spec A6): pick a suggestion to fill street, city, state, ZIP,
 * county and coordinates, or type into the fields yourself; they are always there, so entering
 * an address manually never needs a suggestion.
 */
export function AddressFields({ idPrefix, value, onChange, near, errors = {} }: AddressFieldsProps) {
  const text = (key: "street" | "city" | "county" | "zip", label: string, className = "") => {
    const id = `${idPrefix}-${key}`;
    const error = errors[key];
    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          value={value[key] ?? ""}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange({ ...value, [key]: e.target.value, lat: undefined, lng: undefined })}
        />
        {error ? (
          <p id={`${id}-error`} className="text-danger-ink text-xs">
            {error}
          </p>
        ) : null}
      </div>
    );
  };
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <div className="sm:col-span-6">
        <AddressSearchField id={`${idPrefix}-search`} near={near} onSelect={onChange} />
      </div>
      {text("street", "Street", "sm:col-span-6")}
      {text("city", "City", "sm:col-span-3")}
      {text("county", "County", "sm:col-span-3")}
      <div className="flex flex-col gap-1.5 sm:col-span-3">
        <Label htmlFor={`${idPrefix}-state`}>State</Label>
        <Select value={value.state || undefined} onValueChange={(state) => onChange({ ...value, state })}>
          <SelectTrigger id={`${idPrefix}-state`} className="w-full" aria-invalid={!!errors.state}>
            <SelectValue placeholder="Choose a state" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {US_STATES.map(([code, name]) => (
              <SelectItem key={code} value={code}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.state ? <p className="text-danger-ink text-xs">{errors.state}</p> : null}
      </div>
      {text("zip", "ZIP", "sm:col-span-3")}
    </div>
  );
}
