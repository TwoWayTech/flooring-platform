import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHARED_COSTS,
  fixedPctProblem,
  isSharedCostRule,
  PERCENT_TEXT_MAX,
  SHARED_COST_MESSAGES,
  SHARED_COST_RULES,
  SHARED_COST_SHARES_MAX,
  sharedCostsProblem,
  settingsSectionProblem,
  weightsFor,
  type SharedCostsInput,
} from "../src";

/** Two live locations, as the rule reads them. */
const LOCATIONS = [
  { id: "a", name: "Denver Central" },
  { id: "b", name: "Boulder Showroom" },
];

/** Shared costs with a rule and shares. */
function costs(rule: string, fixedPct: Record<string, string> = {}): SharedCostsInput {
  return { rule, fixedPct };
}

/**
 * Shared costs' rule (ADR 0023; ADR 0059, part 4b, D4 to D8): the same words in both modes, never
 * throwing on malformed text, and the Business report's weights reading stored text safely. Every
 * case names its id first, for the mutation runs.
 */
describe("shared costs rule (ADR 0059, part 4b)", () => {
  it("SCR1 each known rule with no shares saves; an unknown rule is refused with words", () => {
    expect([...SHARED_COST_RULES]).toEqual(["revenue", "floor_area", "equal", "fixed"]);
    for (const rule of ["revenue", "floor_area", "equal"])
      expect(sharedCostsProblem(costs(rule), LOCATIONS)).toBeNull();
    for (const rule of ["", "Revenue", "weighted", "fixed "]) {
      expect(isSharedCostRule(rule), rule).toBe(false);
      expect(sharedCostsProblem(costs(rule), LOCATIONS), rule).toBe(SHARED_COST_MESSAGES.rule);
    }
    expect(sharedCostsProblem(DEFAULT_SHARED_COSTS, LOCATIONS)).toBeNull();
  });

  it("SCR2 fixed: the shares add up to exactly 100 by value; a location with no share counts 0", () => {
    expect(sharedCostsProblem(costs("fixed", { a: "60", b: "40" }), LOCATIONS)).toBeNull();
    expect(sharedCostsProblem(costs("fixed", { a: "60.00000000", b: "40.0" }), LOCATIONS)).toBeNull();
    expect(sharedCostsProblem(costs("fixed", { a: "100" }), LOCATIONS)).toBeNull();
    expect(sharedCostsProblem(costs("fixed", { a: "33.3333", b: "66.6667" }), LOCATIONS)).toBeNull();
    expect(sharedCostsProblem(costs("fixed", { a: "60", b: "30" }), LOCATIONS)).toBe(SHARED_COST_MESSAGES.total("90"));
    expect(sharedCostsProblem(costs("fixed", { a: "60", b: "40.0001" }), LOCATIONS)).toBe(
      SHARED_COST_MESSAGES.total("100.0001"),
    );
    expect(sharedCostsProblem(costs("fixed"), LOCATIONS)).toBe(SHARED_COST_MESSAGES.total("0"));
    expect(sharedCostsProblem(costs("fixed"), [])).toBe(SHARED_COST_MESSAGES.total("0"));
  });

  it("SCR3 every share is a percent from 0 to 100, checked before any decimal and whatever the rule, naming the location", () => {
    const bad = ["", " 5", "5 ", "-5", "+5", "1e2", "0x10", "1.2.3", ".5", "5.", "100.0001", "101", "1000", "12.34567"];
    for (const share of bad)
      for (const rule of SHARED_COST_RULES)
        expect(sharedCostsProblem(costs(rule, { a: share, b: "40" }), LOCATIONS), `${rule} ${share}`).toBe(
          SHARED_COST_MESSAGES.shareOf("Denver Central"),
        );
    // A number where text belongs is refused too (the API's body takes only strings).
    const numeric = { rule: "fixed", fixedPct: { a: 60 as unknown as string, b: "40" } };
    expect(sharedCostsProblem(numeric, LOCATIONS)).toBe(SHARED_COST_MESSAGES.shareOf("Denver Central"));
    expect(sharedCostsProblem(costs("revenue", { a: "0", b: "100.00000000" }), LOCATIONS)).toBeNull();
    expect("100.00000000").toHaveLength(PERCENT_TEXT_MAX);
  });

  it("SCR4 every share names a live location, whatever the rule; at most SHARED_COST_SHARES_MAX shares", () => {
    for (const rule of SHARED_COST_RULES) {
      expect(sharedCostsProblem(costs(rule, { a: "60", b: "40", gone: "0" }), LOCATIONS), rule).toBe(
        SHARED_COST_MESSAGES.unknownLocation,
      );
      expect(sharedCostsProblem(costs(rule, { constructor: "0" }), LOCATIONS), rule).toBe(
        SHARED_COST_MESSAGES.unknownLocation,
      );
    }
    const many = Object.fromEntries(Array.from({ length: SHARED_COST_SHARES_MAX + 1 }, (_, i) => [`l${i}`, "0"]));
    expect(sharedCostsProblem(costs("revenue", many), LOCATIONS)).toBe(SHARED_COST_MESSAGES.shares);
  });

  it("SCR5 fixedPctProblem never throws on malformed text (plan note (a)) and ignores other rules", () => {
    for (const share of ["", "1.2.3", "abc"])
      expect(() => fixedPctProblem(costs("fixed", { a: share }), LOCATIONS)).not.toThrow();
    expect(fixedPctProblem(costs("fixed", { a: "1.2.3" }), LOCATIONS)).toBe(
      SHARED_COST_MESSAGES.shareOf("Denver Central"),
    );
    expect(fixedPctProblem(costs("revenue", { a: "1.2.3" }), LOCATIONS)).toBeNull();
  });

  it("SCR6 the dispatcher judges shared costs against the context's locations, and throws without them (D8)", () => {
    const value = { rule: "fixed" as const, fixedPct: { a: "60", b: "30" } };
    expect(settingsSectionProblem("sharedCosts", value, DEFAULT_SHARED_COSTS, { locations: LOCATIONS })).toBe(
      SHARED_COST_MESSAGES.total("90"),
    );
    expect(
      settingsSectionProblem("sharedCosts", { ...value, fixedPct: { a: "60", b: "40" } }, DEFAULT_SHARED_COSTS, {
        locations: LOCATIONS,
      }),
    ).toBeNull();
    expect(() => settingsSectionProblem("sharedCosts", value, DEFAULT_SHARED_COSTS)).toThrow(/live locations/);
  });

  it("SCR7 weightsFor reads a blank or malformed floor area or share as 0, never throwing (R5, D7)", () => {
    const stored = [
      { id: "a", floorAreaSqFt: "" },
      { id: "b", floorAreaSqFt: "1.2.3" },
      { id: "c", floorAreaSqFt: "18000.000" },
    ];
    const area = weightsFor(stored, { rule: "floor_area", fixedPct: {} }, new Map());
    expect(area.rule).toBe("floor_area");
    expect(area.weights.map((w) => w.weight)).toEqual([0n, 0n, 1_800_000n]);
    const fixed = weightsFor(stored, { rule: "fixed", fixedPct: { a: "", b: "abc", c: "25" } }, new Map());
    expect(fixed.weights.map((w) => w.weight)).toEqual([0n, 0n, 250_000n]);
    const none = weightsFor([{ id: "a", floorAreaSqFt: "" }], { rule: "floor_area", fixedPct: {} }, new Map());
    expect(none.rule).toBe("equal");
  });

  it("SCR8 fixed shares weigh in ten-thousandths, so four-decimal shares split exactly", () => {
    const fixed = weightsFor(
      [
        { id: "a", floorAreaSqFt: undefined },
        { id: "b", floorAreaSqFt: undefined },
      ],
      { rule: "fixed", fixedPct: { a: "33.3333", b: "66.6667" } },
      new Map(),
    );
    expect(fixed.weights).toEqual([
      { id: "a", weight: 333_333n },
      { id: "b", weight: 666_667n },
    ]);
  });
});
