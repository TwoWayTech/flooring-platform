import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { auditLog, rolePermissions, roles, settings } from "@workspace/db/company";
import {
  enabledModules,
  FEATURES,
  PRODUCT_ROLES,
  readableSections,
  roleTemplate,
  rolesRequireMfa,
  SETTINGS_SCOPE_MESSAGE,
  SETTINGS_SECTIONS,
  STOCK_RULES_MESSAGES,
  STOCK_RULES_OWNER_ONLY,
  type FeatureKey,
  type InventorySettings,
  type ProductKey,
  type SettingsAnswer,
} from "@workspace/shared";
import { asc, count, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAudited, permissionRequirement } from "../src/core/access/permission.decorators";
import { AuthHarness } from "./auth-harness";
import { platformHelpers } from "./support/platform-admins";

/** What the seed stores for every flooring company (`packages/shared/scripts/fixtures/tenant.ts`). */
const STOCK: InventorySettings = { adjustmentApprovalQty: "1000" };
/** The never-saved answer: the strictest quantity (the Stock rules part, D5). */
const NEVER_SAVED: InventorySettings = { adjustmentApprovalQty: "0" };

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

/**
 * Stock rules on the API (ADR 0059, the Stock rules part, D2 to D6): `PUT /settings/inventory` with
 * its key, module, switch, scope, strict body and shared rule; raising or clearing the quantity only
 * for an Owner and only after a step-up, both after the content rule; one audit entry; `GET
 * /settings` answering it only to its manager. Every case names its id first, for the mutation runs.
 */
describe("Stock rules on the API (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled, stepUp } = platformHelpers(harness);
  const floorco: TestCompany = { id: "", slug: "", product: "flooring" };
  const peopleco: TestCompany = { id: "", slug: "", product: "hr" };
  const bareco: TestCompany = { id: "", slug: "", product: "flooring" };
  const otherco: TestCompany = { id: "", slug: "", product: "flooring" };
  /** One member per default role of floorco and peopleco, signed in once (no step-up). */
  const people = new Map<string, Member>();

  beforeAll(async () => {
    await harness.start();
    Object.assign(floorco, await harness.provisionCompany("stockfloorco"));
    Object.assign(peopleco, await harness.provisionCompany("stockpeopleco", ["hr"]));
    Object.assign(bareco, await harness.provisionCompany("stockbareco"));
    Object.assign(otherco, await harness.provisionCompany("stockotherco"));
    for (const company of [floorco, otherco]) await seedStock(company, STOCK);
    for (const company of [floorco, peopleco])
      for (const key of PRODUCT_ROLES[company.product])
        people.set(`${company.product}:${key}`, await member(company, [key]));
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

  /** Writes a company's `inventory` row, replacing any; `null` writes the jsonb value null. */
  function seedStock(company: TestCompany, value: unknown) {
    return withCompanyDb(company, async (db) => {
      await db.delete(settings).where(eq(settings.group, "inventory"));
      // A JSON null is the jsonb value null, not SQL NULL (the column is not null).
      await db.insert(settings).values({ group: "inventory", value: value === null ? sql`'null'::jsonb` : value });
    });
  }

  /** A signed-in member holding `roles` in `company`, enrolled in MFA when the roles need it. */
  async function member(company: TestCompany, held: string[], mfa = rolesRequireMfa(held)): Promise<Member> {
    const email = await harness.addUser({ companyIds: [company.id], roles: held });
    if (!mfa) return { cookie: await harness.signIn(email), email, secret: "" };
    const { cookie, secret } = await enrolled(email);
    return { cookie, email, secret };
  }

  /** A custom role in `company` with only the Stock rules key, at a data scope. */
  async function keyRole(company: TestCompany, key: string, dataScope: "all" | "branch"): Promise<string> {
    return withCompanyDb(company, async (db) => {
      const [role] = await db.insert(roles).values({ key, name: key, dataScope }).returning();
      await db.insert(rolePermissions).values({ roleId: role!.id, permissionKey: "settings.locations.manage" });
      return role!.id;
    });
  }

  /** The stored `inventory` row of a company, or undefined. */
  function stockOf(company: TestCompany): Promise<unknown> {
    return withCompanyDb(company, async (db) => {
      const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, "inventory"));
      return row?.value;
    });
  }

  /** How many audit entries a company has. */
  function auditCount(company: TestCompany): Promise<number> {
    return withCompanyDb(company, async (db) => (await db.select({ n: count() }).from(auditLog))[0]!.n);
  }

  /** A company's "Changed stock rules" audit entries, oldest first. */
  function stockAudits(company: TestCompany) {
    return withCompanyDb(company, (db) =>
      db.select().from(auditLog).where(eq(auditLog.action, "Changed stock rules")).orderBy(asc(auditLog.at)),
    );
  }

  /** `GET /settings` as `cookie`, which must answer 200. */
  async function answerOf(cookie: string): Promise<SettingsAnswer> {
    const response = await call("get", "/settings", cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as SettingsAnswer;
  }

  function put(cookie: string, body: unknown) {
    return call("put", "/settings/inventory", cookie).send(body as object);
  }

  /** A status and code pair, for compact refusal checks. */
  function outcome(response: { status: number; body: { code?: string } }) {
    return [response.status, response.body.code];
  }

  /** A status, code and message, for refusals with words. */
  function refusal(response: { status: number; body: { code?: string; message?: string } }) {
    return [response.status, response.body.code, response.body.message];
  }

  /** Expects a refusal that stored and audited nothing. */
  async function expectNothingChanged(company: TestCompany, before: unknown, audits: number): Promise<void> {
    expect(await stockOf(company)).toEqual(before);
    expect(await auditCount(company)).toBe(audits);
  }

  /** Runs `run` with a feature switched off in the register the API reads. */
  async function withFeatureOff(key: FeatureKey, run: () => Promise<void>) {
    const feature = FEATURES[key] as { enabled: boolean };
    feature.enabled = false;
    try {
      await run();
    } finally {
      feature.enabled = true;
    }
  }

  it("MS0 the route declares the shared table: key, module core and audit", async () => {
    const { SettingsController } = await import("../src/modules/settings/settings.controller");
    const reflector = new Reflector();
    const context = {
      getHandler: () => (SettingsController.prototype as unknown as Record<string, unknown>).saveInventory,
      getClass: () => SettingsController,
    } as unknown as ExecutionContext;
    const requirement = permissionRequirement(reflector, context, "PUT");
    expect(requirement.permissions).toEqual(["settings.locations.manage"]);
    expect(requirement.permissions).toEqual(SETTINGS_SECTIONS.inventory.keys);
    expect(requirement.module).toBe("core");
    expect(requirement.module).toBe(SETTINGS_SECTIONS.inventory.module);
    expect(SETTINGS_SECTIONS.inventory.feature).toBe("inventory.locations");
    expect(isAudited(reflector, context)).toBe(true);
  });

  for (const company of [floorco, peopleco]) {
    for (const key of PRODUCT_ROLES[company.product]) {
      it(`MS1 ${company.product} ${key}: GET /settings answers Stock rules only to its manager; PUT only with the key and module`, async () => {
        const person = people.get(`${company.product}:${key}`)!;
        const template = new Set(roleTemplate(key).permissions);
        const reads = readableSections({
          permissions: template,
          modules: enabledModules([company.product], null, []),
        }).includes("inventory");
        // Only Flooring's Owner holds settings.locations.manage with module core (D6).
        expect(reads).toBe(company.product === "flooring" && key === "owner");
        const body = await answerOf(person.cookie);
        if (reads) expect(body.inventory).toEqual(await stockOf(company));
        else expect(body).not.toHaveProperty("inventory");
        const before = await stockOf(company);
        const audits = await auditCount(company);
        // A tighter value: no step-up, so the outcome is the guards' alone.
        const response = await put(person.cookie, { adjustmentApprovalQty: "999" });
        if (reads) {
          expect(response.status, JSON.stringify(response.body)).toBe(200);
          expect(await stockOf(company)).toEqual({ adjustmentApprovalQty: "999" });
          await stepUp(person);
          await put(person.cookie, STOCK).expect(200);
          return;
        }
        expect(outcome(response), JSON.stringify(response.body)).toEqual(
          company.product === "hr" ? [403, "module_not_enabled"] : [403, "forbidden"],
        );
        await expectNothingChanged(company, before, audits);
      });
    }
  }

  it("MS2 never saved: answered as the strictest, so the Owner's first save of a quantity is a loosening that needs a code", async () => {
    const owner = await member(bareco, ["owner"]);
    expect(await stockOf(bareco)).toBeUndefined();
    expect((await answerOf(owner.cookie)).inventory).toEqual(NEVER_SAVED);
    const audits = await auditCount(bareco);
    expect(outcome(await put(owner.cookie, { adjustmentApprovalQty: "50" }))).toEqual([403, "step_up_required"]);
    await expectNothingChanged(bareco, undefined, audits);
    // Keeping the strictest needs no code.
    const kept = await put(owner.cookie, NEVER_SAVED);
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    expect(await stockOf(bareco)).toEqual(NEVER_SAVED);
    await stepUp(owner);
    const saved = await put(owner.cookie, { adjustmentApprovalQty: "50" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual({ adjustmentApprovalQty: "50" });
    const [first, second, ...more] = await stockAudits(bareco);
    expect(more).toEqual([]);
    expect(first).toMatchObject({ category: "settings", targetType: "settings", targetLabel: "Stock rules" });
    expect(first!.before).toBeNull();
    expect(first!.after).toEqual(NEVER_SAVED);
    expect(second!.before).toEqual(NEVER_SAVED);
    expect(second!.after).toEqual({ adjustmentApprovalQty: "50" });
  });

  it("MS3 the body is strict: unknown fields, numbers, missing fields and over-long text answer 400 before any check", async () => {
    const owner = people.get("flooring:owner")!;
    const before = await stockOf(floorco);
    const audits = await auditCount(floorco);
    const bodies: unknown[] = [
      { ...STOCK, unknown: "x" },
      { adjustmentApprovalQty: 50 },
      { adjustmentApprovalQty: null },
      {},
      { adjustmentApprovalQty: "1".repeat(141) },
      [STOCK],
      null,
    ];
    for (const body of bodies)
      expect(outcome(await put(owner.cookie, body)), JSON.stringify(body)?.slice(0, 80)).toEqual([
        400,
        "invalid_request",
      ]);
    expect((await put(owner.cookie, { adjustmentApprovalQty: "1".repeat(141) })).body.message).toBe(
      STOCK_RULES_MESSAGES.adjustmentApprovalQty,
    );
    await expectNothingChanged(floorco, before, audits);
  });

  it("MS4 the shared rule answers 400 with its words, before the Owner-only check and any step-up", async () => {
    const owner = people.get("flooring:owner")!;
    const keeper = await member(floorco, [await keyRoleKey(floorco, "stock-rule-words", "all")], false);
    const before = await stockOf(floorco);
    const audits = await auditCount(floorco);
    for (const bad of [".", "12.", ".5", "-1", "+1", "1e3", " 50", "1,000", "12.1234", "12345678901", "Infinity"])
      for (const who of [owner, keeper])
        expect(refusal(await put(who.cookie, { adjustmentApprovalQty: bad })), bad).toEqual([
          400,
          "invalid_request",
          STOCK_RULES_MESSAGES.adjustmentApprovalQty,
        ]);
    await expectNothingChanged(floorco, before, audits);
  });

  /** Adds a custom role and gives back its key, for `member`. */
  async function keyRoleKey(company: TestCompany, key: string, dataScope: "all" | "branch"): Promise<string> {
    await keyRole(company, key, dataScope);
    return key;
  }

  it("MS5 only an Owner raises or clears the quantity, refused before the code; anyone with the key keeps or lowers it without one", async () => {
    const keeper = await member(floorco, [await keyRoleKey(floorco, "stock-keeper", "all")], false);
    await seedStock(floorco, STOCK);
    const audits = await auditCount(floorco);
    for (const looser of ["1000.001", "5000", ""])
      expect(refusal(await put(keeper.cookie, { adjustmentApprovalQty: looser })), looser).toEqual([
        403,
        "owner_only",
        STOCK_RULES_OWNER_ONLY,
      ]);
    await expectNothingChanged(floorco, STOCK, audits);
    // The keeper has no second factor, so a step-up would refuse them: keeping and lowering ask for none.
    await put(keeper.cookie, STOCK).expect(200);
    await put(keeper.cookie, { adjustmentApprovalQty: "1000.000" }).expect(200);
    await put(keeper.cookie, { adjustmentApprovalQty: "25.5" }).expect(200);
    expect(await stockOf(floorco)).toEqual({ adjustmentApprovalQty: "25.5" });
    // Judged against what is stored now: back up to 1000 is a loosening again.
    expect(outcome(await put(keeper.cookie, STOCK))).toEqual([403, "owner_only"]);
    expect((await stockAudits(floorco)).slice(-3).map((entry) => entry.after)).toEqual([
      STOCK,
      { adjustmentApprovalQty: "1000.000" },
      { adjustmentApprovalQty: "25.5" },
    ]);
  });

  it("MS6 the Owner loosens after a step-up: refused without one, then stored as sent with one audit entry", async () => {
    const owner = await member(floorco, ["owner"]);
    await seedStock(floorco, { adjustmentApprovalQty: "25.5" });
    const audits = (await stockAudits(floorco)).length;
    for (const looser of ["1000", ""]) {
      expect(outcome(await put(owner.cookie, { adjustmentApprovalQty: looser })), looser).toEqual([
        403,
        "step_up_required",
      ]);
    }
    expect(await stockOf(floorco)).toEqual({ adjustmentApprovalQty: "25.5" });
    expect(await stockAudits(floorco)).toHaveLength(audits);
    await stepUp(owner);
    const saved = await put(owner.cookie, { adjustmentApprovalQty: "" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual({ adjustmentApprovalQty: "" });
    expect(await stockOf(floorco)).toEqual({ adjustmentApprovalQty: "" });
    expect((await answerOf(owner.cookie)).inventory).toEqual({ adjustmentApprovalQty: "" });
    const entries = await stockAudits(floorco);
    expect(entries).toHaveLength(audits + 1);
    expect(entries.at(-1)!.before).toEqual({ adjustmentApprovalQty: "25.5" });
    expect(entries.at(-1)!.after).toEqual({ adjustmentApprovalQty: "" });
    await put(owner.cookie, STOCK).expect(200);
  });

  it("MS7 a stored quantity the rule refuses: any change by someone not an Owner is a loosening", async () => {
    const keeper = await member(floorco, [await keyRoleKey(floorco, "stock-odd-row", "all")], false);
    for (const odd of [{ adjustmentApprovalQty: "abc" }, {}, { adjustmentApprovalQty: 5 }, null]) {
      await seedStock(floorco, odd);
      const audits = await auditCount(floorco);
      expect(outcome(await put(keeper.cookie, { adjustmentApprovalQty: "0" })), JSON.stringify(odd)).toEqual([
        403,
        "owner_only",
      ]);
      await expectNothingChanged(floorco, odd, audits);
    }
    await seedStock(floorco, STOCK);
  });

  it("MS11 an Owner keeps or lowers the quantity without a step-up", async () => {
    const owner = await member(floorco, ["owner"]);
    await seedStock(floorco, STOCK);
    const audits = (await stockAudits(floorco)).length;
    await put(owner.cookie, STOCK).expect(200);
    const lowered = await put(owner.cookie, { adjustmentApprovalQty: "10" });
    expect(lowered.status, JSON.stringify(lowered.body)).toBe(200);
    expect(await stockOf(floorco)).toEqual({ adjustmentApprovalQty: "10" });
    expect(await stockAudits(floorco)).toHaveLength(audits + 2);
    await seedStock(floorco, STOCK);
  });

  it("MS12 someone not an Owner with a second factor gets owner_only for a loosening, with or without a step-up", async () => {
    const roleKey = "stock-and-payments";
    await withCompanyDb(floorco, async (db) => {
      const [role] = await db.insert(roles).values({ key: roleKey, name: roleKey, dataScope: "all" }).returning();
      await db.insert(rolePermissions).values([
        { roleId: role!.id, permissionKey: "settings.locations.manage" },
        { roleId: role!.id, permissionKey: "settings.payments.manage" },
      ]);
    });
    const person = await member(floorco, [roleKey], true);
    await seedStock(floorco, STOCK);
    const audits = await auditCount(floorco);
    expect(outcome(await put(person.cookie, { adjustmentApprovalQty: "2000" }))).toEqual([403, "owner_only"]);
    await stepUp(person);
    expect(outcome(await put(person.cookie, { adjustmentApprovalQty: "" }))).toEqual([403, "owner_only"]);
    await expectNothingChanged(floorco, STOCK, audits);
  });

  it("MS13 two first saves at once: each stored value is what its own judgement saw, and the audit chain holds", async () => {
    const company: TestCompany = { ...(await harness.provisionCompany("stockraceco")), product: "flooring" };
    const roleKey = "race-stock-rules";
    await keyRole(company, roleKey, "all");
    const [first, second] = [await member(company, [roleKey], false), await member(company, [roleKey], false)];
    const answers = await Promise.all([
      put(first.cookie, NEVER_SAVED),
      put(second.cookie, { adjustmentApprovalQty: "0.000" }),
    ]);
    for (const answer of answers) expect([200, 409], JSON.stringify(answer.body)).toContain(answer.status);
    const conflicts = answers.filter((answer) => answer.status === 409);
    for (const conflict of conflicts) expect(conflict.body.code).toBe("conflict");
    const entries = await stockAudits(company);
    expect(entries).toHaveLength(2 - conflicts.length);
    expect(entries[0]!.before).toBeNull();
    if (entries[1]) expect(entries[1].before).toEqual(entries[0]!.after);
    expect(await stockOf(company)).toEqual(entries.at(-1)!.after);
  });

  it("MS8 the Warehouses and showrooms switch off answers the PUT 404 and leaves the section out of the read; adjustments off changes nothing", async () => {
    const owner = people.get("flooring:owner")!;
    await withFeatureOff(SETTINGS_SECTIONS.inventory.feature, async () => {
      expect((await put(owner.cookie, STOCK)).status).toBe(404);
      expect(await answerOf(owner.cookie)).not.toHaveProperty("inventory");
    });
    expect(FEATURES["inventory.adjustments"].enabled).toBe(false);
    expect((await answerOf(owner.cookie)).inventory).toEqual(STOCK);
  });

  it("MS9 below company-wide scope the key is refused with the settings words", async () => {
    const roleKey = await keyRoleKey(floorco, "branch-stock-rules", "branch");
    const person = await member(floorco, [roleKey], false);
    const before = await stockOf(floorco);
    const audits = await auditCount(floorco);
    const refused = await put(person.cookie, { adjustmentApprovalQty: "10" });
    expect([refused.status, refused.body]).toEqual([403, { code: "forbidden", message: SETTINGS_SCOPE_MESSAGE }]);
    await expectNothingChanged(floorco, before, audits);
    await withCompanyDb(floorco, (db) => db.update(roles).set({ dataScope: "all" }).where(eq(roles.key, roleKey)));
    expect((await answerOf(person.cookie)).inventory).toEqual(before);
    await put(person.cookie, before).expect(200);
  });

  it("MS10 another company's Owner changes only their own company's section", async () => {
    const otherOwner = await member(otherco, ["owner"]);
    const floorBefore = await stockOf(floorco);
    const value = { adjustmentApprovalQty: "7" };
    await call("put", `/settings/inventory?companyId=${floorco.id}`, otherOwner.cookie)
      .set("X-Company-Id", floorco.id)
      .set("X-Tenant-Id", floorco.id)
      .send(value)
      .expect(200);
    expect(await stockOf(otherco)).toEqual(value);
    expect(await stockOf(floorco)).toEqual(floorBefore);
  });
});
