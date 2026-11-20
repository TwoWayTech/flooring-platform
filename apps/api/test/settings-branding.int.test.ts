import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { productPermissions } from "@workspace/db";
import { auditLog, rolePermissions, roles } from "@workspace/db/company";
import { tenantBranding, tenantPermissionCeiling, tenants } from "@workspace/db/control";
import {
  BRANDING_MESSAGES,
  enabledModules,
  FEATURES,
  permissionsForModules,
  PRODUCT_ROLES,
  roleTemplate,
  rolesRequireMfa,
  SENSITIVE_FIELDS,
  SETTINGS_SCOPE_MESSAGE,
  SETTINGS_SECTIONS,
  type Branding,
  type FeatureKey,
  type PermissionKey,
  type ProductKey,
  type SettingsAnswer,
} from "@workspace/shared";
import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAudited, permissionRequirement } from "../src/core/access/permission.decorators";
import { AuthHarness } from "./auth-harness";
import { platformHelpers } from "./support/platform-admins";

type RoleKey = (typeof PRODUCT_ROLES)[ProductKey][number];

/** One company of the test: its tenant id and slug, and its product. */
interface TestCompany {
  id: string;
  slug: string;
  product: ProductKey;
}

/** A signed-in member, with their authenticator secret when enrolled. */
interface Member {
  cookie: string;
  email: string;
  secret: string;
}

/** The control row's columns this part reads and writes, plus the ones it must never touch. */
type ControlRow = typeof tenantBranding.$inferSelect;

const NEW: Branding = {
  displayName: "Granite Peak Floors",
  monogram: "GP",
  brandColor: "#7A3E9D",
  pattern: "basketweave",
  logoDataUrl: null,
  defaultTheme: "dark",
};

/** Every property name anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}

/**
 * Settings part 6 on the API (ADR 0059, part 6; approved by the owner on 2026-11-20; spec
 * settings-and-permissions.md rule 27): GET /settings answers branding from the control
 * `tenant_branding` row, and PUT /settings/branding writes that row from a company route, with the
 * shared key, the page switch, scope `all`, a strict body, the shared rule, a step-up, the company
 * from the session only, a row lock and one company audit entry. Every case names its id first, for
 * the mutation runs.
 */
describe("settings part 6 on the API: branding into the control database (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled, stepUp } = platformHelpers(harness);
  const floorco: TestCompany = { id: "", slug: "", product: "flooring" };
  const peopleco: TestCompany = { id: "", slug: "", product: "hr" };
  const otherco: TestCompany = { id: "", slug: "", product: "flooring" };
  const bareco: TestCompany = { id: "", slug: "", product: "flooring" };
  /** One member per default role of floorco and peopleco. */
  const people = new Map<string, Member>();
  let owner: Member = { cookie: "", email: "", secret: "" };

  beforeAll(async () => {
    await harness.start();
    Object.assign(floorco, await harness.provisionCompany("brandco"));
    Object.assign(peopleco, await harness.provisionCompany("brandpeople", ["hr"]));
    Object.assign(otherco, await harness.provisionCompany("brandother"));
    Object.assign(bareco, await harness.provisionCompany("brandbare"));
    // A logo key and timeouts of its own, so a save that touched them would show.
    await harness.control.db
      .update(tenantBranding)
      .set({ logoKey: `${floorco.id}/logo.png`, faviconKey: `${floorco.id}/favicon.png`, idleTimeoutMin: 45 })
      .where(eq(tenantBranding.tenantId, floorco.id));
    for (const company of [floorco, peopleco])
      for (const key of PRODUCT_ROLES[company.product])
        people.set(`${company.product}:${key}`, await member(company, [key]));
    owner = people.get("flooring:owner")!;
  }, 300_000);

  afterAll(async () => {
    await harness.stop();
  });

  /** A signed-in member holding `roles` in `company`, enrolled in MFA when the roles need it. */
  async function member(company: TestCompany, held: string[], mfa = rolesRequireMfa(held)): Promise<Member> {
    const email = await harness.addUser({ companyIds: [company.id], roles: held });
    if (!mfa) return { cookie: await harness.signIn(email), email, secret: "" };
    const { cookie, secret } = await enrolled(email);
    return { cookie, email, secret };
  }

  /** The permissions a default role holds in a fresh company of one product. */
  function expectedPermissions(product: ProductKey, key: RoleKey): PermissionKey[] {
    const ceiling = new Set<PermissionKey>(productPermissions([product]));
    const enabled = new Set<PermissionKey>(permissionsForModules(enabledModules([product], null, [])));
    return roleTemplate(key).permissions.filter((permission) => ceiling.has(permission) && enabled.has(permission));
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

  /** A status and code pair, for compact refusal checks. */
  function outcome(response: { status: number; body: { code?: string } }) {
    return [response.status, response.body.code];
  }

  /** A company's whole control branding row (live or not). */
  async function controlRow(company: TestCompany): Promise<ControlRow> {
    const [row] = await harness.control.db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, company.id));
    return row;
  }

  /** A company's branding as the API answers it from the control row. */
  async function answered(company: TestCompany): Promise<Branding> {
    const row = await controlRow(company);
    const { displayName, monogram, brandColor, pattern, defaultTheme } = row;
    return { displayName, monogram, brandColor, pattern, logoDataUrl: null, defaultTheme };
  }

  /** How many audit entries a company has. */
  function auditCount(company: TestCompany): Promise<number> {
    return withCompanyDb(company, async (db) => (await db.select({ n: count() }).from(auditLog))[0].n);
  }

  /** A company's "Changed branding" audit entries, oldest first. */
  function brandingAudits(company: TestCompany) {
    return withCompanyDb(company, (db) =>
      db.select().from(auditLog).where(eq(auditLog.action, "Changed branding")).orderBy(auditLog.at),
    );
  }

  /** `GET /settings` as `cookie`, which must answer 200. */
  async function answerOf(cookie: string): Promise<SettingsAnswer> {
    const response = await call("get", "/settings", cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as SettingsAnswer;
  }

  /** `PUT /settings/branding` as `cookie`. */
  function put(cookie: string, body: unknown) {
    return call("put", "/settings/branding", cookie).send(body as object);
  }

  /** Checks a refused save left the control row and the audit log as they were. */
  async function unchanged(company: TestCompany, row: ControlRow, audits: number) {
    expect(await controlRow(company)).toEqual(row);
    expect(await auditCount(company)).toBe(audits);
  }

  it("BA0 the route declares the shared table: Branding's key, no module guard (platform), audited", async () => {
    const { SettingsController } = await import("../src/modules/settings/settings.controller");
    const reflector = new Reflector();
    const context = {
      getHandler: () => SettingsController.prototype.saveBranding,
      getClass: () => SettingsController,
    } as unknown as ExecutionContext;
    const requirement = permissionRequirement(reflector, context, "PUT");
    expect(requirement.permissions).toEqual(["settings.branding.manage"]);
    expect(SETTINGS_SECTIONS.branding.keys).toEqual(requirement.permissions);
    expect(SETTINGS_SECTIONS.branding.module).toBe("platform");
    expect(requirement.module).toBeUndefined();
    expect(isAudited(reflector, context)).toBe(true);
  });

  for (const company of [floorco, peopleco]) {
    it(`BA1 ${company.product}: every member reads the company's branding from the control row, logo none`, async () => {
      const want = await answered(company);
      for (const key of PRODUCT_ROLES[company.product]) {
        const body = await answerOf(people.get(`${company.product}:${key}`)!.cookie);
        expect(body.branding, key).toEqual(want);
        expect(keysOf(body.branding).filter((name) => name in SENSITIVE_FIELDS)).toEqual([]);
      }
      // floorco's row holds a logo key: the API still answers none, so the monogram stands in (D5).
      if (company === floorco) expect((await controlRow(floorco)).logoKey).not.toBeNull();
    });
  }

  for (const company of [floorco, peopleco]) {
    for (const key of PRODUCT_ROLES[company.product]) {
      it(`BA2 ${company.product} ${key}: a save needs the key, then a step-up; nothing is written before both`, async () => {
        const person = people.get(`${company.product}:${key}`)!;
        const row = await controlRow(company);
        const audits = await auditCount(company);
        const holds = expectedPermissions(company.product, key).includes("settings.branding.manage");
        const want = holds && roleTemplate(key).dataScope === "all" ? "step_up_required" : "forbidden";
        expect(outcome(await put(person.cookie, NEW))).toEqual([403, want]);
        await unchanged(company, row, audits);
      });
    }
  }

  it("BA3 the Owner saves after a step-up: only the five fields of the own row change, with one audit entry", async () => {
    const before = await controlRow(floorco);
    const others = [await controlRow(otherco), await controlRow(peopleco)];
    const name = (await harness.control.db.select().from(tenants).where(eq(tenants.id, floorco.id)))[0].name;
    const audits = await brandingAudits(floorco);
    const total = await auditCount(floorco);
    await stepUp(owner);
    const saved = await put(owner.cookie, NEW);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual(NEW);
    const after = await controlRow(floorco);
    expect(after).toEqual({
      ...before,
      displayName: NEW.displayName,
      monogram: NEW.monogram,
      brandColor: NEW.brandColor,
      pattern: NEW.pattern,
      defaultTheme: NEW.defaultTheme,
      updatedAt: after.updatedAt,
    });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
    expect([after.logoKey, after.faviconKey, after.idleTimeoutMin]).toEqual([
      `${floorco.id}/logo.png`,
      `${floorco.id}/favicon.png`,
      45,
    ]);
    expect([await controlRow(otherco), await controlRow(peopleco)]).toEqual(others);
    expect((await harness.control.db.select().from(tenants).where(eq(tenants.id, floorco.id)))[0].name).toBe(name);
    // One entry, the safety net silenced by @Audited().
    expect(await auditCount(floorco)).toBe(total + 1);
    const entries = (await brandingAudits(floorco)).slice(audits.length);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      category: "settings",
      targetType: "settings",
      targetId: before.id,
      targetLabel: "Branding",
      before: {
        displayName: before.displayName,
        monogram: before.monogram,
        brandColor: before.brandColor,
        pattern: before.pattern,
        logoDataUrl: null,
        defaultTheme: before.defaultTheme,
      },
      after: NEW,
    });
    expect(entries[0].actorUserId).toBe(await harness.userIdOf(owner.email));
    // Every reader of the control row follows at once.
    expect((await answerOf(people.get("flooring:warehouse")!.cookie)).branding).toEqual(NEW);
    const login = await harness.get(`/public/branding?host=${floorco.slug}.flooringsuite.test`).expect(200);
    expect(login.body).toEqual({
      displayName: NEW.displayName,
      monogram: NEW.monogram,
      brandColor: NEW.brandColor,
      pattern: NEW.pattern,
      defaultTheme: NEW.defaultTheme,
    });
  });

  it("BA4 the body is strict: unknown, missing or mistyped fields and any logo answer 400 before the step-up", async () => {
    const fresh = await member(floorco, ["owner"]);
    const row = await controlRow(floorco);
    const audits = await auditCount(floorco);
    const missing: Partial<Branding> = { ...NEW };
    delete missing.monogram;
    const bodies: [unknown, string | null][] = [
      [{ ...NEW, unknown: "x" }, null],
      [{ ...NEW, tenantId: otherco.id }, null],
      [{ ...NEW, companyId: otherco.id }, null],
      [missing, null],
      [{ ...NEW, displayName: 7 }, null],
      [{ ...NEW, displayName: "x".repeat(801) }, BRANDING_MESSAGES.displayName],
      [{ ...NEW, monogram: "x".repeat(21) }, BRANDING_MESSAGES.monogram],
      [{ ...NEW, brandColor: "#".repeat(21) }, BRANDING_MESSAGES.brandColor],
      [{ ...NEW, pattern: "chevron" }, BRANDING_MESSAGES.pattern],
      [{ ...NEW, defaultTheme: "sepia" }, BRANDING_MESSAGES.defaultTheme],
      [{ ...NEW, logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" }, BRANDING_MESSAGES.logoNotOnApi],
      [{ ...NEW, logoDataUrl: "https://example.com/logo.png" }, BRANDING_MESSAGES.logoNotOnApi],
      [[NEW], null],
      [null, null],
    ];
    for (const [body, words] of bodies) {
      const response = await put(fresh.cookie, body);
      expect(outcome(response), JSON.stringify(body).slice(0, 80)).toEqual([400, "invalid_request"]);
      if (words) expect(response.body.message).toBe(words);
    }
    await unchanged(floorco, row, audits);
  });

  it("BA5 the shared rule, with its words, before the step-up: name, monogram, color and contrast", async () => {
    const fresh = await member(floorco, ["owner"]);
    const row = await controlRow(floorco);
    const audits = await auditCount(floorco);
    const refused: [Partial<Branding>, string][] = [
      [{ displayName: "   " }, BRANDING_MESSAGES.displayName],
      [{ displayName: "x".repeat(81) }, BRANDING_MESSAGES.displayName],
      [{ displayName: "Summit\r\nBcc: someone@example.com" }, BRANDING_MESSAGES.displayName],
      [{ displayName: "Summit\u202Emoc.evil" }, BRANDING_MESSAGES.displayName],
      [{ monogram: "gp" }, BRANDING_MESSAGES.monogram],
      [{ monogram: "GPX" }, BRANDING_MESSAGES.monogram],
      [{ brandColor: "7A3E9D" }, BRANDING_MESSAGES.brandColor],
      [{ brandColor: "#7A3E9D;" }, BRANDING_MESSAGES.brandColor],
      [{ brandColor: "#F5F0A0" }, "This color is too light to read against panels. Pick a deeper shade."],
    ];
    for (const [patch, words] of refused) {
      const response = await put(fresh.cookie, { ...NEW, ...patch });
      expect([response.status, response.body], JSON.stringify(patch)).toEqual([
        400,
        { code: "invalid_request", message: words },
      ]);
    }
    await unchanged(floorco, row, audits);
  });

  it("BA6 the step-up: none is 403 step_up_required; a holder with no factor can't step up; a fresh code saves", async () => {
    const fresh = await member(floorco, ["owner"]);
    const row = await controlRow(floorco);
    const audits = await auditCount(floorco);
    expect(outcome(await put(fresh.cookie, { ...NEW, monogram: "B6" }))).toEqual([403, "step_up_required"]);
    // A custom role with only the branding key needs no MFA to sign in, so it has no factor to step up with.
    await withCompanyDb(floorco, async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: "brand-only", name: "Brand only", dataScope: "all" })
        .returning();
      await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "settings.branding.manage" });
    });
    const noFactor = await member(floorco, ["brand-only"], false);
    expect(outcome(await put(noFactor.cookie, { ...NEW, monogram: "B6" }))).toEqual([403, "step_up_mfa_required"]);
    await unchanged(floorco, row, audits);
    await stepUp(fresh);
    const saved = await put(fresh.cookie, { ...NEW, monogram: "B6" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await controlRow(floorco)).monogram).toBe("B6");
  });

  it("BA7 the page switch off: the save answers 404 before anything else, and every member still reads branding", async () => {
    const row = await controlRow(floorco);
    const audits = await auditCount(floorco);
    await harness.grantStepUp(owner.cookie);
    await withFeatureOff(SETTINGS_SECTIONS.branding.feature, async () => {
      expect(outcome(await put(owner.cookie, NEW))).toEqual([404, "not_found"]);
      expect(outcome(await put(owner.cookie, { ...NEW, unknown: "x" }))).toEqual([404, "not_found"]);
      expect((await answerOf(people.get("flooring:sales")!.cookie)).branding).toEqual(await answered(floorco));
    });
    await unchanged(floorco, row, audits);
  });

  it("BA8 data scope: the key below scope all is refused with the settings words, before any step-up", async () => {
    const roleId = await withCompanyDb(floorco, async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: "branch-branding", name: "Branch branding", dataScope: "branch" as const })
        .returning();
      await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "settings.branding.manage" });
      return role.id;
    });
    const person = await member(floorco, ["branch-branding"], true);
    await harness.grantStepUp(person.cookie);
    const row = await controlRow(floorco);
    const audits = await auditCount(floorco);
    const refused = await put(person.cookie, NEW);
    expect([refused.status, refused.body]).toEqual([403, { code: "forbidden", message: SETTINGS_SCOPE_MESSAGE }]);
    await unchanged(floorco, row, audits);
    await withCompanyDb(floorco, (db) => db.update(roles).set({ dataScope: "all" }).where(eq(roles.id, roleId)));
    expect((await put(person.cookie, NEW)).status).toBe(200);
  });

  it("BA9 a ceiling without the key binds the Owner too", async () => {
    const ceiling = and(
      eq(tenantPermissionCeiling.tenantId, floorco.id),
      eq(tenantPermissionCeiling.permissionKey, "settings.branding.manage"),
    );
    await harness.grantStepUp(owner.cookie);
    const row = await controlRow(floorco);
    const audits = await auditCount(floorco);
    await harness.control.db.update(tenantPermissionCeiling).set({ allowed: false }).where(ceiling);
    try {
      expect(outcome(await put(owner.cookie, NEW))).toEqual([403, "forbidden"]);
      await unchanged(floorco, row, audits);
    } finally {
      await harness.control.db.update(tenantPermissionCeiling).set({ allowed: true }).where(ceiling);
    }
    expect((await put(owner.cookie, NEW)).status).toBe(200);
  });

  it("BA10 the company is the session's only: a member of two companies changes the open one, whatever the request names", async () => {
    const email = await harness.addUser({ companyIds: [floorco.id, otherco.id], roles: ["owner"] });
    const both = await enrolled(email);
    await harness
      .post("/api/auth/organization/set-active")
      .set("Cookie", both.cookie)
      .send({ organizationId: floorco.id })
      .expect(200);
    await harness.grantStepUp(both.cookie);
    const other = await controlRow(otherco);
    const otherAudits = await auditCount(otherco);
    const body = { ...NEW, displayName: "Opened company only", monogram: "OC" };
    const saved = await call("put", `/settings/branding?companyId=${otherco.id}&tenantId=${otherco.id}`, both.cookie)
      .set("X-Company-Id", otherco.id)
      .set("X-Tenant-Id", otherco.id)
      .send(body);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await controlRow(floorco)).displayName).toBe("Opened company only");
    await unchanged(otherco, other, otherAudits);
    // The other company's own Owner saves only theirs.
    const otherOwner = await member(otherco, ["owner"]);
    await harness.grantStepUp(otherOwner.cookie);
    await put(otherOwner.cookie, { ...NEW, displayName: "Other company" }).expect(200);
    expect((await controlRow(otherco)).displayName).toBe("Other company");
    expect((await controlRow(floorco)).displayName).toBe("Opened company only");
    expect((await answerOf(both.cookie)).branding?.displayName).toBe("Opened company only");
  });

  it("BA11 a company with no live branding row gets 409: nothing is created or audited", async () => {
    const bareOwner = await member(bareco, ["owner"]);
    await harness.grantStepUp(bareOwner.cookie);
    await harness.control.db
      .update(tenantBranding)
      .set({ deletedAt: new Date() })
      .where(eq(tenantBranding.tenantId, bareco.id));
    try {
      const row = await controlRow(bareco);
      const audits = await auditCount(bareco);
      const rows = (await harness.control.db.select({ n: count() }).from(tenantBranding))[0].n;
      expect(outcome(await put(bareOwner.cookie, NEW))).toEqual([409, "branding_missing"]);
      await unchanged(bareco, row, audits);
      expect((await harness.control.db.select({ n: count() }).from(tenantBranding))[0].n).toBe(rows);
      expect(await answerOf(bareOwner.cookie)).not.toHaveProperty("branding");
    } finally {
      await harness.control.db
        .update(tenantBranding)
        .set({ deletedAt: null })
        .where(eq(tenantBranding.tenantId, bareco.id));
    }
    expect((await put(bareOwner.cookie, NEW)).status).toBe(200);
  });

  it("BA12 the HR Suite saves its branding too (module platform)", async () => {
    const hrOwner = people.get("hr:owner")!;
    await harness.grantStepUp(hrOwner.cookie);
    const saved = await put(hrOwner.cookie, { ...NEW, displayName: "People First HR", monogram: "PF" });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await controlRow(peopleco)).displayName).toBe("People First HR");
    expect((await brandingAudits(peopleco)).at(-1)?.after).toMatchObject({ displayName: "People First HR" });
  });

  it("BA13 two saves at once: both answered, both audited in order, the later one stored", async () => {
    await harness.grantStepUp(owner.cookie);
    await put(owner.cookie, { ...NEW, monogram: "T0" }).expect(200);
    const audits = (await brandingAudits(floorco)).length;
    // Hold the control row while both saves start, so both reach their read of it before either
    // writes: without the save's own row lock, both would read the same `before`.
    const saves = await harness.control.db.transaction(async (tx) => {
      await tx
        .select({ id: tenantBranding.id })
        .from(tenantBranding)
        .where(eq(tenantBranding.tenantId, floorco.id))
        .for("update");
      const both = Promise.all([
        put(owner.cookie, { ...NEW, monogram: "T1" }),
        put(owner.cookie, { ...NEW, monogram: "T2" }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 750));
      return { both };
    });
    const [first, second] = await saves.both;
    expect([first.status, second.status]).toEqual([200, 200]);
    const entries = (await brandingAudits(floorco)).slice(audits);
    expect(entries).toHaveLength(2);
    expect(entries[1].before).toEqual(entries[0].after);
    expect((await controlRow(floorco)).monogram).toBe((entries[1].after as Branding).monogram);
  });
});
