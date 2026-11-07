import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dec,
  inventoryByCategory,
  inventoryValuation,
  salesByCategory,
  salesTaxByJurisdiction,
  sum,
  type CompanyFixtures,
} from "../src";

const summit = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "summit.json"), "utf8")) as CompanyFixtures;
const keystone = JSON.parse(
  readFileSync(join(__dirname, "..", "fixtures", "keystone.json"), "utf8"),
) as CompanyFixtures;
const signed = (f: CompanyFixtures, key: "subtotal" | "tax") =>
  sum(f.invoices.filter((i) => i.status !== "void").map((i) => dec(i[key]).times(i.isReturn ? -1 : 1)));

describe("reports reconcile with the documents", () => {
  it("sales by category add up to net invoiced sales", () => {
    for (const f of [summit, keystone]) {
      expect(sum(salesByCategory(f.invoices, f.products).map((r) => r.revenue)).toFixed(2)).toBe(
        signed(f, "subtotal").toFixed(2),
      );
    }
  });

  it("sales tax by jurisdiction adds up to tax on invoices, with exempt sales split out", () => {
    const rows = salesTaxByJurisdiction(keystone.invoices);
    expect(sum(rows.map((r) => r.tax)).toFixed(2)).toBe(signed(keystone, "tax").toFixed(2));
    expect(rows.some((r) => dec(r.exemptSales).gt(0))).toBe(true);
  });

  it("inventory by category adds up to the inventory valuation", () => {
    expect(sum(inventoryByCategory(summit.products, summit.rolls).map((r) => r.value)).toFixed(2)).toBe(
      inventoryValuation(summit.rolls, summit.products).total,
    );
  });
});
