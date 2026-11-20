import { describe, expect, it } from "vitest";
import { dec } from "@workspace/shared";
import { createPurchaseOrder } from "@/lib/api/demo/purchasing-actions";
import { CompanyDb } from "@/lib/api/demo/company-db";
import type { FileStore } from "@/lib/api/demo/file-store";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";
import type { ActionContext } from "@/lib/api/demo/payment-actions";

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
});
