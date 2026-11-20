import { describe, expect, it } from "vitest";
import { splitFor, splitShown } from "@/features/invoices/commission-split";

describe("the commission split dialog's shares (F-o, rule 6)", () => {
  it("works out the second share with decimal.js: 66.6 leaves 33.4, never 33.400000000000006", () => {
    expect(splitFor("rep", "other", "66.6")).toEqual([
      { userId: "rep", pct: "66.6" },
      { userId: "other", pct: "33.4" },
    ]);
    expect(splitFor("rep", "other", "60.00")[1]).toEqual({ userId: "other", pct: "40" });
    expect(splitFor("rep", null, "66.6")).toEqual([{ userId: "rep", pct: "100" }]);
  });

  it("reads the rep's share and the other person by user, not by position (ADR 0037, the sweep)", () => {
    const split = [
      { userId: "other", pct: "70" },
      { userId: "rep", pct: "30" },
    ];
    expect(splitShown(split, "rep")).toEqual({ second: "other", pct: "30" });
    expect(splitShown([{ userId: "rep", pct: "100" }], "rep")).toEqual({ second: null, pct: "60" });
    expect(splitShown(undefined, "rep")).toEqual({ second: null, pct: "60" });
  });
});
