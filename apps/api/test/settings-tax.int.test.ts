import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { productPermissions } from "@workspace/db";
import {
  auditLog,
  branches,
  invoices,
  locations,
  products,
  rolePermissions,
  roles,
  settings,
  taxJurisdictions,
  taxRules,
  userProfiles,
} from "@workspace/db/company";
import { tenantPermissionCeiling, tenants } from "@workspace/db/control";
import {
  addDays,
  enabledModules,
  FEATURES,
  LOCALIZATION_TABS,
  permissionsForModules,
  PRODUCT_HEADER,
  PRODUCT_ROLES,
  readableTabs,
  roleTemplate,
  rolesRequireMfa,
  SENSITIVE_FIELDS,
  SETTINGS_SCOPE_MESSAGE,
  TAX_MESSAGES,
  US_STATES,
  type CompanySettings,
  type FeatureKey,
  type Invoice,
  type LocalizationSettings,
  type PermissionKey,
  type ProductKey,
  type Quote,
  type SettingsAnswer,
} from "@workspace/shared";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAudited, permissionRequirement } from "../src/core/access/permission.decorators";
import { dayIn } from "../src/modules/sales/sales-common";
import { AuthHarness } from "./auth-harness";
import { platformHelpers } from "./support/platform-admins";

/** Summit's fixture settings, which the test companies copy. */
const SUMMIT = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json"), "utf8"),
) as { settings: CompanySettings };
type Tax = LocalizationSettings["tax"];
type Rule = Tax["rules"][number];
type County = Tax["jurisdictions"][number];
/** Summit's Sales tax tab as DemoStore and the page's Reset send it: six rules and three county rates. */
const SUMMIT_TAX: Tax = SUMMIT.settings.localization.tax;
/** Summit's tax block as the `localization` row stores it: the tab without its tables. */
const SUMMIT_TAX_BLOCK = {
  pricesInclude: SUMMIT_TAX.pricesInclude,
  rounding: SUMMIT_TAX.rounding,
  companyDefault: SUMMIT_TAX.companyDefault,
  filing: SUMMIT_TAX.filing,
  certificateTypes: SUMMIT_TAX.certificateTypes,
};
const PART_1 = ["profile", "numbers", "payments", "expenses"] as const;
const ACTION = "Changed localization and tax";
const MISSING =
  "Settings → Localization and tax isn't set up for this company yet, so one tab can't be saved on its own.";
const MATERIAL_ONLY = { material: true, labor: false, freight: false, service: false };
type RoleKey = (typeof PRODUCT_ROLES)[ProductKey][number];

/** One company of the test: its tenant id and slug, and its product. */
interface TestCompany {
  id: string;
  slug: string;
  product: ProductKey;
}

/** A signed-in member; `secret` is set when the member enrolled an authenticator app. */
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

/** Today in the harness companies' zone (America/Chicago, auth-harness.ts), the day the API dates by. */
function companyDay(): string {
  return dayIn(new Date(), "America/Chicago");
}

/**
 * The last day of a row a save ends: the day before the save's. Worked out here, not with the shared
 * `closesOn`, so a wrong `closesOn` fails these cases (ADR 0059, part 3a, D3).
 */
function dayBefore(day: string): string {
  return addDays(day, -1);
}

/** Summit's rule for a state. */
function summitRule(state: string): Rule {
  return SUMMIT_TAX.rules.find((rule) => rule.state === state)!;
}

/** A tab with one state's rule changed. */
function withRule(tax: Tax, state: string, patch: Partial<Record<keyof Rule, unknown>>): Tax {
  return { ...tax, rules: tax.rules.map((rule) => (rule.state === state ? ({ ...rule, ...patch } as Rule) : rule)) };
}

/** A tab with one county rate (by county) changed. */
function withCounty(tax: Tax, name: string, patch: Partial<Record<keyof County, unknown>>): Tax {
  return {
    ...tax,
    jurisdictions: tax.jurisdictions.map((rate) => (rate.county === name ? ({ ...rate, ...patch } as County) : rate)),
  };
}

/** Whether two decimal strings hold the same number ("8.5" and "8.50000000"). */
function sameNumber(a: string | undefined, b: string): boolean {
  return a !== undefined && Number(a) === Number(b);
}

/**
 * Settings part 3a on the API (ADR 0059; spec settings-and-permissions.md, Real build, "Settings on
 * the API, part 3a"): PUT /settings/localization/tax with `settings.tax.manage`, the page's switch,
 * company-wide scope, a strict body, the shared rules judged against the locked row, always a
 * step-up after them, versioned rule and county-rate rows (a change ends every live row reaching
 * the company's day and starts a new one that day), audit naming the tab, and GET /settings
 * answering the tab in force to quote viewers and tax managers, against companies with databases of
 * their own. Every case names its id first, for the mutation runs. Rows are set up and put back with
 * direct writes, never through the API (part 2b, B5).
 */
describe("settings part 3a on the API: Sales tax with versioned rules (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled, stepUp } = platformHelpers(harness);
  const floorco: TestCompany = { id: "", slug: "", product: "flooring" };
  const peopleco: TestCompany = { id: "", slug: "", product: "hr" };
  const bareco: TestCompany = { id: "", slug: "", product: "flooring" };
  const otherco: TestCompany = { id: "", slug: "", product: "flooring" };
  const taxco: TestCompany = { id: "", slug: "", product: "flooring" };
  const verco: TestCompany = { id: "", slug: "", product: "flooring" };
  const zoneco: TestCompany = { id: "", slug: "", product: "flooring" };
  /** One member per default role of floorco and peopleco, signed in once. Cases that need "no step-up yet" use a fresh `member(…)`. */
  const people = new Map<string, Member>();
  const tax = {
    branch: "",
    warehouse: "",
    tile: "",
    owner: {} as Member,
    accountant: {} as Member,
    sales: {} as Member,
    customer: "",
  };
  let verOwner: Member;
  let zoneOwner: Member;
  let otherOwner: Member;

  beforeAll(async () => {
    await harness.start();
    Object.assign(floorco, await harness.provisionCompany("floorco"));
    Object.assign(peopleco, await harness.provisionCompany("peopleco", ["hr"]));
    Object.assign(bareco, await harness.provisionCompany("bareco"));
    Object.assign(otherco, await harness.provisionCompany("otherco"));
    Object.assign(taxco, await harness.provisionCompany("taxco"));
    Object.assign(verco, await harness.provisionCompany("verco"));
    Object.assign(zoneco, await harness.provisionCompany("zoneco"));
    for (const company of [floorco, peopleco, otherco, taxco, verco, zoneco])
      await setRow(company, summitLocalization());
    await withCompanyDb(otherco, async (db) => {
      await db.insert(taxRules).values({ ...ruleRow(summitRule("CO")), ratePct: "6.0" });
      await db.insert(taxJurisdictions).values({
        state: "CO",
        county: "Adams",
        name: "Adams County combined",
        ratePct: "5.0",
        validFrom: "2025-01-01",
      });
    });
    await withCompanyDb(verco, async (db) => {
      await db.insert(taxRules).values(SUMMIT_TAX.rules.map(ruleRow));
      await db.insert(taxJurisdictions).values(
        SUMMIT_TAX.jurisdictions.map((rate) => ({
          state: rate.state,
          county: rate.county,
          name: rate.name,
          ratePct: rate.ratePct,
          validFrom: rate.validFrom,
          validTo: rate.validTo,
        })),
      );
    });
    await withCompanyDb(zoneco, (db) => db.insert(taxRules).values(ruleRow(summitRule("CO"))));
    await withCompanyDb(taxco, async (db) => {
      const [branch] = await db.insert(branches).values({ name: "Denver", city: "Denver", state: "CO" }).returning();
      const address = { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" };
      const [store] = await db
        .insert(locations)
        .values({ name: "Denver warehouse", kind: "warehouse" as const, branchId: branch.id, address, isDefault: true })
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
      await db.insert(taxRules).values([ruleRow(summitRule("CO")), ruleRow(summitRule("PA"))]);
      await db.insert(taxJurisdictions).values({
        state: "CO",
        county: "El Paso",
        name: "Colorado Springs combined",
        ratePct: "8.25",
        validFrom: "2025-01-01",
      });
      tax.branch = branch.id;
      tax.warehouse = store.id;
      tax.tile = product.id;
    });
    for (const company of [floorco, peopleco])
      for (const key of PRODUCT_ROLES[company.product])
        people.set(`${company.product}:${key}`, await member(company, [key]));
    tax.owner = await member(taxco, ["owner"]);
    tax.accountant = await member(taxco, ["accountant"]);
    tax.sales = await member(taxco, ["sales"]);
    const salesId = await harness.userIdOf(tax.sales.email);
    await withCompanyDb(taxco, (db) =>
      db.update(userProfiles).set({ branchId: tax.branch }).where(eq(userProfiles.userId, salesId)),
    );
    const customer = await call("post", "/customers", tax.owner.cookie).send({ name: `Cust ${uuidv7()}` });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    tax.customer = (customer.body as { id: string }).id;
    verOwner = await member(verco, ["owner"]);
    zoneOwner = await member(zoneco, ["owner"]);
    otherOwner = await member(otherco, ["owner"]);
  }, 300_000);

  afterAll(async () => {
    await harness.stop();
  });

  /** A rule as its table row takes it, version and dates included. */
  function ruleRow(rule: Rule) {
    return {
      state: rule.state,
      jurisdiction: rule.jurisdiction,
      ratePct: rule.ratePct,
      taxable: rule.taxable,
      lumpSumLaborTaxable: rule.lumpSumLaborTaxable,
      validFrom: rule.validFrom,
      validTo: rule.validTo ?? null,
      version: rule.version,
      rationale: rule.rationale,
    };
  }

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

  /** Writes a company's `localization` row behind the API's back: setup, or putting a case's changes back. */
  async function setRow(company: TestCompany, value: unknown): Promise<void> {
    await withCompanyDb(company, async (db) => {
      const updated = await db
        .update(settings)
        .set({ value })
        .where(eq(settings.group, "localization"))
        .returning({ id: settings.id });
      if (updated.length === 0) await db.insert(settings).values({ group: "localization", value });
    });
  }

  /** A signed-in member holding `roles` in `company`, enrolled in MFA when the roles need it (or `mfa` says so). */
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

  /** Every `tax_rules` row of a company, soft-deleted too, by state and version. */
  function ruleRows(company: TestCompany) {
    return withCompanyDb(company, (db) =>
      db.select().from(taxRules).orderBy(asc(taxRules.state), asc(taxRules.version)),
    );
  }

  /** Every `tax_jurisdictions` row of a company, by state, county, start and id (uuid v7, so the order made). */
  function countyRows(company: TestCompany) {
    return withCompanyDb(company, (db) =>
      db
        .select()
        .from(taxJurisdictions)
        .orderBy(
          asc(taxJurisdictions.state),
          asc(taxJurisdictions.county),
          asc(taxJurisdictions.validFrom),
          asc(taxJurisdictions.id),
        ),
    );
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

  /** `GET /settings` as `cookie`, which must answer 200. */
  async function answerOf(cookie: string): Promise<SettingsAnswer> {
    const response = await call("get", "/settings", cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as SettingsAnswer;
  }

  /** The Sales tax tab `GET /settings` answers `cookie`, which must hold it. */
  async function taxOf(cookie: string): Promise<Tax> {
    const answer = (await answerOf(cookie)).localization as { tax?: Tax } | undefined;
    expect(answer, "GET /settings answers localization.tax").toHaveProperty("tax");
    return answer!.tax!;
  }

  /** `PUT /settings/localization/tax` as `cookie`. */
  function put(cookie: string, body: unknown) {
    return call("put", "/settings/localization/tax", cookie).send(body as object);
  }

  /** A status and code pair, for compact refusal checks. */
  function outcome(response: { status: number; body: { code?: string } }) {
    return [response.status, response.body.code];
  }

  /** A status, code and message, for refusals with words. */
  function refusal(response: { status: number; body: { code?: string; message?: string } }) {
    return [response.status, response.body.code, response.body.message];
  }

  /** The permissions a default role holds in a fresh company of one product (as permissions.int.test.ts works them out). */
  function expectedPermissions(product: ProductKey, key: RoleKey): PermissionKey[] {
    const ceiling = new Set<PermissionKey>(productPermissions([product]));
    const enabled = new Set<PermissionKey>(permissionsForModules(enabledModules([product], null, [])));
    return roleTemplate(key).permissions.filter((permission) => ceiling.has(permission) && enabled.has(permission));
  }

  /** What a default role's PUT of Sales tax answers: the key at scope all (`platform`, so never the module). */
  function expectedPut(product: ProductKey, key: RoleKey): [number, string | undefined] {
    if (!expectedPermissions(product, key).includes("settings.tax.manage")) return [403, "forbidden"];
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

  /** Moves a company's control zone behind the API's back for one run, as meetings.int.test.ts does, and puts it back. */
  async function withZone(company: TestCompany, zone: string, run: () => Promise<void>): Promise<void> {
    const [row] = await harness.control.db
      .select({ timeZone: tenants.timeZone })
      .from(tenants)
      .where(eq(tenants.id, company.id));
    await harness.control.db.update(tenants).set({ timeZone: zone }).where(eq(tenants.id, company.id));
    try {
      await run();
    } finally {
      await harness.control.db.update(tenants).set({ timeZone: row!.timeZone }).where(eq(tenants.id, company.id));
    }
  }

  /** A quote body in taxco for 100 sq ft of tile at 4.50 (subtotal 450.00), its job site in `state` (and `county`). */
  function quoteBody(state: "WY" | "CO", county?: string) {
    const jobSite =
      state === "WY"
        ? { street: "1 Elk St", city: "Cheyenne", state: "WY", zip: "82001" }
        : { street: "12 Pine Rd", city: "Denver", state: "CO", zip: "80202", ...(county ? { county } : {}) };
    return {
      customerId: tax.customer,
      locationId: tax.warehouse,
      jobSite,
      rooms: [],
      lines: [
        {
          id: "draft-1",
          productId: tax.tile,
          description: "Slate Tile",
          category: "material",
          unit: "sq_ft",
          quantity: "100",
          unitPrice: "4.50",
          unitCost: "0",
          wastePct: "0",
        },
      ],
      depositPct: "0",
      taxOverride: null,
      notes: "",
    };
  }

  /** A new taxco quote by the Owner; answers it. */
  async function quote(state: "WY" | "CO", county?: string): Promise<Quote> {
    const response = await call("post", "/quotes", tax.owner.cookie).send(quoteBody(state, county));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Quote;
  }

  /** Sends and accepts a quote. */
  async function accept(id: string): Promise<void> {
    await call("post", `/quotes/${id}/status`, tax.owner.cookie)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    await call("post", `/quotes/${id}/status`, tax.owner.cookie).send({ action: "accept" }).expect(201);
  }

  /** Converts an accepted quote; answers the invoice. */
  async function convert(id: string): Promise<Invoice> {
    const response = await call("post", `/quotes/${id}/invoice`, tax.owner.cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Invoice;
  }

  /** A taxco quote's stored total, from `GET /quotes`. */
  async function storedTotal(id: string): Promise<string> {
    const list = (await call("get", "/quotes", tax.owner.cookie).expect(200)).body as Quote[];
    return list.find((each) => each.id === id)!.total;
  }

  /** A taxco invoice from `GET /invoices`. */
  async function invoiceOf(id: string): Promise<Invoice> {
    const list = (await call("get", "/invoices", tax.owner.cookie).expect(200)).body as Invoice[];
    const found = list.find((each) => each.id === id);
    expect(found, `invoice ${id}`).toBeDefined();
    return found!;
  }

  /** What an issued invoice keeps of its tax. */
  function taxKept(invoice: Invoice) {
    const { subtotal, tax: amount, total, taxRule, taxSource, issuedAt } = invoice;
    return { subtotal, tax: amount, total, taxRule, taxSource, issuedAt };
  }

  /** An active customer contract in taxco (10 % retainage, one 1000.00 material line); answers its id and line. */
  async function customerContract(): Promise<{ id: string; line: string }> {
    const made = await call("post", "/contracts", tax.owner.cookie).send({
      direction: "customer",
      kind: "project",
      customerId: tax.customer,
      supplierId: null,
      title: "Part 3a lobby",
      scope: "Tile",
      branchId: tax.branch,
      locationId: tax.warehouse,
      jobSite: { street: "1 Main", city: "Denver", state: "CO", zip: "80202" },
      startsAt: "2026-11-01",
      endsAt: "2027-02-01",
      renewal: { mode: "none", noticeDays: 30 },
      retainagePct: "10",
      storedRetainagePct: "10",
      bondInLieu: false,
      taxTreatment: "on_billing",
      notes: "",
      lines: [
        {
          code: "A1",
          description: "Tile",
          category: "material",
          billing: "percent",
          scheduledValue: "1000.00",
          retainagePct: null,
          storedRetainagePct: null,
          milestoneDueAt: null,
          estimatedCost: "600.00",
        },
      ],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = (made.body as { id: string }).id;
    await call("post", `/contracts/${id}/send`, tax.owner.cookie).expect(201);
    await call("post", `/contracts/${id}/sign`, tax.owner.cookie)
      .send({ signerName: "Alex Crew", signerRole: "Owner" })
      .expect(201);
    const lines = (await call("get", "/contract-lines", tax.owner.cookie).expect(200)).body as {
      id: string;
      contractId: string;
    }[];
    return { id, line: lines.find((line) => line.contractId === id)!.id };
  }

  /** Bills a contract line to `completedToDate`; answers the billing's invoice id. */
  async function bill(contractId: string, line: string, completedToDate: string): Promise<string> {
    const response = await call("post", `/contracts/${contractId}/billings`, tax.owner.cookie).send({
      periodEnd: companyDay(),
      lines: [{ contractLineId: line, completedToDate, storedBalance: "0.00" }],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as { invoiceId: string }).invoiceId;
  }

  it("ST0 the route declares the shared table: settings.tax.manage, no module (platform), audited", async () => {
    const { SettingsController } = await import("../src/modules/settings/settings.controller");
    const reflector = new Reflector();
    const context = {
      getHandler: () => (SettingsController.prototype as unknown as Record<string, unknown>).saveTax,
      getClass: () => SettingsController,
    } as unknown as ExecutionContext;
    expect(typeof context.getHandler()).toBe("function");
    const requirement = permissionRequirement(reflector, context, "PUT");
    expect(requirement.permissions).toEqual(LOCALIZATION_TABS.tax.keys);
    expect(requirement.permissions).toEqual(["settings.tax.manage"]);
    expect(LOCALIZATION_TABS.tax.module).toBe("platform");
    expect(requirement.module).toBeUndefined();
    expect(isAudited(reflector, context)).toBe(true);
  });

  for (const company of [floorco, peopleco]) {
    for (const key of PRODUCT_ROLES[company.product]) {
      it(`ST1 ${company.product} ${key}: GET /settings answers Sales tax in force to quote viewers and tax managers`, async () => {
        const person = people.get(`${company.product}:${key}`)!;
        const before = await auditCount(company);
        const body = await answerOf(person.cookie);
        const held = new Set(expectedPermissions(company.product, key));
        const expected = readableTabs({ permissions: held, modules: enabledModules([company.product], null, []) });
        expect(Object.keys(body.localization ?? {}).sort()).toEqual([...expected].sort());
        const readers = company === floorco ? ["owner", "accountant", "manager", "sales"] : ["owner"];
        expect(expected.includes("tax"), `${key} reads tax`).toBe(readers.includes(key));
        const answered = (body.localization ?? {}) as { tax?: Tax };
        if (readers.includes(key)) expect(answered.tax).toEqual({ ...SUMMIT_TAX_BLOCK, rules: [], jurisdictions: [] });
        else expect(answered).not.toHaveProperty("tax");
        expect(keysOf(body.localization ?? {}).filter((name) => name in SENSITIVE_FIELDS)).toEqual([]);
        expect(await auditCount(company)).toBe(before);
      });
    }
  }

  it("ST1 taxco: a salesperson reads the rules and county rates in force, sorted, rates at the columns' scale", async () => {
    const before = await auditCount(taxco);
    const answered = await taxOf(tax.sales.cookie);
    expect(answered.rules.map((rule) => [rule.state, rule.version, rule.ratePct])).toEqual([
      ["CO", 1, "8.81000000"],
      ["PA", 1, "6.00000000"],
    ]);
    expect(answered.jurisdictions.map((rate) => [rate.state, rate.county, rate.ratePct])).toEqual([
      ["CO", "El Paso", "8.25000000"],
    ]);
    expect(answered.companyDefault).toEqual(SUMMIT_TAX.companyDefault);
    expect(keysOf(answered).filter((name) => name in SENSITIVE_FIELDS)).toEqual([]);
    expect(await auditCount(taxco)).toBe(before);
  });

  it("ST2 never saved, and a row without the tax block: 409 under the lock, before any step-up; nothing written", async () => {
    const owner = await member(bareco, ["owner"]);
    await stepUp(owner);
    expect(await answerOf(owner.cookie)).not.toHaveProperty("localization");
    const body = { ...SUMMIT_TAX_BLOCK, rules: [], jurisdictions: [] };
    const audits = await auditCount(bareco);
    const response = await put(owner.cookie, body);
    expect([response.status, response.body]).toEqual([409, { code: "settings_missing", message: MISSING }]);
    expect(await rowOf(bareco)).toBeUndefined();
    expect([await ruleRows(bareco), await countyRows(bareco)]).toEqual([[], []]);
    expect(await auditCount(bareco)).toBe(audits);

    const withoutTax: Partial<StoredLocalization> = summitLocalization();
    delete withoutTax.tax;
    await setRow(bareco, withoutTax);
    try {
      const fresh = await member(bareco, ["owner"]);
      const read = await answerOf(fresh.cookie);
      expect(read.localization).toHaveProperty("region");
      expect(read.localization ?? {}).not.toHaveProperty("tax");
      expect(outcome(await put(fresh.cookie, body))).toEqual([409, "settings_missing"]);
      expect(await rowOf(bareco)).toEqual(withoutTax);
      expect([await ruleRows(bareco), await countyRows(bareco)]).toEqual([[], []]);
      expect(await auditCount(bareco)).toBe(audits);
    } finally {
      await withCompanyDb(bareco, (db) => db.delete(settings).where(eq(settings.group, "localization")));
    }
  });

  it("ST3 PUT Sales tax by every default role of both products: the tax managers after a step-up; one row per change", async () => {
    const saved: string[] = [];
    const texas = summitRule("TX");
    const body = { ...SUMMIT_TAX_BLOCK, rules: [texas], jurisdictions: [] };
    for (const company of [floorco, peopleco]) {
      for (const key of PRODUCT_ROLES[company.product]) {
        const label = `${company.product} ${key}`;
        const person = people.get(`${company.product}:${key}`)!;
        const rows = await ruleRows(company);
        const audits = (await auditsOf(company, ACTION)).length;
        const expected = expectedPut(company.product, key);
        if (expected[0] !== 200) {
          expect(outcome(await put(person.cookie, body)), label).toEqual(expected);
          expect(await ruleRows(company), label).toEqual(rows);
          expect((await auditsOf(company, ACTION)).length, label).toBe(audits);
          continue;
        }
        await stepUp(person);
        const before = await taxOf(person.cookie);
        const response = await put(person.cookie, body);
        expect(response.status, `${label} ${JSON.stringify(response.body)}`).toBe(200);
        saved.push(label);
        const day = companyDay();
        const texasRows = (await ruleRows(company)).filter((row) => row.state === "TX");
        expect(
          texasRows.map((row) => [row.version, row.validFrom, row.validTo]),
          label,
        ).toEqual([[1, day, null]]);
        expect(response.body, label).toEqual(await taxOf(person.cookie));
        const entries = await auditsOf(company, ACTION);
        expect(entries.length, label).toBe(audits + 1);
        const entry = entries.at(-1)!;
        expect(entry.targetLabel, label).toBe("Sales tax");
        expect(entry.before, label).toEqual(before);
        expect(entry.after, label).toEqual(response.body);
      }
    }
    expect(saved).toEqual(["flooring owner", "flooring accountant", "hr owner"]);
    // The Accountant's identical save changed nothing by value: floorco still has one Texas row.
    expect((await ruleRows(floorco)).filter((row) => row.state === "TX")).toHaveLength(1);
    expect((await ruleRows(peopleco)).filter((row) => row.state === "TX")).toHaveLength(1);
  });

  it("ST4 strict bodies, then the shared rules with their words, each refused with nothing written; content before the code", async () => {
    await stepUp(tax.owner);
    const current = await taxOf(tax.owner.cookie);
    const rows = [await ruleRows(taxco), await countyRows(taxco)];
    const row = await rowOf(taxco);
    const audits = await auditCount(taxco);
    const co = current.rules.find((rule) => rule.state === "CO")!;
    const withoutFiling: Record<string, unknown> = { ...current };
    delete withoutFiling.filing;
    const service = { ...co.taxable } as Record<string, boolean>;
    delete service.service;
    const strict: [string, unknown][] = [
      ["an unknown field", { ...current, extra: true }],
      ["an unknown rule field", { ...current, rules: [{ ...co, note: "x" }] }],
      ["a rate as a number", withRule(current, "CO", { ratePct: 8.31 })],
      ["taxable without service", withRule(current, "CO", { taxable: service })],
      ["a version as text", withRule(current, "CO", { version: "1" })],
      ["rules as an object", { ...current, rules: { CO: co } }],
      ["no filing", withoutFiling],
    ];
    for (const [name, body] of strict)
      expect(outcome(await put(tax.owner.cookie, body)), name).toEqual([400, "invalid_request"]);

    const adams = { ...current.jurisdictions[0]!, id: "jur-a", county: "Adams", name: "Adams combined", ratePct: "7" };
    const many = US_STATES.map(([state]) => ({ ...co, state }));
    const worded: [unknown, string][] = [
      [{ ...current, pricesInclude: "inclusive" }, TAX_MESSAGES.pricesInclude],
      [{ ...current, rounding: "nearest" }, TAX_MESSAGES.rounding],
      [{ ...current, filing: [{ state: "CO", frequency: "annual" }] }, TAX_MESSAGES.notHere],
      [{ ...current, certificateTypes: [] }, TAX_MESSAGES.notHere],
      [withRule(current, "CO", { state: "XX" }), TAX_MESSAGES.ruleState],
      [{ ...current, rules: [...current.rules, co] }, TAX_MESSAGES.stateOnce("CO")],
      [withRule(current, "CO", { jurisdiction: "" }), TAX_MESSAGES.jurisdiction("CO")],
      // No outer length where the words name the state: the rule's words, never Zod's (D32).
      [withRule(current, "CO", { jurisdiction: "x".repeat(2000) }), TAX_MESSAGES.jurisdiction("CO")],
      // The county's outer bound carries the same words as the rule.
      [withCounty(current, "El Paso", { county: "x".repeat(2000) }), TAX_MESSAGES.county],
      [withRule(current, "CO", { ratePct: "8.123456" }), TAX_MESSAGES.rulePercent("CO")],
      [withCounty(current, "El Paso", { county: "" }), TAX_MESSAGES.county],
      [
        {
          ...current,
          jurisdictions: [...current.jurisdictions, adams, { ...adams, id: "jur-b", county: "adams county" }],
        },
        TAX_MESSAGES.sameCounty("adams county", "CO"),
      ],
      [{ ...current, companyDefault: { ...current.companyDefault!, ratePct: "4.00001" } }, TAX_MESSAGES.companyDefault],
      [{ ...current, rules: [...many, co] }, TAX_MESSAGES.rules],
    ];
    for (const [body, message] of worded)
      expect(refusal(await put(tax.owner.cookie, body)), message).toEqual([400, "invalid_request", message]);

    // Content first: an Owner who never stepped up gets the rule's words, never step_up_required.
    const fresh = await member(taxco, ["owner"]);
    expect(refusal(await put(fresh.cookie, withRule(current, "CO", { ratePct: "8.123456" })))).toEqual([
      400,
      "invalid_request",
      TAX_MESSAGES.rulePercent("CO"),
    ]);
    expect([await ruleRows(taxco), await countyRows(taxco)]).toEqual(rows);
    expect(await rowOf(taxco)).toEqual(row);
    expect(await auditCount(taxco)).toBe(audits);
  });

  it("ST5a the fixture's tab, as Reset sends it, changes nothing; nor does a second save with a new county id", async () => {
    await stepUp(verOwner);
    const rows = [await ruleRows(verco), await countyRows(verco)];
    const before = await taxOf(verOwner.cookie);
    const reset = await put(verOwner.cookie, SUMMIT_TAX);
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect([await ruleRows(verco), await countyRows(verco)]).toEqual(rows);
    expect(reset.body).toEqual(before);
    const again = await put(verOwner.cookie, withCounty(reset.body as Tax, "El Paso", { id: "jur-abcdef12" }));
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect([await ruleRows(verco), await countyRows(verco)]).toEqual(rows);
  });

  it("ST5 the rate is compared by value and must be TAX_RATE_TEXT", async () => {
    await stepUp(verOwner);
    const current = await taxOf(verOwner.cookie);
    const pa = () => withCompanyDb(verco, (db) => db.select().from(taxRules).where(eq(taxRules.state, "PA")));
    const original = await pa();
    expect(original).toHaveLength(1);
    for (const ratePct of ["6", "6.0000", "6.00000000"]) {
      const response = await put(verOwner.cookie, withRule(current, "PA", { ratePct }));
      expect(response.status, `${ratePct} ${JSON.stringify(response.body)}`).toBe(200);
      expect(await pa(), ratePct).toEqual(original);
    }
    for (const ratePct of ["6.000001", "100", "6.", ".5", "1e1", "-1", " 6", "6.000000000"])
      expect(refusal(await put(verOwner.cookie, withRule(current, "PA", { ratePct }))), ratePct).toEqual([
        400,
        "invalid_request",
        TAX_MESSAGES.rulePercent("PA"),
      ]);
    expect(await pa()).toEqual(original);
    for (const ratePct of ["99.9999", "0"])
      expect((await put(verOwner.cookie, withRule(current, "PA", { ratePct }))).status, ratePct).toBe(200);
    expect((await pa()).map((row) => row.version).sort()).toEqual([1, 2, 3]);
    // Put Pennsylvania back with direct writes (part 2b, B5), so ST6 starts from version 1 only.
    await withCompanyDb(verco, async (db) => {
      await db.delete(taxRules).where(and(eq(taxRules.state, "PA"), inArray(taxRules.version, [2, 3])));
      await db
        .update(taxRules)
        .set({ validTo: null })
        .where(and(eq(taxRules.state, "PA"), eq(taxRules.version, 1)));
    });
  });

  it("ST6 versions: a change ends the rows reaching the day and starts the next version; nothing is edited or deleted", async () => {
    await stepUp(verOwner);
    const day = companyDay();
    const ownerId = await harness.userIdOf(verOwner.email);
    const of = async (state: string) => (await ruleRows(verco)).filter((row) => row.state === state);
    const others = async () => (await ruleRows(verco)).filter((row) => !["CO", "TX", "MD", "NJ"].includes(row.state));

    // 1. Colorado at 8.5: v1 ends the day before, v2 starts today.
    const othersBefore = await others();
    const countiesBefore = await countyRows(verco);
    const tx1 = (await of("TX"))[0]!;
    let current = await taxOf(verOwner.cookie);
    const first = await put(verOwner.cookie, withRule(current, "CO", { ratePct: "8.5" }));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const co = await of("CO");
    expect(co.map((row) => [row.version, row.validFrom, row.validTo, row.ratePct, row.deletedAt])).toEqual([
      [1, "2025-01-01", dayBefore(day), "8.81000000", null],
      [2, day, null, "8.50000000", null],
    ]);
    expect(co[1]!.createdBy).toBe(ownerId);
    expect(await others()).toEqual(othersBefore);
    expect((await of("TX"))[0]).toEqual(tx1);
    expect(await countyRows(verco)).toEqual(countiesBefore);
    current = await taxOf(verOwner.cookie);
    expect(current.rules.filter((rule) => rule.state === "CO").map((rule) => rule.version)).toEqual([2]);
    const block = (await rowOf(verco))!.tax;
    expect(block).not.toHaveProperty("rules");
    expect(block).not.toHaveProperty("jurisdictions");

    // 2. Again the same day: v2 ends the day before it started (an empty range), v3 starts today; v1 untouched.
    const v1 = co[0]!;
    expect((await put(verOwner.cookie, withRule(current, "CO", { ratePct: "8" }))).status).toBe(200);
    const again = await of("CO");
    expect(again[0]).toEqual(v1);
    expect(again.slice(1).map((row) => [row.version, row.validFrom, row.validTo])).toEqual([
      [2, day, dayBefore(day)],
      [3, day, null],
    ]);
    current = await taxOf(verOwner.cookie);
    expect(current.rules.filter((rule) => rule.state === "CO").map((rule) => rule.version)).toEqual([3]);

    // 3. Texas removed: ended, not deleted; added back: the next version, not 1.
    expect(
      (await put(verOwner.cookie, { ...current, rules: current.rules.filter((r) => r.state !== "TX") })).status,
    ).toBe(200);
    expect((await of("TX")).map((row) => [row.version, row.validTo, row.deletedAt])).toEqual([
      [1, dayBefore(day), null],
    ]);
    current = await taxOf(verOwner.cookie);
    expect(current.rules.map((rule) => rule.state)).not.toContain("TX");
    expect((await put(verOwner.cookie, { ...current, rules: [...current.rules, summitRule("TX")] })).status).toBe(200);
    expect((await of("TX")).map((row) => [row.version, row.validFrom, row.validTo])).toEqual([
      [1, "2025-01-01", dayBefore(day)],
      [2, day, null],
    ]);

    // 4. A soft-deleted Maryland v2 still holds its number: the next is v3.
    await withCompanyDb(verco, (db) =>
      db.insert(taxRules).values({
        ...ruleRow(summitRule("MD")),
        version: 2,
        validFrom: "2024-01-01",
        validTo: "2024-12-31",
        deletedAt: new Date(),
      }),
    );
    current = await taxOf(verOwner.cookie);
    const maryland = await put(verOwner.cookie, withRule(current, "MD", { ratePct: "6.5" }));
    expect(maryland.status, JSON.stringify(maryland.body)).toBe(200);
    expect((await of("MD")).map((row) => [row.version, row.validTo === null])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);

    // 5. The PUT's answer is what GET answers next.
    expect(maryland.body).toEqual(await taxOf(verOwner.cookie));

    // 6. A New Jersey row dated later (written outside the API) isn't shown, and a change ends it too (D26).
    await withCompanyDb(verco, (db) =>
      db.insert(taxRules).values({ ...ruleRow(summitRule("NJ")), version: 7, validFrom: "2099-01-01" }),
    );
    current = await taxOf(verOwner.cookie);
    expect(current.rules.filter((rule) => rule.state === "NJ").map((rule) => rule.version)).toEqual([1]);
    expect((await put(verOwner.cookie, withRule(current, "NJ", { ratePct: "6.5" }))).status).toBe(200);
    expect((await of("NJ")).map((row) => [row.version, row.validFrom, row.validTo])).toEqual([
      [1, "2025-01-01", dayBefore(day)],
      [7, "2099-01-01", dayBefore(day)],
      [8, day, null],
    ]);
    current = await taxOf(verOwner.cookie);
    expect(current.rules.filter((rule) => rule.state === "NJ").map((rule) => rule.version)).toEqual([8]);
  });

  it("ST7 issued documents keep their tax; new quotes, a later conversion and a later billing take the new rule", async () => {
    // 1. Before the change: 100 sq ft of tile at 4.50 is 450.00; Colorado is 8.81 %.
    const q1 = await quote("CO");
    expect(q1.total).toBe("489.65");
    const q2 = await quote("CO");
    await accept(q2.id);
    const q3 = await quote("CO");
    await accept(q3.id);
    const q4 = await quote("CO");
    await accept(q4.id);
    const i1 = await invoiceOf((await convert(q3.id)).id);
    expect([i1.tax, i1.total]).toEqual(["39.65", "489.65"]);
    expect(i1.taxRule).toMatchObject({ state: "CO", version: 1 });
    const contract = await customerContract();
    const b1 = await invoiceOf(await bill(contract.id, contract.line, "400.00"));
    expect([b1.subtotal, b1.tax, b1.total]).toEqual(["400.00", "35.24", "395.24"]);
    expect(b1.taxRule).toMatchObject({ state: "CO", version: 1 });
    const issued = () =>
      withCompanyDb(taxco, (db) =>
        db
          .select({ id: invoices.id, tax: invoices.tax, total: invoices.total, updatedAt: invoices.updatedAt })
          .from(invoices)
          .where(inArray(invoices.id, [i1.id, b1.id]))
          .orderBy(asc(invoices.id)),
      );
    const rowsBefore = await issued();

    // 2. Colorado at 8.5 %.
    await stepUp(tax.owner);
    const current = await taxOf(tax.owner.cookie);
    expect((await put(tax.owner.cookie, withRule(current, "CO", { ratePct: "8.5" }))).status).toBe(200);
    expect(await issued()).toEqual(rowsBefore);

    // 3. Stored totals and issued invoices stay; new documents take the new rule.
    expect(await storedTotal(q1.id)).toBe("489.65");
    expect(taxKept(await invoiceOf(i1.id))).toEqual(taxKept(i1));
    expect(taxKept(await invoiceOf(b1.id))).toEqual(taxKept(b1));
    expect((await quote("CO")).total).toBe("488.25");
    const late = await convert(q2.id);
    expect([late.tax, late.total]).toEqual(["38.25", "488.25"]);
    expect(late.taxRule).toMatchObject({ state: "CO", version: 2 });
    // The accepted quote keeps the total the customer accepted (owner, 2026-11-20; sales.md rule 18).
    expect(await storedTotal(q2.id)).toBe("489.65");
    const b2 = await invoiceOf(await bill(contract.id, contract.line, "700.00"));
    expect([b2.subtotal, b2.tax, b2.total]).toEqual(["300.00", "25.50", "295.50"]);
    expect(b2.taxRule).toMatchObject({ state: "CO", version: 2 });
    // A credit note pro-rates the invoice's stored tax: 39.65 × 100 / 450 = 8.81, not 8.50.
    const note = await call("post", `/invoices/${i1.id}/credit-notes`, tax.owner.cookie).send({
      subtotal: "100.00",
      reason: "Part 3a check",
    });
    expect(note.status, JSON.stringify(note.body)).toBe(201);
    expect((note.body as Invoice).tax).toBe("8.81");
    // An accepted quote saved with nothing that prices it changed keeps its accepted total; a priced
    // change is priced under the day's rule (owner, 2026-11-20; sales.md rule 18).
    const notes = await call("put", `/quotes/${q4.id}`, tax.owner.cookie).send({
      ...quoteBody("CO"),
      notes: "Gate code 1234",
    });
    expect(notes.status, JSON.stringify(notes.body)).toBe(200);
    expect([(notes.body as Quote).total, await storedTotal(q4.id)]).toEqual(["489.65", "489.65"]);
    const repriced = quoteBody("CO");
    repriced.lines[0].quantity = "110";
    const more = await call("put", `/quotes/${q4.id}`, tax.owner.cookie).send(repriced);
    expect(more.status, JSON.stringify(more.body)).toBe(200);
    // 110 sq ft at 4.50 is 495.00; at 8.5 % that is 537.08.
    expect((more.body as Quote).total).toBe("537.08");
    // A quote saved again takes the day's rule.
    const resaved = await call("put", `/quotes/${q1.id}`, tax.owner.cookie).send(quoteBody("CO"));
    expect(resaved.status, JSON.stringify(resaved.body)).toBe(200);
    expect((resaved.body as Quote).total).toBe("488.25");

    // 4. The rule's history: v1 ended, v2 open.
    const co = (await ruleRows(taxco)).filter((row) => row.state === "CO");
    expect(co.map((row) => [row.version, row.validTo === null])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("ST8 county rates: matched by state and county, a new server id per change, compared by value, never another company's row", async () => {
    await stepUp(tax.owner);
    const day = companyDay();
    const adams = (rows: Awaited<ReturnType<typeof countyRows>>) => rows.filter((row) => row.county === "Adams");
    let current = await taxOf(tax.owner.cookie);
    const elPaso = current.jurisdictions.find((rate) => rate.county === "El Paso")!;

    // 1. Added: a server uuid, from the company's day; a quote in Adams takes 7 %.
    const added = {
      id: "jur-new-1",
      state: "CO",
      county: "Adams",
      name: "Adams County combined",
      ratePct: "7",
      validFrom: "1999-01-01",
      validTo: null,
    };
    const first = await put(tax.owner.cookie, { ...current, jurisdictions: [...current.jurisdictions, added] });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const [row1] = adams(await countyRows(taxco));
    expect(row1!.id).not.toBe("jur-new-1");
    expect(row1!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect([row1!.validFrom, row1!.validTo, row1!.ratePct]).toEqual([day, null, "7.00000000"]);
    const inAdams = await quote("CO", "Adams");
    expect(inAdams.total).toBe("481.50");
    await accept(inAdams.id);
    expect((await convert(inAdams.id)).taxSource).toEqual({
      kind: "jurisdiction",
      label: "Adams County combined rate (example)",
    });

    // 2. Changed: the old row ends the day before, a new row with a new id starts today.
    current = await taxOf(tax.owner.cookie);
    expect((await put(tax.owner.cookie, withCounty(current, "Adams", { ratePct: "7.5" }))).status).toBe(200);
    const two = adams(await countyRows(taxco));
    expect(two.map((row) => [row.id === row1!.id, row.validFrom, row.validTo])).toEqual([
      [true, day, dayBefore(day)],
      [false, day, null],
    ]);
    current = await taxOf(tax.owner.cookie);
    expect(current.jurisdictions.filter((rate) => rate.county === "Adams").map((rate) => rate.id)).toEqual([
      two[1]!.id,
    ]);

    // 2b. By value: Adams "7.5" (stored 7.50000000) and El Paso "8.25" change nothing.
    const counties = await countyRows(taxco);
    const byValue = withCounty(withCounty(current, "Adams", { ratePct: "7.5" }), "El Paso", { ratePct: "8.25" });
    expect((await put(tax.owner.cookie, byValue)).status).toBe(200);
    expect(await countyRows(taxco)).toEqual(counties);

    // 3. Removed: ended, not deleted; the state rule applies again (8.5 % since ST7).
    expect(
      (
        await put(tax.owner.cookie, {
          ...current,
          jurisdictions: current.jurisdictions.filter((r) => r.county !== "Adams"),
        })
      ).status,
    ).toBe(200);
    expect(adams(await countyRows(taxco)).map((row) => [row.validTo, row.deletedAt])).toEqual([
      [dayBefore(day), null],
      [dayBefore(day), null],
    ]);
    expect((await quote("CO", "Adams")).total).toBe("488.25");

    // 4. Another company's county id names nothing: a new taxco row, otherco's untouched.
    const [theirs] = await countyRows(otherco);
    current = await taxOf(tax.owner.cookie);
    const named = { ...added, id: theirs!.id, ratePct: "5.0" };
    expect((await put(tax.owner.cookie, { ...current, jurisdictions: [...current.jurisdictions, named] })).status).toBe(
      200,
    );
    const open = adams(await countyRows(taxco)).filter((row) => row.validTo === null);
    expect(open).toHaveLength(1);
    expect(open[0]!.id).not.toBe(theirs!.id);
    expect(await countyRows(otherco)).toEqual([theirs]);
    expect(current.jurisdictions.find((rate) => rate.county === "El Paso")).toEqual(elPaso);
  });

  it("ST9 the company default: dated the company's day when it changes, compared by value, null for none", async () => {
    await stepUp(tax.owner);
    const day = companyDay();
    expect((await quote("WY")).total).toBe("468.00");
    let current = await taxOf(tax.owner.cookie);
    const five = { ratePct: "5", taxable: MATERIAL_ONLY, validFrom: "1999-01-01" };
    expect((await put(tax.owner.cookie, { ...current, companyDefault: five })).status).toBe(200);
    expect((await rowOf(taxco))!.tax.companyDefault).toEqual({ ratePct: "5", taxable: MATERIAL_ONLY, validFrom: day });
    expect((await quote("WY")).total).toBe("472.50");
    current = await taxOf(tax.owner.cookie);
    const block = (await rowOf(taxco))!.tax;
    expect(
      (await put(tax.owner.cookie, { ...current, companyDefault: { ...current.companyDefault!, ratePct: "5.0000" } }))
        .status,
    ).toBe(200);
    expect((await rowOf(taxco))!.tax).toEqual(block);
    expect((await put(tax.owner.cookie, { ...current, companyDefault: null })).status).toBe(200);
    expect((await rowOf(taxco))!.tax.companyDefault).toBeNull();
    expect((await quote("WY")).total).toBe("450.00");
    const four = { ratePct: "4", taxable: MATERIAL_ONLY, validFrom: "2025-01-01" };
    expect((await put(tax.owner.cookie, { ...current, companyDefault: four })).status).toBe(200);
    expect((await rowOf(taxco))!.tax.companyDefault).toEqual({ ...four, validFrom: day });
    expect((await quote("WY")).total).toBe("468.00");
  });

  it("ST10 always a step-up, even for a save that changes nothing", async () => {
    const current = await taxOf(tax.owner.cookie);
    const rows = [await ruleRows(taxco), await countyRows(taxco)];
    const audits = await auditCount(taxco);
    const fresh = await member(taxco, ["owner"]);
    const changed = withRule(current, "PA", { ratePct: "6.5" });
    expect(outcome(await put(fresh.cookie, changed))).toEqual([403, "step_up_required"]);
    expect([await ruleRows(taxco), await countyRows(taxco)]).toEqual(rows);
    expect(await auditCount(taxco)).toBe(audits);
    await stepUp(fresh);
    expect((await put(fresh.cookie, changed)).status).toBe(200);
    const unchanged = await member(taxco, ["owner"]);
    expect(outcome(await put(unchanged.cookie, await taxOf(unchanged.cookie)))).toEqual([403, "step_up_required"]);
  });

  it("ST11 the page's switch off: the PUT is 404; GET still answers Sales tax (the quote builder reads it)", async () => {
    await stepUp(tax.owner);
    const current = await taxOf(tax.owner.cookie);
    const rows = await ruleRows(taxco);
    await withFeatureOff("settings.localization", async () => {
      expect((await put(tax.owner.cookie, withRule(current, "PA", { ratePct: "6.25" }))).status).toBe(404);
      expect(((await answerOf(tax.sales.cookie)).localization ?? {}) as object).toHaveProperty("tax");
    });
    expect(await ruleRows(taxco)).toEqual(rows);
  });

  it("ST12 data scope: settings.tax.manage at branch scope is refused before any step-up; at all it needs the code", async () => {
    const roleKey = "branch-tax";
    const roleId = await withCompanyDb(floorco, async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: roleKey, name: "Branch tax", dataScope: "branch" as const })
        .returning();
      await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "settings.tax.manage" });
      return role.id;
    });
    const person = await member(floorco, [roleKey], true);
    const body = await taxOf(person.cookie);
    const refused = await put(person.cookie, body);
    expect([refused.status, refused.body]).toEqual([403, { code: "forbidden", message: SETTINGS_SCOPE_MESSAGE }]);
    await withCompanyDb(floorco, (db) => db.update(roles).set({ dataScope: "all" }).where(eq(roles.id, roleId)));
    expect(outcome(await put(person.cookie, body))).toEqual([403, "step_up_required"]);
    await stepUp(person);
    expect((await put(person.cookie, body)).status).toBe(200);
  });

  it("ST13 a ceiling below the role binds the Owner and Accountant; GET still answers them Sales tax", async () => {
    const row = and(
      eq(tenantPermissionCeiling.tenantId, floorco.id),
      eq(tenantPermissionCeiling.permissionKey, "settings.tax.manage"),
    );
    const owner = people.get("flooring:owner")!;
    const body = await taxOf(owner.cookie);
    const rows = await ruleRows(floorco);
    await harness.control.db.update(tenantPermissionCeiling).set({ allowed: false }).where(row);
    try {
      for (const key of ["owner", "accountant"]) {
        const cookie = people.get(`flooring:${key}`)!.cookie;
        expect(outcome(await put(cookie, body)), key).toEqual([403, "forbidden"]);
        expect(((await answerOf(cookie)).localization ?? {}) as object, key).toHaveProperty("tax");
      }
    } finally {
      await harness.control.db.update(tenantPermissionCeiling).set({ allowed: true }).where(row);
    }
    expect(await ruleRows(floorco)).toEqual(rows);
  });

  it("ST14 another company's user changes only their own company, whatever the request names", async () => {
    const otherRows = [await ruleRows(otherco), await countyRows(otherco)];
    const email = await harness.addUser({ companyIds: [taxco.id, otherco.id], roles: ["owner"] });
    const both = await enrolled(email);
    await harness
      .post("/api/auth/organization/set-active")
      .set("Cookie", both.cookie)
      .send({ organizationId: taxco.id })
      .expect(200);
    await stepUp(both);
    const current = await taxOf(both.cookie);
    const [theirAdams] = await countyRows(otherco);
    // taxco's own Adams rate (ST8) sent with otherco's row id.
    const body = withCounty(withRule(current, "PA", { ratePct: "6.75" }), "Adams", {
      id: theirAdams!.id,
      ratePct: "5.5",
    });
    const response = await call(
      "put",
      `/settings/localization/tax?companyId=${otherco.id}&tenantId=${otherco.id}`,
      both.cookie,
    )
      .set("X-Company-Id", otherco.id)
      .set("X-Tenant-Id", otherco.id)
      .send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const pa = (await ruleRows(taxco)).filter((row) => row.state === "PA" && row.validTo === null);
    expect(pa.map((row) => row.ratePct)).toEqual(["6.75000000"]);
    const ours = (await countyRows(taxco)).filter((row) => row.county === "Adams" && row.validTo === null);
    expect(ours.map((row) => [row.id === theirAdams!.id, row.ratePct])).toEqual([[false, "5.50000000"]]);
    expect([await ruleRows(otherco), await countyRows(otherco)]).toEqual(otherRows);
    const theirs = await taxOf(otherOwner.cookie);
    expect(theirs.rules.map((rule) => [rule.state, rule.ratePct])).toEqual([["CO", "6.00000000"]]);
    expect(theirs.jurisdictions.map((rate) => [rate.county, rate.ratePct])).toEqual([["Adams", "5.00000000"]]);
  });

  it("ST15 refusals: a disabled member, an Owner without a factor, the wrong product", async () => {
    const body = await taxOf(tax.owner.cookie);
    const rows = await ruleRows(taxco);
    const disabled = await member(taxco, ["owner"]);
    const userId = await harness.userIdOf(disabled.email);
    await withCompanyDb(taxco, (db) =>
      db.update(userProfiles).set({ status: "disabled" }).where(eq(userProfiles.userId, userId)),
    );
    const noFactor = await member(taxco, ["owner"], false);
    expect(outcome(await put(disabled.cookie, body))).toEqual([403, "forbidden"]);
    expect(outcome(await put(noFactor.cookie, body))).toEqual([403, "mfa_enrolment_required"]);
    const wrongHost = await call("put", "/settings/localization/tax", tax.owner.cookie)
      .set(PRODUCT_HEADER, "hr")
      .send(body);
    expect(outcome(wrongHost)).toEqual([403, "product_not_enabled"]);
    expect(await ruleRows(taxco)).toEqual(rows);
  });

  it("ST16 every check judges the locked row, and two saves serialize: the second judges the first's result", async () => {
    await stepUp(verOwner);
    const stored = (await rowOf(verco))!;
    const audits = await auditCount(verco);
    const rows = [await ruleRows(verco), await countyRows(verco)];
    // 1. The filing is as stored when the save is sent; the held transaction changes it before the save reads the row.
    const current = await taxOf(verOwner.cookie);
    const held = await withCompanyDb(verco, (db) =>
      db.transaction(async (tx) => {
        await tx.select({ id: settings.id }).from(settings).where(eq(settings.group, "localization")).for("update");
        const pending = put(verOwner.cookie, current).then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 750));
        await tx
          .update(settings)
          .set({ value: { ...stored, tax: { ...stored.tax, filing: [{ state: "CO", frequency: "annual" }] } } })
          .where(eq(settings.group, "localization"));
        return { pending };
      }),
    );
    expect(refusal(await held.pending)).toEqual([400, "invalid_request", TAX_MESSAGES.notHere]);
    expect([await ruleRows(verco), await countyRows(verco)]).toEqual(rows);
    expect(await auditCount(verco)).toBe(audits);
    await setRow(verco, stored);

    // 2. Two changes of Colorado at once: both succeed, as consecutive versions.
    const day = companyDay();
    const co = current.rules.find((rule) => rule.state === "CO")!;
    const entries = (await auditsOf(verco, ACTION)).length;
    const saves = await withCompanyDb(verco, (db) =>
      db.transaction(async (tx) => {
        await tx.select({ id: settings.id }).from(settings).where(eq(settings.group, "localization")).for("update");
        const both = Promise.all([
          put(verOwner.cookie, withRule(current, "CO", { ratePct: "8.4" })).then((response) => response),
          put(verOwner.cookie, withRule(current, "CO", { ratePct: "8.6" })).then((response) => response),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 750));
        return { both };
      }),
    );
    const [a, b] = await saves.both;
    expect([a.status, b.status], `${JSON.stringify(a.body)} ${JSON.stringify(b.body)}`).toEqual([200, 200]);
    const newest = (await ruleRows(verco)).filter((row) => row.state === "CO").slice(-2);
    expect(newest.map((row) => [row.version, row.validFrom, row.validTo])).toEqual([
      [co.version + 1, day, dayBefore(day)],
      [co.version + 2, day, null],
    ]);
    expect(newest.map((row) => Number(row.ratePct)).sort()).toEqual([8.4, 8.6]);
    const inForce = (await taxOf(verOwner.cookie)).rules.find((rule) => rule.state === "CO")!;
    expect([inForce.version, inForce.ratePct]).toEqual([co.version + 2, newest[1]!.ratePct]);
    const added = (await auditsOf(verco, ACTION)).slice(entries);
    expect(added.map((entry) => entry.targetLabel)).toEqual(["Sales tax", "Sales tax"]);
    const coRate = (side: unknown) =>
      ((side as Tax).rules.find((rule) => rule.state === "CO") ?? { ratePct: "" }).ratePct;
    const chain = added.map((entry) => [coRate(entry.before), coRate(entry.after)]);
    const firstSave = chain.find(([before]) => sameNumber(before, co.ratePct))!;
    const secondSave = chain.find((pair) => pair !== firstSave)!;
    expect(sameNumber(firstSave[1], newest[0]!.ratePct)).toBe(true);
    expect(secondSave).toEqual([firstSave[1], newest[1]!.ratePct]);
  });

  it("ST17 one key per tab: settings.localization.manage alone can't save Sales tax; settings.tax.manage alone can", async () => {
    const keyed = async (roleKey: string, permissionKey: PermissionKey) => {
      await withCompanyDb(floorco, async (db) => {
        const [role] = await db
          .insert(roles)
          .values({ key: roleKey, name: roleKey, dataScope: "all" as const })
          .returning();
        await db.insert(rolePermissions).values({ roleId: role.id, permissionKey });
      });
      const person = await member(floorco, [roleKey], true);
      await stepUp(person);
      return person;
    };
    const owner = people.get("flooring:owner")!;
    const body = await taxOf(owner.cookie);
    const localOnly = await keyed("st17-localization", "settings.localization.manage");
    expect(outcome(await put(localOnly.cookie, body))).toEqual([403, "forbidden"]);
    const taxOnly = await keyed("st17-tax", "settings.tax.manage");
    expect((await put(taxOnly.cookie, body)).status).toBe(200);
  });

  it("ST18 the whole section is not a route", async () => {
    const owner = people.get("flooring:owner")!;
    await stepUp(owner);
    const stored = (await rowOf(floorco))!;
    expect((await call("put", "/settings/localization", owner.cookie).send(stored)).status).toBe(404);
    expect(await rowOf(floorco)).toEqual(stored);
  });

  it("ST19 audit is written in the save's transaction: none for a refused save, one equal to the answer for a 200", async () => {
    const current = await taxOf(tax.owner.cookie);
    const changed = withRule(current, "PA", { ratePct: "6.6" });
    const rows = await ruleRows(taxco);
    const entries = (await auditsOf(taxco, ACTION)).length;
    const fresh = await member(taxco, ["owner"]);
    expect(outcome(await put(fresh.cookie, changed))).toEqual([403, "step_up_required"]);
    expect(await ruleRows(taxco)).toEqual(rows);
    expect((await auditsOf(taxco, ACTION)).length).toBe(entries);
    await stepUp(tax.owner);
    const response = await put(tax.owner.cookie, changed);
    expect(response.status).toBe(200);
    const added = (await auditsOf(taxco, ACTION)).slice(entries);
    expect(added).toHaveLength(1);
    expect(added[0]!.after).toEqual(response.body);
    expect(added[0]!.before).toEqual(current);
  });

  it("ST20 the save and the answer use the company's day, not UTC's", async () => {
    const now = new Date();
    // Etc/GMT+12's day differs from UTC's from 00:00 to 12:00 UTC, and Pacific/Kiritimati's from
    // 10:00 to 24:00 UTC; the pick keeps at least an hour from either zone's own day change (part 2b, RC10b).
    const zone = now.getUTCHours() < 11 ? "Etc/GMT+12" : "Pacific/Kiritimati";
    const zoneDay = dayIn(now, zone);
    expect(zoneDay, "the zone's day differs from UTC's now").not.toBe(dayIn(now, "UTC"));
    await withCompanyDb(zoneco, (db) =>
      db.insert(taxRules).values({ ...ruleRow(summitRule("MD")), validFrom: zoneDay, validTo: zoneDay }),
    );
    await stepUp(zoneOwner);
    await withZone(zoneco, zone, async () => {
      const current = await taxOf(zoneOwner.cookie);
      expect(current.rules.map((rule) => [rule.state, rule.version])).toEqual([
        ["CO", 1],
        ["MD", 1],
      ]);
      const response = await put(zoneOwner.cookie, withRule(current, "CO", { ratePct: "8.5" }));
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const co = (await ruleRows(zoneco)).filter((row) => row.state === "CO");
      expect(co.map((row) => [row.version, row.validFrom, row.validTo])).toEqual([
        [1, "2025-01-01", dayBefore(zoneDay)],
        [2, zoneDay, null],
      ]);
    });
  });
});
