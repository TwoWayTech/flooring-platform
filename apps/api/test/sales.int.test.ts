import {
  auditLog,
  branches,
  locations,
  products,
  quoteLines,
  settings,
  taxRules,
  userProfiles,
} from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { dec } from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";
import request from "supertest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";

/** Summit's localization settings, without the tax tables, as a company's settings row holds them. */
function summitLocalization() {
  const file = createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json");
  const fixtures = JSON.parse(readFileSync(file, "utf8")) as { settings: { localization: Record<string, unknown> } };
  const { tax, ...rest } = fixtures.settings.localization as { tax: Record<string, unknown> } & Record<string, unknown>;
  const taxRest: Record<string, unknown> = { ...tax };
  delete taxRest.rules;
  delete taxRest.jurisdictions;
  return { ...rest, tax: taxRest };
}

/**
 * Sales, part 1 (docs/product-spec/sales.md; ADR 0037): customers and quotes through data scope,
 * quote totals from the company's own tax rules, waste and tax-override rights, quote status,
 * audit and company isolation.
 */
describe("sales part 1 (P11, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let other = { id: "", slug: "" };
  let warehouse = "";
  let otherWarehouse = "";
  let tile = "";
  const cookies = { salesA: "", salesB: "", manager: "", accountant: "", owner: "", otherSales: "" };

  function call(method: "get" | "post" | "put", path: string, cookie: string) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
  }

  /** A branch, a warehouse, a tile product, Summit's settings and a Colorado tax rule. */
  async function setUp(companyId: string) {
    const handle = await harness.companyDb(companyId);
    try {
      const [branch] = await handle.db
        .insert(branches)
        .values({ name: "Denver", city: "Denver", state: "CO" })
        .returning();
      const address = { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" };
      const [store] = await handle.db
        .insert(locations)
        .values({ name: "Denver warehouse", kind: "warehouse" as const, branchId: branch.id, address, isDefault: true })
        .returning();
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
        })
        .returning();
      await handle.db.insert(settings).values({ group: "localization", value: summitLocalization() });
      await handle.db.insert(taxRules).values({
        state: "CO",
        jurisdiction: "Denver combined",
        ratePct: "8.81",
        taxable: { material: true, labor: false, freight: false, service: false },
        lumpSumLaborTaxable: true,
        validFrom: "2025-01-01",
        version: 1,
      });
      return { branch: branch.id, warehouse: store.id, tile: product.id };
    } finally {
      await handle.close();
    }
  }

  async function placeIn(companyId: string, email: string, branchId: string | null) {
    const handle = await harness.companyDb(companyId);
    try {
      await handle.db
        .update(userProfiles)
        .set({ branchId })
        .where(eq(userProfiles.userId, await harness.userIdOf(email)));
    } finally {
      await handle.close();
    }
  }

  async function enrolled(email: string) {
    const first = await harness.signIn(email);
    const enabled = await harness.post("/api/auth/two-factor/enable").set("Cookie", first).send({ password: PASSWORD });
    const secret = totpSecretFromUri(enabled.body.totpURI as string);
    const confirmed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", first)
      .send({ code: totpCode(secret) });
    return sessionCookie(confirmed.headers["set-cookie"]);
  }

  function quoteBody(customerId: string, location: string, product: string, extra: Record<string, unknown> = {}) {
    return {
      customerId,
      locationId: location,
      jobSite: { street: "12 Pine Rd", city: "Denver", state: "CO", zip: "80202" },
      rooms: [],
      lines: [
        {
          id: "draft-1",
          productId: product,
          description: "Slate Tile",
          category: "material",
          unit: "sq_ft",
          quantity: "100",
          unitPrice: "4.50",
          unitCost: "0",
          wastePct: "10",
        },
      ],
      depositPct: "50",
      taxOverride: null,
      notes: "",
      total: "1.00",
      ...extra,
    };
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("sell");
    other = await harness.provisionCompany("sellother");
    const mine = await setUp(company.id);
    const theirs = await setUp(other.id);
    warehouse = mine.warehouse;
    otherWarehouse = theirs.warehouse;
    tile = mine.tile;
    const emails = {
      salesA: await harness.addUser({ companyIds: [company.id], roles: ["sales"] }),
      salesB: await harness.addUser({ companyIds: [company.id], roles: ["sales"] }),
      manager: await harness.addUser({ companyIds: [company.id], roles: ["manager"] }),
      accountant: await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }),
      otherSales: await harness.addUser({ companyIds: [other.id], roles: ["sales"] }),
      owner: await harness.addUser({ companyIds: [company.id], roles: ["owner"] }),
    };
    await placeIn(company.id, emails.salesA, mine.branch);
    await placeIn(company.id, emails.manager, mine.branch);
    cookies.salesA = await harness.signIn(emails.salesA);
    cookies.salesB = await harness.signIn(emails.salesB);
    cookies.manager = await harness.signIn(emails.manager);
    cookies.accountant = await enrolled(emails.accountant);
    cookies.owner = await enrolled(emails.owner);
    cookies.otherSales = await harness.signIn(emails.otherSales);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("shows customers through data scope: own for Sales, branch for Manager, all for Accountant", async () => {
    const created = await call("post", "/customers", cookies.salesA)
      .send({ name: "Dana Rivera", email: "dana@example.test" })
      .expect(201);
    const visible = async (cookie: string) =>
      (await call("get", "/customers", cookie).expect(200)).body.some((c: { id: string }) => c.id === created.body.id);
    expect(await visible(cookies.salesA)).toBe(true);
    expect(await visible(cookies.salesB)).toBe(false);
    expect(await visible(cookies.manager)).toBe(true);
    expect(await visible(cookies.accountant)).toBe(true);
    const edited = await call("put", `/customers/${created.body.id}`, cookies.salesA)
      .send({
        type: "homeowner",
        name: "Dana Rivera",
        contactName: "Dana",
        email: "dana@example.test",
        phone: "",
        terms: "net_15",
        defaultBillingId: "new-1",
        defaultJobSiteId: "new-1",
        addresses: [{ id: "new-1", label: "home", street: "12 Pine Rd", city: "Denver", state: "co", zip: "80202" }],
        creditLimit: "99999.00",
      })
      .expect(200);
    expect(edited.body.addresses[0].state).toBe("CO");
    expect(edited.body.defaultBillingId).toBe(edited.body.addresses[0].id);
    const forAccountant = (await call("get", "/customers", cookies.accountant)).body.find(
      (c: { id: string }) => c.id === created.body.id,
    );
    expect(forAccountant.creditLimit).toBe("0.00");
    expect((await call("put", `/customers/${created.body.id}`, cookies.salesB).send(edited.body)).status).toBe(404);
  });

  it("computes the quote total on the server from the company's tax rule, and takes cost from the catalog", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Lee Park" }).expect(201);
    const quote = await call("post", "/quotes", cookies.salesA)
      .send(quoteBody(customer.body.id, warehouse, tile))
      .expect(201);
    // 100 sq ft at 4.50 = 450.00; Colorado 8.81% on materials = 39.65; total 489.65.
    expect(quote.body).toMatchObject({ status: "draft", total: "489.65" });
    expect(quote.body.number).toMatch(/^Q-\d+$/);
    expect(quote.body.lines[0]).not.toHaveProperty("unitCost");
    const handle = await harness.companyDb(company.id);
    try {
      const [line] = await handle.db.select().from(quoteLines).where(eq(quoteLines.quoteId, quote.body.id));
      expect(line.unitCost).toBe("2.1000");
    } finally {
      await handle.close();
    }
    // A lowercase state is the same state; a made-up one is refused, so tax can't be skipped (PR #14 review).
    const site = (state: string) => ({ jobSite: { street: "12 Pine Rd", city: "Denver", state, zip: "80202" } });
    const lower = await call("post", "/quotes", cookies.salesA)
      .send(quoteBody(customer.body.id, warehouse, tile, site("co")))
      .expect(201);
    expect(lower.body).toMatchObject({ total: "489.65", jobSite: { state: "CO" } });
    expect(
      (await call("post", "/quotes", cookies.salesA).send(quoteBody(customer.body.id, warehouse, tile, site("ZZ"))))
        .status,
    ).toBe(400);
    // A material line called labor is still a material: its category comes from the product (PR #14 review).
    const relabelled = quoteBody(customer.body.id, warehouse, tile).lines.map((line) => ({
      ...line,
      category: "labor",
    }));
    const material = await call("post", "/quotes", cookies.salesA)
      .send(quoteBody(customer.body.id, warehouse, tile, { lines: relabelled }))
      .expect(201);
    expect(material.body.total).toBe("489.65");
    const noProduct = [{ ...relabelled[0], productId: "", description: "Haul away", category: "service" }];
    expect(
      (
        await call("post", "/quotes", cookies.salesA).send(
          quoteBody(customer.body.id, warehouse, tile, { lines: noProduct }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call("post", "/quotes", cookies.salesA).send(
          quoteBody(customer.body.id, warehouse, tile, { depositPct: "500" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await call("get", "/quotes", cookies.salesB).expect(200)).body.some(
        (q: { id: string }) => q.id === quote.body.id,
      ),
    ).toBe(false);
  });

  it("costs a line sent without unitCost from the catalog; the rep's answers carry no cost, the manager's do, and a sent cost is ignored (B1)", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Noor Haddad" }).expect(201);
    const sent = quoteBody(customer.body.id, warehouse, tile);
    delete (sent.lines[0] as { unitCost?: string }).unitCost;
    const created = await call("post", "/quotes", cookies.salesA).send(sent).expect(201);
    expect(created.body.lines[0]).not.toHaveProperty("unitCost");
    const liveLineCosts = async () => {
      const handle = await harness.companyDb(company.id);
      try {
        // A save replaces the lines, so only the live ones count.
        const rows = await handle.db
          .select()
          .from(quoteLines)
          .where(and(eq(quoteLines.quoteId, created.body.id), isNull(quoteLines.deletedAt)));
        return rows.map((line) => line.unitCost);
      } finally {
        await handle.close();
      }
    };
    expect(await liveLineCosts()).toEqual(["2.1000"]);
    const listedFor = async (cookie: string) =>
      (await call("get", "/quotes", cookie).expect(200)).body.find((q: { id: string }) => q.id === created.body.id);
    expect((await listedFor(cookies.salesA)).lines[0]).not.toHaveProperty("unitCost");
    // The manager works in the quote's branch and holds product cost.
    const managers = await listedFor(cookies.manager);
    expect(managers.lines[0].unitCost).toBe("2.1000");
    // A cost sent with a save is ignored.
    const lines = managers.lines.map((line: Record<string, unknown>) => ({ ...line, unitCost: "0.0001" }));
    const edited = await call("put", `/quotes/${created.body.id}`, cookies.manager)
      .send({ ...managers, lines })
      .expect(200);
    expect(edited.body.lines[0].unitCost).toBe("2.1000");
    expect(await liveLineCosts()).toEqual(["2.1000"]);
    // The rep's status change answers the quote without cost too, as the builder takes it back.
    const sentOut = await call("post", `/quotes/${created.body.id}/status`, cookies.salesA)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    expect(sentOut.body.lines[0]).not.toHaveProperty("unitCost");
  });

  it("takes back a saved quote as it answered it: percents at their stored scale or as typed, waste by value; a real waste change still needs the key (B6)", async () => {
    type Json = Record<string, unknown>;
    type Answer = Json & { lines: Json[] };
    const status = (res: { status: number; body: unknown }, want: number, step: string) =>
      expect(res.status, `B6 ${step}: ${JSON.stringify(res.body)}`).toBe(want);
    const WASTE = "Your role does not allow changing waste.";
    const FORMAT = "Enter a percent such as 10.";
    const NO_PRODUCT = "Only someone who may change tax can add a line without a product.";
    const TWICE = "Send each line once.";

    // 0. A carpet product, for a line moved to another product (A.5e). Summit's carpet default is 12.
    const handle = await harness.companyDb(company.id);
    let carpet = "";
    try {
      const [product] = await handle.db
        .insert(products)
        .values({
          sku: `C-${uuidv7()}`,
          name: "Harbor Loop Carpet",
          category: "carpet" as const,
          unit: "sq_ft" as const,
          price: "3.2500",
          cost: "1.4000",
        })
        .returning();
      carpet = product.id;
    } finally {
      await handle.close();
    }

    // 1. The rep's quote, answered at the columns' numeric(18,8) scale.
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Ines Varga" }).expect(201);
    const created = await call("post", "/quotes", cookies.salesA).send(quoteBody(customer.body.id, warehouse, tile));
    status(created, 201, "A.1");
    expect(created.body.depositPct).toBe("50.00000000");
    expect(created.body.lines[0].wastePct).toBe("10.00000000");
    const id = created.body.id as string;
    const put = (body: Json, cookie = cookies.salesA) => call("put", `/quotes/${id}`, cookie).send(body);
    // Line ids change on every save, so each step starts from the latest answer.
    let current = created.body as Answer;
    const withLine0 = (over: Json): Answer => ({
      ...current,
      lines: current.lines.map((line, index) => (index === 0 ? { ...line, ...over } : line)),
    });

    // 2. Sent back as answered.
    let res = await put(current);
    status(res, 200, "A.2");
    expect(
      res.body.lines.filter((line: Json) => "unitCost" in line),
      "the rep's answer carries no cost",
    ).toEqual([]);
    expect(dec(res.body.depositPct).eq(50)).toBe(true);
    expect(dec(res.body.lines[0].wastePct).eq(10)).toBe(true);
    current = res.body as Answer;

    // 3. The percents as typed: the same values, so no waste change.
    res = await put({
      ...current,
      depositPct: "50",
      lines: current.lines.map((line) => ({ ...line, wastePct: "10" })),
    });
    status(res, 200, "A.3");
    current = res.body as Answer;

    // 4. A new line at the tile's default, written another way.
    const added = {
      id: "draft-2",
      productId: tile,
      description: "Slate Tile",
      category: "material",
      unit: "sq_ft",
      quantity: "20",
      unitPrice: "4.50",
      wastePct: "10.0",
    };
    res = await put({ ...current, lines: [...current.lines, added] });
    status(res, 200, "A.4");
    expect(res.body.lines).toHaveLength(2);
    current = res.body as Answer;

    // 5. A real change still needs sales.waste.view, however small.
    const line0 = { ...current.lines[0] };
    delete line0.wastePct;
    const changes: [string, Answer][] = [
      ["A.5a", withLine0({ wastePct: "10.0001" })],
      ["A.5b", withLine0({ wastePct: "12" })],
      ["A.5c", { ...current, lines: [line0, ...current.lines.slice(1)] }],
      ["A.5d", { ...current, lines: [...current.lines, { ...added, id: "draft-3", wastePct: "12" }] }],
      // A line moved to another product keeps no waste right: carpet starts from its own 12.
      ["A.5e", withLine0({ productId: carpet })],
    ];
    for (const [step, body] of changes) {
      res = await put(body);
      status(res, 403, step);
      expect(res.body.message, `B6 ${step}`).toBe(WASTE);
    }
    // A line sent without the product it had is a new line without a product, so it takes neither
    // the saved line's waste nor its category and cost, and needs the tax key (review round 1).
    const unproduced = { ...line0 };
    delete unproduced.productId;
    res = await put({ ...current, lines: [unproduced, ...current.lines.slice(1)] });
    status(res, 403, "A.5f");
    expect(res.body.message, "B6 A.5f").toBe(NO_PRODUCT);

    // 6. No value past four decimals, nothing above 100, and bad text is 400, never 500.
    const refusals: [string, Answer, string][] = [
      ["A.6 waste 8dp", withLine0({ wastePct: "10.00000001" }), FORMAT],
      ["A.6 waste 5dp", withLine0({ wastePct: "10.00001" }), FORMAT],
      ["A.6 deposit 8dp", { ...current, depositPct: "100.00000001" }, FORMAT],
      ["A.6 bound", { ...current, depositPct: "100.0001" }, "A percent is at most 100."],
      ["A.6 abc", { ...current, depositPct: "abc" }, FORMAT],
      ["A.6 empty", { ...current, depositPct: "" }, FORMAT],
    ];
    for (const [step, body, message] of refusals) {
      res = await put(body);
      status(res, 400, step);
      expect(res.body.message, `B6 ${step}`).toBe(message);
    }

    // 7. The manager re-saves his own answer, cost included, and may change waste.
    const managers = (await call("get", "/quotes", cookies.manager).expect(200)).body.find(
      (quote: Json) => quote.id === id,
    ) as Answer;
    expect(managers.lines[0]?.unitCost).toBe("2.1000");
    res = await put(managers, cookies.manager);
    status(res, 200, "A.7");
    current = res.body as Answer;
    res = await put(withLine0({ wastePct: "12.5" }), cookies.manager);
    status(res, 200, "A.7 waste");
    expect(res.body.lines[0].wastePct).toBe("12.50000000");

    // 8. The rep re-saves the manager's waste as she was answered it, but can't copy it onto a
    // second line by sending the same line twice (review round 1).
    current = (await call("get", "/quotes", cookies.salesA).expect(200)).body.find(
      (quote: Json) => quote.id === id,
    ) as Answer;
    res = await put(current);
    status(res, 200, "A.8");
    current = res.body as Answer;
    res = await put({ ...current, lines: [current.lines[0], ...current.lines] });
    status(res, 400, "A.8 twice");
    expect(res.body.message, "B6 A.8 twice").toBe(TWICE);
  });

  it("needs sales.waste.view to change waste and sales.tax.override to change tax", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Kim Osei" }).expect(201);
    const lines = quoteBody(customer.body.id, warehouse, tile).lines.map((line) => ({ ...line, wastePct: "25" }));
    const waste = await call("post", "/quotes", cookies.salesA).send(
      quoteBody(customer.body.id, warehouse, tile, { lines }),
    );
    expect(waste.status).toBe(403);
    const override = { ratePct: "5", reason: "County holiday rate", byName: "", at: "" };
    const taxBySales = await call("post", "/quotes", cookies.salesA).send(
      quoteBody(customer.body.id, warehouse, tile, { taxOverride: override }),
    );
    expect(taxBySales.status).toBe(403);
    const quote = await call("post", "/quotes", cookies.owner)
      .send(quoteBody(customer.body.id, warehouse, tile, { taxOverride: override }))
      .expect(201);
    // 450.00 + 5% = 472.50; the server records who changed it.
    expect(quote.body.total).toBe("472.50");
    expect(quote.body.taxOverride.byName).not.toBe("");
  });

  it("sends, accepts and declines quotes only as their state allows", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Ana Ruiz" }).expect(201);
    const quote = await call("post", "/quotes", cookies.salesA)
      .send(quoteBody(customer.body.id, warehouse, tile))
      .expect(201);
    expect(
      (await call("post", `/quotes/${quote.body.id}/status`, cookies.salesA).send({ action: "accept" })).body.code,
    ).toBe("quote_state");
    const sent = await call("post", `/quotes/${quote.body.id}/status`, cookies.salesA)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    expect(sent.body).toMatchObject({ status: "pending", expiresAt: "2099-01-01" });
    expect(sent.body.sentAt).not.toBeNull();
    await call("post", `/quotes/${quote.body.id}/status`, cookies.salesA).send({ action: "accept" }).expect(201);
    expect(
      (await call("post", `/quotes/${quote.body.id}/status`, cookies.salesB).send({ action: "decline" })).status,
    ).toBe(404);
  });

  it("never reaches another company's quotes, customers or warehouses", async () => {
    const theirCustomer = await call("post", "/customers", cookies.otherSales).send({ name: "Theirs" }).expect(201);
    const theirQuote = await call("post", "/quotes", cookies.otherSales)
      .send(
        quoteBody(
          theirCustomer.body.id,
          otherWarehouse,
          (await call("get", "/products", cookies.otherSales)).body[0].id,
        ),
      )
      .expect(201);
    expect(
      (
        await call("put", `/quotes/${theirQuote.body.id}`, cookies.salesA).send(
          quoteBody(theirCustomer.body.id, warehouse, tile),
        )
      ).status,
    ).toBe(404);
    const mine = await call("post", "/customers", cookies.salesA).send({ name: "Mine" }).expect(201);
    expect(
      (await call("post", "/quotes", cookies.salesA).send(quoteBody(mine.body.id, otherWarehouse, tile))).status,
    ).toBe(400);
  });

  it("audits every sales change", async () => {
    const handle = await harness.companyDb(company.id);
    try {
      const actions = (await handle.db.select({ action: auditLog.action }).from(auditLog)).map((row) => row.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          "Added customer",
          "Changed customer",
          "Created quote",
          "Changed tax on a document",
          "Marked quote pending",
          "Marked quote accepted",
        ]),
      );
    } finally {
      await handle.close();
    }
  });
});
