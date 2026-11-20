import { describe, expect, it } from "vitest";
import { dec } from "@workspace/shared";
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
});
