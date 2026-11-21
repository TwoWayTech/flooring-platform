"use client";

import {
  formatNumber,
  rollAvailable,
  rollsForLength,
  stockNeed,
  type DocLine,
  type Product,
  type Reservation,
  type Roll,
} from "@workspace/shared";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";

/** The value of "any roll that fits" in the picker. */
const ANY = "__any";

/** The rolls and holds the picker reads, and the warehouse the quote ships from. */
export interface RollStock {
  rolls: Roll[];
  reservations: Reservation[];
  locationId: string;
}

/**
 * Picks the roll a carpet line is cut from (spec C2): rolls at the quote's warehouse with enough
 * free length for the line, the chosen dye lot first, so every room of a job matches. "Any roll"
 * lets the invoice pick the best fit when it is issued.
 */
export function RollPicker({
  line,
  product,
  stock,
  onChange,
}: {
  line: DocLine;
  product: Product;
  stock: RollStock;
  onChange: (rollId: string | undefined) => void;
}) {
  const numbers = useNumberSettings();
  const need = stockNeed(line, product);
  if (!need) return null;
  const chosen = stock.rolls.find((r) => r.id === line.rollId);
  const fits = rollsForLength(stock.rolls, stock.reservations, product.id, stock.locationId, need, chosen?.dyeLot);
  const options = chosen && !fits.includes(chosen) ? [chosen, ...fits] : fits;
  const ft = (v: string) => formatNumber(v, "quantity", numbers);
  return (
    <Select value={line.rollId ?? ANY} onValueChange={(v) => onChange(v === ANY ? undefined : v)}>
      <SelectTrigger className="mt-1 h-8 w-full max-w-72 text-xs" aria-label={`${line.description} roll`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>
          {fits.length ? `Any roll that fits (${fits.length})` : `No roll has ${ft(need.toString())} ft available here`}
        </SelectItem>
        {options.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            Roll {r.rollNumber}, lot {r.dyeLot}, {ft(rollAvailable(r, stock.reservations).toString())} ft free
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
