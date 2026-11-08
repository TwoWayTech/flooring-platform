import type { Address } from "@workspace/shared";
import type { AddressProvider } from "./provider";

const BASE = "https://places.googleapis.com/v1";

interface Prediction {
  placePrediction?: {
    placeId: string;
    text?: { text: string };
    structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
  };
}

interface Component {
  longText: string;
  shortText: string;
  types: string[];
}

/** The part of a Place Details answer with the given type, in its short or long form. */
function part(components: readonly Component[], type: string, form: "longText" | "shortText" = "longText"): string {
  return components.find((c) => c.types.includes(type))?.[form] ?? "";
}

/** A Place Details answer as an address: street, city, state, ZIP, county without "County", and coordinates. */
function toAddress(place: {
  addressComponents?: Component[];
  location?: { latitude: number; longitude: number };
}): Address {
  const c = place.addressComponents ?? [];
  const street = [part(c, "street_number"), part(c, "route")].filter(Boolean).join(" ");
  return {
    street,
    city: part(c, "locality") || part(c, "postal_town") || part(c, "sublocality"),
    state: part(c, "administrative_area_level_1", "shortText"),
    zip: part(c, "postal_code"),
    county: part(c, "administrative_area_level_2").replace(/\s+County$/, ""),
    ...(place.location ? { lat: place.location.latitude, lng: place.location.longitude } : {}),
  };
}

/**
 * Google Places API (New) (spec A6): Autocomplete with a session token, closed by one Place
 * Details call that asks only for the address fields. United States only. The key is restricted
 * to the demo's two addresses in the Google Cloud console (README.demo.md).
 */
export function googleAddressProvider(key: string): AddressProvider {
  const headers = { "Content-Type": "application/json", "X-Goog-Api-Key": key };
  return {
    name: "google",
    async suggest(query, sessionToken) {
      const response = await fetch(`${BASE}/places:autocomplete`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: query, sessionToken, includedRegionCodes: ["us"], languageCode: "en" }),
      });
      if (!response.ok) throw new Error("Address suggestions are not available right now. Enter the address manually.");
      const data = (await response.json()) as { suggestions?: Prediction[] };
      return (data.suggestions ?? []).flatMap(({ placePrediction: p }) =>
        p
          ? [
              {
                id: p.placeId,
                text: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
                secondary: p.structuredFormat?.secondaryText?.text ?? "",
              },
            ]
          : [],
      );
    },
    async resolve(suggestion, sessionToken) {
      const url = `${BASE}/places/${encodeURIComponent(suggestion.id)}?sessionToken=${encodeURIComponent(sessionToken)}`;
      const response = await fetch(url, {
        headers: { ...headers, "X-Goog-FieldMask": "formattedAddress,addressComponents,location" },
      });
      if (!response.ok) throw new Error("That address could not be looked up. Enter it manually.");
      return toAddress((await response.json()) as Parameters<typeof toAddress>[0]);
    },
  };
}
