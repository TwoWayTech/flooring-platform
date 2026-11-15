"use client";

import { warehousesOf, type Location } from "@workspace/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";

/** The value meaning "every warehouse" in a filter. */
export const ALL_WAREHOUSES = "all";

/** The first option of a list filter (spec A1: a warehouse filter on lists, reports and the dashboard). */
export const ALL_WAREHOUSES_OPTION = { value: ALL_WAREHOUSES, label: "All warehouses" } as const;

interface WarehouseSelectProps {
  /** Any locations; only warehouses are offered. Reports pass the server's short list (ADR 0055). */
  locations: readonly Pick<Location, "id" | "name" | "kind">[];
  value: string;
  onChange: (locationId: string) => void;
  /** Visible label, or the accessible name when `id` is not tied to a visible label. */
  label: string;
  id?: string;
  /** An option shown before the warehouses, such as "All warehouses" in a filter. */
  extraOption?: { value: string; label: string };
  disabled?: boolean;
  className?: string;
}

/**
 * Picks one warehouse: Fulfilled from, Receive into, a transfer's ends, a person's default, or a
 * list filter. Showrooms never appear, since they hold no sellable stock (plan A-1).
 */
export function WarehouseSelect({
  locations,
  value,
  onChange,
  label,
  id,
  extraOption,
  disabled,
  className,
}: WarehouseSelectProps) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={id ? undefined : label} className={cn("bg-surface h-9 w-52", className)}>
        <SelectValue placeholder="Choose a warehouse" />
      </SelectTrigger>
      <SelectContent>
        {extraOption ? <SelectItem value={extraOption.value}>{extraOption.label}</SelectItem> : null}
        {warehousesOf(locations).map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
