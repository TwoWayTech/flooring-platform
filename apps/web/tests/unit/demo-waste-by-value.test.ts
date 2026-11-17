import { describe, expect, it } from "vitest";
import type { DocLine, Product, WasteCategory } from "@workspace/shared";
import { wasteChanged } from "@/lib/api/demo/permission-rules";

const TILE = { id: "p-tile", category: "porcelain_tile" } as Product;
const CARPET = { id: "p-carpet", category: "carpet" } as Product;
const PRODUCTS = [TILE, CARPET];

/** Summit's waste defaults: carpet 12, porcelain tile 10, every other category 8. */
const DEFAULTS: Record<WasteCategory, string> = {
  carpet: "12",
  carpet_tile: "8",
  lvp: "8",
  laminate: "8",
  engineered_hardwood: "8",
  solid_hardwood: "8",
  porcelain_tile: "10",
  pad: "8",
  adhesive_trim: "8",
};

/** A tile line unless said otherwise. */
function line(over: Partial<DocLine> = {}): DocLine {
  return {
    id: "l1",
    productId: TILE.id,
    description: "Tile",
    category: "material",
    unit: "sq_ft",
    quantity: "110",
    unitPrice: "4.50",
    unitCost: "2.10",
    ...over,
  };
}

/** Whether saving `sent` over `saved` (none: a new quote) changes waste. */
function changed(sent: DocLine, saved?: DocLine): boolean {
  return wasteChanged({ lines: [sent] }, saved ? { lines: [saved] } : undefined, PRODUCTS, DEFAULTS);
}

/**
 * DemoStore's waste rule (sales.md rule 8; STATUS B6): waste is compared by value, as the API's
 * `assertWaste` does, and a saved line is the same line only with the same id and product.
 */
describe("wasteChanged compares waste by value (B6)", () => {
  it("(a) a saved line's waste at stored scale is no change", () => {
    expect(changed(line({ wastePct: "10.00000000" }), line({ wastePct: "10" }))).toBe(false);
  });

  it("(b) a saved line stored at scale and sent as typed is no change", () => {
    expect(changed(line({ wastePct: "10" }), line({ wastePct: "10.00000000" }))).toBe(false);
  });

  it("(c) a saved line's real change is a change", () => {
    expect(changed(line({ wastePct: "10.0001" }), line({ wastePct: "10" }))).toBe(true);
  });

  it("(d) a new line at its default, written another way, is no change", () => {
    expect(changed(line({ wastePct: "10.0" }))).toBe(false);
  });

  it("(e) a new line off its default is a change", () => {
    expect(changed(line({ wastePct: "12" }))).toBe(true);
  });

  it("(f) a line without waste is no change", () => {
    expect(changed(line(), line({ wastePct: "10" }))).toBe(false);
  });

  it("(g) a saved line without waste, sent with 0, is no change", () => {
    expect(changed(line({ wastePct: "0" }), line())).toBe(false);
  });

  it("(h) text that is not a plain decimal is a change", () => {
    expect(changed(line({ wastePct: "abc" }), line({ wastePct: "10" }))).toBe(true);
  });

  it("(i) a line moved to another product starts from that product's default", () => {
    const saved = line({ wastePct: "10" });
    expect(changed(line({ productId: CARPET.id, wastePct: "10" }), saved)).toBe(true);
    expect(changed(line({ productId: CARPET.id, wastePct: "12" }), saved)).toBe(false);
  });

  it("(j) a saved line's waste sent back as the demo kept it, even with a bare point, is no change", () => {
    expect(changed(line({ wastePct: "12." }), line({ wastePct: "12." }))).toBe(false);
    expect(changed(line({ wastePct: ".5" }), line({ wastePct: ".5" }))).toBe(false);
    expect(changed(line({ wastePct: "12" }), line({ wastePct: "12." }))).toBe(true);
  });

  it("(k) a new line at a category default with a bare point is no change", () => {
    const defaults = { ...DEFAULTS, porcelain_tile: "10." };
    expect(wasteChanged({ lines: [line({ wastePct: "10." })] }, undefined, PRODUCTS, defaults)).toBe(false);
    expect(wasteChanged({ lines: [line({ wastePct: "10" })] }, undefined, PRODUCTS, defaults)).toBe(true);
  });

  it("(l) a line without a catalog product starts from a blank, read as 0", () => {
    const saved = line({ wastePct: "10" });
    expect(changed(line({ productId: undefined, wastePct: "50" }), saved)).toBe(true);
    expect(changed(line({ productId: undefined, wastePct: "0" }), saved)).toBe(false);
    expect(changed(line({ productId: "p-gone", wastePct: "50" }), saved)).toBe(true);
    expect(changed(line({ productId: "p-gone", wastePct: "0" }), saved)).toBe(false);
    expect(changed(line({ productId: undefined, wastePct: "50" }))).toBe(true);
  });
});
