import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { CompanyDb } from "@workspace/db";
import {
  addresses as addressTable,
  auditLog,
  branches,
  customers as customerTable,
  importJobs,
  importMappings,
  locations,
  meetingAttendees,
  meetings,
  products as productTable,
  quotes as quoteTable,
  rolePermissions,
  roles,
  settings,
  stockMovements,
  suppliers as supplierTable,
  taxRules,
} from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import {
  dec,
  FEATURES,
  IMPORT_WORDS,
  planActions,
  type DataScope,
  type FeatureKey,
  type ImportBatchSummary,
  type ImportKind,
  type ImportMapping,
  type ImportOverview,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
  type MovementKind,
  type PermissionKey,
  type Product,
} from "@workspace/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import type { Response } from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProducts } from "../src/modules/inventory/inventory-records";
import { loadContacts, loadSuppliers } from "../src/modules/purchasing/purchasing-records";
import { loadCustomers } from "../src/modules/sales/sales-records";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";
import { importFile, summitFiles, summitMasterData, type ImportRow } from "./support/summit-tables";

/** A TOTP code for the next 30-second step, as users.int.test.ts steps up with. */
function freshCode(secret: string): string {
  return totpCode(secret, new Date(Date.now() + 30_000));
}

/** Summit's localization settings without the tax tables, as sales.int.test.ts writes them, so quotes can be priced. */
function summitLocalization() {
  const file = createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json");
  const fixtures = JSON.parse(readFileSync(file, "utf8")) as { settings: { localization: Record<string, unknown> } };
  const { tax, ...rest } = fixtures.settings.localization as { tax: Record<string, unknown> } & Record<string, unknown>;
  const taxRest: Record<string, unknown> = { ...tax };
  delete taxRest.rules;
  delete taxRest.jurisdictions;
  return { ...rest, tax: taxRest };
}

const CUSTOMER_KEYS: PermissionKey[] = [
  "customers.customer.view",
  "customers.customer.create",
  "customers.customer.edit",
];

/** Company A's custom roles (ADR 0057 I-7, I-8): each may import, with some of the customer keys. */
const CUSTOM_ROLES: Record<string, { scope: DataScope; keys: PermissionKey[] }> = {
  imp_branch: {
    scope: "branch",
    keys: ["settings.import.manage", ...CUSTOMER_KEYS, "customers.customer.view_sensitive"],
  },
  imp_nocredit: { scope: "all", keys: ["settings.import.manage", ...CUSTOMER_KEYS] },
  imp_customers: {
    scope: "all",
    keys: ["settings.import.manage", ...CUSTOMER_KEYS, "customers.customer.view_sensitive"],
  },
  imp_noview: {
    scope: "all",
    keys: [
      "settings.import.manage",
      "customers.customer.create",
      "customers.customer.edit",
      "customers.customer.view_sensitive",
    ],
  },
};

const NOT_AVAILABLE = { code: "not_found", message: "This kind of import is not available." };
const RUNNING = {
  code: "import_running",
  message: "Another import or undo is running for this company. Try again when it finishes.",
};
const PLAN_CHANGED = { code: "plan_changed", message: IMPORT_WORDS.planChanged };
const UNKNOWN_FIELD = { code: "invalid_request", message: "The request has a field this import doesn't take." };

const QUARRY = { street: "4870 Quarry Lane", city: "Denver", state: "CO", zip: "80216" };
const RIDGEWAY = "Ridgeway Flooring Supply";

/** The tables a refused request must leave as they were. */
const TALLIED = [
  "import_jobs",
  "import_mappings",
  "audit_log",
  "customers",
  "addresses",
  "suppliers",
  "supplier_contacts",
  "products",
] as const;

/** A person signed in with an authenticator app, so they can step up. */
interface Person {
  email: string;
  id: string;
  cookie: string;
  secret: string;
}

/** A route of the import module with a body that passes its own checks. */
interface Route {
  method: "get" | "post" | "put";
  path: string;
  body?: object;
}

/** A body of a kind that the API refuses before it reads the mapping. */
const probe = (kind: string) => ({
  kind,
  fileName: "probe.csv",
  table: { headers: ["Name"], rows: [["x"]] },
  mapping: {},
});

/** A product row naming Ridgeway as its supplier, priced per sq ft and sold in cartons of 20 sq ft. */
const plankRow = (sku: string, name: string, over: Record<string, string> = {}): ImportRow => ({
  sku,
  name,
  category: "LVP and LVT",
  unit: "sq ft",
  price: "4.00",
  cost: "2.00",
  sq_ft_per_carton: "20",
  supplier: RIDGEWAY,
  ...over,
});

/**
 * Data import on the API, part 1 (docs/product-spec/import.md; ADR 0057 tests I-1 to I-33): who may
 * import, switches and modules, the body limits, the dry run, the import with its step-up and
 * plan check, audit, Undo with its order, change, kind and reference checks, the locks, the daily
 * limit, company isolation, saved columns, and the week-19 gate on Summit's master data.
 * Companies: A and B (Flooring Suite), H (HR Suite), D (the daily limit) and G (the gate).
 * Company A commits about 30 files here; a company may commit 50 a day (I-24), so a test added
 * on A must keep the total under that, or it meets a 429.
 */
describe("data import, part 1 (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const co = { a: "", b: "", h: "", d: "", g: "" };
  const people: Record<string, Person> = {};
  const cookies: Record<string, string> = {};
  let warehouse = "";
  let tile = "";

  function call(method: Route["method"], path: string, cookie?: string) {
    let test = request(harness.app.getHttpServer())[method](path).set("X-Forwarded-Host", "localhost:3000");
    if (cookie) test = test.set("Cookie", cookie);
    return test;
  }

  function hit(route: Route, cookie?: string) {
    const test = call(route.method, route.path, cookie);
    return route.body === undefined ? test : test.send(route.body);
  }

  function status(response: Response, expected: number): void {
    expect(response.status, `${response.status} ${JSON.stringify(response.body).slice(0, 400)}`).toBe(expected);
  }

  function refusedWith(response: Response, code: number, body: { code: string; message?: string }): void {
    status(response, code);
    if (body.message === undefined) expect(response.body.code).toBe(body.code);
    else expect(response.body).toEqual(body);
  }

  async function inCompany<T>(companyId: string, read: (db: CompanyDb) => Promise<T>): Promise<T> {
    const handle = await harness.companyDb(companyId);
    try {
      return await read(handle.db);
    } finally {
      await handle.close();
    }
  }

  async function enrolled(email: string): Promise<Person> {
    const first = await harness.signIn(email);
    const enabled = await harness.post("/api/auth/two-factor/enable").set("Cookie", first).send({ password: PASSWORD });
    const secret = totpSecretFromUri(enabled.body.totpURI as string);
    const confirmed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", first)
      .send({ code: totpCode(secret) });
    expect(confirmed.status).toBe(200);
    return { email, id: await harness.userIdOf(email), cookie: sessionCookie(confirmed.headers["set-cookie"]), secret };
  }

  async function stepUp(who: Person): Promise<void> {
    await harness
      .post("/auth/step-up")
      .set("Cookie", who.cookie)
      .send({ code: freshCode(who.secret) })
      .expect(204);
  }

  const check = (who: Person, body: object) => call("post", "/imports/check", who.cookie).send(body);
  const commit = (who: Person, body: ImportRequest, expected: string) =>
    call("post", "/imports", who.cookie).send({ ...body, expected });

  async function checked(who: Person, body: ImportRequest): Promise<ImportPreview> {
    const response = await check(who, body);
    status(response, 200);
    return response.body as ImportPreview;
  }

  /** Checks a file, steps up, and imports it with the dry run's actions. */
  async function imported(who: Person, body: ImportRequest): Promise<ImportResult> {
    const preview = await checked(who, body);
    await stepUp(who);
    const response = await commit(who, body, planActions(preview.rows));
    status(response, 201);
    return response.body as ImportResult;
  }

  async function undo(who: Person, batchId: string): Promise<Response> {
    await stepUp(who);
    return call("post", `/imports/${batchId}/undo`, who.cookie);
  }

  async function overview(who: Person): Promise<ImportOverview> {
    const response = await call("get", "/imports", who.cookie);
    status(response, 200);
    return response.body as ImportOverview;
  }

  async function tally(companyId: string): Promise<Record<string, number>> {
    return inCompany(companyId, async (db) => {
      const out: Record<string, number> = {};
      for (const table of TALLIED) {
        const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)}`);
        out[table] = row.n;
      }
      return out;
    });
  }

  async function batchRow(companyId: string, id: string) {
    return inCompany(companyId, async (db) => (await db.select().from(importJobs).where(eq(importJobs.id, id)))[0]);
  }

  async function auditOf(companyId: string, action: string, targetId?: string) {
    return inCompany(companyId, (db) =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, action), targetId === undefined ? undefined : eq(auditLog.targetId, targetId)))
        .orderBy(auditLog.createdAt, auditLog.id),
    );
  }

  async function customerByExternalId(externalId: string) {
    return inCompany(co.a, async (db) => (await loadCustomers(db)).find((c) => c.externalId === externalId));
  }

  async function productBySku(companyId: string, sku: string): Promise<Product | undefined> {
    return inCompany(companyId, async (db) => (await loadProducts(db)).find((p) => p.sku === sku));
  }

  async function supplierId(name: string): Promise<string> {
    return inCompany(co.a, async (db) => (await loadSuppliers(db)).find((s) => s.name === name)!.id);
  }

  /** A stock movement written behind the API's back, as a receipt or a transfer would write it. */
  async function movement(productId: string, kind: MovementKind) {
    await inCompany(co.a, (db) =>
      db.insert(stockMovements).values({
        at: new Date(),
        productId,
        locationId: warehouse,
        quantity: kind === "transfer_out" ? "-10" : "10",
        kind,
        sourceType: kind === "transfer_out" ? "transfer" : "receipt",
        sourceId: uuidv7(),
        sourceNumber: "IMP-TEST",
        byUserId: people.ownerA.id,
        createdBy: people.ownerA.id,
      }),
    );
  }

  /** A quote for a customer, made by A's owner through the sales module. */
  async function quoteFor(customerId: string): Promise<string> {
    const quote = await call("post", "/quotes", people.ownerA.cookie).send({
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
    });
    status(quote, 201);
    return quote.body.id as string;
  }

  async function withFeatureOff(key: FeatureKey, run: () => Promise<void>) {
    const feature = FEATURES[key] as { enabled: boolean };
    feature.enabled = false;
    try {
      await run();
    } finally {
      feature.enabled = true;
    }
  }

  /** Each of the five routes with a body that passes its own checks. */
  function routes(batchId: string): Route[] {
    const body = importFile("customers", [{ name: "Route Probe", email: "probe@example.test" }]);
    return [
      { method: "get", path: "/imports" },
      { method: "post", path: "/imports/check", body },
      { method: "post", path: "/imports", body: { ...body, expected: "c" } },
      { method: "post", path: `/imports/${batchId}/undo` },
      { method: "put", path: "/imports/mappings/customers", body: { columns: { name: "Name" } } },
    ];
  }

  /** A branch, a warehouse, a tile product, Summit's settings and a Colorado tax rule, so quotes and orders work. */
  async function setUpA() {
    await inCompany(co.a, async (db) => {
      const [branch] = await db.insert(branches).values({ name: "Denver", city: "Denver", state: "CO" }).returning();
      const [store] = await db
        .insert(locations)
        .values({ name: "Denver warehouse", kind: "warehouse", branchId: branch.id, address: QUARRY, isDefault: true })
        .returning();
      const [product] = await db
        .insert(productTable)
        .values({
          sku: "SLATE-1",
          name: "Slate Tile",
          category: "porcelain_tile",
          unit: "sq_ft",
          price: "4.5000",
          cost: "2.1000",
          sqFtPerCarton: "20",
        })
        .returning();
      await db.insert(settings).values({ group: "localization", value: summitLocalization() });
      await db.insert(taxRules).values({
        state: "CO",
        jurisdiction: "Denver combined",
        ratePct: "8.81",
        taxable: { material: true, labor: false, freight: false, service: false },
        lumpSumLaborTaxable: true,
        validFrom: "2025-01-01",
        version: 1,
      });
      warehouse = store.id;
      tile = product.id;
      for (const [key, role] of Object.entries(CUSTOM_ROLES)) {
        const [made] = await db.insert(roles).values({ key, name: key, dataScope: role.scope }).returning();
        await db.insert(rolePermissions).values(role.keys.map((permissionKey) => ({ roleId: made.id, permissionKey })));
      }
    });
  }

  /** The first customers file: two customers to create and one bad email (I-10, I-11, I-13). */
  const firstFile = importFile("customers", [
    {
      external_id: "CUST-9001",
      name: "Maple Row Builders",
      email: "orders@maplerow.example",
      credit_limit: "25000",
      ...QUARRY,
    },
    { external_id: "CUST-9002", name: "Avery Collins", email: "avery.collins@mail.example", credit_limit: "" },
    { external_id: "CUST-9003", name: "Bad Email Co", email: "not-an-email", credit_limit: "" },
  ]);

  beforeAll(async () => {
    await harness.start();
    co.a = (await harness.provisionCompany("impa")).id;
    co.b = (await harness.provisionCompany("impb")).id;
    co.h = (await harness.provisionCompany("imph", ["hr"])).id;
    co.d = (await harness.provisionCompany("impd")).id;
    co.g = (await harness.provisionCompany("impg")).id;
    await setUpA();
    people.ownerA = await enrolled(await harness.addUser({ companyIds: [co.a], roles: ["owner"] }));
    cookies.manager = await harness.signIn(await harness.addUser({ companyIds: [co.a], roles: ["manager"] }));
    for (const key of Object.keys(CUSTOM_ROLES)) {
      people[key] = await enrolled(await harness.addUser({ companyIds: [co.a], roles: [key] }));
    }
    for (const [key, companyId] of [
      ["ownerB", co.b],
      ["ownerH", co.h],
      ["ownerD", co.d],
      ["ownerG", co.g],
    ] as const) {
      people[key] = await enrolled(await harness.addUser({ companyIds: [companyId], roles: ["owner"] }));
    }
  }, 300_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("I-1: answers 401 on every route without a session", async () => {
    for (const route of routes(uuidv7())) {
      const response = await hit(route);
      status(response, 401);
      expect(response.body.code).toBe("unauthenticated");
    }
  });

  it("I-2: refuses a manager on every route and writes nothing", async () => {
    const before = await tally(co.a);
    for (const route of routes(uuidv7())) refusedWith(await hit(route, cookies.manager), 403, { code: "forbidden" });
    expect(await tally(co.a)).toEqual(before);
  });

  it("I-3: answers 404 on every route while settings.import is off, and works again after", async () => {
    await withFeatureOff("settings.import", async () => {
      for (const route of routes(uuidv7()))
        refusedWith(await hit(route, people.ownerA.cookie), 404, { code: "not_found" });
    });
    expect((await overview(people.ownerA)).kinds).toEqual(["customers", "addresses", "suppliers", "products"]);
  });

  it("I-4: hides customers and addresses while sales.customers is off", async () => {
    await withFeatureOff("sales.customers", async () => {
      expect((await overview(people.ownerA)).kinds).toEqual(["suppliers", "products"]);
      refusedWith(await check(people.ownerA, firstFile), 404, NOT_AVAILABLE);
    });
  });

  it("I-5: offers an HR Suite company no kind, and says why", async () => {
    expect((await overview(people.ownerH)).kinds).toEqual([]);
    refusedWith(await check(people.ownerH, firstFile), 403, {
      code: "module_not_enabled",
      message: "This company does not have the module for this import.",
    });
    refusedWith(await check(people.ownerH, probe("employees")), 404, NOT_AVAILABLE);
  });

  it("I-6: answers 404 for the kinds later parts build", async () => {
    for (const kind of ["stock", "invoices", "bills", "employees", "timesheets"] satisfies ImportKind[]) {
      refusedWith(await check(people.ownerA, probe(kind)), 404, NOT_AVAILABLE);
    }
  });

  it("I-7: refuses a branch scope and a role without the kind's keys", async () => {
    refusedWith(await check(people.imp_branch, firstFile), 403, {
      code: "forbidden",
      message: "Importing needs company-wide data scope, because rows are matched against every record.",
    });
    expect((await overview(people.imp_branch)).kinds).toEqual([]);
    const suppliers = importFile("suppliers", [{ name: "Not Allowed Supply" }]);
    refusedWith(await check(people.imp_customers, suppliers), 403, {
      code: "forbidden",
      message: "Your role can't see, add and change suppliers, so it can't import them.",
    });
    expect((await overview(people.imp_customers)).kinds).toEqual(["customers", "addresses"]);
    refusedWith(await check(people.imp_noview, firstFile), 403, {
      code: "forbidden",
      message: "Your role can't see, add and change customers, so it can't import them.",
    });
  });

  it("I-9: refuses a bad body with its words and writes nothing", async () => {
    const before = await tally(co.a);
    const one = (rows: string[][], headers = ["Name"]) => ({ ...firstFile, table: { headers, rows } });
    const words = (message: string) => ({ code: "invalid_request", message });
    const cases: [object, string][] = [
      [{ ...firstFile, kind: "widgets" }, "Choose what to import."],
      [{ ...firstFile, fileName: "  " }, "Name the file."],
      [one(Array.from({ length: 2001 }, () => ["x"])), "Import at most 2,000 rows at a time; split the file."],
      [
        one(
          [["x"]],
          Array.from({ length: 61 }, (_, i) => `H${i}`),
        ),
        "A file can have at most 60 columns.",
      ],
      [one([["x", "y"]], ["Name", "Name"]), "Two columns have the same header. Rename one and try again."],
      [one([["x".repeat(1001)]]), "A cell is longer than 1,000 characters. Shorten it or leave that column out."],
      [one([["x"]], ["Na\u0007me"]), "A column name or file name holds a hidden control character."],
      [{ ...firstFile, companyId: co.b }, UNKNOWN_FIELD.message],
      [{ ...firstFile, mapping: { nickname: "Name" } }, "The column choices name a field this import doesn't have."],
      [
        { ...firstFile, mapping: { ...firstFile.mapping, phone: "Telephone" } },
        "“Telephone” is not a column of this file.",
      ],
      [{ ...firstFile, mapping: { ...firstFile.mapping, name: null } }, "Choose the column for Name."],
    ];
    for (const [body, message] of cases) refusedWith(await check(people.ownerA, body), 400, words(message));
    refusedWith(
      await call("post", "/imports", people.ownerA.cookie).send(firstFile),
      400,
      words("Check the file again before importing."),
    );
    const large = one(Array.from({ length: 1500 }, (_, i) => [`${i}`.padEnd(100, "x")]));
    expect((await check(people.ownerA, large)).status).toBe(413);
    expect(await tally(co.a)).toEqual(before);
  });

  it("I-10: a dry run plans each row, writes nothing and is never cached", async () => {
    const before = await tally(co.a);
    const response = await check(people.ownerA, firstFile);
    status(response, 200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const preview = response.body as ImportPreview;
    expect(preview.counts).toEqual({ create: 2, update: 0, skip: 0, error: 1 });
    expect(preview.rows.map((row) => row.action)).toEqual(["create", "create", "error"]);
    expect(preview.rows[2].problems).toEqual([{ field: "email", message: "“not-an-email” is not an email address." }]);
    expect(await tally(co.a)).toEqual(before);
  });

  it("I-11: imports after a step-up, as IMP-1001, with the spec's defaults, audit and saved versions", async () => {
    const second = await enrolled(await harness.addUser({ companyIds: [co.a], roles: ["owner"] }));
    refusedWith(await commit(second, firstFile, "cce"), 403, { code: "step_up_required" });
    const owner = people.ownerA;
    await stepUp(owner);
    const response = await commit(owner, firstFile, "cce");
    status(response, 201);
    const result = response.body as ImportResult;
    expect(result.batch).toMatchObject({
      number: "IMP-1001",
      kind: "customers",
      fileName: "customers.csv",
      byName: "Test User",
      counts: { create: 2, update: 0, skip: 0, error: 1 },
      undoneAt: null,
      undoneBy: null,
    });
    expect(result.batch).not.toHaveProperty("changes");
    const maple = (await customerByExternalId("CUST-9001"))!;
    expect(maple).toMatchObject({
      name: "Maple Row Builders",
      terms: "due_on_receipt",
      creditLimit: "25000.00",
      salesRepId: owner.id,
      externalId: "CUST-9001",
      defaultJobSiteId: null,
    });
    expect(maple.addresses).toEqual([{ id: maple.defaultBillingId, label: "billing", ...QUARRY }]);
    const avery = (await customerByExternalId("CUST-9002"))!;
    expect(avery).toMatchObject({ creditLimit: "0.00", addresses: [], defaultBillingId: null });
    expect(await customerByExternalId("CUST-9003")).toBeUndefined();

    for (const customer of [maple, avery]) {
      const [entry] = await auditOf(co.a, "Imported customer", customer.id);
      expect(entry).toMatchObject({ category: "data", targetType: "customer", before: null });
      expect(entry.after).toMatchObject({ name: customer.name, creditLimit: customer.creditLimit, batch: "IMP-1001" });
    }
    const [batchEntry] = await auditOf(co.a, "Imported customers", result.batch.id);
    expect(batchEntry).toMatchObject({
      targetType: "import_job",
      targetLabel: "IMP-1001, customers.csv",
      after: "2 created, 0 updated, 0 skipped, 1 with errors",
    });
    const job = (await batchRow(co.a, result.batch.id))!;
    const now = await inCompany(co.a, (db) =>
      loadCustomers(
        db,
        job.changes.map((change) => change.id),
      ),
    );
    expect(job.changes).toHaveLength(2);
    for (const change of job.changes) {
      expect(change.before).toBeNull();
      expect(change.after).toEqual(now.find((customer) => customer.id === change.id));
    }
  });

  it("I-12: refuses an import whose actions differ from the dry run, order included", async () => {
    const file = importFile("customers", [
      { external_id: "CUST-9011", name: "Error Row", email: "bad-email" },
      { external_id: "CUST-9012", name: "Order Check Co", email: "order@check.example" },
    ]);
    expect(planActions((await checked(people.ownerA, file)).rows)).toBe("ec");
    const before = await tally(co.a);
    await stepUp(people.ownerA);
    for (const expected of ["cc", "ce"]) refusedWith(await commit(people.ownerA, file, expected), 409, PLAN_CHANGED);
    expect(await tally(co.a)).toEqual(before);
  });

  it("I-13: refuses a file that would change nothing, and a repeated import", async () => {
    const preview = await checked(people.ownerA, firstFile);
    expect(planActions(preview.rows)).toBe("sse");
    await stepUp(people.ownerA);
    refusedWith(await commit(people.ownerA, firstFile, "sse"), 400, {
      code: "invalid_request",
      message: IMPORT_WORDS.nothing,
    });
    refusedWith(await commit(people.ownerA, firstFile, "cce"), 409, PLAN_CHANGED);
  });

  it("I-8: refuses a credit limit column to a role that can't see it, on the dry run and the import", async () => {
    const who = people.imp_nocredit;
    const withCredit = importFile("customers", [
      { external_id: "CUST-9021", name: "Credit Check Co", email: "credit@check.example", credit_limit: "1500" },
    ]);
    const refusal = {
      code: "forbidden",
      message: "Your role can't see credit limit, so leave the Credit limit column out.",
    };
    refusedWith(await check(who, withCredit), 403, refusal);
    refusedWith(await commit(who, withCredit, "c"), 403, refusal);
    const without = importFile("customers", [
      { external_id: "CUST-9021", name: "Credit Check Co", email: "credit@check.example" },
    ]);
    const preview = await checked(who, without);
    // The server strips what the role can't see, even an empty cell (CLAUDE.md rule 5).
    expect(Object.hasOwn(preview.rows[0].cells, "credit_limit")).toBe(false);
    const result = await imported(who, without);
    expect(result.batch.counts.create).toBe(1);
    const owner = await checked(people.ownerA, withCredit);
    expect(owner.rows[0].cells.credit_limit).toBe("1500");
  });

  it("I-14: a re-import updates only what changed, without a duplicate, and audits before and after", async () => {
    const file = importFile("customers", [
      {
        external_id: "CUST-9001",
        name: "Maple Row Builders",
        email: "orders@maplerow.example",
        credit_limit: "25000",
        phone: "",
        ...QUARRY,
      },
      { external_id: "CUST-9002", name: "Avery Collins", email: "avery.collins@mail.example", phone: "(720) 555-0101" },
    ]);
    const result = await imported(people.ownerA, file);
    expect(result.batch.counts).toEqual({ create: 0, update: 1, skip: 1, error: 0 });
    const avery = (await customerByExternalId("CUST-9002"))!;
    expect(avery.phone).toBe("(720) 555-0101");
    const twins = await inCompany(co.a, (db) =>
      db.select().from(customerTable).where(eq(customerTable.externalId, "CUST-9002")),
    );
    expect(twins).toHaveLength(1);
    const [entry] = await auditOf(co.a, "Updated customer by import", avery.id);
    expect(entry.before).toMatchObject({ phone: "" });
    expect(entry.after).toMatchObject({ phone: "(720) 555-0101", batch: result.batch.number });
  });

  it("I-15: addresses in one file build on each other, up to 50 per customer", async () => {
    const file = importFile("addresses", [
      {
        customer: "CUST-9002",
        label: "Job site",
        street: "12 Pine Rd",
        city: "Denver",
        state: "CO",
        zip: "80202",
        default: "yes",
      },
      {
        customer: "avery.collins@mail.example",
        label: "Delivery",
        street: "9 Elm St",
        city: "Denver",
        state: "CO",
        zip: "80203",
        default: "",
      },
    ]);
    const result = await imported(people.ownerA, file);
    expect(result.batch.counts).toEqual({ create: 2, update: 0, skip: 0, error: 0 });
    const avery = (await customerByExternalId("CUST-9002"))!;
    expect(avery.addresses.map((a) => [a.label, a.street])).toEqual([
      ["job_site", "12 Pine Rd"],
      ["delivery", "9 Elm St"],
    ]);
    expect(avery.defaultJobSiteId).toBe(avery.addresses[0].id);

    // Maple Row has one address, so the 50th row of this file would be its 51st.
    const many = importFile(
      "addresses",
      Array.from({ length: 50 }, (_, i) => ({
        customer: "CUST-9001",
        street: `${100 + i} Cedar St`,
        city: "Denver",
        state: "CO",
        zip: "80204",
      })),
    );
    const preview = await checked(people.ownerA, many);
    expect(preview.counts).toEqual({ create: 49, update: 0, skip: 0, error: 1 });
    expect(preview.rows[49].problems).toEqual([
      { field: "street", message: "A customer can have at most 50 addresses." },
    ]);
  });

  it("I-16: suppliers: a new one with its contact and safe terms, skips, an email match, a contact without a way to reach", async () => {
    const owner = people.ownerA;
    const granite = {
      name: "Granite Ridge Supply",
      type: "goods" as const,
      accountNumber: "AC-1",
      email: "orders@graniteridge.example",
      phone: "(303) 555-0177",
      terms: "net_30" as const,
      creditLimit: "5000.00",
      categories: ["porcelain_tile" as const],
      address: { street: "77 Quarry Rd", city: "Golden", state: "CO", zip: "80401", county: "Jefferson" },
      createdBy: owner.id,
    };
    await inCompany(co.a, (db) => db.insert(supplierTable).values(granite));
    const ridgeway: ImportRow = {
      external_id: "VEN-201",
      name: RIDGEWAY,
      contact_name: "Morgan Hale",
      email: "orders@ridgeway.example",
      phone: "(303) 555-0110",
      credit_limit: "50000",
      categories: "LVP and LVT; Carpet",
      street: "4870 Quarry Lane",
      city: "Denver",
      state: "CO",
      zip: "80216",
    };
    const first = await imported(
      owner,
      importFile("suppliers", [ridgeway, { name: "Quiet Contact Co", contact_name: "Sam Ito" }]),
    );
    expect(first.rows[1].problems).toEqual([
      {
        field: "contact_name",
        message: "A contact needs the supplier's Email or Phone on the same row, or leave Contact empty.",
      },
    ]);
    const { supplier, contacts } = await inCompany(co.a, async (db) => {
      const found = (await loadSuppliers(db)).find((s) => s.name === RIDGEWAY)!;
      return { supplier: found, contacts: (await loadContacts(db)).filter((c) => c.supplierId === found.id) };
    });
    expect(supplier).toMatchObject({
      externalId: "VEN-201",
      terms: "pay_on_order",
      creditLimit: "50000.00",
      categories: ["carpet", "lvp"],
      status: "active",
    });
    expect(contacts).toEqual([
      expect.objectContaining({ name: "Morgan Hale", isPrimary: true, preferredMethod: "email", status: "active" }),
    ]);

    const again = importFile("suppliers", [
      ridgeway,
      {
        name: "Granite Ridge Supply",
        type: "Goods",
        account_number: "AC-1",
        email: "orders@graniteridge.example",
        phone: "(303) 555-0177",
        terms: "Net 30",
        credit_limit: "5000.00",
        categories: "Porcelain tile",
        street: "77 Quarry Rd",
        city: "Golden",
        state: "CO",
        zip: "80401",
      },
    ]);
    expect((await checked(owner, again)).counts).toEqual({ create: 0, update: 0, skip: 2, error: 0 });

    const renamed = await imported(
      owner,
      importFile("suppliers", [{ name: "Granite Ridge Stone Supply", email: "orders@graniteridge.example" }]),
    );
    expect(renamed.batch.counts).toEqual({ create: 0, update: 1, skip: 0, error: 0 });
    const stone = await inCompany(co.a, async (db) =>
      (await loadSuppliers(db)).find((s) => s.email === "orders@graniteridge.example"),
    );
    expect(stone).toMatchObject({ name: "Granite Ridge Stone Supply", address: granite.address });
  });

  it("I-17: products: supplier by name, decimals as stored, sq yd converted, coverage over 0, stock history and retired SKUs", async () => {
    const owner = people.ownerA;
    const plank = plankRow("RW-5001", "Harbor Oak Wide Plank", {
      price: "3.40",
      cost: "2.10",
      sq_ft_per_carton: "23.64",
    });
    const broadloom: ImportRow = {
      sku: "RW-5002",
      name: "Coastline Twist",
      category: "Carpet",
      unit: "sq yd",
      price: "27.00",
      cost: "18.00",
      width_ft: "12",
      supplier: RIDGEWAY,
    };
    const zero = plankRow("RW-5003", "Zero Coverage Laminate", { category: "Laminate", sq_ft_per_carton: "0" });
    const transit = plankRow("RW-5004", "Transit Porcelain", { category: "Porcelain tile", sq_ft_per_carton: "15.5" });
    const later = plankRow("RW-5005", "Cost Later Plank");
    const first = await imported(owner, importFile("products", [plank, broadloom, zero, transit, later]));
    expect(planActions(first.rows)).toBe("ccecc");
    expect(first.rows[2].problems).toEqual([
      { field: "sq_ft_per_carton", message: "Sq ft per carton must be more than 0." },
    ]);
    const ridgewayId = await supplierId(RIDGEWAY);
    expect(await productBySku(co.a, "RW-5001")).toMatchObject({
      price: "3.4000",
      cost: "2.1000",
      unit: "sq_ft",
      supplierId: ridgewayId,
    });
    expect(await productBySku(co.a, "RW-5002")).toMatchObject({
      price: "3.0000",
      cost: "2.0000",
      unit: "sq_ft",
      widthFt: 12,
    });
    expect(await productBySku(co.a, "RW-5003")).toBeUndefined();
    const nan = await inCompany(co.a, (db) =>
      db.execute<{ n: number }>(
        sql`select count(*)::int as n from products where 'NaN'::numeric in (price, cost, coalesce(sq_ft_per_carton, 0), coalesce(width_ft, 0))`,
      ),
    );
    expect(nan[0].n).toBe(0);
    expect((await checked(owner, importFile("products", [plank, broadloom]))).counts.skip).toBe(2);

    await movement((await productBySku(co.a, "RW-5001"))!.id, "receipt");
    await movement((await productBySku(co.a, "RW-5004"))!.id, "transfer_out");
    const frozen = (sku: string) =>
      `${sku} has stock history, so its cost, category, selling unit, coverage and roll width stay as they are. Leave them as they are or leave the row out.`;
    const costs = await checked(
      owner,
      importFile("products", [
        { ...plank, cost: "2.20" },
        { ...transit, cost: "2.60" },
      ]),
    );
    expect(costs.rows.map((row) => row.problems)).toEqual([
      [{ field: "cost", message: frozen("RW-5001") }],
      [{ field: "cost", message: frozen("RW-5004") }],
    ]);
    const unit = await checked(owner, importFile("products", [{ ...plank, unit: "each" }]));
    expect(unit.rows[0].problems).toEqual([{ field: "unit", message: frozen("RW-5001") }]);

    const shortLived = importFile("products", [plankRow("RW-5009", "Short Lived Plank")]);
    const gone = await imported(owner, shortLived);
    status(await undo(owner, gone.batch.id), 201);
    expect((await checked(owner, shortLived)).rows[0].problems).toEqual([
      { field: "sku", message: "SKU “RW-5009” belonged to a deleted product. Use another SKU." },
    ]);
  });

  it("I-18: Undo removes what the import created and puts back what it changed, exactly, and only once", async () => {
    const owner = people.ownerA;
    const juniper = await call("post", "/customers", owner.cookie).send({
      name: "Juniper Homes",
      email: "office@juniperhomes.example",
    });
    status(juniper, 201);
    const juniperId = juniper.body.id as string;
    const result = await imported(
      owner,
      importFile("customers", [
        { external_id: "CUST-9101", name: "Cedar Point Interiors", email: "hello@cedarpoint.example", ...QUARRY },
        {
          name: "Juniper Homes",
          email: "office@juniperhomes.example",
          phone: "(303) 555-0190",
          street: "300 Juniper Way",
          city: "Denver",
          state: "CO",
          zip: "80205",
        },
      ]),
    );
    expect(planActions(result.rows)).toBe("cu");
    const job = (await batchRow(co.a, result.batch.id))!;
    const cedar = job.changes.find((change) => change.before === null)!;
    const updated = job.changes.find((change) => change.id === juniperId)!;

    const response = await undo(owner, result.batch.id);
    status(response, 201);
    const summary = response.body as ImportBatchSummary;
    expect(summary).toMatchObject({ id: result.batch.id, undoneBy: "Test User" });
    expect(Date.parse(summary.undoneAt!)).not.toBeNaN();
    await inCompany(co.a, async (db) => {
      const [gone] = await db.select().from(customerTable).where(eq(customerTable.id, cedar.id));
      expect(gone.deletedAt).not.toBeNull();
      const places = await db.select().from(addressTable).where(eq(addressTable.customerId, cedar.id));
      expect(places.length).toBe(1);
      expect(places.every((place) => place.deletedAt !== null)).toBe(true);
      expect(await loadCustomers(db, [juniperId])).toEqual([updated.before]);
      const juniperPlaces = await db
        .select()
        .from(addressTable)
        .where(and(eq(addressTable.customerId, juniperId), eq(addressTable.street, "300 Juniper Way")));
      expect(juniperPlaces.map((place) => place.deletedAt !== null)).toEqual([true]);
    });
    const [removed] = await auditOf(co.a, "Removed imported customer", cedar.id);
    expect(removed.after).toEqual({ batch: result.batch.number });
    const [restored] = await auditOf(co.a, "Restored customer after undoing an import", juniperId);
    expect(restored.after).toMatchObject({ phone: "", batch: result.batch.number });
    const [undid] = await auditOf(co.a, "Undid import", result.batch.id);
    expect(undid).toMatchObject({
      before: "1 created, 1 updated, 0 skipped, 0 with errors",
      after: IMPORT_WORDS.undoneAfter,
    });
    refusedWith(await undo(owner, result.batch.id), 409, {
      code: "already_undone",
      message: IMPORT_WORDS.alreadyUndone(result.batch.number),
    });
  });

  it("I-19: refuses to undo a record changed since through its module", async () => {
    const owner = people.ownerA;
    const result = await imported(
      owner,
      importFile("customers", [
        { external_id: "CUST-9201", name: "Birch Lane Remodeling", email: "jobs@birchlane.example" },
      ]),
    );
    const birch = (await customerByExternalId("CUST-9201"))!;
    const { id, type, name, contactName, email, terms, defaultBillingId, defaultJobSiteId, addresses } = birch;
    const edited = await call("put", `/customers/${id}`, owner.cookie).send({
      type,
      name,
      contactName,
      email,
      phone: "(303) 555-0123",
      terms,
      defaultBillingId,
      defaultJobSiteId,
      addresses,
    });
    status(edited, 200);
    refusedWith(await undo(owner, result.batch.id), 409, {
      code: "import_changed",
      message: IMPORT_WORDS.changed("Birch Lane Remodeling"),
    });
    expect(await customerByExternalId("CUST-9201")).toMatchObject({ phone: "(303) 555-0123" });
    expect((await batchRow(co.a, result.batch.id))!.undoneAt).toBeNull();
  });

  it("I-20: refuses to undo records other records use: a quote, an order, a stock movement, a meeting guest", async () => {
    const owner = people.ownerA;
    const inUse = (name: string) => ({ code: "import_in_use", message: IMPORT_WORDS.inUse(name) });
    const unchanged = async (batchId: string) => expect((await batchRow(co.a, batchId))!.undoneAt).toBeNull();

    const aspen = await imported(
      owner,
      importFile("customers", [{ external_id: "CUST-9301", name: "Aspen Grove Homes", email: "aspen@grove.example" }]),
    );
    await quoteFor((await customerByExternalId("CUST-9301"))!.id);
    refusedWith(await undo(owner, aspen.batch.id), 409, inUse("Aspen Grove Homes"));
    await unchanged(aspen.batch.id);
    expect(await customerByExternalId("CUST-9301")).toBeDefined();

    const cobalt = await imported(
      owner,
      importFile("suppliers", [
        { external_id: "VEN-301", name: "Cobalt Trim Works", email: "sales@cobalttrim.example" },
      ]),
    );
    const order = await call("post", "/purchase-orders", owner.cookie).send({
      supplierId: await supplierId("Cobalt Trim Works"),
      contactId: null,
      supplierRef: "",
      placedVia: "email",
      expectedAt: "2026-12-01",
      locationId: warehouse,
      lines: [{ productId: tile, description: "Slate Tile", quantity: "100", unit: "sq_ft", unitCost: "2.1000" }],
      asDraft: true,
    });
    status(order, 201);
    refusedWith(await undo(owner, cobalt.batch.id), 409, inUse("Cobalt Trim Works"));
    await unchanged(cobalt.batch.id);

    const moved = await imported(owner, importFile("products", [plankRow("RW-5101", "Movement Plank")]));
    await movement((await productBySku(co.a, "RW-5101"))!.id, "receipt");
    refusedWith(await undo(owner, moved.batch.id), 409, inUse("Movement Plank"));
    await unchanged(moved.batch.id);

    const sierra = await imported(
      owner,
      importFile("suppliers", [
        { external_id: "VEN-302", name: "Sierra Stone Co", email: "hello@sierrastone.example" },
      ]),
    );
    const sierraId = await supplierId("Sierra Stone Co");
    await inCompany(co.a, async (db) => {
      const [meeting] = await db
        .insert(meetings)
        .values({
          title: "Supplier visit",
          start: new Date("2026-12-01T16:00:00Z"),
          durationMin: 30,
          reminderMin: 15,
          ownerUserId: owner.id,
          timeZone: "America/Chicago",
          uid: `${uuidv7()}@import.test`,
          status: "confirmed",
          createdBy: owner.id,
        })
        .returning();
      await db.insert(meetingAttendees).values({
        meetingId: meeting.id,
        partyType: "supplier",
        partyId: sierraId,
        name: "Sierra Stone Co",
        role: "required",
        createdBy: owner.id,
      });
    });
    refusedWith(await undo(owner, sierra.batch.id), 409, inUse("Sierra Stone Co"));
    await unchanged(sierra.batch.id);
  });

  it("I-21: batches undo newest first", async () => {
    const owner = people.ownerA;
    const row = { external_id: "CUST-9401", name: "Hawthorne Flooring", email: "hi@hawthorne.example" };
    const first = await imported(owner, importFile("customers", [row]));
    const second = await imported(owner, importFile("customers", [{ ...row, phone: "(303) 555-0144" }]));
    refusedWith(await undo(owner, first.batch.id), 409, {
      code: "import_changed",
      message: IMPORT_WORDS.changed("Hawthorne Flooring"),
    });
    status(await undo(owner, second.batch.id), 201);
    status(await undo(owner, first.batch.id), 201);
    expect(await customerByExternalId("CUST-9401")).toBeUndefined();
  });

  it("I-22: refuses to put back a product's cost once stock has arrived", async () => {
    const owner = people.ownerA;
    const result = await imported(
      owner,
      importFile("products", [plankRow("RW-5005", "Cost Later Plank", { cost: "2.40" })]),
    );
    expect(result.batch.counts.update).toBe(1);
    const product = (await productBySku(co.a, "RW-5005"))!;
    await movement(product.id, "receipt");
    refusedWith(await undo(owner, result.batch.id), 409, {
      code: "import_in_use",
      message:
        "RW-5005 has stock history now, so its cost, category, selling unit, coverage and roll width can't be put back.",
    });
    expect(await productBySku(co.a, "RW-5005")).toMatchObject({ cost: "2.4000" });
    expect((await batchRow(co.a, result.batch.id))!.undoneAt).toBeNull();
  });

  it("I-23: one import at a time per company: a held lock refuses, and a doubled import writes once", async () => {
    const owner = people.ownerA;
    const file = importFile(
      "customers",
      [{ external_id: "CUST-9501", name: "Parallel Co", email: "parallel@example.test" }],
      "parallel.csv",
    );
    expect(planActions((await checked(owner, file)).rows)).toBe("c");
    await stepUp(owner);
    const both = await Promise.all([commit(owner, file, "c"), commit(owner, file, "c")]);
    expect(both.map((response) => response.status).sort()).toEqual([201, 409]);
    const refused = both.find((response) => response.status === 409)!;
    expect(["import_running", "plan_changed"]).toContain(refused.body.code);
    const done = both.find((response) => response.status === 201)!.body as ImportResult;
    await inCompany(co.a, async (db) => {
      expect(await db.select().from(importJobs).where(eq(importJobs.fileName, "parallel.csv"))).toHaveLength(1);
      expect(await db.select().from(customerTable).where(eq(customerTable.externalId, "CUST-9501"))).toHaveLength(1);
    });

    const holder = await harness.companyDb(co.a);
    try {
      await holder.db.execute(sql`select pg_advisory_lock(hashtext('imports:run'))`);
      const other = importFile("customers", [
        { external_id: "CUST-9502", name: "Waiting Co", email: "wait@example.test" },
      ]);
      refusedWith(await check(owner, other), 409, RUNNING);
      await stepUp(owner);
      refusedWith(await commit(owner, other, "c"), 409, RUNNING);
      refusedWith(await undo(owner, done.batch.id), 409, RUNNING);
      await holder.db.execute(sql`select pg_advisory_unlock(hashtext('imports:run'))`);
    } finally {
      await holder.close();
    }
    expect((await batchRow(co.a, done.batch.id))!.undoneAt).toBeNull();
    expect(await customerByExternalId("CUST-9502")).toBeUndefined();
  });

  it("I-24: stops the 51st import in 24 hours, deleted batches counted, but not a dry run", async () => {
    const owner = people.ownerD;
    await inCompany(co.d, (db) =>
      db.insert(importJobs).values(
        Array.from({ length: 50 }, (_, i) => ({
          number: `IMP-${2001 + i}`,
          kind: "customers" as const,
          fileName: "earlier.csv",
          mapping: { name: "Name" },
          counts: { create: 1, update: 0, skip: 0, error: 0 },
          changes: [],
          createdBy: owner.id,
          deletedAt: i < 10 ? new Date() : null,
        })),
      ),
    );
    const file = importFile("customers", [{ name: "One Too Many", email: "many@example.test" }]);
    expect((await checked(owner, file)).counts.create).toBe(1);
    await stepUp(owner);
    refusedWith(await commit(owner, file, "c"), 429, {
      code: "rate_limited",
      message: "Your company has imported 50 files in the last 24 hours. Try again later.",
    });
  });

  it("I-25: one company never reaches another's imports, and a body can't name a company", async () => {
    const before = { a: await tally(co.a), b: await tally(co.b) };
    const aBatches = (await overview(people.ownerA)).batches.map((batch) => batch.id);
    expect(aBatches.length).toBeGreaterThan(0);
    refusedWith(await undo(people.ownerB, aBatches[0]), 404, { code: "not_found", message: IMPORT_WORDS.gone });
    const seen = (await overview(people.ownerB)).batches.map((batch) => batch.id);
    expect(seen.filter((id) => aBatches.includes(id))).toEqual([]);
    const file = importFile("customers", [{ name: "Cross Company", email: "cross@example.test" }]);
    refusedWith(await check(people.ownerB, { ...file, companyId: co.a }), 400, UNKNOWN_FIELD);
    refusedWith(await commit(people.ownerB, { ...file, companyId: co.a } as ImportRequest, "c"), 400, UNKNOWN_FIELD);
    expect({ a: await tally(co.a), b: await tally(co.b) }).toEqual(before);
  });

  it("I-26: saves column choices in place, audited, for kinds the person may import", async () => {
    const owner = people.ownerA;
    const save = (kind: string, columns: Record<string, string | null>, cookie = owner.cookie) =>
      call("put", `/imports/mappings/${kind}`, cookie).send({ columns });
    const first = await save("customers", { name: "Customer Name", email: "E-mail" });
    status(first, 200);
    const saved = first.body as ImportMapping;
    expect(saved).toMatchObject({
      kind: "customers",
      columns: { name: "Customer Name", email: "E-mail", phone: null },
    });
    expect((await overview(owner)).mappings).toContainEqual(saved);
    const second = await save("customers", { name: "Account Name" });
    status(second, 200);
    expect(second.body).toMatchObject({ id: saved.id, columns: { name: "Account Name", email: null } });
    const rows = await inCompany(co.a, (db) =>
      db.select().from(importMappings).where(eq(importMappings.kind, "customers")),
    );
    expect(rows).toHaveLength(1);
    const entries = await auditOf(co.a, "Saved import columns", saved.id);
    expect(entries.map((entry) => [entry.before, entry.after])).toEqual([
      [null, saved.columns],
      [saved.columns, second.body.columns],
    ]);
    refusedWith(await save("widgets", { name: "Name" }), 400, {
      code: "invalid_request",
      message: "Choose what to import.",
    });
    refusedWith(await save("stock", { sku: "SKU" }), 404, NOT_AVAILABLE);
    refusedWith(await save("customers", { name: "Name" }, cookies.manager), 403, { code: "forbidden" });
  });

  it("I-27: Summit's suppliers, products, customers and addresses import into a fresh company (week-19 gate, part 1)", async () => {
    const owner = people.ownerG;
    const data = summitMasterData();
    const files = summitFiles(data);
    const kinds = [
      ["suppliers", data.suppliers.length],
      ["products", data.products.length],
      ["customers", data.customers.length],
      ["addresses", data.customers.flatMap((c) => c.addresses).length],
    ] as const;
    expect(kinds.map(([, n]) => n)).toEqual([26, 120, 80, 118]);
    const batches: string[] = [];
    for (const [kind, n] of kinds) {
      const result = await imported(owner, files[kind]);
      expect(result.batch.counts, kind).toEqual({ create: n, update: 0, skip: 0, error: 0 });
      batches.push(result.batch.id);
    }
    const primaries = data.supplierContacts.filter((contact) => contact.isPrimary).length;
    await inCompany(co.g, async (db) => {
      expect((await loadSuppliers(db)).length).toBe(26);
      expect((await loadContacts(db)).length).toBe(primaries);
      expect((await loadProducts(db)).length).toBe(120);
      const customers = await loadCustomers(db);
      expect(customers.length).toBe(80);
      expect(customers.flatMap((c) => c.addresses).length).toBe(118);
    });
    const listed = await call("get", "/products", owner.cookie);
    status(listed, 200);
    const bySku = new Map((listed.body as Product[]).map((product) => [product.sku, product]));
    for (const product of data.products) {
      const got = bySku.get(product.sku);
      expect(got, product.sku).toBeDefined();
      expect(dec(got!.price).eq(product.price), `${product.sku} price`).toBe(true);
      expect(dec(got!.cost).eq(product.cost), `${product.sku} cost`).toBe(true);
    }
    for (const [kind, n] of kinds) {
      expect((await checked(owner, files[kind])).counts, kind).toEqual({ create: 0, update: 0, skip: n, error: 0 });
    }
    for (const id of [...batches].reverse()) status(await undo(owner, id), 201);
    await inCompany(co.g, async (db) => {
      expect(await loadSuppliers(db)).toEqual([]);
      expect(await loadContacts(db)).toEqual([]);
      expect(await loadProducts(db)).toEqual([]);
      expect(await loadCustomers(db)).toEqual([]);
      const [live] = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from addresses where deleted_at is null`,
      );
      expect(live.n).toBe(0);
    });
  }, 240_000);

  it("I-28: Undo counts only live references: addresses then customers, products then suppliers, a deleted quote", async () => {
    const owner = people.ownerA;
    const linden = await imported(
      owner,
      importFile("customers", [
        { external_id: "CUST-9601", name: "Linden Builders", email: "office@linden.example", ...QUARRY },
      ]),
    );
    const sites = await imported(
      owner,
      importFile("addresses", [
        { customer: "CUST-9601", label: "Job site", street: "5 Linden Ct", city: "Denver", state: "CO", zip: "80206" },
      ]),
    );
    status(await undo(owner, sites.batch.id), 201);
    status(await undo(owner, linden.batch.id), 201);
    expect(await customerByExternalId("CUST-9601")).toBeUndefined();

    const willow = await imported(
      owner,
      importFile("suppliers", [{ external_id: "VEN-601", name: "Willow Supply", email: "orders@willow.example" }]),
    );
    const plank = await imported(
      owner,
      importFile("products", [plankRow("WS-1", "Willow Plank", { supplier: "Willow Supply" })]),
    );
    status(await undo(owner, plank.batch.id), 201);
    status(await undo(owner, willow.batch.id), 201);

    const spruce = await imported(
      owner,
      importFile("customers", [{ external_id: "CUST-9701", name: "Spruce Homes", email: "hi@spruce.example" }]),
    );
    const quoteId = await quoteFor((await customerByExternalId("CUST-9701"))!.id);
    await inCompany(co.a, (db) =>
      db.update(quoteTable).set({ deletedAt: new Date() }).where(eq(quoteTable.id, quoteId)),
    );
    status(await undo(owner, spruce.batch.id), 201);
    expect(await customerByExternalId("CUST-9701")).toBeUndefined();
  });

  it("I-29: refuses to undo a product move whose earlier supplier was removed since", async () => {
    const owner = people.ownerA;
    const xenon = await imported(
      owner,
      importFile("suppliers", [{ external_id: "VEN-701", name: "Xenon Floors", email: "orders@xenon.example" }]),
    );
    status(
      await call("post", "/suppliers", owner.cookie).send({ name: "Zephyr Supply", email: "orders@zephyr.example" }),
      201,
    );
    await imported(owner, importFile("products", [plankRow("Q-1", "Quartz Plank", { supplier: "Xenon Floors" })]));
    const moved = await imported(
      owner,
      importFile("products", [plankRow("Q-1", "Quartz Plank", { supplier: "Zephyr Supply" })]),
    );
    expect(moved.batch.counts.update).toBe(1);
    status(await undo(owner, xenon.batch.id), 201);
    refusedWith(await undo(owner, moved.batch.id), 409, {
      code: "import_in_use",
      message: "Q-1's earlier supplier was removed, so the import cannot be undone.",
    });
    expect(await productBySku(co.a, "Q-1")).toMatchObject({ supplierId: await supplierId("Zephyr Supply") });
  });

  it("I-30: a missing rep or supplier goes back as none, never as an empty id", async () => {
    const owner = people.ownerA;
    await inCompany(co.a, async (db) => {
      await db.insert(customerTable).values({
        type: "homeowner",
        name: "Null Rep Homes",
        email: "nullrep@example.test",
        terms: "due_on_receipt",
        createdBy: owner.id,
      });
      await db.insert(productTable).values({
        sku: "NR-1",
        name: "No Supplier Plank",
        category: "lvp",
        unit: "sq_ft",
        price: "3.0000",
        cost: "1.5000",
        sqFtPerCarton: "20",
        createdBy: owner.id,
      });
    });
    const customers = await imported(
      owner,
      importFile("customers", [{ name: "Null Rep Homes", email: "nullrep@example.test", phone: "(303) 555-0111" }]),
    );
    const products = await imported(
      owner,
      importFile("products", [plankRow("NR-1", "Supplier Plank", { price: "3.00", cost: "1.50" })]),
    );
    expect([customers.batch.counts.update, products.batch.counts.update]).toEqual([1, 1]);
    status(await undo(owner, products.batch.id), 201);
    status(await undo(owner, customers.batch.id), 201);
    await inCompany(co.a, async (db) => {
      const [customer] = await db.select().from(customerTable).where(eq(customerTable.email, "nullrep@example.test"));
      expect(customer).toMatchObject({ salesRepId: null, phone: "" });
      const [product] = await db.select().from(productTable).where(eq(productTable.sku, "NR-1"));
      expect(product).toMatchObject({ supplierId: null, name: "No Supplier Plank" });
    });
  });

  it("I-31: a key several records share is a row error, and other rows still import", async () => {
    const owner = people.ownerA;
    for (const name of ["Twin One", "Twin Two"]) {
      status(await call("post", "/customers", owner.cookie).send({ name, email: "twins@example.test" }), 201);
    }
    const result = await imported(
      owner,
      importFile("customers", [
        { name: "Twin One", email: "twins@example.test" },
        { external_id: "CUST-9801", name: "Unique Co", email: "unique@example.test" },
      ]),
    );
    expect(planActions(result.rows)).toBe("ec");
    expect(result.rows[0].problems).toEqual([
      { field: "email", message: "2 customers have the email “twins@example.test”. Give an External ID instead." },
    ]);
    expect(await customerByExternalId("CUST-9801")).toBeDefined();
    const sites = await checked(
      owner,
      importFile("addresses", [
        { customer: "twins@example.test", street: "1 Twin Way", city: "Denver", state: "CO", zip: "80207" },
      ]),
    );
    expect(sites.rows[0].problems).toEqual([
      {
        field: "customer",
        message: "2 customers match “twins@example.test”. Use their External ID or email.",
      },
    ]);
  });

  it("I-32: an Undo answers at once while a quote is being saved for a customer it created, then refuses", async () => {
    const owner = people.ownerA;
    const juniper = await imported(
      owner,
      importFile("customers", [
        { external_id: "CUST-9901", name: "Juniper Floors", email: "hi@juniper.example", ...QUARRY },
      ]),
    );
    const customerId = (await customerByExternalId("CUST-9901"))!.id;
    const writer = await harness.companyDb(co.a);
    let commitQuote = () => {};
    const held = new Promise<void>((resolve) => (commitQuote = resolve));
    let inserted = () => {};
    const ready = new Promise<void>((resolve) => (inserted = resolve));
    let saving: Promise<void> | undefined;
    const untouched = async () => {
      expect((await batchRow(co.a, juniper.batch.id))!.undoneAt).toBeNull();
      expect(await customerByExternalId("CUST-9901")).toMatchObject({ addresses: [{ label: "billing" }] });
    };
    try {
      // The quote's foreign-key check holds FOR KEY SHARE on the customer until this transaction ends.
      saving = writer.db.transaction(async (tx) => {
        const [site] = await tx
          .select({ branchId: locations.branchId })
          .from(locations)
          .where(eq(locations.id, warehouse));
        await tx.insert(quoteTable).values({
          number: "Q-IMPORT-RACE",
          customerId,
          salesRepId: owner.id,
          branchId: site.branchId,
          status: "draft",
          locationId: warehouse,
          jobSite: { street: "12 Pine Rd", city: "Denver", state: "CO", zip: "80202" },
          total: "0",
          createdBy: owner.id,
        });
        inserted();
        await held;
      });
      await Promise.race([ready, saving]);
      await stepUp(owner);
      // NOWAIT: the Undo meets the quote's lock and answers, well inside the 10-second lock timeout.
      const started = Date.now();
      const busy = await call("post", `/imports/${juniper.batch.id}/undo`, owner.cookie);
      const took = Date.now() - started;
      refusedWith(busy, 409, { code: "import_busy", message: IMPORT_WORDS.undoBusy });
      expect(took, "the Undo answered without waiting for the quote").toBeLessThan(5_000);
      await untouched();
      commitQuote();
      await saving;
      refusedWith(await undo(owner, juniper.batch.id), 409, {
        code: "import_in_use",
        message: IMPORT_WORDS.inUse("Juniper Floors"),
      });
    } finally {
      commitQuote();
      await saving?.catch(() => undefined);
      await writer.close();
    }
    await untouched();
  }, 60_000);

  it("I-33: an addresses file without the type column leaves a stored billing address as it is", async () => {
    const owner = people.ownerA;
    await imported(
      owner,
      importFile("customers", [
        { external_id: "CUST-9902", name: "Larch Homes", email: "hi@larch.example", ...QUARRY },
      ]),
    );
    for (const extra of [{}, { default: "yes" }] as ImportRow[]) {
      const preview = await checked(owner, importFile("addresses", [{ customer: "CUST-9902", ...QUARRY, ...extra }]));
      expect(preview.rows.map((row) => [row.action, row.note])).toEqual([["skip", "Already on file."]]);
    }
  });

  it("lists the history newest first, without the saved record versions", async () => {
    const { batches } = await overview(people.ownerA);
    const stored = await inCompany(co.a, (db) =>
      db
        .select({ id: importJobs.id })
        .from(importJobs)
        .where(
          inArray(
            importJobs.id,
            batches.map((batch) => batch.id),
          ),
        ),
    );
    expect(stored).toHaveLength(batches.length);
    const times = batches.map((batch) => Date.parse(batch.at));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    for (const batch of batches) expect(batch).not.toHaveProperty("changes");
  });
});
