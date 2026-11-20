import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { productPermissions } from "@workspace/db";
import { auditLog, branches, locations, rolePermissions, roles, settings, suppliers } from "@workspace/db/company";
import { tenantModuleOverrides } from "@workspace/db/control";
import {
  DEFAULT_SHARED_COSTS,
  enabledModules,
  FEATURES,
  permissionsForModules,
  PRODUCT_ROLES,
  roleTemplate,
  rolesRequireMfa,
  SETTINGS_SCOPE_MESSAGE,
  SETTINGS_SECTIONS,
  SHARED_COST_MESSAGES,
  SHARED_COST_SHARES_MAX,
  type BusinessReport,
  type FeatureKey,
  type PermissionKey,
  type ProductKey,
  type SettingsAnswer,
  type SharedCostSettings,
} from "@workspace/shared";
import { asc, count, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
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

const RULE = SETTINGS_SECTIONS.sharedCosts;
const ACTION = "Changed shared costs";
const ADDRESS = { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" };
const PDF = { name: "receipt.pdf", data: Buffer.from("%PDF-1.4\n% rent receipt\n").toString("base64") };

/** Today in the test company's time zone (America/Chicago), the day the API dates by. */
function companyDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Settings part 4b on the API (ADR 0059, part 4b; ADR 0023; spec settings-and-permissions.md,
 * `sharedCosts`): PUT /settings/sharedCosts with Expense approval's key, the core module, the
 * `finance.expenses` switch, company-wide scope, a strict body, the shared rule judged against the
 * company's live locations inside the save, one audit entry per save, and GET /settings answering
 * it to its readers; the Business report splits by what was saved. Every case names its id first,
 * for the mutation runs.
 */
describe("settings part 4b on the API: shared costs (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled } = platformHelpers(harness);
  const floorco: TestCompany = { id: "", slug: "", product: "flooring" };
  const peopleco: TestCompany = { id: "", slug: "", product: "hr" };
  const otherco: TestCompany = { id: "", slug: "", product: "flooring" };
  const bareco: TestCompany = { id: "", slug: "", product: "flooring" };
  /** One member per default role of floorco and peopleco. */
  const people = new Map<string, Member>();
  const ids = { a: "", b: "", gone: "", otherA: "", supplier: "" };
  let owner: Member = { cookie: "", email: "" };

  beforeAll(async () => {
    await harness.start();
    Object.assign(floorco, await harness.provisionCompany("shareco"));
    Object.assign(peopleco, await harness.provisionCompany("sharepeople", ["hr"]));
    Object.assign(otherco, await harness.provisionCompany("shareother"));
    Object.assign(bareco, await harness.provisionCompany("sharebare"));
    await withCompanyDb(floorco, async (db) => {
      const [main] = await db.insert(branches).values({ name: "Main", city: "Austin", state: "TX" }).returning();
      const [a, b, gone] = await db
        .insert(locations)
        .values([
          { name: "Main Warehouse", kind: "warehouse" as const, branchId: main.id, address: ADDRESS, isDefault: true },
          { name: "Main Showroom", kind: "showroom" as const, branchId: main.id, address: ADDRESS },
          // Retired behind the API's back: no share may name it (D4).
          { name: "Old Depot", kind: "warehouse" as const, branchId: main.id, address: ADDRESS, deletedAt: new Date() },
        ])
        .returning();
      const [supplier] = await db
        .insert(suppliers)
        .values({ name: "Harbor Property Co", type: "services" as const, terms: "net_30" as const, address: ADDRESS })
        .returning();
      Object.assign(ids, { a: a.id, b: b.id, gone: gone.id, supplier: supplier.id });
    });
    await withCompanyDb(otherco, async (db) => {
      const [branch] = await db.insert(branches).values({ name: "Other", city: "Austin", state: "TX" }).returning();
      const [a] = await db
        .insert(locations)
        .values({ name: "Other Warehouse", kind: "warehouse" as const, branchId: branch.id, address: ADDRESS })
        .returning();
      ids.otherA = a.id;
    });
    for (const company of [floorco, peopleco])
      for (const key of PRODUCT_ROLES[company.product])
        people.set(`${company.product}:${key}`, await member(company, [key]));
    owner = people.get("flooring:owner")!;
  }, 300_000);

  afterAll(async () => {
    await harness.stop();
  });

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

  /** The permissions a default role holds in a fresh company of one product. */
  function expectedPermissions(product: ProductKey, key: RoleKey): PermissionKey[] {
    const ceiling = new Set<PermissionKey>(productPermissions([product]));
    const enabled = new Set<PermissionKey>(permissionsForModules(enabledModules([product], null, [])));
    return roleTemplate(key).permissions.filter((permission) => ceiling.has(permission) && enabled.has(permission));
  }

  /** What a default role's save answers: the module first (the guard's order), then the key, then scope all. */
  function expectedWrite(product: ProductKey, key: RoleKey): [number, string | undefined] {
    if (!enabledModules([product], null, []).includes(RULE.module)) return [403, "module_not_enabled"];
    const held = expectedPermissions(product, key);
    if (!RULE.keys.some((needed) => held.includes(needed))) return [403, "forbidden"];
    return roleTemplate(key).dataScope === "all" ? [200, undefined] : [403, "forbidden"];
  }

  /** Switches a feature off for one run. */
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

  /** `PUT /settings/sharedCosts` as `cookie`. */
  function put(cookie: string, body: unknown) {
    return call("put", "/settings/sharedCosts", cookie).send(body as object);
  }

  /** The stored shared-costs row of a company, or undefined. */
  function stored(company = floorco): Promise<unknown> {
    return withCompanyDb(company, async (db) => {
      const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, "sharedCosts"));
      return row?.value;
    });
  }

  /** A company's shared-costs audit entries, oldest first. */
  function audits(company = floorco) {
    return withCompanyDb(company, (db) =>
      db.select().from(auditLog).where(eq(auditLog.action, ACTION)).orderBy(asc(auditLog.at)),
    );
  }

  /** How many audit entries a company has. */
  function auditCount(company = floorco): Promise<number> {
    return withCompanyDb(company, async (db) => (await db.select({ n: count() }).from(auditLog))[0].n);
  }

  /** `GET /settings` as `cookie`, which must answer 200. */
  async function answerOf(cookie: string): Promise<SettingsAnswer> {
    const response = await call("get", "/settings", cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as SettingsAnswer;
  }

  /** `body` is refused with 400 and `message`, and nothing is stored or audited. */
  async function refused(body: unknown, message: string) {
    const before = [await stored(), await auditCount()];
    const response = await put(owner.cookie, body);
    expect([response.status, response.body], JSON.stringify(body)).toEqual([400, { code: "invalid_request", message }]);
    expect([await stored(), await auditCount()]).toEqual(before);
  }

  /** Saves `body` as the Owner, which must answer 200 with it. */
  async function saved(body: SharedCostSettings) {
    const response = await put(owner.cookie, body);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual(body);
  }

  it("SCA0 the route declares Expense approval's key, the core module and audit", async () => {
    const { SettingsController } = await import("../src/modules/settings/settings.controller");
    const context = {
      getHandler: () => SettingsController.prototype.saveSharedCosts,
      getClass: () => SettingsController,
    } as unknown as ExecutionContext;
    const reflector = new Reflector();
    const requirement = permissionRequirement(reflector, context, "PUT");
    expect(requirement.permissions).toEqual(["settings.expenses.manage"]);
    expect(requirement.module).toBe("core");
    expect(isAudited(reflector, context)).toBe(true);
    expect(RULE).toEqual({
      keys: ["settings.expenses.manage"],
      feature: "finance.expenses",
      module: "core",
      label: "Shared costs",
    });
  });

  it("SCA1 never saved: answered as the report acts on it (revenue share); the first save creates the row with a null before", async () => {
    const bareOwner = await member(bareco, ["owner"]);
    expect((await answerOf(bareOwner.cookie)).sharedCosts).toEqual(DEFAULT_SHARED_COSTS);
    expect(await stored(bareco)).toBeUndefined();
    const response = await put(bareOwner.cookie, { rule: "equal", fixedPct: {} });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await stored(bareco)).toEqual({ rule: "equal", fixedPct: {} });
    const [entry, ...more] = await audits(bareco);
    expect(more).toEqual([]);
    expect(entry).toMatchObject({
      category: "settings",
      targetType: "settings",
      targetLabel: "Shared costs",
      before: null,
      after: { rule: "equal", fixedPct: {} },
    });
    expect((await answerOf(bareOwner.cookie)).sharedCosts).toEqual({ rule: "equal", fixedPct: {} });
  });

  for (const company of [floorco, peopleco]) {
    for (const key of PRODUCT_ROLES[company.product]) {
      it(`SCA2 ${company.product} ${key}: the save only with the core module, the key and scope all; the read only to its readers`, async () => {
        const person = people.get(`${company.product}:${key}`)!;
        const body = { rule: "floor_area", fixedPct: {} };
        const before = [await stored(company), (await audits(company)).length];
        const response = await put(person.cookie, body);
        const [status, code] = expectedWrite(company.product, key);
        const answer = await answerOf(person.cookie);
        const reads =
          enabledModules([company.product], null, []).includes(RULE.module) &&
          expectedPermissions(company.product, key).includes("settings.expenses.manage");
        expect(Object.hasOwn(answer, "sharedCosts"), "answered only to holders of the key").toBe(reads);
        if (status !== 200) {
          expect(outcome(response), JSON.stringify(response.body)).toEqual([status, code]);
          expect([await stored(company), (await audits(company)).length]).toEqual(before);
          return;
        }
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(await stored(company)).toEqual(body);
        expect(answer.sharedCosts).toEqual(body);
        expect(await audits(company)).toHaveLength((before[1] as number) + 1);
      });
    }
  }

  it("SCA3 the body is strict: unknown fields, numbers for text and missing fields answer 400; nothing stored", async () => {
    await saved({ rule: "revenue", fixedPct: {} });
    const before = [await stored(), await auditCount()];
    const bodies: unknown[] = [
      { rule: "fixed", fixedPct: { [ids.a]: "100" }, extra: true },
      { rule: "fixed" },
      { fixedPct: {} },
      { rule: 1, fixedPct: {} },
      { rule: "fixed", fixedPct: { [ids.a]: 100 } },
      { rule: "fixed", fixedPct: [] },
      { rule: "fixed", fixedPct: null },
      { rule: "fixed", fixedPct: { [ids.a]: null } },
      [],
      "fixed",
    ];
    for (const body of bodies)
      expect(outcome(await put(owner.cookie, body)), JSON.stringify(body)).toEqual([400, "invalid_request"]);
    expect([await stored(), await auditCount()]).toEqual(before);
  });

  it("SCA4 outer bounds carry the rule's words", async () => {
    await refused({ rule: "x".repeat(21), fixedPct: {} }, SHARED_COST_MESSAGES.rule);
    await refused({ rule: "fixed", fixedPct: { [ids.a]: "1".repeat(21) } }, SHARED_COST_MESSAGES.share);
    await refused({ rule: "fixed", fixedPct: { ["k".repeat(65)]: "100" } }, SHARED_COST_MESSAGES.unknownLocation);
    const many = Object.fromEntries(Array.from({ length: SHARED_COST_SHARES_MAX + 1 }, () => [uuidv7(), "0"]));
    await refused({ rule: "revenue", fixedPct: many }, SHARED_COST_MESSAGES.shares);
  });

  it("SCA5 the shared rule, with its words: the rule, live locations of this company only, percents, the fixed total", async () => {
    await saved({ rule: "revenue", fixedPct: {} });
    await refused({ rule: "weighted", fixedPct: {} }, SHARED_COST_MESSAGES.rule);
    await refused({ rule: "Fixed", fixedPct: { [ids.a]: "100" } }, SHARED_COST_MESSAGES.rule);
    // Another company's location, a retired one, and one that never existed (D4).
    for (const id of [ids.otherA, ids.gone, uuidv7(), "not-a-location"]) {
      await refused({ rule: "fixed", fixedPct: { [ids.a]: "100", [id]: "0" } }, SHARED_COST_MESSAGES.unknownLocation);
      await refused({ rule: "revenue", fixedPct: { [id]: "0" } }, SHARED_COST_MESSAGES.unknownLocation);
    }
    for (const share of ["", "1.2.3", "-5", "1e2", " 5", "101", "100.0001", "12.34567"]) {
      const words = SHARED_COST_MESSAGES.shareOf("Main Warehouse");
      await refused({ rule: "fixed", fixedPct: { [ids.a]: share, [ids.b]: "40" } }, words);
      await refused({ rule: "equal", fixedPct: { [ids.a]: share } }, words);
    }
    await refused({ rule: "fixed", fixedPct: { [ids.a]: "60", [ids.b]: "30" } }, SHARED_COST_MESSAGES.total("90"));
    await refused({ rule: "fixed", fixedPct: {} }, SHARED_COST_MESSAGES.total("0"));
    await refused(
      { rule: "fixed", fixedPct: { [ids.a]: "60", [ids.b]: "40.0001" } },
      SHARED_COST_MESSAGES.total("100.0001"),
    );
  });

  it("SCA6 a fixed split saves as sent, at any scale PERCENT_TEXT takes; another rule keeps the shares (D5)", async () => {
    await saved({ rule: "fixed", fixedPct: { [ids.a]: "70.00000000", [ids.b]: "30" } });
    expect(await stored()).toEqual({ rule: "fixed", fixedPct: { [ids.a]: "70.00000000", [ids.b]: "30" } });
    await saved({ rule: "fixed", fixedPct: { [ids.a]: "100" } });
    await saved({ rule: "equal", fixedPct: { [ids.a]: "60", [ids.b]: "30" } });
    expect((await answerOf(owner.cookie)).sharedCosts).toEqual({
      rule: "equal",
      fixedPct: { [ids.a]: "60", [ids.b]: "30" },
    });
  });

  it("SCA7 the Expenses switch off: the PUT answers 404 and the read leaves shared costs out", async () => {
    await saved({ rule: "revenue", fixedPct: {} });
    await withFeatureOff(RULE.feature, async () => {
      const before = [await stored(), await auditCount()];
      expect((await put(owner.cookie, { rule: "equal", fixedPct: {} })).status).toBe(404);
      expect([await stored(), await auditCount()]).toEqual(before);
      expect(await answerOf(owner.cookie)).not.toHaveProperty("sharedCosts");
    });
  });

  it("SCA8 data scope: the key below scope all is refused with the settings words, then allowed at all; no step-up (D3)", async () => {
    const roleId = await withCompanyDb(floorco, async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: "branch-shared-costs", name: "Branch shared costs", dataScope: "branch" as const })
        .returning();
      await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "settings.expenses.manage" });
      return role.id;
    });
    // No authenticator: the key is not an MFA key, so no step-up can be asked of this person.
    const person = await member(floorco, ["branch-shared-costs"], false);
    const before = [await stored(), await auditCount()];
    const narrow = await put(person.cookie, { rule: "equal", fixedPct: {} });
    expect([narrow.status, narrow.body]).toEqual([403, { code: "forbidden", message: SETTINGS_SCOPE_MESSAGE }]);
    expect([await stored(), await auditCount()]).toEqual(before);
    await withCompanyDb(floorco, (db) => db.update(roles).set({ dataScope: "all" }).where(eq(roles.id, roleId)));
    const wide = await put(person.cookie, { rule: "equal", fixedPct: {} });
    expect(wide.status, JSON.stringify(wide.body)).toBe(200);
    expect(await stored()).toEqual({ rule: "equal", fixedPct: {} });
  });

  it("SCA9 the core module switched off below: refused and left out of the read", async () => {
    await harness.control.db
      .insert(tenantModuleOverrides)
      .values({ tenantId: floorco.id, module: "core", enabled: false });
    try {
      const before = [await stored(), await auditCount()];
      expect(outcome(await put(owner.cookie, { rule: "revenue", fixedPct: {} }))).toEqual([403, "module_not_enabled"]);
      expect([await stored(), await auditCount()]).toEqual(before);
      expect(await answerOf(owner.cookie)).not.toHaveProperty("sharedCosts");
    } finally {
      await harness.control.db.delete(tenantModuleOverrides).where(eq(tenantModuleOverrides.tenantId, floorco.id));
    }
  });

  it("SCA10 one audit entry per save, each before exactly what it replaced, the safety net silenced", async () => {
    await saved({ rule: "revenue", fixedPct: {} });
    const start = (await audits()).length;
    const total = await auditCount();
    const first = { rule: "fixed" as const, fixedPct: { [ids.a]: "25", [ids.b]: "75" } };
    const second = { rule: "floor_area" as const, fixedPct: {} };
    await saved(first);
    await saved(second);
    const entries = (await audits()).slice(start);
    expect(entries.map((entry) => [entry.before, entry.after])).toEqual([
      [{ rule: "revenue", fixedPct: {} }, first],
      [first, second],
    ]);
    expect(await auditCount()).toBe(total + 2);
  });

  it("SCA11 own company only: another company's save leaves this one's row and answer alone", async () => {
    await saved({ rule: "equal", fixedPct: {} });
    const otherOwner = await member(otherco, ["owner"]);
    const theirs = { rule: "fixed", fixedPct: { [ids.otherA]: "100" } };
    const response = await put(otherOwner.cookie, theirs);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(await stored(otherco)).toEqual(theirs);
    expect(await stored()).toEqual({ rule: "equal", fixedPct: {} });
    expect((await answerOf(owner.cookie)).sharedCosts).toEqual({ rule: "equal", fixedPct: {} });
    // This company's own location means nothing to the other company.
    const crossed = await put(otherOwner.cookie, { rule: "fixed", fixedPct: { [ids.a]: "100" } });
    expect([crossed.status, crossed.body.message]).toEqual([400, SHARED_COST_MESSAGES.unknownLocation]);
  });

  it("SCA12 the server acts on it: the Business report splits a company-wide cost by the saved rule", async () => {
    const day = companyDay();
    const expense = await call("post", "/expenses", owner.cookie).send({
      date: day,
      supplierId: ids.supplier,
      category: "rent",
      locationId: null,
      amount: "100.00",
      tax: "",
      paymentMethod: "cash",
      reference: "",
      note: "",
      settlement: "paid",
      asDraft: false,
      files: [PDF],
    });
    expect(expense.status, JSON.stringify(expense.body)).toBe(201);
    const split = async () => {
      const response = await call("get", `/reports/business?from=${day.slice(0, 8)}01&to=${day}`, owner.cookie);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const section = (response.body as BusinessReport).sections.find((s) => s.key === "locations")!;
      const shareOf = (id: string) => section.rows.find((row) => row.id === id)!.values.shared;
      return { a: shareOf(ids.a), b: shareOf(ids.b), note: section.note };
    };
    await saved({ rule: "fixed", fixedPct: { [ids.a]: "70", [ids.b]: "30" } });
    expect(await split()).toMatchObject({ a: "70.00", b: "30.00" });
    expect((await split()).note).toContain("fixed percentages");
    await saved({ rule: "fixed", fixedPct: { [ids.a]: "33.3333", [ids.b]: "66.6667" } });
    expect(await split()).toMatchObject({ a: "33.33", b: "66.67" });
    await saved({ rule: "equal", fixedPct: {} });
    expect(await split()).toMatchObject({ a: "50.00", b: "50.00" });
  });
});
