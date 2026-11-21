import { describe, expect, it } from "vitest";
import { newestReceipts, slowMovers, type Invoice, type Product, type Roll, type SlowMoverMovement } from "../src";

const TODAY = "2026-11-21";

/** A boxed product added long ago; only the fields slow movers read matter. */
function product(id: string, createdAt = "2024-05-18"): Product {
  return { id, category: "hard_surface", unit: "sq_ft", createdAt } as unknown as Product;
}

function movement(productId: string, kind: SlowMoverMovement["kind"], at: string, quantity = "100"): SlowMoverMovement {
  return { productId, locationId: "wh", quantity, kind, at };
}

/** An invoice selling `productId` on `issuedAt`. */
function sale(productId: string, issuedAt: string): Invoice {
  return { isReturn: false, voidedAt: null, issuedAt, lines: [{ productId }] } as unknown as Invoice;
}

describe("slow movers count days in stock from the newest receipt (click-through #4)", () => {
  it("counts a product that never sold from its newest receipt, not from when it was added", () => {
    const moves = [movement("a", "receipt", "2026-09-01T10:00"), movement("a", "receipt", "2026-10-22T09:30")];
    const [row] = slowMovers([product("a")], [], [], TODAY, 5, moves);
    expect(row).toMatchObject({
      productId: "a",
      lastSoldAt: null,
      receivedAt: "2026-10-22T09:30",
      daysWithoutSale: 30,
    });
  });

  it("falls back to the day it was added only when it was never received", () => {
    const moves = [movement("b", "opening", "2026-01-01")];
    const [row] = slowMovers([product("b", "2026-11-01")], [], [], TODAY, 5, moves);
    expect(row).toMatchObject({ receivedAt: null, daysWithoutSale: 20 });
  });

  it("still counts a product that sold from its last sale", () => {
    const moves = [movement("c", "receipt", "2026-11-10")];
    const [row] = slowMovers([product("c")], [], [sale("c", "2026-08-23")], TODAY, 5, moves);
    expect(row).toMatchObject({ lastSoldAt: "2026-08-23", daysWithoutSale: 90 });
  });

  it("takes a roll's receipt as a receipt of its product", () => {
    const rolls = [{ productId: "d", receivedAt: "2026-11-11", remainingLengthFt: "40" }] as unknown as Roll[];
    expect(newestReceipts(rolls, [movement("d", "receipt", "2026-10-01")]).get("d")).toBe("2026-11-11");
    const [row] = slowMovers([product("d")], rolls, [], TODAY, 5, []);
    expect(row).toMatchObject({ onHandUnit: "ft", daysWithoutSale: 10 });
  });
});
