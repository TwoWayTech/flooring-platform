import {
  auditLog,
  commissionAssignments,
  commissionPlans,
  commissionStatements,
  contractorPayments,
  employees,
  payPeriodExclusions,
  payPeriodLines,
  payPeriods,
  ptoRequests,
  rolePermissions,
  roles,
  settings,
  timeOffEntries,
  timeOffPolicies,
  userProfiles,
} from "@workspace/db/company";
import { tenantModuleOverrides } from "@workspace/db/control";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { addDays, FEATURES, PRODUCT_HEADER, workweekStartOf, type FeatureKey } from "@workspace/shared";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import type { Response } from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConflictException } from "@nestjs/common";
import { linkedOnce } from "../src/modules/hr/people.service";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";
import { NO_HOURS } from "./support/timesheet-week";

/** Today in the test company's time zone (America/Chicago), the day the API dates by. */
function companyDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** The monday of the workweek `weeksAgo` weeks before today's (the test workweek starts on Monday). */
function week(weeksAgo: number): string {
  return addDays(workweekStartOf(companyDay(), 1), -7 * weeksAgo);
}

/** The month (`yyyy-MM`) `back` months before the current one. */
function monthsAgo(back: number): string {
  const [year, month] = companyDay().slice(0, 7).split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1 - back, 1)).toISOString().slice(0, 7);
}

interface PortalBody {
  employee: Record<string, unknown> | null;
  ownPayRate: string | null;
  visible: { pay: boolean; commission: boolean; rates: boolean; teamCalendar: boolean; clock: boolean };
  weekStart: string;
  weekStartDay: number;
  timesheets: { id: string; employeeId: string; days: string[] }[];
  usesTimesheet: boolean;
  clock: { clockedInAt: string | null };
  balances: { policy: { id: string }; hours: string; pending: string }[];
  requests: { id: string; employeeId: string }[];
  pay: { period: Record<string, unknown> & { lines: unknown[]; excluded: unknown[] }; line: Record<string, string> }[];
  earnedThisYear: string;
  statements: { userId: string; month: string; status: string }[];
  assignment: { id: string; userId: string; acknowledgement: unknown } | null;
  plan: Record<string, unknown> | null;
  contractorPayments: { id: string; employeeId: string }[];
  teamOut: Record<string, unknown>[];
  teamNames: { id: string; name: string }[];
}

const PLAN_TARGET = "12345.00";

/** Settings → HR with every portal switch, overridden by `over`. */
function hrSettings(over: Record<string, unknown> = {}) {
  return {
    workweekStartDay: 1,
    clockEnabled: true,
    payFrequency: "weekly",
    payPeriodAnchor: week(20),
    showPayToEmployees: true,
    showCommissionToEmployees: false,
    showRatesToEmployees: false,
    showTeamCalendarToEmployees: true,
    ...over,
  };
}

/**
 * The employee portal on the API (employee-portal.md; ADR 0049; api-contract.md "Employee portal"):
 * the signed-in person's own data only, from the session and never from input; what each company
 * setting, feature switch and product hides; 1099 and unlinked people; the own-profile allow-list
 * with its audit entry; the clock switch on clock-in and clock-out; signing one's own plan; and
 * one's own documents.
 */
describe("employee portal API (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let hrSuite = { id: "", slug: "" };
  const ids = {
    ana: "",
    ben: "",
    cara: "",
    zed: "",
    dee: "",
    olga: "",
    hana: "",
    anaUser: "",
    benUser: "",
    deeUser: "",
    plan: "",
    benAssignment: "",
    deeAssignment: "",
    policy: "",
    benApproved: "",
    benPending: "",
    anaPending: "",
    approved: "",
    open: "",
    caraPay: "",
    zedPay: "",
  };
  const cookies = {
    owner: "",
    ana: "", // employee role, W-2 non-exempt, linked
    ben: "", // sales role, W-2 non-exempt, linked, on a plan with commission hidden
    cara: "", // employee role, 1099, linked
    dee: "", // sales role, W-2 exempt, linked, on a plan with commission shown for her
    free: "", // employee role, not linked to any employee
    noPortal: "", // a role without hr.portal.view
    hrSuite: "", // an employee in an HR Suite company, linked
  };

  function call(method: "get" | "post" | "put" | "patch", path: string, cookie?: string, product?: "hr") {
    let test = request(harness.app.getHttpServer())[method](path).set("X-Forwarded-Host", "localhost:3000");
    if (cookie) test = test.set("Cookie", cookie);
    if (product) test = test.set(PRODUCT_HEADER, product);
    return test;
  }

  /** Asserts a status and shows the body when it differs. */
  function status(response: Response, expected: number): void {
    expect(response.status, JSON.stringify(response.body)).toBe(expected);
  }

  /** Asserts one refusal: 400 with the one error body and this message. */
  function refused(response: Response, message: string): void {
    status(response, 400);
    expect(response.body).toEqual({ code: "invalid_request", message });
  }

  async function portal(cookie: string, product?: "hr"): Promise<PortalBody> {
    const read = await call("get", "/me/portal", cookie, product);
    status(read, 200);
    return read.body as PortalBody;
  }

  async function enrolled(email: string) {
    const first = await harness.signIn(email);
    const enabled = await harness.post("/api/auth/two-factor/enable").set("Cookie", first).send({ password: PASSWORD });
    const secret = totpSecretFromUri(enabled.body.totpURI as string);
    const confirmed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", first)
      .send({ code: totpCode(secret) });
    return sessionCookie(confirmed.headers["set-cookie"]);
  }

  async function rows<T>(
    read: (db: Awaited<ReturnType<typeof harness.companyDb>>["db"]) => Promise<T>,
    companyId = company.id,
  ): Promise<T> {
    const handle = await harness.companyDb(companyId);
    try {
      return await read(handle.db);
    } finally {
      await handle.close();
    }
  }

  async function person(over: Partial<typeof employees.$inferInsert>, companyId = company.id) {
    return rows(
      async (db) =>
        (
          await db
            .insert(employees)
            .values({
              name: "Test Person",
              workerType: "w2",
              payType: "hourly",
              payRate: "24.50",
              state: "TX",
              hiredAt: "2024-01-08",
              status: "active",
              flsaStatus: "non_exempt",
              ...over,
            })
            .returning()
        )[0]!,
      companyId,
    );
  }

  /** A member of a company with these roles, linked to `employeeId` when given. */
  async function member(roleKeys: string[], employeeId: string | null, companyId = company.id) {
    const email = await harness.addUser({ companyIds: [companyId], roles: roleKeys });
    const userId = await harness.userIdOf(email);
    if (employeeId) {
      await rows((db) => db.update(userProfiles).set({ employeeId }).where(eq(userProfiles.userId, userId)), companyId);
    }
    return { email, userId };
  }

  async function setHr(over: Record<string, unknown> = {}) {
    await rows((db) =>
      db
        .update(settings)
        .set({ value: hrSettings(over) })
        .where(eq(settings.group, "hr")),
    );
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

  async function auditOf(action: string, targetId?: string) {
    const found = await rows((db) => db.select().from(auditLog).where(eq(auditLog.action, action)));
    return targetId ? found.filter((entry) => entry.targetId === targetId) : found;
  }

  /** A stored pay line with every figure zero but the ones given. */
  function payLine(payPeriodId: string, employeeId: string, over: Partial<typeof payPeriodLines.$inferInsert>) {
    return {
      payPeriodId,
      employeeId,
      hoursWorked: "40",
      overtimeHours: "0",
      doubleTimeHours: "0",
      paidLeaveHours: "0",
      unpaidLeaveHours: "0",
      baseRate: "24.50",
      straightTimePay: "980.00",
      overtimePremium: "0.00",
      paidLeavePay: "0.00",
      salaryAmount: "0.00",
      salaryDeduction: "0.00",
      commissionPay: "0.00",
      nondiscretionaryBonus: "0.00",
      discretionaryBonus: "0.00",
      overtimeTrueUp: "0.00",
      grossPay: "980.00",
      ...over,
    };
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("portal");
    hrSuite = await harness.provisionCompany("portalhr", ["hr"]);
    for (const companyId of [company.id, hrSuite.id]) {
      await rows(
        (db) =>
          db
            .insert(settings)
            .values([
              { group: "hr", value: hrSettings() },
              { group: "localization", value: { payroll: { overtimeRule: "federal" } } },
            ])
            .onConflictDoNothing(),
        companyId,
      );
    }
    await rows(async (db) => {
      const [role] = await db.insert(roles).values({ key: "noportal", name: "noportal", dataScope: "all" }).returning();
      await db.insert(rolePermissions).values({ roleId: role!.id, permissionKey: "customers.customer.view" });
    });
    const ana = await person({
      name: "Ana Alvarez",
      phone: "555-0101",
      emergencyContact: { name: "Sam Alvarez", phone: "555-0102", relation: "Brother" },
    });
    const ben = await person({ name: "Ben Brooks", payRate: "31.00" });
    const cara = await person({
      name: "Cara Contractor",
      workerType: "1099",
      payType: "per_job",
      payRate: "0.00",
      flsaStatus: "not_applicable",
    });
    const zed = await person({
      name: "Zed Zimmer",
      workerType: "1099",
      payType: "per_job",
      payRate: "0.00",
      flsaStatus: "not_applicable",
    });
    const dee = await person({
      name: "Dee Dalton",
      payType: "salary",
      payRate: "60000.00",
      flsaStatus: "exempt",
      exemptionBasis: "outside_sales",
      commissionVisible: true,
    });
    const olga = await person({ name: "Olga Owner", payRate: "99.00" });
    const hana = await person({ name: "Hana Hollis" }, hrSuite.id);
    const gone = await person({ name: "Gil Gone", status: "terminated" });
    Object.assign(ids, {
      ana: ana.id,
      ben: ben.id,
      cara: cara.id,
      zed: zed.id,
      dee: dee.id,
      olga: olga.id,
      hana: hana.id,
    });

    const anaUser = await member(["employee"], ana.id);
    const benUser = await member(["sales"], ben.id);
    const caraUser = await member(["employee"], cara.id);
    const deeUser = await member(["sales"], dee.id);
    const freeUser = await member(["employee"], null);
    const noPortal = await member(["noportal"], null);
    const owner = await member(["owner"], olga.id);
    const hrSuiteUser = await member(["employee"], hana.id, hrSuite.id);
    ids.anaUser = anaUser.userId;
    ids.benUser = benUser.userId;
    ids.deeUser = deeUser.userId;

    await rows(async (db) => {
      const [plan] = await db
        .insert(commissionPlans)
        .values({
          name: "Portal plan",
          version: 1,
          status: "active",
          effectiveFrom: "2024-01-01",
          basis: "paid_revenue",
          baseRatePct: "4",
          monthlyTarget: PLAN_TARGET,
          tierMode: "marginal",
          tiers: [{ fromPctOfTarget: "100", ratePct: "6" }],
          draw: { kind: "recoverable", monthlyAmount: "750.00" },
          clawbackDays: 90,
        })
        .returning();
      ids.plan = plan!.id;
      const [benA, deeA] = await db
        .insert(commissionAssignments)
        .values([
          { userId: benUser.userId, planId: plan!.id, effectiveFrom: "2024-01-01" },
          { userId: deeUser.userId, planId: plan!.id, effectiveFrom: "2024-01-01" },
        ])
        .returning();
      ids.benAssignment = benA!.id;
      ids.deeAssignment = deeA!.id;
      // Seeded history: one paid month each, so each rep has a statement to list.
      await db.insert(commissionStatements).values([
        { userId: benUser.userId, month: monthsAgo(2), status: "paid" },
        { userId: deeUser.userId, month: monthsAgo(2), status: "paid" },
      ]);

      const [policy] = await db
        .insert(timeOffPolicies)
        .values({ name: "Vacation", kind: "vacation", paid: true, accrualMethod: "none", accrualRate: "0" })
        .returning();
      ids.policy = policy!.id;
      await db.insert(timeOffEntries).values([
        { employeeId: ana.id, policyId: policy!.id, date: week(10), kind: "adjustment", hours: "16", note: "Opening" },
        { employeeId: ben.id, policyId: policy!.id, date: week(10), kind: "adjustment", hours: "40", note: "Opening" },
      ]);
      const [benApproved, benPending, anaPending] = await db
        .insert(ptoRequests)
        .values([
          {
            employeeId: ben.id,
            policyId: policy!.id,
            start: addDays(week(0), 14),
            end: addDays(week(0), 15),
            hours: "16",
            kind: "sick",
            status: "approved",
            note: "Private medical note",
            decisionReason: "Get well soon",
          },
          {
            employeeId: ben.id,
            policyId: policy!.id,
            start: addDays(week(0), 21),
            end: addDays(week(0), 21),
            hours: "8",
            kind: "vacation",
            status: "pending",
            note: "Ben pending",
          },
          {
            employeeId: ana.id,
            policyId: policy!.id,
            start: addDays(week(0), 28),
            end: addDays(week(0), 28),
            hours: "8",
            kind: "vacation",
            status: "pending",
            note: "Ana pending",
          },
        ])
        .returning();
      ids.benApproved = benApproved!.id;
      // Neither an absence that ended long ago nor one of someone who has left is on the team calendar.
      await db.insert(ptoRequests).values([
        {
          employeeId: ben.id,
          policyId: policy!.id,
          start: week(30),
          end: week(30),
          hours: "8",
          kind: "vacation",
          status: "approved",
        },
        {
          employeeId: gone.id,
          policyId: policy!.id,
          start: addDays(week(0), 14),
          end: addDays(week(0), 14),
          hours: "8",
          kind: "vacation",
          status: "approved",
        },
      ]);
      ids.benPending = benPending!.id;
      ids.anaPending = anaPending!.id;

      const end = addDays(week(3), 6);
      const [approved, open] = await db
        .insert(payPeriods)
        .values([
          { frequency: "weekly", start: week(3), end, payDate: addDays(end, 5), status: "approved" },
          {
            frequency: "weekly",
            start: week(2),
            end: addDays(week(2), 6),
            payDate: addDays(week(2), 11),
            status: "open",
          },
        ])
        .returning();
      ids.approved = approved!.id;
      ids.open = open!.id;
      await db.insert(payPeriodLines).values([
        payLine(approved!.id, ana.id, { grossPay: "1000.00", commissionPay: "0.00" }),
        payLine(approved!.id, ben.id, {
          baseRate: "31.00",
          straightTimePay: "1240.00",
          commissionPay: "300.00",
          overtimeTrueUp: "12.50",
          grossPay: "1552.50",
          // The weekly breakdown carries the commission in its earnings and regular rate.
          weeks: [
            {
              weekStart: week(3),
              weekEnd: end,
              hoursWorked: "40",
              overtimeHours: "0",
              doubleTimeHours: "0",
              allocatedEarnings: "301.23",
              regularRate: "38.53",
              overtimePremium: "0.00",
              straddlesPeriod: false,
            },
          ],
        }),
        payLine(approved!.id, olga.id, { baseRate: "99.00", straightTimePay: "3960.00", grossPay: "3960.00" }),
        // A stored line on an open run is never shown: only approved or exported runs are pay.
        payLine(open!.id, ana.id, { grossPay: "777.00" }),
      ]);
      await db
        .insert(payPeriodExclusions)
        .values({ payPeriodId: approved!.id, employeeId: dee.id, reason: "On leave" });
      const [caraPay, zedPay] = await db
        .insert(contractorPayments)
        .values([
          { employeeId: cara.id, date: week(4), description: "Install job", amount: "640.00", status: "paid" },
          { employeeId: zed.id, date: week(4), description: "Zed job", amount: "910.00", status: "approved" },
        ])
        .returning();
      ids.caraPay = caraPay!.id;
      ids.zedPay = zedPay!.id;
    });

    cookies.owner = await enrolled(owner.email);
    cookies.ana = await harness.signIn(anaUser.email);
    cookies.ben = await harness.signIn(benUser.email);
    cookies.cara = await harness.signIn(caraUser.email);
    cookies.dee = await harness.signIn(deeUser.email);
    cookies.free = await harness.signIn(freeUser.email);
    cookies.noPortal = await harness.signIn(noPortal.email);
    cookies.hrSuite = await harness.signIn(hrSuiteUser.email);

    // Own hours through the API, a week each, so each person has a sheet.
    for (const [cookie, employeeId] of [
      [cookies.ana, ids.ana],
      [cookies.ben, ids.ben],
    ] as const) {
      const saved = await call("put", "/timesheets", cookie).send({
        employeeId,
        weekStart: week(5),
        days: ["8", "8", "8", "8", "8", "0", "0"],
        expectedDays: NO_HOURS,
      });
      status(saved, 200);
    }
  }, 300_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("holds every portal route to hr.portal.view, the hr.portal switch and the hr module, and refuses the signed-out", async () => {
    const some = uuidv7();
    const routes = [
      { method: "get", path: "/me/portal" },
      { method: "patch", path: "/me/employee" },
      { method: "post", path: `/commission-assignments/${some}/acknowledge` },
    ] as const;
    for (const route of routes) {
      const label = `${route.method} ${route.path}`;
      expect((await call(route.method, route.path).send({})).status, `anonymous ${label}`).toBe(401);
      expect((await call(route.method, route.path, cookies.noPortal).send({})).status, `no key ${label}`).toBe(403);
    }
    await withFeatureOff("hr.portal", async () => {
      for (const route of routes) {
        status(await call(route.method, route.path, cookies.ana).send({}), 404);
      }
      // The clock lives in the portal, so it goes with it.
      status(await call("post", "/clock/in", cookies.ana), 404);
      status(await call("post", "/clock/out", cookies.ana), 404);
    });
    await harness.control.db
      .insert(tenantModuleOverrides)
      .values({ tenantId: company.id, module: "hr", enabled: false });
    try {
      const off = await call("get", "/me/portal", cookies.ana);
      expect(off.status).toBe(403);
      expect(off.body.code).toBe("module_not_enabled");
    } finally {
      await harness.control.db.delete(tenantModuleOverrides).where(eq(tenantModuleOverrides.tenantId, company.id));
    }
    status(await call("get", "/me/portal", cookies.ana), 200);
  });

  it("returns only the signed-in person's own records, whatever the request names", async () => {
    // A person id or company in the query or body changes nothing: the session decides.
    const read = await call(
      "get",
      `/me/portal?employeeId=${ids.ben}&userId=${ids.benUser}&companyId=${hrSuite.id}`,
      cookies.ana,
    );
    status(read, 200);
    const mine = read.body as PortalBody;
    expect(mine.employee).toMatchObject({ id: ids.ana, name: "Ana Alvarez" });
    expect(mine.timesheets.length).toBeGreaterThan(0);
    expect(mine.timesheets.every((s) => s.employeeId === ids.ana)).toBe(true);
    expect(mine.timesheets[0]!.days).toEqual(["8", "8", "8", "8", "8", "0", "0"]);
    expect(mine.requests.map((r) => r.id)).toEqual([ids.anaPending]);
    expect(mine.balances).toEqual([
      expect.objectContaining({
        policy: expect.objectContaining({ id: ids.policy }),
        hours: "16.000",
        pending: "8.000",
      }),
    ]);
    expect(mine.pay.map((row) => row.line.employeeId)).toEqual([ids.ana]);
    expect(mine.contractorPayments).toEqual([]);
    expect(mine.weekStart).toBe(week(0));
    expect(mine.weekStartDay).toBe(1);
    expect(mine.usesTimesheet).toBe(true);
    // Nobody else's records, notes, pay or rate appear anywhere in the answer.
    const text = JSON.stringify(mine);
    for (const secret of [
      ids.benPending,
      "Ben pending",
      "Private medical note",
      "Get well soon",
      "1552.50",
      "31.00",
      "3960.00",
      ids.zedPay,
      PLAN_TARGET,
    ]) {
      expect(text, secret).not.toContain(secret);
    }
    const bens = await portal(cookies.ben);
    expect(bens.employee).toMatchObject({ id: ids.ben });
    // Ben's own three requests (one long past), all his, and his own notes on them.
    expect(bens.requests).toHaveLength(3);
    expect(bens.requests.every((r) => r.employeeId === ids.ben)).toBe(true);
    expect(bens.requests.map((r) => r.id)).toEqual(expect.arrayContaining([ids.benApproved, ids.benPending]));
    expect(JSON.stringify(bens)).not.toContain("Ana pending");
  });

  it("sends pay only from approved runs, without others' lines, exclusions or rates, and with hidden commission taken out", async () => {
    const ana = await portal(cookies.ana);
    expect(ana.visible.pay).toBe(true);
    expect(ana.pay).toHaveLength(1);
    const [row] = ana.pay;
    expect(row!.period).toMatchObject({ id: ids.approved, status: "approved", lines: [], excluded: [] });
    expect(row!.line).toMatchObject({ employeeId: ids.ana, grossPay: "1000.00", hoursWorked: "40.00" });
    // Rates need hr.employee.view_sensitive (CLAUDE.md rule 5), which the Employee role lacks.
    expect(row!.line).not.toHaveProperty("baseRate");
    expect(ana.employee).not.toHaveProperty("payRate");
    const year = companyDay().slice(0, 4);
    expect(ana.earnedThisYear).toBe((row!.period.payDate as string).startsWith(year) ? "1000.00" : "0.00");

    // Ben's commission is hidden (company default off), so it and its true-up leave the line and the total.
    const ben = await portal(cookies.ben);
    expect(ben.visible.commission).toBe(false);
    expect(ben.pay[0]!.line).toMatchObject({
      commissionPay: "0.00",
      overtimeTrueUp: "0.00",
      grossPay: "1240.00",
      weeks: [],
    });
    expect(JSON.stringify(ben)).not.toContain("301.23");

    await setHr({ showPayToEmployees: false });
    try {
      const hidden = await portal(cookies.ana);
      expect(hidden.visible.pay).toBe(false);
      expect(hidden.pay).toEqual([]);
      expect(hidden.earnedThisYear).toBe("0.00");
    } finally {
      await setHr();
    }
    await withFeatureOff("hr.pay-periods", async () => {
      expect((await portal(cookies.ana)).pay).toEqual([]);
    });
  });

  it("sends one's own pay rate whenever the company shows rates, and nobody else's anywhere", async () => {
    for (const cookie of [cookies.owner, cookies.ana]) {
      const off = await portal(cookie);
      expect(off.visible.rates).toBe(false);
      expect(off.ownPayRate).toBeNull();
      expect(off.employee).not.toHaveProperty("payRate");
    }
    await setHr({ showRatesToEmployees: true });
    try {
      // Owner decision 2026-11-14 (ADR 0049): the setting alone shows a person their own rate, so
      // the Employee role, without hr.employee.view_sensitive, sees Ana's.
      const ana = await portal(cookies.ana);
      expect(ana.visible.rates).toBe(true);
      expect(ana.ownPayRate).toBe("24.50");
      // The record never carries the rate, and a pay line's rate is still stripped (CLAUDE.md rule 5).
      expect(ana.employee).not.toHaveProperty("payRate");
      expect(ana.pay[0]!.line).not.toHaveProperty("baseRate");
      // Nobody else's rate is reachable through any portal route, whatever the request names.
      const named = await call("get", `/me/portal?employeeId=${ids.ben}&userId=${ids.benUser}`, cookies.ana);
      status(named, 200);
      expect((named.body as PortalBody).ownPayRate).toBe("24.50");
      const saved = await call("patch", "/me/employee", cookies.ana).send({
        phone: "555-0101",
        emergencyContact: { name: "Sam Alvarez", phone: "555-0102", relation: "Brother" },
      });
      status(saved, 200);
      for (const body of [ana, named.body, saved.body]) {
        const text = JSON.stringify(body);
        for (const other of ["31.00", "60000.00", "99.00"]) expect(text, other).not.toContain(other);
      }
      expect(saved.body).not.toHaveProperty("payRate");
      // Every other endpoint still strips rates without view_sensitive.
      const people = await call("get", "/employees", cookies.ana);
      if (people.status === 200) expect(JSON.stringify(people.body)).not.toContain("payRate");
      else status(people, 403);
      const owner = await portal(cookies.owner);
      expect(owner.ownPayRate).toBe("99.00");
      expect(owner.employee).not.toHaveProperty("payRate");
      expect(owner.pay[0]!.line).toMatchObject({ baseRate: "99.00" });
      // Someone with no employee record has no rate.
      expect((await portal(cookies.free)).ownPayRate).toBeNull();
    } finally {
      await setHr();
    }
  });

  it("sends an Employee's and a Manager's own pay line with every figure My pay reads, and no rate or salary (finding #26)", async () => {
    // The figures the My pay screen formats; each must arrive as a decimal string for these roles.
    const READ = [
      "hoursWorked",
      "overtimeHours",
      "paidLeaveHours",
      "unpaidLeaveHours",
      "straightTimePay",
      "overtimePremium",
      "paidLeavePay",
      "nondiscretionaryBonus",
      "discretionaryBonus",
      "commissionPay",
      "overtimeTrueUp",
      "salaryDeduction",
      "grossPay",
    ];
    const sal = await person({
      name: "Sal Salaried",
      payType: "salary",
      payRate: "52520.00",
      flsaStatus: "exempt",
      exemptionBasis: "administrative",
    });
    const max = await person({ name: "Max Manager", payRate: "33.25" });
    const salUser = await member(["employee"], sal.id);
    const maxUser = await member(["manager"], max.id);
    await rows((db) =>
      db.insert(payPeriodLines).values([
        payLine(ids.approved, sal.id, {
          baseRate: "0.00",
          straightTimePay: "0.00",
          salaryAmount: "1010.00",
          grossPay: "1010.00",
        }),
        payLine(ids.approved, max.id, { baseRate: "33.25", straightTimePay: "1330.00", grossPay: "1330.00" }),
      ]),
    );
    const cases = [
      { cookie: await harness.signIn(salUser.email), id: sal.id, payType: "salary", gross: "1010.00" },
      { cookie: await harness.signIn(maxUser.email), id: max.id, payType: "hourly", gross: "1330.00" },
    ];
    for (const { cookie, id, payType, gross } of cases) {
      const body = await portal(cookie);
      expect(body.visible.pay).toBe(true);
      // The screen tells salary from hours pay by the record's pay type, which travels.
      expect(body.employee).toMatchObject({ id, payType });
      expect(body.pay).toHaveLength(1);
      const { line } = body.pay[0]!;
      for (const field of READ) expect(line[field], field).toMatch(/^-?\d+(\.\d+)?$/);
      expect(line.grossPay).toBe(gross);
      // Neither role holds hr.employee.view_sensitive, so the reserved pay-rate names stay stripped
      // (CLAUDE.md rule 5): the line's rate and the period's salary, which gives the annual salary away.
      expect(line).not.toHaveProperty("baseRate");
      expect(line).not.toHaveProperty("salaryAmount");
      expect(body.employee).not.toHaveProperty("payRate");
      const text = JSON.stringify(body);
      for (const secret of ["52520.00", "33.25"]) expect(text, secret).not.toContain(secret);
    }
    // The owner, who holds view_sensitive, still gets the full line.
    const owner = await portal(cookies.owner);
    expect(owner.pay[0]!.line).toHaveProperty("salaryAmount", "0.00");
  });

  it("gives someone who has left no team calendar and no clock", async () => {
    await rows((db) => db.update(employees).set({ status: "terminated" }).where(eq(employees.id, ids.ana)));
    try {
      const gone = await portal(cookies.ana);
      expect(gone.visible).toMatchObject({ teamCalendar: false, clock: false });
      expect(gone.teamOut).toEqual([]);
      expect(gone.teamNames).toEqual([]);
    } finally {
      await rows((db) => db.update(employees).set({ status: "active" }).where(eq(employees.id, ids.ana)));
    }
    expect((await portal(cookies.ana)).visible).toMatchObject({ teamCalendar: true, clock: true });
  });

  it("shows colleagues' approved time off as out, never why, only while the company shows the calendar", async () => {
    const ana = await portal(cookies.ana);
    expect(ana.visible.teamCalendar).toBe(true);
    expect(ana.teamOut).toEqual([
      {
        id: ids.benApproved,
        employeeId: ids.ben,
        policyId: "",
        start: addDays(week(0), 14),
        end: addDays(week(0), 15),
        hours: "",
        kind: "vacation",
        status: "approved",
        note: "",
        decidedBy: null,
        decidedAt: null,
        decisionReason: null,
      },
    ]);
    expect(ana.teamNames).toEqual([{ id: ids.ben, name: "Ben Brooks" }]);
    await setHr({ showTeamCalendarToEmployees: false });
    try {
      const hidden = await portal(cookies.ana);
      expect(hidden.visible.teamCalendar).toBe(false);
      expect(hidden.teamOut).toEqual([]);
      expect(hidden.teamNames).toEqual([]);
    } finally {
      await setHr();
    }
    // Someone not linked to an employee gets no team calendar either.
    expect((await portal(cookies.free)).teamOut).toEqual([]);
  });

  it("keeps statements and plan terms on the server when commission is hidden, and sends one's own when shown", async () => {
    const ben = await portal(cookies.ben);
    expect(ben.visible.commission).toBe(false);
    expect(ben.statements).toEqual([]);
    expect(ben.assignment).toBeNull();
    expect(ben.plan).toBeNull();
    const benText = JSON.stringify(ben);
    for (const term of [PLAN_TARGET, "Portal plan", "750.00", ids.benAssignment])
      expect(benText, term).not.toContain(term);

    const dee = await portal(cookies.dee);
    expect(dee.visible.commission).toBe(true);
    expect(dee.assignment).toMatchObject({ id: ids.deeAssignment, userId: ids.deeUser, acknowledgement: null });
    expect(dee.plan).toMatchObject({ id: ids.plan, name: "Portal plan", monthlyTarget: PLAN_TARGET });
    expect(dee.statements.length).toBeGreaterThan(0);
    expect(dee.statements.every((s) => s.userId === ids.deeUser)).toBe(true);
    expect(dee.statements.some((s) => s.month === monthsAgo(2) && s.status === "paid")).toBe(true);
    expect(JSON.stringify(dee)).not.toContain(ids.benUser);

    // The company switch shows Ben's too; the person's own setting still wins for Dee.
    await setHr({ showCommissionToEmployees: true });
    try {
      expect((await portal(cookies.ben)).visible.commission).toBe(true);
    } finally {
      await setHr();
    }
    await withFeatureOff("hr.commissions", async () => {
      const off = await portal(cookies.dee);
      expect(off.visible.commission).toBe(false);
      expect(off.statements).toEqual([]);
      expect(off.plan).toBeNull();
    });
  });

  it("gives a 1099 worker no timesheet, time off, pay or clock, and only their own payments", async () => {
    const cara = await portal(cookies.cara);
    expect(cara.employee).toMatchObject({ id: ids.cara, workerType: "1099" });
    expect(cara.visible).toMatchObject({ pay: false, commission: false, clock: false });
    expect(cara.usesTimesheet).toBe(false);
    expect(cara.timesheets).toEqual([]);
    expect(cara.balances).toEqual([]);
    expect(cara.requests).toEqual([]);
    expect(cara.pay).toEqual([]);
    expect(cara.clock.clockedInAt).toBeNull();
    // The team calendar is on My time off, which a 1099 worker does not have (rule 11).
    expect(cara.visible.teamCalendar).toBe(false);
    expect(cara.teamOut).toEqual([]);
    expect(cara.teamNames).toEqual([]);
    expect(cara.contractorPayments.map((p) => p.id)).toEqual([ids.caraPay]);
    expect(JSON.stringify(cara)).not.toContain("Zed job");
  });

  it("gives an unlinked person a plain overview with nothing in it", async () => {
    const free = await portal(cookies.free);
    expect(free).toMatchObject({
      employee: null,
      visible: { pay: false, commission: false, clock: false },
      usesTimesheet: false,
      timesheets: [],
      balances: [],
      requests: [],
      pay: [],
      earnedThisYear: "0.00",
      statements: [],
      assignment: null,
      plan: null,
      contractorPayments: [],
      clock: { clockedInAt: null },
    });
    refused(
      await call("patch", "/me/employee", cookies.free).send({ phone: "555-0000", emergencyContact: null }),
      "Your sign-in is not linked to an employee record.",
    );
    status(await call("post", "/clock/in", cookies.free), 400);
  });

  it("works in the HR Suite, where commission does not exist", async () => {
    const hana = await portal(cookies.hrSuite, "hr");
    expect(hana.employee).toMatchObject({ id: ids.hana });
    expect(hana.visible.commission).toBe(false);
    expect(hana.statements).toEqual([]);
    status(
      await call("post", `/commission-assignments/${uuidv7()}/acknowledge`, cookies.hrSuite, "hr").send({
        signedName: "Test User",
      }),
      404,
    );
  });

  it("changes only one's own phone and emergency contact, audited once, and refuses any other field", async () => {
    const before = await rows((db) => db.select().from(employees).where(eq(employees.id, ids.ana)));
    for (const extra of [
      { name: "Someone Else" },
      { payRate: "99.00" },
      { employeeId: ids.ben },
      { email: "ana@example.test" },
      { title: "Boss" },
    ]) {
      status(
        await call("patch", "/me/employee", cookies.ana).send({ phone: "555-0999", emergencyContact: null, ...extra }),
        400,
      );
    }
    status(await call("patch", "/me/employee", cookies.ana).send({ phone: "555-0999" }), 400);
    status(
      await call("patch", "/me/employee", cookies.ana).send({ phone: "x".repeat(41), emergencyContact: null }),
      400,
    );
    expect(await rows((db) => db.select().from(employees).where(eq(employees.id, ids.ana)))).toEqual(before);

    const body = {
      phone: "  555-0199 ",
      emergencyContact: { name: " Rae Alvarez ", phone: "555-0111", relation: "Sister" },
    };
    const saved = await call("patch", "/me/employee", cookies.ana).send(body);
    status(saved, 200);
    expect(saved.body).toMatchObject({
      id: ids.ana,
      phone: "555-0199",
      emergencyContact: { name: "Rae Alvarez", phone: "555-0111", relation: "Sister" },
      name: "Ana Alvarez",
    });
    expect(saved.body).not.toHaveProperty("payRate");
    const [stored] = await rows((db) => db.select().from(employees).where(eq(employees.id, ids.ana)));
    expect(stored).toMatchObject({ phone: "555-0199", name: "Ana Alvarez", payRate: "24.50", title: before[0]!.title });
    const [benRow] = await rows((db) => db.select().from(employees).where(eq(employees.id, ids.ben)));
    expect(benRow!.phone).toBe("");

    const entries = await auditOf("Updated own profile", ids.ana);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorUserId: ids.anaUser,
      category: "data",
      targetType: "employee",
      before: { phone: "555-0101" },
      after: { phone: "555-0199", emergencyContactChanged: true },
    });
    // The emergency contact is someone else's personal data: never in the log.
    expect(JSON.stringify(entries[0])).not.toContain("Rae");
    // The same save again changes nothing and writes nothing.
    status(await call("patch", "/me/employee", cookies.ana).send(body), 200);
    expect(await auditOf("Updated own profile", ids.ana)).toHaveLength(1);
  });

  it("honours the clock setting and the hr.clock switch on clock-in and clock-out", async () => {
    expect((await portal(cookies.ana)).visible.clock).toBe(true);
    status(await call("post", "/clock/in", cookies.ana), 201);
    const inAt = (await portal(cookies.ana)).clock.clockedInAt;
    // An instant with its zone mark, which the portal shows on the company's clock (ADR 0064, #66).
    expect(inAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    await setHr({ clockEnabled: false });
    try {
      refused(await call("post", "/clock/out", cookies.ana), "This company does not use the clock.");
      const off = await portal(cookies.ana);
      expect(off.visible.clock).toBe(false);
      // The open punch still shows, so the person knows it is waiting.
      expect(off.clock.clockedInAt).toBe(inAt);
    } finally {
      await setHr();
    }
    await withFeatureOff("hr.clock", async () => {
      status(await call("post", "/clock/out", cookies.ana), 404);
      status(await call("post", "/clock/in", cookies.ben), 404);
      expect((await portal(cookies.ana)).visible.clock).toBe(false);
    });
    status(await call("post", "/clock/out", cookies.ana), 201);
    expect((await portal(cookies.ana)).clock.clockedInAt).toBeNull();
    // An exempt person does not fill in timesheets, so has no clock.
    expect((await portal(cookies.dee)).visible.clock).toBe(false);
  });

  it("lets a rep sign only their own running plan, shown to them, with their own name, once", async () => {
    /** The plan's terms as they stand: what a portal read now would show. */
    const terms = async () => {
      const [plan] = await rows((db) => db.select().from(commissionPlans).where(eq(commissionPlans.id, ids.plan)));
      return { planId: plan!.id, planVersion: plan!.version, planUpdatedAt: plan!.updatedAt.toISOString() };
    };
    const sign = async (cookie: string, assignmentId: string, signedName: string) =>
      call("post", `/commission-assignments/${assignmentId}/acknowledge`, cookie).send({
        signedName,
        ...(await terms()),
      });
    // Someone else's assignment, or none, reads as missing.
    status(await sign(cookies.dee, ids.benAssignment, "Test User"), 404);
    status(await sign(cookies.ana, ids.deeAssignment, "Test User"), 404);
    status(await sign(cookies.dee, uuidv7(), "Test User"), 404);
    status(
      await call("post", `/commission-assignments/${ids.deeAssignment}/acknowledge`, cookies.dee).send({
        signedName: "Test User",
        ...(await terms()),
        userId: ids.benUser,
      }),
      400,
    );
    // The terms the rep read are part of the signature: without them it is refused.
    status(
      await call("post", `/commission-assignments/${ids.deeAssignment}/acknowledge`, cookies.dee).send({
        signedName: "Test User",
      }),
      400,
    );
    // Ben's commission is hidden, so there is no plan in front of him to sign.
    refused(
      await sign(cookies.ben, ids.benAssignment, "Test User"),
      "Commission is not shown here. Ask HR for a copy of your plan to sign.",
    );
    refused(
      await sign(cookies.dee, ids.deeAssignment, "Dee Dalton"),
      "Type your full name exactly as it appears on your account.",
    );
    await withFeatureOff("hr.commissions", async () => {
      status(await sign(cookies.dee, ids.deeAssignment, "Test User"), 404);
    });

    // Terms that are not the plan as it stands are a 409: another plan, another version, or a plan
    // edited in place between the rep's read and the signature (second security review of PR #28).
    const read = await portal(cookies.dee);
    const shown = {
      planId: read.plan!.id as string,
      planVersion: read.plan!.version as number,
      planUpdatedAt: read.plan!.updatedAt as string,
    };
    expect(shown).toEqual(await terms());
    const stale = async (over: Partial<typeof shown>) => {
      const answer = await call("post", `/commission-assignments/${ids.deeAssignment}/acknowledge`, cookies.dee).send({
        signedName: "Test User",
        ...shown,
        ...over,
      });
      status(answer, 409);
      expect(answer.body).toEqual({
        code: "plan_changed",
        message: "Your plan has changed since you opened it. Read the new terms, then sign again.",
      });
    };
    await stale({ planId: uuidv7() });
    await stale({ planVersion: 2 });
    await rows((db) =>
      db
        .update(commissionPlans)
        .set({ clawbackDays: 60, updatedAt: new Date() })
        .where(eq(commissionPlans.id, ids.plan)),
    );
    await stale({});
    expect(await auditOf("Signed commission plan", ids.deeAssignment)).toHaveLength(0);

    const signed = await sign(cookies.dee, ids.deeAssignment, "  test user ");
    status(signed, 201);
    expect(signed.body).toEqual({ ok: true });
    const [row] = await rows((db) =>
      db.select().from(commissionAssignments).where(eq(commissionAssignments.id, ids.deeAssignment)),
    );
    expect(row).toMatchObject({ acknowledgedName: "test user" });
    expect(row!.acknowledgedAt).not.toBeNull();
    expect((await portal(cookies.dee)).assignment!.acknowledgement).toMatchObject({ signedName: "test user" });
    refused(await sign(cookies.dee, ids.deeAssignment, "Test User"), "You have already signed this plan.");
    const entries = await auditOf("Signed commission plan", ids.deeAssignment);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorUserId: ids.deeUser,
      targetType: "commission_assignment",
      after: { signed: true, planId: ids.plan, planVersion: 1 },
    });
    const [benRow] = await rows((db) =>
      db.select().from(commissionAssignments).where(eq(commissionAssignments.id, ids.benAssignment)),
    );
    expect(benRow!.acknowledgedAt).toBeNull();

    // An ended assignment has nothing to sign.
    await rows((db) =>
      db
        .update(commissionAssignments)
        .set({ effectiveTo: addDays(companyDay(), -1) })
        .where(and(eq(commissionAssignments.id, ids.benAssignment))),
    );
    refused(
      await sign(cookies.ben, ids.benAssignment, "Test User"),
      "This plan assignment has ended, so there is nothing to sign.",
    );
  });

  it("turns a second live link to one employee, from the real driver error, into 409 employee_already_linked", async () => {
    const dana = await person({ name: "Dana Link" });
    await member(["employee"], dana.id);
    const other = await member(["employee"], null);
    const second = rows((db) =>
      db.update(userProfiles).set({ employeeId: dana.id }).where(eq(userProfiles.userId, other.userId)),
    );
    const refused = await linkedOnce(second).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(ConflictException);
    expect((refused as ConflictException).getResponse()).toMatchObject({ code: "employee_already_linked" });
  });

  it("opens one's own employee documents with hr.portal.view, and nobody else's", async () => {
    const PDF = { name: "offer.pdf", data: Buffer.from("%PDF-1.4 personnel file").toString("base64") };
    const upload = async (employeeId: string) => {
      const added = await call("post", `/employees/${employeeId}/documents`, cookies.owner).send({ files: [PDF] });
      status(added, 201);
      return (added.body as { documents: { id: string }[] }).documents[0]!.id;
    };
    const own = await upload(ids.ana);
    const other = await upload(ids.ben);
    const mine = await call("get", `/files/${own}`, cookies.ana)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      });
    status(mine, 200);
    expect((mine.body as Buffer).toString()).toBe(Buffer.from(PDF.data, "base64").toString());
    // Ben's file is not hers, and an unlinked person has none: both read as missing.
    status(await call("get", `/files/${other}`, cookies.ana), 404);
    status(await call("get", `/files/${own}`, cookies.free), 404);
    status(await call("get", `/files/${own}`, cookies.noPortal), 403);
    await withFeatureOff("hr.portal", async () => {
      status(await call("get", `/files/${own}`, cookies.ana), 404);
    });
    expect(
      ((await portal(cookies.ana)).employee as { documents: { id: string }[] }).documents.map((d) => d.id),
    ).toEqual([own]);
  });
});
