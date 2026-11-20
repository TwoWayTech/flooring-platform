import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { productPermissions } from "@workspace/db";
import {
  auditLog,
  clockEntries,
  employees,
  payPeriods,
  rolePermissions,
  roles,
  settings,
  timesheets,
  userProfiles,
} from "@workspace/db/company";
import { tenantModuleOverrides } from "@workspace/db/control";
import {
  enabledModules,
  FEATURES,
  HR_MESSAGES,
  permissionsForModules,
  PRODUCT_ROLES,
  readableSections,
  roleTemplate,
  rolesRequireMfa,
  SENSITIVE_FIELDS,
  SETTINGS_SCOPE_MESSAGE,
  SETTINGS_SECTIONS,
  type CompanySettings,
  type FeatureKey,
  type HrSettings,
  type PermissionKey,
  type ProductKey,
  type SettingsAnswer,
} from "@workspace/shared";
import { asc, count, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAudited, permissionRequirement } from "../src/core/access/permission.decorators";
import { SAVED_MEANWHILE } from "../src/modules/settings/settings.service";
import { AuthHarness } from "./auth-harness";
import { platformHelpers } from "./support/platform-admins";

/** Summit's fixture settings, which the test companies copy. */
const SUMMIT = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json"), "utf8"),
) as { settings: CompanySettings };
const HR: HrSettings = SUMMIT.settings.hr;
const HR_CHANGED = "Settings → HR changed while this was being saved. Try again.";
const MONTHLY_WORDS = "California non-exempt staff must be paid at least twice a month.";

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

/** Every property name anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}

/**
 * Settings part 5 on the API (ADR 0059, part 5): `PUT /settings/hr` with its key, module, switch,
 * scope, strict body, shared rules, the schedule lock against recorded pay under the `hr` row's lock
 * (the one opening a pay period takes), the monthly rule, the step-up and one audit entry; and
 * `GET /settings` answering the section to its readers. Every case names its id first, for the
 * mutation runs.
 */
describe("Settings → HR on the API (needs the local PostgreSQL)", () => {
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
    Object.assign(floorco, await harness.provisionCompany("hrfloorco"));
    Object.assign(peopleco, await harness.provisionCompany("hrpeopleco", ["hr"]));
    Object.assign(bareco, await harness.provisionCompany("hrbareco"));
    Object.assign(otherco, await harness.provisionCompany("hrotherco"));
    for (const company of [floorco, peopleco, otherco]) await seedHr(company, HR);
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

  /** Writes a company's `hr` row. */
  function seedHr(company: TestCompany, value: object) {
    return withCompanyDb(company, (db) => db.insert(settings).values({ group: "hr", value }));
  }

  /** A fresh flooring company with Summit's HR settings and nothing recorded, and its Owner, stepped up. */
  async function freshCompany(name: string, hr: object = HR): Promise<{ company: TestCompany; owner: Member }> {
    const company: TestCompany = { ...(await harness.provisionCompany(name)), product: "flooring" };
    await seedHr(company, hr);
    const owner = await member(company, ["owner"]);
    await stepUp(owner);
    return { company, owner };
  }

  /** A signed-in member holding `roles` in `company`, enrolled in MFA when the roles need it. */
  async function member(company: TestCompany, held: string[], mfa = rolesRequireMfa(held)): Promise<Member> {
    const email = await harness.addUser({ companyIds: [company.id], roles: held });
    if (!mfa) return { cookie: await harness.signIn(email), email, secret: "" };
    const { cookie, secret } = await enrolled(email);
    return { cookie, email, secret };
  }

  /** The stored `hr` row of a company, or undefined. */
  function hrOf(company: TestCompany): Promise<unknown> {
    return withCompanyDb(company, async (db) => {
      const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, "hr"));
      return row?.value;
    });
  }

  /** How many audit entries a company has. */
  function auditCount(company: TestCompany): Promise<number> {
    return withCompanyDb(company, async (db) => (await db.select({ n: count() }).from(auditLog))[0].n);
  }

  /** A company's "Changed hr" audit entries, oldest first. */
  function hrAudits(company: TestCompany) {
    return withCompanyDb(company, (db) =>
      db.select().from(auditLog).where(eq(auditLog.action, "Changed hr")).orderBy(asc(auditLog.at)),
    );
  }

  /** `GET /settings` as `cookie`, which must answer 200. */
  async function answerOf(cookie: string): Promise<SettingsAnswer> {
    const response = await call("get", "/settings", cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as SettingsAnswer;
  }

  function put(cookie: string, body: unknown) {
    return call("put", "/settings/hr", cookie).send(body as object);
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
    expect(await hrOf(company)).toEqual(before);
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

  /** Inserts one live employee and gives back its id. */
  function addEmployee(company: TestCompany, over: Partial<typeof employees.$inferInsert> = {}): Promise<string> {
    return withCompanyDb(company, async (db) => {
      const [row] = await db
        .insert(employees)
        .values({
          name: "Avery Lane",
          workerType: "w2",
          payType: "hourly",
          payRate: "20.00",
          state: "CO",
          hiredAt: "2025-01-06",
          status: "active",
          flsaStatus: "non_exempt",
          ...over,
        })
        .returning();
      return row!.id;
    });
  }

  it("H0 the route declares the shared table: key, module hr and audit", async () => {
    const { SettingsController } = await import("../src/modules/settings/settings.controller");
    const reflector = new Reflector();
    const context = {
      getHandler: () => (SettingsController.prototype as unknown as Record<string, unknown>).saveHr,
      getClass: () => SettingsController,
    } as unknown as ExecutionContext;
    const requirement = permissionRequirement(reflector, context, "PUT");
    expect(requirement.permissions).toEqual(["settings.hr.manage"]);
    expect(requirement.permissions).toEqual(SETTINGS_SECTIONS.hr.keys);
    expect(requirement.module).toBe("hr");
    expect(isAudited(reflector, context)).toBe(true);
  });

  for (const company of [floorco, peopleco]) {
    for (const key of PRODUCT_ROLES[company.product]) {
      it(`H1 ${company.product} ${key}: GET /settings answers HR to its readers, as stored; PUT only with the key`, async () => {
        const person = people.get(`${company.product}:${key}`)!;
        const held = new Set(expectedPermissions(company.product, key));
        const reads = readableSections({
          permissions: held,
          modules: enabledModules([company.product], null, []),
        }).includes("hr");
        const body = await answerOf(person.cookie);
        if (reads) expect(body.hr).toEqual(await hrOf(company));
        else expect(body).not.toHaveProperty("hr");
        expect(keysOf(body.hr).filter((name) => name in SENSITIVE_FIELDS)).toEqual([]);
        // Every default role reads it: each holds its own timesheet's key (D6).
        expect(reads).toBe(true);
        const before = await hrOf(company);
        const audits = await auditCount(company);
        const response = await put(person.cookie, HR);
        const saves = held.has("settings.hr.manage") && roleTemplate(key).dataScope === "all";
        // Only the Owner and the HR manager hold the key; neither has stepped up yet.
        expect(saves).toBe(key === "owner" || key === "hr");
        expect(outcome(response), JSON.stringify(response.body)).toEqual(
          saves ? [403, "step_up_required"] : [403, "forbidden"],
        );
        await expectNothingChanged(company, before, audits);
      });
    }
  }

  it("H2 never saved: left out of the read; the first save writes the row with a null before, and pay periods follow it", async () => {
    const owner = await member(bareco, ["owner"]);
    expect(await answerOf(owner.cookie)).not.toHaveProperty("hr");
    expect(outcome(await call("post", "/pay-periods", owner.cookie).send({}))).toEqual([409, "settings_missing"]);
    await stepUp(owner);
    const value = { ...HR, payFrequency: "weekly" as const };
    const saved = await put(owner.cookie, value);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual(value);
    expect(await hrOf(bareco)).toEqual(value);
    expect((await answerOf(owner.cookie)).hr).toEqual(value);
    const [entry, ...more] = await hrAudits(bareco);
    expect(more).toEqual([]);
    expect(entry).toMatchObject({ category: "settings", targetType: "settings", targetLabel: "HR" });
    expect(entry!.before).toBeNull();
    expect(entry!.after).toEqual(value);
    const opened = await call("post", "/pay-periods", owner.cookie).send({});
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    expect(opened.body.frequency).toBe("weekly");
  });

  it("H3 the body is strict: unknown fields, wrong types and over-long text answer 400 before any step-up", async () => {
    const owner = people.get("flooring:owner")!;
    const before = await hrOf(floorco);
    const audits = await auditCount(floorco);
    const bodies: unknown[] = [
      { ...HR, unknown: "x" },
      { ...HR, holidays: [{ ...HR.holidays[0], unknown: "x" }] },
      { ...HR, workweekStartDay: "1" },
      { ...HR, payFrequency: 1 },
      { ...HR, clockEnabled: "true" },
      { ...HR, holidays: "none" },
      { ...HR, clockEnabled: undefined },
      { ...HR, payFrequency: "x".repeat(21) },
      { ...HR, holidays: [{ date: HR.holidays[0]!.date, name: "x".repeat(801) }] },
      [HR],
      null,
    ];
    for (const body of bodies)
      expect(outcome(await put(owner.cookie, body)), JSON.stringify(body)?.slice(0, 80)).toEqual([
        400,
        "invalid_request",
      ]);
    const long = await put(owner.cookie, { ...HR, payFrequency: "x".repeat(21) });
    expect(long.body.message).toBe(HR_MESSAGES.payFrequency);
    await expectNothingChanged(floorco, before, audits);
  });

  it("H4 the shared content rules answer 400 with their words, before any step-up", async () => {
    const owner = people.get("flooring:owner")!;
    const before = await hrOf(floorco);
    const audits = await auditCount(floorco);
    const day = HR.holidays[0]!;
    const cases: [object, string][] = [
      [{ workweekStartDay: 7 }, HR_MESSAGES.workweekStartDay],
      [{ workweekStartDay: 1.5 }, HR_MESSAGES.workweekStartDay],
      [{ payFrequency: "daily" }, HR_MESSAGES.payFrequency],
      [{ payPeriodAnchor: "2026-02-30" }, HR_MESSAGES.payPeriodAnchor],
      [{ payPeriodAnchor: "next monday" }, HR_MESSAGES.payPeriodAnchor],
      [{ holidays: [{ date: "2026-13-01", name: "Nope" }] }, HR_MESSAGES.holidayDate],
      [{ holidays: [{ date: day.date, name: "   " }] }, HR_MESSAGES.holidayName],
      [{ holidays: [{ date: day.date, name: "x".repeat(81) }] }, HR_MESSAGES.holidayName],
      [{ holidays: [day, { ...day, name: "Again" }] }, HR_MESSAGES.holidayTwice],
      [
        { holidays: Array.from({ length: 101 }, (_, i) => ({ date: day.date, name: `Day ${i}` })) },
        HR_MESSAGES.holidays,
      ],
    ];
    for (const [patch, message] of cases)
      expect(refusal(await put(owner.cookie, { ...HR, ...patch })), JSON.stringify(patch).slice(0, 80)).toEqual([
        400,
        "invalid_request",
        message,
      ]);
    await expectNothingChanged(floorco, before, audits);
  });

  it("H5 a step-up after the checks; then stored as sent, answered, and one audit entry per save", async () => {
    const hrManager = await member(floorco, ["hr"]);
    const value = {
      ...HR,
      showTeamCalendarToEmployees: !HR.showTeamCalendarToEmployees,
      holidays: [...HR.holidays, { date: "2027-12-24", name: "  Shop closed " }],
    };
    const before = await hrOf(floorco);
    const audits = (await hrAudits(floorco)).length;
    const others = await withCompanyDb(floorco, (db) =>
      db.select().from(settings).where(eq(settings.group, "numbers")),
    );
    expect(outcome(await put(hrManager.cookie, value))).toEqual([403, "step_up_required"]);
    expect(await hrOf(floorco)).toEqual(before);
    await stepUp(hrManager);
    const saved = await put(hrManager.cookie, value);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual(value);
    expect(await hrOf(floorco)).toEqual(value);
    expect((await answerOf(people.get("flooring:employee")!.cookie)).hr).toEqual(value);
    const entries = await hrAudits(floorco);
    expect(entries).toHaveLength(audits + 1);
    expect(entries.at(-1)).toMatchObject({ category: "settings", targetType: "settings", targetLabel: "HR" });
    expect(entries.at(-1)!.before).toEqual(before);
    expect(entries.at(-1)!.after).toEqual(value);
    expect(
      await withCompanyDb(floorco, (db) => db.select().from(settings).where(eq(settings.group, "numbers"))),
    ).toEqual(others);
    await put(hrManager.cookie, HR).expect(200);
  });

  it("H6 once a pay period exists, the frequency, the anchor and the workweek are fixed (409); holidays and switches still save", async () => {
    const { company, owner } = await freshCompany("hrsched");
    const changed = { ...HR, payFrequency: "weekly" as const, payPeriodAnchor: "2026-09-14", workweekStartDay: 0 };
    await put(owner.cookie, changed).expect(200);
    await put(owner.cookie, HR).expect(200);
    const opened = await call("post", "/pay-periods", owner.cookie).send({});
    expect(opened.status, JSON.stringify(opened.body)).toBe(201);
    const before = await hrOf(company);
    const audits = await auditCount(company);
    const locked: [object, string][] = [
      [{ payFrequency: "weekly" }, HR_MESSAGES.scheduleLocked],
      [{ payPeriodAnchor: "2026-09-14" }, HR_MESSAGES.scheduleLocked],
      [{ workweekStartDay: 0 }, HR_MESSAGES.workweekLocked],
    ];
    for (const [patch, message] of locked)
      expect(refusal(await put(owner.cookie, { ...HR, ...patch })), JSON.stringify(patch)).toEqual([
        409,
        "conflict",
        message,
      ]);
    await expectNothingChanged(company, before, audits);
    const rest = { ...HR, holidays: [], clockEnabled: !HR.clockEnabled, showPayToEmployees: !HR.showPayToEmployees };
    await put(owner.cookie, rest).expect(200);
    expect(await hrOf(company)).toEqual(rest);
    // A deleted period no longer fixes the schedule.
    await withCompanyDb(company, (db) => db.update(payPeriods).set({ deletedAt: new Date() }));
    await put(owner.cookie, { ...rest, payFrequency: "weekly" }).expect(200);
  });

  it("H7 recorded hours fix the workweek but not the pay frequency: a live timesheet, then a clock punch", async () => {
    const { company, owner } = await freshCompany("hrhours");
    const employeeId = await addEmployee(company);
    const [sheet] = await withCompanyDb(company, (db) =>
      db
        .insert(timesheets)
        .values({ employeeId, weekStart: "2026-11-09", status: "draft", source: "form" })
        .returning(),
    );
    const sunday = { ...HR, workweekStartDay: 0 };
    expect(refusal(await put(owner.cookie, sunday))).toEqual([409, "conflict", HR_MESSAGES.workweekLocked]);
    await put(owner.cookie, { ...HR, payFrequency: "weekly" }).expect(200);
    await withCompanyDb(company, (db) =>
      db.update(timesheets).set({ deletedAt: new Date() }).where(eq(timesheets.id, sheet!.id)),
    );
    await withCompanyDb(company, (db) =>
      db.insert(clockEntries).values({ employeeId, date: "2026-11-10", inAt: new Date("2026-11-10T15:00:00Z") }),
    );
    expect(refusal(await put(owner.cookie, sunday))).toEqual([409, "conflict", HR_MESSAGES.workweekLocked]);
    await withCompanyDb(company, (db) => db.update(clockEntries).set({ deletedAt: new Date() }));
    await put(owner.cookie, sunday).expect(200);
  });

  it("H8 monthly with California non-exempt staff is refused on a change of frequency only (ADR 0050 keeps it on)", async () => {
    const { company, owner } = await freshCompany("hrcalifornia");
    const carla = await addEmployee(company, { name: "Carla Cruz", state: "CA", flsaStatus: "non_exempt" });
    const monthly = { ...HR, payFrequency: "monthly" as const };
    const before = await hrOf(company);
    const audits = await auditCount(company);
    expect(refusal(await put(owner.cookie, monthly))).toEqual([400, "invalid_request", MONTHLY_WORDS]);
    await expectNothingChanged(company, before, audits);
    await put(owner.cookie, { ...HR, payFrequency: "semimonthly" }).expect(200);
    await withCompanyDb(company, (db) =>
      db.update(employees).set({ status: "terminated" }).where(eq(employees.id, carla)),
    );
    await put(owner.cookie, monthly).expect(200);
    // Already monthly: someone in California joins, and holidays and switches still save (D5).
    await addEmployee(company, { name: "Cruz Two", state: "CA", flsaStatus: "non_exempt" });
    await put(owner.cookie, { ...monthly, clockEnabled: !HR.clockEnabled }).expect(200);
    await put(owner.cookie, { ...HR, payFrequency: "weekly" }).expect(200);
  });

  it("H9 the checks run under the hr row's lock: a period opened while the save waits refuses it", async () => {
    const { company, owner } = await freshCompany("hrlock");
    const audits = await auditCount(company);
    // Hold the row as `PayPeriodsService.open` does, and open a period inside that hold. The save
    // waits for the row; without its own lock it would read no period (not yet committed) and pass.
    const waiting = await withCompanyDb(company, (db) =>
      db.transaction(async (tx) => {
        await tx.select({ id: settings.id }).from(settings).where(eq(settings.group, "hr")).for("update");
        await tx.insert(payPeriods).values({
          frequency: "biweekly",
          start: "2026-11-09",
          end: "2026-11-22",
          payDate: "2026-11-27",
          status: "open",
        });
        const save = put(owner.cookie, { ...HR, payFrequency: "weekly" }).then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 750));
        expect(await auditCount(company)).toBe(audits);
        return { save };
      }),
    );
    expect(refusal(await waiting.save)).toEqual([409, "conflict", HR_MESSAGES.scheduleLocked]);
    expect(await hrOf(company)).toEqual(HR);
    expect(await auditCount(company)).toBe(audits);
  });

  it("H10 the page's switch off answers the PUT 404, and the section is still read", async () => {
    const owner = people.get("flooring:owner")!;
    await withFeatureOff(SETTINGS_SECTIONS.hr.feature, async () => {
      expect((await put(owner.cookie, HR)).status).toBe(404);
      expect((await answerOf(owner.cookie)).hr).toEqual(await hrOf(floorco));
    });
  });

  it("H11 below company-wide scope the key is refused with the settings words, before any step-up", async () => {
    const roleId = await withCompanyDb(floorco, async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: "branch-hr-settings", name: "Branch HR settings", dataScope: "branch" as const })
        .returning();
      await db.insert(rolePermissions).values({ roleId: role!.id, permissionKey: "settings.hr.manage" });
      return role!.id;
    });
    const person = await member(floorco, ["branch-hr-settings"], true);
    const before = await hrOf(floorco);
    const audits = await auditCount(floorco);
    const refused = await put(person.cookie, HR);
    expect([refused.status, refused.body]).toEqual([403, { code: "forbidden", message: SETTINGS_SCOPE_MESSAGE }]);
    await expectNothingChanged(floorco, before, audits);
    await withCompanyDb(floorco, (db) => db.update(roles).set({ dataScope: "all" }).where(eq(roles.id, roleId)));
    expect(outcome(await put(person.cookie, HR))).toEqual([403, "step_up_required"]);
  });

  it("H12 the hr module switched off: the PUT is refused and the read leaves the section out", async () => {
    const owner = people.get("flooring:owner")!;
    await harness.control.db
      .insert(tenantModuleOverrides)
      .values({ tenantId: floorco.id, module: "hr", enabled: false });
    try {
      expect(outcome(await put(owner.cookie, HR))).toEqual([403, "module_not_enabled"]);
      expect(await answerOf(owner.cookie)).not.toHaveProperty("hr");
    } finally {
      await harness.control.db.delete(tenantModuleOverrides).where(eq(tenantModuleOverrides.tenantId, floorco.id));
    }
    expect(await answerOf(owner.cookie)).toHaveProperty("hr");
  });

  it("H13 another company's Owner changes only their own company's section", async () => {
    const otherOwner = await member(otherco, ["owner"]);
    await stepUp(otherOwner);
    const floorBefore = await hrOf(floorco);
    const value = { ...HR, showRatesToEmployees: !HR.showRatesToEmployees };
    await call("put", `/settings/hr?companyId=${floorco.id}`, otherOwner.cookie)
      .set("X-Company-Id", floorco.id)
      .set("X-Tenant-Id", floorco.id)
      .send(value)
      .expect(200);
    expect(await hrOf(otherco)).toEqual(value);
    expect(await hrOf(floorco)).toEqual(floorBefore);
  });

  it("H14 the HR Suite's HR manager saves its own section", async () => {
    const hrManager = await member(peopleco, ["hr"]);
    await stepUp(hrManager);
    const value = { ...HR, clockEnabled: !HR.clockEnabled };
    await put(hrManager.cookie, value).expect(200);
    expect(await hrOf(peopleco)).toEqual(value);
    expect((await answerOf(people.get("hr:employee")!.cookie)).hr).toEqual(value);
  });

  it("H15 two first saves at once: the one that finds the row taken meanwhile is refused (409), never written over it", async () => {
    const company: TestCompany = { ...(await harness.provisionCompany("hrfirst")), product: "flooring" };
    const owner = await member(company, ["owner"]);
    await stepUp(owner);
    const first = { ...HR, payFrequency: "weekly" as const };
    // The first save's insert, not yet committed: the second finds no row to lock, passes its
    // checks, and waits on the unique group index; without the refusal it would overwrite the first.
    const waiting = await withCompanyDb(company, (db) =>
      db.transaction(async (tx) => {
        await tx.insert(settings).values({ group: "hr", value: first });
        const save = put(owner.cookie, HR).then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 750));
        return { save };
      }),
    );
    expect(refusal(await waiting.save)).toEqual([409, "conflict", SAVED_MEANWHILE]);
    expect(await hrOf(company)).toEqual(first);
    expect(await hrAudits(company)).toEqual([]);
  });

  /** A company whose Settings → HR and payroll rule are saved, and an employee signed in and linked to their record. */
  async function hoursCompany(name: string): Promise<{ company: TestCompany; worker: Member }> {
    const company: TestCompany = { ...(await harness.provisionCompany(name)), product: "flooring" };
    await withCompanyDb(company, (db) =>
      db.insert(settings).values([
        { group: "hr", value: { ...HR, clockEnabled: true } },
        { group: "localization", value: { payroll: { overtimeRule: "federal", holidayState: "CO" } } },
      ]),
    );
    const worker = await member(company, ["employee"]);
    // Their record carries their sign-in's email, so an upload of their own rows finds them (H18).
    const employeeId = await addEmployee(company, { email: worker.email });
    const userId = await harness.userIdOf(worker.email);
    await withCompanyDb(company, (db) =>
      db.update(userProfiles).set({ employeeId }).where(eq(userProfiles.userId, userId)),
    );
    return { company, worker };
  }

  /**
   * Runs `write` while a Settings → HR save holds the `hr` row and moves the workweek, then commits
   * that save: the write waits for it and is refused, so no hours land on the old week.
   */
  async function whileWorkweekMoves(company: TestCompany, write: () => Promise<{ status: number; body: object }>) {
    const waiting = await withCompanyDb(company, (db) =>
      db.transaction(async (tx) => {
        await tx.select({ id: settings.id }).from(settings).where(eq(settings.group, "hr")).for("update");
        await tx
          .update(settings)
          .set({ value: { ...HR, clockEnabled: true, workweekStartDay: 0 } })
          .where(eq(settings.group, "hr"));
        const pending = write().then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 750));
        return { pending };
      }),
    );
    return waiting.pending;
  }

  it("H16 a timesheet saved while the workweek changes waits for the change and is refused, so no sheet lands on the old week", async () => {
    const { company, worker } = await hoursCompany("hrsheetrace");
    const employeeId = (await withCompanyDb(company, (db) => db.select({ id: employees.id }).from(employees)))[0]!.id;
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() - 21 - ((monday.getUTCDay() + 6) % 7));
    const weekStart = monday.toISOString().slice(0, 10);
    const saved = await whileWorkweekMoves(company, () =>
      call("put", "/timesheets", worker.cookie).send({
        employeeId,
        weekStart,
        days: ["8", "8", "8", "8", "8", "0", "0"],
        expectedDays: ["0", "0", "0", "0", "0", "0", "0"],
      }),
    );
    expect(refusal(saved)).toEqual([409, "conflict", HR_CHANGED]);
    expect(await withCompanyDb(company, (db) => db.select().from(timesheets))).toEqual([]);
  });

  it("H17 a clock-in while the workweek changes waits for the change and is refused", async () => {
    const { company, worker } = await hoursCompany("hrclockrace");
    const punched = await whileWorkweekMoves(company, () => call("post", "/clock/in", worker.cookie).send({}));
    expect(refusal(punched)).toEqual([409, "conflict", HR_CHANGED]);
    expect(await withCompanyDb(company, (db) => db.select().from(clockEntries))).toEqual([]);
    // Clocked in on the new workweek, then out while it moves back: the punch stays open, to retry.
    await call("post", "/clock/in", worker.cookie).send({}).expect(201);
    const out = await withCompanyDb(company, (db) =>
      db.transaction(async (tx) => {
        await tx.select({ id: settings.id }).from(settings).where(eq(settings.group, "hr")).for("update");
        await tx
          .update(settings)
          .set({ value: { ...HR, clockEnabled: true } })
          .where(eq(settings.group, "hr"));
        const pending = call("post", "/clock/out", worker.cookie)
          .send({})
          .then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 750));
        return { pending };
      }),
    );
    expect(refusal(await out.pending)).toEqual([409, "conflict", HR_CHANGED]);
    const [punch] = await withCompanyDb(company, (db) => db.select().from(clockEntries));
    expect(punch!.outAt).toBeNull();
  });

  it("H18 a timesheet upload while the workweek changes waits for the change and is refused, storing nothing", async () => {
    const { company, worker } = await hoursCompany("hruploadrace");
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() - 21 - ((monday.getUTCDay() + 6) % 7));
    const day = monday.toISOString().slice(0, 10);
    const uploaded = await whileWorkweekMoves(company, () =>
      call("post", "/timesheets/upload", worker.cookie).send({
        table: {
          headers: ["employee_email", "employee_external_id", "employee_name", "work_date", "hours_worked", "note"],
          rows: [[worker.email, "", "", day, "8", ""]],
        },
        fileName: "hours.csv",
        apply: true,
        own: true,
      }),
    );
    expect(refusal(uploaded)).toEqual([409, "conflict", HR_CHANGED]);
    expect(await withCompanyDb(company, (db) => db.select().from(timesheets))).toEqual([]);
    const uploads = await withCompanyDb(company, (db) =>
      db.select().from(auditLog).where(eq(auditLog.action, "Uploaded timesheet hours")),
    );
    expect(uploads).toEqual([]);
  });

  it("H19 a clock-out while the clock is switched off waits for the change and is refused; the punch stays open", async () => {
    const { company, worker } = await hoursCompany("hrclockoff");
    await call("post", "/clock/in", worker.cookie).send({}).expect(201);
    const sheetsBefore = await withCompanyDb(company, (db) => db.select().from(timesheets));
    const out = await withCompanyDb(company, (db) =>
      db.transaction(async (tx) => {
        await tx.select({ id: settings.id }).from(settings).where(eq(settings.group, "hr")).for("update");
        await tx
          .update(settings)
          .set({ value: { ...HR, clockEnabled: false } })
          .where(eq(settings.group, "hr"));
        const pending = call("post", "/clock/out", worker.cookie)
          .send({})
          .then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 750));
        return { pending };
      }),
    );
    expect(refusal(await out.pending)).toEqual([409, "conflict", HR_CHANGED]);
    const [punch] = await withCompanyDb(company, (db) => db.select().from(clockEntries));
    expect(punch!.outAt).toBeNull();
    expect(await withCompanyDb(company, (db) => db.select().from(timesheets))).toEqual(sheetsBefore);
  });
});
