import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { products } from "@workspace/db/company";
import { firstValueFrom, of } from "rxjs";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SensitiveFieldsInterceptor } from "../src/core/access/sensitive-fields";
import { PurchasingController } from "../src/modules/purchasing/purchasing.controller";
import { AuthHarness } from "./auth-harness";

/** Field names every plain object inherits from Object.prototype, with a value of their own. */
const INHERITED_NAMES = { constructor: "c", toString: "t", to_string: "s", valueOf: "v", hasOwnProperty: "h" };

/**
 * Finding F-l of the whole-product check: field stripping (CLAUDE.md rule 5) matches a response
 * field only by the map's own names, so a field named like an Object.prototype member is neither
 * stripped nor turned into a 500 on a route with its own keys.
 */
describe("sensitive-field stripping and Object.prototype names (F-l, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let productId = "";
  let sales = "";

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("ownkeys");
    const handle = await harness.companyDb(company.id);
    try {
      const [product] = await handle.db
        .insert(products)
        .values({
          sku: `T-${uuidv7()}`,
          name: "Slate Tile",
          category: "porcelain_tile" as const,
          unit: "sq_ft" as const,
          price: "4.5000",
          cost: "2.1000",
          sqFtPerCarton: "20",
          attributes: INHERITED_NAMES,
        })
        .returning({ id: products.id });
      productId = product.id;
    } finally {
      await handle.close();
    }
    sales = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("sends a product's attributes named like Object.prototype members, and still strips its cost", async () => {
    const answer = await request(harness.app.getHttpServer())
      .get("/products")
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", sales)
      .expect(200);
    const product = (answer.body as { id: string }[]).find((row) => row.id === productId);
    expect(product).toMatchObject({ name: "Slate Tile", attributes: INHERITED_NAMES });
    expect(product).not.toHaveProperty("cost");
  });

  it("passes such fields through a route with its own keys (GET /suppliers) unstripped, with no error", async () => {
    const interceptor = harness.app.get(SensitiveFieldsInterceptor);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ access: { permissions: new Set() } }) }),
      getHandler: () => PurchasingController.prototype.suppliers,
      getClass: () => PurchasingController,
    } as unknown as ExecutionContext;
    const body = [{ name: "Ridge Supply", creditLimit: "5000.00", ...INHERITED_NAMES }];
    const next: CallHandler = { handle: () => of(body) };
    expect(await firstValueFrom(interceptor.intercept(context, next))).toEqual([
      { name: "Ridge Supply", ...INHERITED_NAMES },
    ]);
  });
});
