import { auditLog, employees, settings, userProfiles } from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { addDays, CALIFORNIA_OFF_NOTE, CALIFORNIA_PENDING_NOTE, FEATURES, workweekStartOf } from "@workspace/shared";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import type { Response } from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";

/** Today in the test company's time zone (America/Chicago), the day the API dates by. */
function companyDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** The first day (Monday, the seeded workweek start) of the workweek `weeksAgo` weeks before today's. */
function week(weeksAgo: number): string {
  return addDays(workweekStartOf(companyDay(), 1), -7 * weeksAgo);
}

interface ReviewBody {
  rows: { line: { employeeId: string; overtimeHours: string; doubleTimeHours: string; grossPay: string } }[];
  warnings: string[];
}

/** Runs `fn` with the California pay rules switched on (off by default, ADR 0050), then off again. */
async function withCaliforniaRules(fn: () => Promise<void>): Promise<void> {
  const feature = FEATURES["hr.payroll.california"] as { enabled: boolean };
  feature.enabled = true;
  try {
    await fn();
  } finally {
    feature.enabled = false;
  }
}

/**
 * The California pay rules switch on the API (`hr.payroll.california`, ADR 0050; owner,
 * 2026-11-14): off by default, a California worker's timesheet and pay line follow the federal
 * weekly rule and pay-period review warns that California rules are off; on, the daily rule and
 * double time apply and the review warns they are pending payroll review.
 */
describe("California pay rules switch (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  const cookies = { owner: "", hr: "" };
  const ids = { carla: "", hana: "" };

  function call(method: "get" | "post" | "put", path: string, cookie: string) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
  }

  function status(response: Response, expected: number): void {
    expect(response.status, JSON.stringify(response.body)).toBe(expected);
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

  async function rows<T>(read: (db: Awaited<ReturnType<typeof harness.companyDb>>["db"]) => Promise<T>): Promise<T> {
    const handle = await harness.companyDb(company.id);
    try {
      return await read(handle.db);
    } finally {
      await handle.close();
    }
  }

  /** Carla's hours for a week, saved by HR and approved by the Owner; returns the approval's audit split. */
  async function approveCarla(weeksAgo: number, days: number[]) {
    const saved = await call("put", "/timesheets", cookies.hr).send({
      employeeId: ids.carla,
      weekStart: week(weeksAgo),
      days: days.map(String),
    });
    status(saved, 200);
    status(await call("post", `/timesheets/${saved.body.id}/submit`, cookies.hr), 201);
    status(
      await call("post", "/timesheets/decisions", cookies.owner).send({ action: "approve", ids: [saved.body.id] }),
      201,
    );
    const [entry] = await rows((db) =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "Approved timesheet"), eq(auditLog.targetId, saved.body.id))),
    );
    return entry!.after;
  }

  async function review(id: string): Promise<ReviewBody> {
    const read = await call("get", `/pay-periods/${id}/review`, cookies.owner);
    status(read, 200);
    return read.body;
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("california");
    await rows(async (db) => {
      await db
        .insert(settings)
        .values([
          {
            group: "hr",
            value: { workweekStartDay: 1, clockEnabled: false, payFrequency: "weekly", payPeriodAnchor: week(10) },
          },
          { group: "localization", value: { payroll: { overtimeRule: "federal" } } },
        ])
        .onConflictDoNothing();
      const base = { workerType: "w2" as const, hiredAt: "2024-01-08", status: "active" as const };
      const [hana] = await db
        .insert(employees)
        .values({
          ...base,
          name: "Hana Hartley",
          payType: "salary",
          payRate: "80000.00",
          state: "TX",
          flsaStatus: "exempt",
          exemptionBasis: "administrative",
        })
        .returning();
      const [carla] = await db
        .insert(employees)
        .values({
          ...base,
          name: "Carla Cruz",
          payType: "hourly",
          payRate: "20.00",
          state: "CA",
          flsaStatus: "non_exempt",
        })
        .returning();
      ids.hana = hana!.id;
      ids.carla = carla!.id;
    });
    const hrEmail = await harness.addUser({ companyIds: [company.id], roles: ["hr"] });
    const hrUser = await harness.userIdOf(hrEmail);
    await rows((db) => db.update(userProfiles).set({ employeeId: ids.hana }).where(eq(userProfiles.userId, hrUser)));
    cookies.hr = await enrolled(hrEmail);
    cookies.owner = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
  }, 240_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("is off by default: a California 13-hour day is federal hours, with no daily overtime", async () => {
    expect(FEATURES["hr.payroll.california"].enabled).toBe(false);
    expect(await approveCarla(5, [13, 0, 0, 0, 0, 0, 0])).toMatchObject({
      regular: "13.00",
      overtime: "0.00",
      doubleTime: "0.00",
    });
  });

  it("switched on, the same day is 8 regular, 4 overtime and 1 double time", async () => {
    await withCaliforniaRules(async () => {
      expect(await approveCarla(4, [13, 0, 0, 0, 0, 0, 0])).toMatchObject({
        regular: "8.00",
        overtime: "4.00",
        doubleTime: "1.00",
      });
    });
  });

  it("works Carla's pay line on the federal rule while off, the California rule while on, with the matching warning", async () => {
    // 46 hours with a 10- and a 13-hour day at 20.00 an hour.
    await approveCarla(2, [10, 8, 8, 13, 7, 0, 0]);
    const opened = await call("post", "/pay-periods", cookies.hr).send({ date: week(2) });
    status(opened, 201);
    const lineOf = (body: ReviewBody) => body.rows.find((r) => r.line.employeeId === ids.carla)!.line;

    const off = await review(opened.body.id);
    expect(off.warnings).toEqual([CALIFORNIA_OFF_NOTE]);
    // Federal: 6 overtime hours, 920.00 straight + 60.00 premium.
    expect(lineOf(off)).toMatchObject({ overtimeHours: "6.00", doubleTimeHours: "0.00", grossPay: "980.00" });

    await withCaliforniaRules(async () => {
      const on = await review(opened.body.id);
      expect(on.warnings).toEqual([CALIFORNIA_PENDING_NOTE]);
      // California: 6 overtime and 1 double-time hour, 920.00 straight + 80.00 premium.
      expect(lineOf(on)).toMatchObject({ overtimeHours: "6.00", doubleTimeHours: "1.00", grossPay: "1000.00" });
    });
  });

  it("keeps the California refusals with the switch off: no carryover limit on vacation (owner, 2026-11-14)", async () => {
    expect(FEATURES["hr.payroll.california"].enabled).toBe(false);
    const refused = await call("post", "/time-off-policies", cookies.owner).send({
      name: "Vacation",
      kind: "vacation",
      paid: true,
      accrualMethod: "none",
      accrualRate: "0",
      capHours: "",
      annualUseLimitHours: "",
      carryoverHours: "40",
      waitingPeriodDays: 0,
      allowNegative: false,
    });
    status(refused, 400);
    expect(refused.body.message).toContain("California does not allow");
  });
});
