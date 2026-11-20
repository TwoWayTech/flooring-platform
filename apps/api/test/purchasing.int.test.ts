import { auditLog, branches, locations, products, stockMovements } from "@workspace/db/company";
import { eq } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness } from "./auth-harness";

/** A company's warehouses and two products, as the seed would give it. */
interface Catalog {
  warehouse: string;
  showroom: string;
  tile: string;
  carpet: string;
}

/**
 * Purchasing, part 1 (docs/product-spec/purchasing.md; ADR 0036): the supplier directory, orders,
 * receipts bringing stock in, money fields, refusals, audit and company isolation.
 */
describe("purchasing part 1 (P11, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let other = { id: "", slug: "" };
  let catalog: Catalog;
  let otherCatalog: Catalog;
  const cookies: Record<"purchasing" | "warehouse" | "sales" | "otherPurchasing", string> = {
    purchasing: "",
    warehouse: "",
    sales: "",
    otherPurchasing: "",
  };

  function call(method: "get" | "post" | "put", path: string, cookie: string) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
  }

  async function addCatalog(companyId: string): Promise<Catalog> {
    const handle = await harness.companyDb(companyId);
    try {
      const address = { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" };
      const [branch] = await handle.db
        .insert(branches)
        .values({ name: "Main", city: "Austin", state: "TX" })
        .returning();
      const [warehouse, showroom] = await handle.db
        .insert(locations)
        .values([
          { name: "Warehouse", kind: "warehouse" as const, branchId: branch.id, address, isDefault: true },
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
      return { warehouse: warehouse.id, showroom: showroom.id, tile: tile.id, carpet: carpet.id };
    } finally {
      await handle.close();
    }
  }

  async function supplierWithContact(cookie: string, name: string) {
    const supplier = await call("post", "/suppliers", cookie).send({ name, email: "orders@example.test" }).expect(201);
    const contact = await call("post", "/supplier-contacts", cookie)
      .send({
        supplierId: supplier.body.id,
        name: "Sonny Rep",
        role: "sales_rep",
        mobile: "",
        officePhone: "(555) 010-2000",
        email: "sonny@example.test",
        whatsapp: false,
        preferredMethod: "email",
        notes: "",
        isPrimary: false,
      })
      .expect(201);
    return { supplier: supplier.body.id as string, contact: contact.body.id as string };
  }

  function orderBody(supplier: string, contact: string | null, target: Catalog, asDraft = false) {
    return {
      supplierId: supplier,
      contactId: contact,
      supplierRef: "",
      placedVia: "email",
      expectedAt: "2026-12-01",
      locationId: target.warehouse,
      lines: [
        { productId: target.tile, description: "Slate Tile", quantity: "100", unit: "sq_ft", unitCost: "2.1000" },
        { productId: target.carpet, description: "Harbor Carpet", quantity: "1200", unit: "sq_ft", unitCost: "1.4000" },
      ],
      asDraft,
    };
  }

  async function onHand(companyId: string, productId: string): Promise<number> {
    const handle = await harness.companyDb(companyId);
    try {
      const rows = await handle.db.select().from(stockMovements).where(eq(stockMovements.productId, productId));
      return rows.reduce((total, row) => total + Number(row.quantity), 0);
    } finally {
      await handle.close();
    }
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("buy");
    other = await harness.provisionCompany("buyother");
    catalog = await addCatalog(company.id);
    otherCatalog = await addCatalog(other.id);
    for (const role of ["purchasing", "warehouse", "sales"] as const) {
      cookies[role] = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: [role] }));
    }
    cookies.otherPurchasing = await harness.signIn(
      await harness.addUser({ companyIds: [other.id], roles: ["purchasing"] }),
    );
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("keeps one primary contact per supplier, and passes it on when the primary leaves", async () => {
    const { supplier, contact } = await supplierWithContact(cookies.purchasing, "Northline Mills");
    const first = (await call("get", "/supplier-contacts", cookies.purchasing)).body.find(
      (c: { id: string }) => c.id === contact,
    );
    expect(first.isPrimary).toBe(true);
    const second = await call("post", "/supplier-contacts", cookies.purchasing)
      .send({
        supplierId: supplier,
        name: "Ada Accounts",
        role: "accounts_receivable",
        mobile: "",
        officePhone: "",
        email: "ada@example.test",
        whatsapp: false,
        preferredMethod: "email",
        notes: "",
        isPrimary: true,
      })
      .expect(201);
    const list = (await call("get", "/supplier-contacts", cookies.purchasing)).body.filter(
      (c: { supplierId: string }) => c.supplierId === supplier,
    );
    expect(list.filter((c: { isPrimary: boolean }) => c.isPrimary).map((c: { id: string }) => c.id)).toEqual([
      second.body.id,
    ]);
    await call("post", `/supplier-contacts/${second.body.id}/status`, cookies.purchasing)
      .send({ status: "inactive" })
      .expect(201);
    const after = (await call("get", "/supplier-contacts", cookies.purchasing)).body.find(
      (c: { id: string }) => c.id === contact,
    );
    expect(after.isPrimary).toBe(true);
    expect((await call("post", "/suppliers", cookies.sales).send({ name: "Not allowed" })).status).toBe(403);
    // Supplier credit follows the purchasing money keys, and an edit never changes it blind (PR #13 review).
    await call("put", `/suppliers/${supplier}`, cookies.purchasing)
      .send({ name: "Northline Mills", creditLimit: "25000.00" })
      .expect(200);
    const seen = (await call("get", "/suppliers", cookies.purchasing)).body.find(
      (s: { id: string }) => s.id === supplier,
    );
    expect(seen.creditLimit).toBe("25000.00");
    const hidden = (await call("get", "/suppliers", cookies.warehouse)).body.find(
      (s: { id: string }) => s.id === supplier,
    );
    expect(hidden).not.toHaveProperty("creditLimit");
    await call("put", `/suppliers/${supplier}`, cookies.purchasing)
      .send({ name: "Northline Mills", phone: "(555) 010-3000" })
      .expect(200);
    const kept = (await call("get", "/suppliers", cookies.purchasing)).body.find(
      (s: { id: string }) => s.id === supplier,
    );
    expect(kept.creditLimit).toBe("25000.00");
  });

  it("orders, shows money only to those who may see it, and receives stock and rolls in", async () => {
    const { supplier, contact } = await supplierWithContact(cookies.purchasing, "Fieldstone Supply");
    const order = await call("post", "/purchase-orders", cookies.purchasing)
      .send(orderBody(supplier, contact, catalog))
      .expect(201);
    expect(order.body).toMatchObject({ status: "ordered", total: "1890.00" });
    expect(order.body.number).toMatch(/^PO-\d+$/);
    const forWarehouse = (await call("get", "/purchase-orders", cookies.warehouse).expect(200)).body.find(
      (po: { id: string }) => po.id === order.body.id,
    );
    expect(forWarehouse).not.toHaveProperty("total");
    expect(forWarehouse.lines[0]).not.toHaveProperty("unitCost");

    const [tileLine, carpetLine] = order.body.lines as { id: string; productId: string }[];
    const before = await onHand(company.id, catalog.tile);
    const receipt = await call("post", `/purchase-orders/${order.body.id}/receipts`, cookies.warehouse)
      .send({
        locationId: "",
        note: "First delivery",
        lines: [
          { poLineId: tileLine.id, productId: catalog.tile, received: "40", damaged: "0", rolls: [] },
          {
            poLineId: carpetLine.id,
            productId: catalog.carpet,
            received: "1200",
            damaged: "0",
            rolls: [{ rollNumber: `NM-${uuidv7().slice(-6)}`, dyeLot: "L7", lengthFt: "100" }],
          },
        ],
      })
      .expect(201);
    expect(receipt.body.number).toMatch(/^GR-\d{4}$/);
    expect(await onHand(company.id, catalog.tile)).toBe(before + 40);
    const rolls = (await call("get", "/rolls", cookies.warehouse).expect(200)).body.filter(
      (roll: { productId: string }) => roll.productId === catalog.carpet,
    );
    expect(rolls).toHaveLength(1);
    expect(rolls[0]).toMatchObject({ bin: "Receiving", remainingLengthFt: "100.000" });

    const over = await call("post", `/purchase-orders/${order.body.id}/receipts`, cookies.warehouse).send({
      locationId: "",
      note: "",
      lines: [{ poLineId: tileLine.id, productId: catalog.tile, received: "61", damaged: "0", rolls: [] }],
    });
    expect(over.status).toBe(400);
    expect(over.body.message).toContain("still to come");
    // One order line listed twice, or rolls longer than what arrived, cannot make stock (PR #13 review).
    const twice = await call("post", `/purchase-orders/${order.body.id}/receipts`, cookies.warehouse).send({
      locationId: "",
      note: "",
      lines: [
        { poLineId: tileLine.id, productId: catalog.tile, received: "60", damaged: "0", rolls: [] },
        { poLineId: tileLine.id, productId: catalog.tile, received: "60", damaged: "0", rolls: [] },
      ],
    });
    expect(twice.body.message).toBe("Each order line can appear once on a receipt.");
    expect(await onHand(company.id, catalog.tile)).toBe(before + 40);
    const longRolls = await call("post", `/purchase-orders/${order.body.id}/receipts`, cookies.warehouse).send({
      locationId: "",
      note: "",
      lines: [{ poLineId: tileLine.id, productId: catalog.tile, received: "20", damaged: "0", rolls: [] }],
    });
    expect(longRolls.status).toBe(201);
    const carpetOrder = await call("post", "/purchase-orders", cookies.purchasing)
      .send(orderBody(supplier, contact, catalog))
      .expect(201);
    const carpetLineId = (carpetOrder.body.lines as { id: string }[])[1].id;
    const inflated = await call("post", `/purchase-orders/${carpetOrder.body.id}/receipts`, cookies.warehouse).send({
      locationId: "",
      note: "",
      lines: [
        {
          poLineId: carpetLineId,
          productId: catalog.carpet,
          received: "1",
          damaged: "0",
          rolls: [{ rollNumber: `NM-${uuidv7().slice(-6)}`, dyeLot: "L8", lengthFt: "9999" }],
        },
      ],
    });
    expect(inflated.status).toBe(400);
    expect(inflated.body.message).toContain("more than the 1 received");
    const cancel = await call("post", `/purchase-orders/${order.body.id}/cancel`, cookies.purchasing).send({
      reason: "Changed mind",
    });
    expect(cancel.body.code).toBe("has_receipts");
  });

  it("F-m orders and receives boxed goods only in whole cartons (rule 7, ADR 0027; inventory.md rule 4)", async () => {
    const { supplier } = await supplierWithContact(cookies.purchasing, "Carton Works");
    const body = orderBody(supplier, null, catalog);
    const partOrder = await call("post", "/purchase-orders", cookies.purchasing).send({
      ...body,
      lines: body.lines.map((line) => (line.productId === catalog.tile ? { ...line, quantity: "150" } : line)),
    });
    expect(partOrder.status).toBe(400);
    expect(partOrder.body).toMatchObject({
      code: "invalid_request",
      message: "Slate Tile: order whole cartons, multiples of 20 sq ft.",
    });
    const order = await call("post", "/purchase-orders", cookies.purchasing).send(body).expect(201);
    const tileLine = (order.body.lines as { id: string; productId: string }[]).find(
      (line) => line.productId === catalog.tile,
    )!;
    const before = await onHand(company.id, catalog.tile);
    for (const [received, damaged] of [
      ["30", "0"],
      ["20", "5"],
    ]) {
      const partReceipt = await call("post", `/purchase-orders/${order.body.id}/receipts`, cookies.warehouse).send({
        locationId: "",
        note: "",
        lines: [{ poLineId: tileLine.id, productId: catalog.tile, received, damaged, rolls: [] }],
      });
      expect(partReceipt.status).toBe(400);
      expect(partReceipt.body.message).toBe("Slate Tile: receive whole cartons, multiples of 20 sq ft.");
    }
    expect(await onHand(company.id, catalog.tile)).toBe(before);
  });

  it("sends a draft, cancels one with a reason, and refuses a showroom or a second receipt of a cancelled order", async () => {
    const { supplier } = await supplierWithContact(cookies.purchasing, "Quarry Path");
    const draft = await call("post", "/purchase-orders", cookies.purchasing)
      .send(orderBody(supplier, null, catalog, true))
      .expect(201);
    expect(draft.body.status).toBe("draft");
    await call("post", `/purchase-orders/${draft.body.id}/order`, cookies.purchasing)
      .send({ via: "phone" })
      .expect(201);
    expect((await call("post", `/purchase-orders/${draft.body.id}/order`, cookies.purchasing).send({})).body.code).toBe(
      "not_draft",
    );
    const another = await call("post", "/purchase-orders", cookies.purchasing)
      .send(orderBody(supplier, null, catalog, true))
      .expect(201);
    expect(
      (await call("post", `/purchase-orders/${another.body.id}/cancel`, cookies.purchasing).send({ reason: "x" }))
        .status,
    ).toBe(400);
    await call("post", `/purchase-orders/${another.body.id}/cancel`, cookies.purchasing)
      .send({ reason: "Duplicate order" })
      .expect(201);
    const toShowroom = await call("post", "/purchase-orders", cookies.purchasing).send({
      ...orderBody(supplier, null, catalog),
      locationId: catalog.showroom,
    });
    expect(toShowroom.status).toBe(400);
    const line = (another.body.lines as { id: string }[])[0];
    const late = await call("post", `/purchase-orders/${another.body.id}/receipts`, cookies.warehouse).send({
      locationId: "",
      note: "",
      lines: [{ poLineId: line.id, productId: catalog.tile, received: "20", damaged: "0", rolls: [] }],
    });
    expect(late.body.message).toContain("cancelled");
    expect(
      (await call("post", "/purchase-orders", cookies.warehouse).send(orderBody(supplier, null, catalog))).status,
    ).toBe(403);
  });

  it("never reaches another company's suppliers, orders or products", async () => {
    const { supplier } = await supplierWithContact(cookies.otherPurchasing, "Their Supplier");
    const theirs = await call("post", "/purchase-orders", cookies.otherPurchasing)
      .send(orderBody(supplier, null, otherCatalog))
      .expect(201);
    expect(
      (await call("post", `/purchase-orders/${theirs.body.id}/cancel`, cookies.purchasing).send({ reason: "Not ours" }))
        .status,
    ).toBe(404);
    expect((await call("put", `/suppliers/${supplier}`, cookies.purchasing).send({ name: "Hijacked" })).status).toBe(
      404,
    );
    const crossed = await call("post", "/purchase-orders", cookies.purchasing).send(orderBody(supplier, null, catalog));
    expect(crossed.status).toBe(400);
  });

  it("audits every purchasing change", async () => {
    const handle = await harness.companyDb(company.id);
    try {
      const actions = (await handle.db.select({ action: auditLog.action }).from(auditLog)).map((row) => row.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          "Added supplier",
          "Added supplier contact",
          "Changed contact status",
          "Created purchase order",
          "Received goods",
          "Ordered purchase order",
          "Cancelled purchase order",
        ]),
      );
    } finally {
      await handle.close();
    }
  });
});
