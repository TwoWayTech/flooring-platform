import { describe, expect, it } from "vitest";
import { floatUses, parseFloatCalls, uiFiles } from "./coverage-scan/float-uses";
import { KNOWN_FLOAT_USES } from "./coverage-scan/known-float-uses";
import { SCAN_TIMEOUT_MS } from "./coverage-scan/source";

/**
 * Money in the UI (whole-product check, UI-1, ADR 0058). CLAUDE.md rule 6: money, quantities and
 * rates are decimal strings, computed with decimal.js and shown through formatNumber or `<Num>`,
 * never as JS floats. ESLint already bans `toFixed` in UI code; this test bans `parseFloat` and
 * pins every money-named `Number(…)` or unary `+` to a reviewed entry with its class and follow-up.
 */
describe("money in the UI (UI-1)", { timeout: SCAN_TIMEOUT_MS }, () => {
  it("scans the UI code", () => {
    expect(uiFiles().length, "the UI folders could not be read").toBeGreaterThan(200);
  });

  it("never parses money with parseFloat", () => {
    expect(parseFloatCalls(), "use decimal.js (packages/shared money) instead").toEqual([]);
  });

  it("pins every money-named float conversion to a reviewed entry, and no entry is stale", () => {
    const found = floatUses();
    const keys = new Set(found.map((use) => use.key));
    const unreviewed = found
      .filter((use) => !(use.key in KNOWN_FLOAT_USES))
      .map((use) => `${use.file}:${use.line}  ${use.key.slice(use.file.length + 2)}`);
    expect(
      unreviewed,
      "compute with decimal.js and format with formatNumber or <Num>; if it must stay, add it to coverage-scan/known-float-uses.ts with its class",
    ).toEqual([]);
    const stale = Object.keys(KNOWN_FLOAT_USES).filter((key) => !keys.has(key));
    expect(stale, "gone from the code: remove it from KNOWN_FLOAT_USES").toEqual([]);
  });
});
