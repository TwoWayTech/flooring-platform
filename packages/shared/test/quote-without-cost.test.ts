import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeTotals,
  EXAMPLE_TAX_RULES,
  invoiceFromQuote,
  quoteLineFor,
  ruleForState,
  storedCost,
  type CompanyFixtures,
  type Customer,
  type DocLine,
  type DocumentTotals,
  type LocalizationSettings,
  type Quote,
  type TaxContext,
  type ViewedDocLine,
} from "../src";
import { SALES, strippedFor } from "./viewed-records";

const load = (name: string): CompanyFixtures =>
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", `${name}.json`), "utf8")) as CompanyFixtures;
const summit = load("summit");
const keystone = load("keystone");

/** The totals a viewer without cost gets: the same as with cost, except that every cost and margin is unknown. */
function withoutCost(full: DocumentTotals): DocumentTotals {
  return {
    ...full,
    cost: null,
    margin: null,
    marginPct: null,
    lines: full.lines.map((line) => ({ ...line, cost: null })),
  };
}

const CO_LINE: TaxContext = { rule: ruleForState(EXAMPLE_TAX_RULES, "CO"), exempt: false, rounding: "line" };
const NJ_INVOICE: TaxContext = { rule: ruleForState(EXAMPLE_TAX_RULES, "NJ"), exempt: false, rounding: "invoice" };

/** 100 sq ft of tile at 4.50 (cost 2.10) and 100 sq ft of installation at 1.75 (cost 1.00). */
const LINES: DocLine[] = [
  {
    id: "tile",
    productId: "p-tile",
    description: "Slate Tile",
    category: "material",
    unit: "sq_ft",
    quantity: "100",
    unitPrice: "4.50",
    unitCost: "2.10",
  },
  {
    id: "install",
    description: "Installation",
    category: "labor",
    unit: "sq_ft",
    quantity: "100",
    unitPrice: "1.75",
    unitCost: "1.00",
  },
];

/** The lines as the API sends them to a salesperson: no `unitCost`. */
const STRIPPED: ViewedDocLine[] = LINES.map((line) => strippedFor(line, SALES));

describe("a cost the server withheld (sales.md rule 13; ADR 0037, 2026-11-16)", () => {
  it("strips as the API strips: a salesperson's lines carry no unitCost", () => {
    expect(STRIPPED.every((line) => !("unitCost" in line))).toBe(true);
    expect(STRIPPED.map((line) => line.unitPrice)).toEqual(["4.50", "1.75"]);
  });

  it.each([
    ["CO, tax per line", CO_LINE],
    ["NJ, tax per invoice", NJ_INVOICE],
  ])("leaves cost and margin unknown without unitCost, and every amount as it was (%s)", (_, ctx) => {
    const full = computeTotals(LINES, ctx);
    expect(full.cost).toBe("310.00");
    expect(computeTotals(STRIPPED, ctx)).toEqual(withoutCost(full));
  });

  it("treats unitCost: undefined, as an own property, and unitCost: null like a missing one", () => {
    const full = computeTotals(LINES, CO_LINE);
    const undefinedCost: ViewedDocLine[] = LINES.map((line) => ({ ...line, unitCost: undefined }));
    const nullCost: ViewedDocLine[] = LINES.map((line) => ({ ...line, unitCost: null }));
    expect(computeTotals(undefinedCost, CO_LINE)).toEqual(withoutCost(full));
    expect(computeTotals(nullCost, CO_LINE)).toEqual(withoutCost(full));
  });

  it("never adds up part of the cost: one line without cost leaves the document's cost and margin unknown", () => {
    const mixed: ViewedDocLine[] = [LINES[0]!, STRIPPED[1]!];
    const totals = computeTotals(mixed, CO_LINE);
    expect([totals.cost, totals.margin, totals.marginPct]).toEqual([null, null, null]);
    expect(totals.lines.map((line) => line.cost)).toEqual(["210.00", null]);
    expect(totals.total).toBe(computeTotals(LINES, CO_LINE).total);
  });

  it("gives a document with no lines a cost and margin of zero, as before", () => {
    const totals = computeTotals([], CO_LINE);
    expect([totals.cost, totals.margin, totals.marginPct]).toEqual(["0.00", "0.00", "0"]);
  });

  describe.each([summit, keystone].map((f) => [f.companyId, f] as const))(
    "every %s fixture quote and invoice, as a salesperson receives it",
    (_, f) => {
      const ctx: TaxContext = {
        rule: f.settings.localization.tax.rules[0],
        exempt: false,
        rounding: f.settings.localization.tax.rounding,
      };
      // A credit note issued in the app has no lines (ADR 0025), so nothing of it is withheld.
      const documents = [...f.quotes, ...f.invoices.filter((invoice) => !invoice.contractId)].filter(
        (document) => document.lines.length > 0,
      );

      it("has the same amounts, tax and total, and no cost or margin", () => {
        expect(documents.length).toBeGreaterThan(0);
        for (const document of documents) {
          const seen = strippedFor(document, SALES);
          expect(
            seen.lines.some((line) => "unitCost" in line),
            document.id,
          ).toBe(false);
          expect(computeTotals(seen.lines, ctx), document.id).toEqual(withoutCost(computeTotals(document.lines, ctx)));
        }
      });
    },
  );
});

describe("storedCost: a document being stored never takes a guessed cost (ADR 0037, 2026-11-16)", () => {
  it("returns a known cost", () => {
    expect(storedCost(computeTotals(LINES, CO_LINE))).toBe("310.00");
  });

  it("refuses an unknown one", () => {
    expect(() => storedCost(computeTotals(STRIPPED, CO_LINE))).toThrow(
      "A document line has no cost, so the document can't be stored.",
    );
  });
});

describe("invoiceFromQuote stores the quote's cost, or refuses to (ADR 0037, 2026-11-16)", () => {
  const localization = {
    tax: {
      pricesInclude: "exclusive",
      rounding: "invoice",
      rules: [...EXAMPLE_TAX_RULES],
      jurisdictions: [],
      companyDefault: null,
      filing: [],
      certificateTypes: [],
    },
    region: { statesOfOperation: ["CO"] },
  } as unknown as Pick<LocalizationSettings, "tax" | "region">;
  const customer = { id: "c1", terms: "net_30", taxExempt: false, certificate: null } as unknown as Customer;
  /** 100 sq ft of tile at cost 2.10 and one hour of labor at cost 50.00: a cost of 260.00. */
  const lines: DocLine[] = [
    LINES[0]!,
    {
      id: "hour",
      description: "Floor prep",
      category: "labor",
      unit: "hour",
      quantity: "1",
      unitPrice: "85.00",
      unitCost: "50.00",
    },
  ];
  const quote = (quoteLines: DocLine[]) =>
    ({
      id: "q1",
      salesRepId: "u1",
      branchId: "b1",
      locationId: "l1",
      depositPct: "0",
      jobSite: { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" },
      lines: quoteLines,
      lumpSum: false,
      taxOverride: null,
    }) as unknown as Quote;
  const input = { id: "i1", number: "INV-1228", issuedAt: "2026-11-16", createdBy: "u1" };

  it("stores the cost worked out from every line", () => {
    expect(invoiceFromQuote(quote(lines), customer, localization, input).cost).toBe("260.00");
  });

  it("refuses a line whose cost was withheld, so nothing is stored with a guessed cost", () => {
    const seen = lines.map((line) => strippedFor(line, SALES));
    expect(() => invoiceFromQuote(quote(seen), customer, localization, input)).toThrow(
      "A document line has no cost, so the document can't be stored.",
    );
  });
});

describe("quoteLineFor never fills in a cost (sales.md rule 13; ADR 0037, 2026-11-16)", () => {
  const product = summit.products.find((p) => p.category !== "service" && p.sqFtPerCarton)!;
  const waste = summit.settings.localization.documents.defaultWastePct;

  it("gives a salesperson's product a line with no unitCost, so the request carries none and margin is unknown", () => {
    const line = quoteLineFor(strippedFor(product, SALES), "draft-1", [], waste);
    expect("unitCost" in JSON.parse(JSON.stringify(line))).toBe(false);
    const totals = computeTotals([line], CO_LINE);
    expect([totals.cost, totals.margin, totals.marginPct]).toEqual([null, null, null]);
  });

  it("keeps the product's cost for someone who received it", () => {
    expect(quoteLineFor(product, "draft-1", [], waste).unitCost).toBe(product.cost);
  });
});
