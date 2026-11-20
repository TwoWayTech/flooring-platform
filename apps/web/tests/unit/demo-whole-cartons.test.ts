import { afterEach, describe, expect, it, vi } from "vitest";
import { dec, type CompanyId } from "@workspace/shared";
import { createPurchaseOrder } from "@/lib/api/demo/purchasing-actions";
import { CompanyDb } from "@/lib/api/demo/company-db";
import type { FileStore } from "@/lib/api/demo/file-store";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";
import type { ActionContext } from "@/lib/api/demo/payment-actions";
import { DemoStore } from "@/lib/api/demo/store";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/**
 * A seeded quote line the test turns into a part carton as the fixtures load, as a quote saved
 * before the rule would hold one; null loads the fixtures as they are.
 */
const PART_CARTON = vi.hoisted(() => ({ quoteId: null as string | null }));

vi.mock("@/lib/api/demo/fixtures", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api/demo/fixtures")>();
  return {
    ...real,
    loadCompanyFixtures: async (companyId: CompanyId) => {
      const fixtures = await real.loadCompanyFixtures(companyId);
      const quoteId = PART_CARTON.quoteId;
      if (!quoteId) return fixtures;
      const quotes = fixtures.quotes.map((quote) => {
        if (quote.id !== quoteId) return quote;
        const index = quote.lines.findIndex((line) => line.sqFtPerCarton);
        const lines = quote.lines.map((line, i) =>
          i === index
            ? { ...line, quantity: dec(line.quantity).plus(dec(line.sqFtPerCarton!).dividedBy(2)).toString() }
            : line,
        );
        return { ...quote, lines };
      });
      return { ...fixtures, quotes };
    },
  };
});

afterEach(() => {
  PART_CARTON.quoteId = null;
});

/** DemoStore refuses part cartons as the API does (F-m, ADR 0027; security review round 2, note 3). */
describe("demo whole cartons on purchase orders", () => {
  it("WC1 a boxed line that isn't whole cartons is refused with the API's words; whole cartons save", async () => {
    const fixtures = await loadCompanyFixtures("summit");
    const ctx: ActionContext = {
      db: new CompanyDb(fixtures, fixtures.anchorDate),
      today: fixtures.anchorDate,
      now: `${fixtures.anchorDate}T12:00:00.000Z`,
      actor: fixtures.users[0]!,
      files: noFiles,
      can: async () => true,
      assertCan: async () => undefined,
      audit: () => undefined,
      newId: (kind) => `${kind}-wc1`,
    };
    const product = fixtures.products.find((p) => p.sqFtPerCarton)!;
    const pack = product.sqFtPerCarton!;
    const order = (quantity: string) =>
      createPurchaseOrder(ctx, {
        supplierId: fixtures.suppliers[0]!.id,
        contactId: null,
        supplierRef: "",
        placedVia: null,
        expectedAt: fixtures.anchorDate,
        locationId: fixtures.locations.find((l) => l.kind === "warehouse")!.id,
        lines: [
          {
            id: "l1",
            productId: product.id,
            description: product.name,
            quantity,
            unit: "sq_ft",
            unitCost: product.cost,
            sqFtPerCarton: pack,
          },
        ],
        asDraft: true,
      });
    await expect(order("7")).rejects.toThrow(`${product.name}: order whole cartons, multiples of`);
    // A pack sent on the line is not the product's: 7 sq ft "of a 7 sq ft carton" is still refused.
    await expect(
      createPurchaseOrder(ctx, {
        supplierId: fixtures.suppliers[0]!.id,
        contactId: null,
        supplierRef: "",
        placedVia: null,
        expectedAt: fixtures.anchorDate,
        locationId: fixtures.locations.find((l) => l.kind === "warehouse")!.id,
        lines: [
          {
            id: "l1",
            productId: product.id,
            description: product.name,
            quantity: "7",
            unit: "sq_ft",
            unitCost: product.cost,
            sqFtPerCarton: "7",
          },
        ],
        asDraft: true,
      }),
    ).rejects.toThrow("order whole cartons");
    const saved = await order(dec(pack).times(3).toString());
    expect(saved.lines[0]!.quantity).toBe(dec(pack).times(3).toString());
  });

  it("WC2 the quote save refuses a part carton by the product's pack, even when the line leaves the pack out", async () => {
    const store = new DemoStore(noFiles);
    await store.openCompany("summit", { userId: "sm-usr-01", viewAsRoleId: null });
    const quote = (await store.list("quotes")).find(
      (q) => q.status === "draft" && q.lines.some((l) => l.sqFtPerCarton),
    )!;
    const index = quote.lines.findIndex((l) => l.sqFtPerCarton);
    const { sqFtPerCarton, ...bare } = quote.lines[index]!;
    const part = dec(bare.quantity).plus(dec(sqFtPerCarton!).dividedBy(2)).toString();
    const lines = quote.lines.map((line, i) => (i === index ? { ...bare, quantity: part } : line));
    await expect(store.saveQuote({ ...quote, lines })).rejects.toThrow("sell whole cartons, multiples of");
  });

  it("WC3 a seeded quote saves again unchanged and keeps the product's pack; a missing product is refused (review round 5)", async () => {
    const store = new DemoStore(noFiles);
    await store.openCompany("summit", { userId: "sm-usr-01", viewAsRoleId: null });
    const quote = (await store.list("quotes")).find(
      (q) => q.status === "draft" && q.lines.some((l) => l.sqFtPerCarton),
    );
    expect(quote, "Summit has a draft quote with a boxed line").toBeDefined();
    const index = quote!.lines.findIndex((l) => l.sqFtPerCarton);
    const productId = quote!.lines[index]!.productId!;
    const pack = (await store.list("products")).find((product) => product.id === productId)!.sqFtPerCarton;
    expect(pack).toBeDefined();
    // Saved again as it is, the quote is accepted and its boxed line keeps the product's pack.
    const again = await store.saveQuote(quote!);
    expect(again.lines[index]!.sqFtPerCarton).toBe(pack);
    // A pack sent on a line is replaced by the product's; a line without a product keeps none.
    const loose = { ...quote!.lines[index]!, id: "loose", productId: undefined, sqFtPerCarton: "7" };
    const sentLines = quote!.lines.map((line, i) => (i === index ? { ...line, sqFtPerCarton: "1" } : line));
    const stored = await store.saveQuote({ ...quote!, lines: [...sentLines, loose] });
    expect(stored.lines[index]!.sqFtPerCarton).toBe(pack);
    expect(stored.lines.find((line) => line.id === "loose")?.sqFtPerCarton).toBeUndefined();
    const gone = quote!.lines.map((line, i) => (i === index ? { ...line, productId: "prd-missing" } : line));
    await expect(store.saveQuote({ ...quote!, lines: gone })).rejects.toThrow(
      "A product on the quote no longer exists.",
    );
  });

  it("WC4 converting a quote that holds a part carton is refused, as on the API (review round 6)", async () => {
    const fixtures = await loadCompanyFixtures("summit");
    const accepted = fixtures.quotes.find(
      (q) => q.status === "accepted" && !q.invoiceId && q.lines.some((l) => l.sqFtPerCarton),
    );
    expect(accepted, "Summit has an accepted, unconverted quote with a boxed line").toBeDefined();
    PART_CARTON.quoteId = accepted!.id;
    const store = new DemoStore(noFiles);
    await store.openCompany("summit", { userId: "sm-usr-01", viewAsRoleId: null });
    await expect(store.convertQuoteToInvoice(accepted!.id)).rejects.toThrow("sell whole cartons, multiples of");
    expect((await store.list("quotes")).find((q) => q.id === accepted!.id)?.invoiceId ?? null).toBeNull();
  });
});
