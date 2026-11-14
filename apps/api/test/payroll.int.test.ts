import {
  auditLog,
  branches,
  contractorPayments,
  employees,
  journalEntries,
  journalLines,
  ledgerAccounts,
  locations,
  payPeriodLines,
  payPeriods,
  rolePermissions,
  roles,
  settings,
  timeOffEntries,
  userProfiles,
} from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { addDays, dec, moneyString, sum, workweekStartOf } from "@workspace/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import type { Response } from "supertest";
import { v7 as uuidv7 } from "uuid";
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

interface TrialBalance {
  balanced: boolean;
  rows: { key: string | null; balance: string }[];
}

interface LineBody {
  employeeId: string;
  hoursWorked: string;
  overtimeHours: string;
  grossPay: string;
  baseRate?: string;
}

interface PeriodBody {
  id: string;
  frequency: string;
  start: string;
  end: string;
  payDate: string;
  status: string;
  excluded: { employeeId: string; reason: string }[];
  lines: LineBody[];
}

interface ReviewBody {
  period: PeriodBody;
  rows: {
    line: LineBody;
    employee: { id: string; name: string; payRate?: string; phone?: string };
    excludedReason: string | null;
  }[];
  blockers: { employeeName: string; status: string }[];
  warnings: string[];
}

interface PaymentBody {
  id: string;
  status: string;
  amount: string;
}

/**
 * HR part 2 API (hr.md "Pay periods", "Bonus", "ContractorPayment"; ADR 0047; api-contract.md "HR, part 2"):
 * the payroll keys and scope, opening and reviewing a run, exclusions, approval with its separation of
 * duties, the payroll postings, locks and reopening, export, bonuses and contractor payments.
 */
describe("payroll API (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  const ids = { hana: "", wes: "", olive: "", hal: "", ivy: "", cora: "", locA: "", locB: "" };
  const cookies = {
    owner: "",
    hr: "", // linked to Hana, who is in every run
    hr2: "", // linked to Hal, who is in no run
    hr3: "", // no employee link
    hr4: "", // linked to Ivy, who is in no run
    accountant: "",
    branchPayroll: "",
    sales: "",
    wes: "",
  };
  let bank = "";

  function call(method: "get" | "post" | "put", path: string, cookie?: string) {
    let test = request(harness.app.getHttpServer())[method](path).set("X-Forwarded-Host", "localhost:3000");
    if (cookie) test = test.set("Cookie", cookie);
    return test;
  }

  /** Asserts a status and shows the body when it differs. */
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

  /** The trial balance by account key, checked balanced on every read. */
  async function balances(): Promise<Map<string, string>> {
    const body = (await call("get", "/ledger/trial-balance", cookies.owner).expect(200)).body as TrialBalance;
    expect(body.balanced).toBe(true);
    return new Map(body.rows.flatMap((row) => (row.key ? [[row.key, row.balance] as const] : [])));
  }

  /** How much an account's balance (debits less credits) moved between two readings. */
  function moved(before: Map<string, string>, after: Map<string, string>, key: string): string {
    return moneyString(dec(after.get(key) ?? "0").minus(before.get(key) ?? "0"));
  }

  async function person(over: Partial<typeof employees.$inferInsert>) {
    return rows(
      async (db) =>
        (
          await db
            .insert(employees)
            .values({
              name: "Test Person",
              workerType: "w2",
              payType: "hourly",
              payRate: "20.00",
              state: "TX",
              hiredAt: "2024-01-08",
              status: "active",
              flsaStatus: "non_exempt",
              ...over,
            })
            .returning()
        )[0]!,
    );
  }

  async function open(weeksAgo: number): Promise<PeriodBody> {
    const opened = await call("post", "/pay-periods", cookies.hr).send({ date: week(weeksAgo) });
    status(opened, 201);
    return opened.body;
  }

  async function review(cookie: string, id: string): Promise<ReviewBody> {
    const read = await call("get", `/pay-periods/${id}/review`, cookie);
    status(read, 200);
    return read.body;
  }

  /** Hours for Wes and Olive in a week, entered by HR and approved by the Owner (maker-checker). */
  async function approveHours(
    weeksAgo: number,
    wes = [10, 10, 10, 10, 5, 0, 0],
    olive = [8, 8, 8, 8, 8, 0, 0],
  ): Promise<void> {
    const sheetIds: string[] = [];
    for (const [employeeId, days] of [
      [ids.wes, wes],
      [ids.olive, olive],
    ] as const) {
      const saved = await call("put", "/timesheets", cookies.hr).send({
        employeeId,
        weekStart: week(weeksAgo),
        days: days.map(String),
      });
      status(saved, 200);
      status(await call("post", `/timesheets/${saved.body.id}/submit`, cookies.hr), 201);
      sheetIds.push(saved.body.id);
    }
    status(await call("post", "/timesheets/decisions", cookies.owner).send({ action: "approve", ids: sheetIds }), 201);
  }

  const post = (path: string, cookie: string, body: Record<string, unknown> = {}) =>
    call("post", path, cookie).send(body);

  /** Every gross pay of a run's lines, added as decimals. */
  function grossOf(lines: readonly LineBody[]): string {
    return moneyString(sum(lines.map((line) => line.grossPay)));
  }

  async function auditOf(action: string, targetId: string) {
    return rows((db) =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId))),
    );
  }

  /** The payroll entries of the run ending on a day, oldest first, with their lines by account key. */
  async function runEntries(end: string) {
    return rows(async (db) => {
      const entries = await db
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.sourceType, "pay_period"),
            eq(journalEntries.event, "payroll.approved"),
            eq(journalEntries.date, end),
          ),
        )
        .orderBy(journalEntries.id);
      return Promise.all(
        entries.map(async (entry) => ({
          entry,
          lines: await db
            .select({
              key: ledgerAccounts.key,
              debit: journalLines.debit,
              credit: journalLines.credit,
              locationId: journalLines.locationId,
            })
            .from(journalLines)
            .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
            .where(eq(journalLines.entryId, entry.id)),
        })),
      );
    });
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("payroll");
    await rows(async (db) => {
      const address = { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" };
      const [branch] = await db.insert(branches).values({ name: "Main", city: "Austin", state: "TX" }).returning();
      const [a, b] = await db
        .insert(locations)
        .values([
          { name: "North Store", kind: "showroom" as const, branchId: branch!.id, address, isDefault: true },
          { name: "South Store", kind: "warehouse" as const, branchId: branch!.id, address },
        ])
        .returning();
      ids.locA = a!.id;
      ids.locB = b!.id;
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
      // A custom role holding all three payroll keys at branch scope: payroll is company-wide only.
      const [role] = await db
        .insert(roles)
        .values({ key: "branchpayroll", name: "Branch payroll", dataScope: "branch" })
        .returning();
      await db.insert(rolePermissions).values(
        ["hr.payroll.view", "hr.payroll.approve", "hr.payroll.export"].map((permissionKey) => ({
          roleId: role!.id,
          permissionKey,
        })),
      );
    });
    const emails = {
      hr: await harness.addUser({ companyIds: [company.id], roles: ["hr"] }),
      hr2: await harness.addUser({ companyIds: [company.id], roles: ["hr"] }),
      hr3: await harness.addUser({ companyIds: [company.id], roles: ["hr"] }),
      hr4: await harness.addUser({ companyIds: [company.id], roles: ["hr"] }),
      accountant: await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }),
      branchPayroll: await harness.addUser({ companyIds: [company.id], roles: ["branchpayroll"] }),
      sales: await harness.addUser({ companyIds: [company.id], roles: ["sales"] }),
      wes: await harness.addUser({ companyIds: [company.id], roles: ["employee"] }),
    };
    const hana = await person({
      name: "Hana Hartley",
      payType: "salary",
      payRate: "52.00",
      flsaStatus: "exempt",
      exemptionBasis: "administrative",
    });
    const wes = await person({ name: "Wes Walker", phone: "555-0100", payRate: "20.00", homeLocationId: ids.locA });
    const olive = await person({ name: "Olive Otis", payRate: "19.00", homeLocationId: ids.locB });
    // Hal is hired today, so he is in no past run: a linked sign-in that is never a line of its own.
    const hal = await person({ name: "Hal Hendry", hiredAt: companyDay() });
    const ivy = await person({ name: "Ivy Irving", hiredAt: companyDay() });
    const cora = await person({ name: "Cora Contract", workerType: "1099", payRate: "60.00" });
    Object.assign(ids, { hana: hana.id, wes: wes.id, olive: olive.id, hal: hal.id, ivy: ivy.id, cora: cora.id });
    for (const [email, employeeId] of [
      [emails.hr, hana.id],
      [emails.hr2, hal.id],
      [emails.hr4, ivy.id],
      [emails.wes, wes.id],
    ] as const) {
      const userId = await harness.userIdOf(email);
      await rows((db) => db.update(userProfiles).set({ employeeId }).where(eq(userProfiles.userId, userId)));
    }
    cookies.hr = await enrolled(emails.hr);
    cookies.hr2 = await enrolled(emails.hr2);
    cookies.hr3 = await enrolled(emails.hr3);
    cookies.hr4 = await enrolled(emails.hr4);
    cookies.accountant = await enrolled(emails.accountant);
    cookies.branchPayroll = await enrolled(emails.branchPayroll);
    cookies.sales = await harness.signIn(emails.sales);
    cookies.wes = await harness.signIn(emails.wes);
    cookies.owner = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
    const saved = await call("put", "/settings/accounting", cookies.accountant)
      .send({
        costingMethod: "average",
        salesTaxBasis: "accrual",
        bankAccounts: [{ name: "Operating", methods: ["check"] }],
      })
      .expect(200);
    bank = saved.body.bankAccounts[0].key as string;
  }, 240_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("holds every route to its payroll key and to company-wide scope, and shows nothing to the refused", async () => {
    const some = uuidv7();
    const routes = [
      ["get", "/pay-periods"],
      ["post", "/pay-periods"],
      ["get", `/pay-periods/${some}/review`],
      ["post", `/pay-periods/${some}/exclusions`],
      ["post", `/pay-periods/${some}/approve`],
      ["post", `/pay-periods/${some}/reopen`],
      ["post", `/pay-periods/${some}/export`],
      ["get", "/bonuses"],
      ["post", "/bonuses"],
      ["post", `/bonuses/${some}/void`],
      ["get", "/contractor-payments"],
      ["post", "/contractor-payments"],
      ["post", `/contractor-payments/${some}/pay`],
      ["post", `/contractor-payments/${some}/void`],
    ] as const;
    for (const [method, path] of routes) {
      expect((await call(method, path).send({})).status, `anonymous ${method} ${path}`).toBe(401);
      // No payroll key, or the keys at branch scope: refused, and the refusal carries no amount.
      for (const who of ["sales", "wes", "branchPayroll"] as const) {
        const refused = await call(method, path, cookies[who]).send({});
        expect(refused.status, `${who} ${method} ${path}`).toBe(403);
        expect(JSON.stringify(refused.body)).not.toMatch(/grossPay|\d+\.\d{2}/);
      }
    }
    // The Accountant holds view and export but not approve (hr.md "Who uses it").
    status(await call("get", "/pay-periods", cookies.accountant), 200);
    for (const path of [
      `/pay-periods/${some}/approve`,
      `/pay-periods/${some}/reopen`,
      `/pay-periods/${some}/exclusions`,
    ]) {
      expect((await call("post", path, cookies.accountant).send({})).status, path).toBe(403);
    }
    // Export is its own key: the Accountant passes the guard and meets a missing period.
    status(await post(`/pay-periods/${some}/export`, cookies.accountant), 404);
    // The HR manager holds all three.
    status(await post(`/pay-periods/${some}/export`, cookies.hr), 404);
  });

  it("opens the current period from the schedule, validates its body, and lists it", async () => {
    const opened = await open(9);
    expect(opened).toMatchObject({
      frequency: "weekly",
      start: week(9),
      end: addDays(week(9), 6),
      payDate: addDays(week(9), 11),
      status: "open",
      excluded: [],
      lines: [],
    });
    // Safe to repeat: the same period, still one audit entry.
    expect((await open(9)).id).toBe(opened.id);
    expect(await auditOf("Opened pay period", opened.id)).toHaveLength(1);
    const listed = await call("get", "/pay-periods", cookies.accountant);
    status(listed, 200);
    expect((listed.body as PeriodBody[]).map((p) => p.id)).toContain(opened.id);
    // Validation: one error body, never a period in the future, strict bodies.
    const future = await post("/pay-periods", cookies.hr, { date: addDays(companyDay(), 1) });
    status(future, 400);
    expect(future.body).toEqual({ code: "invalid_request", message: "A pay period can be opened up to today." });
    const extra = await post("/pay-periods", cookies.hr, { date: week(9), frequency: "monthly" });
    status(extra, 400);
    expect(extra.body.code).toBe("invalid_request");
    status(await post("/pay-periods", cookies.hr, { date: "last week" }), 400);
    status(await call("get", "/pay-periods/not-a-uuid/review", cookies.hr), 400);
    status(await call("get", `/pay-periods/${uuidv7()}/review`, cookies.hr), 404);
  });

  it("works each line from approved timesheets, with the overtime split, and strips rates without view_sensitive", async () => {
    await approveHours(9);
    const period = await open(9);
    const owner = await review(cookies.owner, period.id);
    expect(owner.blockers).toEqual([]);
    // Nobody works in California here, so no California pay note (ADR 0050).
    expect(owner.warnings).toEqual([]);
    const byName = new Map(owner.rows.map((r) => [r.employee.name, r]));
    // 45 hours at 20.00 with the federal rule: 40 regular and 5 overtime hours, 900.00 + 50.00 premium.
    expect(byName.get("Wes Walker")!.line).toMatchObject({
      grossPay: "950.00",
    });
    // The live line shows hours as decimal strings; compare as decimals, not as formatted text.
    expect(dec(byName.get("Wes Walker")!.line.hoursWorked).toString()).toBe("45");
    expect(dec(byName.get("Wes Walker")!.line.overtimeHours).toString()).toBe("5");
    expect(dec(byName.get("Wes Walker")!.line.baseRate ?? "").toString()).toBe("20");
    expect(byName.get("Olive Otis")!.line).toMatchObject({
      grossPay: "760.00",
    });
    // Contractors and people hired after the run are not in it.
    expect([...byName.keys()].sort()).toEqual(["Hana Hartley", "Olive Otis", "Wes Walker"]);
    // The Accountant has hr.payroll.view but not hr.employee.view_sensitive: gross yes, rates no.
    const accountant = await review(cookies.accountant, period.id);
    expect(accountant.rows.find((r) => r.employee.name === "Wes Walker")!.line.grossPay).toBe("950.00");
    const text = JSON.stringify(accountant);
    expect(text).not.toContain("baseRate");
    expect(text).not.toContain("regularRate");
    expect(text).not.toContain("payRate");
    expect(text).not.toContain("salaryAmount");
    expect(accountant.rows.every((r) => r.employee.phone === "")).toBe(true);
    // A week with no approved sheet blocks the run, and approval is refused.
    const blocked = await open(8);
    const blockedReview = await review(cookies.owner, blocked.id);
    expect(blockedReview.blockers.map((b) => [b.employeeName, b.status]).sort()).toEqual([
      ["Olive Otis", "missing"],
      ["Wes Walker", "missing"],
    ]);
    const refused = await post(`/pay-periods/${blocked.id}/approve`, cookies.owner);
    status(refused, 400);
    expect(refused.body.message).toContain("2 timesheets still need approval");
  });

  it("leaves people out with a reason, never oneself, and the person who did can't approve unless the Owner", async () => {
    await approveHours(7);
    const period = await open(7);
    const exclude = (cookie: string, employeeId: string, reason: string | null) =>
      post(`/pay-periods/${period.id}/exclusions`, cookie, { employeeId, reason });
    const own = await exclude(cookies.hr, ids.hana, "Away");
    status(own, 400);
    expect(own.body.message).toContain("Someone else must leave you out");
    status(await exclude(cookies.hr2, ids.olive, "x"), 400);
    status(await exclude(cookies.hr2, ids.cora, "Contractor"), 400);
    const notInRun = await exclude(cookies.hr, ids.hal, "Not hired yet");
    status(notInRun, 400);
    expect(notInRun.body.message).toContain("not in this pay run");
    const left = await exclude(cookies.hr2, ids.olive, "On leave");
    status(left, 201);
    expect(left.body.status).toBe("in_review");
    expect(left.body.excluded).toEqual([{ employeeId: ids.olive, reason: "On leave" }]);
    expect(
      (await review(cookies.owner, period.id)).rows.find((r) => r.line.employeeId === ids.olive)!.excludedReason,
    ).toBe("On leave");
    status(await exclude(cookies.hr2, ids.olive, null), 201);
    expect((await review(cookies.owner, period.id)).period.excluded).toEqual([]);
    status(await exclude(cookies.hr2, ids.olive, "On leave again"), 201);
    expect(await auditOf("Left out of pay period", period.id)).toHaveLength(2);
    expect(await auditOf("Brought back into pay period", period.id)).toHaveLength(1);
    // Whoever shaped the run can't approve it; the Owner can.
    const shaped = await post(`/pay-periods/${period.id}/approve`, cookies.hr2);
    status(shaped, 400);
    expect(shaped.body.message).toContain("Someone else must approve a pay run you changed");
    const before = await balances();
    const approved = await post(`/pay-periods/${period.id}/approve`, cookies.owner);
    status(approved, 201);
    expect(approved.body.status).toBe("approved");
    expect(approved.body.lines.map((l: LineBody) => l.employeeId).sort()).toEqual([ids.hana, ids.wes].sort());
    const after = await balances();
    const gross = grossOf(approved.body.lines);
    expect(moved(before, after, "wages")).toBe(gross);
    expect(moved(before, after, "accrued_payroll")).toBe(moneyString(dec(gross).negated()));
    // Left out of an approved run is closed.
    status(await exclude(cookies.hr2, ids.olive, null), 400);
  });

  it("separates the approver from the run: linked, not paid by it, and the Owner exempt", async () => {
    await approveHours(6);
    const period = await open(6);
    const path = `/pay-periods/${period.id}/approve`;
    const paid = await post(path, cookies.hr);
    status(paid, 400);
    expect(paid.body.message).toContain("Someone else must approve a pay run that pays you");
    const loose = await post(path, cookies.hr3);
    status(loose, 400);
    expect(loose.body.message).toContain("Link your sign-in to your employee record");
    expect(
      (await call("get", "/pay-periods", cookies.owner)).body.find((p: PeriodBody) => p.id === period.id).status,
    ).toBe("open");
    // Hal is linked, in no run and shaped nothing; the approval posts Wages per home location.
    const before = await balances();
    const approved = await post(path, cookies.hr2);
    status(approved, 201);
    const lines = approved.body.lines as LineBody[];
    const wes = lines.find((l) => l.employeeId === ids.wes)!;
    const olive = lines.find((l) => l.employeeId === ids.olive)!;
    const hana = lines.find((l) => l.employeeId === ids.hana)!;
    expect(wes.grossPay).toBe("950.00");
    expect(olive.grossPay).toBe("760.00");
    const after = await balances();
    const gross = grossOf(lines);
    expect(moved(before, after, "wages")).toBe(gross);
    expect(moved(before, after, "accrued_payroll")).toBe(moneyString(dec(gross).negated()));
    const [posted] = await runEntries(period.end);
    expect(posted!.entry.date).toBe(period.end);
    const wagesByLocation = new Map(
      posted!.lines.filter((l) => l.key === "wages").map((l) => [l.locationId, moneyString(l.debit)] as const),
    );
    expect(wagesByLocation.get(ids.locA)).toBe("950.00");
    expect(wagesByLocation.get(ids.locB)).toBe("760.00");
    expect(wagesByLocation.get(null)).toBe(hana.grossPay);
    expect(posted!.lines.filter((l) => l.key === "accrued_payroll")).toHaveLength(1);
    const audits = await auditOf("Approved pay period", period.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toEqual({ status: "approved", people: 3 });
    status(await post(path, cookies.owner), 400);
  });

  it("locks timesheets and time off in an approved run, and a reopen reverses the entry so it can be approved again", async () => {
    const [period] = (await call("get", "/pay-periods", cookies.owner)).body.filter(
      (p: PeriodBody) => p.start === week(6),
    ) as PeriodBody[];
    expect(period!.status).toBe("approved");
    const edit = await call("put", "/timesheets", cookies.hr).send({
      employeeId: ids.wes,
      weekStart: week(6),
      days: ["8", "8", "8", "8", "8", "0", "0"],
    });
    status(edit, 400);
    expect(edit.body.message).toContain("locked");
    const policy = await post("/time-off-policies", cookies.hr, {
      name: "Vacation",
      kind: "vacation",
      paid: true,
      accrualMethod: "none",
      accrualRate: "0",
      capHours: "",
      annualUseLimitHours: "",
      carryoverHours: "",
      waitingPeriodDays: 0,
      allowNegative: true,
    });
    status(policy, 201);
    const day = addDays(week(6), 1);
    const asked = await post("/pto-requests", cookies.wes, {
      employeeId: ids.wes,
      policyId: policy.body.id,
      start: day,
      end: day,
      hours: "8",
      note: "",
    });
    expect(asked.body.message).toContain("approved pay period");

    const approvedBalance = await balances();
    const reopened = await post(`/pay-periods/${period!.id}/reopen`, cookies.hr2);
    status(reopened, 201);
    expect(reopened.body).toMatchObject({ status: "in_review", lines: [], approvedBy: null });
    const reopenedBalance = await balances();
    expect(moved(approvedBalance, reopenedBalance, "wages")).toBe(moneyString(dec(grossOfRun(period!)).negated()));
    expect(moved(approvedBalance, reopenedBalance, "accrued_payroll")).toBe(grossOfRun(period!));
    const [first] = await runEntries(period!.end);
    const reversal = await rows((db) =>
      db.select().from(journalEntries).where(eq(journalEntries.reversesId, first!.entry.id)),
    );
    expect(reversal).toHaveLength(1);
    expect(reversal[0]!.date).toBe(companyDay());
    expect(await auditOf("Reopened pay period", period!.id)).toHaveLength(1);
    // Open to hours again; and approving once more posts a new entry.
    status(await post(`/pay-periods/${period!.id}/reopen`, cookies.hr2), 400);
    const again = await post(`/pay-periods/${period!.id}/approve`, cookies.hr2);
    status(again, 201);
    const final = await balances();
    expect(moved(approvedBalance, final, "wages")).toBe("0.00");
    expect(await runEntries(period!.end)).toHaveLength(2);
    expect((await review(cookies.owner, period!.id)).rows).toHaveLength(3);
  });

  it("exports an approved run, which locks it, and an unapproved one can't be exported", async () => {
    const [period] = (await call("get", "/pay-periods", cookies.owner)).body.filter(
      (p: PeriodBody) => p.start === week(6),
    ) as PeriodBody[];
    status(await post(`/pay-periods/${week(9)}/export`, cookies.hr), 400);
    const [unapproved] = (await call("get", "/pay-periods", cookies.owner)).body.filter(
      (p: PeriodBody) => p.start === week(8),
    ) as PeriodBody[];
    const early = await post(`/pay-periods/${unapproved!.id}/export`, cookies.accountant);
    status(early, 400);
    expect(early.body.message).toContain("Approve the pay period before exporting");
    const exported = await post(`/pay-periods/${period!.id}/export`, cookies.accountant);
    status(exported, 201);
    expect(exported.body.status).toBe("exported");
    status(await post(`/pay-periods/${period!.id}/export`, cookies.accountant), 201);
    const locked = await post(`/pay-periods/${period!.id}/reopen`, cookies.hr2);
    status(locked, 400);
    expect(locked.body.message).toContain("exported pay period can't be reopened");
    expect(await auditOf("Exported pay period", period!.id)).toHaveLength(1);
  });

  it("adds a bonus that is paid as wages in its run, never one's own, and a void retires it", async () => {
    await approveHours(5);
    const period = await open(5);
    const bonus = (cookie: string, over: Record<string, unknown> = {}) =>
      post("/bonuses", cookie, {
        employeeId: ids.wes,
        amount: "100.00",
        kind: "discretionary",
        periodStart: period.start,
        periodEnd: period.end,
        reason: "Great month",
        ...over,
      });
    const own = await bonus(cookies.hr, { employeeId: ids.hana });
    status(own, 400);
    expect(own.body.message).toContain("Someone else must decide your own bonus");
    expect((await bonus(cookies.hr2, { employeeId: ids.cora })).body.message).toContain("contractor");
    status(await bonus(cookies.hr2, { amount: "0.00" }), 400);
    status(await bonus(cookies.hr2, { amount: "12.345" }), 400);
    status(await bonus(cookies.hr2, { kind: "gift" }), 400);
    status(await bonus(cookies.hr2, { reason: "ok" }), 400);
    status(await bonus(cookies.hr2, { periodEnd: addDays(period.start, -1) }), 400);
    status(await bonus(cookies.sales), 403);
    const added = await bonus(cookies.hr2);
    status(added, 201);
    expect(added.body).toMatchObject({ employeeId: ids.wes, amount: "100.00", kind: "discretionary" });
    expect(((await call("get", "/bonuses", cookies.accountant)).body as { id: string }[]).map((b) => b.id)).toContain(
      added.body.id,
    );
    // It joins the run as wages, 950.00 plus 100.00; the person who added it can't approve the run.
    const reviewed = await review(cookies.owner, period.id);
    expect(reviewed.rows.find((r) => r.line.employeeId === ids.wes)!.line.grossPay).toBe("1050.00");
    const shaped = await post(`/pay-periods/${period.id}/approve`, cookies.hr2);
    status(shaped, 400);
    expect(shaped.body.message).toContain("adding a bonus");
    const before = await balances();
    const approved = await post(`/pay-periods/${period.id}/approve`, cookies.owner);
    status(approved, 201);
    const after = await balances();
    expect(moved(before, after, "wages")).toBe(grossOf(approved.body.lines));
    expect(approved.body.lines.find((l: LineBody) => l.employeeId === ids.wes).grossPay).toBe("1050.00");
    // A run that is approved takes no new bonus and no void; an open one does.
    status(await bonus(cookies.hr2, { employeeId: ids.olive }), 400);
    status(await post(`/bonuses/${added.body.id}/void`, cookies.hr2, { reason: "Wrong person" }), 400);
    const next = await bonus(cookies.hr2, {
      periodStart: week(4),
      periodEnd: addDays(week(4), 6),
    });
    status(next, 201);
    status(await post(`/bonuses/${next.body.id}/void`, cookies.hr2, { reason: "x" }), 400);
    status(await post(`/bonuses/${next.body.id}/void`, cookies.hr2, { reason: "Entered twice" }), 201);
    expect(((await call("get", "/bonuses", cookies.hr)).body as { id: string }[]).map((b) => b.id)).not.toContain(
      next.body.id,
    );
    status(await post(`/bonuses/${next.body.id}/void`, cookies.hr2, { reason: "Entered twice" }), 404);
    expect(await auditOf("Voided bonus", next.body.id)).toHaveLength(1);
  });

  it("records a contractor payment, pays it by someone else into the method's bank, and a void reverses it", async () => {
    const record = (cookie: string, over: Record<string, unknown> = {}) =>
      post("/contractor-payments", cookie, {
        employeeId: ids.cora,
        date: companyDay(),
        description: "Tile install, Maple St",
        amount: "1200.00",
        ...over,
      });
    status(await record(cookies.hr2, { employeeId: ids.wes }), 400);
    status(await record(cookies.hr2, { date: addDays(companyDay(), 1) }), 400);
    status(await record(cookies.hr2, { amount: "0.00" }), 400);
    status(await record(cookies.hr2, { amount: "12.345" }), 400);
    status(await record(cookies.sales), 403);
    const before = await balances();
    const recorded = await record(cookies.hr2);
    status(recorded, 201);
    expect(recorded.body).toMatchObject({ employeeId: ids.cora, amount: "1200.00", status: "approved" });
    // Recording posts nothing.
    expect(moved(before, await balances(), "contract_labor")).toBe("0.00");
    const path = `/contractor-payments/${recorded.body.id}`;
    const own = await post(`${path}/pay`, cookies.hr2, { method: "check" });
    status(own, 400);
    expect(own.body.message).toContain("Someone else must pay");
    status(await post(`${path}/pay`, cookies.hr, { method: "bitcoin" }), 400);
    status(await post(`${path}/pay`, cookies.hr, {}), 400);
    const paid = await post(`${path}/pay`, cookies.hr, { method: "check" });
    status(paid, 201);
    expect(paid.body.status).toBe("paid");
    const after = await balances();
    expect(moved(before, after, "contract_labor")).toBe("1200.00");
    expect(moved(before, after, bank)).toBe("-1200.00");
    expect(moved(before, after, "cash")).toBe("0.00");
    status(await post(`${path}/pay`, cookies.hr, { method: "check" }), 400);
    const [audit] = await auditOf("Paid contractor payment", recorded.body.id);
    expect(audit!.after).toEqual({ status: "paid", method: "check", paidOn: companyDay() });
    status(await post(`${path}/void`, cookies.hr2, { reason: "x" }), 400);
    status(await post(`${path}/void`, cookies.hr2, { reason: "Paid twice by mistake" }), 201);
    const voided = await balances();
    expect(moved(before, voided, "contract_labor")).toBe("0.00");
    expect(moved(before, voided, bank)).toBe("0.00");
    expect(
      ((await call("get", "/contractor-payments", cookies.hr)).body as PaymentBody[]).map((p) => p.id),
    ).not.toContain(recorded.body.id);
    // A payment still to make can be voided without a posting.
    const unpaid = await record(cookies.hr2, { description: "Grout work" });
    status(unpaid, 201);
    status(await post(`/contractor-payments/${unpaid.body.id}/void`, cookies.hr, { reason: "Cancelled job" }), 201);
    expect(moved(before, await balances(), "contract_labor")).toBe("0.00");
  });

  it("refuses to void a payment paid before the books started", async () => {
    const [seeded] = await rows((db) =>
      db
        .insert(contractorPayments)
        .values({
          employeeId: ids.cora,
          date: "2024-02-01",
          description: "Imported job",
          amount: "500.00",
          status: "paid",
        })
        .returning(),
    );
    const before = await balances();
    const refused = await post(`/contractor-payments/${seeded!.id}/void`, cookies.hr, { reason: "Wrong job" });
    status(refused, 400);
    expect(refused.body.message).toContain("paid before the books started");
    expect(moved(before, await balances(), "contract_labor")).toBe("0.00");
    const listed = (await call("get", "/contractor-payments", cookies.hr)).body as PaymentBody[];
    expect(listed.find((p) => p.id === seeded!.id)?.status).toBe("paid");
  });

  /** A person as the People form sends them; Olive's stored facts unless overridden. */
  function employeeForm(over: Record<string, unknown> = {}) {
    return {
      name: "Olive Otis",
      title: "",
      department: "",
      workerType: "w2",
      payType: "hourly",
      payRate: "19.00",
      state: "TX",
      email: "",
      phone: "",
      hiredAt: "2024-01-08",
      status: "active",
      managerId: null,
      flsaStatus: "non_exempt",
      exemptionBasis: null,
      salaryHoursPerWeek: 40,
      commissionVisible: null,
      homeLocationId: ids.locB,
      emergencyContact: null,
      ...over,
    };
  }

  it("refuses an approver who added someone in the run or changed their pay since it was last approved", async () => {
    // Hal's HR manager adds a salaried exempt person, who needs no timesheet, so nothing blocks the run.
    await approveHours(3);
    const added = await post(
      "/employees",
      cookies.hr2,
      employeeForm({
        name: "Mona Madeup",
        payType: "salary",
        payRate: "52000.00",
        flsaStatus: "exempt",
        exemptionBasis: "administrative",
        homeLocationId: null,
      }),
    );
    status(added, 201);
    const mona = added.body.id as string;
    const period = await open(3);
    const own = await post(`/pay-periods/${period.id}/approve`, cookies.hr2);
    status(own, 400);
    expect(own.body.message).toContain("whose pay you added or changed");
    // Another linked HR manager, who touched nobody in the run, approves it.
    const approved = await post(`/pay-periods/${period.id}/approve`, cookies.hr4);
    status(approved, 201);
    expect((approved.body.lines as LineBody[]).map((l) => l.employeeId)).toContain(mona);

    // A pay-rate raise by the approver is refused the same way, while the earlier add, already
    // approved by someone else, no longer counts against Hal's HR manager.
    await approveHours(2);
    const next = await open(2);
    status(await call("put", `/employees/${ids.olive}`, cookies.hr4).send(employeeForm({ payRate: "25.00" })), 200);
    const raised = await post(`/pay-periods/${next.id}/approve`, cookies.hr4);
    status(raised, 400);
    expect(raised.body.message).toContain("whose pay you added or changed");
    const second = await post(`/pay-periods/${next.id}/approve`, cookies.hr2);
    status(second, 201);
    const olive = (second.body.lines as LineBody[]).find((l) => l.employeeId === ids.olive)!;
    // Frozen hours and rate read as two-decimal strings, as the live review shows them.
    expect(olive).toMatchObject({
      hoursWorked: "40.00",
      overtimeHours: "0.00",
      baseRate: "25.00",
      grossPay: "1000.00",
    });
  });

  it("shows live hours and rates as two-decimal strings, the same as the frozen lines", async () => {
    await approveHours(1);
    const period = await open(1);
    const live = (await review(cookies.owner, period.id)).rows.find((r) => r.line.employeeId === ids.wes)!.line;
    expect(live).toMatchObject({ hoursWorked: "45.00", overtimeHours: "5.00", baseRate: "20.00" });
    const salaried = (await review(cookies.owner, period.id)).rows.find((r) => r.line.employeeId === ids.hana)!.line;
    expect(salaried.hoursWorked).toBe("0.00");
  });

  it("refuses to open a period over a live one, or to approve a run another approved run covers", async () => {
    const insertPeriod = (values: Partial<typeof payPeriods.$inferInsert> & { start: string; end: string }) =>
      rows(
        async (db) =>
          (
            await db
              .insert(payPeriods)
              .values({ frequency: "biweekly", payDate: addDays(values.end, 5), status: "approved", ...values })
              .returning()
          )[0]!,
      );
    // A biweekly run left from an earlier schedule covers week 12; a weekly one there would pay its days twice.
    await insertPeriod({ start: week(12), end: addDays(week(12), 13), approvedAt: new Date() });
    const over = await post("/pay-periods", cookies.hr, { date: week(12) });
    status(over, 400);
    expect(over.body.message).toContain("Another pay period already covers");
    // An approved run inside week 1's period: week 1 can't be approved over it.
    const period = await open(1);
    const inside = await insertPeriod({
      frequency: "monthly",
      start: addDays(week(1), 2),
      end: addDays(week(1), 2),
      approvedAt: new Date(),
    });
    const refused = await post(`/pay-periods/${period.id}/approve`, cookies.owner);
    status(refused, 400);
    expect(refused.body.message).toContain("Another approved pay period covers");
    await rows((db) => db.update(payPeriods).set({ deletedAt: new Date() }).where(eq(payPeriods.id, inside.id)));
  });

  it("lets a payroll viewer open only today's period; an earlier one takes the approve key", async () => {
    const today = await post("/pay-periods", cookies.accountant);
    status(today, 201);
    expect(today.body.start).toBe(week(0));
    status(await post("/pay-periods", cookies.accountant, { date: companyDay() }), 201);
    const earlier = await post("/pay-periods", cookies.accountant, { date: week(1) });
    status(earlier, 403);
    expect(earlier.body.message).toContain("Only someone who approves payroll");
    status(await post("/pay-periods", cookies.hr, { date: week(1) }), 201);
  });

  it("refuses to reopen a run approved before the books started, which has no entry to reverse", async () => {
    const [seeded] = await rows((db) =>
      db
        .insert(payPeriods)
        .values({
          frequency: "weekly",
          start: week(14),
          end: addDays(week(14), 6),
          payDate: addDays(week(14), 11),
          status: "approved",
          approvedAt: new Date(),
        })
        .returning(),
    );
    const zero = {
      hoursWorked: "40",
      overtimeHours: "0",
      doubleTimeHours: "0",
      paidLeaveHours: "0",
      unpaidLeaveHours: "0",
      baseRate: "20.00",
      straightTimePay: "800.00",
      overtimePremium: "0.00",
      paidLeavePay: "0.00",
      salaryAmount: "0.00",
      salaryDeduction: "0.00",
      commissionPay: "0.00",
      nondiscretionaryBonus: "0.00",
      discretionaryBonus: "0.00",
      overtimeTrueUp: "0.00",
      grossPay: "800.00",
    };
    await rows((db) => db.insert(payPeriodLines).values({ payPeriodId: seeded!.id, employeeId: ids.wes, ...zero }));
    const before = await balances();
    const refused = await post(`/pay-periods/${seeded!.id}/reopen`, cookies.hr2);
    status(refused, 400);
    expect(refused.body.message).toContain("approved before the books started");
    expect(moved(before, await balances(), "wages")).toBe("0.00");
    const listed = (await call("get", "/pay-periods", cookies.owner)).body as PeriodBody[];
    expect(listed.find((p) => p.id === seeded!.id)?.status).toBe("approved");
  });

  it("takes back a run's time-off accrual on reopen, with the people locked", async () => {
    const policy = await post("/time-off-policies", cookies.hr, {
      name: "Sick",
      kind: "sick",
      paid: true,
      accrualMethod: "per_pay_period",
      accrualRate: "2",
      capHours: "",
      annualUseLimitHours: "",
      carryoverHours: "",
      waitingPeriodDays: 0,
      allowNegative: true,
    });
    status(policy, 201);
    const period = await open(1);
    status(await post(`/pay-periods/${period.id}/approve`, cookies.owner), 201);
    const accrued = async () =>
      rows((db) =>
        db
          .select()
          .from(timeOffEntries)
          .where(and(eq(timeOffEntries.payPeriodId, period.id), eq(timeOffEntries.policyId, policy.body.id))),
      );
    const earned = await accrued();
    expect(earned.length).toBeGreaterThan(0);
    status(await post(`/pay-periods/${period.id}/reopen`, cookies.hr2), 201);
    const after = await accrued();
    for (const employeeId of new Set(after.map((e) => e.employeeId))) {
      expect(sum(after.filter((e) => e.employeeId === employeeId).map((e) => e.hours)).isZero()).toBe(true);
    }
    expect(after.length).toBe(earned.length * 2);
  });

  it("refuses an approver who changed a time-off policy's pay since another person last approved a run", async () => {
    await approveHours(13);
    const period = await open(13);
    const sick = (
      (await call("get", "/time-off-policies", cookies.hr4).expect(200)).body as { id: string; name: string }[]
    ).find((p) => p.name === "Sick")!;
    const edited = await call("put", `/time-off-policies/${sick.id}`, cookies.hr4).send({
      name: "Sick",
      kind: "sick",
      paid: false,
      accrualMethod: "per_pay_period",
      accrualRate: "2",
      capHours: "",
      annualUseLimitHours: "",
      carryoverHours: "",
      waitingPeriodDays: 0,
      allowNegative: true,
    });
    status(edited, 200);
    const [entry] = await auditOf("Edited time-off policy", sick.id);
    expect(entry).toMatchObject({ before: { paid: true, kind: "sick" }, after: { paid: false, kind: "sick" } });
    const refused = await post(`/pay-periods/${period.id}/approve`, cookies.hr4);
    status(refused, 400);
    expect(refused.body.message).toContain("time-off policy");
  });

  it("counts a pay edit that waited on an approval's locks as made after it (one clock, in commit order)", async () => {
    // Week 13's run (left by the test above) is approved by Hal's HR manager while Ivy's HR manager
    // raises Olive's rate. The raise starts first but waits on Olive's lock until the approval commits.
    const period = (await call("get", "/pay-periods", cookies.owner).expect(200)).body.find(
      (p: PeriodBody) => p.start === week(13),
    ) as PeriodBody;
    const holder = await harness.companyDb(company.id);
    const watcher = await harness.companyDb(company.id);
    const waiting = async (count: number) => {
      for (let i = 0; i < 200; i += 1) {
        const result = await watcher.db.execute<{ n: number }>(
          sql`select count(*)::int as n from pg_stat_activity
              where datname = current_database() and wait_event_type = 'Lock'`,
        );
        if (Number(result[0]!.n) >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Expected ${count} sessions waiting on a lock.`);
    };
    let approving: Promise<Response> | undefined;
    let raising: Promise<Response> | undefined;
    try {
      await holder.db.transaction(async (tx) => {
        // Hold Olive's row so the approval stops at her lock, holding the period and earlier people.
        await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, ids.olive)).for("update");
        approving = post(`/pay-periods/${period.id}/approve`, cookies.hr2).then((r) => r);
        await waiting(1);
        // The raise begins now, before the approval, and queues behind it on Olive's lock.
        raising = call("put", `/employees/${ids.olive}`, cookies.hr4)
          .send(employeeForm({ payRate: "26.00" }))
          .then((r) => r);
        await waiting(2);
      });
      status(await approving!, 201);
      status(await raising!, 200);
    } finally {
      await holder.close();
      await watcher.close();
    }
    // The raise committed after the approval that paid Olive, so it is not paid out yet: Ivy's HR
    // manager may not approve the next run that pays it.
    await approveHours(10);
    const next = await open(10);
    const refused = await post(`/pay-periods/${next.id}/approve`, cookies.hr4);
    status(refused, 400);
    expect(refused.body.message).toContain("whose pay you added or changed");
  });

  it("lets only one of two overlapping runs approved at the same time through", async () => {
    // Week 1's run (reopened above) and a short run left inside it from another schedule.
    const weekly = (await call("get", "/pay-periods", cookies.owner).expect(200)).body.find(
      (p: PeriodBody) => p.start === week(1) && p.frequency === "weekly",
    ) as PeriodBody;
    const [inside] = await rows((db) =>
      db
        .insert(payPeriods)
        .values({
          frequency: "monthly",
          start: week(1),
          end: addDays(week(1), 2),
          payDate: addDays(week(1), 7),
          status: "open",
        })
        .returning(),
    );
    const holder = await harness.companyDb(company.id);
    const watcher = await harness.companyDb(company.id);
    let both: Promise<Response[]> | undefined;
    try {
      await holder.db.transaction(async (tx) => {
        // Hold the payroll lock, so both approvals queue on it and then run one after the other.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hr:payroll-approve'))`);
        both = Promise.all(
          [weekly.id, inside!.id].map((id) => post(`/pay-periods/${id}/approve`, cookies.owner).then((r) => r)),
        );
        for (let i = 0; i < 200; i += 1) {
          const result = await watcher.db.execute<{ n: number }>(
            sql`select count(*)::int as n from pg_stat_activity
                where datname = current_database() and wait_event_type = 'Lock'`,
          );
          if (Number(result[0]!.n) >= 2) break;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      });
    } finally {
      await holder.close();
      await watcher.close();
    }
    // The lock is released as the holder commits; then one approval runs, and the other sees it.
    const results = await both!;
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(results.find((r) => r.status === 400)!.body.message).toContain("Another approved pay period covers");
  });

  it("writes audit rows without any amount, and only for these business records", async () => {
    const entries = await rows((db) =>
      db
        .select()
        .from(auditLog)
        .where(inArray(auditLog.targetType, ["pay_period", "bonus", "contractor_payment"])),
    );
    expect(entries.length).toBeGreaterThan(10);
    for (const entry of entries) {
      const text = JSON.stringify([entry.before, entry.after, entry.targetLabel]);
      expect(text, `${entry.action}: ${text}`).not.toMatch(/\d+\.\d{2}/);
      expect(entry.actorUserId).toBeTruthy();
    }
    expect(new Set(entries.map((e) => e.action))).toEqual(
      new Set([
        "Opened pay period",
        "Left out of pay period",
        "Brought back into pay period",
        "Approved pay period",
        "Reopened pay period",
        "Exported pay period",
        "Added bonus",
        "Voided bonus",
        "Added contractor payment",
        "Paid contractor payment",
        "Voided contractor payment",
      ]),
    );
  });

  /** The gross of the lines a period carried when it was read (the frozen lines). */
  function grossOfRun(period: PeriodBody): string {
    return grossOf(period.lines);
  }
});
