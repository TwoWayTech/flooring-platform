import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { productPermissions } from "@workspace/db";
import {
  auditLog,
  branches,
  invoiceLines,
  invoices,
  journalEntries,
  locations,
  products,
  quotes,
  reservations,
  rolePermissions,
  roles,
  rolls,
  settings,
  stockMovements,
  taxRules,
} from "@workspace/db/company";
import { tenantPermissionCeiling } from "@workspace/db/control";
import {
  enabledModules,
  FEATURES,
  LOCATION_MESSAGES,
  LOCATION_RULE,
  permissionsForModules,
  PRODUCT_ROLES,
  PROFILE_MESSAGES,
  QUANTITY_TEXT,
  roleTemplate,
  rolesRequireMfa,
  SETTINGS_SCOPE_MESSAGE,
  type FeatureKey,
  type Location,
  type PermissionKey,
  type ProductKey,
} from "@workspace/shared";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { v4 as uuidv4, v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAudited, permissionRequirement } from "../src/core/access/permission.decorators";
import { AuthHarness } from "./auth-harness";
import { platformHelpers } from "./support/platform-admins";

type RoleKey = (typeof PRODUCT_ROLES)[ProductKey][number];
type CompanyDbOf = Awaited<ReturnType<AuthHarness["companyDb"]>>["db"];

/** One company of the test: its tenant id and slug, and its product. */
interface TestCompany {
  id: string;
  slug: string;
  product: ProductKey;
}

/** A signed-in member. */
interface Member {
  cookie: string;
  email: string;
}

/** A location as a write sends it, without its id. */
type Body = Omit<Location, "id">;

const ADDRESS = { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" };
const WAREHOUSE_WORDS = "Fulfil the quote from a warehouse.";
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
 * Settings part 4a on the API (ADR 0059, part 4a; spec settings-and-permissions.md rule 29,
 * inventory.md rule 24): POST /locations and PUT /locations/:id with Stock rules' key, the core
 * module, the `inventory.locations` switch, company-wide scope, strict bodies, the shared rules
 * against the live rows under the stock lock, one audit entry per saved row, and the conversion's
 * warehouse check (D21), against companies with databases of their own. Every case names its id
 * first, for the mutation runs.
 */
describe("settings part 4a on the API: warehouses and showrooms (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled } = platformHelpers(harness);
  const floorco: TestCompany = { id: "", slug: "", product: "flooring" };
  const peopleco: TestCompany = { id: "", slug: "", product: "hr" };
  const otherco: TestCompany = { id: "", slug: "", product: "flooring" };
  /** One member per default role of floorco and peopleco. */
  const people = new Map<string, Member>();
  const ids = { main: "", north: "", a: "", b: "", s: "", tile: "", carpet: "", otherBranch: "", otherA: "" };
  let owner: Member = { cookie: "", email: "" };
  let customer = "";

  beforeAll(async () => {
    await harness.start();
    Object.assign(floorco, await harness.provisionCompany("locco"));
    Object.assign(peopleco, await harness.provisionCompany("locpeople", ["hr"]));
    Object.assign(otherco, await harness.provisionCompany("locother"));
    await withCompanyDb(floorco, async (db) => {
      const [main, north] = await db
        .insert(branches)
        .values([
          { name: "Main", city: "Austin", state: "TX" },
          { name: "North", city: "Dallas", state: "TX" },
        ])
        .returning();
      const [a, b, s] = await db
        .insert(locations)
        .values([
          { name: "Main Warehouse", kind: "warehouse" as const, branchId: main.id, address: ADDRESS, isDefault: true },
          { name: "North Warehouse", kind: "warehouse" as const, branchId: north.id, address: ADDRESS },
          {
            name: "Main Showroom",
            kind: "showroom" as const,
            branchId: main.id,
            address: ADDRESS,
            displaySamples: 40,
            floorAreaSqFt: "3200",
          },
        ])
        .returning();
      const [tile, carpet] = await db
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
      await db.insert(stockMovements).values(opening(tile.id, a.id, "200"));
      await db.insert(settings).values({ group: "localization", value: summitLocalization() });
      await db.insert(taxRules).values({
        state: "TX",
        jurisdiction: "Austin combined",
        ratePct: "8.25",
        taxable: { material: true, labor: false, freight: false, service: false },
        lumpSumLaborTaxable: true,
        validFrom: "2025-01-01",
        version: 1,
      });
      Object.assign(ids, {
        main: main.id,
        north: north.id,
        a: a.id,
        b: b.id,
        s: s.id,
        tile: tile.id,
        carpet: carpet.id,
      });
    });
    await withCompanyDb(otherco, async (db) => {
      const [branch] = await db.insert(branches).values({ name: "Other", city: "Austin", state: "TX" }).returning();
      const [a] = await db
        .insert(locations)
        .values({
          name: "Other Warehouse",
          kind: "warehouse" as const,
          branchId: branch.id,
          address: ADDRESS,
          isDefault: true,
        })
        .returning();
      ids.otherBranch = branch.id;
      ids.otherA = a.id;
    });
    for (const company of [floorco, peopleco])
      for (const key of PRODUCT_ROLES[company.product])
        people.set(`${company.product}:${key}`, await member(company, [key]));
    owner = people.get("flooring:owner")!;
    const made = await call("post", "/customers", owner.cookie).send({ name: "Rae Chen" });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    customer = made.body.id as string;
  }, 300_000);

  afterAll(async () => {
    await harness.stop();
  });

  /** An opening count of boxed stock, as the seed writes one. */
  function opening(productId: string, locationId: string, quantity: string) {
    return {
      at: new Date(),
      productId,
      locationId,
      quantity,
      kind: "opening" as const,
      sourceType: "count" as const,
      sourceId: uuidv7(),
      sourceNumber: "OPEN",
    };
  }

  /** Runs `work` on a company's own database, behind the API's back. */
  async function withCompanyDb<T>(company: TestCompany, work: (db: CompanyDbOf) => Promise<T>): Promise<T> {
    const handle = await harness.companyDb(company.id);
    try {
      return await work(handle.db);
    } finally {
      await handle.close();
    }
  }

  /** A signed-in member holding `roles` in `company`, enrolled in MFA when the roles need it. */
  async function member(company: TestCompany, held: string[], mfa = rolesRequireMfa(held)): Promise<Member> {
    const email = await harness.addUser({ companyIds: [company.id], roles: held });
    if (!mfa) return { cookie: await harness.signIn(email), email };
    return { cookie: (await enrolled(email)).cookie, email };
  }

  /** The permissions a default role holds in a fresh company of one product (as permissions.int.test.ts works them out). */
  function expectedPermissions(product: ProductKey, key: RoleKey): PermissionKey[] {
    const ceiling = new Set<PermissionKey>(productPermissions([product]));
    const enabled = new Set<PermissionKey>(permissionsForModules(enabledModules([product], null, [])));
    return roleTemplate(key).permissions.filter((permission) => ceiling.has(permission) && enabled.has(permission));
  }

  /** What a default role's location write answers: the module first (the guard's order), then the key, then scope all. */
  function expectedWrite(product: ProductKey, key: RoleKey, ok: number): [number, string | undefined] {
    if (!enabledModules([product], null, []).includes(LOCATION_RULE.module)) return [403, "module_not_enabled"];
    const held = expectedPermissions(product, key);
    if (!LOCATION_RULE.keys.some((needed) => held.includes(needed))) return [403, "forbidden"];
    return roleTemplate(key).dataScope === "all" ? [ok, undefined] : [403, "forbidden"];
  }

  /** Switches a feature off for one run, as imports.int.test.ts does. */
  async function withFeatureOff(key: FeatureKey, run: () => Promise<void>) {
    const feature = FEATURES[key] as { enabled: boolean };
    feature.enabled = false;
    try {
      await run();
    } finally {
      feature.enabled = true;
    }
  }

  /** A status and code pair, for compact refusal checks. */
  function outcome(response: { status: number; body: { code?: string } }) {
    return [response.status, response.body.code];
  }

  /** A location's row as stored, or undefined. */
  function locationRow(id: string, company = floorco) {
    return withCompanyDb(company, async (db) => (await db.select().from(locations).where(eq(locations.id, id)))[0]);
  }

  /** The ids of a company's default locations. */
  function defaults(company = floorco): Promise<string[]> {
    return withCompanyDb(company, async (db) =>
      (await db.select({ id: locations.id }).from(locations).where(eq(locations.isDefault, true))).map((row) => row.id),
    );
  }

  /** A company's audit entries with this action. */
  function auditsOf(action: string, company = floorco) {
    return withCompanyDb(company, (db) => db.select().from(auditLog).where(eq(auditLog.action, action)));
  }

  /** How many audit entries and locations a company has. */
  function counts(company = floorco): Promise<[number, number]> {
    return withCompanyDb(company, async (db) => [
      (await db.select({ n: count() }).from(auditLog))[0].n,
      (await db.select({ n: count() }).from(locations))[0].n,
    ]);
  }

  /** `GET /locations` as `cookie`. */
  async function listed(cookie = owner.cookie): Promise<Location[]> {
    const response = await call("get", "/locations", cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as Location[];
  }

  /** `POST /locations` as `cookie`. */
  function post(cookie: string, body: unknown) {
    return call("post", "/locations", cookie).send(body as object);
  }

  /** `PUT /locations/:id` as `cookie`. */
  function put(cookie: string, id: string, body: unknown) {
    return call("put", `/locations/${id}`, cookie).send(body as object);
  }

  /** Main Showroom's fields with a change, as a write sends them. */
  function body(patch: Partial<Body> = {}): Body {
    return {
      name: "Main Showroom",
      kind: "showroom",
      branchId: ids.main,
      address: ADDRESS,
      isDefault: false,
      displaySamples: 40,
      floorAreaSqFt: "3200",
      ...patch,
    };
  }

  /** A warehouse's fields, as a write sends them. */
  function warehouse(name: string, patch: Partial<Body> = {}): Body {
    return body({ name, kind: "warehouse", displaySamples: 0, floorAreaSqFt: "", ...patch });
  }

  /** A new warehouse in Main made by the Owner through POST; answers it. */
  async function freshWarehouse(name: string): Promise<Location> {
    const made = await post(owner.cookie, warehouse(name));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    return made.body as Location;
  }

  /** A location inserted behind the API's back (LNA18). */
  function insertLocation(name: string, fields: Partial<typeof locations.$inferInsert> = {}): Promise<string> {
    return withCompanyDb(floorco, async (db) => {
      const [row] = await db
        .insert(locations)
        .values({ name, kind: "warehouse" as const, branchId: ids.main, address: ADDRESS, ...fields })
        .returning();
      return row.id;
    });
  }

  /** Sets a location's columns behind the API's back. */
  function setLocation(id: string, fields: Partial<typeof locations.$inferInsert>) {
    return withCompanyDb(floorco, (db) => db.update(locations).set(fields).where(eq(locations.id, id)));
  }

  /** A quote's body for 100 sq ft of tile from `location`, with an optional line warehouse. */
  function quoteBody(location: string, lineLocation?: string) {
    return {
      customerId: customer,
      locationId: location,
      jobSite: { street: "12 Pine Rd", city: "Austin", state: "TX", zip: "78701" },
      rooms: [],
      lines: [
        {
          id: "draft-1",
          productId: ids.tile,
          description: "Slate Tile",
          category: "material",
          unit: "sq_ft",
          quantity: "100",
          unitPrice: "4.50",
          unitCost: "0",
          wastePct: "10",
          ...(lineLocation ? { locationId: lineLocation } : {}),
        },
      ],
      depositPct: "0",
      taxOverride: null,
      notes: "",
    };
  }

  /** A quote from `location` (and a line warehouse), sent and accepted; answers its id. */
  async function accepted(location: string, lineLocation?: string): Promise<string> {
    const quote = await call("post", "/quotes", owner.cookie).send(quoteBody(location, lineLocation));
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    await call("post", `/quotes/${quote.body.id}/status`, owner.cookie)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    await call("post", `/quotes/${quote.body.id}/status`, owner.cookie).send({ action: "accept" }).expect(201);
    return quote.body.id as string;
  }

  /** How many invoices, reservations and journal entries floorco has. */
  function bookCounts(): Promise<[number, number, number]> {
    return withCompanyDb(floorco, async (db) => [
      (await db.select({ n: count() }).from(invoices))[0].n,
      (await db.select({ n: count() }).from(reservations))[0].n,
      (await db.select({ n: count() }).from(journalEntries))[0].n,
    ]);
  }

  /** The PUT that turns `location` into a showroom. */
  function toShowroom(location: Location) {
    const { id, ...rest } = location;
    return put(owner.cookie, id, { ...rest, kind: "showroom", isDefault: false, displaySamples: 0 });
  }

  /** The PUT that turns `location` back into a warehouse. */
  async function backToWarehouse(location: Location) {
    const { id, ...rest } = location;
    await put(owner.cookie, id, { ...rest, kind: "warehouse", displaySamples: 0 }).expect(200);
  }

  /** `toShowroom` is refused with `message`, and nothing is written or audited. */
  async function refusedAsShowroom(location: Location, message: string) {
    const before = await counts();
    const refused = await toShowroom(location);
    expect([refused.status, refused.body], location.name).toEqual([400, { code: "invalid_request", message }]);
    expect((await locationRow(location.id))!.kind).toBe("warehouse");
    expect(await counts()).toEqual(before);
  }

  it("LNA0 the routes declare Stock rules' key, the core module and audit; GET stays any member's", async () => {
    const { InventoryController } = await import("../src/modules/inventory/inventory.controller");
    const reflector = new Reflector();
    const context = (handler: string) =>
      ({
        getHandler: () => (InventoryController.prototype as unknown as Record<string, unknown>)[handler],
        getClass: () => InventoryController,
      }) as unknown as ExecutionContext;
    for (const [handler, method] of [
      ["createLocation", "POST"],
      ["updateLocation", "PUT"],
    ] as const) {
      const requirement = permissionRequirement(reflector, context(handler), method);
      expect(requirement.permissions, handler).toEqual(LOCATION_RULE.keys);
      expect(requirement.module, handler).toBe("core");
      expect(isAudited(reflector, context(handler)), handler).toBe(true);
    }
    expect(LOCATION_RULE.module).toBe("core");
    expect(permissionRequirement(reflector, context("locations"), "GET").anyMember).toBe(true);
  });

  for (const company of [floorco, peopleco]) {
    for (const key of PRODUCT_ROLES[company.product]) {
      it(`LNA1 ${company.product} ${key}: POST and PUT need the key at scope all in a company with core`, async () => {
        const person = people.get(`${company.product}:${key}`)!;
        const before = await counts(company);
        const made = await post(person.cookie, body({ name: `LNA1 ${key}` }));
        const changed = await put(person.cookie, ids.s, body());
        const [created, createdCode] = expectedWrite(company.product, key, 201);
        const [updated, updatedCode] = expectedWrite(company.product, key, 200);
        expect(outcome(made), `POST ${JSON.stringify(made.body)}`).toEqual([created, createdCode]);
        expect(outcome(changed), `PUT ${JSON.stringify(changed.body)}`).toEqual([updated, updatedCode]);
        if (created !== 201) expect(await counts(company)).toEqual(before);
      });
    }
  }

  it("LNA2 another company's Owner reaches only their own company's locations and branches", async () => {
    const other = await member(otherco, ["owner"]);
    const showroom = await locationRow(ids.s);
    const theirs = await counts(otherco);
    const mine = await counts();
    expect(outcome(await put(other.cookie, ids.s, body({ name: "Taken over" })))).toEqual([404, "not_found"]);
    expect(await locationRow(ids.s)).toEqual(showroom);
    const refused = await post(other.cookie, body({ name: "LNA2 branch" }));
    expect([refused.status, refused.body.message]).toEqual([400, LOCATION_MESSAGES.branch]);
    expect(await counts(otherco)).toEqual(theirs);
    expect(await counts()).toEqual(mine);
    const made = await post(other.cookie, body({ name: "LNA2 own", branchId: ids.otherBranch }));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(await locationRow(made.body.id as string, otherco)).toBeDefined();
    expect(await locationRow(made.body.id as string)).toBeUndefined();
    expect(await counts()).toEqual(mine);
  });

  it("LNA3 the switch off: POST and PUT 404, GET still answers (D3)", async () => {
    const list = await listed();
    await withFeatureOff("inventory.locations", async () => {
      expect((await post(owner.cookie, body({ name: "LNA3" }))).status).toBe(404);
      expect((await put(owner.cookie, ids.s, body())).status).toBe(404);
      expect(await listed()).toEqual(list);
    });
  });

  it("LNA4 the HR Suite: POST and PUT 403 module_not_enabled; GET 403 as before", async () => {
    const hrOwner = people.get("hr:owner")!;
    expect(outcome(await post(hrOwner.cookie, body({ name: "LNA4" })))).toEqual([403, "module_not_enabled"]);
    expect(outcome(await put(hrOwner.cookie, ids.s, body()))).toEqual([403, "module_not_enabled"]);
    expect((await call("get", "/locations", hrOwner.cookie)).status).toBe(403);
  });

  it("LNA5 data scope below all is refused with the settings words, and nothing is written", async () => {
    const roleKey = "branch-locations";
    await withCompanyDb(floorco, async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: roleKey, name: "Branch locations", dataScope: "branch" as const })
        .returning();
      await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "settings.locations.manage" });
    });
    const person = await member(floorco, [roleKey], true);
    const before = await counts();
    const words = { code: "forbidden", message: SETTINGS_SCOPE_MESSAGE };
    const made = await post(person.cookie, body({ name: "LNA5" }));
    expect([made.status, made.body]).toEqual([403, words]);
    const changed = await put(person.cookie, ids.s, body({ name: "LNA5" }));
    expect([changed.status, changed.body]).toEqual([403, words]);
    expect(await counts()).toEqual(before);
  });

  it("LNA5b a ceiling without the key binds the Owner too", async () => {
    const row = and(
      eq(tenantPermissionCeiling.tenantId, floorco.id),
      eq(tenantPermissionCeiling.permissionKey, "settings.locations.manage"),
    );
    await harness.control.db.update(tenantPermissionCeiling).set({ allowed: false }).where(row);
    try {
      expect(outcome(await post(owner.cookie, body({ name: "LNA5b" })))).toEqual([403, "forbidden"]);
      expect(outcome(await put(owner.cookie, ids.s, body()))).toEqual([403, "forbidden"]);
    } finally {
      await harness.control.db.update(tenantPermissionCeiling).set({ allowed: true }).where(row);
    }
    await put(owner.cookie, ids.s, body()).expect(200);
  });

  it("LNA6 strict bodies: each refused with 400 and nothing written", async () => {
    const before = await counts();
    const cases: [string, unknown][] = [
      ["an id", { ...body({ name: "LNA6" }), id: uuidv7() }],
      ["deletedAt", { ...body({ name: "LNA6" }), deletedAt: null }],
      ["an unknown address field", body({ name: "LNA6", address: { ...ADDRESS, country: "US" } as Body["address"] })],
      ["samples as text", { ...body({ name: "LNA6" }), displaySamples: "3" }],
      ["floor area as a number", { ...body({ name: "LNA6" }), floorAreaSqFt: 3200 }],
      ["the default as text", { ...body({ name: "LNA6" }), isDefault: "true" }],
      ["no kind", { ...body({ name: "LNA6" }), kind: undefined }],
      ["a county of 101", body({ name: "LNA6", address: { ...ADDRESS, county: "c".repeat(101) } })],
      ["a street of 201", body({ name: "LNA6", address: { ...ADDRESS, street: "s".repeat(201) } })],
    ];
    for (const [label, sent] of cases) {
      const made = await post(owner.cookie, sent);
      expect(outcome(made), `POST ${label}`).toEqual([400, "invalid_request"]);
      const changed = await put(owner.cookie, ids.s, sent);
      expect(outcome(changed), `PUT ${label}`).toEqual([400, "invalid_request"]);
    }
    const long = await post(owner.cookie, body({ name: "n".repeat(801) }));
    expect([long.status, long.body.message]).toEqual([400, LOCATION_MESSAGES.nameLength]);
    expect((await put(owner.cookie, "not-a-uuid", body())).status).toBe(400);
    expect(await counts()).toEqual(before);
  });

  it("LNA7 the shared rules' words, the same as the demo's", async () => {
    const before = await counts();
    const cases: [string, Body, string][] = [
      ["blank name", body({ name: "  " }), LOCATION_MESSAGES.name],
      ["81 characters", body({ name: "n".repeat(81) }), LOCATION_MESSAGES.nameLength],
      ["kind depot", body({ kind: "depot" as Body["kind"] }), LOCATION_MESSAGES.kind],
      ["a demo branch", body({ name: "LNA7 new", branchId: "sm-br-denver" }), LOCATION_MESSAGES.branch],
      ["another company's branch", body({ name: "LNA7 new", branchId: ids.otherBranch }), LOCATION_MESSAGES.branch],
      ["ZIP 8020", body({ address: { ...ADDRESS, zip: "8020" } }), PROFILE_MESSAGES.zip],
      ["samples -1", body({ displaySamples: -1 }), LOCATION_MESSAGES.samples],
      ["a warehouse with samples", warehouse("LNA7 w", { displaySamples: 3 }), LOCATION_MESSAGES.warehouseSamples],
      ["floor area 12.", body({ floorAreaSqFt: "12." }), LOCATION_MESSAGES.floorArea],
      ["a taken name", body({ name: " main warehouse " }), LOCATION_MESSAGES.sameName("Main Warehouse")],
      ["a folded taken name", body({ name: "Main-Warehouse" }), LOCATION_MESSAGES.sameName("Main Warehouse")],
      ["a showroom default", body({ isDefault: true }), LOCATION_MESSAGES.showroomDefault],
    ];
    for (const [label, sent, message] of cases) {
      // A new location for the branch cases (an edit keeps its branch); the stored showroom for the rest.
      const response = label.includes("branch") ? await post(owner.cookie, sent) : await put(owner.cookie, ids.s, sent);
      expect([response.status, response.body], label).toEqual([400, { code: "invalid_request", message }]);
    }
    const onlyDefault = await put(owner.cookie, ids.a, warehouse("Main Warehouse", { isDefault: false }));
    expect([onlyDefault.status, onlyDefault.body.message]).toEqual([400, LOCATION_MESSAGES.oneDefault]);
    expect(await counts()).toEqual(before);
  });

  it("LNA8 add: a UUID v7 id, the area at scale, created_by, one audit entry; the answer saves back", async () => {
    const audits = (await auditsOf("Added location")).length;
    const made = await post(owner.cookie, body({ name: "North Showroom", branchId: ids.north, floorAreaSqFt: "2400" }));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const answer = made.body as Location;
    expect(answer.id).toMatch(UUID_V7);
    expect(answer).toMatchObject({ name: "North Showroom", branchId: ids.north, floorAreaSqFt: "2400.000" });
    expect((await listed()).find((location) => location.id === answer.id)).toEqual(answer);
    expect((await locationRow(answer.id))!.createdBy).toBe(await harness.userIdOf(owner.email));
    const entries = (await auditsOf("Added location")).slice(audits);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      category: "settings",
      targetType: "location",
      targetId: answer.id,
      targetLabel: "North Showroom",
      before: null,
      after: answer,
    });
    expect(QUANTITY_TEXT.test(answer.floorAreaSqFt!)).toBe(true);
    const { id, ...again } = answer;
    await put(owner.cookie, id, again).expect(200);
  });

  it("LNA9 change: a blank area is stored as none, one audit entry with before and after, the scale saves back", async () => {
    const was = (await listed()).find((location) => location.id === ids.s)!;
    const row = await locationRow(ids.s);
    const audits = (await auditsOf("Changed location")).length;
    const changed = await put(owner.cookie, ids.s, body({ name: "  Main Showroom  ", floorAreaSqFt: "" }));
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(changed.body).not.toHaveProperty("floorAreaSqFt");
    expect(changed.body.name).toBe("Main Showroom");
    const after = await locationRow(ids.s);
    expect(after!.floorAreaSqFt).toBeNull();
    expect(after!.updatedAt.getTime()).toBeGreaterThan(row!.updatedAt.getTime());
    const entries = (await auditsOf("Changed location")).slice(audits);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ targetId: ids.s, before: was, after: changed.body });
    const second = await put(owner.cookie, ids.s, body({ floorAreaSqFt: "2500" }));
    const { id, ...asRead } = second.body as Location;
    expect(asRead.floorAreaSqFt).toBe("2500.000");
    await put(owner.cookie, id, asRead).expect(200);
    await put(owner.cookie, ids.s, body()).expect(200);
  });

  it("LNA10 one default: a new default clears the old, both audited; none left is refused", async () => {
    const audits = (await auditsOf("Changed location")).length;
    await put(owner.cookie, ids.b, warehouse("North Warehouse", { branchId: ids.north, isDefault: true })).expect(200);
    expect(await defaults()).toEqual([ids.b]);
    const entries = (await auditsOf("Changed location")).slice(audits);
    expect(entries.map((entry) => entry.targetId).sort()).toEqual([ids.a, ids.b].sort());
    const cleared = entries.find((entry) => entry.targetId === ids.a)!;
    expect(cleared).toMatchObject({
      targetLabel: "Main Warehouse",
      before: { isDefault: true },
      after: { isDefault: false },
    });
    await put(owner.cookie, ids.a, warehouse("Main Warehouse")).expect(200);
    expect(await defaults()).toEqual([ids.b]);
    const refused = await put(owner.cookie, ids.b, warehouse("North Warehouse", { branchId: ids.north }));
    expect([refused.status, refused.body.message]).toEqual([400, LOCATION_MESSAGES.oneDefault]);
    await put(owner.cookie, ids.a, warehouse("Main Warehouse", { isDefault: true })).expect(200);
    expect(await defaults()).toEqual([ids.a]);
  });

  it("LNA11 the branch is fixed; a stored branch no longer live is kept", async () => {
    const refused = await put(owner.cookie, ids.s, body({ branchId: ids.north }));
    expect([refused.status, refused.body.message]).toEqual([400, LOCATION_MESSAGES.branchFixed]);
    expect((await locationRow(ids.s))!.branchId).toBe(ids.main);
    await withCompanyDb(floorco, (db) =>
      db.update(branches).set({ deletedAt: new Date() }).where(eq(branches.id, ids.main)),
    );
    try {
      await put(owner.cookie, ids.s, body()).expect(200);
    } finally {
      await withCompanyDb(floorco, (db) =>
        db.update(branches).set({ deletedAt: null }).where(eq(branches.id, ids.main)),
      );
    }
  });

  it("LNA12 a warehouse becomes a showroom only when it holds nothing; a short row holds nothing", async () => {
    // 1. Boxed stock.
    const w1 = await freshWarehouse("LNA12 boxed");
    await withCompanyDb(floorco, (db) => db.insert(stockMovements).values(opening(ids.tile, w1.id, "10")));
    await refusedAsShowroom(w1, LOCATION_MESSAGES.holdsStock("LNA12 boxed"));
    await withCompanyDb(floorco, (db) => db.insert(stockMovements).values(opening(ids.tile, w1.id, "-10")));
    await toShowroom(w1).expect(200);
    await backToWarehouse(w1);

    // 2. A roll with length left.
    const w2 = await freshWarehouse("LNA12 roll");
    const rollId = await withCompanyDb(floorco, async (db) => {
      const [roll] = await db
        .insert(rolls)
        .values({
          rollNumber: `R-${uuidv7()}`,
          productId: ids.carpet,
          dyeLot: "L1",
          widthFt: "12",
          originalLengthFt: "5",
          remainingLengthFt: "5",
          costPerSqFt: "1.4000",
          locationId: w2.id,
          bin: "A-1",
          receivedAt: new Date(),
        })
        .returning();
      return roll.id;
    });
    await refusedAsShowroom(w2, LOCATION_MESSAGES.holdsStock("LNA12 roll"));
    await withCompanyDb(floorco, (db) => db.update(rolls).set({ remainingLengthFt: "0" }).where(eq(rolls.id, rollId)));
    await toShowroom(w2).expect(200);
    await backToWarehouse(w2);

    // 3. A roll in transit from it keeps its location.
    const w3 = await freshWarehouse("LNA12 sending");
    await withCompanyDb(floorco, (db) =>
      db.update(rolls).set({ remainingLengthFt: "5", locationId: w3.id }).where(eq(rolls.id, rollId)),
    );
    const sent = await call("post", "/transfers", owner.cookie).send({
      fromId: w3.id,
      toId: ids.a,
      lines: [{ productId: ids.carpet, rollId, quantity: "5" }],
      note: "",
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    await refusedAsShowroom(w3, LOCATION_MESSAGES.holdsStock("LNA12 sending"));

    // 4. A transfer in transit to it, then the received stock.
    const w4 = await freshWarehouse("LNA12 receiving");
    const coming = await call("post", "/transfers", owner.cookie).send({
      fromId: ids.a,
      toId: w4.id,
      lines: [{ productId: ids.tile, rollId: null, quantity: "20" }],
      note: "",
    });
    expect(coming.status, JSON.stringify(coming.body)).toBe(201);
    await refusedAsShowroom(w4, LOCATION_MESSAGES.inTransit("LNA12 receiving"));
    await call("post", `/transfers/${coming.body.id}/receive`, owner.cookie).expect(201);
    await refusedAsShowroom(w4, LOCATION_MESSAGES.holdsStock("LNA12 receiving"));

    // 5. Stock held for an invoice, then released; 5b. a short row holds nothing (D22).
    const quoteId = await accepted(ids.a);
    const invoice = await call("post", `/quotes/${quoteId}/invoice`, owner.cookie);
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    const lineId = await withCompanyDb(
      floorco,
      async (db) =>
        (
          await db.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.body.id))
        )[0].id,
    );
    const w5 = await freshWarehouse("LNA12 held");
    const hold = (quantity: string, shortBy: string) =>
      withCompanyDb(floorco, async (db) => {
        const [row] = await db
          .insert(reservations)
          .values({
            invoiceId: invoice.body.id as string,
            invoiceLineId: lineId,
            productId: ids.tile,
            locationId: w5.id,
            quantity,
            shortBy,
            status: "active" as const,
          })
          .returning();
        return row.id;
      });
    const held = await hold("2", "0");
    await refusedAsShowroom(w5, LOCATION_MESSAGES.heldStock("LNA12 held"));
    expect(LOCATION_MESSAGES.heldStock("LNA12 held")).toBe(
      "LNA12 held has stock held for invoices. Issue it, or void the invoice, before making it a showroom.",
    );
    await withCompanyDb(floorco, (db) =>
      db.update(reservations).set({ status: "released" }).where(eq(reservations.id, held)),
    );
    await toShowroom(w5).expect(200);
    await backToWarehouse(w5);
    await hold("0", "5");
    await toShowroom(w5).expect(200);
    await backToWarehouse(w5);

    // 6. A draft quote fulfilled from it, then moved to another warehouse.
    const w6 = await freshWarehouse("LNA12 quoted");
    const draft = await call("post", "/quotes", owner.cookie).send(quoteBody(w6.id));
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    await refusedAsShowroom(w6, LOCATION_MESSAGES.openQuotes("LNA12 quoted"));
    await call("put", `/quotes/${draft.body.id}`, owner.cookie).send(quoteBody(ids.a)).expect(200);
    await toShowroom(w6).expect(200);
    await backToWarehouse(w6);

    // 7. A pending quote at another warehouse with one line from it.
    const w7 = await freshWarehouse("LNA12 line");
    const pending = await call("post", "/quotes", owner.cookie).send(quoteBody(ids.a, w7.id));
    expect(pending.status, JSON.stringify(pending.body)).toBe(201);
    await call("post", `/quotes/${pending.body.id}/status`, owner.cookie)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    await refusedAsShowroom(w7, LOCATION_MESSAGES.openQuotes("LNA12 line"));
  });

  it("LNA13a every save waits for the stock lock", async () => {
    let settled = false;
    const held = await withCompanyDb(floorco, (db) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('inventory:stock'))`);
        const save = put(owner.cookie, ids.s, body()).then((response) => {
          settled = true;
          return response;
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const waited = !settled;
        return { save, waited };
      }),
    );
    expect(held.waited, "the save waited for the lock").toBe(true);
    expect((await held.save).status).toBe(200);
  });

  it("LNA13b two new defaults at once: exactly one stays, and each cleared row is audited", async () => {
    const c = await freshWarehouse("LNA13 C");
    await put(owner.cookie, c.id, warehouse("LNA13 C", { isDefault: true })).expect(200);
    expect(await defaults()).toEqual([c.id]);
    const seen = new Set((await auditsOf("Changed location")).map((entry) => entry.id));
    const [first, second] = await Promise.all([
      put(owner.cookie, ids.a, warehouse("Main Warehouse", { isDefault: true })).then((response) => response),
      put(owner.cookie, ids.b, warehouse("North Warehouse", { branchId: ids.north, isDefault: true })).then(
        (response) => response,
      ),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    const left = await defaults();
    expect(left).toHaveLength(1);
    const winner = left[0];
    expect([ids.a, ids.b]).toContain(winner);
    const loser = winner === ids.a ? ids.b : ids.a;
    const flag = (value: unknown) => (value as { isDefault: boolean }).isDefault;
    const entries = (await auditsOf("Changed location"))
      .filter((entry) => !seen.has(entry.id))
      .map((entry) => [entry.targetId, flag(entry.before), flag(entry.after)].join(" "))
      .sort();
    expect(entries).toEqual(
      [`${winner} false true`, `${loser} false true`, `${loser} true false`, `${c.id} true false`].sort(),
    );
    await put(owner.cookie, ids.a, warehouse("Main Warehouse", { isDefault: true })).expect(200);
    expect(await defaults()).toEqual([ids.a]);
  });

  it("LNA14 an unknown or deleted location is 404, and nothing is made", async () => {
    const random = uuidv4();
    expect(outcome(await put(owner.cookie, random, body({ name: "LNA14" })))).toEqual([404, "not_found"]);
    expect(await locationRow(random)).toBeUndefined();
    await setLocation(ids.s, { deletedAt: new Date() });
    try {
      expect(outcome(await put(owner.cookie, ids.s, body()))).toEqual([404, "not_found"]);
    } finally {
      await setLocation(ids.s, { deletedAt: null });
    }
  });

  it("LNA15 every member of a company with core reads the saved locations", async () => {
    const north = (await listed()).find((location) => location.name === "North Showroom")!;
    for (const key of ["sales", "warehouse"])
      expect(
        (await listed(people.get(`flooring:${key}`)!.cookie)).map((location) => location.id),
        key,
      ).toContain(north.id);
    expect((await call("get", "/locations", people.get("hr:owner")!.cookie)).status).toBe(403);
  });

  it("LNA16 the server acts on a saved location: transfers and quotes take it", async () => {
    const fresh = await freshWarehouse("LNA16 new");
    await call("post", "/transfers", owner.cookie)
      .send({ fromId: ids.a, toId: fresh.id, lines: [{ productId: ids.tile, rollId: null, quantity: "20" }], note: "" })
      .expect(201);
    await call("post", "/quotes", owner.cookie).send(quoteBody(fresh.id)).expect(201);
    const made = await post(owner.cookie, body({ name: "LNA16 showroom" }));
    expect(made.status).toBe(201);
    const { id, ...showroom } = made.body as Location;
    await put(owner.cookie, id, { ...showroom, kind: "warehouse", displaySamples: 0 }).expect(200);
    await call("post", "/transfers", owner.cookie)
      .send({ fromId: ids.a, toId: id, lines: [{ productId: ids.tile, rollId: null, quantity: "20" }], note: "" })
      .expect(201);
  });

  it("LNA18 converting a quote refuses one whose warehouse is no longer a live warehouse (D21)", async () => {
    const w2 = await insertLocation("LNA18 header");
    const w3 = await insertLocation("LNA18 line");
    const status = async (quoteId: string) =>
      withCompanyDb(floorco, async (db) => (await db.select().from(quotes).where(eq(quotes.id, quoteId)))[0].status);
    const refusedConversion = async (quoteId: string) => {
      const before = await bookCounts();
      const refused = await call("post", `/quotes/${quoteId}/invoice`, owner.cookie);
      expect([refused.status, refused.body]).toEqual([400, { code: "invalid_request", message: WAREHOUSE_WORDS }]);
      expect(await bookCounts()).toEqual(before);
      expect(await status(quoteId)).toBe("accepted");
    };

    // 1. The header's warehouse became a showroom after the quote was saved.
    const header = await accepted(w2);
    await setLocation(w2, { kind: "showroom" });
    await refusedConversion(header);
    await setLocation(w2, { kind: "warehouse" });
    await call("post", `/quotes/${header}/invoice`, owner.cookie).expect(201);

    // 2. A line's warehouse became a showroom.
    const line = await accepted(ids.a, w3);
    await setLocation(w3, { kind: "showroom" });
    await refusedConversion(line);

    // 3. A line's warehouse is no longer live.
    await setLocation(w3, { kind: "warehouse", deletedAt: new Date() });
    await refusedConversion(line);
    await setLocation(w3, { deletedAt: null });
    const lines = await withCompanyDb(floorco, (db) =>
      db
        .select({ id: locations.id })
        .from(locations)
        .where(inArray(locations.id, [w2, w3])),
    );
    expect(lines).toHaveLength(2);
  });
});
