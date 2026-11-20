import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { productPermissions } from "@workspace/db";
import { auditLog, outboxMessages, rolePermissions, roles, settings } from "@workspace/db/company";
import { tenantBranding, tenants } from "@workspace/db/control";
import {
  EMAIL_MESSAGES,
  enabledModules,
  FEATURES,
  permissionsForModules,
  PRODUCT_ROLES,
  readableSections,
  roleTemplate,
  rolesRequireMfa,
  SETTINGS_SCOPE_MESSAGE,
  SETTINGS_SECTIONS,
  type CompanySettings,
  type EmailSettings,
  type FeatureKey,
  type PermissionKey,
  type ProductKey,
  type SettingsAnswer,
} from "@workspace/shared";
import { asc, count, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAudited, permissionRequirement } from "../src/core/access/permission.decorators";
import { NotificationService } from "../src/core/notifications/notification.service";
import { TenantContext } from "../src/core/tenancy/tenant-context";
import { AuthHarness } from "./auth-harness";
import { platformHelpers } from "./support/platform-admins";

/** Summit's fixture settings, which the test companies copy. */
const SUMMIT = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json"), "utf8"),
) as { settings: CompanySettings };
const EMAIL: EmailSettings = SUMMIT.settings.email;
const NEVER_SAVED: EmailSettings = { senderName: "", replyTo: "", signature: "" };

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
 * Settings → Email on the API (ADR 0059, the bell and Outbox part, D7 to D10): `PUT /settings/email`
 * with its key, switch, scope, strict body, shared rule, a step-up on every save and one audit
 * entry; `GET /settings` answering it only to its manager; and the Outbox rows written with the
 * saved sender. Every case names its id first, for the mutation runs.
 */
describe("Settings → Email on the API (needs the local PostgreSQL)", () => {
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
    Object.assign(floorco, await harness.provisionCompany("mailfloorco"));
    Object.assign(peopleco, await harness.provisionCompany("mailpeopleco", ["hr"]));
    Object.assign(bareco, await harness.provisionCompany("mailbareco"));
    Object.assign(otherco, await harness.provisionCompany("mailotherco"));
    for (const company of [floorco, peopleco, otherco]) await seedEmail(company, EMAIL);
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

  /** Writes a company's `email` row. */
  function seedEmail(company: TestCompany, value: object) {
    return withCompanyDb(company, (db) => db.insert(settings).values({ group: "email", value }));
  }

  /** A signed-in member holding `roles` in `company`, enrolled in MFA when the roles need it. */
  async function member(company: TestCompany, held: string[], mfa = rolesRequireMfa(held)): Promise<Member> {
    const email = await harness.addUser({ companyIds: [company.id], roles: held });
    if (!mfa) return { cookie: await harness.signIn(email), email, secret: "" };
    const { cookie, secret } = await enrolled(email);
    return { cookie, email, secret };
  }

  /** The stored `email` row of a company, or undefined. */
  function emailOf(company: TestCompany): Promise<unknown> {
    return withCompanyDb(company, async (db) => {
      const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, "email"));
      return row?.value;
    });
  }

  /** How many audit entries a company has. */
  function auditCount(company: TestCompany): Promise<number> {
    return withCompanyDb(company, async (db) => (await db.select({ n: count() }).from(auditLog))[0]!.n);
  }

  /** A company's "Changed email and notifications" audit entries, oldest first. */
  function emailAudits(company: TestCompany) {
    return withCompanyDb(company, (db) =>
      db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "Changed email and notifications"))
        .orderBy(asc(auditLog.at)),
    );
  }

  /** `GET /settings` as `cookie`, which must answer 200. */
  async function answerOf(cookie: string): Promise<SettingsAnswer> {
    const response = await call("get", "/settings", cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as SettingsAnswer;
  }

  function put(cookie: string, body: unknown) {
    return call("put", "/settings/email", cookie).send(body as object);
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
    expect(await emailOf(company)).toEqual(before);
    expect(await auditCount(company)).toBe(audits);
  }

  /** The permissions a default role holds in a fresh company of one product. */
  function expectedPermissions(product: ProductKey, key: (typeof PRODUCT_ROLES)[ProductKey][number]): PermissionKey[] {
    const ceiling = new Set<PermissionKey>(productPermissions([product]));
    const enabled = new Set<PermissionKey>(permissionsForModules(enabledModules([product], null, [])));
    return roleTemplate(key).permissions.filter((permission) => ceiling.has(permission) && enabled.has(permission));
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

  /** Raises one quote email in a company through the notifications core, and gives back its Outbox row. */
  async function quoteEmail(company: TestCompany) {
    const tenant = TenantContext.forJob({
      id: company.id,
      status: "trial",
      products: [company.product],
      maintenanceMode: false,
      phase: "full",
      databaseStatus: "ready",
    });
    const sourceId = uuidv7();
    await harness.app.get(NotificationService).notify(tenant, null, {
      event: "quote.sent",
      source: { type: "quote", id: sourceId },
      to: [{ kind: "customer", id: uuidv7(), name: "Dana Rivera", email: "dana@rivera.example" }],
      values: { "customer.name": "Dana Rivera", "quote.number": "Q-1001", "quote.total": "$1,200.00" },
    });
    const [row] = await withCompanyDb(company, (db) =>
      db.select().from(outboxMessages).where(eq(outboxMessages.sourceId, sourceId)),
    );
    return row!;
  }

  it("ME0 the route declares the shared table: key, no module guard (platform) and audit", async () => {
    const { SettingsController } = await import("../src/modules/settings/settings.controller");
    const reflector = new Reflector();
    const context = {
      getHandler: () => (SettingsController.prototype as unknown as Record<string, unknown>).saveEmail,
      getClass: () => SettingsController,
    } as unknown as ExecutionContext;
    const requirement = permissionRequirement(reflector, context, "PUT");
    expect(requirement.permissions).toEqual(["settings.notifications.manage"]);
    expect(requirement.permissions).toEqual(SETTINGS_SECTIONS.email.keys);
    expect(SETTINGS_SECTIONS.email.module).toBe("platform");
    expect(requirement.module).toBeUndefined();
    expect(isAudited(reflector, context)).toBe(true);
  });

  for (const company of [floorco, peopleco]) {
    for (const key of PRODUCT_ROLES[company.product]) {
      it(`ME1 ${company.product} ${key}: GET /settings answers Email only to its manager, as stored; PUT only with the key`, async () => {
        const person = people.get(`${company.product}:${key}`)!;
        const held = new Set(expectedPermissions(company.product, key));
        const reads = readableSections({
          permissions: held,
          modules: enabledModules([company.product], null, []),
        }).includes("email");
        // Only the Owner holds settings.notifications.manage (D9).
        expect(reads).toBe(key === "owner");
        const body = await answerOf(person.cookie);
        if (reads) expect(body.email).toEqual(await emailOf(company));
        else expect(body).not.toHaveProperty("email");
        const before = await emailOf(company);
        const audits = await auditCount(company);
        const response = await put(person.cookie, { ...EMAIL, replyTo: "phish@elsewhere.example" });
        // The Owner holds the key but has not stepped up yet; nobody else holds it.
        expect(outcome(response), JSON.stringify(response.body)).toEqual(
          key === "owner" ? [403, "step_up_required"] : [403, "forbidden"],
        );
        await expectNothingChanged(company, before, audits);
      });
    }
  }

  it("ME2 never saved: answered empty, which sends as the company; the first save writes the row with a null before", async () => {
    const owner = await member(bareco, ["owner"]);
    expect((await answerOf(owner.cookie)).email).toEqual(NEVER_SAVED);
    const [branding] = await harness.control.db
      .select({ name: tenantBranding.displayName })
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, bareco.id));
    const [tenant] = await harness.control.db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, bareco.id));
    const companyName = branding?.name ?? tenant!.name;
    expect(companyName).not.toBe("");
    const first = await quoteEmail(bareco);
    expect([first.fromName, first.replyTo]).toEqual([companyName, ""]);
    expect(first.bodyText.endsWith("It is valid until .")).toBe(true);
    await stepUp(owner);
    const value: EmailSettings = { senderName: "", replyTo: "office@bare.example", signature: "Thanks,\nBare Co." };
    const saved = await put(owner.cookie, value);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual(value);
    expect(await emailOf(bareco)).toEqual(value);
    expect((await answerOf(owner.cookie)).email).toEqual(value);
    const [entry, ...more] = await emailAudits(bareco);
    expect(more).toEqual([]);
    expect(entry).toMatchObject({
      category: "settings",
      targetType: "settings",
      targetLabel: "Email and notifications",
    });
    expect(entry!.before).toBeNull();
    expect(entry!.after).toEqual(value);
    // The next message is written with the saved sender: still the company's name, the reply-to, the sign-off.
    const next = await quoteEmail(bareco);
    expect([next.fromName, next.replyTo]).toEqual([companyName, "office@bare.example"]);
    expect(next.bodyText.endsWith("\n\nThanks,\nBare Co.")).toBe(true);
  });

  it("ME3 the body is strict: unknown fields, wrong types, missing fields and over-long text answer 400 before any step-up", async () => {
    const owner = people.get("flooring:owner")!;
    const before = await emailOf(floorco);
    const audits = await auditCount(floorco);
    const bodies: unknown[] = [
      { ...EMAIL, unknown: "x" },
      { ...EMAIL, fromAddress: "ceo@elsewhere.example" },
      { ...EMAIL, senderName: 1 },
      { ...EMAIL, replyTo: ["a@b.co"] },
      { ...EMAIL, signature: null },
      { senderName: EMAIL.senderName, replyTo: EMAIL.replyTo },
      { ...EMAIL, signature: "x".repeat(5001) },
      [EMAIL],
      null,
    ];
    for (const body of bodies)
      expect(outcome(await put(owner.cookie, body)), JSON.stringify(body)?.slice(0, 80)).toEqual([
        400,
        "invalid_request",
      ]);
    const long = await put(owner.cookie, { ...EMAIL, signature: "x".repeat(5001) });
    expect(long.body.message).toBe(EMAIL_MESSAGES.signature);
    await expectNothingChanged(floorco, before, audits);
  });

  it("ME4 the shared rule answers 400 with its words, before any step-up", async () => {
    const owner = people.get("flooring:owner")!;
    const before = await emailOf(floorco);
    const audits = await auditCount(floorco);
    const cases: [Partial<EmailSettings>, string][] = [
      [{ senderName: "x".repeat(81) }, EMAIL_MESSAGES.senderName],
      [{ senderName: "Summit\r\nBcc: all@summit.example" }, EMAIL_MESSAGES.senderNameCharacters],
      [{ senderName: 'Bank "Billing"' }, EMAIL_MESSAGES.senderNameCharacters],
      [{ senderName: "Billing <pay@elsewhere.example>" }, EMAIL_MESSAGES.senderNameCharacters],
      [{ replyTo: "office" }, EMAIL_MESSAGES.replyTo],
      [{ replyTo: "a@b.co, c@d.co" }, EMAIL_MESSAGES.replyTo],
      [{ replyTo: "a@b.co\r\nBcc: c@d.co" }, EMAIL_MESSAGES.replyTo],
      [{ signature: "x".repeat(501) }, EMAIL_MESSAGES.signature],
    ];
    for (const [patch, message] of cases)
      expect(refusal(await put(owner.cookie, { ...EMAIL, ...patch })), JSON.stringify(patch).slice(0, 80)).toEqual([
        400,
        "invalid_request",
        message,
      ]);
    await expectNothingChanged(floorco, before, audits);
  });

  it("ME5 a step-up after the checks; then stored as sent, answered, one audit entry, other groups untouched, and used by the next message", async () => {
    const owner = await member(floorco, ["owner"]);
    const value: EmailSettings = {
      senderName: "Summit Billing",
      replyTo: "billing@summit.example",
      signature: "  The billing team ",
    };
    const before = await emailOf(floorco);
    const audits = (await emailAudits(floorco)).length;
    const others = await withCompanyDb(floorco, (db) =>
      db.select().from(settings).where(eq(settings.group, "numbers")),
    );
    expect(outcome(await put(owner.cookie, value))).toEqual([403, "step_up_required"]);
    expect(await emailOf(floorco)).toEqual(before);
    await stepUp(owner);
    const saved = await put(owner.cookie, value);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual(value);
    expect(await emailOf(floorco)).toEqual(value);
    expect((await answerOf(owner.cookie)).email).toEqual(value);
    const entries = await emailAudits(floorco);
    expect(entries).toHaveLength(audits + 1);
    expect(entries.at(-1)!.before).toEqual(before);
    expect(entries.at(-1)!.after).toEqual(value);
    expect(
      await withCompanyDb(floorco, (db) => db.select().from(settings).where(eq(settings.group, "numbers"))),
    ).toEqual(others);
    const row = await quoteEmail(floorco);
    expect([row.fromName, row.replyTo]).toEqual(["Summit Billing", "billing@summit.example"]);
    expect(row.bodyText.endsWith("\n\n  The billing team ")).toBe(true);
    await put(owner.cookie, EMAIL).expect(200);
  });

  it("ME6 the page's switch off answers the PUT 404 and leaves the section out of the read", async () => {
    const owner = people.get("flooring:owner")!;
    await withFeatureOff(SETTINGS_SECTIONS.email.feature, async () => {
      expect((await put(owner.cookie, EMAIL)).status).toBe(404);
      expect(await answerOf(owner.cookie)).not.toHaveProperty("email");
    });
    expect(await answerOf(owner.cookie)).toHaveProperty("email");
  });

  it("ME7 below company-wide scope the key is refused with the settings words, before any step-up", async () => {
    const roleId = await withCompanyDb(floorco, async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: "branch-email-settings", name: "Branch email settings", dataScope: "branch" as const })
        .returning();
      await db.insert(rolePermissions).values({ roleId: role!.id, permissionKey: "settings.notifications.manage" });
      return role!.id;
    });
    const person = await member(floorco, ["branch-email-settings"], true);
    await stepUp(person);
    const before = await emailOf(floorco);
    const audits = await auditCount(floorco);
    const refused = await put(person.cookie, { ...EMAIL, replyTo: "branch@elsewhere.example" });
    expect([refused.status, refused.body]).toEqual([403, { code: "forbidden", message: SETTINGS_SCOPE_MESSAGE }]);
    await expectNothingChanged(floorco, before, audits);
    // With company-wide scope the same key saves; it reads the section too (D9).
    await withCompanyDb(floorco, (db) => db.update(roles).set({ dataScope: "all" }).where(eq(roles.id, roleId)));
    expect((await answerOf(person.cookie)).email).toEqual(before);
    await put(person.cookie, EMAIL).expect(200);
  });

  it("ME8 a custom role with the key but no second factor can't save: the step-up needs one", async () => {
    await withCompanyDb(floorco, async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: "mail-settings", name: "Mail settings", dataScope: "all" as const })
        .returning();
      await db.insert(rolePermissions).values({ roleId: role!.id, permissionKey: "settings.notifications.manage" });
    });
    const person = await member(floorco, ["mail-settings"], false);
    const before = await emailOf(floorco);
    const audits = await auditCount(floorco);
    expect(outcome(await put(person.cookie, EMAIL))).toEqual([403, "step_up_mfa_required"]);
    await expectNothingChanged(floorco, before, audits);
  });

  it("ME9 another company's Owner changes only their own company's section", async () => {
    const otherOwner = await member(otherco, ["owner"]);
    await stepUp(otherOwner);
    const floorBefore = await emailOf(floorco);
    const value = { ...EMAIL, senderName: "Other Co" };
    await call("put", `/settings/email?companyId=${floorco.id}`, otherOwner.cookie)
      .set("X-Company-Id", floorco.id)
      .set("X-Tenant-Id", floorco.id)
      .send(value)
      .expect(200);
    expect(await emailOf(otherco)).toEqual(value);
    expect(await emailOf(floorco)).toEqual(floorBefore);
  });

  it("ME10 the HR Suite's Owner saves its own section", async () => {
    const owner = await member(peopleco, ["owner"]);
    await stepUp(owner);
    const value = { ...EMAIL, signature: "The people team" };
    await put(owner.cookie, value).expect(200);
    expect(await emailOf(peopleco)).toEqual(value);
  });
});
