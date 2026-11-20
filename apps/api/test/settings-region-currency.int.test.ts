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
import { tenantPermissionCeiling, tenants } from "@workspace/db/control";
import {
  CURRENCY_MESSAGES,
  enabledModules,
  FEATURES,
  permissionsForModules,
  PRODUCT_HEADER,
  PRODUCT_ROLES,
  readableTabs,
  REGION_MESSAGES,
  roleTemplate,
  rolesRequireMfa,
  SENSITIVE_FIELDS,
  SETTINGS_SCOPE_MESSAGE,
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
import { dayIn } from "../src/modules/sales/sales-common";
import { AuthHarness } from "./auth-harness";
import { platformHelpers } from "./support/platform-admins";

/** Summit's fixture settings, which the test companies copy. */
const SUMMIT = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json"), "utf8"),
) as { settings: CompanySettings };
const PART_1 = ["profile", "numbers", "payments", "expenses"] as const;
const ACTION = "Changed localization and tax";
const MISSING =
  "Settings → Localization and tax isn't set up for this company yet, so one tab can't be saved on its own.";
/** Keystone's currency (packages/shared/fixtures/keystone.json): CAD at 1.3870 as of 2026-11-04. */
const KEYSTONE_CURRENCY: LocalizationSettings["currency"] = {
  base: "USD",
  locked: true,
  extra: [{ code: "CAD", rate: "1.3870", asOf: "2026-11-04" }],
};
/** The zone the harness provisions every company in (auth-harness.ts); the rows below say America/Denver. */
const CONTROL_ZONE = "America/Chicago";
type RoleKey = (typeof PRODUCT_ROLES)[ProductKey][number];
type Region = LocalizationSettings["region"];
type Currency = LocalizationSettings["currency"];

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

/** A currency with CAD's rate (and the `asOf` sent with it) replaced. */
function cad(currency: Currency, rate: string, asOf = currency.extra[0]!.asOf): Currency {
  return { ...currency, extra: [{ ...currency.extra[0]!, rate, asOf }] };
}

/**
 * Settings part 2b on the API (ADR 0059; spec settings-and-permissions.md, Real build, "Settings on
 * the API, part 2b"): PUT /settings/localization/region and /currency with one key each, the page's
 * switch, company-wide scope, strict bodies, the shared rules judged against the locked row, the
 * states of operation's tax key and step-up, Currency's step-up and dated rates, audit naming the
 * tab, and GET /settings answering Region with the company's control zone to everyone and Currency
 * to its managers, against companies with databases of their own. Every case names its id first,
 * for the mutation runs.
 */
describe("settings part 2b on the API: Region and Currency (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled, stepUp } = platformHelpers(harness);
  const floorco: TestCompany = { id: "", slug: "", product: "flooring" };
  const peopleco: TestCompany = { id: "", slug: "", product: "hr" };
  const otherco: TestCompany = { id: "", slug: "", product: "flooring" };
  const bareco: TestCompany = { id: "", slug: "", product: "flooring" };
  const taxco: TestCompany = { id: "", slug: "", product: "flooring" };
  /**
   * One member per default role of floorco and peopleco, signed in once. RC8 and RC16 step some of
   * them up, which lasts 5 minutes, so every "no step-up yet" case uses a fresh `member(…)`.
   */
  const people = new Map<string, Member>();
  /** A floorco member whose role holds only `settings.localization.manage`, at scope all, MFA enrolled. */
  let localOnly: Member;
  /** otherco's Owner. */
  let otherOwner: Member;
  const tax = { warehouse: "", tile: "", owner: {} as Member };
  /** floorco's control row before any case ran: nothing may write it. */
  let controlBefore: unknown;

  beforeAll(async () => {
    await harness.start();
    Object.assign(floorco, await harness.provisionCompany("floorco"));
    Object.assign(peopleco, await harness.provisionCompany("peopleco", ["hr"]));
    Object.assign(otherco, await harness.provisionCompany("otherco"));
    Object.assign(bareco, await harness.provisionCompany("bareco"));
    Object.assign(taxco, await harness.provisionCompany("taxco"));
    // The rows' own zone copy says America/Denver while control says America/Chicago, so every
    // answer and judgement that uses control's zone is observable.
    for (const company of [floorco, peopleco])
      await setRow(company, { ...summitLocalization(), currency: KEYSTONE_CURRENCY });
    const theirs = summitLocalization();
    await setRow(otherco, {
      ...theirs,
      region: { ...theirs.region, dateFormat: "yyyy-MM-dd" },
      currency: cad(KEYSTONE_CURRENCY, "1.5000"),
    });
    for (const company of [floorco, peopleco])
      for (const key of PRODUCT_ROLES[company.product])
        people.set(`${company.product}:${key}`, await member(company, [key]));
    await withCompanyDb(floorco, async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: "localization-only", name: "Localization only", dataScope: "all" as const })
        .returning();
      await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "settings.localization.manage" });
    });
    localOnly = await member(floorco, ["localization-only"], true);
    otherOwner = await member(otherco, ["owner"]);
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
      tax.warehouse = store.id;
      tax.tile = product.id;
    });
    tax.owner = await member(taxco, ["owner"]);
    controlBefore = await controlRow(floorco);
  }, 300_000);

  afterAll(async () => {
    try {
      expect(await controlRow(floorco), "nothing writes the control database").toEqual(controlBefore);
    } finally {
      await harness.stop();
    }
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

  /** The company's zone in the control database (`tenants.time_zone`). */
  async function zoneOf(company: TestCompany): Promise<string> {
    const [row] = await harness.control.db
      .select({ timeZone: tenants.timeZone })
      .from(tenants)
      .where(eq(tenants.id, company.id));
    return row!.timeZone;
  }

  /** The company's whole control row. */
  async function controlRow(company: TestCompany): Promise<unknown> {
    const [row] = await harness.control.db.select().from(tenants).where(eq(tenants.id, company.id));
    return row;
  }

  /** Moves a company's control zone behind the API's back for one run, as meetings.int.test.ts does, and puts it back. */
  async function withZone(company: TestCompany, zone: string, run: () => Promise<void>): Promise<void> {
    const before = await zoneOf(company);
    await harness.control.db.update(tenants).set({ timeZone: zone }).where(eq(tenants.id, company.id));
    try {
      await run();
    } finally {
      await harness.control.db.update(tenants).set({ timeZone: before }).where(eq(tenants.id, company.id));
    }
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

  /** A status, code and message, for refusals with words. */
  function refusal(response: { status: number; body: { code?: string; message?: string } }) {
    return [response.status, response.body.code, response.body.message];
  }

  /** The region a company's row holds, with the company's control zone, as a save must send it. */
  async function regionOf(company: TestCompany, patch: Partial<Record<keyof Region, unknown>> = {}) {
    return { ...(await rowOf(company))!.region, timeZone: await zoneOf(company), ...patch };
  }

  /** The permissions a default role holds in a fresh company of one product (as permissions.int.test.ts works them out). */
  function expectedPermissions(product: ProductKey, key: RoleKey): PermissionKey[] {
    const ceiling = new Set<PermissionKey>(productPermissions([product]));
    const enabled = new Set<PermissionKey>(permissionsForModules(enabledModules([product], null, [])));
    return roleTemplate(key).permissions.filter((permission) => ceiling.has(permission) && enabled.has(permission));
  }

  /** What a default role's PUT of Region or Currency answers: the key at scope all (`platform`, so never the module). */
  function expectedPut(product: ProductKey, key: RoleKey): [number, string | undefined] {
    if (!expectedPermissions(product, key).includes("settings.localization.manage")) return [403, "forbidden"];
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

  /** A quote in taxco for 100 sq ft of tile at 4.50 for one of the Owner's customers, its job site in `state`. */
  function quoteOf(customerId: string, state: "WY" | "CO") {
    const jobSite =
      state === "WY"
        ? { street: "1 Elk St", city: "Cheyenne", state: "WY", zip: "82001" }
        : { street: "12 Pine Rd", city: "Denver", state: "CO", zip: "80202" };
    return call("post", "/quotes", tax.owner.cookie).send({
      customerId,
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
    });
  }

  /** The total of a new taxco quote with its job site in `state`. */
  async function quoteTotal(customerId: string, state: "WY" | "CO"): Promise<string> {
    const response = await quoteOf(customerId, state);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as { total: string }).total;
  }

  for (const company of [floorco, peopleco]) {
    for (const key of PRODUCT_ROLES[company.product]) {
      it(`RC1 ${company.product} ${key}: GET /settings answers Region with the control zone to everyone and Currency to its managers`, async () => {
        const person = people.get(`${company.product}:${key}`)!;
        const before = await auditCount(company);
        const stored = (await rowOf(company))!;
        const body = await answerOf(person.cookie);
        const held = new Set(expectedPermissions(company.product, key));
        const expected = readableTabs({ permissions: held, modules: enabledModules([company.product], null, []) });
        expect(Object.keys(body.localization ?? {}).sort()).toEqual([...expected].sort());
        expect(expected).toContain("region");
        // The row still says America/Denver; the answer is control's zone.
        expect(stored.region.timeZone).toBe("America/Denver");
        expect(await zoneOf(company)).toBe(CONTROL_ZONE);
        expect(body.localization?.region).toEqual({ ...stored.region, timeZone: CONTROL_ZONE });
        const managers = company === floorco ? ["owner", "accountant"] : ["owner"];
        if (managers.includes(key)) expect(body.localization?.currency).toEqual(stored.currency);
        else expect(body.localization ?? {}).not.toHaveProperty("currency");
        expect(body.localization ?? {}).not.toHaveProperty("tax");
        expect(keysOf(body.localization ?? {}).filter((name) => name in SENSITIVE_FIELDS)).toEqual([]);
        expect(await auditCount(company)).toBe(before);
        expect(await rowOf(company)).toEqual(stored);
      });
    }
  }

  it("RC2 never saved, and a row without Region or Currency: 409 for those tabs; documents and payroll still repair the row", async () => {
    const owner = await member(bareco, ["owner"]);
    expect(await answerOf(owner.cookie)).not.toHaveProperty("localization");
    const audits = await auditCount(bareco);
    const region = { ...summitLocalization().region, timeZone: CONTROL_ZONE };
    for (const [tab, body] of [
      ["region", region],
      ["currency", KEYSTONE_CURRENCY],
    ] as const) {
      const response = await put(tab, owner.cookie, body);
      expect([response.status, response.body], tab).toEqual([409, { code: "settings_missing", message: MISSING }]);
    }
    expect(await rowOf(bareco)).toBeUndefined();
    expect(await auditCount(bareco)).toBe(audits);

    const partial: Record<string, unknown> = { ...summitLocalization() };
    delete partial.currency;
    delete partial.payroll;
    await setRow(bareco, partial);
    try {
      const answer = await answerOf(owner.cookie);
      expect(answer.localization?.region).toEqual(region);
      expect(answer.localization ?? {}).not.toHaveProperty("currency");
      expect(answer.localization ?? {}).not.toHaveProperty("payroll");
      // Never stepped up: the 409 comes before the step-up.
      const missing = await put("currency", owner.cookie, KEYSTONE_CURRENCY);
      expect([missing.status, missing.body]).toEqual([409, { code: "settings_missing", message: MISSING }]);
      expect(await rowOf(bareco)).toEqual(partial);
      const payroll = { overtimeRule: "federal", holidayState: "CO" };
      const repaired = await put("payroll", owner.cookie, payroll);
      expect(repaired.status, JSON.stringify(repaired.body)).toBe(200);
      expect((await rowOf(bareco))!.payroll).toEqual(payroll);
    } finally {
      await withCompanyDb(bareco, (db) => db.delete(settings).where(eq(settings.group, "localization")));
    }
  });

  it("RC3 PUT region by every default role: the Owner and Accountant, and the HR Suite Owner; only that tab changes", async () => {
    const saved: string[] = [];
    for (const company of [floorco, peopleco]) {
      for (const key of PRODUCT_ROLES[company.product]) {
        const label = `${company.product} ${key}`;
        const person = people.get(`${company.product}:${key}`)!;
        const answered = (await answerOf(person.cookie)).localization!.region!;
        const body = { ...answered, dateFormat: "yyyy-MM-dd" };
        const before = (await rowOf(company))!;
        const tables = await taxTables(company);
        const audits = (await auditsOf(company, ACTION)).length;
        const response = await put("region", person.cookie, body);
        const expected = expectedPut(company.product, key);
        if (expected[0] !== 200) {
          expect(outcome(response), label).toEqual(expected);
          expect(await rowOf(company), label).toEqual(before);
          expect((await auditsOf(company, ACTION)).length, label).toBe(audits);
          continue;
        }
        saved.push(label);
        expect(response.status, `${label} ${JSON.stringify(response.body)}`).toBe(200);
        expect(response.body).toEqual(body);
        const after = (await rowOf(company))!;
        expect(after.region, label).toEqual({ ...before.region, dateFormat: "yyyy-MM-dd", timeZone: CONTROL_ZONE });
        expect({ ...after, region: null }, label).toEqual({ ...before, region: null });
        expect(after.tax).not.toHaveProperty("rules");
        expect(after.tax).not.toHaveProperty("jurisdictions");
        expect(await taxTables(company)).toEqual(tables);
        const entries = await auditsOf(company, ACTION);
        expect(entries, "one audit entry per save").toHaveLength(audits + 1);
        expect(entries.at(-1)).toMatchObject({ category: "settings", targetType: "settings", targetLabel: "Region" });
        expect(entries.at(-1)!.before).toEqual({ ...before.region, timeZone: CONTROL_ZONE });
        expect(entries.at(-1)!.after).toEqual(after.region);
        await setRow(company, before);
      }
    }
    expect(saved).toEqual(["flooring owner", "flooring accountant", "hr owner"]);
  });

  it("RC4 the zone: any zone but the company's control zone is refused; control is never written; a moved zone is followed", async () => {
    const owner = people.get("flooring:owner")!;
    const stored = (await rowOf(floorco))!;
    const audits = await auditCount(floorco);
    for (const timeZone of ["America/Denver", "Europe/Paris"]) {
      const refused = await put("region", owner.cookie, await regionOf(floorco, { timeZone }));
      expect(refusal(refused), timeZone).toEqual([400, "invalid_request", REGION_MESSAGES.timeZone]);
    }
    expect(await rowOf(floorco)).toEqual(stored);
    expect(await auditCount(floorco)).toBe(audits);
    expect(await controlRow(floorco)).toEqual(controlBefore);

    const theirs = (await rowOf(otherco))!;
    await withZone(otherco, "America/New_York", async () => {
      expect((await answerOf(otherOwner.cookie)).localization?.region?.timeZone).toBe("America/New_York");
      const chicago = await put("region", otherOwner.cookie, { ...theirs.region, timeZone: CONTROL_ZONE });
      expect(refusal(chicago)).toEqual([400, "invalid_request", REGION_MESSAGES.timeZone]);
      const york = await put("region", otherOwner.cookie, { ...theirs.region, timeZone: "America/New_York" });
      expect(york.status, JSON.stringify(york.body)).toBe(200);
      expect((await rowOf(otherco))!.region.timeZone).toBe("America/New_York");
    });
    await setRow(otherco, theirs);
  });

  it("RC5 strict bodies and Region's content rules, each refused with its words and nothing stored", async () => {
    const owner = people.get("flooring:owner")!;
    const stored = (await rowOf(floorco))!;
    const audits = await auditCount(floorco);
    const shapes: unknown[] = [
      { ...(await regionOf(floorco)), unknown: "x" },
      await regionOf(floorco, { fiscalYearStartMonth: "1" }),
      await regionOf(floorco, { statesOfOperation: "CO" }),
      // An unknown field with a states change: the body is refused before any key or step-up.
      { ...(await regionOf(floorco, { statesOfOperation: ["CO"] })), unknown: "x" },
    ];
    for (const body of shapes)
      expect(outcome(await put("region", owner.cookie, body))).toEqual([400, "invalid_request"]);
    const words: [unknown, string][] = [
      [await regionOf(floorco, { fiscalYearStartMonth: 13 }), REGION_MESSAGES.fiscalYearStartMonth],
      [await regionOf(floorco, { fiscalYearStartMonth: 1.5 }), REGION_MESSAGES.fiscalYearStartMonth],
      [await regionOf(floorco, { dateFormat: "dd/MM/yyyy" }), REGION_MESSAGES.dateFormat],
      [await regionOf(floorco, { firstDayOfWeek: "friday" }), REGION_MESSAGES.firstDayOfWeek],
      [await regionOf(floorco, { country: "CA" }), REGION_MESSAGES.countryLocale("US", "en-US")],
      [await regionOf(floorco, { locale: "en-CA" }), REGION_MESSAGES.countryLocale("US", "en-US")],
      [await regionOf(floorco, { primaryState: "XX" }), REGION_MESSAGES.primaryState],
      [await regionOf(floorco, { statesOfOperation: [] }), REGION_MESSAGES.statesOfOperation],
      [await regionOf(floorco, { statesOfOperation: ["CO", "CO"] }), REGION_MESSAGES.statesOfOperation],
      [await regionOf(floorco, { statesOfOperation: ["CO", "ZZ"] }), REGION_MESSAGES.statesOfOperation],
      // Past the body's outer lengths, the field's own words (D23, as part 2a's review round 1).
      [await regionOf(floorco, { timeZone: "x".repeat(65) }), REGION_MESSAGES.timeZone],
      [await regionOf(floorco, { primaryState: "C".repeat(11) }), REGION_MESSAGES.primaryState],
      [await regionOf(floorco, { statesOfOperation: ["C".repeat(11)] }), REGION_MESSAGES.statesOfOperation],
      [await regionOf(floorco, { statesOfOperation: Array(101).fill("CO") }), REGION_MESSAGES.statesOfOperation],
      [await regionOf(floorco, { dateFormat: "y".repeat(21) }), REGION_MESSAGES.dateFormat],
      [await regionOf(floorco, { firstDayOfWeek: "m".repeat(21) }), REGION_MESSAGES.firstDayOfWeek],
      [await regionOf(floorco, { country: "U".repeat(200) }), REGION_MESSAGES.countryLocale("US", "en-US")],
      [await regionOf(floorco, { locale: "e".repeat(200) }), REGION_MESSAGES.countryLocale("US", "en-US")],
    ];
    for (const [body, message] of words) {
      const response = await put("region", owner.cookie, body);
      expect(refusal(response), message).toEqual([400, "invalid_request", message]);
    }
    expect(await rowOf(floorco)).toEqual(stored);
    expect(await auditCount(floorco)).toBe(audits);
  });

  it("RC6 states of operation: the sales tax key and a step-up, after the content rules; a reorder is no change", async () => {
    const stored = (await rowOf(floorco))!;
    const owner = await member(floorco, ["owner"]);
    const changed = await regionOf(floorco, { statesOfOperation: ["CO"] });
    const first = await put("region", owner.cookie, changed);
    expect(outcome(first)).toEqual([403, "step_up_required"]);
    expect(await rowOf(floorco)).toEqual(stored);
    const both = await put("region", owner.cookie, { ...changed, dateFormat: "dd/MM/yyyy" });
    expect(refusal(both), "content first").toEqual([400, "invalid_request", REGION_MESSAGES.dateFormat]);
    await stepUp(owner);
    const audits = (await auditsOf(floorco, ACTION)).length;
    const taken = await put("region", owner.cookie, changed);
    expect(taken.status, JSON.stringify(taken.body)).toBe(200);
    expect((await rowOf(floorco))!.region.statesOfOperation).toEqual(["CO"]);
    const entries = await auditsOf(floorco, ACTION);
    expect(entries).toHaveLength(audits + 1);
    expect(entries.at(-1)!.targetLabel).toBe("Region");
    await setRow(floorco, stored);

    // Only settings.localization.manage: a reorder with another change saves with no step-up; a
    // change of the states is refused for the key, before the step-up and after it.
    const reordered = await put("region", localOnly.cookie, {
      ...(await regionOf(floorco)),
      statesOfOperation: ["WY", "CO"],
      dateFormat: "yyyy-MM-dd",
    });
    expect(reordered.status, JSON.stringify(reordered.body)).toBe(200);
    await setRow(floorco, stored);
    const counted = await auditCount(floorco);
    const keyless = await put("region", localOnly.cookie, changed);
    expect([keyless.status, keyless.body]).toEqual([
      403,
      { code: "forbidden", message: REGION_MESSAGES.statesNeedTax },
    ]);
    await stepUp(localOnly);
    const stepped = await put("region", localOnly.cookie, changed);
    expect([stepped.status, stepped.body]).toEqual([
      403,
      { code: "forbidden", message: REGION_MESSAGES.statesNeedTax },
    ]);
    expect(await rowOf(floorco)).toEqual(stored);
    expect(await auditCount(floorco)).toBe(counted);
  });

  it("RC7 the server's tax follows the states of operation, an accepted quote's invoice too", async () => {
    const stored = (await rowOf(taxco))!;
    const tables = await taxTables(taxco);
    const customer = await call("post", "/customers", tax.owner.cookie).send({ name: `Cust ${uuidv7()}` });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    const customerId = (customer.body as { id: string }).id;
    // 1. The company default (4 % on materials) applies in Wyoming, a state of operation with no rule.
    expect(await quoteTotal(customerId, "WY")).toBe("468.00");
    // 2. A Wyoming quote sent and accepted before the change; it is invoiced in step 6.
    const accepted = await quoteOf(customerId, "WY");
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    const acceptedId = (accepted.body as { id: string }).id;
    await call("post", `/quotes/${acceptedId}/status`, tax.owner.cookie)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    await call("post", `/quotes/${acceptedId}/status`, tax.owner.cookie).send({ action: "accept" }).expect(201);
    // 5 (before). Colorado has its own rule, whatever the states say.
    expect(await quoteTotal(customerId, "CO")).toBe("489.65");
    // 3. Colorado only.
    await stepUp(tax.owner);
    const region = await regionOf(taxco);
    const saved = await put("region", tax.owner.cookie, { ...region, statesOfOperation: ["CO"] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    // 4. Wyoming is no longer a state of operation: nothing is collected there.
    expect(await quoteTotal(customerId, "WY")).toBe("450.00");
    // 5 (after).
    expect(await quoteTotal(customerId, "CO")).toBe("489.65");
    // 6. The accepted quote's invoice recomputes tax at conversion, so the change reaches it.
    const invoice = await call("post", `/quotes/${acceptedId}/invoice`, tax.owner.cookie);
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    expect((invoice.body as { total: string }).total).toBe("450.00");
    // 7. Put back: Wyoming's default again; the tax block and tables untouched.
    await put("region", tax.owner.cookie, region).expect(200);
    expect(await quoteTotal(customerId, "WY")).toBe("468.00");
    const after = (await rowOf(taxco))!;
    expect(after.tax).toEqual(stored.tax);
    expect(after.tax).not.toHaveProperty("rules");
    expect(after.tax).not.toHaveProperty("jurisdictions");
    expect(await taxTables(taxco)).toEqual(tables);
  });

  it("RC8 PUT currency by every default role: the managers, after a step-up; a changed rate is dated the company's day", async () => {
    const saved: string[] = [];
    for (const company of [floorco, peopleco]) {
      for (const key of PRODUCT_ROLES[company.product]) {
        const label = `${company.product} ${key}`;
        const person = people.get(`${company.product}:${key}`)!;
        const before = (await rowOf(company))!;
        const body = cad(before.currency, "1.3900");
        const audits = (await auditsOf(company, ACTION)).length;
        const expected = expectedPut(company.product, key);
        if (expected[0] !== 200) {
          expect(outcome(await put("currency", person.cookie, body)), label).toEqual(expected);
          expect(await rowOf(company), label).toEqual(before);
          continue;
        }
        await stepUp(person);
        const start = new Date();
        const response = await put("currency", person.cookie, body);
        const end = new Date();
        saved.push(label);
        expect(response.status, `${label} ${JSON.stringify(response.body)}`).toBe(200);
        const after = (await rowOf(company))!;
        const entry = after.currency.extra[0]!;
        expect([entry.code, entry.rate], label).toEqual(["CAD", "1.3900"]);
        expect([dayIn(start, CONTROL_ZONE), dayIn(end, CONTROL_ZONE)], label).toContain(entry.asOf);
        expect(response.body).toEqual(after.currency);
        expect({ ...after, currency: null }, label).toEqual({ ...before, currency: null });
        const entries = await auditsOf(company, ACTION);
        expect(entries, "one audit entry per save").toHaveLength(audits + 1);
        expect(entries.at(-1)).toMatchObject({
          targetLabel: "Currency",
          before: before.currency,
          after: after.currency,
        });
        await setRow(company, before);
      }
    }
    expect(saved).toEqual(["flooring owner", "flooring accountant", "hr owner"]);
  });

  it("RC9 Currency's content rules come before the step-up, each with its words and nothing stored", async () => {
    const owner = await member(floorco, ["owner"]);
    const stored = (await rowOf(floorco))!;
    const current = stored.currency;
    const audits = await auditCount(floorco);
    const entry = current.extra[0]!;
    const eur = { code: "EUR", rate: "1.0800", asOf: "2026-11-04" };
    const words: [unknown, string][] = [
      [{ ...current, base: "CAD" }, CURRENCY_MESSAGES.base("USD")],
      [{ ...current, locked: false }, CURRENCY_MESSAGES.base("USD")],
      [{ ...current, extra: [entry, eur] }, CURRENCY_MESSAGES.codes],
      [{ ...current, extra: [] }, CURRENCY_MESSAGES.codes],
      [{ ...current, extra: [{ ...entry, code: "CAN" }] }, CURRENCY_MESSAGES.codes],
      ...["0", "-1", "1.", "1e3", "1.123456789"].map(
        (rate) => [cad(current, rate), CURRENCY_MESSAGES.exchange("CAD")] as [unknown, string],
      ),
      // Past the body's outer lengths, the field's own words (D23).
      [{ ...current, base: "U".repeat(200) }, CURRENCY_MESSAGES.base("USD")],
      [cad(current, "1".repeat(200)), CURRENCY_MESSAGES.exchange("CAD")],
      [{ ...current, extra: [{ ...entry, code: "C".repeat(11) }] }, CURRENCY_MESSAGES.codes],
      [{ ...current, extra: Array(51).fill(entry) }, CURRENCY_MESSAGES.codes],
    ];
    for (const [body, message] of words) {
      const response = await put("currency", owner.cookie, body);
      expect(refusal(response), message).toEqual([400, "invalid_request", message]);
    }
    for (const body of [
      { ...current, extra: [{ ...entry, rate: 1.39 }] },
      { ...current, unknown: "x" },
      { ...current, extra: [{ ...entry, unknown: "x" }] },
    ])
      expect(outcome(await put("currency", owner.cookie, body))).toEqual([400, "invalid_request"]);
    expect(await rowOf(floorco)).toEqual(stored);
    expect(await auditCount(floorco)).toBe(audits);

    const valid = cad(current, "1.3950");
    expect(outcome(await put("currency", owner.cookie, valid))).toEqual([403, "step_up_required"]);
    expect(await rowOf(floorco)).toEqual(stored);
    expect(await auditCount(floorco)).toBe(audits);
    await stepUp(owner);
    const taken = await put("currency", owner.cookie, valid);
    expect(taken.status, JSON.stringify(taken.body)).toBe(200);
    await setRow(floorco, stored);
  });

  it("RC10 asOf is the server's: an unchanged value keeps its entry, a changed one gets the company's day", async () => {
    const owner = people.get("flooring:owner")!;
    await stepUp(owner);
    const stored = (await rowOf(floorco))!;
    const original = stored.currency.extra[0]!;
    expect(original).toEqual({ code: "CAD", rate: "1.3870", asOf: "2026-11-04" });
    await put("currency", owner.cookie, cad(stored.currency, "1.387")).expect(200);
    expect((await rowOf(floorco))!.currency.extra[0]).toEqual(original);
    await put("currency", owner.cookie, cad(stored.currency, "1.387", "1999-01-01")).expect(200);
    expect((await rowOf(floorco))!.currency.extra[0]).toEqual(original);
    const start = new Date();
    await put("currency", owner.cookie, cad(stored.currency, "1.4000", "2000-01-01")).expect(200);
    const end = new Date();
    const changed = (await rowOf(floorco))!.currency.extra[0]!;
    expect(changed.rate).toBe("1.4000");
    expect([dayIn(start, CONTROL_ZONE), dayIn(end, CONTROL_ZONE)]).toContain(changed.asOf);
    expect(changed.asOf).not.toBe("2000-01-01");
    await setRow(floorco, stored);
  });

  it("RC10b the rate's day is the company's day, not UTC's", async () => {
    const before = new Date();
    // Etc/GMT+12's day differs from UTC's from 00:00 to 12:00 UTC, and Pacific/Kiritimati's from
    // 10:00 to 24:00 UTC; the pick keeps at least an hour from either zone's own day change.
    const zone = before.getUTCHours() < 11 ? "Etc/GMT+12" : "Pacific/Kiritimati";
    expect(dayIn(before, zone), "the zone's day differs from UTC's now").not.toBe(dayIn(before, "UTC"));
    const theirs = (await rowOf(otherco))!;
    await stepUp(otherOwner);
    await withZone(otherco, zone, async () => {
      const response = await put("currency", otherOwner.cookie, cad(theirs.currency, "1.6000"));
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect((await rowOf(otherco))!.currency.extra[0]!.asOf).toBe(dayIn(before, zone));
    });
    await setRow(otherco, theirs);
  });

  it("RC11 the page's switch off: both PUTs 404; GET still answers Region and no longer Currency", async () => {
    const owner = people.get("flooring:owner")!;
    const stored = (await rowOf(floorco))!;
    await withFeatureOff("settings.localization", async () => {
      expect((await put("region", owner.cookie, await regionOf(floorco))).status).toBe(404);
      expect((await put("currency", owner.cookie, stored.currency)).status).toBe(404);
      const body = await answerOf(owner.cookie);
      expect(body.localization?.region).toEqual({ ...stored.region, timeZone: CONTROL_ZONE });
      expect(body.localization ?? {}).not.toHaveProperty("currency");
    });
    expect(await rowOf(floorco)).toEqual(stored);
  });

  it("RC12 data scope, then a role without a factor: Region saves, Currency needs a factor for its step-up", async () => {
    const roleKey = "branch-region";
    const roleId = await withCompanyDb(floorco, async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: roleKey, name: "Branch region", dataScope: "branch" as const })
        .returning();
      await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "settings.localization.manage" });
      return role.id;
    });
    const person = await member(floorco, [roleKey], true);
    const stored = (await rowOf(floorco))!;
    const audits = await auditCount(floorco);
    const region = await regionOf(floorco, { dateFormat: "yyyy-MM-dd" });
    for (const [tab, body] of [
      ["region", region],
      ["currency", stored.currency],
    ] as const) {
      const refused = await put(tab, person.cookie, body);
      expect([refused.status, refused.body], tab).toEqual([
        403,
        { code: "forbidden", message: SETTINGS_SCOPE_MESSAGE },
      ]);
    }
    expect(await rowOf(floorco)).toEqual(stored);
    expect(await auditCount(floorco)).toBe(audits);

    await withCompanyDb(floorco, (db) => db.update(roles).set({ dataScope: "all" }).where(eq(roles.id, roleId)));
    expect((await put("region", person.cookie, region)).status).toBe(200);
    expect(outcome(await put("currency", person.cookie, stored.currency))).toEqual([403, "step_up_required"]);
    await stepUp(person);
    expect((await put("currency", person.cookie, stored.currency)).status).toBe(200);
    await setRow(floorco, stored);

    // The key isn't an MFA key, so a member with no factor gets in; Currency's step-up needs one.
    const noFactor = await member(floorco, [roleKey], false);
    const saved = await put("region", noFactor.cookie, region);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(outcome(await put("currency", noFactor.cookie, stored.currency))).toEqual([403, "step_up_mfa_required"]);
    await setRow(floorco, stored);
  });

  it("RC13 a ceiling below the role binds the Owner too; GET still answers Region and no longer Currency", async () => {
    const row = and(
      eq(tenantPermissionCeiling.tenantId, floorco.id),
      eq(tenantPermissionCeiling.permissionKey, "settings.localization.manage"),
    );
    const stored = (await rowOf(floorco))!;
    const region = await regionOf(floorco, { dateFormat: "yyyy-MM-dd" });
    await harness.control.db.update(tenantPermissionCeiling).set({ allowed: false }).where(row);
    try {
      for (const key of ["owner", "accountant"]) {
        const cookie = people.get(`flooring:${key}`)!.cookie;
        expect(outcome(await put("region", cookie, region)), `${key} region`).toEqual([403, "forbidden"]);
        expect(outcome(await put("currency", cookie, stored.currency)), `${key} currency`).toEqual([403, "forbidden"]);
      }
      const body = await answerOf(people.get("flooring:owner")!.cookie);
      expect(body.localization).toHaveProperty("region");
      expect(body.localization ?? {}).not.toHaveProperty("currency");
    } finally {
      await harness.control.db.update(tenantPermissionCeiling).set({ allowed: true }).where(row);
    }
    expect(await rowOf(floorco)).toEqual(stored);
  });

  it("RC14 another company's user changes only their own company, whatever the request names; each answers its own zone", async () => {
    const floorBefore = (await rowOf(floorco))!;
    const theirs = (await rowOf(otherco))!;
    await put("region", otherOwner.cookie, {
      ...theirs.region,
      timeZone: CONTROL_ZONE,
      dateFormat: "MM/dd/yyyy",
    }).expect(200);
    expect((await rowOf(otherco))!.region.dateFormat).toBe("MM/dd/yyyy");
    expect(await rowOf(floorco)).toEqual(floorBefore);

    const email = await harness.addUser({ companyIds: [floorco.id, otherco.id], roles: ["owner"] });
    const both = await enrolled(email);
    await harness
      .post("/api/auth/organization/set-active")
      .set("Cookie", both.cookie)
      .send({ organizationId: floorco.id })
      .expect(200);
    await stepUp(both);
    const otherBefore = await rowOf(otherco);
    const named = (tab: string, body: object) =>
      call("put", `/settings/localization/${tab}?companyId=${otherco.id}&tenantId=${otherco.id}`, both.cookie)
        .set("X-Company-Id", otherco.id)
        .set("X-Tenant-Id", otherco.id)
        .send(body);
    await named("region", await regionOf(floorco, { dateFormat: "yyyy-MM-dd" })).expect(200);
    await named("currency", cad(floorBefore.currency, "1.4200")).expect(200);
    const floorAfter = (await rowOf(floorco))!;
    expect(floorAfter.region.dateFormat).toBe("yyyy-MM-dd");
    expect(floorAfter.currency.extra[0]!.rate).toBe("1.4200");
    expect(await rowOf(otherco)).toEqual(otherBefore);

    await withZone(otherco, "America/New_York", async () => {
      const mine = (await answerOf(both.cookie)).localization?.region;
      const yours = (await answerOf(otherOwner.cookie)).localization?.region;
      expect([mine?.dateFormat, mine?.timeZone]).toEqual(["yyyy-MM-dd", CONTROL_ZONE]);
      expect([yours?.dateFormat, yours?.timeZone]).toEqual(["MM/dd/yyyy", "America/New_York"]);
    });
    await setRow(floorco, floorBefore);
    await setRow(otherco, theirs);
  });

  it("RC15 refusals on both PUTs: a disabled member, an Owner without a factor, the wrong product", async () => {
    const stored = (await rowOf(floorco))!;
    const region = await regionOf(floorco);
    const disabled = await member(floorco, ["owner"]);
    const userId = await harness.userIdOf(disabled.email);
    await withCompanyDb(floorco, (db) =>
      db.update(userProfiles).set({ status: "disabled" }).where(eq(userProfiles.userId, userId)),
    );
    const noFactor = await member(floorco, ["owner"], false);
    const owner = people.get("flooring:owner")!;
    for (const [tab, body] of [
      ["region", region],
      ["currency", stored.currency],
    ] as const) {
      expect(outcome(await put(tab, disabled.cookie, body)), tab).toEqual([403, "forbidden"]);
      expect(outcome(await put(tab, noFactor.cookie, body)), tab).toEqual([403, "mfa_enrolment_required"]);
      const wrongHost = await call("put", `/settings/localization/${tab}`, owner.cookie)
        .set(PRODUCT_HEADER, "hr")
        .send(body);
      expect(outcome(wrongHost), tab).toEqual([403, "product_not_enabled"]);
    }
    expect(await rowOf(floorco)).toEqual(stored);
  });

  it("RC16 Region and Currency saved at once: the row lock keeps both changes, each audited", async () => {
    const owner = people.get("flooring:owner")!;
    await stepUp(owner);
    const stored = (await rowOf(floorco))!;
    const region = await regionOf(floorco, { dateFormat: "yyyy-MM-dd" });
    const audits = (await auditsOf(floorco, ACTION)).length;
    // Hold the row while both saves start, so both wait on the lock before either reads it.
    const saves = await withCompanyDb(floorco, (db) =>
      db.transaction(async (tx) => {
        await tx.select({ id: settings.id }).from(settings).where(eq(settings.group, "localization")).for("update");
        const both = Promise.all([
          put("region", owner.cookie, region).then((response) => response),
          put("currency", owner.cookie, cad(stored.currency, "1.4100")).then((response) => response),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 750));
        return { both };
      }),
    );
    const [regionSave, currencySave] = await saves.both;
    expect([regionSave.status, currencySave.status]).toEqual([200, 200]);
    const after = (await rowOf(floorco))!;
    expect(after.region.dateFormat).toBe("yyyy-MM-dd");
    expect(after.currency.extra[0]!.rate).toBe("1.4100");
    expect(
      (await auditsOf(floorco, ACTION))
        .slice(audits)
        .map((entry) => entry.targetLabel)
        .sort(),
    ).toEqual(["Currency", "Region"]);
    await setRow(floorco, stored);
  });

  it("RC16b every check that reads the stored tab judges the locked row, not an earlier read", async () => {
    // Region: the states are unchanged when the save is sent; the held transaction changes them to
    // ["CO"] before the save reads the row, so the body is now a change, which needs the tax key.
    const stored = (await rowOf(floorco))!;
    const audits = await auditCount(floorco);
    const region = await regionOf(floorco);
    expect(region.statesOfOperation).toEqual(["CO", "WY"]);
    const regionSave = await withCompanyDb(floorco, (db) =>
      db.transaction(async (tx) => {
        await tx.select({ id: settings.id }).from(settings).where(eq(settings.group, "localization")).for("update");
        const pending = put("region", localOnly.cookie, region).then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 750));
        await tx
          .update(settings)
          .set({ value: { ...stored, region: { ...stored.region, statesOfOperation: ["CO"] } } })
          .where(eq(settings.group, "localization"));
        return { pending };
      }),
    );
    const judged = await regionSave.pending;
    expect([judged.status, judged.body]).toEqual([403, { code: "forbidden", message: REGION_MESSAGES.statesNeedTax }]);
    expect((await rowOf(floorco))!.region.statesOfOperation).toEqual(["CO"]);
    expect(await auditCount(floorco)).toBe(audits);
    await setRow(floorco, stored);

    // Currency: CAD is renamed EUR in the held transaction, so the body sent with CAD changes the codes.
    const owner = await member(floorco, ["owner"]);
    const renamed = { ...stored.currency, extra: [{ ...stored.currency.extra[0]!, code: "EUR" }] };
    const currencySave = await withCompanyDb(floorco, (db) =>
      db.transaction(async (tx) => {
        await tx.select({ id: settings.id }).from(settings).where(eq(settings.group, "localization")).for("update");
        const pending = put("currency", owner.cookie, stored.currency).then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 750));
        await tx
          .update(settings)
          .set({ value: { ...stored, currency: renamed } })
          .where(eq(settings.group, "localization"));
        return { pending };
      }),
    );
    expect(refusal(await currencySave.pending)).toEqual([400, "invalid_request", CURRENCY_MESSAGES.codes]);
    expect((await rowOf(floorco))!.currency).toEqual(renamed);
    expect(await auditCount(floorco)).toBe(audits);
    await setRow(floorco, stored);
  });
});
