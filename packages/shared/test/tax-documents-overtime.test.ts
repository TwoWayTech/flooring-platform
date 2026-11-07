import { describe, expect, it } from "vitest";
import {
  EXAMPLE_TAX_RULES,
  US_STATES,
  BRAND_SCALE_STEPS,
  brandScale,
  brandTokens,
  hexToOklch,
  NEUTRALS,
  checkBrandColor,
  computeTotals,
  contrastRatio,
  depositAmount,
  ruleForState,
  splitOvertime,
  type DocLine,
} from "../src";

const lines: DocLine[] = [
  {
    id: "m",
    description: "Carpet",
    category: "material",
    unit: "sq_yd",
    quantity: "30.8",
    unitPrice: "42.99",
    unitCost: "21.10",
  },
  {
    id: "p",
    description: "Pad",
    category: "material",
    unit: "sq_yd",
    quantity: "30.8",
    unitPrice: "6.50",
    unitCost: "2.40",
  },
  {
    id: "l",
    description: "Installation",
    category: "labor",
    unit: "sq_ft",
    quantity: "277.2",
    unitPrice: "1.25",
    unitCost: "0.70",
  },
];

describe("US pack", () => {
  it("has 50 states plus DC", () => {
    expect(US_STATES).toHaveLength(51);
  });

  it("labels the six example states", () => {
    expect(EXAMPLE_TAX_RULES.map((r) => r.state).sort()).toEqual(["CO", "FL", "MD", "NJ", "PA", "TX"]);
  });
});

describe("computeTotals", () => {
  it("taxes labor in NJ but not in CO", () => {
    const co = computeTotals(lines, {
      rule: ruleForState(EXAMPLE_TAX_RULES, "CO"),
      exempt: false,
      rounding: "invoice",
    });
    const nj = computeTotals(lines, {
      rule: ruleForState(EXAMPLE_TAX_RULES, "NJ"),
      exempt: false,
      rounding: "invoice",
    });
    expect(co.subtotal).toBe("1870.79");
    expect(co.taxableAmount).toBe("1524.29");
    expect(co.tax).toBe("134.29");
    expect(nj.taxableAmount).toBe("1870.79");
    expect(nj.tax).toBe("123.94");
  });

  it("makes total = sum of lines + tax", () => {
    const t = computeTotals(lines, { rule: ruleForState(EXAMPLE_TAX_RULES, "TX"), exempt: false, rounding: "line" });
    const lineSum = t.lines.reduce((a, l) => a + Math.round(Number(l.amount) * 100), 0);
    expect(Math.round(Number(t.total) * 100)).toBe(lineSum + Math.round(Number(t.tax) * 100));
  });

  it("exempts customers with a valid certificate and states without a rule", () => {
    expect(
      computeTotals(lines, { rule: ruleForState(EXAMPLE_TAX_RULES, "CO"), exempt: true, rounding: "line" }).tax,
    ).toBe("0.00");
    expect(
      computeTotals(lines, { rule: ruleForState(EXAMPLE_TAX_RULES, "WY"), exempt: false, rounding: "line" }).tax,
    ).toBe("0.00");
  });

  it("taxes lump-sum labor where the state flags it", () => {
    const t = computeTotals(lines, {
      rule: ruleForState(EXAMPLE_TAX_RULES, "CO"),
      exempt: false,
      rounding: "invoice",
      lumpSum: true,
    });
    expect(t.taxableAmount).toBe(t.subtotal);
  });

  it("computes cost, margin and deposit", () => {
    const t = computeTotals(lines, { rule: undefined, exempt: false, rounding: "line" });
    expect(t.cost).toBe("917.84");
    expect(t.margin).toBe("952.95");
    expect(depositAmount(t.total, "50")).toBe("935.40");
  });
});

describe("overtime", () => {
  it("applies the federal 40-hour week", () => {
    expect(splitOvertime([9, 9, 9, 9, 9, 0, 0], "federal")).toMatchObject({ regular: 40, overtime: 5, doubleTime: 0 });
  });

  it("applies California daily overtime and double time", () => {
    const r = splitOvertime([13, 8, 8, 8, 8, 0, 0], "california");
    expect(r).toMatchObject({ regular: 40, overtime: 4, doubleTime: 1 });
    expect(r.flaggedDays).toEqual([0]);
  });
});

describe("brand colors", () => {
  it("derives fills that pass AA with their text color in both themes", () => {
    for (const hex of ["#2E8B7E", "#2F6B3F", "#1F6FB2"]) {
      const t = brandTokens(hex);
      expect(contrastRatio(t.light.accent, t.light.accentForeground)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.dark.accent, t.dark.accentForeground)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.light.accentInk, "#EEF0EC")).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.dark.accentInk, "#1D2B31")).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("blocks colors too light to work as an accent", () => {
    expect(checkBrandColor("#FFE600").ok).toBe(false);
    expect(checkBrandColor("#2E8B7E").ok).toBe(true);
    expect(checkBrandColor("teal").ok).toBe(false);
  });
});

describe("brand scale and pattern tones", () => {
  it("steps from light to dark in the brand's hue", () => {
    const scale = brandScale("#2E8B7E");
    const lightness = BRAND_SCALE_STEPS.map((s) => hexToOklch(scale[s]).l);
    expect(lightness).toEqual([...lightness].sort((a, b) => b - a));
  });

  it("keeps pattern tones close to the theme background", () => {
    const tokens = brandTokens("#1F6FA8");
    for (const tone of tokens.light.pattern) expect(contrastRatio(tone, NEUTRALS.light.background)).toBeLessThan(1.25);
    for (const tone of tokens.dark.pattern) expect(contrastRatio(tone, NEUTRALS.dark.background)).toBeLessThan(1.35);
  });
});
