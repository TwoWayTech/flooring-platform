import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeTotals,
  dec,
  defaultWastePct,
  EXAMPLE_TAX_RULES,
  invoiceFromQuote,
  nextNumber,
  quoteLineFor,
  remeasureLines,
  savedQuoteLine,
  taxContextFor,
  type Customer,
  type DocLine,
  type LocalizationSettings,
  type Product,
  type CompanyFixtures,
  type Quote,
} from "../src";

const summit = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/summit.json", import.meta.url)), "utf8"),
) as CompanyFixtures;

const tax = {
  pricesInclude: "exclusive",
  rounding: "invoice",
  rules: [...EXAMPLE_TAX_RULES],
  jurisdictions: [],
  companyDefault: null,
  filing: [],
  certificateTypes: [],
} as LocalizationSettings["tax"];
const localization = { tax, region: { statesOfOperation: ["NJ", "CO"] } } as Pick<
  LocalizationSettings,
  "tax" | "region"
>;
const lvp = { id: "lvp", unit: "sq_ft", sqFtPerCarton: "23.64", category: "lvp" } as Product;
const rooms = [
  { id: "living", name: "Living room", x: 0, y: 0, widthFt: "14", lengthFt: "18" },
  { id: "hall", name: "Hall", x: 16, y: 0, widthFt: "4", lengthFt: "12" },
];
const lines: DocLine[] = [
  {
    id: "m",
    productId: "lvp",
    description: "LVP",
    category: "material",
    unit: "sq_ft",
    quantity: "1",
    unitPrice: "80.00",
    unitCost: "48.00",
    wastePct: "8",
    roomIds: ["living", "hall"],
  },
  {
    id: "l",
    description: "Install",
    category: "labor",
    unit: "sq_ft",
    quantity: "1",
    unitPrice: "2.75",
    unitCost: "1.55",
    roomIds: ["living", "hall"],
  },
  {
    id: "s",
    description: "Moving",
    category: "service",
    unit: "each",
    quantity: "2",
    unitPrice: "65.00",
    unitCost: "30.00",
  },
];
const customer = { id: "c1", terms: "net_30", taxExempt: false, certificate: null } as unknown as Customer;

describe("quote rules", () => {
  it("re-measures lines tied to rooms: cartons with waste for materials, net sq ft for labor", () => {
    const [material, labor, service] = remeasureLines(lines, rooms, [lvp]);
    // 252 + 48 = 300 sq ft; with 8 % waste 324 sq ft; 324 / 23.64 = 13.7 → 14 cartons.
    expect(material!.quantity).toBe("330.96");
    expect(labor!.quantity).toBe("300");
    expect(service!.quantity).toBe("2");
  });

  it("taxes installation labor in NJ but not in CO (job-site state)", () => {
    const measured = remeasureLines(lines, rooms, [lvp]);
    const nj = computeTotals(measured, taxContextFor(localization, { state: "NJ" }, customer, "2026-11-07", false));
    const co = computeTotals(measured, taxContextFor(localization, { state: "CO" }, customer, "2026-11-07", false));
    expect(nj.lines.find((l) => l.id === "l")!.taxable).toBe(true);
    expect(co.lines.find((l) => l.id === "l")!.taxable).toBe(false);
    expect(dec(nj.tax).gt(co.tax) || nj.ratePct !== co.ratePct).toBe(true);
  });

  it("collects nothing in a state without a rule", () => {
    expect(taxContextFor(localization, { state: "OR" }, customer, "2026-11-07", false).rule).toBeUndefined();
  });

  it("numbers the next document after the highest used", () => {
    expect(nextNumber("INV-", ["INV-1001", "INV-1227", "CR-5001"], 1001)).toBe("INV-1228");
    expect(nextNumber("Q-", [], 2001)).toBe("Q-2001");
  });

  it("converts a quote into an invoice with the same total and the rule version it used", () => {
    const measured = remeasureLines(lines, rooms, [lvp]);
    const quote = {
      id: "q1",
      salesRepId: "u1",
      branchId: "b1",
      jobSite: { street: "", city: "Trenton", state: "NJ", zip: "08601" },
      lines: measured,
      lumpSum: false,
      taxOverride: null,
    } as Quote;
    const invoice = invoiceFromQuote(quote, customer, localization, {
      id: "i1",
      number: "INV-1228",
      issuedAt: "2026-11-07",
      createdBy: "u1",
    });
    const expected = computeTotals(
      measured,
      taxContextFor(localization, { state: "NJ" }, customer, "2026-11-07", false),
    );
    expect(invoice.total).toBe(expected.total);
    expect(invoice.dueAt).toBe("2026-12-07");
    expect(invoice.taxRule).toMatchObject({ state: "NJ", version: 1 });
    expect(invoice).toMatchObject({ sentAt: null, voidedAt: null, depositPct: quote.depositPct, createdBy: "u1" });
    expect(invoice).not.toHaveProperty("paid");
  });
});

describe("default waste (spec B3)", () => {
  const defaults = summit.settings.localization.documents.defaultWastePct;
  it("starts a material line at its category's default and gives services none", () => {
    expect(defaultWastePct({ category: "carpet" }, defaults)).toBe("12");
    expect(defaultWastePct({ category: "porcelain_tile" }, defaults)).toBe("10");
    expect(defaultWastePct({ category: "lvp" }, { ...defaults, lvp: "15" })).toBe("15");
    expect(defaultWastePct({ category: "service" }, defaults)).toBeUndefined();
  });
});

describe("the saved line a sent quote line stands for (sales.md rule 8; B6 review round 1)", () => {
  const tile: DocLine = {
    id: "l1",
    productId: "p-tile",
    description: "Slate Tile",
    category: "material",
    unit: "sq_ft",
    quantity: "110",
    unitPrice: "4.50",
    unitCost: "2.10",
    wastePct: "10",
  };
  const haul: DocLine = {
    id: "l2",
    description: "Haul away",
    category: "service",
    unit: "each",
    quantity: "1",
    unitPrice: "50.00",
    unitCost: "20.00",
  };
  const saved = [tile, haul];

  it("is the saved line with the same id and product", () => {
    expect(savedQuoteLine(saved, { id: "l1", productId: "p-tile" })).toBe(tile);
    expect(savedQuoteLine(saved, { id: "l2" })).toBe(haul);
    expect(savedQuoteLine(saved, { id: "l2", productId: "" })).toBe(haul);
  });

  it("is none for a line with another product, without the product it had, or with one it lacked", () => {
    expect(savedQuoteLine(saved, { id: "l1", productId: "p-carpet" })).toBeUndefined();
    expect(savedQuoteLine(saved, { id: "l1" })).toBeUndefined();
    expect(savedQuoteLine(saved, { id: "l1", productId: "" })).toBeUndefined();
    expect(savedQuoteLine(saved, { id: "l2", productId: "p-tile" })).toBeUndefined();
    expect(savedQuoteLine(saved, { id: "l9", productId: "p-tile" })).toBeUndefined();
    expect(savedQuoteLine(undefined, { id: "l1", productId: "p-tile" })).toBeUndefined();
  });
});

describe("a new quote line (spec Quote builder)", () => {
  const waste = summit.settings.localization.documents.defaultWastePct;
  /** A catalog product with only the fields a line reads made distinct. */
  const product = (fields: Partial<Product>): Product => ({
    id: "p1",
    sku: "TV-1001",
    name: "Weathered Pier",
    brand: "Tidewater Vinyl",
    collection: "",
    colorName: "",
    swatch: "",
    category: "lvp",
    unit: "sq_ft",
    price: "4.25",
    cost: "2.10",
    attributes: {},
    supplierId: "s1",
    createdAt: "2026-01-01",
    ...fields,
  });

  it("ties a boxed material sold per sq ft to every room, with its category's waste and carton size", () => {
    expect(quoteLineFor(product({ sqFtPerCarton: "23.64" }), "draft-1", rooms, waste)).toEqual({
      id: "draft-1",
      productId: "p1",
      description: "Tidewater Vinyl Weathered Pier",
      category: "material",
      unit: "sq_ft",
      quantity: "1",
      unitPrice: "4.25",
      unitCost: "2.10",
      sqFtPerCarton: "23.64",
      wastePct: waste.lvp,
      roomIds: ["living", "hall"],
    });
  });

  it("ties a material to no room while the quote has none", () => {
    const line = quoteLineFor(product({ sqFtPerCarton: "23.64" }), "draft-1", [], waste);
    expect(line).not.toHaveProperty("roomIds");
    expect(line.wastePct).toBe(waste.lvp);
  });

  it("ties installation sold per sq ft to the rooms, with no waste, by its name and taxed as labor", () => {
    const install = product({ category: "service", name: "LVP installation", attributes: { taxCategory: "labor" } });
    const line = quoteLineFor(install, "draft-2", rooms, waste);
    expect(line).toMatchObject({ description: "LVP installation", category: "labor", roomIds: ["living", "hall"] });
    expect(line).not.toHaveProperty("wastePct");
  });

  it("gives a service sold per each one unit, tied to no room", () => {
    const moving = product({
      category: "service",
      unit: "each",
      name: "Furniture moving",
      attributes: { taxCategory: "service" },
    });
    const line = quoteLineFor(moving, "draft-3", rooms, waste);
    expect(line).toMatchObject({ quantity: "1", category: "service", unit: "each", description: "Furniture moving" });
    expect(line).not.toHaveProperty("roomIds");
  });
});
