import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { bestSellersIn, type Product } from "@workspace/shared";
import { BestSellerBars, BestSellerTable } from "@/features/dashboard/best-sellers";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";
import { fakeApi } from "./fake-api";

const summit = await loadCompanyFixtures("summit");
const RANGE = { from: "2025-11-05", to: "2026-11-04" };
const rows = bestSellersIn(summit.invoices, summit.products, { ...RANGE, metric: "revenue", limit: 5 });
const named = (id: string) => summit.products.find((p) => p.id === id)!;

/** The markup's text with the tags taken out. */
const text = (html: string) => html.replace(/<[^>]+>/g, "");

/** The text of every `<td>` in the first column of a table's body. */
const firstCells = (html: string) =>
  [...html.matchAll(/<tr[^>]*><td[^>]*>(.*?)<\/td>/g)].map((m) => text(m[1]!).trim());

/**
 * Click-through #1 (2026-11-21): in api mode the dashboard's best sellers showed amounts with no
 * names, because the catalog came from the demo while the invoices came from the API, so no id
 * matched. Every row names its product, in bars and table, with its swatch when the catalog has it.
 */
describe("best sellers name every product (spec E1; click-through #1)", () => {
  it("has rows to show", () => {
    expect(rows.length).toBe(5);
  });

  it("names each bar, with its colour swatch", () => {
    const html = renderToStaticMarkup(<BestSellerBars rows={rows} products={summit.products} metric="revenue" />);
    for (const row of rows) {
      const product = named(row.productId);
      expect(text(html)).toContain(product.name);
      expect(html).toContain(`aria-label="${product.colorName}"`);
    }
  });

  it("names each row of the table in the Product column", () => {
    const html = renderToStaticMarkup(<BestSellerTable rows={rows} products={summit.products} marginShown={false} />);
    expect(firstCells(html)).toEqual(rows.map((row) => named(row.productId).name));
  });

  it("names each row from its invoice line when the catalog doesn't hold the product", () => {
    const strangers: Product[] = summit.products.map((p) => ({ ...p, id: `other-${p.id}` }));
    const unmatched = bestSellersIn(summit.invoices, strangers, { ...RANGE, metric: "revenue", limit: 5 });
    expect(unmatched.every((row) => row.name.trim().length > 0)).toBe(true);
    const table = renderToStaticMarkup(<BestSellerTable rows={unmatched} products={strangers} marginShown={false} />);
    expect(firstCells(table)).toEqual(unmatched.map((row) => row.name));
    const bars = text(renderToStaticMarkup(<BestSellerBars rows={unmatched} products={strangers} metric="quantity" />));
    for (const row of unmatched) expect(bars).toContain(row.name);
  });
});

describe("the dashboard's catalog and stock come from the API in api mode (click-through #1)", () => {
  it.each([
    ["products", "GET /products"],
    ["rolls", "GET /rolls"],
    ["stockMovements", "GET /stock-movements"],
  ] as const)("list(%s) sends %s", async (collection, call) => {
    const api = fakeApi({ [call]: { status: 200, body: [] } });
    expect(await api.client.list(collection)).toEqual([]);
    expect(api.calls()).toEqual([call]);
  });

  it("reads a list the person may not see (403) or a switched-off one (404) as empty", async () => {
    const api = fakeApi({ "GET /products": { status: 403, body: {} }, "GET /rolls": { status: 404, body: {} } });
    expect(await api.client.list("products")).toEqual([]);
    expect(await api.client.list("rolls")).toEqual([]);
  });
});
