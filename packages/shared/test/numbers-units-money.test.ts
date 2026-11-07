import { describe, expect, it } from "vitest";
import {
  cartonsForArea,
  defaultNumberSettings,
  formatFull,
  formatNumber,
  isRounded,
  marginPct,
  moneyString,
  quantityForArea,
  rollAreaSqFt,
  roundMoney,
  sqFtToSqYd,
  sum,
  withWaste,
} from "../src";

const s = defaultNumberSettings();

describe("formatNumber", () => {
  it("formats each kind at its default decimals", () => {
    expect(formatNumber("12480.5", "money", s)).toBe("$12,480.50");
    expect(formatNumber("1.8725", "unitCost", s)).toBe("$1.8725");
    expect(formatNumber("1250.75", "quantity", s)).toBe("1,250.75");
    expect(formatNumber(42, "count", s)).toBe("42");
    expect(formatNumber("38.4", "percent", s)).toBe("38.4%");
    expect(formatNumber("8.875", "taxRate", s)).toBe("8.875%");
    expect(formatNumber("1.0842", "fxRate", s)).toBe("1.0842");
  });

  it("supports both negative styles", () => {
    expect(formatNumber("-1234", "money", s)).toBe("-$1,234.00");
    expect(formatNumber("-1234", "money", { ...s, negativeStyle: "parens" })).toBe("($1,234.00)");
  });

  it("changes display only: money at 0 decimals rounds the shown value", () => {
    const zero = { ...s, decimals: { ...s.decimals, money: 0 } };
    expect(formatNumber("1234.56", "money", zero)).toBe("$1,235");
    expect(formatFull("1234.56", "money", zero)).toBe("$1,234.56");
    expect(isRounded("1234.56", "money", zero)).toBe(true);
  });

  it("applies per-column deltas inside the allowed range", () => {
    expect(formatNumber("1.23456", "money", s, { decimalsDelta: 1 })).toBe("$1.235");
    expect(formatNumber("1.23456", "money", s, { decimalsDelta: 9 })).toBe("$1.2346");
    expect(formatNumber("1.23456", "money", s, { decimalsDelta: -9 })).toBe("$1");
  });

  it("formats compact numbers", () => {
    expect(formatNumber("12400", "money", s, { compact: true })).toBe("$12.4K");
  });

  it("keeps full precision of decimal strings, up to the kind's maximum decimals", () => {
    // A float would lose the last digits of this value; decimal strings keep them.
    expect(formatFull("123456789012.3456", "unitCost", s)).toBe("$123,456,789,012.3456");
    expect(formatFull("0.12345678", "unitCost", s)).toBe("$0.1235");
  });

  it("drops the sign on values that round to zero", () => {
    expect(formatNumber("-0.001", "money", s)).toBe("$0.00");
  });
});

describe("units", () => {
  it("converts sq ft and sq yd", () => {
    expect(sqFtToSqYd(252).toString()).toBe("28");
    expect(rollAreaSqFt(12, "63").toString()).toBe("756");
  });

  it("rounds cartons up and applies waste", () => {
    expect(cartonsForArea(250, "23.64")).toBe(11);
    expect(withWaste(100, 10).toString()).toBe("110");
    expect(quantityForArea(252, 10, "sq_yd").toString()).toBe("30.8");
    expect(quantityForArea(300, 5, "carton", "23.64").toString()).toBe("14");
  });
});

describe("money", () => {
  it("sums exactly where floats drift", () => {
    expect(sum(["0.1", "0.2"]).toString()).toBe("0.3");
    expect(roundMoney("2.675").toString()).toBe("2.68");
    expect(moneyString(10)).toBe("10.00");
  });

  it("computes margin percent and handles zero revenue", () => {
    expect(marginPct(200, 150).toString()).toBe("25");
    expect(marginPct(0, 10).toString()).toBe("0");
  });
});

describe("full value on hover", () => {
  it("shows up to the kind's maximum decimals for computed ratios", () => {
    const settings = defaultNumberSettings();
    expect(formatFull("44.27325842696629213483", "percent", settings)).toBe("44.2733%");
    expect(isRounded("44.27325842696629213483", "percent", settings)).toBe(true);
    expect(isRounded("12.5", "percent", settings)).toBe(false);
  });
});
