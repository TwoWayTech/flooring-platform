import { describe, expect, it } from "vitest";
import { dec, MONEY_TEXT, PERCENT_TEXT, sameOptionalDecimal, SHARE_PERCENT_TEXT, trimmedDecimal } from "../src";

/** Each text with the pattern's verdict, so a failure names the text. */
function verdicts(pattern: RegExp, texts: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(texts.map((text) => [text, pattern.test(text)]));
}

/** Every text in the list maps to `want`. */
function all(texts: readonly string[], want: boolean): Record<string, boolean> {
  return Object.fromEntries(texts.map((text) => [text, want]));
}

/** Eight-place fractions with one non-zero digit at each place, so the value has 1 to 8 decimals. */
const EIGHT_PLACES = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((places) =>
  ["1", "9"].map((digit) => `10.${"0".repeat(places - 1)}${digit}${"0".repeat(8 - places)}`),
);

/**
 * Percents as a write takes them back (STATUS B6): numeric(18,8) columns are answered at their
 * scale, so a percent may be written with up to eight places, but no value past the rule's
 * precision gets in (four decimals for quote and contract percents, two for a commission share).
 */
describe("decimal text (B6)", () => {
  const percents = [
    "0",
    "10",
    "100",
    "010",
    "10.5",
    "10.1234",
    "10.00000000",
    "50.00000000",
    "12.50000000",
    "10.12340000",
    "100.00000000",
  ];

  it("PERCENT_TEXT takes a percent with up to four decimals, written with up to eight places", () => {
    expect(verdicts(PERCENT_TEXT, percents)).toEqual(all(percents, true));
  });

  it("PERCENT_TEXT refuses other spellings and any value past four decimals", () => {
    const refused = [
      "",
      "1000",
      "10.",
      ".5",
      "-1",
      "+10",
      " 10",
      "10 ",
      "10\n",
      "10,5",
      "1e1",
      "NaN",
      "Infinity",
      "10.00001",
      "10.12345",
      "10.00000001",
      "10.000000000",
    ];
    expect(verdicts(PERCENT_TEXT, refused)).toEqual(all(refused, false));
  });

  it("PERCENT_TEXT admits no value with more than four decimals", () => {
    for (const text of percents) expect(dec(text).decimalPlaces(), text).toBeLessThanOrEqual(4);
    // Among eight-place texts the pattern takes exactly those whose value has at most four places.
    const byValue = Object.fromEntries(EIGHT_PLACES.map((text) => [text, dec(text).decimalPlaces() <= 4]));
    expect(verdicts(PERCENT_TEXT, EIGHT_PLACES)).toEqual(byValue);
    expect(verdicts(PERCENT_TEXT, ["99.99990000", "10.00000001", "10.12340001", "99.99999999"])).toEqual({
      "99.99990000": true,
      "10.00000001": false,
      "10.12340001": false,
      "99.99999999": false,
    });
  });

  it("SHARE_PERCENT_TEXT takes two decimals by value, written with up to eight places", () => {
    const taken = ["60", "60.5", "60.25", "60.250", "60.00000000", "33.33000000", "40", "100"];
    const refused = ["60.001", "60.255", "60.00000001", "39.99999999", "60.2500000001", "60.250000000", "-5", ""];
    expect(verdicts(SHARE_PERCENT_TEXT, taken)).toEqual(all(taken, true));
    expect(verdicts(SHARE_PERCENT_TEXT, refused)).toEqual(all(refused, false));
  });

  it("sameOptionalDecimal compares plain decimal text by value and fails closed", () => {
    const same: [string | null | undefined, string | null | undefined][] = [
      ["10", "10.00000000"],
      ["10.00000000", "10"],
      ["0", "0.00000000"],
      [undefined, undefined],
      ["", undefined],
      [null, ""],
    ];
    const different: [string | null | undefined, string | null | undefined][] = [
      ["10", "10.0001"],
      ["10", undefined],
      [undefined, "0"],
      ["10", "abc"],
      ["abc", "abc"],
      ["NaN", "NaN"],
      ["Infinity", "Infinity"],
      // decimal.js alone reads each of these as 10 or 0 (critique S1).
      ["10", "0x0a"],
      ["10", "1e1"],
      ["10", "+10"],
      ["10", "10."],
      ["0", "-0"],
      ["10", " 10"],
    ];
    for (const [a, b] of same) expect(sameOptionalDecimal(a, b), `${a} and ${b}`).toBe(true);
    for (const [a, b] of different) expect(sameOptionalDecimal(a, b), `${a} and ${b}`).toBe(false);
  });
});

/** Settings amounts (ADR 0059): plain unsigned money with at most two decimals, as typed and stored. */
describe("money text (Settings part 1)", () => {
  it("R9 MONEY_TEXT takes plain money and nothing a number parser would also read", () => {
    const good = ["0", "5.00", "1000.5", "999999999999.99"];
    const bad = ["12.", ".5", "-1", "1e3", " 1", "1,000", "1234567890123", "1.234", "+1", "0x10", ""];
    expect(verdicts(MONEY_TEXT, good)).toEqual(all(good, true));
    expect(verdicts(MONEY_TEXT, bad)).toEqual(all(bad, false));
  });
});

/** Inputs show stored decimals by value, without the column's trailing zeros (click-through #7). */
describe("a stored decimal for editing", () => {
  it("R10 trimmedDecimal drops trailing zeros and keeps the value", () => {
    expect(trimmedDecimal("8.000")).toBe("8");
    expect(trimmedDecimal("50.00")).toBe("50");
    expect(trimmedDecimal("50.00000000")).toBe("50");
    expect(trimmedDecimal("12.50")).toBe("12.5");
    expect(trimmedDecimal("0.125")).toBe("0.125");
    expect(trimmedDecimal("100")).toBe("100");
    expect(trimmedDecimal("0")).toBe("0");
  });

  it("R11 trimmedDecimal leaves blank and non-decimal text alone", () => {
    expect(trimmedDecimal("")).toBe("");
    expect(trimmedDecimal(null)).toBe("");
    expect(trimmedDecimal(undefined)).toBe("");
    expect(trimmedDecimal("1e3")).toBe("1e3");
    expect(trimmedDecimal("12.")).toBe("12.");
  });
});
