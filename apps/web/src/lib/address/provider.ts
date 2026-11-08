import type { Address } from "@workspace/shared";
import { demoAddressProvider } from "./demo-provider";
import { googleAddressProvider } from "./google-provider";

/** One suggestion in the address dropdown. */
export interface AddressSuggestion {
  id: string;
  /** The street line, e.g. "123 Main Street". */
  text: string;
  /** The place line, e.g. "Sacramento, CA 95814". */
  secondary: string;
}

/**
 * Where address suggestions come from (spec A6). A session starts with the first keystroke and
 * ends with `resolve`, so a provider that bills per session (Google Places) counts one.
 */
export interface AddressProvider {
  name: "demo" | "google";
  suggest(query: string, sessionToken: string, near?: string): Promise<AddressSuggestion[]>;
  /** The full address of a suggestion: street, city, state, ZIP, county and coordinates. */
  resolve(suggestion: AddressSuggestion, sessionToken: string): Promise<Address>;
}

/** Suggestions start after this many characters (spec A6). */
export const MIN_QUERY_LENGTH = 3;
/** The pause after typing before suggestions are fetched (spec A6). */
export const SUGGEST_DELAY_MS = 250;

/**
 * The provider in use: Google Places (New) when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set at build
 * time, otherwise the offline demo list, which needs no key (plan A-2).
 */
export function addressProvider(): AddressProvider {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  return key ? googleAddressProvider(key) : demoAddressProvider;
}
