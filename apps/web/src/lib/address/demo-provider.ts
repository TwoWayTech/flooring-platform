import { searchDemoAddresses, type AddressMatch } from "@workspace/shared";
import type { AddressProvider } from "./provider";

/** Matches from the last search, so `resolve` can hand back the full address without a lookup. */
const recent = new Map<string, AddressMatch>();

/**
 * The offline provider (spec A6): about 300 seeded addresses and the US city list, plus
 * addresses built from a typed house number and street. Works without a network or a key.
 */
export const demoAddressProvider: AddressProvider = {
  name: "demo",
  async suggest(query, _session, near) {
    const matches = searchDemoAddresses(query, { near });
    for (const m of matches) recent.set(m.id, m);
    return matches.map(({ id, text, secondary }) => ({ id, text, secondary }));
  },
  async resolve(suggestion) {
    const match = recent.get(suggestion.id);
    if (!match) throw new Error("That suggestion is no longer available. Type the address again.");
    return { ...match.address };
  },
};
