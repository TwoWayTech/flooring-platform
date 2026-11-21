import {
  auditLog,
  branches,
  customers,
  locations,
  rolePermissions,
  roles,
  settings,
  suppliers,
  supplierBills,
  taxRules,
  userProfiles,
} from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { dec, moneyString } from "@workspace/shared";
import { and, eq, inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";

type Who = "owner" | "manager" | "sales" | "accountant" | "warehouse" | "biller" | "scoped" | "otherManager";

interface Json {
  [key: string]: unknown;
}

interface TrialBalance {
  balanced: boolean;
  rows: { key: string | null; name: string; code: string; balance: string }[];
}

const PROOF = { name: "receipt.pdf", data: Buffer.from("%PDF-1.4\n% proof of payment\n").toString("base64") };
const PERIOD_END = companyDay();

/** Today in the test company's time zone (America/Chicago), which is the day the API dates by. */
function companyDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Summit's localization settings without the tax tables, as a company's settings row holds them. */
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
 * Contracts part 2 on the API (contracts.md rules 5 to 19; ADR 0045): progress billings and
 * retainage releases that raise an invoice or a bill and post a balanced entry, and the voids that
 * reverse them.
 */
describe("contract billings (contracts part 2; needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let other = { id: "", slug: "" };
  let supplierId = "";
  let customerId = "";
  let locationA = "";
  let branchA = "";
  const cookies: Record<Who, string> = {
    owner: "",
    manager: "",
    sales: "",
    accountant: "",
    warehouse: "",
    biller: "",
    scoped: "",
    otherManager: "",
  };

  function call(method: "get" | "post" | "put", path: string, who: Who) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookies[who]);
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

  function line(over: Json = {}) {
    return {
      code: "L1",
      description: "Tile",
      category: "labor",
      billing: "percent",
      scheduledValue: "1000.00",
      retainagePct: null,
      storedRetainagePct: null,
      milestoneDueAt: null,
      estimatedCost: "600.00",
      ...over,
    };
  }

  /** A subcontract project (5 % retainage, one 1000.00 labor line) unless overridden. */
  function form(over: Json = {}) {
    return {
      direction: "subcontractor",
      kind: "project",
      customerId: null,
      supplierId,
      title: "Lobby tile",
      scope: "Tile",
      branchId: branchA,
      locationId: locationA,
      jobSite: { street: "1 Main", city: "Denver", state: "CO", zip: "80202" },
      startsAt: "2026-11-01",
      endsAt: "2027-02-01",
      renewal: { mode: "none", noticeDays: 30 },
      retainagePct: "5",
      storedRetainagePct: "5",
      bondInLieu: false,
      taxTreatment: "on_billing",
      notes: "",
      lines: [line()],
      ...over,
    };
  }

  function customerForm(over: Json = {}) {
    return form({ direction: "customer", customerId, supplierId: null, title: "Customer job", ...over });
  }

  /** Draft, sent, signed: an active contract. */
  async function activate(body: Json): Promise<string> {
    const made = await call("post", "/contracts", "owner").send(body);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.id as string;
    await call("post", `/contracts/${id}/send`, "owner").expect(201);
    const signed = await call("post", `/contracts/${id}/sign`, "owner").send({
      signerName: "Alex Crew",
      signerRole: "Owner",
    });
    expect(signed.status, JSON.stringify(signed.body)).toBe(201);
    return id;
  }

  async function linesOf(id: string): Promise<Json[]> {
    const response = await call("get", "/contract-lines", "owner").expect(200);
    return (response.body as Json[]).filter((l) => l.contractId === id);
  }

  /**
   * An active customer contract at 10 % retainage with two taxable material lines: A1 (1000.00, cost
   * 600.00) and B1 (500.00, cost 300.00). Tax is 8.81 % on material.
   */
  async function customerContract(): Promise<{ id: string; number: string; a: string; b: string }> {
    const id = await activate(
      customerForm({
        retainagePct: "10",
        storedRetainagePct: "10",
        lines: [
          line({ code: "A1", category: "material", scheduledValue: "1000.00", estimatedCost: "600.00" }),
          line({ code: "B1", category: "material", scheduledValue: "500.00", estimatedCost: "300.00" }),
        ],
      }),
    );
    const lines = await linesOf(id);
    const contract = (await call("get", "/contracts", "owner").expect(200)).body.find((c: Json) => c.id === id);
    return {
      id,
      number: contract.number as string,
      a: lines.find((l) => l.code === "A1")!.id as string,
      b: lines.find((l) => l.code === "B1")!.id as string,
    };
  }

  /** A billing body: each entry is [contractLineId, completedToDate, storedBalance]. */
  function billingBody(entries: [string, string, string?][]) {
    return {
      periodEnd: PERIOD_END,
      lines: entries.map(([contractLineId, completedToDate, storedBalance]) => ({
        contractLineId,
        completedToDate,
        storedBalance: storedBalance ?? "0.00",
      })),
    };
  }

  async function postBilling(who: Who, id: string, entries: [string, string, string?][]): Promise<Json> {
    const response = await call("post", `/contracts/${id}/billings`, who).send(billingBody(entries));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Json;
  }

  async function release(who: Who, id: string, amount: string): Promise<Json> {
    const response = await call("post", `/contracts/${id}/retainage-releases`, who).send({ amount });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Json;
  }

  function expectRefused(response: { status: number; body: Json }, message: RegExp) {
    expect(response.status, JSON.stringify(response.body)).toBe(400);
    expect(response.body.code).toBe("invalid_request");
    expect(response.body.message).toMatch(message);
  }

  async function invoiceOf(id: string | null, who: Who = "owner"): Promise<Json> {
    const found = ((await call("get", "/invoices", who).expect(200)).body as Json[]).find((i) => i.id === id);
    expect(found, `invoice ${id}`).toBeTruthy();
    return found!;
  }

  async function rows<T>(read: (db: Awaited<ReturnType<typeof harness.companyDb>>["db"]) => Promise<T>): Promise<T> {
    const handle = await harness.companyDb(company.id);
    try {
      return await read(handle.db);
    } finally {
      await handle.close();
    }
  }

  async function audit(targetType: string, ids: string[]) {
    return rows((db) =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.targetType, targetType), inArray(auditLog.targetId, ids))),
    );
  }

  /** The trial balance by account key (debits less credits), checked balanced on every read. */
  async function balances(): Promise<Map<string, string>> {
    const body = (await call("get", "/ledger/trial-balance", "owner").expect(200)).body as TrialBalance;
    expect(body.balanced).toBe(true);
    return new Map(body.rows.flatMap((row) => (row.key ? [[row.key, row.balance] as const] : [])));
  }

  /** How much an account's balance moved between two readings. */
  function moved(before: Map<string, string>, after: Map<string, string>, key: string): string {
    return moneyString(dec(after.get(key) ?? "0").minus(before.get(key) ?? "0"));
  }

  function expectSame(before: Map<string, string>, after: Map<string, string>) {
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      expect(moved(before, after, key), key).toBe("0.00");
    }
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("ctb");
    other = await harness.provisionCompany("ctbother");
    const handle = await harness.companyDb(company.id);
    try {
      const db = handle.db;
      const [a] = await db.insert(branches).values({ name: "Denver", city: "Denver", state: "CO" }).returning();
      const address = { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" };
      const [store] = await db
        .insert(locations)
        .values({ name: "Denver warehouse", kind: "warehouse" as const, branchId: a!.id, address, isDefault: true })
        .returning();
      const [supplier] = await db
        .insert(suppliers)
        .values({
          name: "Tile Crew",
          type: "services" as const,
          terms: "net_30" as const,
          address,
          email: "c@example.test",
        })
        .returning();
      const [customer] = await db
        .insert(customers)
        .values({ type: "contractor" as const, name: "Builder", terms: "net_30" as const, email: "b@example.test" })
        .returning();
      await db.insert(settings).values([
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
      await db.insert(taxRules).values({
        state: "CO",
        jurisdiction: "Denver combined",
        ratePct: "8.81",
        taxable: { material: true, labor: false, freight: false, service: false },
        lumpSumLaborTaxable: true,
        validFrom: "2025-01-01",
        version: 1,
      });
      // Roles the defaults do not have: one that bills but may not void or see costs, and one limited to own records.
      const grants: Record<string, { scope: "all" | "own"; keys: string[] }> = {
        biller: {
          scope: "all",
          // Product cost and invoice edits, but not contracts view_sensitive (PR #24 review).
          keys: [
            "contracts.contract.view",
            "contracts.billing.view",
            "contracts.billing.create",
            "sales.invoice.view",
            "sales.invoice.edit",
            "inventory.product.view_sensitive",
          ],
        },
        scoped: {
          scope: "own",
          keys: [
            "contracts.contract.view",
            "contracts.billing.view",
            "contracts.billing.create",
            "contracts.billing.void",
          ],
        },
      };
      for (const [key, grant] of Object.entries(grants)) {
        const [role] = await db.insert(roles).values({ key, name: key, dataScope: grant.scope }).returning();
        await db
          .insert(rolePermissions)
          .values(grant.keys.map((permissionKey) => ({ roleId: role!.id, permissionKey })));
      }
      branchA = a!.id;
      locationA = store!.id;
      supplierId = supplier!.id;
      customerId = customer!.id;
    } finally {
      await handle.close();
    }
    const emails = {
      owner: await harness.addUser({ companyIds: [company.id], roles: ["owner"] }),
      manager: await harness.addUser({ companyIds: [company.id], roles: ["manager"] }),
      sales: await harness.addUser({ companyIds: [company.id], roles: ["sales"] }),
      accountant: await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }),
      warehouse: await harness.addUser({ companyIds: [company.id], roles: ["warehouse"] }),
      biller: await harness.addUser({ companyIds: [company.id], roles: ["biller"] }),
      scoped: await harness.addUser({ companyIds: [company.id], roles: ["scoped"] }),
      otherManager: await harness.addUser({ companyIds: [other.id], roles: ["manager"] }),
    };
    const handle2 = await harness.companyDb(company.id);
    try {
      const salesId = await harness.userIdOf(emails.sales);
      await handle2.db.update(userProfiles).set({ branchId: branchA }).where(eq(userProfiles.userId, salesId));
      await handle2.db.update(customers).set({ salesRepId: salesId }).where(eq(customers.id, customerId));
    } finally {
      await handle2.close();
    }
    cookies.owner = await enrolled(emails.owner);
    cookies.accountant = await enrolled(emails.accountant);
    cookies.manager = await harness.signIn(emails.manager);
    cookies.sales = await harness.signIn(emails.sales);
    cookies.warehouse = await harness.signIn(emails.warehouse);
    cookies.biller = await harness.signIn(emails.biller);
    cookies.scoped = await harness.signIn(emails.scoped);
    cookies.otherManager = await harness.signIn(emails.otherManager);
  }, 180_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("answers 401 without a session, and 403 unless the role holds billing.create or billing.void", async () => {
    const c = await customerContract();
    const anonymous = await request(harness.app.getHttpServer())
      .post(`/contracts/${c.id}/billings`)
      .set("X-Forwarded-Host", "localhost:3000")
      .send(billingBody([[c.a, "100.00"]]));
    expect(anonymous.status).toBe(401);

    // Sales may view billings but not post, release or void them; Warehouse holds nothing.
    expect((await call("get", "/contract-billings", "sales")).status).toBe(200);
    expect((await call("get", "/contract-billings", "warehouse")).status).toBe(403);
    expect(
      (await call("post", `/contracts/${c.id}/billings`, "sales").send(billingBody([[c.a, "100.00"]]))).status,
    ).toBe(403);
    expect((await call("post", `/contracts/${c.id}/retainage-releases`, "sales").send({ amount: "1.00" })).status).toBe(
      403,
    );
    expect(
      (await call("post", `/contract-billings/${uuidv7()}/void`, "sales").send({ reason: "Entered in error" })).status,
    ).toBe(403);

    // The accountant holds contracts.billing.*, so posts and voids.
    const posted = await postBilling("accountant", c.id, [[c.a, "100.00"]]);
    expect(posted.status).toBe("posted");
    // A role with billing.create but not billing.void posts, and is refused the void.
    const second = await postBilling("biller", c.id, [[c.a, "200.00"]]);
    expect(second.number).toBe(2);
    expect(
      (await call("post", `/contract-billings/${second.id}/void`, "biller").send({ reason: "Entered in error" }))
        .status,
    ).toBe(403);
    const voided = await call("post", `/contract-billings/${second.id}/void`, "accountant").send({
      reason: "Entered in error",
    });
    expect(voided.status, JSON.stringify(voided.body)).toBe(201);
    expect(voided.body.status).toBe("void");
  });

  it("raises a progress invoice whose total is subtotal + tax - withheld, and posts it balanced", async () => {
    const c = await customerContract();
    const before = await balances();
    const billing = await postBilling("accountant", c.id, [
      [c.a, "400.00"],
      [c.b, "200.00"],
    ]);
    expect(billing).toMatchObject({
      contractId: c.id,
      number: 1,
      kind: "progress",
      status: "posted",
      gross: "600.00",
      withheld: "60.00",
      released: "0.00",
      billId: null,
    });
    const invoice = await invoiceOf(billing.invoiceId as string);
    expect(invoice).toMatchObject({
      contractId: c.id,
      billingId: billing.id,
      subtotal: "600.00",
      tax: "52.86",
      total: "592.86",
      retainageWithheld: "60.00",
      voidedAt: null,
    });
    expect(String(invoice.number)).toMatch(/\d/);
    expect(moneyString(dec("600.00").plus("52.86").minus("60.00"))).toBe(invoice.total);

    const after = await balances();
    expect(moved(before, after, "accounts_receivable")).toBe("592.86");
    expect(moved(before, after, "retainage_receivable")).toBe("60.00");
    expect(moved(before, after, "sales")).toBe("-600.00");
    expect(moved(before, after, "sales_tax_payable")).toBe("-52.86");
  });

  it("bills only the change on a second billing, holding retainage on the change", async () => {
    const c = await customerContract();
    await postBilling("owner", c.id, [
      [c.a, "400.00"],
      [c.b, "200.00"],
    ]);
    const before = await balances();
    const second = await postBilling("owner", c.id, [
      [c.a, "700.00"],
      [c.b, "200.00"],
    ]);
    expect(second).toMatchObject({ number: 2, gross: "300.00", withheld: "30.00" });
    const invoice = await invoiceOf(second.invoiceId as string);
    expect(invoice).toMatchObject({ subtotal: "300.00", tax: "26.43", total: "296.43", retainageWithheld: "30.00" });
    // B1 did not change, so it has no line on this invoice.
    expect(invoice.lines).toHaveLength(1);

    const after = await balances();
    expect(moved(before, after, "accounts_receivable")).toBe("296.43");
    expect(moved(before, after, "retainage_receivable")).toBe("30.00");
    expect(moved(before, after, "sales")).toBe("-300.00");
    expect(moved(before, after, "sales_tax_payable")).toBe("-26.43");
  });

  it("refuses a billing over the scheduled value, below zero, with no change, with an unknown line or a line twice", async () => {
    const c = await customerContract();
    const before = await balances();
    const send = (body: Json) => call("post", `/contracts/${c.id}/billings`, "owner").send(body);

    expectRefused(await send(billingBody([[c.a, "900.00", "200.00"]])), /A1: work and stored materials can't pass/);
    expectRefused(await send(billingBody([[c.a, "0.00"]])), /Nothing has changed/);
    expectRefused(await send(billingBody([[uuidv7(), "100.00"]])), /no longer exists/);
    expectRefused(
      await send(
        billingBody([
          [c.a, "100.00"],
          [c.a, "200.00"],
        ]),
      ),
      /appear once/,
    );

    // One error body for bad input: a negative amount, no lines, a stray key, a bad date.
    for (const bad of [
      billingBody([[c.a, "-5.00"]]),
      { periodEnd: PERIOD_END, lines: [] },
      { ...billingBody([[c.a, "5.00"]]), surprise: true },
      { ...billingBody([[c.a, "5.00"]]), periodEnd: "2026-13-40" },
    ]) {
      const refused = await send(bad);
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe("invalid_request");
      expect(typeof refused.body.message).toBe("string");
    }

    // Lowering a line below the last billing is a negative billing, which is refused too.
    await postBilling("owner", c.id, [[c.a, "700.00"]]);
    expectRefused(await send(billingBody([[c.a, "600.00"]])), /less than zero/);

    // A draft and a master are not billed.
    const draft = await call("post", "/contracts", "owner").send(customerForm());
    expectRefused(
      await call("post", `/contracts/${draft.body.id}/billings`, "owner").send(billingBody([[c.a, "1.00"]])),
      /active or completed/,
    );
    const master = await activate(customerForm({ kind: "master", title: "Master terms" }));
    expectRefused(
      await call("post", `/contracts/${master}/billings`, "owner").send(billingBody([[c.a, "1.00"]])),
      /master agreement/i,
    );

    const billings = ((await call("get", "/contract-billings", "owner").expect(200)).body as Json[]).filter(
      (b) => b.contractId === c.id,
    );
    expect(billings).toHaveLength(1);
    const after = await balances();
    expect(moved(before, after, "sales")).toBe("-700.00");
  });

  it("releases no more than is held, on its own invoice that moves retainage back to receivables", async () => {
    const c = await customerContract();
    await postBilling("owner", c.id, [
      [c.a, "400.00"],
      [c.b, "200.00"],
    ]);
    const before = await balances();
    for (const amount of ["60.01", "0.00", "abc"]) {
      const refused = await call("post", `/contracts/${c.id}/retainage-releases`, "owner").send({ amount });
      expect(refused.status, amount).toBe(400);
      expect(refused.body.code).toBe("invalid_request");
    }
    expectRefused(
      await call("post", `/contracts/${c.id}/retainage-releases`, "owner").send({ amount: "60.01" }),
      /up to what is held/,
    );
    expectSame(before, await balances());

    const released = await release("accountant", c.id, "25.00");
    expect(released).toMatchObject({ number: 2, kind: "release", gross: "0.00", withheld: "0.00", released: "25.00" });
    const shares = released.releases as { lineId: string; amount: string }[];
    expect(shares.map((share) => share.lineId).sort()).toEqual([c.a, c.b].sort());
    expect(moneyString(shares.reduce((total, share) => total.plus(share.amount), dec(0)))).toBe("25.00");
    // A1 holds 40.00 and B1 20.00, so the shares follow what each holds.
    expect(shares.find((share) => share.lineId === c.a)!.amount).toBe("16.67");
    expect(shares.find((share) => share.lineId === c.b)!.amount).toBe("8.33");

    const invoice = await invoiceOf(released.invoiceId as string);
    expect(invoice).toMatchObject({ subtotal: "0.00", tax: "0.00", total: "25.00", retainageReleased: "25.00" });
    const after = await balances();
    expect(moved(before, after, "accounts_receivable")).toBe("25.00");
    expect(moved(before, after, "retainage_receivable")).toBe("-25.00");
    expect(moved(before, after, "sales")).toBe("0.00");
    expect(moved(before, after, "sales_tax_payable")).toBe("0.00");

    // 35.00 is left: one cent more is refused, the rest goes out, and then nothing is held.
    expectRefused(
      await call("post", `/contracts/${c.id}/retainage-releases`, "owner").send({ amount: "35.01" }),
      /up to what is held/,
    );
    await release("owner", c.id, "35.00");
    expectRefused(
      await call("post", `/contracts/${c.id}/retainage-releases`, "owner").send({ amount: "0.01" }),
      /up to what is held/,
    );
    expect(moved(before, await balances(), "retainage_receivable")).toBe("-60.00");
  });

  it("bills a subcontract as a bill CTR-n-k with no tax, debiting COGS and crediting AP and retainage payable", async () => {
    const id = await activate(form());
    const contract = (await call("get", "/contracts", "owner").expect(200)).body.find((c: Json) => c.id === id);
    const [only] = await linesOf(id);
    const before = await balances();
    const billing = await postBilling("accountant", id, [[only!.id as string, "500.00"]]);
    expect(billing).toMatchObject({ number: 1, gross: "500.00", withheld: "25.00", invoiceId: null });
    expect(billing.billId).toBeTruthy();

    const bill = await rows(async (db) => {
      const [found] = await db
        .select()
        .from(supplierBills)
        .where(eq(supplierBills.id, billing.billId as string));
      return found!;
    });
    expect(bill.number).toBe(`${contract.number}-1`);
    expect(bill.number).toMatch(/^CTR-\d+-1$/);
    expect(bill).toMatchObject({
      supplierId,
      total: "475.00",
      gross: "500.00",
      retainageWithheld: "25.00",
      contractId: id,
      kind: "progress",
    });
    const posted = await balances();
    expect(moved(before, posted, "cost_of_goods_sold")).toBe("500.00");
    expect(moved(before, posted, "accounts_payable")).toBe("-475.00");
    expect(moved(before, posted, "retainage_payable")).toBe("-25.00");
    // No tax and no receivable on a subcontract.
    expect(moved(before, posted, "sales_tax_payable")).toBe("0.00");
    expect(moved(before, posted, "accounts_receivable")).toBe("0.00");

    const released = await release("accountant", id, "25.00");
    expect(released).toMatchObject({ number: 2, kind: "release", released: "25.00" });
    const releaseBill = await rows(async (db) => {
      const [found] = await db
        .select()
        .from(supplierBills)
        .where(eq(supplierBills.id, released.billId as string));
      return found!;
    });
    expect(releaseBill).toMatchObject({ number: `${contract.number}-2`, total: "25.00", kind: "retainage_release" });
    const releasedBooks = await balances();
    expect(moved(posted, releasedBooks, "retainage_payable")).toBe("25.00");
    expect(moved(posted, releasedBooks, "accounts_payable")).toBe("-25.00");
    expect(moved(posted, releasedBooks, "cost_of_goods_sold")).toBe("0.00");

    // Void the release, then the billing: the bill goes and every account is back.
    await call("post", `/contract-billings/${released.id}/void`, "accountant")
      .send({ reason: "Release was early" })
      .expect(201);
    await call("post", `/contract-billings/${billing.id}/void`, "accountant")
      .send({ reason: "Wrong period" })
      .expect(201);
    expectSame(before, await balances());
    const dropped = await rows(async (db) => {
      const [found] = await db
        .select()
        .from(supplierBills)
        .where(eq(supplierBills.id, billing.billId as string));
      return found!;
    });
    expect(dropped.deletedAt).not.toBeNull();
  });

  it("voids only the highest-numbered posted billing, with a reason, and the reversal restores every account", async () => {
    const c = await customerContract();
    const before = await balances();
    const first = await postBilling("owner", c.id, [
      [c.a, "400.00"],
      [c.b, "200.00"],
    ]);
    const afterFirst = await balances();
    const second = await postBilling("owner", c.id, [[c.a, "700.00"]]);

    const refuse = (id: unknown, reason: string) =>
      call("post", `/contract-billings/${id}/void`, "accountant").send({ reason });
    expectRefused(await refuse(first.id, "Entered in error"), /latest billing/i);
    expectRefused(await refuse(second.id, "no"), /why/i);
    expectRefused(await refuse(second.id, "   "), /why/i);
    expect((await refuse(uuidv7(), "Entered in error")).status).toBe(404);
    expect((await call("post", `/contract-billings/${second.id}/void`, "accountant").send({})).status).toBe(400);

    const voided = await refuse(second.id, "Entered in error");
    expect(voided.status, JSON.stringify(voided.body)).toBe(201);
    expect(voided.body).toMatchObject({ id: second.id, status: "void" });
    const secondInvoice = await invoiceOf(second.invoiceId as string);
    expect(secondInvoice.voidedAt).toBeTruthy();
    expect(secondInvoice.voidReason).toBe("Entered in error");
    expectSame(afterFirst, await balances());
    expectRefused(await refuse(second.id, "Entered in error"), /already void/i);

    // The first is now the latest posted one.
    expect((await refuse(first.id, "Entered in error")).status).toBe(201);
    expectSame(before, await balances());
    // A voided billing's figures no longer count, so the work can be billed again.
    const again = await postBilling("owner", c.id, [[c.a, "700.00"]]);
    expect(again).toMatchObject({ number: 3, gross: "700.00", withheld: "70.00" });
  });

  it("refuses a void while the invoice has a confirmed payment, and sends invoice void and credit notes to the billing", async () => {
    const c = await customerContract();
    const billing = await postBilling("owner", c.id, [[c.a, "400.00"]]);
    const invoice = await invoiceOf(billing.invoiceId as string);

    // Sales invoice routes refuse a contract billing invoice, without changing it.
    expectRefused(
      await call("post", `/invoices/${invoice.id}/void`, "owner").send({ reason: "Entered in error" }),
      /Void the billing instead/,
    );
    expectRefused(
      await call("post", `/invoices/${invoice.id}/credit-notes`, "owner").send({
        subtotal: "10.00",
        reason: "Correction needed",
      }),
      /next billing instead/,
    );

    const paid = await call("post", "/payments", "owner")
      .send({
        invoiceId: invoice.id,
        kind: "payment",
        amount: "50.00",
        date: companyDay(),
        method: "card",
        checkNumber: "",
        cardLast4: "4242",
        reference: `TXN-${uuidv7()}`,
        note: "",
        extraAsCredit: false,
        allowDuplicateReference: false,
        files: [PROOF],
      })
      .expect(201);
    expect(paid.body.status).toBe("confirmed");

    const before = await balances();
    expectRefused(
      await call("post", `/contract-billings/${billing.id}/void`, "accountant").send({ reason: "Entered in error" }),
      /confirmed payment/,
    );
    expectSame(before, await balances());
    const billings = (await call("get", "/contract-billings", "owner").expect(200)).body as Json[];
    expect(billings.find((b) => b.id === billing.id)!.status).toBe("posted");
    expect((await invoiceOf(billing.invoiceId as string)).voidedAt).toBeNull();
  });

  it("answers 404 outside the person's data scope or company, and lists only billings in scope", async () => {
    const c = await customerContract();
    const billing = await postBilling("owner", c.id, [[c.a, "100.00"]]);
    const before = await balances();

    // The contract's sales rep is Sales; an own-scope biller who is someone else sees nothing of it.
    expect(
      (await call("post", `/contracts/${c.id}/billings`, "scoped").send(billingBody([[c.a, "200.00"]]))).status,
    ).toBe(404);
    expect(
      (await call("post", `/contracts/${c.id}/retainage-releases`, "scoped").send({ amount: "1.00" })).status,
    ).toBe(404);
    expect(
      (await call("post", `/contract-billings/${billing.id}/void`, "scoped").send({ reason: "Entered in error" }))
        .status,
    ).toBe(404);
    expect(
      ((await call("get", "/contract-billings", "scoped").expect(200)).body as Json[]).map((b) => b.id),
    ).not.toContain(billing.id);

    // Another company's manager holds the permission but reaches none of this company's rows.
    expect(
      (await call("post", `/contracts/${c.id}/billings`, "otherManager").send(billingBody([[c.a, "200.00"]]))).status,
    ).toBe(404);
    expect(
      (await call("post", `/contracts/${c.id}/retainage-releases`, "otherManager").send({ amount: "1.00" })).status,
    ).toBe(404);
    expect(
      (await call("post", `/contract-billings/${billing.id}/void`, "otherManager").send({ reason: "Entered in error" }))
        .status,
    ).toBe(404);
    expect((await call("get", "/contract-billings", "otherManager").expect(200)).body).toEqual([]);

    expectSame(before, await balances());
    const billings = ((await call("get", "/contract-billings", "owner").expect(200)).body as Json[]).filter(
      (b) => b.contractId === c.id,
    );
    expect(billings).toHaveLength(1);
    expect(billings[0]!.status).toBe("posted");
  });

  it("never returns estimatedCost or costShare in a billing or invoice for a role without view_sensitive", async () => {
    const c = await customerContract();
    const billing = await call("post", `/contracts/${c.id}/billings`, "biller").send(
      billingBody([
        [c.a, "400.00"],
        [c.b, "200.00"],
      ]),
    );
    expect(billing.status, JSON.stringify(billing.body)).toBe(201);
    const billings = (await call("get", "/contract-billings", "biller").expect(200)).body as Json[];
    const invoices = (await call("get", "/invoices", "biller").expect(200)).body as Json[];
    const invoice = invoices.find((i) => i.id === billing.body.invoiceId)!;
    expect(invoice).toBeTruthy();
    expect(invoice.total).toBe("592.86");

    for (const body of [billing.body, billings, invoice]) {
      const text = JSON.stringify(body);
      expect(text).not.toContain("estimatedCost");
      expect(text).not.toContain("costShare");
    }
    expect(invoice).not.toHaveProperty("cost");
    for (const entry of invoice.lines as Json[]) expect(entry).not.toHaveProperty("unitCost");
    // Marking it sent returns the invoice too, still without the cost share.
    const sent = await call("post", `/invoices/${billing.body.invoiceId as string}/sent`, "biller");
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body).not.toHaveProperty("cost");
    for (const entry of sent.body.lines as Json[]) expect(entry).not.toHaveProperty("unitCost");

    // The owner sees the cost share: 600.00 x 400/1000 plus 300.00 x 200/500.
    expect((await invoiceOf(billing.body.invoiceId as string, "owner")).cost).toBe("360.00");
  });

  it("writes audit_log for a billing, its invoice or bill, a release and a void, without costs or supplier money", async () => {
    const c = await customerContract();
    const billing = await postBilling("owner", c.id, [[c.a, "400.00"]]);
    const released = await release("owner", c.id, "10.00");
    await call("post", `/contract-billings/${released.id}/void`, "owner")
      .send({ reason: "Entered in error" })
      .expect(201);

    const forContract = await audit("contract", [c.id]);
    const byAction = (action: string) => forContract.filter((row) => row.action === action);
    expect(byAction("Posted contract billing")).toHaveLength(1);
    expect(byAction("Released retainage")).toHaveLength(1);
    expect(byAction("Voided contract billing")).toHaveLength(1);
    expect(byAction("Posted contract billing")[0]!.after).toMatchObject({
      number: 1,
      gross: "400.00",
      withheld: "40.00",
    });
    expect(byAction("Voided contract billing")[0]!.after).toMatchObject({ status: "void", reason: "Entered in error" });

    const forInvoices = await audit("invoice", [billing.invoiceId as string, released.invoiceId as string]);
    expect(forInvoices.filter((row) => row.action === "Created invoice for a contract billing")).toHaveLength(2);
    const voidedInvoice = forInvoices.find((row) => row.action === "Voided invoice");
    expect(voidedInvoice?.targetId).toBe(released.invoiceId);
    for (const row of [...forContract, ...forInvoices]) {
      const text = JSON.stringify([row.before, row.after]);
      expect(text).not.toContain("estimatedCost");
      expect(text).not.toContain("costShare");
      expect(text).not.toContain('"cost"');
    }

    // A refused write leaves no audit row behind.
    const count = (await audit("contract", [c.id])).length;
    await call("post", `/contracts/${c.id}/retainage-releases`, "owner").send({ amount: "9999.00" }).expect(400);
    expect((await audit("contract", [c.id])).length).toBe(count);

    // A subcontract bill is audited without any money.
    const sub = await activate(form());
    const [only] = await linesOf(sub);
    const subBilling = await postBilling("owner", sub, [[only!.id as string, "500.00"]]);
    const billAudit = await audit("bill", [subBilling.billId as string]);
    expect(billAudit.map((row) => row.action)).toEqual(["Entered bill for a contract billing"]);
    const subContract = (await audit("contract", [sub])).find((row) => row.action === "Posted contract billing");
    expect(subContract).toBeTruthy();
    for (const row of [...billAudit, subContract!]) {
      const text = JSON.stringify([row.before, row.after]);
      for (const money of ["500.00", "475.00", "25.00", "gross", "total"]) expect(text).not.toContain(money);
    }
  });

  it("refuses a billing whose retainage would outrun what it bills, so no invoice goes negative", async () => {
    // 10 % on work, 0 % on stored materials: moving 1000.00 of stored materials into work holds 100.00
    // of retainage on no new gross, so with 10.00 of new work the invoice would come to about -80.
    const id = await activate(
      customerForm({
        retainagePct: "10",
        storedRetainagePct: "0",
        lines: [
          line({ code: "S1", category: "labor", scheduledValue: "1000.00" }),
          line({ code: "S2", category: "labor", scheduledValue: "500.00" }),
        ],
      }),
    );
    const [first, second] = await linesOf(id);
    await postBilling("owner", id, [[first!.id as string, "0.00", "1000.00"]]);
    const before = await balances();
    const refused = await call("post", `/contracts/${id}/billings`, "owner").send(
      billingBody([
        [first!.id as string, "1000.00", "0.00"],
        [second!.id as string, "10.00", "0.00"],
      ]),
    );
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("more retainage");
    expectSame(before, await balances());
  });

  it("refuses lowering a line below the retainage it still holds after a release", async () => {
    const c = await customerContract();
    await postBilling("owner", c.id, [[c.a, "1000.00"]]);
    await release("owner", c.id, "100.00");
    const before = await balances();
    // A1 drops to 500 (its held 100 was released), so its retainage would go below zero.
    const refused = await call("post", `/contracts/${c.id}/billings`, "owner").send(
      billingBody([
        [c.a, "500.00"],
        [c.b, "500.00"],
      ]),
    );
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("already released");
    expectSame(before, await balances());
  });

  /** GET /contract-schedule, narrowed to one contract. */
  async function scheduleOf(id: string, who: Who = "owner") {
    const body = (await call("get", "/contract-schedule", who).expect(200)).body as {
      lines: Json[];
      billings: Json[];
    };
    return {
      lines: body.lines.filter((l) => l.contractId === id),
      billings: body.billings.filter((b) => b.contractId === id),
    };
  }

  it("serves each line's billed to date, retained and remaining, from posted billings only (#31, rule 11a)", async () => {
    const c = await customerContract();
    expect((await scheduleOf(c.id)).lines).toEqual([
      { lineId: c.a, contractId: c.id, billed: "0.00", retained: "0.00", remaining: "1000.00" },
      { lineId: c.b, contractId: c.id, billed: "0.00", retained: "0.00", remaining: "500.00" },
    ]);
    await postBilling("owner", c.id, [
      [c.a, "300.00", "100.00"],
      [c.b, "200.00"],
    ]);
    await postBilling("owner", c.id, [[c.a, "600.00"]]);
    const last = await postBilling("owner", c.id, [[c.b, "450.00"]]);
    await call("post", `/contract-billings/${last.id}/void`, "owner").send({ reason: "Entered in error" }).expect(201);
    const { lines } = await scheduleOf(c.id);
    // A1: 600 billed (stored 100 installed), 10 % held; B1: 200 billed, billing 3 is void.
    expect(lines).toEqual([
      { lineId: c.a, contractId: c.id, billed: "600.00", retained: "60.00", remaining: "400.00" },
      { lineId: c.b, contractId: c.id, billed: "200.00", retained: "20.00", remaining: "300.00" },
    ]);
  });

  it("allocates each release to the billings it paid out, oldest first (#33, rule 10a)", async () => {
    const c = await customerContract();
    const first = await postBilling("owner", c.id, [[c.a, "400.00"]]); // A1 holds 40.00
    const second = await postBilling("owner", c.id, [[c.a, "1000.00"]]); // and 60.00 more
    const r1 = await release("owner", c.id, "50.00");
    let allocation = new Map((await scheduleOf(c.id)).billings.map((b) => [b.billingId, b]));
    expect(allocation.get(first.id as string)).toMatchObject({ released: "40.00", covers: [] });
    expect(allocation.get(second.id as string)).toMatchObject({ released: "10.00", covers: [] });
    expect(allocation.get(r1.id as string)).toMatchObject({ released: "50.00", covers: [first.id, second.id] });

    const r2 = await release("owner", c.id, "50.00");
    allocation = new Map((await scheduleOf(c.id)).billings.map((b) => [b.billingId, b]));
    expect(allocation.get(second.id as string)).toMatchObject({ released: "60.00" });
    expect(allocation.get(r2.id as string)).toMatchObject({ released: "50.00", covers: [second.id] });
    expect((await scheduleOf(c.id)).lines.find((l) => l.lineId === c.a)).toMatchObject({ retained: "0.00" });
  });

  it("guards GET /contract-schedule like the billings: 401, 403 without billing.view, and data scope", async () => {
    const c = await customerContract();
    await postBilling("owner", c.id, [[c.a, "100.00"]]);
    const anonymous = await request(harness.app.getHttpServer())
      .get("/contract-schedule")
      .set("X-Forwarded-Host", "localhost:3000");
    expect(anonymous.status).toBe(401);
    expect((await call("get", "/contract-schedule", "warehouse")).status).toBe(403);
    expect((await scheduleOf(c.id, "accountant")).lines).toHaveLength(2);
    // Own scope by someone else, and another company's manager, see none of it.
    expect(await scheduleOf(c.id, "scoped")).toEqual({ lines: [], billings: [] });
    expect(await scheduleOf(c.id, "otherManager")).toEqual({ lines: [], billings: [] });
  });
});
