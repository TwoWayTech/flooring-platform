import type { Address } from "../types/company";
import { DEMO_CITIES, DEMO_STREETS, type DemoCity } from "./cities";
import { stateName } from "./states";

/** One address suggestion: the street line, the place line and the full address it fills in. */
export interface AddressMatch {
  id: string;
  text: string;
  secondary: string;
  address: Address;
}

/** How many seeded addresses the offline provider holds (spec A6: about 300). */
export const DEMO_ADDRESS_COUNT = 300;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Whether every query word starts some word of the text ("calif" matches "California"). */
function prefixMatch(text: string, query: string[]): boolean {
  const have = words(text);
  return query.every((q) => have.some((w) => w.startsWith(q)));
}

const placeText = (c: DemoCity) => `${c.city} ${c.county} ${c.state} ${stateName(c.state)} ${c.zip}`;

/** An address on a city's streets, offset a little from the city centre so pins do not overlap. */
function addressIn(city: DemoCity, number: number, street: string, i: number): Address {
  return {
    street: `${number} ${street}`,
    city: city.city,
    state: city.state,
    zip: city.zip,
    county: city.county,
    lat: Number((city.lat + ((i % 7) - 3) * 0.004).toFixed(5)),
    lng: Number((city.lng + ((i % 5) - 2) * 0.005).toFixed(5)),
  };
}

function match(address: Address, id: string): AddressMatch {
  return { id, text: address.street, secondary: `${address.city}, ${address.state} ${address.zip}`, address };
}

/** The seeded addresses: a fixed pattern over the city and street lists, the same on every visit. */
const SEEDED: readonly AddressMatch[] = Array.from({ length: DEMO_ADDRESS_COUNT }, (_, i) => {
  const city = DEMO_CITIES[(i * 7) % DEMO_CITIES.length]!;
  const street = DEMO_STREETS[(i * 11) % DEMO_STREETS.length]!;
  const number = 100 + ((i * 397) % 9800);
  return match(addressIn(city, number, street, i), `demo-${i + 1}`);
});

/** A street name completed from the list ("main" → "Main Street"), or the typed words in title case. */
function streetName(typed: string[]): string {
  const known = DEMO_STREETS.find((s) => prefixMatch(s, typed));
  if (known) return known;
  return typed.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Addresses built from what the person typed (spec A6: they type freely, "123 Main" or
 * "123 Main St, Sacramento"): the house number and street they typed in matching cities, or in
 * cities of the preferred state when they named none.
 */
function typedAddresses(query: string, near: string | undefined, limit: number): AddressMatch[] {
  const [streetPart = "", ...placeParts] = query.split(",");
  const tokens = words(streetPart);
  const number = Number(tokens[0]);
  if (!Number.isInteger(number) || number <= 0 || tokens.length < 2) return [];
  const street = streetName(tokens.slice(1));
  const place = words(placeParts.join(" "));
  const cities = place.length
    ? DEMO_CITIES.filter((c) => prefixMatch(placeText(c), place))
    : [...DEMO_CITIES].sort((a, b) => Number(b.state === near) - Number(a.state === near));
  return cities
    .slice(0, limit)
    .map((city, i) => match(addressIn(city, number, street, i), `typed-${city.city}-${city.state}-${number}`));
}

/**
 * Address suggestions for the offline provider (spec A6): seeded addresses whose words start
 * with the words typed, then addresses built from a typed house number and street. `near` puts
 * the company's state first.
 */
export function searchDemoAddresses(query: string, options: { near?: string; limit?: number } = {}): AddressMatch[] {
  const limit = options.limit ?? 6;
  const tokens = words(query);
  if (tokens.length === 0) return [];
  const seeded = SEEDED.filter((m) => prefixMatch(`${m.text} ${placeText(cityOf(m.address))}`, tokens));
  const typed = typedAddresses(query, options.near, limit);
  const seen = new Set<string>();
  return [...seeded, ...typed]
    .sort((a, b) => Number(b.address.state === options.near) - Number(a.address.state === options.near))
    .filter((m) => {
      const key = `${m.text}|${m.secondary}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function cityOf(address: Address): DemoCity {
  return DEMO_CITIES.find((c) => c.city === address.city && c.state === address.state)!;
}
