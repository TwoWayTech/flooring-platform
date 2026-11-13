import { auditLog, branches, locations, products, rolls, stockMovements } from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { eq } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";

/** What a test company holds: two warehouses, a showroom, a boxed product with stock and a carpet roll. */
interface Stock {
  warehouseA: string;
  warehouseB: string;
  showroom: string;
  tile: string;
  carpet: string;
  roll: string;
}

/**
 * Inventory, part 1 (docs/product-spec/inventory.md; ADR 0035): reads with cost stripping,
 * transfers end to end, stock correction, roll moves, refusals, audit and company isolation.
 */
describe("inventory part 1 (P11, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let other = { id: "", slug: "" };
  let stock: Stock;
  let otherStock: Stock;
  const cookies: Record<"sales" | "manager" | "warehouse", string> = { sales: "", manager: "", warehouse: "" };
  let owner = "";

  function call(method: "get" | "post" | "patch", path: string, cookie: string) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
  }

  /** Puts a small catalog into a company database, as the seed would. */
  async function addStock(companyId: string): Promise<Stock> {
    const handle = await harness.companyDb(companyId);
    try {
      const address = { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" };
      const [branch] = await handle.db
        .insert(branches)
        .values({ name: "Main", city: "Austin", state: "TX" })
        .returning();
      const [a, b, showroom] = await handle.db
        .insert(locations)
        .values([
          { name: "Warehouse A", kind: "warehouse" as const, branchId: branch.id, address, isDefault: true },
          { name: "Warehouse B", kind: "warehouse" as const, branchId: branch.id, address },
          { name: "Showroom", kind: "showroom" as const, branchId: branch.id, address },
        ])
        .returning();
      const [tile, carpet] = await handle.db
        .insert(products)
        .values([
          {
            sku: `T-${uuidv7()}`,
            name: "Slate Tile",
            category: "porcelain_tile" as const,
            unit: "sq_ft" as const,
            price: "4.5000",
            cost: "2.1000",
            sqFtPerCarton: "20",
          },
          {
            sku: `C-${uuidv7()}`,
            name: "Harbor Carpet",
            category: "carpet" as const,
            unit: "sq_ft" as const,
            price: "3.0000",
            cost: "1.4000",
            widthFt: "12",
          },
        ])
        .returning();
      await handle.db.insert(stockMovements).values({
        at: new Date(),
        productId: tile.id,
        locationId: a.id,
        quantity: "200",
        kind: "opening",
        sourceType: "count",
        sourceId: uuidv7(),
        sourceNumber: "OPEN",
      });
      const [roll] = await handle.db
        .insert(rolls)
        .values({
          rollNumber: `R-${uuidv7()}`,
          productId: carpet.id,
          dyeLot: "L1",
          widthFt: "12",
          originalLengthFt: "100",
          remainingLengthFt: "100",
          costPerSqFt: "1.4000",
          locationId: a.id,
          bin: "A-1",
          receivedAt: new Date(),
        })
        .returning();
      return {
        warehouseA: a.id,
        warehouseB: b.id,
        showroom: showroom.id,
        tile: tile.id,
        carpet: carpet.id,
        roll: roll.id,
      };
    } finally {
      await handle.close();
    }
  }

  async function enrolledOwner(companyId: string): Promise<string> {
    const email = await harness.addUser({ companyIds: [companyId], roles: ["owner"] });
    const first = await harness.signIn(email);
    const enabled = await harness.post("/api/auth/two-factor/enable").set("Cookie", first).send({ password: PASSWORD });
    const secret = totpSecretFromUri(enabled.body.totpURI as string);
    const confirmed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", first)
      .send({ code: totpCode(secret) });
    return sessionCookie(confirmed.headers["set-cookie"]);
  }

  async function onHand(productId: string, locationId: string): Promise<string> {
    const ledger = await call("get", "/stock-movements", cookies.manager).expect(200);
    return ledger.body
      .filter(
        (movement: { productId: string; locationId: string }) =>
          movement.productId === productId && movement.locationId === locationId,
      )
      .reduce((sum: number, movement: { quantity: string }) => sum + Number(movement.quantity), 0)
      .toString();
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("stock");
    other = await harness.provisionCompany("stockother");
    stock = await addStock(company.id);
    otherStock = await addStock(other.id);
    for (const role of ["sales", "manager", "warehouse"] as const) {
      cookies[role] = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: [role] }));
    }
    owner = await enrolledOwner(company.id);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("strips product and roll cost from anyone without inventory.product.view_sensitive", async () => {
    const forSales = await call("get", "/products", cookies.sales).expect(200);
    const tile = forSales.body.find((product: { id: string }) => product.id === stock.tile);
    expect(tile.name).toBe("Slate Tile");
    expect(tile).not.toHaveProperty("cost");
    const forManager = await call("get", "/products", cookies.manager).expect(200);
    expect(forManager.body.find((product: { id: string }) => product.id === stock.tile).cost).toBe("2.1000");
    const salesRolls = await call("get", "/rolls", cookies.sales).expect(200);
    expect(salesRolls.body[0]).not.toHaveProperty("costPerSqFt");
    expect((await call("get", "/locations", cookies.sales).expect(200)).body).toHaveLength(3);
  });

  it("moves boxed stock and a roll between warehouses, and receives each transfer once", async () => {
    const started = await call("post", "/transfers", cookies.warehouse)
      .send({
        fromId: stock.warehouseA,
        toId: stock.warehouseB,
        lines: [
          { productId: stock.tile, rollId: null, quantity: "40" },
          { productId: stock.carpet, rollId: stock.roll, quantity: "100" },
        ],
        note: "Restock B",
      })
      .expect(201);
    expect(started.body).toMatchObject({ number: "TR-1001", status: "in_transit" });
    expect(await onHand(stock.tile, stock.warehouseA)).toBe("160");
    const travelling = (await call("get", "/rolls", cookies.manager)).body.find(
      (roll: { id: string }) => roll.id === stock.roll,
    );
    expect(travelling.transferId).toBe(started.body.id);

    const received = await call("post", `/transfers/${started.body.id}/receive`, cookies.warehouse).expect(201);
    expect(received.body.status).toBe("received");
    expect(await onHand(stock.tile, stock.warehouseB)).toBe("40");
    const arrived = (await call("get", "/rolls", cookies.manager)).body.find(
      (roll: { id: string }) => roll.id === stock.roll,
    );
    expect(arrived).toMatchObject({ locationId: stock.warehouseB, bin: "Receiving", transferId: null });
    const again = await call("post", `/transfers/${started.body.id}/receive`, cookies.warehouse);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("already_received");
  });

  it("refuses a transfer that spends more than on hand, breaks a carton, uses a showroom, or comes from Sales", async () => {
    const send = (lines: unknown[], toId = stock.warehouseB, cookie = cookies.warehouse) =>
      call("post", "/transfers", cookie).send({ fromId: stock.warehouseA, toId, lines, note: "" });
    expect((await send([{ productId: stock.tile, rollId: null, quantity: "9000" }])).body.code).toBe(
      "invalid_transfer",
    );
    expect((await send([{ productId: stock.tile, rollId: null, quantity: "30" }])).body.message).toContain(
      "whole cartons",
    );
    expect(
      (await send([{ productId: stock.tile, rollId: null, quantity: "20" }], stock.showroom)).body.message,
    ).toContain("Showrooms");
    expect(
      (await send([{ productId: stock.tile, rollId: null, quantity: "20" }], stock.warehouseB, cookies.sales)).status,
    ).toBe(403);
    // One product split over several lines is added up (PR #12 security review).
    const onHandNow = Number(await onHand(stock.tile, stock.warehouseA));
    const split = await send([
      { productId: stock.tile, rollId: null, quantity: String(onHandNow) },
      { productId: stock.tile, rollId: null, quantity: String(onHandNow) },
    ]);
    expect(split.body.code).toBe("invalid_transfer");
    expect(await onHand(stock.tile, stock.warehouseA)).toBe(String(onHandNow));
    const mislabelled = await send([{ productId: stock.tile, rollId: stock.roll, quantity: "1" }]);
    expect(mislabelled.status).toBe(400);
  });

  it("lets the Owner correct a count with a reason, and nobody else", async () => {
    const before = await onHand(stock.tile, stock.warehouseA);
    const refused = await call("post", "/stock/corrections", cookies.manager).send({
      productId: stock.tile,
      rollId: null,
      locationId: stock.warehouseA,
      counted: "100",
      reason: "Cycle count",
    });
    expect(refused.status).toBe(403);
    const corrected = await call("post", "/stock/corrections", owner)
      .send({
        productId: stock.tile,
        rollId: null,
        locationId: stock.warehouseA,
        counted: "100",
        reason: "Cycle count",
      })
      .expect(201);
    expect(corrected.body).toMatchObject({
      reason: "count",
      status: "approved",
      quantity: (100 - Number(before)).toString(),
    });
    expect(await onHand(stock.tile, stock.warehouseA)).toBe("100");
    const same = await call("post", "/stock/corrections", owner).send({
      productId: stock.tile,
      rollId: null,
      locationId: stock.warehouseA,
      counted: "100",
      reason: "Again",
    });
    expect(same.body.message).toBe("That is what the books already say.");
    const roll = await call("post", "/stock/corrections", owner)
      .send({
        productId: stock.carpet,
        rollId: stock.roll,
        locationId: stock.warehouseB,
        counted: "92.5",
        reason: "Measured",
      })
      .expect(201);
    expect(roll.body.quantity).toBe("-7.5");
    const measured = (await call("get", "/rolls", cookies.manager)).body.find(
      (item: { id: string }) => item.id === stock.roll,
    );
    expect(measured.remainingLengthFt).toBe("92.500");
    expect(measured.cuts.at(-1)).toMatchObject({ lengthFt: "7.500", reference: roll.body.number });
  });

  it("adds length back for a count above the books, and refuses too many decimals", async () => {
    const before = (await call("get", "/rolls", cookies.manager)).body.find(
      (item: { id: string }) => item.id === stock.roll,
    );
    const raised = Number(before.remainingLengthFt) + 2;
    const up = await call("post", "/stock/corrections", owner)
      .send({
        productId: stock.carpet,
        rollId: stock.roll,
        locationId: before.locationId,
        counted: String(raised),
        reason: "Found more",
      })
      .expect(201);
    expect(up.body.quantity).toBe("2");
    const after = (await call("get", "/rolls", cookies.manager)).body.find(
      (item: { id: string }) => item.id === stock.roll,
    );
    expect(Number(after.remainingLengthFt)).toBe(raised);
    expect(after.cuts.at(-1).lengthFt).toBe("-2.000");
    const precise = await call("post", "/stock/corrections", owner).send({
      productId: stock.carpet,
      rollId: stock.roll,
      locationId: before.locationId,
      counted: "1.234",
      reason: "Precise",
    });
    expect(precise.status).toBe(201);
  });

  it("moves a roll to another bin and changes nothing else", async () => {
    const moved = await call("patch", `/rolls/${stock.roll}`, cookies.warehouse).send({ bin: "B-7" }).expect(200);
    expect(moved.body.bin).toBe("B-7");
    const widened = await call("patch", `/rolls/${stock.roll}`, cookies.warehouse).send({
      bin: "B-8",
      remainingLengthFt: "999",
    });
    expect(widened.status).toBe(400);
    expect((await call("patch", `/rolls/${stock.roll}`, cookies.sales).send({ bin: "X" })).status).toBe(403);
  });

  it("never reaches another company's rolls or transfers", async () => {
    const missing = await call("patch", `/rolls/${otherStock.roll}`, cookies.warehouse).send({ bin: "Stolen" });
    expect(missing.status).toBe(404);
    const crossed = await call("post", "/transfers", cookies.warehouse).send({
      fromId: otherStock.warehouseA,
      toId: otherStock.warehouseB,
      lines: [{ productId: otherStock.tile, rollId: null, quantity: "20" }],
      note: "",
    });
    expect(crossed.status).toBe(400);
    const theirs = await harness.companyDb(other.id);
    try {
      const [roll] = await theirs.db.select().from(rolls).where(eq(rolls.id, otherStock.roll));
      expect(roll.bin).toBe("A-1");
    } finally {
      await theirs.close();
    }
  });

  it("audits every stock change", async () => {
    const handle = await harness.companyDb(company.id);
    try {
      const actions = (await handle.db.select({ action: auditLog.action }).from(auditLog)).map((row) => row.action);
      expect(actions).toEqual(
        expect.arrayContaining(["Started transfer", "Received transfer", "Corrected stock count", "Moved roll"]),
      );
    } finally {
      await handle.close();
    }
  });
});
