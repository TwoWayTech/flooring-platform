import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { productPermissions } from "@workspace/db";
import {
  auditLog,
  branches,
  locations,
  products,
  rolePermissions,
  roles,
  settings,
  taxJurisdictions,
  taxRules,
  userProfiles,
} from "@workspace/db/company";
import { tenantModuleOverrides, tenantPermissionCeiling, tenants } from "@workspace/db/control";
import {
  API_LOCALIZATION_TABS,
  CATEGORY_LABELS,
  CREDIT_NOTE_PREFIX,
  dec,
  DOCUMENT_MESSAGES,
  enabledModules,
  FEATURES,
  LOCALIZATION_TABS,
  overtimeRuleProblem,
  PAYROLL_MESSAGES,
  permissionsForModules,
  PRODUCT_HEADER,
  PRODUCT_ROLES,
  readableTabs,
  roleTemplate,
  rolesRequireMfa,
  SENSITIVE_FIELDS,
  SETTINGS_SCOPE_MESSAGE,
  type ApiLocalizationTab,
  type CompanySettings,
  type FeatureKey,
  type LocalizationSettings,
  type PermissionKey,
  type ProductKey,
  type SettingsAnswer,
} from "@workspace/shared";
import { and, asc, count, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAudited, permissionRequirement } from "../src/core/access/permission.decorators";
import { AuthHarness } from "./auth-harness";
import { withCaliforniaRules } from "./california-switch";
import { platformHelpers } from "./support/platform-admins";

/** Summit's fixture settings, which the test companies copy. */
const SUMMIT = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json"), "utf8"),
) as { settings: CompanySettings };
const DOCUMENTS = SUMMIT.settings.localization.documents;
const PAYROLL = SUMMIT.settings.localization.payroll;
const PART_1 = ["profile", "numbers", "payments", "expenses"] as const;
const ACTION = "Changed localization and tax";
const MISSING =
  "Settings → Localization and tax isn't set up for this company yet, so one tab can't be saved on its own.";
const WASTE = "Your role does not allow changing waste.";
type RoleKey = (typeof PRODUCT_ROLES)[ProductKey][number];

/** One company of the test: its tenant id and slug, and its product. */
interface TestCompany {
  id: string;
  slug: string;
  product: ProductKey;
}

/** A signed-in member; `secret` is set when the roles needed an authenticator app. */
interface Member {
  cookie: string;
  email: string;
  secret: string;
}

/** The localization row as stored: every tab, the tax block without its tables. */
type StoredLocalization = Omit<LocalizationSettings, "tax"> & { tax: Record<string, unknown> };

/** Every property name anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}

/** Summit's localization without its tax tables, as a company's settings row holds it. */
function summitLocalization(): StoredLocalization {
  const { tax, ...rest } = SUMMIT.settings.localization;
  const taxRest: Record<string, unknown> = { ...tax };
  delete taxRest.rules;
  delete taxRest.jurisdictions;
  return { ...rest, tax: taxRest };
}

/** Summit's documents with a change. */
function documents(patch: Record<string, unknown> = {}) {
  return { ...DOCUMENTS, ...patch };
}

/**
 * Settings part 2a on the API (ADR 0059; spec settings-and-permissions.md, Real build, "Settings on
 * the API, part 2a"): PUT /settings/localization/documents and /payroll with one key each, their
 * module, the page's switch, company-wide scope, strict bodies, the shared rules, the row lock and
 * audit naming the tab, and GET /settings answering each tab to its readers, against companies with
 * databases of their own. Every case names its id first, for the mutation runs.
 */
describe("settings part 2a on the API: Sales and documents and Payroll rules (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled, stepUp } = platformHelpers(harness);
  const floorco: TestCompany = { id: "", slug: "", product: "flooring" };
  const peopleco: TestCompany = { id: "", slug: "", product: "hr" };
  const bareco: TestCompany = { id: "", slug: "", product: "flooring" };
  const otherco: TestCompany = { id: "", slug: "", product: "flooring" };
  const docco: TestCompany = { id: "", slug: "", product: "flooring" };
  /** One member per default role of floorco and peopleco, signed in once (no step-up). */
  const people = new Map<string, Member>();
  const doc = {
    warehouse: "",
    tile: "",
    owner: {} as Member,
    accountant: {} as Member,
    sales: {} as Member,
    purchasing: {} as Member,
  };

  beforeAll(async () => {
    await harness.start();
    Object.assign(floorco, await harness.provisionCompany("floorco"));
    Object.assign(peopleco, await harness.provisionCompany("peopleco", ["hr"]));
    Object.assign(bareco, await harness.provisionCompany("bareco"));
    Object.assign(otherco, await harness.provisionCompany("otherco"));
    Object.assign(docco, await harness.provisionCompany("docco"));
    for (const company of [floorco, peopleco, docco])
      await withCompanyDb(company, (db) =>
        db.insert(settings).values({ group: "localization", value: summitLocalization() }),
      );
    const theirs = summitLocalization();
    await withCompanyDb(otherco, (db) =>
      db.insert(settings).values({
        group: "localization",
        value: { ...theirs, documents: { ...theirs.documents, quotePrefix: "OQ-" } },
      }),
    );
    for (const company of [floorco, peopleco])
      for (const key of PRODUCT_ROLES[company.product])
        people.set(`${company.product}:${key}`, await member(company, [key]));
    const branch = await withCompanyDb(docco, async (db) => {
      const [made] = await db.insert(branches).values({ name: "Denver", city: "Denver", state: "CO" }).returning();
      const address = { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" };
      const [store] = await db
        .insert(locations)
        .values({ name: "Denver warehouse", kind: "warehouse" as const, branchId: made.id, address, isDefault: true })
        .returning();
      const [product] = await db
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
      await db.insert(settings).values(PART_1.map((group) => ({ group, value: SUMMIT.settings[group] })));
      await db.insert(taxRules).values({
        state: "CO",
        jurisdiction: "Denver combined",
        ratePct: "8.81",
        taxable: { material: true, labor: false, freight: false, service: false },
        lumpSumLaborTaxable: true,
        validFrom: "2025-01-01",
        version: 1,
      });
      doc.warehouse = store.id;
      doc.tile = product.id;
      return made.id;
    });
    doc.owner = await member(docco, ["owner"]);
    doc.accountant = await member(docco, ["accountant"]);
    doc.sales = await member(docco, ["sales"]);
    doc.purchasing = await member(docco, ["purchasing"]);
    // Sales sees only their own records and works from the warehouse's branch, as sales.int.test.ts places them.
    const salesId = await harness.userIdOf(doc.sales.email);
    await withCompanyDb(docco, (db) =>
      db.update(userProfiles).set({ branchId: branch }).where(eq(userProfiles.userId, salesId)),
    );
  }, 300_000);

  afterAll(async () => {
    await harness.stop();
  });

  /** Runs `work` on a company's own database, behind the API's back. */
  async function withCompanyDb<T>(
    company: TestCompany,
    work: (db: Awaited<ReturnType<AuthHarness["companyDb"]>>["db"]) => Promise<T>,
  ): Promise<T> {
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
    if (!mfa) return { cookie: await harness.signIn(email), email, secret: "" };
    const { cookie, secret } = await enrolled(email);
    return { cookie, email, secret };
  }

  /** The stored `localization` row of a company, or undefined. */
  function rowOf(company: TestCompany): Promise<StoredLocalization | undefined> {
    return withCompanyDb(company, async (db) => {
      const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, "localization"));
      return row?.value as StoredLocalization | undefined;
    });
  }

  /** The company's zone in the control database (`tenants.time_zone`), which GET /settings answers as Region's (part 2b). */
  async function zoneOf(company: TestCompany): Promise<string> {
    const [row] = await harness.control.db
      .select({ timeZone: tenants.timeZone })
      .from(tenants)
      .where(eq(tenants.id, company.id));
    return row!.timeZone;
  }

  /** How many audit entries a company has. */
  function auditCount(company: TestCompany): Promise<number> {
    return withCompanyDb(company, async (db) => (await db.select({ n: count() }).from(auditLog))[0].n);
  }

  /** A company's audit entries with this action, oldest first. */
  function auditsOf(company: TestCompany, action: string) {
    return withCompanyDb(company, (db) =>
      db.select().from(auditLog).where(eq(auditLog.action, action)).orderBy(asc(auditLog.at)),
    );
  }

  /** How many tax rule and jurisdiction rows a company has. */
  function taxTables(company: TestCompany): Promise<[number, number]> {
    return withCompanyDb(company, async (db) => [
      (await db.select({ n: count() }).from(taxRules))[0].n,
      (await db.select({ n: count() }).from(taxJurisdictions))[0].n,
    ]);
  }

  /** `GET /settings` as `cookie`, which must answer 200. */
  async function answerOf(cookie: string): Promise<SettingsAnswer> {
    const response = await call("get", "/settings", cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as SettingsAnswer;
  }

  /** `PUT /settings/localization/<tab>` as `cookie`. */
  function put(tab: string, cookie: string, body: unknown) {
    return call("put", `/settings/localization/${tab}`, cookie).send(body as object);
  }

  /** A status and code pair, for compact refusal checks. */
  function outcome(response: { status: number; body: { code?: string } }) {
    return [response.status, response.body.code];
  }

  /** The permissions a default role holds in a fresh company of one product (as permissions.int.test.ts works them out). */
  function expectedPermissions(product: ProductKey, key: RoleKey): PermissionKey[] {
    const ceiling = new Set<PermissionKey>(productPermissions([product]));
    const enabled = new Set<PermissionKey>(permissionsForModules(enabledModules([product], null, [])));
    return roleTemplate(key).permissions.filter((permission) => ceiling.has(permission) && enabled.has(permission));
  }

  /** What a default role's PUT of a tab answers: the module first (the guard's order), then the key at scope all. */
  function expectedPut(product: ProductKey, key: RoleKey, tab: ApiLocalizationTab): [number, string | undefined] {
    const rule = LOCALIZATION_TABS[tab];
    if (!enabledModules([product], null, []).includes(rule.module)) return [403, "module_not_enabled"];
    const held = expectedPermissions(product, key);
    if (!rule.keys.some((needed) => held.includes(needed))) return [403, "forbidden"];
    return roleTemplate(key).dataScope === "all" ? [200, undefined] : [403, "forbidden"];
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

  /** A quote in docco for 100 sq ft of tile at `wastePct`, as `who`, for one of their customers. */
  function quoteOf(who: Member, customerId: string, wastePct: string) {
    return call("post", "/quotes", who.cookie).send({
      customerId,
      locationId: doc.warehouse,
      jobSite: { street: "12 Pine Rd", city: "Denver", state: "CO", zip: "80202" },
      rooms: [],
      lines: [
        {
          id: "draft-1",
          productId: doc.tile,
          description: "Slate Tile",
          category: "material",
          unit: "sq_ft",
          quantity: "100",
          unitPrice: "4.50",
          unitCost: "0",
          wastePct,
        },
      ],
      depositPct: "0",
      taxOverride: null,
      notes: "",
    });
  }

  /** A customer `who` adds in docco. */
  async function customerOf(who: Member): Promise<{ id: string; terms: string }> {
    const created = await call("post", "/customers", who.cookie).send({ name: `Cust ${uuidv7()}` });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body;
  }

  it("L0 the routes declare the shared table: one key per tab, its module, and audit", async () => {
    const { SettingsController } = await import("../src/modules/settings/settings.controller");
    const reflector = new Reflector();
    const context = (handler: string) =>
      ({
        getHandler: () => (SettingsController.prototype as unknown as Record<string, unknown>)[handler],
        getClass: () => SettingsController,
      }) as unknown as ExecutionContext;
    const handlers: Record<ApiLocalizationTab, string> = {
      documents: "saveDocuments",
      payroll: "savePayroll",
      region: "saveRegion",
      currency: "saveCurrency",
      tax: "saveTax",
    };
    // Every served tab has its handler, and every handler below is checked (part 2b adds two, part 3a one).
    expect(Object.keys(handlers).sort()).toEqual([...API_LOCALIZATION_TABS].sort());
    for (const tab of Object.keys(handlers) as ApiLocalizationTab[]) {
      const requirement = permissionRequirement(reflector, context(handlers[tab]), "PUT");
      const rule = LOCALIZATION_TABS[tab];
      expect(requirement.permissions, tab).toEqual(rule.keys);
      // A `platform` route declares no module (part 1's A0): every company has it.
      expect(requirement.module, tab).toBe(rule.module === "platform" ? undefined : rule.module);
      expect(isAudited(reflector, context(handlers[tab])), tab).toBe(true);
    }
    expect(LOCALIZATION_TABS.documents.module).toBe("core");
    expect(LOCALIZATION_TABS.payroll.module).toBe("hr");
    // Part 2b: Region and Currency are every company's.
    expect(LOCALIZATION_TABS.region.module).toBe("platform");
    expect(LOCALIZATION_TABS.currency.module).toBe("platform");
    // Part 3a: Sales tax is every company's too, with its own key.
    expect(LOCALIZATION_TABS.tax.module).toBe("platform");
    expect(LOCALIZATION_TABS.tax.keys).toEqual(["settings.tax.manage"]);
  });

  for (const company of [floorco, peopleco]) {
    for (const key of PRODUCT_ROLES[company.product]) {
      it(`L1 ${company.product} ${key}: GET /settings answers each localization tab the role reads, as stored, Region with the control zone`, async () => {
        const person = people.get(`${company.product}:${key}`)!;
        const before = await auditCount(company);
        const body = await answerOf(person.cookie);
        const held = new Set(expectedPermissions(company.product, key));
        const expected = readableTabs({ permissions: held, modules: enabledModules([company.product], null, []) });
        const stored = (await rowOf(company))!;
        // Part 2b: Region is answered with the company's control zone, never the row's copy. Part 3a:
        // Sales tax with the rules and county rates in force, none in these companies.
        const answered = {
          ...stored,
          region: { ...stored.region, timeZone: await zoneOf(company) },
          tax: { ...stored.tax, rules: [], jurisdictions: [] },
        };
        if (expected.length === 0) expect(body).not.toHaveProperty("localization");
        else {
          expect(Object.keys(body.localization ?? {}).sort()).toEqual([...expected].sort());
          for (const tab of expected) expect(body.localization?.[tab], tab).toEqual(answered[tab]);
        }
        expect(keysOf(body.localization ?? {}).filter((name) => name in SENSITIVE_FIELDS)).toEqual([]);
        expect(await auditCount(company)).toBe(before);
        const tabs = Object.keys(body.localization ?? {}).sort();
        if (company === floorco && key === "owner")
          expect(tabs).toEqual(["currency", "documents", "payroll", "region", "tax"]);
        if (company === floorco && key === "sales") expect(tabs).toEqual(["documents", "payroll", "region", "tax"]);
        if (company === floorco && (key === "installer" || key === "hr")) expect(tabs).toEqual(["payroll", "region"]);
        if (company === peopleco && key === "owner") expect(tabs).toEqual(["currency", "payroll", "region", "tax"]);
        if (company === peopleco && key === "employee") expect(tabs).toEqual(["payroll", "region"]);
      });
    }
  }

  it("L2 never saved: no localization answered, both tabs 409, and no row is made", async () => {
    const owner = await member(bareco, ["owner"]);
    expect(await answerOf(owner.cookie)).not.toHaveProperty("localization");
    const audits = await auditCount(bareco);
    for (const [tab, body] of [
      ["documents", DOCUMENTS],
      ["payroll", PAYROLL],
    ] as const) {
      const response = await put(tab, owner.cookie, body);
      expect([response.status, response.body], tab).toEqual([409, { code: "settings_missing", message: MISSING }]);
    }
    expect(await rowOf(bareco)).toBeUndefined();
    expect(await auditCount(bareco)).toBe(audits);
  });

  it("L3 PUT documents by every default role: the Owner and Accountant of a company with core; only that tab changes", async () => {
    const saved: string[] = [];
    for (const company of [floorco, peopleco]) {
      for (const key of PRODUCT_ROLES[company.product]) {
        const label = `${company.product} ${key}`;
        const body = documents({ legalFooter: `L3 ${label}` });
        const before = (await rowOf(company))!;
        const tables = await taxTables(company);
        const audits = (await auditsOf(company, ACTION)).length;
        const response = await put("documents", people.get(`${company.product}:${key}`)!.cookie, body);
        const expected = expectedPut(company.product, key, "documents");
        if (expected[0] !== 200) {
          expect(outcome(response), label).toEqual(expected);
          expect(await rowOf(company), label).toEqual(before);
          continue;
        }
        saved.push(label);
        expect(response.status, `${label} ${JSON.stringify(response.body)}`).toBe(200);
        expect(response.body).toEqual(body);
        const after = (await rowOf(company))!;
        expect(after.documents, label).toEqual(body);
        expect({ ...after, documents: null }, label).toEqual({ ...before, documents: null });
        expect(after.tax).not.toHaveProperty("rules");
        expect(after.tax).not.toHaveProperty("jurisdictions");
        expect(await taxTables(company)).toEqual(tables);
        expect((await answerOf(people.get(`${company.product}:${key}`)!.cookie)).localization?.documents).toEqual(body);
        const entries = await auditsOf(company, ACTION);
        expect(entries, "one audit entry per save").toHaveLength(audits + 1);
        const entry = entries.at(-1)!;
        expect(entry).toMatchObject({
          category: "settings",
          targetType: "settings",
          targetLabel: "Sales and documents",
        });
        expect(entry.before).toEqual(before.documents);
        expect(entry.after).toEqual(body);
      }
    }
    expect(saved).toEqual(["flooring owner", "flooring accountant"]);
    for (const key of PRODUCT_ROLES.hr)
      expect(expectedPut("hr", key, "documents"), key).toEqual([403, "module_not_enabled"]);
  });

  it("L4 strict bodies and the shared content rules, each refused with its words and nothing stored", async () => {
    const owner = people.get("flooring:owner")!;
    const before = await rowOf(floorco);
    const audits = await auditCount(floorco);
    const lvpMissing: Record<string, string> = { ...DOCUMENTS.defaultWastePct };
    delete lvpMissing.lvp;
    const cases: [object, string | null][] = [
      [documents({ unknown: "x" }), null],
      [documents({ lateFeePct: 1.5 }), null],
      [documents({ quoteExpiryDays: "30" }), null],
      [documents({ legalFooter: "x".repeat(1001) }), "Keep the legal footer to 1,000 characters."],
      [documents({ defaultTerms: "net_60" }), "Choose the default payment terms."],
      [documents({ lateFeePct: "12." }), DOCUMENT_MESSAGES.lateFeePct],
      [documents({ defaultDepositPct: "100.5" }), DOCUMENT_MESSAGES.defaultDepositPct],
      [documents({ defaultWastePct: lvpMissing }), DOCUMENT_MESSAGES.wasteCategories],
      [
        documents({ defaultWastePct: { ...DOCUMENTS.defaultWastePct, madeUp: "8" } }),
        DOCUMENT_MESSAGES.wasteCategories,
      ],
      [documents({ quoteExpiryDays: 2.5 }), DOCUMENT_MESSAGES.quoteExpiryDays],
      [documents({ balanceDueDays: -1 }), DOCUMENT_MESSAGES.balanceDueDays],
      [documents({ quotePrefix: "Q 1" }), DOCUMENT_MESSAGES.quotePrefix],
      [documents({ quotePrefix: "ABCDEFGHIJK" }), DOCUMENT_MESSAGES.quotePrefix],
      [documents({ quotePrefix: DOCUMENTS.invoicePrefix }), DOCUMENT_MESSAGES.samePrefix],
      // Review round 1: credit notes are numbered CR- in the invoices' number index, in any case.
      [documents({ invoicePrefix: CREDIT_NOTE_PREFIX }), DOCUMENT_MESSAGES.creditNotePrefix],
      [documents({ invoicePrefix: "cr-" }), DOCUMENT_MESSAGES.creditNotePrefix],
      [documents({ poPrefix: "CR-5" }), DOCUMENT_MESSAGES.creditNotePrefix],
      // Review round 1: past the body's outer lengths, the field's own words, as the demo gives them.
      [documents({ quotePrefix: "A".repeat(21) }), DOCUMENT_MESSAGES.quotePrefix],
      [documents({ invoicePrefix: "A".repeat(21) }), DOCUMENT_MESSAGES.invoicePrefix],
      [documents({ poPrefix: "A".repeat(21) }), DOCUMENT_MESSAGES.poPrefix],
      [documents({ lateFeePct: "1.50000000000000000000" }), DOCUMENT_MESSAGES.lateFeePct],
      [documents({ defaultDepositPct: "5".repeat(21) }), DOCUMENT_MESSAGES.defaultDepositPct],
      [documents({ defaultTerms: "n".repeat(21) }), DOCUMENT_MESSAGES.defaultTerms],
      [
        documents({ defaultWastePct: { ...DOCUMENTS.defaultWastePct, carpet: "1".repeat(21) } }),
        DOCUMENT_MESSAGES.waste(CATEGORY_LABELS.carpet),
      ],
      [
        documents({ defaultWastePct: { ...DOCUMENTS.defaultWastePct, madeUp: "1".repeat(21) } }),
        DOCUMENT_MESSAGES.wasteCategories,
      ],
      [documents({ legalFooter: "x".repeat(10_001) }), DOCUMENT_MESSAGES.legalFooter],
      // Review round 1: a long footer and a bad late fee name the late fee first, as the demo does.
      [documents({ lateFeePct: "12.", legalFooter: "x".repeat(1001) }), DOCUMENT_MESSAGES.lateFeePct],
    ];
    for (const [body, message] of cases) {
      const response = await put("documents", owner.cookie, body);
      expect(outcome(response), JSON.stringify(body).slice(0, 200)).toEqual([400, "invalid_request"]);
      if (message) expect(response.body.message).toBe(message);
    }
    expect(await rowOf(floorco)).toEqual(before);
    expect(await auditCount(floorco)).toBe(audits);
    const scaled = documents({ defaultDepositPct: "50.00000000" });
    const taken = await put("documents", owner.cookie, scaled);
    expect(taken.status, JSON.stringify(taken.body)).toBe(200);
    expect((await rowOf(floorco))!.documents.defaultDepositPct).toBe("50.00000000");
  });

  it("L5 the server acts on saved documents: numbering, terms, the salesperson's waste, purchase orders, prices", async () => {
    // 1. Before: the Owner's quote X, with the tile at Summit's default waste.
    const ownersCustomer = await customerOf(doc.owner);
    const first = await quoteOf(doc.owner, ownersCustomer.id, "10");
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const taxBefore = (await rowOf(docco))!.tax;

    // 2. The Accountant changes the prefixes, the terms, the balance days and the tile's default waste.
    const saved = await put(
      "documents",
      doc.accountant.cookie,
      documents({
        quotePrefix: "QZ-",
        invoicePrefix: "IZ-",
        poPrefix: "PZ-",
        defaultTerms: "net_15",
        balanceDueDays: 20,
        defaultWastePct: { ...DOCUMENTS.defaultWastePct, porcelain_tile: "13" },
      }),
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    // 3 and 4. Sales, without sales.waste.view: a new customer takes the new terms; a new line must
    // carry the new default, and the old default is now a change she may not make (STATUS B6).
    const salesCustomer = await customerOf(doc.sales);
    expect(salesCustomer.terms).toBe("net_15");
    const salesQuote = await quoteOf(doc.sales, salesCustomer.id, "13");
    expect(salesQuote.status, JSON.stringify(salesQuote.body)).toBe(201);
    expect(salesQuote.body.number).toMatch(/^QZ-/);
    expect(dec(salesQuote.body.lines[0].wastePct).eq(13)).toBe(true);
    const oldDefault = await quoteOf(doc.sales, salesCustomer.id, "10");
    expect([oldDefault.status, oldDefault.body.message]).toEqual([403, WASTE]);

    // 5. An invoice from a sent and accepted quote takes the invoice prefix.
    const quote = await quoteOf(doc.owner, ownersCustomer.id, "10");
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    await call("post", `/quotes/${quote.body.id}/status`, doc.owner.cookie)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    await call("post", `/quotes/${quote.body.id}/status`, doc.owner.cookie).send({ action: "accept" }).expect(201);
    const invoice = await call("post", `/quotes/${quote.body.id}/invoice`, doc.owner.cookie);
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    expect(invoice.body.number).toMatch(/^IZ-/);

    // 6. Purchasing's order takes the purchase order prefix.
    const supplier = await call("post", "/suppliers", doc.owner.cookie)
      .send({ name: `Supplier ${uuidv7()}`, email: "orders@example.test" })
      .expect(201);
    const order = await call("post", "/purchase-orders", doc.purchasing.cookie).send({
      supplierId: supplier.body.id,
      contactId: null,
      supplierRef: "",
      placedVia: "email",
      expectedAt: "2026-12-01",
      locationId: doc.warehouse,
      lines: [{ productId: doc.tile, description: "Slate Tile", quantity: "100", unit: "sq_ft", unitCost: "2.1000" }],
      asDraft: false,
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    expect(order.body.number).toMatch(/^PZ-/);

    // 7. Prices still compute as before: the tax block and the tax tables were untouched.
    const again = await quoteOf(doc.owner, ownersCustomer.id, "10");
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.total).toBe(first.body.total);
    const tax = (await rowOf(docco))!.tax;
    expect(tax).toEqual(taxBefore);
    expect(tax).not.toHaveProperty("rules");
    expect(tax).not.toHaveProperty("jurisdictions");
  });

  it("L6 PUT payroll by every default role, then the overtime rule and holiday state rules", async () => {
    const saved: string[] = [];
    const body = { overtimeRule: "federal", holidayState: "WY" };
    for (const company of [floorco, peopleco]) {
      for (const key of PRODUCT_ROLES[company.product]) {
        const label = `${company.product} ${key}`;
        const before = (await rowOf(company))!;
        const audits = (await auditsOf(company, ACTION)).length;
        const response = await put("payroll", people.get(`${company.product}:${key}`)!.cookie, body);
        const expected = expectedPut(company.product, key, "payroll");
        if (expected[0] !== 200) {
          expect(outcome(response), label).toEqual(expected);
          expect(await rowOf(company), label).toEqual(before);
          continue;
        }
        saved.push(label);
        expect(response.status, `${label} ${JSON.stringify(response.body)}`).toBe(200);
        const after = (await rowOf(company))!;
        expect(after.payroll).toEqual(body);
        expect({ ...after, payroll: null }, label).toEqual({ ...before, payroll: null });
        const entries = await auditsOf(company, ACTION);
        expect(entries).toHaveLength(audits + 1);
        expect(entries.at(-1)).toMatchObject({ targetLabel: "Payroll rules", before: before.payroll, after: body });
      }
    }
    expect(saved).toEqual(["flooring owner", "flooring accountant", "hr owner"]);

    const owner = people.get("flooring:owner")!;
    const california = { overtimeRule: "california", holidayState: "CO" };
    const refused = await put("payroll", owner.cookie, california);
    expect([...outcome(refused), refused.body.message]).toEqual([
      400,
      "invalid_request",
      overtimeRuleProblem("california", false),
    ]);
    await withCaliforniaRules(async () => {
      // A new overtime rule changes everyone's overtime pay, so it needs a step-up (ADR 0063); the
      // holiday calendar alone (the role walk above) needs none.
      await harness.dropStepUp(owner.cookie);
      const unconfirmed = await put("payroll", owner.cookie, california);
      expect(outcome(unconfirmed)).toEqual([403, "step_up_required"]);
      expect((await rowOf(floorco))!.payroll.overtimeRule).toBe("federal");
      await harness.grantStepUp(owner.cookie);
      const taken = await put("payroll", owner.cookie, california);
      expect(taken.status, JSON.stringify(taken.body)).toBe(200);
      expect((await rowOf(floorco))!.payroll.overtimeRule).toBe("california");
    });
    // Back to the federal rule is a change too, within the step-up just given.
    await put("payroll", owner.cookie, { overtimeRule: "federal", holidayState: "CO" }).expect(200);
    const weekly = await put("payroll", owner.cookie, { overtimeRule: "weekly", holidayState: "CO" });
    expect([...outcome(weekly), weekly.body.message]).toEqual([
      400,
      "invalid_request",
      "Choose the federal or the California overtime rule.",
    ]);
    const state = await put("payroll", owner.cookie, { overtimeRule: "federal", holidayState: "XX" });
    expect([...outcome(state), state.body.message]).toEqual([400, "invalid_request", PAYROLL_MESSAGES.holidayState]);
    expect(outcome(await put("payroll", owner.cookie, { ...PAYROLL, unknown: "x" }))).toEqual([400, "invalid_request"]);
    // Review round 1: past the outer lengths, the shared words.
    const longRule = await put("payroll", owner.cookie, { overtimeRule: "f".repeat(21), holidayState: "CO" });
    expect([...outcome(longRule), longRule.body.message]).toEqual([
      400,
      "invalid_request",
      PAYROLL_MESSAGES.overtimeRule,
    ]);
    const longState = await put("payroll", owner.cookie, { overtimeRule: "federal", holidayState: "C".repeat(21) });
    expect([...outcome(longState), longState.body.message]).toEqual([
      400,
      "invalid_request",
      PAYROLL_MESSAGES.holidayState,
    ]);
    expect((await rowOf(floorco))!.payroll).toEqual({ overtimeRule: "federal", holidayState: "CO" });
  });

  it("L7 the page's switch off: both PUTs 404, and GET still answers both tabs", async () => {
    const owner = people.get("flooring:owner")!;
    const stored = (await rowOf(floorco))!;
    await withFeatureOff("settings.localization", async () => {
      expect((await put("documents", owner.cookie, stored.documents)).status).toBe(404);
      expect((await put("payroll", owner.cookie, stored.payroll)).status).toBe(404);
      const body = await answerOf(owner.cookie);
      expect(body.localization?.documents).toEqual(stored.documents);
      expect(body.localization?.payroll).toEqual(stored.payroll);
    });
  });

  it("L8 data scope: the key below scope all is refused with the settings words, then allowed at all", async () => {
    const roleKey = "branch-localization";
    const roleId = await withCompanyDb(floorco, async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: roleKey, name: "Branch localization", dataScope: "branch" as const })
        .returning();
      await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "settings.localization.manage" });
      return role.id;
    });
    const person = await member(floorco, [roleKey], true);
    const stored = (await rowOf(floorco))!;
    const audits = await auditCount(floorco);
    for (const tab of ["documents", "payroll"] as const) {
      const refused = await put(tab, person.cookie, stored[tab]);
      expect([refused.status, refused.body], tab).toEqual([
        403,
        { code: "forbidden", message: SETTINGS_SCOPE_MESSAGE },
      ]);
    }
    expect(await rowOf(floorco)).toEqual(stored);
    expect(await auditCount(floorco)).toBe(audits);
    await withCompanyDb(floorco, (db) => db.update(roles).set({ dataScope: "all" }).where(eq(roles.id, roleId)));
    for (const tab of ["documents", "payroll"] as const) {
      const saved = await put(tab, person.cookie, stored[tab]);
      expect(saved.status, `${tab} ${JSON.stringify(saved.body)}`).toBe(200);
    }
  });

  it("L9 a module switched off below: its tab's PUT is refused and the tab left out of the read", async () => {
    const owner = people.get("flooring:owner")!;
    const stored = (await rowOf(floorco))!;
    const off = async (module: "core" | "hr", run: () => Promise<void>) => {
      await harness.control.db.insert(tenantModuleOverrides).values({ tenantId: floorco.id, module, enabled: false });
      try {
        await run();
      } finally {
        await harness.control.db.delete(tenantModuleOverrides).where(eq(tenantModuleOverrides.tenantId, floorco.id));
      }
    };
    await off("core", async () => {
      expect(outcome(await put("documents", owner.cookie, stored.documents))).toEqual([403, "module_not_enabled"]);
      const body = await answerOf(owner.cookie);
      expect(body.localization).not.toHaveProperty("documents");
      expect(body.localization?.payroll).toEqual(stored.payroll);
    });
    await off("hr", async () => {
      expect(outcome(await put("payroll", owner.cookie, stored.payroll))).toEqual([403, "module_not_enabled"]);
      expect((await answerOf(owner.cookie)).localization ?? {}).not.toHaveProperty("payroll");
    });
    expect(Object.keys((await answerOf(owner.cookie)).localization ?? {}).sort()).toEqual([
      "currency",
      "documents",
      "payroll",
      "region",
      "tax",
    ]);
  });

  it("L10 a ceiling below the role binds the Owner too, and the read still answers", async () => {
    const row = and(
      eq(tenantPermissionCeiling.tenantId, floorco.id),
      eq(tenantPermissionCeiling.permissionKey, "settings.localization.manage"),
    );
    const stored = (await rowOf(floorco))!;
    await harness.control.db.update(tenantPermissionCeiling).set({ allowed: false }).where(row);
    try {
      for (const key of ["owner", "accountant"])
        for (const tab of ["documents", "payroll"] as const)
          expect(outcome(await put(tab, people.get(`flooring:${key}`)!.cookie, stored[tab])), `${key} ${tab}`).toEqual([
            403,
            "forbidden",
          ]);
      await answerOf(people.get("flooring:owner")!.cookie);
    } finally {
      await harness.control.db.update(tenantPermissionCeiling).set({ allowed: true }).where(row);
    }
    await put("documents", people.get("flooring:owner")!.cookie, stored.documents).expect(200);
  });

  it("L11 another company's user changes only their own company, whatever the request names", async () => {
    const otherOwner = await member(otherco, ["owner"]);
    const floorBefore = await rowOf(floorco);
    const theirs = (await rowOf(otherco))!;
    await put("documents", otherOwner.cookie, { ...theirs.documents, legalFooter: "L11 other" }).expect(200);
    await put("payroll", otherOwner.cookie, { overtimeRule: "federal", holidayState: "UT" }).expect(200);
    expect((await rowOf(otherco))!.documents.legalFooter).toBe("L11 other");
    expect((await rowOf(otherco))!.payroll.holidayState).toBe("UT");
    expect(await rowOf(floorco)).toEqual(floorBefore);

    const email = await harness.addUser({ companyIds: [floorco.id, otherco.id], roles: ["owner"] });
    const both = await enrolled(email);
    await harness
      .post("/api/auth/organization/set-active")
      .set("Cookie", both.cookie)
      .send({ organizationId: floorco.id })
      .expect(200);
    const otherBefore = await rowOf(otherco);
    const named = (tab: string, body: object) =>
      call("put", `/settings/localization/${tab}?companyId=${otherco.id}&tenantId=${otherco.id}`, both.cookie)
        .set("X-Company-Id", otherco.id)
        .set("X-Tenant-Id", otherco.id)
        .send(body);
    await named("documents", { ...floorBefore!.documents, legalFooter: "L11 floor" }).expect(200);
    await named("payroll", { overtimeRule: "federal", holidayState: "NM" }).expect(200);
    expect((await rowOf(floorco))!.documents.legalFooter).toBe("L11 floor");
    expect((await rowOf(floorco))!.payroll.holidayState).toBe("NM");
    expect(await rowOf(otherco)).toEqual(otherBefore);
    expect((await answerOf(both.cookie)).localization?.documents?.legalFooter).toBe("L11 floor");
    const theirAnswer = (await answerOf(otherOwner.cookie)).localization;
    expect(theirAnswer?.documents?.quotePrefix).toBe("OQ-");
    expect(theirAnswer?.payroll?.holidayState).toBe("UT");
  });

  it("L12 refusals on both PUTs: a disabled member, an Owner without a factor, the wrong product", async () => {
    const stored = (await rowOf(floorco))!;
    const disabled = await member(floorco, ["owner"]);
    const userId = await harness.userIdOf(disabled.email);
    await withCompanyDb(floorco, (db) =>
      db.update(userProfiles).set({ status: "disabled" }).where(eq(userProfiles.userId, userId)),
    );
    const noFactor = await member(floorco, ["owner"], false);
    const owner = people.get("flooring:owner")!;
    for (const tab of ["documents", "payroll"] as const) {
      expect(outcome(await put(tab, disabled.cookie, stored[tab])), tab).toEqual([403, "forbidden"]);
      expect(outcome(await put(tab, noFactor.cookie, stored[tab])), tab).toEqual([403, "mfa_enrolment_required"]);
      const wrongHost = await call("put", `/settings/localization/${tab}`, owner.cookie)
        .set(PRODUCT_HEADER, "hr")
        .send(stored[tab]);
      expect(outcome(wrongHost), tab).toEqual([403, "product_not_enabled"]);
    }
    expect(await rowOf(floorco)).toEqual(stored);
  });

  it("L13 two tabs saved at once: the row lock keeps both changes, each audited", async () => {
    const owner = people.get("flooring:owner")!;
    await put("payroll", owner.cookie, { overtimeRule: "federal", holidayState: "CO" }).expect(200);
    const stored = (await rowOf(floorco))!;
    const footer = `L13 ${uuidv7()}`;
    const audits = (await auditsOf(floorco, ACTION)).length;
    // Hold the row while both saves start, so both reach their read of it before either writes:
    // without the save's own row lock, both would read the same row and the later write would drop
    // the other tab's change.
    const saves = await withCompanyDb(floorco, (db) =>
      db.transaction(async (tx) => {
        await tx.select({ id: settings.id }).from(settings).where(eq(settings.group, "localization")).for("update");
        const both = Promise.all([
          put("documents", owner.cookie, { ...stored.documents, legalFooter: footer }).then((response) => response),
          put("payroll", owner.cookie, { overtimeRule: "federal", holidayState: "WY" }).then((response) => response),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 750));
        return { both };
      }),
    );
    const [documentsSave, payrollSave] = await saves.both;
    expect([documentsSave.status, payrollSave.status]).toEqual([200, 200]);
    const after = (await rowOf(floorco))!;
    expect(after.documents.legalFooter).toBe(footer);
    expect(after.payroll.holidayState).toBe("WY");
    expect(
      (await auditsOf(floorco, ACTION))
        .slice(audits)
        .map((entry) => entry.targetLabel)
        .sort(),
    ).toEqual(["Payroll rules", "Sales and documents"]);
  });

  it("L14 one key per tab, never the section's any-of: settings.tax.manage alone saves none of the served tabs", async () => {
    const roleKey = "tax-only";
    await withCompanyDb(floorco, async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: roleKey, name: "Tax only", dataScope: "all" as const })
        .returning();
      await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "settings.tax.manage" });
    });
    const person = await member(floorco, [roleKey], true);
    const stored = (await rowOf(floorco))!;
    // Part 2b's tabs too: the guard refuses Currency before any step-up.
    for (const tab of ["documents", "payroll", "region", "currency"] as const)
      expect(outcome(await put(tab, person.cookie, stored[tab])), tab).toEqual([403, "forbidden"]);
    expect(await rowOf(floorco)).toEqual(stored);
  });

  it("L16 the whole section is not a route", async () => {
    const owner = people.get("flooring:owner")!;
    await stepUp(owner);
    const stored = (await rowOf(floorco))!;
    const audits = await auditCount(floorco);
    expect((await call("put", "/settings/localization", owner.cookie).send(stored)).status).toBe(404);
    expect(await rowOf(floorco)).toEqual(stored);
    expect(await auditCount(floorco)).toBe(audits);
  });
});
