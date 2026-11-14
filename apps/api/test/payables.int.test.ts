import { auditLog, branches, locations, products, settings, supplierBills, suppliers } from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { dec, moneyString } from "@workspace/shared";
import { eq } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";

/** Today in the test company's time zone (America/Chicago), which is the day the API dates by. */
function companyDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** A day shifted by whole calendar days, as yyyy-MM-dd. */
function shiftDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const PDF = { name: "invoice.pdf", data: Buffer.from("%PDF-1.4\n% supplier invoice\n").toString("base64") };

interface TrialBalance {
  balanced: boolean;
  rows: { key: string | null; balance: string }[];
}

interface BillBody {
  id: string;
  number: string;
  supplierId: string;
  receiptIds: string[];
  issuedAt: string;
  dueAt: string;
  total: string;
  matchIssues: string[];
  files: { id: string; name: string }[];
}

interface PaymentBody {
  id: string;
  number: string;
  status: string;
  amount: string;
  allocations: { billId: string; amount: string }[];
  files: { id: string }[];
}

interface Order {
  id: string;
  lineId: string;
  productId: string;
  locationId: string;
}

/**
 * Bills and supplier payments on the API (purchasing.md rules 18 to 34; P12 part 3; ADR 0042):
 * receipts and stock corrections posting, the moving average cost, bill matching, payment
 * approval, voids, bank accounts, pay-later expense bills and bill files.
 */
describe("payables API (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let warehouse = "";
  let servicesSupplier = "";
  const cookies = { owner: "", accountant: "", purchasing: "", warehouse: "", sales: "" };

  function call(method: "get" | "post" | "put", path: string, cookie: string) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
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

  async function rows<T>(read: (db: Awaited<ReturnType<typeof harness.companyDb>>["db"]) => Promise<T>): Promise<T> {
    const handle = await harness.companyDb(company.id);
    try {
      return await read(handle.db);
    } finally {
      await handle.close();
    }
  }

  /** The trial balance by account key, checked balanced on every read. */
  async function balances(): Promise<Map<string, string>> {
    const body = (await call("get", "/ledger/trial-balance", cookies.owner).expect(200)).body as TrialBalance;
    expect(body.balanced).toBe(true);
    return new Map(body.rows.flatMap((row) => (row.key ? [[row.key, row.balance] as const] : [])));
  }

  /** How much an account's balance (debits less credits) moved between two readings. */
  function moved(before: Map<string, string>, after: Map<string, string>, key: string): string {
    return moneyString(dec(after.get(key) ?? "0").minus(before.get(key) ?? "0"));
  }

  async function newProduct(cost = "2.1000"): Promise<string> {
    return rows(async (db) => {
      const [product] = await db
        .insert(products)
        .values({
          sku: `T-${uuidv7()}`,
          name: "Slate Tile",
          category: "porcelain_tile" as const,
          unit: "sq_ft" as const,
          price: "4.5000",
          cost,
          sqFtPerCarton: "20",
        })
        .returning();
      return product!.id;
    });
  }

  async function newSupplier(name = `Supplier ${uuidv7()}`): Promise<string> {
    const created = await call("post", "/suppliers", cookies.purchasing)
      .send({ name, email: "orders@example.test" })
      .expect(201);
    return created.body.id as string;
  }

  /** An ordered purchase order for one product. */
  async function order(supplierId: string, quantity: string, cost = "2.1000", productId?: string): Promise<Order> {
    const product = productId ?? (await newProduct());
    const placed = await call("post", "/purchase-orders", cookies.purchasing)
      .send({
        supplierId,
        contactId: null,
        supplierRef: "",
        placedVia: "email",
        expectedAt: "2026-12-01",
        locationId: warehouse,
        lines: [{ productId: product, description: "Slate Tile", quantity, unit: "sq_ft", unitCost: cost }],
        asDraft: false,
      })
      .expect(201);
    return { id: placed.body.id, lineId: placed.body.lines[0].id, productId: product, locationId: warehouse };
  }

  async function receive(po: Order, received: string, damaged = "0") {
    return call("post", `/purchase-orders/${po.id}/receipts`, cookies.owner)
      .send({
        locationId: "",
        note: "",
        lines: [{ poLineId: po.lineId, productId: po.productId, received, damaged, rolls: [] }],
      })
      .expect(201);
  }

  function billForm(over: Record<string, unknown> = {}) {
    return { number: `INV-${uuidv7()}`, issuedAt: companyDay(), total: "210.00", files: [PDF], ...over };
  }

  function enterBill(po: Order, over: Record<string, unknown> = {}, cookie = cookies.purchasing) {
    return call("post", `/purchase-orders/${po.id}/bills`, cookie).send(billForm(over));
  }

  /** An order of `quantity` sq ft at 2.10, received in full and billed at the received value. */
  async function billedOrder(supplierId: string, quantity: string, issuedAt = companyDay()): Promise<BillBody> {
    const po = await order(supplierId, quantity);
    await receive(po, quantity);
    const total = moneyString(dec(quantity).times("2.1"));
    return (await enterBill(po, { total, issuedAt }).expect(201)).body;
  }

  function paymentForm(supplierId: string, amount: string, over: Record<string, unknown> = {}) {
    return {
      supplierId,
      amount,
      date: companyDay(),
      method: "cash",
      reference: "",
      note: "",
      files: [PDF],
      ...over,
    };
  }

  function pay(cookie: string, supplierId: string, amount: string, over: Record<string, unknown> = {}) {
    return call("post", "/supplier-payments", cookie).send(paymentForm(supplierId, amount, over));
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("pay");
    await rows(async (db) => {
      const address = { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" };
      const [branch] = await db.insert(branches).values({ name: "Main", city: "Austin", state: "TX" }).returning();
      const [store] = await db
        .insert(locations)
        .values({ name: "Warehouse", kind: "warehouse" as const, branchId: branch!.id, address, isDefault: true })
        .returning();
      const [services] = await db
        .insert(suppliers)
        .values({ name: "Harbor Property Co", type: "services" as const, terms: "net_30" as const, address })
        .returning();
      await db.insert(settings).values([
        {
          group: "payments",
          value: {
            approvalRequired: true,
            approvalThreshold: "500.00",
            writeOffMax: "5.00",
            paymentPrefix: "PAY-",
            refundPrefix: "RF-",
          },
        },
        { group: "expenses", value: { approvalRequired: true, approvalThreshold: "100.00" } },
      ]);
      warehouse = store!.id;
      servicesSupplier = services!.id;
    });
    cookies.owner = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
    cookies.accountant = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }));
    for (const role of ["purchasing", "warehouse", "sales"] as const) {
      cookies[role] = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: [role] }));
    }
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("refuses the unauthenticated, and roles without the purchasing money keys", async () => {
    const anonymous = (path: string) =>
      request(harness.app.getHttpServer()).get(path).set("X-Forwarded-Host", "localhost:3000");
    expect((await anonymous("/bills")).status).toBe(401);
    expect((await anonymous("/supplier-payments")).status).toBe(401);
    const supplier = await newSupplier();
    const po = await order(supplier, "100");
    await receive(po, "100");
    for (const role of ["sales", "warehouse"] as const) {
      expect((await call("get", "/bills", cookies[role])).status).toBe(403);
      expect((await enterBill(po, {}, cookies[role])).status).toBe(403);
      expect((await pay(cookies[role], supplier, "10.00")).status).toBe(403);
    }
    expect((await call("get", "/supplier-payments", cookies.sales)).status).toBe(403);
    // Purchasing records payments but neither confirms nor voids them (role template).
    const bill = (await enterBill(po).expect(201)).body as BillBody;
    const paid = (await pay(cookies.purchasing, supplier, "50.00").expect(201)).body as PaymentBody;
    expect(
      (await call("post", `/supplier-payments/${paid.id}/review`, cookies.purchasing).send({ action: "confirm" }))
        .status,
    ).toBe(403);
    expect(
      (await call("post", `/supplier-payments/${paid.id}/void`, cookies.purchasing).send({ reason: "Mistake" })).status,
    ).toBe(403);
    expect((await call("get", "/bills", cookies.purchasing).expect(200)).body.map((b: BillBody) => b.id)).toContain(
      bill.id,
    );
    expect((await call("get", "/supplier-payments", cookies.purchasing).expect(200)).body.length).toBeGreaterThan(0);
  });

  it("posts goods received at the order's cost, leaves out damaged units and moves the average cost", async () => {
    const supplier = await newSupplier();
    const product = await newProduct("2.0000");
    const first = await order(supplier, "100", "2.1000", product);
    const before = await balances();
    await receive(first, "100");
    const afterFirst = await balances();
    expect(moved(before, afterFirst, "inventory")).toBe("210.00");
    expect(moved(before, afterFirst, "received_not_billed")).toBe("-210.00");
    expect(await rows((db) => db.select().from(products).where(eq(products.id, product)))).toMatchObject([
      { cost: "2.1000" },
    ]);
    const second = await order(supplier, "100", "3.1000", product);
    await receive(second, "100");
    // (100 on hand at 2.10 + 100 received at 3.10) over 200.
    expect(await rows((db) => db.select().from(products).where(eq(products.id, product)))).toMatchObject([
      { cost: "2.6000" },
    ]);
    // Damaged units are not stock and not owed: 40 good of 60 arrived is worth 84.00.
    const damaged = await order(supplier, "100");
    const beforeDamaged = await balances();
    await receive(damaged, "40", "20");
    const afterDamaged = await balances();
    expect(moved(beforeDamaged, afterDamaged, "inventory")).toBe("84.00");
    expect(moved(beforeDamaged, afterDamaged, "received_not_billed")).toBe("-84.00");
  });

  it("enters a bill over every unbilled receipt, flags a difference and refuses a second bill", async () => {
    const supplier = await newSupplier();
    const matched = await order(supplier, "100");
    await receive(matched, "40");
    await receive(matched, "60");
    const before = await balances();
    const bill = (await enterBill(matched, { total: "210.00" }).expect(201)).body as BillBody;
    const after = await balances();
    expect(bill.receiptIds).toHaveLength(2);
    expect(bill.matchIssues).toEqual([]);
    expect(bill.files).toHaveLength(1);
    expect(moved(before, after, "received_not_billed")).toBe("210.00");
    expect(moved(before, after, "accounts_payable")).toBe("-210.00");
    expect(moved(before, after, "inventory")).toBe("0.00");
    const again = await enterBill(matched);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("invalid_request");
    expect(again.body.message).toContain("already billed");

    const over = await order(supplier, "100");
    await receive(over, "100");
    const beforeOver = await balances();
    const overBill = (await enterBill(over, { total: "250.00" }).expect(201)).body as BillBody;
    const afterOver = await balances();
    expect(overBill.matchIssues).toHaveLength(1);
    expect(overBill.matchIssues[0]).toContain("over");
    expect(moved(beforeOver, afterOver, "received_not_billed")).toBe("210.00");
    expect(moved(beforeOver, afterOver, "inventory")).toBe("40.00");
    expect(moved(beforeOver, afterOver, "accounts_payable")).toBe("-250.00");

    const under = await order(supplier, "100");
    await receive(under, "100");
    const beforeUnder = await balances();
    const underBill = (await enterBill(under, { total: "200.00" }).expect(201)).body as BillBody;
    const afterUnder = await balances();
    expect(underBill.matchIssues[0]).toContain("under");
    expect(moved(beforeUnder, afterUnder, "inventory")).toBe("-10.00");
    expect(moved(beforeUnder, afterUnder, "accounts_payable")).toBe("-200.00");
  });

  it("refuses a bill without the invoice file, dated in the future, with a bad total or for nothing received", async () => {
    const supplier = await newSupplier();
    const po = await order(supplier, "100");
    const unreceived = await enterBill(po);
    expect(unreceived.status).toBe(400);
    await receive(po, "100");
    const before = await balances();
    const noFile = await enterBill(po, { files: [] });
    expect(noFile.status).toBe(400);
    expect(noFile.body).toEqual({ code: "invalid_request", message: expect.any(String) });
    const future = await enterBill(po, { issuedAt: shiftDays(companyDay(), 3) });
    expect(future.status).toBe(400);
    expect(future.body.message).toContain("future");
    expect((await enterBill(po, { total: "0.00" })).status).toBe(400);
    expect((await enterBill(po, { total: "12.345" })).status).toBe(400);
    expect((await enterBill(po, { number: "  " })).status).toBe(400);
    expect((await enterBill(po, { files: [{ name: "x.pdf", data: "not base64!" }] })).status).toBe(400);
    expect((await enterBill(po, { surprise: true })).status).toBe(400);
    expect((await enterBill({ ...po, id: uuidv7() })).status).toBe(404);
    expect(moved(before, await balances(), "accounts_payable")).toBe("0.00");
    expect((await call("get", "/bills", cookies.purchasing).expect(200)).body).not.toContainEqual(
      expect.objectContaining({ poId: po.id }),
    );
  });

  it("confirms a payment under the threshold, allocates oldest due first and refuses too much", async () => {
    const supplier = await newSupplier();
    const older = await billedOrder(supplier, "100", shiftDays(companyDay(), -40));
    const newer = await billedOrder(supplier, "100");
    expect(older.dueAt <= newer.dueAt).toBe(true);
    const before = await balances();
    const paid = (await pay(cookies.purchasing, supplier, "300.00").expect(201)).body as PaymentBody;
    const after = await balances();
    expect(paid.status).toBe("confirmed");
    expect(paid.number).toMatch(/^SP-\d+$/);
    expect(paid.allocations).toEqual([
      { billId: older.id, amount: "210.00" },
      { billId: newer.id, amount: "90.00" },
    ]);
    expect(moved(before, after, "accounts_payable")).toBe("300.00");
    expect(moved(before, after, "cash")).toBe("-300.00");
    const refused = await pay(cookies.purchasing, supplier, "120.01");
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("invalid_request");
    expect(refused.body.message).toContain("more than");
    const exact = (await pay(cookies.purchasing, supplier, "120.00").expect(201)).body as PaymentBody;
    expect(exact.allocations).toEqual([{ billId: newer.id, amount: "120.00" }]);
    // Nothing is owed now.
    expect((await pay(cookies.purchasing, supplier, "0.01")).status).toBe(400);
    expect((await pay(cookies.purchasing, supplier, "0.00")).status).toBe(400);
    expect((await pay(cookies.purchasing, supplier, "ten")).status).toBe(400);
    expect((await pay(cookies.purchasing, uuidv7(), "10.00")).status).toBe(400);
    expect((await pay(cookies.purchasing, supplier, "10.00", { date: shiftDays(companyDay(), 2) })).status).toBe(400);
  });

  it("asks for a reference unless the payment is cash, and pays only the bills chosen", async () => {
    const supplier = await newSupplier();
    const first = await billedOrder(supplier, "100", shiftDays(companyDay(), -10));
    const second = await billedOrder(supplier, "100");
    const noReference = await pay(cookies.purchasing, supplier, "50.00", { method: "check" });
    expect(noReference.status).toBe(400);
    expect(noReference.body.message).toContain("reference");
    expect((await pay(cookies.purchasing, supplier, "50.00", { files: [] })).status).toBe(400);
    const chosen = (
      await pay(cookies.purchasing, supplier, "50.00", {
        method: "check",
        reference: "1042",
        billIds: [second.id],
      }).expect(201)
    ).body as PaymentBody;
    expect(chosen.allocations).toEqual([{ billId: second.id, amount: "50.00" }]);
    const anotherSupplier = await newSupplier();
    const foreign = await pay(cookies.purchasing, anotherSupplier, "10.00", { billIds: [first.id] });
    expect(foreign.status).toBe(400);
    const tooMuch = await pay(cookies.purchasing, supplier, "211.00", { billIds: [first.id] });
    expect(tooMuch.status).toBe(400);
  });

  it("holds a payment above the threshold until someone else confirms it, and a rejection needs a reason", async () => {
    const supplier = await newSupplier();
    await billedOrder(supplier, "600");
    const before = await balances();
    const held = (await pay(cookies.accountant, supplier, "600.00").expect(201)).body as PaymentBody;
    expect(held.status).toBe("pending");
    const whilePending = await balances();
    expect(moved(before, whilePending, "accounts_payable")).toBe("0.00");
    expect(moved(before, whilePending, "cash")).toBe("0.00");
    const own = await call("post", `/supplier-payments/${held.id}/review`, cookies.accountant).send({
      action: "confirm",
    });
    expect(own.status).toBe(400);
    expect(own.body.message).toContain("Someone else");
    const confirmed = await call("post", `/supplier-payments/${held.id}/review`, cookies.owner)
      .send({ action: "confirm" })
      .expect(201);
    expect(confirmed.body.status).toBe("confirmed");
    const after = await balances();
    expect(moved(before, after, "accounts_payable")).toBe("600.00");
    expect(moved(before, after, "cash")).toBe("-600.00");
    const twice = await call("post", `/supplier-payments/${held.id}/review`, cookies.owner).send({ action: "confirm" });
    expect(twice.status).toBe(400);

    const next = (await pay(cookies.accountant, supplier, "660.00").expect(201)).body as PaymentBody;
    expect(next.status).toBe("pending");
    const review = (body: object) => call("post", `/supplier-payments/${next.id}/review`, cookies.owner).send(body);
    expect((await review({ action: "reject", reason: "no" })).status).toBe(400);
    expect((await review({ action: "reject" })).status).toBe(400);
    expect((await review({ action: "approve" })).status).toBe(400);
    const rejected = await review({ action: "reject", reason: "Wrong amount" }).expect(201);
    expect(rejected.body.status).toBe("rejected");
    expect(moved(before, await balances(), "accounts_payable")).toBe("600.00");
    // A rejected payment no longer counts against what is unpaid: 660.00 still owed, and it is above the threshold again.
    expect((await pay(cookies.purchasing, supplier, "660.00").expect(201)).body.status).toBe("pending");
  });

  it("voids a confirmed payment with its reversal and restores the bill, and a pending one posts nothing", async () => {
    const supplier = await newSupplier();
    await billedOrder(supplier, "100");
    const before = await balances();
    const paid = (await pay(cookies.purchasing, supplier, "210.00").expect(201)).body as PaymentBody;
    expect((await pay(cookies.purchasing, supplier, "1.00")).status).toBe(400);
    const void_ = (reason: unknown, id = paid.id, cookie = cookies.accountant) =>
      call("post", `/supplier-payments/${id}/void`, cookie).send({ reason });
    expect((await void_("x")).status).toBe(400);
    const voided = await void_("Paid twice").expect(201);
    expect(voided.body.status).toBe("voided");
    const after = await balances();
    expect(moved(before, after, "accounts_payable")).toBe("0.00");
    expect(moved(before, after, "cash")).toBe("0.00");
    expect((await void_("Again")).status).toBe(400);
    // The bill owes its balance again.
    const repaid = await pay(cookies.purchasing, supplier, "210.00").expect(201);
    expect(repaid.body.status).toBe("confirmed");

    const other = await newSupplier();
    await billedOrder(other, "400");
    const mid = await balances();
    const waiting = (await pay(cookies.accountant, other, "600.00").expect(201)).body as PaymentBody;
    expect(waiting.status).toBe("pending");
    expect((await void_("Not needed", waiting.id, cookies.owner)).status).toBe(201);
    expect(moved(mid, await balances(), "accounts_payable")).toBe("0.00");
    expect((await void_("Not needed", uuidv7(), cookies.owner)).status).toBe(404);
  });

  it("counts payments waiting for a check against what is unpaid", async () => {
    const supplier = await newSupplier();
    await billedOrder(supplier, "400");
    const waiting = (await pay(cookies.accountant, supplier, "600.00").expect(201)).body as PaymentBody;
    expect(waiting.status).toBe("pending");
    const over = await pay(cookies.purchasing, supplier, "240.01");
    expect(over.status).toBe(400);
    expect(over.body.message).toContain("more than");
    expect((await pay(cookies.purchasing, supplier, "240.00").expect(201)).body.status).toBe("confirmed");
    await call("post", `/supplier-payments/${waiting.id}/void`, cookies.owner)
      .send({ reason: "Changed mind" })
      .expect(201);
    expect((await pay(cookies.purchasing, supplier, "600.00").expect(201)).body.status).toBe("pending");
  });

  it("credits the bank account claiming the payment's method, and a void credits it back", async () => {
    const saved = await call("put", "/settings/accounting", cookies.accountant)
      .send({
        costingMethod: "average",
        salesTaxBasis: "accrual",
        bankAccounts: [{ name: "Operating", methods: ["check"] }],
      })
      .expect(200);
    const operating = saved.body.bankAccounts[0].key as string;
    const supplier = await newSupplier();
    await billedOrder(supplier, "100");
    const before = await balances();
    const paid = (await pay(cookies.purchasing, supplier, "210.00", { method: "check", reference: "1043" }).expect(201))
      .body as PaymentBody;
    const after = await balances();
    expect(moved(before, after, operating)).toBe("-210.00");
    expect(moved(before, after, "cash")).toBe("0.00");
    expect(moved(before, after, "accounts_payable")).toBe("210.00");
    await call("post", `/supplier-payments/${paid.id}/void`, cookies.accountant)
      .send({ reason: "Bounced" })
      .expect(201);
    const voided = await balances();
    expect(moved(before, voided, operating)).toBe("0.00");
    expect(moved(before, voided, "accounts_payable")).toBe("0.00");
  });

  it("posts a stock count correction at the product's cost", async () => {
    const supplier = await newSupplier();
    const po = await order(supplier, "100");
    await receive(po, "100");
    const correct = (counted: string, cookie = cookies.owner) =>
      call("post", "/stock/corrections", cookie).send({
        productId: po.productId,
        rollId: null,
        locationId: po.locationId,
        counted,
        reason: "Cycle count",
      });
    expect((await correct("120", cookies.purchasing)).status).toBe(403);
    const before = await balances();
    await correct("120").expect(201);
    const gained = await balances();
    expect(moved(before, gained, "inventory")).toBe("42.00");
    expect(moved(before, gained, "inventory_adjustments")).toBe("-42.00");
    await correct("100").expect(201);
    const lost = await balances();
    expect(moved(gained, lost, "inventory")).toBe("-42.00");
    expect(moved(gained, lost, "inventory_adjustments")).toBe("42.00");
    expect((await correct("100")).status).toBe(400);
    expect(moved(before, await balances(), "inventory")).toBe("0.00");
  });

  it("pays a pay-later expense through a supplier payment, and then refuses to void the expense", async () => {
    const expense = await call("post", "/expenses", cookies.accountant)
      .send({
        date: companyDay(),
        supplierId: servicesSupplier,
        category: "rent",
        locationId: warehouse,
        amount: "60.00",
        tax: "",
        paymentMethod: "cash",
        reference: "",
        note: "",
        settlement: "on_account",
        asDraft: false,
        files: [PDF],
      })
      .expect(201);
    expect(expense.body.status).toBe("confirmed");
    const billId = expense.body.billId as string;
    const listed = (await call("get", "/bills", cookies.accountant).expect(200)).body as BillBody[];
    expect(listed.find((bill) => bill.id === billId)).toMatchObject({ total: "60.00", supplierId: servicesSupplier });
    const before = await balances();
    const paid = (await pay(cookies.purchasing, servicesSupplier, "60.00").expect(201)).body as PaymentBody;
    expect(paid.allocations).toEqual([{ billId, amount: "60.00" }]);
    const after = await balances();
    // The expense already posted the payable, so the payment settles it against cash.
    expect(moved(before, after, "accounts_payable")).toBe("60.00");
    expect(moved(before, after, "cash")).toBe("-60.00");
    const refused = await call("post", `/expenses/${expense.body.id}/void`, cookies.accountant).send({
      reason: "Entered twice",
    });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("payment");
    await call("post", `/supplier-payments/${paid.id}/void`, cookies.accountant)
      .send({ reason: "Wrong bill" })
      .expect(201);
    await call("post", `/expenses/${expense.body.id}/void`, cookies.accountant)
      .send({ reason: "Entered twice" })
      .expect(201);
    const bills = await rows((db) => db.select().from(supplierBills).where(eq(supplierBills.id, billId)));
    expect(bills[0]!.deletedAt).not.toBeNull();
  });

  it("opens a bill's file for purchasing.bill.view holders and hides it from sales", async () => {
    const supplier = await newSupplier();
    const bill = await billedOrder(supplier, "100");
    const fileId = bill.files[0]!.id;
    const opened = await call("get", `/files/${fileId}`, cookies.purchasing).expect(200);
    expect(opened.headers["content-type"]).toContain("pdf");
    const paid = (await pay(cookies.purchasing, supplier, "50.00").expect(201)).body as PaymentBody;
    await call("get", `/files/${paid.files[0]!.id}`, cookies.accountant).expect(200);
    expect((await call("get", `/files/${fileId}`, cookies.sales)).status).toBe(404);
    expect((await call("get", `/files/${fileId}`, cookies.warehouse)).status).toBe(403);
    expect((await call("get", `/files/${uuidv7()}`, cookies.purchasing)).status).toBe(404);
  });

  it("audits every bill and payment change", async () => {
    const actions = await rows(async (db) =>
      (await db.select({ action: auditLog.action }).from(auditLog)).map((r) => r.action),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "Received goods",
        "Entered bill",
        "Paid supplier",
        "Confirmed supplier payment",
        "Rejected supplier payment",
        "Voided supplier payment",
      ]),
    );
    // No money in a bill's audit entry: roles without the purchasing money keys read the log (rule 5).
    const entered = await rows((db) => db.select().from(auditLog).where(eq(auditLog.action, "Entered bill")));
    for (const entry of entered) {
      expect(entry.before).toBeNull();
      expect(Object.keys(entry.after as object).sort()).toEqual(["matched", "receipts"]);
    }
    await balances();
  });

  it("lets only one of two payments at once take the same balance (bill row locks)", async () => {
    const supplier = await newSupplier();
    await billedOrder(supplier, "100");
    const results = await Promise.all([
      pay(cookies.purchasing, supplier, "210.00"),
      pay(cookies.accountant, supplier, "210.00"),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 400]);
    await balances();
  });
});
