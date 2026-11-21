import { describe, expect, it } from "vitest";
import { matchOptions } from "@/components/search-pick-match";

describe("search picker matching (click-through #38)", () => {
  const vendors = [
    ["v1", "Redrock Property Management"],
    ["v2", "Peakline Internet and Phone"],
    ["v3", "Metro Water District"],
    ["v4", "Tidewell Facility Services"],
  ] as const;

  it("keeps every option, in order, until something is typed", () => {
    expect(matchOptions(vendors, "")).toEqual(vendors);
    expect(matchOptions(vendors, "   ")).toEqual(vendors);
  });

  it("finds a name from its first letters, ignoring case and spaces", () => {
    expect(matchOptions(vendors, " TIDE").map(([v]) => v)).toEqual(["v4"]);
  });

  it("puts names that start with the text first, then a word that starts with it, then any match", () => {
    const places = [
      ["a", "Company-wide"],
      ["b", "Southgate Showroom"],
      ["c", "Showroom North"],
      ["d", "Denver Central"],
    ] as const;
    expect(matchOptions(places, "show").map(([v]) => v)).toEqual(["c", "b"]);
    expect(matchOptions(places, "en").map(([v]) => v)).toEqual(["d"]);
    expect(matchOptions(vendors, "ter").map(([v]) => v)).toEqual(["v2", "v3"]);
  });

  it("finds nothing for text in no name", () => {
    expect(matchOptions(vendors, "zebra")).toEqual([]);
  });
});
