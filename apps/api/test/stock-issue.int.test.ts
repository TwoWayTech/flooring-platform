import {
  auditLog,
  branches,
  locations,
  products,
  rolls,
  settings,
  stockMovements,
  taxRules,
  userProfiles,
} from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { dec, moneyString } from "@workspace/shared";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dayIn } from "../src/modules/sales/sales-common";
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

/** Today in the test companies' time zone (`AuthHarness.provisionCompany` uses America/Chicago). */
function companyDay(): string {
  return dayIn(new Date(), "America/Chicago");
}

/** A small file that starts like a PDF, as proof. */
const PDF = { name: "receipt.pdf", data: Buffer.from("%PDF-1.4\n% proof of payment\n").toString("base64") };

type TrialBalance = { balanced: boolean; rows: { key: string | null; balance: string }[] };
interface Hold {
  reservationId: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  mayIssue: boolean;
  productId: string;
  rollId: string | null;
  locationId: string;
  quantity: string;
  shortBy: string;
}

/**
 * Inventory part 2 (docs/product-spec/inventory.md rules 13 to 18; sales rule 39; ADR 0043): stock holds,
 * issue and cut with cost of goods, the roll quick invoice and the commission split.
 */
describe("inventory part 2: issue and cut (P11, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let warehouse = "";
  let tile = "";
  let carpet = "";
  let salesUserId = "";
  let hrUserId = "";
  const cookies = { sales: "", warehouse: "", owner: "", manager: "", accountant: "" };

  function call(method: "get" | "post" | "put", path: string, cookie: string) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
  }

  /** A branch, a warehouse with 5000 sq ft of tile, a carpet, Summit's settings, payment rules and a tax rule. */
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
      const [slate, harbor] = await handle.db
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
        productId: slate.id,
        locationId: store.id,
        quantity: "5000",
        kind: "opening",
        sourceType: "count",
        sourceId: uuidv7(),
        sourceNumber: "OPEN",
      });
      await handle.db.insert(settings).values([
        { group: "localization", value: summitLocalization() },
        {
          group: "payments",
          value: {
            approvalRequired: true,
            approvalThreshold: "100.00",
            writeOffMax: "5.00",
            paymentPrefix: "PAY-",
            refundPrefix: "RF-",
          },
        },
      ]);
      await handle.db.insert(taxRules).values({
        state: "CO",
        jurisdiction: "Denver combined",
        ratePct: "8.81",
        taxable: { material: true, labor: false, freight: false, service: false },
        lumpSumLaborTaxable: true,
        validFrom: "2025-01-01",
        version: 1,
      });
      return { branch: branch.id, warehouse: store.id, tile: slate.id, carpet: harbor.id };
    } finally {
      await handle.close();
    }
  }

  /** A 100 ft by 12 ft roll of the carpet at 1.4000 per sq ft. */
  async function newRoll(length = "100"): Promise<string> {
    const handle = await harness.companyDb(company.id);
    try {
      const [roll] = await handle.db
        .insert(rolls)
        .values({
          rollNumber: `R-${uuidv7()}`,
          productId: carpet,
          dyeLot: "L1",
          widthFt: "12",
          originalLengthFt: length,
          remainingLengthFt: length,
          costPerSqFt: "1.4000",
          locationId: warehouse,
          bin: "A-1",
          receivedAt: new Date(),
        })
        .returning();
      return roll.id;
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

  async function newCustomer(name: string, cookie = cookies.sales): Promise<string> {
    return (await call("post", "/customers", cookie).send({ name }).expect(201)).body.id as string;
  }

  /** A customer with a Denver job site, which a roll invoice takes its tax from. */
  async function newSiteCustomer(name: string, cookie = cookies.sales): Promise<string> {
    const id = await newCustomer(name, cookie);
    await call("put", `/customers/${id}`, cookies.owner)
      .send({
        type: "homeowner",
        name,
        contactName: "",
        email: "",
        phone: "",
        terms: "due_on_receipt",
        defaultBillingId: null,
        defaultJobSiteId: "site-1",
        addresses: [
          { id: "site-1", label: "job_site", street: "12 Pine Rd", city: "Denver", state: "CO", zip: "80202" },
        ],
      })
      .expect(200);
    return id;
  }

  /** An accepted quote for 100 sq ft of tile converted to an invoice (450.00 + 39.65 tax); its hold is made. */
  async function tileInvoice(customerId: string): Promise<{ id: string; number: string }> {
    const quote = await call("post", "/quotes", cookies.sales)
      .send({
        customerId,
        locationId: warehouse,
        jobSite: { street: "12 Pine Rd", city: "Denver", state: "CO", zip: "80202" },
        rooms: [],
        lines: [
          {
            id: "draft-1",
            productId: tile,
            description: "Slate Tile",
            category: "material",
            unit: "sq_ft",
            quantity: "100",
            unitPrice: "4.50",
            unitCost: "0",
            wastePct: "10",
          },
        ],
        depositPct: "0",
        taxOverride: null,
        notes: "",
      })
      .expect(201);
    await call("post", `/quotes/${quote.body.id}/status`, cookies.sales)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    await call("post", `/quotes/${quote.body.id}/status`, cookies.sales).send({ action: "accept" }).expect(201);
    return (await call("post", `/quotes/${quote.body.id}/invoice`, cookies.sales).expect(201)).body;
  }

  /** The owner's 50.00 cash payment, under the 100.00 threshold, so it is confirmed at once. */
  async function pay(invoiceId: string): Promise<void> {
    const paid = await call("post", "/payments", cookies.owner)
      .send({
        invoiceId,
        kind: "payment",
        amount: "50.00",
        date: companyDay(),
        method: "cash",
        checkNumber: "",
        cardLast4: "",
        reference: "",
        note: "",
        extraAsCredit: false,
        allowDuplicateReference: false,
        files: [PDF],
      })
      .expect(201);
    expect(paid.body.status).toBe("confirmed");
  }

  async function holdOf(invoiceId: string): Promise<Hold> {
    const holds = (await call("get", "/stock-holds", cookies.owner).expect(200)).body as Hold[];
    const mine = holds.filter((hold) => hold.invoiceId === invoiceId);
    expect(mine).toHaveLength(1);
    return mine[0]!;
  }

  async function balances(): Promise<Map<string, string>> {
    const body = (await call("get", "/ledger/trial-balance", cookies.owner).expect(200)).body as TrialBalance;
    expect(body.balanced).toBe(true);
    return new Map(body.rows.flatMap((row) => (row.key ? [[row.key, row.balance] as const] : [])));
  }

  /** How much an account's balance (debits less credits) moved between two readings. */
  function moved(before: Map<string, string>, after: Map<string, string>, key: string): string {
    return moneyString(dec(after.get(key) ?? "0").minus(before.get(key) ?? "0"));
  }

  async function auditActions(): Promise<string[]> {
    const handle = await harness.companyDb(company.id);
    try {
      return (await handle.db.select({ action: auditLog.action }).from(auditLog)).map((row) => row.action);
    } finally {
      await handle.close();
    }
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("issue");
    const mine = await setUp(company.id);
    warehouse = mine.warehouse;
    tile = mine.tile;
    carpet = mine.carpet;
    const salesEmail = await harness.addUser({ companyIds: [company.id], roles: ["sales"] });
    const handle = await harness.companyDb(company.id);
    try {
      await handle.db
        .update(userProfiles)
        .set({ branchId: mine.branch })
        .where(eq(userProfiles.userId, await harness.userIdOf(salesEmail)));
    } finally {
      await handle.close();
    }
    salesUserId = await harness.userIdOf(salesEmail);
    const hrEmail = await harness.addUser({ companyIds: [company.id], roles: ["hr"] });
    hrUserId = await harness.userIdOf(hrEmail);
    cookies.sales = await harness.signIn(salesEmail);
    cookies.warehouse = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["warehouse"] }));
    cookies.manager = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["manager"] }));
    cookies.accountant = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }));
    const ownerEmail = await harness.addUser({ companyIds: [company.id], roles: ["owner"] });
    // The owner sells from the Denver branch too, so a roll invoice of theirs has a branch.
    const placed = await harness.companyDb(company.id);
    try {
      await placed.db
        .update(userProfiles)
        .set({ branchId: mine.branch })
        .where(eq(userProfiles.userId, await harness.userIdOf(ownerEmail)));
    } finally {
      await placed.close();
    }
    cookies.owner = await enrolled(ownerEmail);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("refuses without the permission: no cut for Sales, no roll invoice for the warehouse, no holds when signed out", async () => {
    const invoice = await tileInvoice(await newCustomer("Nia Okafor"));
    const hold = await holdOf(invoice.id);
    expect((await call("post", `/reservations/${hold.reservationId}/issue`, cookies.sales).send({})).status).toBe(403);
    expect((await call("get", "/stock-holds", cookies.warehouse)).status).toBe(200);
    const roll = await newRoll();
    expect(
      (
        await call("post", `/rolls/${roll}/invoice`, cookies.warehouse).send({
          customerId: await newCustomer("Ola Berg"),
          lengthFt: "10",
        })
      ).status,
    ).toBe(403);
    const anonymous = await request(harness.app.getHttpServer())
      .get("/stock-holds")
      .set("X-Forwarded-Host", "localhost:3000");
    expect(anonymous.status).toBe(401);
    const anonymousIssue = await request(harness.app.getHttpServer())
      .post(`/reservations/${hold.reservationId}/issue`)
      .set("X-Forwarded-Host", "localhost:3000")
      .send({});
    expect(anonymousIssue.status).toBe(401);
  });

  it("lists holds with invoice number and customer, and may-issue turns true after a confirmed payment", async () => {
    const invoice = await tileInvoice(await newCustomer("Priya Nair"));
    const before = await holdOf(invoice.id);
    expect(before).toMatchObject({
      invoiceNumber: invoice.number,
      customerName: "Priya Nair",
      mayIssue: false,
      productId: tile,
      rollId: null,
      locationId: warehouse,
      quantity: "100.000",
      shortBy: "0.000",
    });
    await pay(invoice.id);
    expect((await holdOf(invoice.id)).mayIssue).toBe(true);
    const asWarehouse = (await call("get", "/stock-holds", cookies.warehouse).expect(200)).body as Hold[];
    expect(asWarehouse.find((hold) => hold.invoiceId === invoice.id)?.customerName).toBe("Priya Nair");
  });

  it("holds stock back before payment: no reason, a short reason or no override right is refused; an override issues and is audited", async () => {
    const invoice = await tileInvoice(await newCustomer("Quinn Abbott"));
    const hold = await holdOf(invoice.id);
    const url = `/reservations/${hold.reservationId}/issue`;
    const noReason = await call("post", url, cookies.owner).send({});
    expect(noReason.status).toBe(400);
    expect(noReason.body).toMatchObject({ code: "invalid_request" });
    expect(noReason.body.message).toContain("no confirmed payment");
    expect((await call("post", url, cookies.owner).send({ overrideReason: "ok" })).status).toBe(400);
    expect((await call("post", url, cookies.owner).send({ overrideReason: "  ok  " })).status).toBe(400);
    // The warehouse may cut but may not override.
    const noRight = await call("post", url, cookies.warehouse).send({ overrideReason: "Customer is waiting" });
    expect([400, 403]).toContain(noRight.status);
    expect((await holdOf(invoice.id)).reservationId).toBe(hold.reservationId);
    // Unknown fields and a bad id are refused as validation errors.
    expect((await call("post", url, cookies.owner).send({ overrideReason: "Valid reason", extra: 1 })).status).toBe(
      400,
    );
    expect((await call("post", "/reservations/not-a-uuid/issue", cookies.owner).send({})).status).toBe(400);
    const issued = await call("post", url, cookies.owner).send({ overrideReason: "Customer is waiting" }).expect(201);
    expect(issued.body).toMatchObject({ id: hold.reservationId, status: "issued" });
    expect(await auditActions()).toContain("Issued stock before payment");
  });

  it("issues boxed stock after payment: a negative issue movement, cost of goods at product cost, balanced books, once only", async () => {
    const invoice = await tileInvoice(await newCustomer("Rosa Lindqvist"));
    await pay(invoice.id);
    const hold = await holdOf(invoice.id);
    const before = await balances();
    const issued = await call("post", `/reservations/${hold.reservationId}/issue`, cookies.warehouse)
      .send({})
      .expect(201);
    expect(issued.body.status).toBe("issued");
    const cost = moneyString(dec(hold.quantity).times("2.1000"));
    expect(cost).toBe("210.00");
    const after = await balances();
    expect(moved(before, after, "cost_of_goods_sold")).toBe(cost);
    expect(moved(before, after, "inventory")).toBe(moneyString(dec(cost).negated()));
    const handle = await harness.companyDb(company.id);
    try {
      const movements = await handle.db.select().from(stockMovements).where(eq(stockMovements.sourceId, invoice.id));
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        kind: "issue",
        productId: tile,
        locationId: warehouse,
        sourceType: "invoice",
        sourceNumber: invoice.number,
      });
      expect(dec(movements[0]!.quantity).toFixed(3)).toBe("-100.000");
    } finally {
      await handle.close();
    }
    const again = await call("post", `/reservations/${hold.reservationId}/issue`, cookies.warehouse).send({});
    expect(again.status).toBe(400);
    expect(again.body.message).toContain("no longer open");
    expect((await call("get", "/stock-holds", cookies.owner)).body.some((h: Hold) => h.invoiceId === invoice.id)).toBe(
      false,
    );
    expect((await call("post", `/reservations/${uuidv7()}/issue`, cookies.warehouse).send({})).status).toBe(404);
    expect(await auditActions()).toContain("Issued stock");
  });

  it("cuts a roll: the length leaves it at the roll's own cost, and a leftover under 12 ft becomes a remnant", async () => {
    const customer = await newSiteCustomer("Sven Dahl");
    // 30 ft of 100: 70 ft stay on the roll, no remnant. 30 ft x 12 ft x 1.4000 = 504.00.
    const plain = await call("post", `/rolls/${await newRoll()}/invoice`, cookies.sales)
      .send({ customerId: customer, lengthFt: "30" })
      .expect(201);
    await pay(plain.body.id);
    const plainHold = await holdOf(plain.body.id);
    const before = await balances();
    await call("post", `/reservations/${plainHold.reservationId}/issue`, cookies.warehouse).send({}).expect(201);
    expect(moved(before, await balances(), "cost_of_goods_sold")).toBe("504.00");
    const handle = await harness.companyDb(company.id);
    try {
      const [cut] = await handle.db.select().from(rolls).where(eq(rolls.id, plainHold.rollId!));
      expect(dec(cut!.remainingLengthFt).toFixed(2)).toBe("70.00");

      // 95 ft of 100: the 5 ft left is under 12, so it moves to a remnant and the parent goes to 0.
      const rollId = await newRoll();
      const big = await call("post", `/rolls/${rollId}/invoice`, cookies.sales)
        .send({ customerId: customer, lengthFt: "95" })
        .expect(201);
      await pay(big.body.id);
      const bigHold = await holdOf(big.body.id);
      const beforeBig = await balances();
      await call("post", `/reservations/${bigHold.reservationId}/issue`, cookies.warehouse).send({}).expect(201);
      // 95 x 12 x 1.4000 = 1596.00: the remnant stays stock, so only the cut leaves the books.
      expect(moved(beforeBig, await balances(), "cost_of_goods_sold")).toBe("1596.00");
      const [parent] = await handle.db.select().from(rolls).where(eq(rolls.id, rollId));
      expect(dec(parent!.remainingLengthFt).toFixed(2)).toBe("0.00");
      const children = (await handle.db.select().from(rolls)).filter((roll) => roll.parentRollId === rollId);
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ isRemnant: true, bin: "Remnant rack", productId: carpet });
      expect(dec(children[0]!.remainingLengthFt).toFixed(2)).toBe("5.00");
      expect(dec(children[0]!.costPerSqFt).toFixed(4)).toBe("1.4000");
    } finally {
      await handle.close();
    }
  });

  it("will not void an invoice once its stock was cut or issued", async () => {
    const invoice = await tileInvoice(await newCustomer("Tara Whitlock"));
    const hold = await holdOf(invoice.id);
    await call("post", `/reservations/${hold.reservationId}/issue`, cookies.owner)
      .send({ overrideReason: "Pickup today" })
      .expect(201);
    const voided = await call("post", `/invoices/${invoice.id}/void`, cookies.owner).send({ reason: "Changed mind" });
    expect(voided.status).toBe(400);
    expect(voided.body.message).toContain("cut or issued");
  });

  it("makes a quick invoice from a roll: one sq ft line, posted to receivables, the length held", async () => {
    const customer = await newSiteCustomer("Uma Castellanos");
    const rollId = await newRoll();
    const before = await balances();
    const created = await call("post", `/rolls/${rollId}/invoice`, cookies.sales)
      .send({ customerId: customer, lengthFt: "10.5" })
      .expect(201);
    // 10.5 ft x 12 ft = 126.00 sq ft at 3.00 = 378.00, plus 8.81% tax = 33.30 (378.00 x 0.0881 = 33.3018).
    expect(created.body.lines).toHaveLength(1);
    expect(created.body.lines[0]).toMatchObject({ unit: "sq_ft", quantity: "126.000", productId: carpet });
    expect(created.body).toMatchObject({ subtotal: "378.00", tax: "33.30", total: "411.30" });
    expect(created.body.number).toMatch(/^INV-\d+$/);
    expect(moved(before, await balances(), "accounts_receivable")).toBe(created.body.total);
    const hold = await holdOf(created.body.id);
    expect(hold).toMatchObject({ rollId, quantity: "10.500", customerName: "Uma Castellanos", mayIssue: false });
    expect(await auditActions()).toContain("Created invoice for a roll cut");

    // 89.5 ft are free; asking for 90 is refused, and the first hold is counted.
    const tooLong = await call("post", `/rolls/${rollId}/invoice`, cookies.sales).send({
      customerId: customer,
      lengthFt: "90",
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.message).toContain("free");
    for (const lengthFt of ["0", "-5", "abc", "10.123", "", "1e2"]) {
      const bad = await call("post", `/rolls/${rollId}/invoice`, cookies.sales).send({
        customerId: customer,
        lengthFt,
      });
      expect(bad.status, `length ${JSON.stringify(lengthFt)}`).toBe(400);
    }
    expect(
      (await call("post", `/rolls/${rollId}/invoice`, cookies.sales).send({ customerId: "not-a-uuid", lengthFt: "5" }))
        .status,
    ).toBe(400);
    expect(
      (await call("post", `/rolls/${uuidv7()}/invoice`, cookies.sales).send({ customerId: customer, lengthFt: "5" }))
        .status,
    ).toBe(400);
    // Only the one invoice was made for this roll.
    expect(
      (await call("get", "/stock-holds", cookies.owner)).body.filter((h: Hold) => h.rollId === rollId),
    ).toHaveLength(1);
  });

  it("shares commission between two people until the first confirmed payment", async () => {
    const invoice = await tileInvoice(await newCustomer("Wes Aldana"));
    const url = `/invoices/${invoice.id}/commission-split`;
    const two = [
      { userId: salesUserId, pct: "60" },
      { userId: hrUserId, pct: "40" },
    ];
    expect((await call("put", url, cookies.owner).send({ split: two })).status).toBe(200);
    expect(await auditActions()).toContain("Changed commission split");
    // Roles holding sales.invoice.edit or hr.commission.manage may; the warehouse holds neither.
    expect((await call("put", url, cookies.warehouse).send({ split: two })).status).toBe(403);
    expect((await call("put", url, cookies.sales).send({ split: two })).status).toBe(403);
    expect((await call("put", url, cookies.accountant).send({ split: two })).status).toBe(200);
    const three = await call("put", url, cookies.owner).send({
      split: [...two, { userId: uuidv7(), pct: "10" }],
    });
    expect(three.status).toBe(400);
    const notHundred = await call("put", url, cookies.owner).send({ split: two.map((s) => ({ ...s, pct: "30" })) });
    expect(notHundred.status).toBe(400);
    expect(notHundred.body.message).toContain("100%");
    expect(
      (await call("put", url, cookies.owner).send({ split: [two[0], { userId: salesUserId, pct: "40" }] })).status,
    ).toBe(400);
    expect((await call("put", url, cookies.owner).send({ split: [{ userId: "x", pct: "100" }] })).status).toBe(400);
    expect(
      (await call("put", `/invoices/${uuidv7()}/commission-split`, cookies.owner).send({ split: two })).status,
    ).toBe(404);
    expect((await call("put", url, cookies.owner).send({ split: [{ userId: salesUserId, pct: "100" }] })).status).toBe(
      200,
    );
    await pay(invoice.id);
    const locked = await call("put", url, cookies.owner).send({ split: two });
    expect(locked.status).toBe(400);
    expect(locked.body.message).toContain("locked");
  });

  it("never shows or touches another company's holds and rolls", async () => {
    const invoice = await tileInvoice(await newCustomer("Xena Pruitt"));
    const hold = await holdOf(invoice.id);
    const rollId = await newRoll();
    const other = await harness.provisionCompany("issueother");
    await setUp(other.id);
    const stranger = await enrolled(await harness.addUser({ companyIds: [other.id], roles: ["owner"] }));
    const theirs = await call("get", "/stock-holds", stranger);
    expect(theirs.status).toBe(200);
    expect(theirs.body).toEqual([]);
    expect(
      (await call("post", `/reservations/${hold.reservationId}/issue`, stranger).send({ overrideReason: "Mine now" }))
        .status,
    ).toBe(404);
    expect(
      (await call("post", `/rolls/${rollId}/invoice`, stranger).send({ customerId: uuidv7(), lengthFt: "5" })).status,
    ).toBe(400);
  });

  it("refuses a roll invoice for a customer with no job site, so tax is never silently nothing", async () => {
    const bare = await newCustomer("No Site Co");
    const refused = await call("post", `/rolls/${await newRoll()}/invoice`, cookies.sales).send({
      customerId: bare,
      lengthFt: "5",
    });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("job site");
  });

  it("moves a used-up roll's other holds to its remnant, so the leftover is never promised twice", async () => {
    const customer = await newSiteCustomer("Remnant Co");
    const rollId = await newRoll();
    const first = await call("post", `/rolls/${rollId}/invoice`, cookies.sales)
      .send({ customerId: customer, lengthFt: "90" })
      .expect(201);
    const second = await call("post", `/rolls/${rollId}/invoice`, cookies.sales)
      .send({ customerId: customer, lengthFt: "5" })
      .expect(201);
    await pay(first.body.id);
    await call("post", `/reservations/${(await holdOf(first.body.id)).reservationId}/issue`, cookies.warehouse)
      .send({})
      .expect(201);
    // 10 ft were left, under 12: the remnant now carries the second hold.
    const moved = await holdOf(second.body.id);
    expect(moved.rollId).not.toBe(rollId);
    await call("post", `/rolls/${moved.rollId}/invoice`, cookies.sales)
      .send({ customerId: customer, lengthFt: "6" })
      .expect(400);
    await pay(second.body.id);
    await call("post", `/reservations/${moved.reservationId}/issue`, cookies.warehouse).send({}).expect(201);
  });

  it("hides another rep's invoice and customer on a hold from an own-scope reader", async () => {
    // A customer of the owner's, so its invoice is outside the Sales rep's own scope.
    const other = await newSiteCustomer("Owner Account Co", cookies.owner);
    const invoice = await call("post", `/rolls/${await newRoll()}/invoice`, cookies.owner).send({
      customerId: other,
      lengthFt: "4",
    });
    expect(invoice.status).toBe(201);
    const seen = ((await call("get", "/stock-holds", cookies.sales).expect(200)).body as Hold[]).filter(
      (hold) => hold.rollId !== null && hold.invoiceId === "",
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((hold) => hold.customerName === "" && hold.invoiceNumber === "" && !hold.mayIssue)).toBe(true);
  });

  it("names only active people of this company in a split, and keeps the rep without commission rights", async () => {
    const invoice = await tileInvoice(await newCustomer("Split Rules Co"));
    const url = `/invoices/${invoice.id}/commission-split`;
    const stranger = await call("put", url, cookies.owner).send({ split: [{ userId: uuidv7(), pct: "100" }] });
    expect(stranger.status).toBe(400);
    // The Accountant holds sales.invoice.edit but not hr.commission.manage, so the rep stays in.
    const withoutRep = await call("put", url, cookies.accountant).send({ split: [{ userId: hrUserId, pct: "100" }] });
    expect(withoutRep.status).toBe(400);
    expect(withoutRep.body.message).toContain("sales rep");
  });
});
