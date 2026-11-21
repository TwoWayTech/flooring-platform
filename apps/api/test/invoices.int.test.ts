import {
  auditLog,
  branches,
  invoices,
  locations,
  products,
  quoteLines,
  rolePermissions,
  roles,
  settings,
  stockMovements,
  taxRules,
  userProfiles,
} from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import {
  addDays,
  bestSellersIn,
  CREDIT_NOTE_PREFIX,
  dec,
  FIRST_CREDIT_NOTE,
  nextNumber,
  type Product,
  type ViewedInvoice,
} from "@workspace/shared";
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

/**
 * Today in the test companies' time zone (`AuthHarness.provisionCompany` uses America/Chicago). The
 * API dates everything by the company's day, so the UTC day is "tomorrow" in the evening.
 */
function companyDay(): string {
  return dayIn(new Date(), "America/Chicago");
}

/** A small file that starts like a PDF, as proof. */
const PDF = { name: "receipt.pdf", data: Buffer.from("%PDF-1.4\n% proof of payment\n").toString("base64") };
/** Text named as an image: its first bytes are not an accepted type. */
const FAKE_PNG = { name: "photo.png", data: Buffer.from("just some text, not an image").toString("base64") };

/**
 * Sales, part 2 (docs/product-spec/sales.md "Conversion and invoices", "Payments", "Corrections";
 * ADR 0038): conversion with stock holds, the two-person check, proof files, corrections, customer
 * credit and refunds, data scope, audit and company isolation.
 */
describe("sales part 2: invoices and payments (P11, needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let other = { id: "", slug: "" };
  let warehouse = "";
  let otherWarehouse = "";
  let otherTile = "";
  let tile = "";
  const cookies = { salesA: "", salesB: "", accountant: "", owner: "", otherSales: "", dispatcher: "", manager: "" };

  function call(method: "get" | "post", path: string, cookie: string) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
  }

  /** A branch, a warehouse with 50 sq ft of tile, Summit's settings, payment rules and a Colorado tax rule. */
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
      await handle.db.insert(stockMovements).values({
        at: new Date(),
        productId: product.id,
        locationId: store.id,
        quantity: "50",
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
      return { branch: branch.id, warehouse: store.id, tile: product.id };
    } finally {
      await handle.close();
    }
  }

  async function placeIn(companyId: string, email: string, branchId: string) {
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

  /** An accepted quote for 100 sq ft of tile (450.00 + 39.65 tax = 489.65) with the given deposit, converted to an invoice. */
  async function invoiced(cookie: string, customerId: string, location = warehouse, product = tile, depositPct = "0") {
    const quote = await call("post", "/quotes", cookie)
      .send({
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
        depositPct,
        taxOverride: null,
        notes: "",
      })
      .expect(201);
    await call("post", `/quotes/${quote.body.id}/status`, cookie)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    await call("post", `/quotes/${quote.body.id}/status`, cookie).send({ action: "accept" }).expect(201);
    const invoice = await call("post", `/quotes/${quote.body.id}/invoice`, cookie).expect(201);
    return { quote: quote.body as { id: string }, invoice: invoice.body as { id: string; number: string } };
  }

  function payment(invoiceId: string, extra: Record<string, unknown> = {}) {
    return {
      invoiceId,
      kind: "payment",
      amount: "100.00",
      date: companyDay(),
      method: "check",
      checkNumber: "1001",
      cardLast4: "",
      reference: `CHK-${uuidv7()}`,
      note: "",
      extraAsCredit: false,
      allowDuplicateReference: false,
      files: [PDF],
      ...extra,
    };
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("bill");
    other = await harness.provisionCompany("billother");
    const mine = await setUp(company.id);
    const theirs = await setUp(other.id);
    warehouse = mine.warehouse;
    otherWarehouse = theirs.warehouse;
    otherTile = theirs.tile;
    tile = mine.tile;
    // A custom role that sees invoices but not money (PR #15 security review).
    const handle = await harness.companyDb(company.id);
    try {
      const [role] = await handle.db
        .insert(roles)
        .values({ key: "dispatcher", name: "Dispatcher", dataScope: "all" as const })
        .returning();
      await handle.db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "sales.invoice.view" });
    } finally {
      await handle.close();
    }
    const emails = {
      dispatcher: await harness.addUser({ companyIds: [company.id], roles: ["dispatcher"] }),
      manager: await harness.addUser({ companyIds: [company.id], roles: ["manager"] }),
      salesA: await harness.addUser({ companyIds: [company.id], roles: ["sales"] }),
      salesB: await harness.addUser({ companyIds: [company.id], roles: ["sales"] }),
      accountant: await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }),
      owner: await harness.addUser({ companyIds: [company.id], roles: ["owner"] }),
      otherSales: await harness.addUser({ companyIds: [other.id], roles: ["sales"] }),
    };
    await placeIn(company.id, emails.salesA, mine.branch);
    cookies.salesA = await harness.signIn(emails.salesA);
    cookies.salesB = await harness.signIn(emails.salesB);
    cookies.accountant = await enrolled(emails.accountant);
    cookies.owner = await enrolled(emails.owner);
    cookies.otherSales = await harness.signIn(emails.otherSales);
    cookies.dispatcher = await harness.signIn(emails.dispatcher);
    cookies.manager = await harness.signIn(emails.manager);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("converts an accepted quote once, with server totals, and holds what stock there is", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Rae Chen" }).expect(201);
    const { quote, invoice } = await invoiced(cookies.salesA, customer.body.id);
    expect(invoice).toMatchObject({ total: "489.65", tax: "39.65", isReturn: false, quoteId: quote.id });
    expect(invoice.number).toMatch(/^INV-\d+$/);
    // Cost is stripped for Sales, which does not hold product cost (rule 5).
    expect(invoice).not.toHaveProperty("cost");
    expect((await call("post", `/quotes/${quote.id}/invoice`, cookies.salesA)).status).toBe(409);
    // 50 sq ft on hand: 50 held and 50 short, which does not block the sale (spec rule 19).
    const holds = (await call("get", "/reservations", cookies.salesA).expect(200)).body.filter(
      (r: { invoiceId: string }) => r.invoiceId === invoice.id,
    );
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ quantity: "50.000", shortBy: "50.000", status: "active" });
    const quotes = (await call("get", "/quotes", cookies.salesA)).body as { id: string; status: string }[];
    expect(quotes.find((q) => q.id === quote.id)?.status).toBe("converted");
    // Another rep's own scope does not reach it.
    const seenByB = (await call("get", "/invoices", cookies.salesB).expect(200)).body.some(
      (i: { id: string }) => i.id === invoice.id,
    );
    expect(seenByB).toBe(false);
    expect((await call("post", `/invoices/${invoice.id}/sent`, cookies.salesB)).status).toBe(404);
    const sent = await call("post", `/invoices/${invoice.id}/sent`, cookies.salesA).expect(201);
    expect(sent.body.sentAt).not.toBeNull();
  });

  // Click-through #1 (2026-11-21): the dashboard's best sellers join GET /invoices to GET /products,
  // so every product an invoice line sells must be in the catalog the same person reads, named.
  it("names every best seller for the Owner and for Sales: invoice lines' products are in their GET /products", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Best Seller Co" }).expect(201);
    await invoiced(cookies.salesA, customer.body.id);
    for (const cookie of [cookies.owner, cookies.salesA]) {
      const [invoiceList, productList] = await Promise.all([
        call("get", "/invoices", cookie).expect(200),
        call("get", "/products", cookie).expect(200),
      ]);
      const sold = invoiceList.body as ViewedInvoice[];
      const catalog = productList.body as Product[];
      const rows = bestSellersIn(sold, catalog, {
        from: "2000-01-01",
        to: "2099-12-31",
        metric: "revenue",
        limit: 5,
      });
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const product = catalog.find((p) => p.id === row.productId);
        expect(product?.name).toBe("Slate Tile");
        expect(product).toHaveProperty("swatch");
      }
    }
  });

  it("dates a new invoice by the customer's terms: due on receipt is due the day it is issued (sales.md rule 21, click-through #10)", async () => {
    // A new customer takes the company's default terms, which are Summit's "Due on receipt".
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Noor Haddad" }).expect(201);
    expect(customer.body.terms).toBe("due_on_receipt");
    const { invoice } = await invoiced(cookies.salesA, customer.body.id);
    const plain = invoice as unknown as { issuedAt: string; dueAt: string | null };
    expect(plain.dueAt).toBe(plain.issuedAt);
    // A deposit invoice's balance gets the company's 30 balance days instead (the PDF says so).
    const deposit = (await invoiced(cookies.salesA, customer.body.id, warehouse, tile, "50")).invoice as unknown as {
      issuedAt: string;
      dueAt: string | null;
    };
    expect(deposit.dueAt).toBe(addDays(deposit.issuedAt, 30));
  });

  it("F-m refuses to convert a quote whose boxed line isn't whole cartons, as a quote saved before the rule (rule 7, ADR 0027)", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Jo Lindqvist" }).expect(201);
    const quote = await call("post", "/quotes", cookies.salesA)
      .send({
        customerId: customer.body.id,
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
            quantity: "160",
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
    // A line written before the API checked cartons: 150 sq ft is 7.5 cartons of 20.
    const handle = await harness.companyDb(company.id);
    try {
      await handle.db.update(quoteLines).set({ quantity: "150" }).where(eq(quoteLines.quoteId, quote.body.id));
    } finally {
      await handle.close();
    }
    await call("post", `/quotes/${quote.body.id}/status`, cookies.salesA)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    await call("post", `/quotes/${quote.body.id}/status`, cookies.salesA).send({ action: "accept" }).expect(201);
    const refused = await call("post", `/quotes/${quote.body.id}/invoice`, cookies.salesA);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({
      code: "invalid_request",
      message: "Slate Tile: sell whole cartons, multiples of 20 sq ft.",
    });
    const made = (await call("get", "/invoices", cookies.salesA).expect(200)).body.some(
      (i: { quoteId: string }) => i.quoteId === quote.body.id,
    );
    expect(made).toBe(false);
  });

  it("F-m converts a quote whose line without a product was stored with a zero pack, rather than answer 500 (security review, round 1)", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Ken Ito" }).expect(201);
    const quote = await call("post", "/quotes", cookies.salesA)
      .send({
        customerId: customer.body.id,
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
            quantity: "20",
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
    // A pack an older save kept on a line: now zero, which no carton can be.
    const handle = await harness.companyDb(company.id);
    try {
      await handle.db.update(quoteLines).set({ sqFtPerCarton: "0" }).where(eq(quoteLines.quoteId, quote.body.id));
    } finally {
      await handle.close();
    }
    await call("post", `/quotes/${quote.body.id}/status`, cookies.salesA)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    await call("post", `/quotes/${quote.body.id}/status`, cookies.salesA).send({ action: "accept" }).expect(201);
    const converted = await call("post", `/quotes/${quote.body.id}/invoice`, cookies.salesA);
    expect(converted.status, JSON.stringify(converted.body)).toBe(201);
  });

  it("checks proof, references and amounts, and makes a second person confirm", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Omar Haddad" }).expect(201);
    const { invoice } = await invoiced(cookies.salesA, customer.body.id);
    expect((await call("post", "/payments", cookies.salesA).send(payment(invoice.id, { files: [] }))).status).toBe(400);
    expect(
      (await call("post", "/payments", cookies.salesA).send(payment(invoice.id, { files: [FAKE_PNG] }))).status,
    ).toBe(400);
    expect(
      (await call("post", "/payments", cookies.salesA).send(payment(invoice.id, { amount: "500.00" }))).status,
    ).toBe(400);
    // Sales sees only its own sales, so what it records always waits (plan N-1).
    const first = await call("post", "/payments", cookies.salesA)
      .send(payment(invoice.id, { reference: "CHK-SAME-1" }))
      .expect(201);
    expect(first.body).toMatchObject({ status: "pending", amount: "100.00" });
    expect(first.body.number).toMatch(/^PAY-\d{4}$/);
    expect(first.body.files).toHaveLength(1);
    const duplicate = await call("post", "/payments", cookies.salesA).send(
      payment(invoice.id, { reference: "chk-same-1 " }),
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("duplicate_reference");
    await call("post", `/payments/${first.body.id}/review`, cookies.accountant).send({ action: "confirm" }).expect(201);
    // The accountant's own payment above the threshold waits for someone else.
    const own = await call("post", "/payments", cookies.accountant)
      .send(payment(invoice.id, { amount: "300.00", method: "ach", checkNumber: "" }))
      .expect(201);
    expect(own.body.status).toBe("pending");
    expect(
      (await call("post", `/payments/${own.body.id}/review`, cookies.accountant).send({ action: "confirm" })).status,
    ).toBe(403);
    expect(
      (await call("post", `/payments/${own.body.id}/review`, cookies.owner).send({ action: "reject", reason: "" }))
        .status,
    ).toBe(400);
    await call("post", `/payments/${own.body.id}/review`, cookies.owner).send({ action: "confirm" }).expect(201);
    // The proof opens for whoever sees the invoice, and for nobody else.
    const fileId = first.body.files[0].id as string;
    const file = await call("get", `/files/${fileId}`, cookies.salesA).expect(200);
    expect(file.headers["content-type"]).toContain("application/pdf");
    expect((await call("get", `/files/${fileId}`, cookies.salesB)).status).toBe(404);
    expect((await call("get", `/files/${fileId}`, cookies.otherSales)).status).toBe(404);
    // An invoice with confirmed money cannot be voided.
    expect(
      (await call("post", `/invoices/${invoice.id}/void`, cookies.owner).send({ reason: "Wrong job" })).status,
    ).toBe(400);
  });

  it("adds proof to a payment, three files at most, only within scope, and none to a rejected payment (F-q)", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Lena Park" }).expect(201);
    const { invoice } = await invoiced(cookies.salesA, customer.body.id);
    const paid = await call("post", "/payments", cookies.salesA).send(payment(invoice.id)).expect(201);
    const path = `/payments/${paid.body.id}/files`;
    const added = await call("post", path, cookies.salesA)
      .send({ files: [PDF] })
      .expect(201);
    expect(added.body.files).toHaveLength(2);
    // Three in all: one more fits, two more don't, and a refused add stores nothing.
    expect((await call("post", path, cookies.salesA).send({ files: [PDF, PDF] })).status).toBe(400);
    // Another rep's own scope, another company and a role without the key don't reach it.
    expect((await call("post", path, cookies.salesB).send({ files: [PDF] })).status).toBe(404);
    expect((await call("post", path, cookies.otherSales).send({ files: [PDF] })).status).toBe(404);
    const noKey = await call("post", path, cookies.dispatcher).send({ files: [PDF] });
    expect([noKey.status, noKey.body.code]).toEqual([403, "forbidden"]);
    await call("post", `/payments/${paid.body.id}/review`, cookies.accountant)
      .send({ action: "reject", reason: "The check is unreadable." })
      .expect(201);
    const refused = await call("post", path, cookies.salesA).send({ files: [PDF] });
    expect([refused.status, refused.body.message]).toEqual([
      400,
      `Payment ${paid.body.number} is rejected; files can't be added.`,
    ]);
    const seen = (await call("get", "/payments", cookies.salesA).expect(200)).body as {
      id: string;
      files: unknown[];
    }[];
    expect(seen.find((p) => p.id === paid.body.id)?.files).toHaveLength(2);
    const handle = await harness.companyDb(company.id);
    try {
      const rows = await handle.db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.targetId, paid.body.id));
      expect(rows.filter((row) => row.action === "Attached file to payment")).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it("writes off small leftovers, turns credit notes into credit, applies and refunds it", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Ines Moreau" }).expect(201);
    const { invoice } = await invoiced(cookies.salesA, customer.body.id);
    const paid = await call("post", "/payments", cookies.owner)
      .send(payment(invoice.id, { amount: "489.60", method: "cash", checkNumber: "", reference: "" }))
      .expect(201);
    await call("post", `/payments/${paid.body.id}/review`, cookies.accountant).send({ action: "confirm" }).expect(201);
    expect((await call("post", `/invoices/${invoice.id}/write-off`, cookies.owner).send({ reason: "x" })).status).toBe(
      400,
    );
    const writeOff = await call("post", `/invoices/${invoice.id}/write-off`, cookies.owner)
      .send({ reason: "Rounding" })
      .expect(201);
    expect(writeOff.body).toMatchObject({ kind: "write_off", amount: "0.05" });
    // A write-off was never paid, so a credit note on it would make refundable credit (PR #16 review).
    expect(
      (
        await call("post", `/invoices/${invoice.id}/credit-notes`, cookies.owner).send({
          subtotal: "100.00",
          reason: "Returned two cartons",
        })
      ).status,
    ).toBe(400);
    // Paid in full, so the note becomes credit: 100.00 before tax, tax in proportion 39.65 × 100 / 450 = 8.81.
    const paidInFull = await invoiced(cookies.salesA, customer.body.id);
    const full = await call("post", "/payments", cookies.owner)
      .send(payment(paidInFull.invoice.id, { amount: "489.65", method: "cash", checkNumber: "", reference: "" }))
      .expect(201);
    await call("post", `/payments/${full.body.id}/review`, cookies.accountant).send({ action: "confirm" }).expect(201);
    const note = await call("post", `/invoices/${paidInFull.invoice.id}/credit-notes`, cookies.owner)
      .send({ subtotal: "100.00", reason: "Returned two cartons" })
      .expect(201);
    expect(note.body).toMatchObject({ isReturn: true, subtotal: "100.00", tax: "8.81", total: "108.81" });
    expect(note.body.number).toMatch(/^CR-\d+$/);
    expect(
      (
        await call("post", `/invoices/${paidInFull.invoice.id}/credit-notes`, cookies.owner).send({
          subtotal: "400.00",
          reason: "Too much",
        })
      ).status,
    ).toBe(400);
    const refund = (amount: string) => ({
      customerId: customer.body.id,
      amount,
      date: companyDay(),
      method: "check",
      reference: `RF-CHK-${uuidv7()}`,
      note: "",
      files: [PDF],
    });
    expect((await call("post", "/refunds", cookies.owner).send(refund("200.00"))).status).toBe(400);
    const refunded = await call("post", "/refunds", cookies.owner).send(refund("50.00")).expect(201);
    expect(refunded.body.number).toMatch(/^RF-\d{4}$/);
    const second = await invoiced(cookies.salesA, customer.body.id);
    const applied = await call("post", `/invoices/${second.invoice.id}/apply-credit`, cookies.owner).expect(201);
    expect(applied.body).toMatchObject({ kind: "credit_applied", amount: "58.81" });
    expect((await call("post", `/invoices/${second.invoice.id}/apply-credit`, cookies.owner)).status).toBe(400);
    // The note's credit is spent, so voiding it would take back money already used.
    expect(
      (await call("post", `/invoices/${note.body.id}/void`, cookies.owner).send({ reason: "Mistake" })).status,
    ).toBe(400);
    // The note became credit because the payment counted, so the payment can't be voided now.
    expect(
      (await call("post", `/payments/${full.body.id}/void`, cookies.owner).send({ reason: "Bounced check" })).status,
    ).toBe(400);
    const voided = await call("post", `/payments/${paid.body.id}/void`, cookies.owner)
      .send({ reason: "Bounced check" })
      .expect(201);
    expect(voided.body).toMatchObject({ status: "voided", voidReason: "Bounced check" });
  });

  it("voids an invoice with nothing confirmed, voiding pending payments and releasing its stock", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Tomas Berg" }).expect(201);
    const { invoice } = await invoiced(cookies.salesA, customer.body.id);
    const pending = await call("post", "/payments", cookies.salesA).send(payment(invoice.id)).expect(201);
    expect((await call("post", `/invoices/${invoice.id}/void`, cookies.owner).send({ reason: "" })).status).toBe(400);
    const voided = await call("post", `/invoices/${invoice.id}/void`, cookies.owner)
      .send({ reason: "Customer cancelled" })
      .expect(201);
    expect(voided.body.voidedAt).not.toBeNull();
    const payments = (await call("get", "/payments", cookies.owner)).body as { id: string; status: string }[];
    expect(payments.find((p) => p.id === pending.body.id)?.status).toBe("voided");
    const holds = (await call("get", "/reservations", cookies.owner)).body as { invoiceId: string; status: string }[];
    expect(holds.filter((r) => r.invoiceId === invoice.id).every((r) => r.status === "released")).toBe(true);
  });

  it("settles an unpaid invoice with its own credit note, which then cannot be refunded or voided", async () => {
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Vera Holm" }).expect(201);
    const { invoice } = await invoiced(cookies.salesA, customer.body.id);
    const note = await call("post", `/invoices/${invoice.id}/credit-notes`, cookies.owner)
      .send({ subtotal: "450.00", reason: "Whole order returned" })
      .expect(201);
    expect(note.body).toMatchObject({ tax: "39.65", total: "489.65" });
    // The note paid the invoice off, so nothing is left as cash-refundable credit (ADR 0039).
    const adjustments = (await call("get", "/invoice-adjustments", cookies.owner)).body as {
      invoiceId: string;
      kind: string;
      amount: string;
    }[];
    expect(adjustments.find((a) => a.invoiceId === invoice.id)).toMatchObject({
      kind: "credit_applied",
      amount: "489.65",
    });
    const refund = {
      customerId: customer.body.id,
      amount: "10.00",
      date: companyDay(),
      method: "cash",
      reference: "",
      note: "",
      files: [PDF],
    };
    expect((await call("post", "/refunds", cookies.owner).send(refund)).status).toBe(400);
    expect(
      (await call("post", `/invoices/${invoice.id}/void`, cookies.owner).send({ reason: "Cancelled" })).status,
    ).toBe(400);
    expect(
      (await call("post", `/invoices/${note.body.id}/void`, cookies.owner).send({ reason: "Mistake" })).status,
    ).toBe(400);
  });

  it("numbers a credit note past every CR- number, an invoice's too, so the two series never collide", async () => {
    // An invoice holding the number the credit notes alone would take next, as an import or an old
    // prefix could leave one: credit notes share `invoices_number_uidx` (review round 1).
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Ilse Brandt" }).expect(201);
    const legacy = await invoiced(cookies.salesA, customer.body.id);
    const { invoice } = await invoiced(cookies.salesA, customer.body.id);
    const handle = await harness.companyDb(company.id);
    let taken = "";
    try {
      const notes = await handle.db
        .select({ number: invoices.number })
        .from(invoices)
        .where(eq(invoices.isReturn, true));
      taken = nextNumber(
        CREDIT_NOTE_PREFIX,
        notes.map((row) => row.number),
        FIRST_CREDIT_NOTE,
      );
      await handle.db.update(invoices).set({ number: taken }).where(eq(invoices.id, legacy.invoice.id));
    } finally {
      await handle.close();
    }
    const note = await call("post", `/invoices/${invoice.id}/credit-notes`, cookies.owner).send({
      subtotal: "45.00",
      reason: "One carton returned",
    });
    expect(note.status, JSON.stringify(note.body)).toBe(201);
    expect(note.body.number).toBe(`${CREDIT_NOTE_PREFIX}${Number(taken.slice(CREDIT_NOTE_PREFIX.length)) + 1}`);
  });

  it("posts every event to a ledger that stays in balance, and refuses a closed period", async () => {
    const before = (await call("get", "/ledger/trial-balance", cookies.owner).expect(200)).body as {
      balanced: boolean;
      rows: { key: string; balance: string }[];
    };
    expect(before.balanced).toBe(true);
    const receivable = (tb: typeof before) => tb.rows.find((r) => r.key === "accounts_receivable")!.balance;
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Lars Eide" }).expect(201);
    const { invoice } = await invoiced(cookies.salesA, customer.body.id);
    const paid = await call("post", "/payments", cookies.owner)
      .send(payment(invoice.id, { amount: "89.65", method: "cash", checkNumber: "", reference: "" }))
      .expect(201);
    expect(paid.body.status).toBe("confirmed");
    const after = (await call("get", "/ledger/trial-balance", cookies.owner).expect(200)).body as typeof before;
    expect(after.balanced).toBe(true);
    // 489.65 invoiced less 89.65 received leaves 400.00 more in receivables.
    expect(dec(receivable(after)).minus(receivable(before)).toFixed(2)).toBe("400.00");
    // Voiding the payment posts its reversal, and receivables go back up.
    await call("post", `/payments/${paid.body.id}/void`, cookies.owner).send({ reason: "Counted twice" }).expect(201);
    const reversed = (await call("get", "/ledger/trial-balance", cookies.owner)).body as typeof before;
    expect(dec(receivable(reversed)).minus(receivable(before)).toFixed(2)).toBe("489.65");
    expect(reversed.balanced).toBe(true);
    // Two payments overpay an invoice; voiding the first takes back the credit the second made, so
    // receivables and customer credit still match the documents (PR #16 review).
    const credit = (tb: typeof before) => tb.rows.find((r) => r.key === "customer_credit")!.balance;
    const overpaid = await invoiced(cookies.salesA, customer.body.id);
    const confirmed = async (amount: string, extra: Record<string, unknown> = {}) => {
      const recorded = await call("post", "/payments", cookies.owner)
        .send(payment(overpaid.invoice.id, { amount, method: "cash", checkNumber: "", reference: "", ...extra }))
        .expect(201);
      await call("post", `/payments/${recorded.body.id}/review`, cookies.accountant)
        .send({ action: "confirm" })
        .expect(201);
      return recorded.body as { id: string };
    };
    const first = await confirmed("300.00");
    await confirmed("300.00", { extraAsCredit: true });
    const both = (await call("get", "/ledger/trial-balance", cookies.owner)).body as typeof before;
    await call("post", `/payments/${first.id}/void`, cookies.owner).send({ reason: "Duplicate" }).expect(201);
    const one = (await call("get", "/ledger/trial-balance", cookies.owner)).body as typeof before;
    // 489.65 less 300.00 is owed again (189.65), and the 110.35 of credit is gone.
    expect(dec(receivable(one)).minus(receivable(both)).toFixed(2)).toBe("189.65");
    expect(dec(credit(one)).minus(credit(both)).toFixed(2)).toBe("110.35");
    expect(one.balanced).toBe(true);
    // Closing the books through today refuses anything dated today; reopening lets it through again.
    const today = companyDay();
    expect(
      (await call("post", "/ledger/period-close", cookies.accountant).send({ through: today, note: "" })).status,
    ).toBe(403);
    await call("post", "/ledger/period-close", cookies.owner).send({ through: today, note: "Month end" }).expect(201);
    const closed = await call("post", "/payments", cookies.owner).send(
      payment(invoice.id, { amount: "10.00", method: "cash", checkNumber: "", reference: "" }),
    );
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe("period_closed");
    await call("post", "/ledger/period-close", cookies.owner)
      .send({ through: "2000-01-01", note: "Reopened" })
      .expect(201);
    expect((await call("get", "/ledger/trial-balance", cookies.salesA)).status).toBe(403);
    // A branch-scoped role with the report key still may not see company-wide books.
    expect((await call("get", "/ledger/trial-balance", cookies.manager)).status).toBe(403);
    expect((await call("get", "/ledger/trial-balance?through=2026-02-30", cookies.owner)).status).toBe(400);
  });

  it("keeps payments, refunds and proof from someone who may see invoices but not money", async () => {
    expect((await call("get", "/invoices", cookies.dispatcher)).status).toBe(200);
    expect((await call("get", "/payments", cookies.dispatcher)).status).toBe(403);
    expect((await call("get", "/refunds", cookies.dispatcher)).status).toBe(403);
    expect((await call("get", `/files/${uuidv7()}`, cookies.dispatcher)).status).toBe(403);
  });

  it("lists invoices for a salesperson without `cost` or any line's `unitCost`, and for the Owner with both (B5)", async () => {
    // The contract the web's dashboard relies on (CLAUDE.md rule 5; ADR 0037, 2026-11-17): a viewer
    // without product cost gets no invoice cost at all, so the web must treat it as unknown.
    type Listed = { id: string; cost?: string; lines: { unitCost?: string }[] };
    const customer = await call("post", "/customers", cookies.salesA).send({ name: "Mina Park" }).expect(201);
    const { invoice } = await invoiced(cookies.salesA, customer.body.id);
    const listed = async (cookie: string) =>
      ((await call("get", "/invoices", cookie).expect(200)).body as Listed[]).find((i) => i.id === invoice.id);

    const mine = await listed(cookies.salesA);
    expect(mine).toBeDefined();
    expect(mine).not.toHaveProperty("cost");
    expect(mine!.lines.length).toBeGreaterThan(0);
    expect(mine!.lines.filter((line) => "unitCost" in line)).toEqual([]);

    const handle = await harness.companyDb(company.id);
    let stored = "";
    try {
      const [row] = await handle.db.select({ cost: invoices.cost }).from(invoices).where(eq(invoices.id, invoice.id));
      stored = row!.cost;
    } finally {
      await handle.close();
    }
    const owners = await listed(cookies.owner);
    expect(owners?.cost).toBe(stored);
    expect(owners!.lines).toHaveLength(mine!.lines.length);
    expect(owners!.lines.every((line) => typeof line.unitCost === "string")).toBe(true);
  });

  it("never reaches another company's invoices, payments or files", async () => {
    const theirs = await call("post", "/customers", cookies.otherSales).send({ name: "Theirs" }).expect(201);
    const { invoice } = await invoiced(cookies.otherSales, theirs.body.id, otherWarehouse, otherTile);
    expect((await call("post", `/invoices/${invoice.id}/sent`, cookies.salesA)).status).toBe(404);
    expect((await call("post", "/payments", cookies.salesA).send(payment(invoice.id))).status).toBe(404);
    expect((await call("get", "/invoices", cookies.salesA)).body.some((i: { id: string }) => i.id === invoice.id)).toBe(
      false,
    );
  });

  it("audits every invoice and payment change", async () => {
    const handle = await harness.companyDb(company.id);
    try {
      const actions = (await handle.db.select({ action: auditLog.action }).from(auditLog)).map((row) => row.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          "Converted quote to invoice",
          "Marked invoice sent",
          "Recorded payment",
          "Confirmed payment",
          "Wrote off balance",
          "Issued credit note",
          "Refunded customer credit",
          "Applied customer credit",
          "Voided payment",
          "Voided invoice",
          "Closed books",
          "Reopened books",
        ]),
      );
    } finally {
      await handle.close();
    }
  });
});
