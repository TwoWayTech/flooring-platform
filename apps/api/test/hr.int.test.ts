import {
  attachments,
  auditLog,
  clockEntries,
  employees,
  notifications,
  payPeriods,
  ptoRequests,
  rolePermissions,
  roles,
  settings,
  userProfiles,
} from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { addDays, PRODUCT_HEADER, workweekStartOf } from "@workspace/shared";
import { and, eq } from "drizzle-orm";
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

/** A week of hours as the API takes and sends them: decimal strings (CLAUDE.md rule 6; ADR 0046). */
function hours(...days: number[]): string[] {
  return days.map(String);
}

const PDF = { name: "contract-copy.pdf", data: Buffer.from("%PDF-1.4\n% personnel file\n").toString("base64") };

interface EmployeeBody {
  id: string;
  name: string;
  title: string;
  status: string;
  payRate?: string;
  email: string;
  documents: { id: string; name: string }[];
  onboarding: { id: string; label: string; doneAt: string | null }[];
  offboarding: { id: string; label: string; doneAt: string | null }[];
}

interface SheetBody {
  id: string;
  employeeId: string;
  weekStart: string;
  days: string[];
  status: string;
  source: string;
  rejectionReason: string | null;
  decidedBy: string | null;
  history: { action: string; reason: string | null }[];
}

interface RequestBody {
  id: string;
  employeeId: string;
  status: string;
  hours: string;
  decisionReason: string | null;
}

interface EntryBody {
  id: string;
  employeeId: string;
  policyId: string;
  kind: string;
  hours: string;
  note: string;
}

/**
 * HR, part 1 API (hr.md "People", "Timesheets", "Time off"; ADR 0046; api-contract.md "HR, part 1"):
 * permissions, people and the pay rate, the sign-in link, checklists, timesheets and overtime, the
 * clock, time off, data scope, documents and the shared GET /files/:id route.
 */
describe("HR part 1 API (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let hrSuite = { id: "", slug: "" };
  const ids = { hana: "", mara: "", wes: "", olive: "", carla: "" };
  const users = { hr: "", mgr: "", wes: "", olive: "", free: "", free2: "" };
  const cookies = {
    hr: "",
    mgr: "",
    wes: "",
    olive: "",
    clerk: "",
    bare: "",
    sales: "",
    warehouse: "",
    free: "",
    hrSuiteHr: "",
  };

  function call(method: "get" | "post" | "put", path: string, cookie?: string, product?: "hr") {
    let test = request(harness.app.getHttpServer())[method](path).set("X-Forwarded-Host", "localhost:3000");
    if (cookie) test = test.set("Cookie", cookie);
    if (product) test = test.set(PRODUCT_HEADER, product);
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

  /** Inserts a person behind the API's back; a W-2 hourly non-exempt Texan unless overridden. */
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

  /** The employee form's body with a person who has no sign-in, overridden by `over`. */
  function form(over: Record<string, unknown> = {}) {
    return {
      name: "Nia Newhire",
      title: "Installer",
      department: "Field",
      workerType: "w2",
      payType: "hourly",
      payRate: "31.75",
      state: "TX",
      email: "nia@example.test",
      phone: "555-0100",
      hiredAt: "2025-03-03",
      status: "active",
      managerId: null,
      flsaStatus: "non_exempt",
      exemptionBasis: null,
      salaryHoursPerWeek: 40,
      commissionVisible: null,
      homeLocationId: null,
      emergencyContact: null,
      ...over,
    };
  }

  async function addEmployee(cookie: string, over: Record<string, unknown> = {}): Promise<EmployeeBody> {
    const created = await call("post", "/employees", cookie).send(form(over));
    status(created, 201);
    return created.body;
  }

  async function saveWeek(
    cookie: string,
    employeeId: string,
    weekStart: string,
    days: readonly (number | string)[],
  ): Promise<SheetBody> {
    const saved = await call("put", "/timesheets", cookie).send({ employeeId, weekStart, days: days.map(String) });
    status(saved, 200);
    return saved.body;
  }

  async function submit(cookie: string, sheetId: string): Promise<SheetBody> {
    const sent = await call("post", `/timesheets/${sheetId}/submit`, cookie);
    status(sent, 201);
    return sent.body;
  }

  async function sheetsOf(cookie: string): Promise<SheetBody[]> {
    const listed = await call("get", "/timesheets", cookie);
    status(listed, 200);
    return listed.body;
  }

  async function auditOf(action: string, targetId?: string) {
    return rows((db) =>
      db
        .select()
        .from(auditLog)
        .where(
          targetId ? and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)) : eq(auditLog.action, action),
        ),
    );
  }

  async function storedPay(id: string): Promise<string> {
    return rows(async (db) => (await db.select().from(employees).where(eq(employees.id, id)))[0]!.payRate);
  }

  async function entriesOf(cookie: string, employeeId: string, policyId: string): Promise<EntryBody[]> {
    const listed = await call("get", "/time-off-entries", cookie);
    status(listed, 200);
    return (listed.body as EntryBody[]).filter((e) => e.employeeId === employeeId && e.policyId === policyId);
  }

  function balance(entries: EntryBody[]): number {
    return entries.reduce((sum, entry) => sum + Number(entry.hours), 0);
  }

  async function fileBytes(cookie: string | undefined, id: string, product?: "hr") {
    return call("get", `/files/${id}`, cookie, product)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      });
  }

  function policyForm(over: Record<string, unknown> = {}) {
    return {
      name: "Vacation",
      kind: "vacation",
      paid: true,
      accrualMethod: "none",
      accrualRate: "0",
      capHours: "",
      annualUseLimitHours: "",
      carryoverHours: "",
      waitingPeriodDays: 0,
      allowNegative: false,
      ...over,
    };
  }

  async function addPolicy(over: Record<string, unknown> = {}): Promise<{ id: string; name: string }> {
    const created = await call("post", "/time-off-policies", cookies.hr).send(policyForm(over));
    status(created, 201);
    return created.body;
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("hrpeople");
    hrSuite = await harness.provisionCompany("hrsuite", ["hr"]);
    await rows(async (db) => {
      // The workweek and the payroll rule the hours and the clock need (the seed writes the same rows).
      await db
        .insert(settings)
        .values([
          { group: "hr", value: { workweekStartDay: 1, clockEnabled: true } },
          { group: "localization", value: { payroll: { overtimeRule: "federal" } } },
        ])
        .onConflictDoNothing();
      // Roles the defaults do not have: an HR clerk who may edit people but not see pay, one with no HR
      // keys, a branch-scoped people editor, and a writer who may edit people without reading them.
      const grants: Record<string, [string[], "all" | "branch"]> = {
        hrclerk: [
          ["hr.employee.view", "hr.employee.create", "hr.employee.edit", "hr.timesheet.view", "hr.pto.view"],
          "all",
        ],
        nohr: [["customers.customer.view"], "all"],
        hrbranch: [["hr.employee.view", "hr.employee.create", "hr.employee.edit"], "branch"],
        hrwriter: [["hr.employee.edit", "hr.timesheet.view"], "all"],
      };
      for (const [key, [keys, dataScope]] of Object.entries(grants)) {
        const [role] = await db.insert(roles).values({ key, name: key, dataScope }).returning();
        await db.insert(rolePermissions).values(keys.map((permissionKey) => ({ roleId: role!.id, permissionKey })));
      }
    });
    const emails = {
      hr: await harness.addUser({ companyIds: [company.id], roles: ["hr"] }),
      mgr: await harness.addUser({ companyIds: [company.id], roles: ["manager"] }),
      wes: await harness.addUser({ companyIds: [company.id], roles: ["employee"] }),
      olive: await harness.addUser({ companyIds: [company.id], roles: ["employee"] }),
      clerk: await harness.addUser({ companyIds: [company.id], roles: ["hrclerk"] }),
      bare: await harness.addUser({ companyIds: [company.id], roles: ["nohr"] }),
      sales: await harness.addUser({ companyIds: [company.id], roles: ["sales"] }),
      warehouse: await harness.addUser({ companyIds: [company.id], roles: ["warehouse"] }),
      free: await harness.addUser({ companyIds: [company.id], roles: ["employee"] }),
      free2: await harness.addUser({ companyIds: [company.id], roles: ["employee"] }),
    };
    for (const key of ["hr", "mgr", "wes", "olive", "free", "free2"] as const) {
      users[key] = await harness.userIdOf(emails[key]);
    }
    const hana = await person({
      name: "Hana Hartley",
      payType: "salary",
      payRate: "52.00",
      flsaStatus: "exempt",
      exemptionBasis: "administrative",
    });
    const mara = await person({ name: "Mara Mills", payRate: "28.00", managerId: hana.id });
    const wes = await person({ name: "Wes Walker", payRate: "20.00", managerId: mara.id });
    const olive = await person({ name: "Olive Otis", payRate: "19.00", managerId: hana.id });
    const carla = await person({ name: "Carla Cruz", state: "CA", payRate: "25.00", managerId: hana.id });
    Object.assign(ids, { hana: hana.id, mara: mara.id, wes: wes.id, olive: olive.id, carla: carla.id });
    await rows(async (db) => {
      for (const [userId, employeeId] of [
        [users.hr, hana.id],
        [users.mgr, mara.id],
        [users.wes, wes.id],
        [users.olive, olive.id],
      ] as const) {
        await db.update(userProfiles).set({ employeeId }).where(eq(userProfiles.userId, userId));
      }
    });
    cookies.hr = await enrolled(emails.hr);
    cookies.mgr = await harness.signIn(emails.mgr);
    cookies.wes = await harness.signIn(emails.wes);
    cookies.olive = await harness.signIn(emails.olive);
    cookies.clerk = await harness.signIn(emails.clerk);
    cookies.bare = await harness.signIn(emails.bare);
    cookies.sales = await harness.signIn(emails.sales);
    cookies.warehouse = await harness.signIn(emails.warehouse);
    cookies.free = await harness.signIn(emails.free);
    cookies.hrSuiteHr = await enrolled(await harness.addUser({ companyIds: [hrSuite.id], roles: ["hr"] }));
  }, 180_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("refuses the unauthenticated, and each role without the route's keys, and lets HR read", async () => {
    for (const [method, path] of [
      ["get", "/employees"],
      ["post", "/employees"],
      ["get", "/timesheets"],
      ["post", "/clock/in"],
      ["get", "/time-off-policies"],
      ["get", "/pto-requests"],
    ] as const) {
      expect((await call(method, path)).status, `${method} ${path}`).toBe(401);
    }
    const some = uuidv7();
    // A role with no HR key at all is refused everywhere.
    for (const [method, path] of [
      ["get", "/employees"],
      ["get", "/timesheets"],
      ["get", "/clock-entries"],
      ["get", "/time-off-policies"],
      ["get", "/time-off-entries"],
      ["get", "/pto-requests"],
      ["post", "/clock/in"],
      ["put", "/timesheets"],
      ["post", "/pto-requests"],
    ] as const) {
      expect((await call(method, path, cookies.bare).send({})).status, `bare ${method} ${path}`).toBe(403);
    }
    // Sales, Warehouse, an employee and a manager hold only own-time keys or no write keys for these.
    const writes = [
      ["post", "/employees"],
      ["put", `/employees/${some}`],
      ["post", `/employees/${some}/offboarding`],
      ["post", `/employees/${some}/documents`],
      ["post", `/employees/${some}/checklist/${some}`],
      ["post", "/timesheets/decisions"],
      ["post", `/timesheets/${some}/reopen`],
      ["post", `/pto-requests/${some}/decision`],
      ["post", "/time-off-adjustments"],
      ["post", "/time-off-policies"],
      ["put", `/time-off-policies/${some}`],
    ] as const;
    for (const who of ["sales", "warehouse", "wes"] as const) {
      for (const [method, path] of writes) {
        expect((await call(method, path, cookies[who]).send({})).status, `${who} ${method} ${path}`).toBe(403);
      }
    }
    // A manager approves and reads but neither creates people nor edits policies.
    for (const [method, path] of [
      ["post", "/employees"],
      ["put", `/employees/${some}`],
      ["post", "/time-off-policies"],
      ["put", `/time-off-policies/${some}`],
    ] as const) {
      expect((await call(method, path, cookies.mgr).send({})).status, `manager ${method} ${path}`).toBe(403);
    }
    for (const path of ["/employees", "/timesheets", "/clock-entries", "/time-off-policies", "/pto-requests"]) {
      status(await call("get", path, cookies.hr), 200);
    }
  });

  it("adds and edits a person with the one error body, an onboarding checklist and audit rows", async () => {
    const created = await addEmployee(cookies.hr);
    expect(created).toMatchObject({ name: "Nia Newhire", payRate: "31.75", status: "active" });
    expect(created.onboarding.length).toBeGreaterThan(0);
    expect(created.onboarding.every((step) => step.doneAt === null)).toBe(true);
    expect(created.offboarding).toEqual([]);
    expect(await auditOf("Added employee", created.id)).toHaveLength(1);

    const edited = await call("put", `/employees/${created.id}`, cookies.hr).send(form({ title: "Lead installer" }));
    status(edited, 200);
    expect(edited.body.title).toBe("Lead installer");
    expect(edited.body.onboarding).toHaveLength(created.onboarding.length);
    const audit = await auditOf("Edited employee", created.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.before).toMatchObject({ title: "Installer" });
    expect(audit[0]!.after).toMatchObject({ title: "Lead installer" });

    const invalid: [Record<string, unknown>, string][] = [
      [{ name: "   " }, "Enter the person's name."],
      [{ state: "ZZ" }, "Choose the work state"],
      [{ flsaStatus: "not_applicable" }, "exempt or non-exempt"],
      [{ payRate: "twenty" }, "Enter an amount"],
      [{ hiredAt: "2025-13-45" }, "date"],
      [{ managerId: uuidv7() }, "Choose the manager"],
      [{ homeLocationId: uuidv7() }, "Choose the home location"],
    ];
    for (const [over, message] of invalid) {
      const refused = await call("post", "/employees", cookies.hr).send(form(over));
      status(refused, 400);
      expect(refused.body.code).toBe("invalid_request");
      expect(refused.body.message).toContain(message);
    }
    const self = await call("put", `/employees/${created.id}`, cookies.hr).send(form({ managerId: created.id }));
    status(self, 400);
    expect(self.body.message).toContain("own manager");
    // Wes reports to Mara, so making Mara report to Wes would loop.
    const loop = await call("put", `/employees/${ids.mara}`, cookies.hr).send(
      form({ name: "Mara Mills", managerId: ids.wes }),
    );
    status(loop, 400);
    expect(loop.body.message).toContain("loop");
    status(await call("put", `/employees/${uuidv7()}`, cookies.hr).send(form()), 404);
    // A 1099 worker is outside overtime law, and a California salary covers 40 hours (hr.md rule 2).
    const contractor = await addEmployee(cookies.hr, {
      name: "Cal Contractor",
      workerType: "1099",
      flsaStatus: "exempt",
      state: "CA",
      salaryHoursPerWeek: 20,
    });
    expect(contractor).toMatchObject({ workerType: "1099", flsaStatus: "not_applicable", salaryHoursPerWeek: 40 });
  });

  it("refuses a Social Security or bank account field, and stores nothing", async () => {
    for (const extra of [{ ssn: "000-00-0000" }, { bankAccount: "000000" }]) {
      const refused = await call("post", "/employees", cookies.hr).send(form({ name: "Strict Test", ...extra }));
      status(refused, 400);
      expect(refused.body.code).toBe("invalid_request");
      expect(refused.body.message).toContain(Object.keys(extra)[0]);
    }
    const edit = await call("put", `/employees/${ids.olive}`, cookies.hr).send(
      form({ name: "Olive Otis", ssn: "000-00-0000" }),
    );
    status(edit, 400);
    const stored = await rows((db) => db.select().from(employees).where(eq(employees.name, "Strict Test")));
    expect(stored).toEqual([]);
  });

  it("strips the pay rate without view_sensitive, keeps it when that writer saves, and never audits it", async () => {
    const pat = await addEmployee(cookies.hr, { name: "Pat Payroll", payRate: "77.77" });
    expect(pat.payRate).toBe("77.77");
    const seen = await call("get", "/employees", cookies.clerk);
    status(seen, 200);
    expect((seen.body as EmployeeBody[]).some((row) => row.id === pat.id)).toBe(true);
    for (const row of seen.body as EmployeeBody[]) expect(row).not.toHaveProperty("payRate");

    // A writer without the key changes the rest; the stored rate stays.
    const edited = await call("put", `/employees/${pat.id}`, cookies.clerk).send(
      form({ name: "Pat Payroll", title: "Lead", payRate: "1.00" }),
    );
    status(edited, 200);
    expect(edited.body).not.toHaveProperty("payRate");
    expect(await storedPay(pat.id)).toBe("77.77");
    const added = await call("post", "/employees", cookies.clerk).send(
      form({ name: "Quinn Clerked", payRate: "9.00" }),
    );
    status(added, 201);
    expect(added.body).not.toHaveProperty("payRate");
    expect(await storedPay(added.body.id)).toBe("0.00");

    const raised = await call("put", `/employees/${pat.id}`, cookies.hr).send(
      form({ name: "Pat Payroll", title: "Lead", payRate: "80.00" }),
    );
    status(raised, 200);
    expect(raised.body.payRate).toBe("80.00");
    const audited = [...(await auditOf("Edited employee", pat.id)), ...(await auditOf("Added employee", pat.id))];
    expect(audited.length).toBeGreaterThanOrEqual(2);
    for (const entry of audited) {
      const text = JSON.stringify([entry.before, entry.after]);
      expect(text).not.toMatch(/"payRate"/);
      expect(text).not.toMatch(/77\.77|80\.00|1\.00/);
    }
    expect(audited.some((entry) => (entry.after as Record<string, unknown>).payRateChanged === true)).toBe(true);

    // Nobody changes their own pay; saving the same rate is fine.
    const own = await call("put", `/employees/${ids.hana}`, cookies.hr).send(
      form({
        name: "Hana Hartley",
        payType: "salary",
        flsaStatus: "exempt",
        exemptionBasis: "administrative",
        payRate: "99.00",
        email: "",
      }),
    );
    status(own, 400);
    expect(own.body.message).toContain("Someone else must change your own pay rate");
    expect(await storedPay(ids.hana)).toBe("52.00");
    const same = await call("put", `/employees/${ids.hana}`, cookies.hr).send(
      form({
        name: "Hana Hartley",
        payType: "salary",
        flsaStatus: "exempt",
        exemptionBasis: "administrative",
        payRate: "52.00",
        email: "",
      }),
    );
    status(same, 200);
  });

  it("links a member's sign-in to a person, refusing non-members, taken links and one's own", async () => {
    const nia = await addEmployee(cookies.hr, { name: "Link Target" });
    const put = (over: Record<string, unknown>, cookie = cookies.hr, id = nia.id) =>
      call("put", `/employees/${id}`, cookie).send(form({ name: "Link Target", ...over }));
    const outsider = await harness.userIdOf(await harness.addUser({ companyIds: [hrSuite.id], roles: ["employee"] }));
    for (const [userId, message] of [
      [uuidv7(), "Choose a member of this company."],
      [outsider, "Choose a member of this company."],
      [users.olive, "already linked to another person"],
      [users.hr, "Someone else must link"],
    ] as const) {
      const refused = await put({ userId });
      status(refused, 400);
      expect(refused.body.message).toContain(message);
    }
    status(await put({ userId: "not-a-uuid" }), 400);
    // Nobody unlinks their own sign-in either.
    const unlinkOwn = await put({ userId: null }, cookies.hr, ids.hana);
    status(unlinkOwn, 400);
    const linked = (userId: string) =>
      rows(async (db) => (await db.select().from(userProfiles).where(eq(userProfiles.userId, userId)))[0]!.employeeId);

    status(await put({ userId: users.free }), 200);
    expect(await linked(users.free)).toBe(nia.id);
    // Linking another sign-in moves the link: one sign-in per person.
    status(await put({ userId: users.free2 }), 200);
    expect(await linked(users.free)).toBeNull();
    expect(await linked(users.free2)).toBe(nia.id);
    // Leaving userId out keeps the link; null removes it.
    status(await put({ title: "Moved" }), 200);
    expect(await linked(users.free2)).toBe(nia.id);
    status(await put({ userId: null }), 200);
    expect(await linked(users.free2)).toBeNull();
    const audit = await auditOf("Edited employee", nia.id);
    expect(audit.some((entry) => (entry.after as Record<string, unknown>).userId === users.free2)).toBe(true);
  });

  it("ticks the onboarding checklist, and offboarding marks the person left once", async () => {
    const nia = await addEmployee(cookies.hr, { name: "Offboard Me" });
    const step = nia.onboarding[0]!;
    const ticked = await call("post", `/employees/${nia.id}/checklist/${step.id}`, cookies.hr).send({
      list: "onboarding",
      done: true,
    });
    status(ticked, 201);
    expect(ticked.body.onboarding[0].doneAt).not.toBeNull();
    const unticked = await call("post", `/employees/${nia.id}/checklist/${step.id}`, cookies.hr).send({
      list: "onboarding",
      done: false,
    });
    expect(unticked.body.onboarding[0].doneAt).toBeNull();
    status(
      await call("post", `/employees/${nia.id}/checklist/${step.id}`, cookies.hr).send({
        list: "offboarding",
        done: true,
      }),
      404,
    );
    status(
      await call("post", `/employees/${nia.id}/checklist/${uuidv7()}`, cookies.hr).send({
        list: "onboarding",
        done: true,
      }),
      404,
    );
    status(
      await call("post", `/employees/${nia.id}/checklist/${step.id}`, cookies.hr).send({ list: "onboarding" }),
      400,
    );
    expect(await auditOf("Completed checklist step", nia.id)).toHaveLength(1);
    expect(await auditOf("Reopened checklist step", nia.id)).toHaveLength(1);

    const left = await call("post", `/employees/${nia.id}/offboarding`, cookies.hr);
    status(left, 201);
    expect(left.body.status).toBe("terminated");
    expect(left.body.offboarding.length).toBeGreaterThan(0);
    const again = await call("post", `/employees/${nia.id}/offboarding`, cookies.hr);
    status(again, 201);
    expect(again.body.offboarding).toHaveLength(left.body.offboarding.length);
    expect(await auditOf("Started offboarding", nia.id)).toHaveLength(1);
    status(await call("post", `/employees/${uuidv7()}/offboarding`, cookies.hr), 404);
    // Someone who has left no longer files hours.
    const filed = await call("put", "/timesheets", cookies.hr).send({
      employeeId: nia.id,
      weekStart: week(7),
      days: hours(8, 8, 8, 8, 8, 0, 0),
    });
    status(filed, 400);
    expect(filed.body.message).toContain("does not use timesheets");
  });

  it("saves and submits one's own week, refuses bad hours and other people's weeks, and locks a submitted week", async () => {
    const w = week(1);
    const saved = await saveWeek(cookies.wes, ids.wes, w, [12, 12, 12, 6, 0, 0, 0]);
    expect(saved).toMatchObject({ status: "draft", days: hours(12, 12, 12, 6, 0, 0, 0), weekStart: w });
    const bad: [Record<string, unknown>, string][] = [
      [{ days: hours(8, 8, 8, 8, 8, 0) }, "seven days"],
      [{ days: hours(25, 0, 0, 0, 0, 0, 0) }, "between 0 and 24"],
      [{ days: hours(7.555, 0, 0, 0, 0, 0, 0) }, "two decimals"],
      [{ days: ["-1", "0", "0", "0", "0", "0", "0"] }, "between 0 and 24"],
      [{ days: ["8 h", "0", "0", "0", "0", "0", "0"] }, "as a number"],
      // Hours are decimal strings on the wire; a JSON number is refused (CLAUDE.md rule 6).
      [{ days: [8, 8, 8, 8, 8, 0, 0] }, ""],
      [{ weekStart: addDays(w, 1) }, "first day of the company's workweek"],
      [{ weekStart: week(-1) }, "future week"],
      [{ note: "x" }, ""],
    ];
    for (const [over, message] of bad) {
      const refused = await call("put", "/timesheets", cookies.wes).send({
        employeeId: ids.wes,
        weekStart: w,
        days: hours(8, 8, 8, 8, 8, 0, 0),
        ...over,
      });
      status(refused, 400);
      expect(refused.body.code).toBe("invalid_request");
      expect(refused.body.message).toContain(message);
    }
    // Someone else's week needs approve and scope: Wes holds neither, the manager is out of scope for Olive.
    const theirs = { employeeId: ids.olive, weekStart: week(6), days: hours(8, 8, 8, 8, 8, 0, 0) };
    status(await call("put", "/timesheets", cookies.wes).send(theirs), 404);
    status(await call("put", "/timesheets", cookies.mgr).send(theirs), 404);
    const oliveSheet = await saveWeek(cookies.hr, ids.olive, week(6), theirs.days);
    status(await call("post", `/timesheets/${oliveSheet.id}/submit`, cookies.wes), 404);
    status(await call("post", `/timesheets/${oliveSheet.id}/submit`, cookies.mgr), 404);

    const sent = await submit(cookies.wes, saved.id);
    expect(sent.status).toBe("submitted");
    const locked = await call("put", "/timesheets", cookies.wes).send({
      employeeId: ids.wes,
      weekStart: w,
      days: hours(1, 1, 1, 1, 1, 0, 0),
    });
    status(locked, 400);
    expect(locked.body.message).toContain("waits for approval");
    status(await call("post", `/timesheets/${saved.id}/submit`, cookies.wes), 400);
    status(await call("post", "/timesheets/decisions", cookies.wes).send({ action: "approve", ids: [saved.id] }), 403);
    expect((await sheetsOf(cookies.wes)).find((s) => s.id === saved.id)?.days).toEqual(hours(12, 12, 12, 6, 0, 0, 0));
    expect(await auditOf("Saved timesheet hours", saved.id)).toHaveLength(1);
    expect(await auditOf("Submitted timesheet", saved.id)).toHaveLength(1);
  });

  it("approves by the payroll rule, records the overtime split, locks the week, and bars one's own sheet", async () => {
    const wes = (await sheetsOf(cookies.wes)).find((s) => s.weekStart === week(1))!;
    status(await call("post", "/timesheets/decisions", cookies.mgr).send({ action: "approve", ids: [wes.id] }), 201);
    const [approval] = await auditOf("Approved timesheet", wes.id);
    // 42 hours under the company's federal rule: 40 regular, 2 overtime.
    expect(approval!.after).toMatchObject({ status: "approved", regular: 40, overtime: 2, doubleTime: 0 });
    const decided = (await sheetsOf(cookies.wes)).find((s) => s.id === wes.id)!;
    expect(decided.status).toBe("approved");
    expect(decided.decidedBy).not.toBeNull();
    const locked = await call("put", "/timesheets", cookies.wes).send({
      employeeId: ids.wes,
      weekStart: week(1),
      days: hours(1, 1, 1, 1, 1, 0, 0),
    });
    status(locked, 400);
    expect(locked.body.message).toContain("locked");

    // A California work state overrides the company's rule: 13 hours is 8 regular, 4 overtime, 1 double time.
    const carla = await saveWeek(cookies.hr, ids.carla, week(3), [13, 0, 0, 0, 0, 0, 0]);
    await submit(cookies.hr, carla.id);
    status(await call("post", "/timesheets/decisions", cookies.hr).send({ action: "approve", ids: [carla.id] }), 201);
    const [california] = await auditOf("Approved timesheet", carla.id);
    expect(california!.after).toMatchObject({ regular: 8, overtime: 4, doubleTime: 1 });

    // Nobody decides their own sheet; someone else can.
    const mara = await saveWeek(cookies.mgr, ids.mara, week(4), [8, 8, 8, 8, 8, 0, 0]);
    await submit(cookies.mgr, mara.id);
    const own = await call("post", "/timesheets/decisions", cookies.mgr).send({ action: "approve", ids: [mara.id] });
    status(own, 400);
    expect(own.body.message).toContain("Someone else must decide your own timesheet");
    status(await call("post", "/timesheets/decisions", cookies.hr).send({ action: "approve", ids: [mara.id] }), 201);
  });

  it("decides sheets in bulk all or none, within scope, and sends one back with a reason", async () => {
    const w = week(2);
    const wes = await saveWeek(cookies.wes, ids.wes, w, [8, 8, 8, 8, 8, 0, 0]);
    const olive = await saveWeek(cookies.hr, ids.olive, w, [8, 8, 8, 8, 8, 0, 0]);
    await submit(cookies.wes, wes.id);
    const state = async (id: string) => (await sheetsOf(cookies.hr)).find((s) => s.id === id)!;

    // One sheet is still a draft, so nothing at all is decided.
    const mixed = await call("post", "/timesheets/decisions", cookies.hr).send({
      action: "approve",
      ids: [wes.id, olive.id],
    });
    status(mixed, 400);
    expect(mixed.body.message).toContain("not waiting for approval");
    expect((await state(wes.id)).status).toBe("submitted");
    await submit(cookies.hr, olive.id);
    // Olive is not the manager's report: 404 for the whole request.
    status(
      await call("post", "/timesheets/decisions", cookies.mgr).send({ action: "approve", ids: [wes.id, olive.id] }),
      404,
    );
    expect((await state(wes.id)).status).toBe("submitted");
    status(
      await call("post", "/timesheets/decisions", cookies.hr).send({ action: "approve", ids: [wes.id, uuidv7()] }),
      404,
    );
    expect((await state(wes.id)).status).toBe("submitted");
    status(await call("post", "/timesheets/decisions", cookies.hr).send({ action: "approve", ids: [] }), 400);
    status(
      await call("post", "/timesheets/decisions", cookies.hr).send({ action: "reject", ids: [wes.id], reason: "" }),
      400,
    );
    status(
      await call("post", "/timesheets/decisions", cookies.hr).send({ action: "approve", ids: [wes.id], reason: "x" }),
      400,
    );

    status(
      await call("post", "/timesheets/decisions", cookies.mgr).send({
        action: "reject",
        ids: [wes.id],
        reason: "Friday hours are missing",
      }),
      201,
    );
    const rejected = await state(wes.id);
    expect(rejected).toMatchObject({ status: "rejected", rejectionReason: "Friday hours are missing" });
    // A sent-back week can be corrected and sent again.
    await saveWeek(cookies.wes, ids.wes, w, [8, 8, 8, 8, 4, 0, 0]);
    await submit(cookies.wes, wes.id);
    status(
      await call("post", "/timesheets/decisions", cookies.hr).send({ action: "approve", ids: [wes.id, olive.id] }),
      201,
    );
    expect((await state(wes.id)).status).toBe("approved");
    expect((await state(olive.id)).status).toBe("approved");
    expect(await auditOf("Rejected timesheet", wes.id)).toHaveLength(1);
  });

  it("reopens an approved week with a reason, unless an approved pay period covers it", async () => {
    const w = week(5);
    const sheet = await saveWeek(cookies.hr, ids.wes, w, [8, 8, 8, 8, 8, 0, 0]);
    status(await call("post", `/timesheets/${sheet.id}/reopen`, cookies.hr).send({ reason: "Fixing hours" }), 400);
    await submit(cookies.hr, sheet.id);
    status(await call("post", "/timesheets/decisions", cookies.hr).send({ action: "approve", ids: [sheet.id] }), 201);
    status(await call("post", `/timesheets/${sheet.id}/reopen`, cookies.wes).send({ reason: "Fixing hours" }), 403);
    status(await call("post", `/timesheets/${sheet.id}/reopen`, cookies.hr).send({ reason: "x" }), 400);
    status(await call("post", `/timesheets/${sheet.id}/reopen`, cookies.hr).send({}), 400);
    const [period] = await rows((db) =>
      db
        .insert(payPeriods)
        .values({ frequency: "weekly", start: w, end: addDays(w, 6), payDate: addDays(w, 12), status: "approved" })
        .returning(),
    );
    const blocked = await call("post", `/timesheets/${sheet.id}/reopen`, cookies.hr).send({ reason: "Fixing hours" });
    status(blocked, 400);
    expect(blocked.body.message).toContain("approved pay period");
    await rows((db) => db.update(payPeriods).set({ deletedAt: new Date() }).where(eq(payPeriods.id, period!.id)));
    const reopened = await call("post", `/timesheets/${sheet.id}/reopen`, cookies.hr).send({ reason: "Fixing hours" });
    status(reopened, 201);
    expect(reopened.body.status).toBe("draft");
    expect(reopened.body.history.at(-1)).toMatchObject({ action: "reopened", reason: "Fixing hours" });
    // Draft again, so it is editable.
    await saveWeek(cookies.wes, ids.wes, w, [4, 4, 4, 4, 4, 0, 0]);
    expect(await auditOf("Reopened timesheet", sheet.id)).toHaveLength(1);
  });

  it("clocks in and out for the signed-in person only, when the company uses the clock", async () => {
    status(await call("post", "/clock/out", cookies.wes), 400);
    const unlinked = await call("post", "/clock/in", cookies.free);
    status(unlinked, 400);
    expect(unlinked.body.message).toContain("not linked");
    const punched = await call("post", "/clock/in", cookies.wes);
    status(punched, 201);
    expect(punched.body).toMatchObject({ employeeId: ids.wes, outAt: null });
    const twice = await call("post", "/clock/in", cookies.wes);
    status(twice, 400);
    expect(twice.body.message).toContain("already clocked in");

    const own = (await call("get", "/clock-entries", cookies.wes)).body as { employeeId: string }[];
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((entry) => entry.employeeId === ids.wes)).toBe(true);
    expect(
      ((await call("get", "/clock-entries", cookies.olive)).body as { employeeId: string }[]).every(
        (e) => e.employeeId === ids.olive,
      ),
    ).toBe(true);
    expect(
      ((await call("get", "/clock-entries", cookies.hr)).body as { employeeId: string }[]).some(
        (e) => e.employeeId === ids.wes,
      ),
    ).toBe(true);

    const out = await call("post", "/clock/out", cookies.wes);
    status(out, 201);
    expect(out.body.outAt).not.toBeNull();
    const thisWeek = (await sheetsOf(cookies.wes)).find((s) => s.weekStart === week(0));
    expect(thisWeek).toMatchObject({ status: "draft", source: "clock" });
    expect(await auditOf("Clocked in")).toHaveLength(1);
    expect(await auditOf("Clocked out")).toHaveLength(1);

    // The company's switch decides, with the same one error body.
    const flip = (clockEnabled: boolean) =>
      rows((db) =>
        db
          .update(settings)
          .set({ value: { workweekStartDay: 1, clockEnabled } })
          .where(eq(settings.group, "hr")),
      );
    await flip(false);
    try {
      const off = await call("post", "/clock/in", cookies.olive);
      status(off, 400);
      expect(off.body.message).toContain("does not use the clock");
    } finally {
      await flip(true);
    }
    const open = await rows((db) => db.select().from(clockEntries).where(eq(clockEntries.employeeId, ids.olive)));
    expect(open).toEqual([]);
  });

  it("answers 409 settings_missing for hours in a company that never saved the HR and payroll settings", async () => {
    const lena = await call("post", "/employees", cookies.hrSuiteHr, "hr").send(form({ name: "Lena Lakes" }));
    status(lena, 201);
    const refused = await call("put", "/timesheets", cookies.hrSuiteHr, "hr").send({
      employeeId: lena.body.id,
      weekStart: week(1),
      days: hours(8, 8, 8, 8, 8, 0, 0),
    });
    status(refused, 409);
    expect(refused.body.code).toBe("settings_missing");
    // Time off needs no workweek, so it still answers.
    status(await call("get", "/time-off-policies", cookies.hrSuiteHr, "hr"), 200);
  });

  it("saves time-off policies in Settings, with the California carryover guard, audited as settings", async () => {
    const created = await addPolicy({
      name: "Personal days",
      kind: "personal",
      accrualMethod: "per_pay_period",
      accrualRate: "3.08",
    });
    expect(created).toMatchObject({ name: "Personal days", accrualRate: "3.08", capHours: "" });
    const edited = await call("put", `/time-off-policies/${created.id}`, cookies.hr).send(
      policyForm({
        name: "Personal days",
        kind: "personal",
        accrualMethod: "per_pay_period",
        accrualRate: "3.08",
        capHours: "80",
      }),
    );
    status(edited, 200);
    expect(edited.body.capHours).toBe("80");
    const audit = await auditOf("Edited time-off policy", created.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.category).toBe("settings");
    expect(await auditOf("Added time-off policy", created.id)).toHaveLength(1);

    for (const [over, message] of [
      [{ name: "  " }, "Give the policy a name."],
      [{ accrualRate: "lots" }, "accrual rate"],
      [{ capHours: "ten" }, "hours"],
      [{ kind: "holiday" }, ""],
      // Carla works in California and has not left: no carryover limit on vacation.
      [{ carryoverHours: "40" }, "California does not allow"],
    ] as [Record<string, unknown>, string][]) {
      const refused = await call("post", "/time-off-policies", cookies.hr).send(policyForm(over));
      status(refused, 400);
      expect(refused.body.code).toBe("invalid_request");
      expect(refused.body.message).toContain(message);
    }
    status(await call("put", `/time-off-policies/${uuidv7()}`, cookies.hr).send(policyForm()), 404);
    // Everyone with time-off access reads the policies; only Settings writes them.
    expect(
      ((await call("get", "/time-off-policies", cookies.wes)).body as { id: string }[]).some(
        (p) => p.id === created.id,
      ),
    ).toBe(true);
    status(await call("get", "/time-off-policies", cookies.clerk), 200);
  });

  it("requests time off within the balance, and decides it by another person only", async () => {
    const policy = await addPolicy({ name: "Vacation A" });
    const start = addDays(companyDay(), 30);
    const ask = (cookie: string, over: Record<string, unknown> = {}) =>
      call("post", "/pto-requests", cookie).send({
        employeeId: ids.wes,
        policyId: policy.id,
        start,
        end: start,
        hours: "8",
        note: "Family",
        ...over,
      });
    // Balance: only a manual adjustment by someone else, with a reason.
    const adjust = (cookie: string, over: Record<string, unknown> = {}) =>
      call("post", "/time-off-adjustments", cookie).send({
        employeeId: ids.wes,
        policyId: policy.id,
        hours: "16",
        note: "Starting balance",
        ...over,
      });
    status(await adjust(cookies.wes), 403);
    status(await adjust(cookies.mgr, { employeeId: ids.olive }), 404);
    status(await adjust(cookies.hr, { employeeId: ids.hana }), 400);
    status(await adjust(cookies.hr, { note: "x" }), 400);
    status(await adjust(cookies.hr, { hours: "0" }), 400);
    status(await adjust(cookies.hr, { hours: "1.234" }), 400);
    status(await adjust(cookies.hr, { policyId: uuidv7() }), 400);
    const given = await adjust(cookies.hr);
    status(given, 201);
    expect(given.body).toMatchObject({ kind: "adjustment", hours: "16", note: "Starting balance" });
    expect(await auditOf("Adjusted time-off balance", ids.wes)).toHaveLength(1);

    const tooMuch = await ask(cookies.wes, { hours: "100" });
    status(tooMuch, 400);
    expect(tooMuch.body.message).toContain("hours left");
    status(await ask(cookies.wes, { end: addDays(start, -1) }), 400);
    status(await ask(cookies.wes, { employeeId: ids.olive }), 404);
    const made = await ask(cookies.wes);
    status(made, 201);
    expect(made.body).toMatchObject({ status: "pending", hours: "8", employeeId: ids.wes });
    // Pending hours count against the balance.
    status(await ask(cookies.wes, { hours: "9" }), 400);

    // Wes cannot decide, nor can another employee.
    status(await call("post", `/pto-requests/${made.body.id}/decision`, cookies.wes).send({ action: "approve" }), 403);
    status(
      await call("post", `/pto-requests/${made.body.id}/decision`, cookies.olive).send({ action: "approve" }),
      403,
    );
    status(
      await call("post", `/pto-requests/${made.body.id}/decision`, cookies.mgr).send({ action: "deny", reason: "" }),
      400,
    );
    const approved = await call("post", `/pto-requests/${made.body.id}/decision`, cookies.mgr).send({
      action: "approve",
    });
    status(approved, 201);
    expect(approved.body.status).toBe("approved");
    status(await call("post", `/pto-requests/${made.body.id}/decision`, cookies.mgr).send({ action: "approve" }), 400);
    const ledger = await entriesOf(cookies.wes, ids.wes, policy.id);
    expect(ledger.find((entry) => entry.kind === "used")?.hours).toBe("-8");
    expect(balance(ledger)).toBe(8);
    expect(await auditOf("Approved time off", made.body.id)).toHaveLength(1);

    // A manager asks for their own time; someone else decides it.
    status(await adjust(cookies.hr, { employeeId: ids.mara }), 201);
    const hers = await ask(cookies.mgr, { employeeId: ids.mara });
    status(hers, 201);
    const own = await call("post", `/pto-requests/${hers.body.id}/decision`, cookies.mgr).send({ action: "approve" });
    status(own, 400);
    expect(own.body.message).toContain("Someone else must decide your own time off");
    const denied = await call("post", `/pto-requests/${hers.body.id}/decision`, cookies.hr).send({
      action: "deny",
      reason: "Short staffed",
    });
    status(denied, 201);
    expect(denied.body).toMatchObject({ status: "denied", decisionReason: "Short staffed" });
    expect(balance(await entriesOf(cookies.mgr, ids.mara, policy.id))).toBe(16);
  });

  it("cancels pending and approved requests that have not started, and gives the hours back", async () => {
    const policy = await addPolicy({ name: "Vacation B" });
    const start = addDays(companyDay(), 40);
    status(
      await call("post", "/time-off-adjustments", cookies.hr).send({
        employeeId: ids.wes,
        policyId: policy.id,
        hours: "20",
        note: "Starting balance",
      }),
      201,
    );
    const ask = async () => {
      const made = await call("post", "/pto-requests", cookies.wes).send({
        employeeId: ids.wes,
        policyId: policy.id,
        start,
        end: start,
        hours: "4",
        note: "",
      });
      status(made, 201);
      return made.body as RequestBody;
    };
    const pending = await ask();
    status(await call("post", `/pto-requests/${pending.id}/cancel`, cookies.olive), 404);
    const cancelled = await call("post", `/pto-requests/${pending.id}/cancel`, cookies.wes);
    status(cancelled, 201);
    expect(cancelled.body.status).toBe("cancelled");
    status(await call("post", `/pto-requests/${pending.id}/cancel`, cookies.wes), 400);

    const approved = await ask();
    status(await call("post", `/pto-requests/${approved.id}/decision`, cookies.mgr).send({ action: "approve" }), 201);
    expect(balance(await entriesOf(cookies.wes, ids.wes, policy.id))).toBe(16);
    status(await call("post", `/pto-requests/${approved.id}/cancel`, cookies.wes), 201);
    const ledger = await entriesOf(cookies.wes, ids.wes, policy.id);
    expect(balance(ledger)).toBe(20);
    expect(ledger.filter((entry) => entry.note === "Cancelled time off returned")).toHaveLength(1);
    expect(await auditOf("Cancelled time off", approved.id)).toHaveLength(1);

    // Time off that has started is not given back.
    const [started] = await rows((db) =>
      db
        .insert(ptoRequests)
        .values({
          employeeId: ids.wes,
          policyId: policy.id,
          start: addDays(companyDay(), -1),
          end: addDays(companyDay(), -1),
          hours: "8",
          kind: "vacation",
          status: "approved",
        })
        .returning(),
    );
    const refused = await call("post", `/pto-requests/${started!.id}/cancel`, cookies.wes);
    status(refused, 400);
    expect(refused.body.message).toContain("started");
  });

  it("limits time-off and timesheet reads to the person's scope: own, direct reports, or everyone", async () => {
    const seenIn = async (path: string, cookie: string) =>
      new Set(((await call("get", path, cookie)).body as { employeeId: string }[]).map((row) => row.employeeId));
    // Wes (own scope) sees only himself; Mara (branch scope) sees herself and her report Wes, not Olive.
    for (const path of ["/timesheets", "/time-off-entries", "/pto-requests"]) {
      const wes = await seenIn(path, cookies.wes);
      expect(
        [...wes].every((id) => id === ids.wes),
        `${path} as Wes`,
      ).toBe(true);
      const mara = await seenIn(path, cookies.mgr);
      expect(mara.has(ids.olive), `${path} as Mara`).toBe(false);
      expect(mara.has(ids.carla), `${path} as Mara`).toBe(false);
      expect(
        [...mara].every((id) => id === ids.wes || id === ids.mara),
        `${path} as Mara`,
      ).toBe(true);
    }
    expect((await seenIn("/timesheets", cookies.mgr)).has(ids.wes)).toBe(true);
    const hr = await seenIn("/timesheets", cookies.hr);
    expect(hr.has(ids.olive) && hr.has(ids.wes) && hr.has(ids.carla)).toBe(true);

    // The people list: Wes sees himself with his own details; nobody else's.
    const own = (await call("get", "/employees", cookies.wes)).body as EmployeeBody[];
    expect(own.map((row) => row.id)).toEqual([ids.wes]);
    expect(own[0]).not.toHaveProperty("payRate");
    // A person whose sign-in is linked to no employee sees nobody.
    expect((await call("get", "/employees", cookies.sales)).body).toEqual([]);
    // hr.employee.view reads every record (hr.md "Data scope").
    const all = (await call("get", "/employees", cookies.mgr)).body as EmployeeBody[];
    expect(all.length).toBeGreaterThan(5);
    status(await call("post", `/timesheets/${uuidv7()}/submit`, cookies.mgr), 404);
  });

  it("keeps employee documents behind hr.employee.view and GET /files/:id, and refuses other owners' proofs", async () => {
    const added = await call("post", `/employees/${ids.wes}/documents`, cookies.hr).send({ files: [PDF] });
    status(added, 201);
    expect(added.body.documents).toHaveLength(1);
    const docId = added.body.documents[0].id as string;
    expect(await auditOf("Added employee documents", ids.wes)).toHaveLength(1);
    const file = await fileBytes(cookies.hr, docId);
    status(file, 200);
    expect((file.body as Buffer).toString()).toBe(Buffer.from(PDF.data, "base64").toString());
    status(await fileBytes(cookies.mgr, docId), 200);
    // Without hr.employee.view: Wes holds no key the route accepts; Sales passes the route but the service refuses.
    status(await fileBytes(cookies.wes, docId), 403);
    status(await fileBytes(cookies.sales, docId), 404);
    status(await fileBytes(undefined, docId), 401);
    status(await fileBytes(cookies.hr, uuidv7()), 404);
    // The list hides the documents from a reader without hr.employee.view, except the person's own.
    const visible = (await call("get", "/employees", cookies.wes)).body as EmployeeBody[];
    expect(visible[0]!.documents.map((d) => d.id)).toEqual([docId]);

    status(await call("post", `/employees/${ids.wes}/documents`, cookies.hr).send({ files: [] }), 400);
    status(
      await call("post", `/employees/${ids.wes}/documents`, cookies.hr).send({ files: [PDF, PDF, PDF, PDF] }),
      400,
    );
    const fake = await call("post", `/employees/${ids.wes}/documents`, cookies.hr).send({
      files: [{ name: "x.pdf", data: Buffer.from("not a real pdf at all").toString("base64") }],
    });
    status(fake, 400);
    expect(fake.body.code).toBe("invalid_request");
    status(await call("post", `/employees/${uuidv7()}/documents`, cookies.hr).send({ files: [PDF] }), 404);

    // GET /files/:id now asks only for `platform`; an expense or payment proof still needs that type's keys.
    const proof = async (ownerType: string) =>
      rows(
        async (db) =>
          (
            await db
              .insert(attachments)
              .values({
                ownerType,
                ownerId: uuidv7(),
                storageKey: `${company.id}/${uuidv7()}`,
                name: "proof.pdf",
                contentType: "application/pdf",
                size: 12,
              })
              .returning()
          )[0]!.id,
      );
    for (const ownerType of ["expense", "payment", "refund", "bill", "supplier_payment", "contract"]) {
      const id = await proof(ownerType);
      // HR passes the route (hr.employee.view) but holds none of the owner type's keys.
      status(await fileBytes(cookies.hr, id), 404);
      status(await fileBytes(cookies.wes, id), 403);
      status(await fileBytes(cookies.warehouse, id), 403);
    }
    const expenseProof = await proof("expense");
    status(await fileBytes(cookies.sales, expenseProof), 404);
  });

  it("serves HR Suite companies, which have no core module, and keeps each company's data apart", async () => {
    const lena = await call("post", "/employees", cookies.hrSuiteHr, "hr").send(form({ name: "Hugo Harbor" }));
    status(lena, 201);
    const listed = (await call("get", "/employees", cookies.hrSuiteHr, "hr")).body as EmployeeBody[];
    expect(listed.map((row) => row.name)).toContain("Hugo Harbor");
    expect(listed.map((row) => row.name)).not.toContain("Wes Walker");
    // Another company's person, document or sheet is not there to be written.
    status(await call("put", `/employees/${ids.wes}`, cookies.hrSuiteHr, "hr").send(form({ name: "Wes Walker" })), 404);
    status(await call("post", `/employees/${ids.wes}/offboarding`, cookies.hrSuiteHr, "hr"), 404);
    status(await call("post", `/employees/${ids.wes}/documents`, cookies.hrSuiteHr, "hr").send({ files: [PDF] }), 404);

    const doc = await call("post", `/employees/${lena.body.id}/documents`, cookies.hrSuiteHr, "hr").send({
      files: [PDF],
    });
    status(doc, 201);
    status(await fileBytes(cookies.hrSuiteHr, doc.body.documents[0].id, "hr"), 200);
    // The route no longer needs `core`, but another owner type's file still does.
    const expenseProof = await rows(
      async (db) =>
        (
          await db
            .insert(attachments)
            .values({
              ownerType: "expense",
              ownerId: uuidv7(),
              storageKey: `${hrSuite.id}/${uuidv7()}`,
              name: "receipt.pdf",
              contentType: "application/pdf",
              size: 12,
            })
            .returning()
        )[0]!.id,
      hrSuite.id,
    );
    status(await fileBytes(cookies.hrSuiteHr, expenseProof, "hr"), 404);
    // A flooring company's employee document is not reachable from the other company's session.
    const wesDoc = ((await call("get", "/employees", cookies.hr)).body as EmployeeBody[]).find((e) => e.id === ids.wes)!
      .documents[0]!;
    status(await fileBytes(cookies.hrSuiteHr, wesDoc.id, "hr"), 404);
    // And the flooring session cannot act as the HR Suite.
    status(await call("get", "/employees", cookies.hr, "hr"), 403);
  });
  /** A template upload of hours rows, one per [email, date, hours], under the template's own headers. */
  function upload(cookie: string, cells: [string, string, string][], apply: boolean, own = false) {
    return call("post", "/timesheets/upload", cookie).send({
      table: {
        headers: ["employee_email", "employee_external_id", "employee_name", "work_date", "hours_worked", "note"],
        rows: cells.map(([email, date, h]) => [email, "", "", date, h, ""]),
      },
      fileName: "hours.csv",
      apply,
      own,
    });
  }

  /** A member with a role, signed in, linked to an employee when one is given. */
  async function member(role: string, employeeId: string | null) {
    const email = await harness.addUser({ companyIds: [company.id], roles: [role] });
    const userId = await harness.userIdOf(email);
    if (employeeId) {
      await rows((db) => db.update(userProfiles).set({ employeeId }).where(eq(userProfiles.userId, userId)));
    }
    return { email, userId, cookie: await harness.signIn(email) };
  }

  /** The problems of each planned row of an upload, as one line per row. */
  function rowProblems(body: { rows: { problems: { message: string }[] }[] }): string[] {
    return body.rows.map((row) => row.problems.map((p) => p.message).join(" "));
  }

  it("refuses a submitted week in an upload, and applies the save checks to every uploaded row", async () => {
    const email = "wes.walker@example.test";
    await rows((db) => db.update(employees).set({ email }).where(eq(employees.id, ids.wes)));
    const w = week(9);
    const sheet = await saveWeek(cookies.hr, ids.wes, w, [8, 8, 8, 8, 8, 0, 0]);
    await submit(cookies.hr, sheet.id);
    const checked = await upload(cookies.hr, [[email, addDays(w, 1), "2"]], false);
    status(checked, 201);
    expect(rowProblems(checked.body)[0]).toContain("waits for approval");
    status(await upload(cookies.hr, [[email, addDays(w, 1), "2"]], true), 400);
    expect((await sheetsOf(cookies.hr)).find((s) => s.id === sheet.id)).toMatchObject({
      status: "submitted",
      days: hours(8, 8, 8, 8, 8, 0, 0),
    });

    // A future week, three decimals and someone who does not use timesheets are refused by row.
    const exempt = await person({
      name: "Exempt Ed",
      email: "ed@example.test",
      flsaStatus: "exempt",
      exemptionBasis: "administrative",
    });
    const refused = await upload(
      cookies.hr,
      [
        [email, addDays(week(-1), 1), "8"],
        [email, addDays(week(10), 1), "7.555"],
        [exempt.email, addDays(week(10), 1), "8"],
      ],
      false,
    );
    status(refused, 201);
    const problems = rowProblems(refused.body);
    expect(problems[0]).toContain("future week");
    expect(problems[1]).toContain("two decimals");
    expect(problems[2]).toContain("does not use timesheets");
    status(await upload(cookies.hr, [[email, addDays(week(10), 1), "6.5"]], true), 201);
    const filed = (await sheetsOf(cookies.hr)).find((s) => s.employeeId === ids.wes && s.weekStart === week(10))!;
    expect(filed).toMatchObject({ days: hours(0, 6.5, 0, 0, 0, 0, 0), source: "upload" });
  });

  it("refuses an approver's own rows in an upload without hr.timesheet.edit, and their own week by form", async () => {
    await rows(async (db) => {
      const [role] = await db.insert(roles).values({ key: "approver", name: "approver", dataScope: "all" }).returning();
      await db.insert(rolePermissions).values(
        ["hr.timesheet.view", "hr.timesheet.approve", "hr.pto.view", "hr.pto.approve"].map((permissionKey) => ({
          roleId: role!.id,
          permissionKey,
        })),
      );
    });
    const abe = await person({ name: "Abe Approver", email: "abe@example.test" });
    const approver = await member("approver", abe.id);
    const w = week(11);
    const own = await upload(approver.cookie, [["abe@example.test", addDays(w, 1), "8"]], false);
    status(own, 400);
    expect(own.body.message).toContain("can't upload your own hours");
    status(await upload(approver.cookie, [["abe@example.test", addDays(w, 1), "8"]], true), 400);
    status(
      await call("put", "/timesheets", approver.cookie).send({
        employeeId: abe.id,
        weekStart: w,
        days: hours(8, 8, 8, 8, 8, 0, 0),
      }),
      404,
    );
    expect((await sheetsOf(cookies.hr)).some((s) => s.employeeId === abe.id)).toBe(false);
    // Someone else's rows are still the approver's to upload.
    status(await upload(approver.cookie, [["wes.walker@example.test", addDays(w, 2), "4"]], true), 201);
  });

  it("refuses self-dealing to a sign-in that matches an employee only by email", async () => {
    const twinEmail = await harness.addUser({ companyIds: [company.id], roles: ["hr"] });
    const uma = await person({ name: "Uma Unlinked", email: `  ${twinEmail.toUpperCase()} `, payRate: "30.00" });
    const twin = await enrolled(twinEmail);
    const umaForm = (over: Record<string, unknown>) =>
      form({ name: "Uma Unlinked", email: twinEmail, payRate: "30.00", ...over });

    // The pay rate and the other pay facts on one's own record.
    for (const over of [
      { payRate: "99.00" },
      { payType: "salary" },
      { flsaStatus: "exempt", exemptionBasis: "administrative" },
      { salaryHoursPerWeek: 30 },
      { workerType: "1099" },
    ]) {
      const refused = await call("put", `/employees/${uma.id}`, twin).send(umaForm(over));
      status(refused, 400);
      expect(refused.body.message).toContain("Someone else must change your own pay rate");
    }
    expect(await storedPay(uma.id)).toBe("30.00");
    status(await call("put", `/employees/${uma.id}`, twin).send(umaForm({ title: "Lead" })), 200);
    // A linked sign-in can't change its own salaried hours either.
    const hana = await call("put", `/employees/${ids.hana}`, cookies.hr).send(
      form({
        name: "Hana Hartley",
        payType: "salary",
        flsaStatus: "exempt",
        exemptionBasis: "administrative",
        payRate: "52.00",
        email: "",
        salaryHoursPerWeek: 30,
      }),
    );
    status(hana, 400);
    expect(hana.body.message).toContain("Someone else must change your own pay rate");

    // Timesheets: neither decide nor reopen one's own.
    const sheet = await saveWeek(cookies.hr, uma.id, week(8), [8, 8, 8, 8, 8, 0, 0]);
    await submit(cookies.hr, sheet.id);
    const decided = await call("post", "/timesheets/decisions", twin).send({ action: "approve", ids: [sheet.id] });
    status(decided, 400);
    expect(decided.body.message).toContain("Someone else must decide your own timesheet");
    status(await call("post", "/timesheets/decisions", cookies.hr).send({ action: "approve", ids: [sheet.id] }), 201);
    const reopened = await call("post", `/timesheets/${sheet.id}/reopen`, twin).send({ reason: "Fixing hours" });
    status(reopened, 400);
    expect(reopened.body.message).toContain("Someone else must reopen your own timesheet");
    // A linked manager can't reopen their own approved week (Mara's, approved by HR earlier).
    const mara = (await sheetsOf(cookies.mgr)).find((s) => s.employeeId === ids.mara && s.weekStart === week(4))!;
    status(await call("post", `/timesheets/${mara.id}/reopen`, cookies.mgr).send({ reason: "Fixing hours" }), 400);

    // Time off: neither adjust one's own balance nor decide one's own request.
    const policy = await addPolicy({ name: "Vacation Twin" });
    const adjust = (cookie: string) =>
      call("post", "/time-off-adjustments", cookie).send({
        employeeId: uma.id,
        policyId: policy.id,
        hours: "16",
        note: "Starting balance",
      });
    const own = await adjust(twin);
    status(own, 400);
    expect(own.body.message).toContain("Someone else must adjust your own balance");
    status(await adjust(cookies.hr), 201);
    const start = addDays(companyDay(), 60);
    const asked = await call("post", "/pto-requests", cookies.hr).send({
      employeeId: uma.id,
      policyId: policy.id,
      start,
      end: start,
      hours: "8",
      note: "",
    });
    status(asked, 201);
    const decision = await call("post", `/pto-requests/${asked.body.id}/decision`, twin).send({ action: "approve" });
    status(decision, 400);
    expect(decision.body.message).toContain("Someone else must decide your own time off");
    const stillPending = ((await call("get", "/pto-requests", cookies.hr)).body as RequestBody[]).find(
      (r) => r.id === asked.body.id,
    );
    expect(stillPending?.status).toBe("pending");
  });

  it("keeps the stored pay type and salaried hours when someone without view_sensitive saves", async () => {
    const sal = await addEmployee(cookies.hr, {
      name: "Sal Salaried",
      payType: "salary",
      flsaStatus: "exempt",
      exemptionBasis: "administrative",
      salaryHoursPerWeek: 35,
    });
    const edited = await call("put", `/employees/${sal.id}`, cookies.clerk).send(
      form({
        name: "Sal Salaried",
        title: "Office lead",
        payType: "hourly",
        flsaStatus: "exempt",
        exemptionBasis: "administrative",
        salaryHoursPerWeek: 40,
      }),
    );
    status(edited, 200);
    const [stored] = await rows((db) => db.select().from(employees).where(eq(employees.id, sal.id)));
    expect(stored).toMatchObject({ title: "Office lead", payType: "salary", salaryHoursPerWeek: 35 });
  });

  it("refuses a clock-out that would put more than 24 hours on one day, and keeps the punch open", async () => {
    const [open] = await rows((db) =>
      db
        .insert(clockEntries)
        .values({ employeeId: ids.olive, date: companyDay(), inAt: new Date(Date.now() - 25 * 3_600_000) })
        .returning(),
    );
    try {
      const out = await call("post", "/clock/out", cookies.olive);
      status(out, 400);
      expect(out.body.message).toContain("more than 24 hours");
      const [still] = await rows((db) => db.select().from(clockEntries).where(eq(clockEntries.id, open!.id)));
      expect(still!.outAt).toBeNull();
    } finally {
      await rows((db) => db.update(clockEntries).set({ deletedAt: new Date() }).where(eq(clockEntries.id, open!.id)));
    }
  });

  it("tells only approvers whose effective access and data scope cover the employee", async () => {
    // A manager whose branch scope covers Carla, not Wes.
    const carlaManager = await member("manager", ids.carla);
    const policy = await addPolicy({ name: "Vacation Notes", allowNegative: true });
    const start = addDays(companyDay(), 70);
    status(
      await call("post", "/pto-requests", cookies.wes).send({
        employeeId: ids.wes,
        policyId: policy.id,
        start,
        end: start,
        hours: "8",
        note: "",
      }),
      201,
    );
    const sheet = await saveWeek(cookies.wes, ids.wes, week(12), [8, 8, 8, 8, 8, 0, 0]);
    await submit(cookies.wes, sheet.id);
    const told = async (title: string) =>
      new Set(
        (await rows((db) => db.select().from(notifications).where(eq(notifications.title, title)))).map(
          (row) => row.userId,
        ),
      );
    for (const title of ["Time off request from Wes Walker", "Timesheet from Wes Walker to approve"]) {
      const recipients = await told(title);
      expect(recipients.has(users.mgr), `${title}: Wes's manager`).toBe(true);
      expect(recipients.has(users.hr), `${title}: HR`).toBe(true);
      expect(recipients.has(carlaManager.userId), `${title}: another team's manager`).toBe(false);
      expect(recipients.has(users.olive), `${title}: an employee`).toBe(false);
    }
  });

  it("decides overlapping batches at once without a deadlock: one wins, the other is refused", async () => {
    const w = week(13);
    const a = await saveWeek(cookies.hr, ids.wes, w, [8, 8, 8, 8, 8, 0, 0]);
    const b = await saveWeek(cookies.hr, ids.olive, w, [8, 8, 8, 8, 8, 0, 0]);
    await submit(cookies.hr, a.id);
    await submit(cookies.hr, b.id);
    const [first, second] = await Promise.all([
      call("post", "/timesheets/decisions", cookies.hr).send({ action: "approve", ids: [a.id, b.id] }),
      call("post", "/timesheets/decisions", cookies.hr).send({
        action: "reject",
        ids: [b.id, a.id],
        reason: "Check the hours",
      }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 400]);
    const sheets = await sheetsOf(cookies.hr);
    const states = new Set([a.id, b.id].map((id) => sheets.find((s) => s.id === id)!.status));
    expect(states.size).toBe(1);
  });
  it("locks the email on one's own record and refuses a second record with one's own sign-in email", async () => {
    const twinEmail = await harness.addUser({ companyIds: [company.id], roles: ["hr"] });
    const twin = await enrolled(twinEmail);
    const ivy = await addEmployee(cookies.hr, { name: "Ivy Ingram", email: twinEmail, payRate: "30.00" });
    const ivyForm = (over: Record<string, unknown>) =>
      form({ name: "Ivy Ingram", email: twinEmail, payRate: "30.00", ...over });

    // Step 1 of the bypass, changing one's own email so the match is lost, is refused.
    const moved = await call("put", `/employees/${ivy.id}`, twin).send(ivyForm({ email: "ivy.other@example.test" }));
    status(moved, 400);
    expect(moved.body.message).toContain("Someone else must change the email on your own record");
    // The same email in other letter case is no change.
    status(await call("put", `/employees/${ivy.id}`, twin).send(ivyForm({ email: twinEmail.toUpperCase() })), 200);
    const [stored] = await rows((db) => db.select().from(employees).where(eq(employees.id, ivy.id)));
    expect(stored!.email.toLowerCase()).toBe(twinEmail.toLowerCase());
    // So step 2, raising one's own pay, is still refused.
    status(await call("put", `/employees/${ivy.id}`, twin).send(ivyForm({ payRate: "90.00" })), 400);
    expect(await storedPay(ivy.id)).toBe("30.00");

    // Nobody makes a second "self" record, by adding one or by editing someone else's email.
    const second = await call("post", "/employees", twin).send(
      form({ name: "Ivy Two", email: twinEmail.toUpperCase() }),
    );
    status(second, 400);
    expect(second.body.message).toContain("Your own sign-in email");
    const other = await addEmployee(cookies.hr, { name: "Otto Other", email: "otto@example.test" });
    const taken = await call("put", `/employees/${other.id}`, twin).send(
      form({ name: "Otto Other", email: twinEmail }),
    );
    status(taken, 400);
    expect(taken.body.message).toContain("Your own sign-in email");
    // Someone else may still change Ivy's email.
    status(await call("put", `/employees/${ivy.id}`, cookies.hr).send(ivyForm({ email: "ivy@example.test" })), 200);
  });

  it("refuses status, commission, checklist and offboarding changes on one's own record", async () => {
    const twinEmail = await harness.addUser({ companyIds: [company.id], roles: ["hr"] });
    const twin = await enrolled(twinEmail);
    const rae = await addEmployee(cookies.hr, { name: "Rae Rowe", email: twinEmail, payRate: "30.00" });
    const raeForm = (over: Record<string, unknown>) =>
      form({ name: "Rae Rowe", email: twinEmail, payRate: "30.00", ...over });
    for (const over of [{ status: "on_leave" }, { commissionVisible: true }]) {
      const refused = await call("put", `/employees/${rae.id}`, twin).send(raeForm(over));
      status(refused, 400);
      expect(refused.body.message).toContain("Someone else must change your own status");
    }
    const step = rae.onboarding[0]!;
    const tick = await call("post", `/employees/${rae.id}/checklist/${step.id}`, twin).send({
      list: "onboarding",
      done: true,
    });
    status(tick, 400);
    expect(tick.body.message).toContain("Someone else must tick your own checklist");
    const off = await call("post", `/employees/${rae.id}/offboarding`, twin);
    status(off, 400);
    expect(off.body.message).toContain("Someone else must start your own offboarding");
    const [stored] = await rows((db) => db.select().from(employees).where(eq(employees.id, rae.id)));
    expect(stored).toMatchObject({ status: "active", commissionVisible: null });
    // Someone else may.
    status(await call("post", `/employees/${rae.id}/offboarding`, cookies.hr), 201);
  });

  it("lets only a company-wide data scope change a manager", async () => {
    const bea = await person({ name: "Bea Branch" });
    const editor = await member("hrbranch", bea.id);
    const theo = await addEmployee(cookies.hr, { name: "Theo Team", email: "theo@example.test" });
    const theoForm = (over: Record<string, unknown>) =>
      form({ name: "Theo Team", email: "theo@example.test", ...over });
    const pulled = await call("put", `/employees/${theo.id}`, editor.cookie).send(theoForm({ managerId: bea.id }));
    status(pulled, 400);
    expect(pulled.body.message).toContain("change a manager");
    const added = await call("post", "/employees", editor.cookie).send(form({ name: "New Report", managerId: bea.id }));
    status(added, 400);
    // Other edits stay open to them, and someone with company-wide scope may set the manager.
    status(await call("put", `/employees/${theo.id}`, editor.cookie).send(theoForm({ title: "Lead" })), 200);
    status(await call("put", `/employees/${theo.id}`, cookies.hr).send(theoForm({ managerId: bea.id })), 200);
  });

  it("refuses clock-in for someone who has left", async () => {
    const gone = await person({ name: "Gus Gone", status: "terminated" });
    const left = await member("employee", gone.id);
    const punched = await call("post", "/clock/in", left.cookie);
    status(punched, 400);
    expect(punched.body.message).toContain("has left");
    expect(await rows((db) => db.select().from(clockEntries).where(eq(clockEntries.employeeId, gone.id)))).toEqual([]);
  });

  it("re-checks the balance when approving time off", async () => {
    const policy = await addPolicy({ name: "Vacation Recheck" });
    const adjust = (hours: string) =>
      call("post", "/time-off-adjustments", cookies.hr).send({
        employeeId: ids.olive,
        policyId: policy.id,
        hours,
        note: "Balance change",
      });
    status(await adjust("16"), 201);
    const start = addDays(companyDay(), 80);
    const asked = await call("post", "/pto-requests", cookies.olive).send({
      employeeId: ids.olive,
      policyId: policy.id,
      start,
      end: start,
      hours: "12",
      note: "",
    });
    status(asked, 201);
    status(await adjust("-8"), 201);
    const approve = () =>
      call("post", `/pto-requests/${asked.body.id}/decision`, cookies.hr).send({ action: "approve" });
    const refused = await approve();
    status(refused, 400);
    expect(refused.body.message).toContain("8 hours left");
    expect(balance(await entriesOf(cookies.hr, ids.olive, policy.id))).toBe(8);
    status(await adjust("8"), 201);
    status(await approve(), 201);
    expect(balance(await entriesOf(cookies.hr, ids.olive, policy.id))).toBe(4);
  });

  it("does not ask an approver to decide a request from the employee their email matches", async () => {
    const twinEmail = await harness.addUser({ companyIds: [company.id], roles: ["hr"] });
    const otherHr = await harness.addUser({ companyIds: [company.id], roles: ["hr"] });
    const nell = await person({ name: "Nell Notified", email: twinEmail.toUpperCase() });
    const policy = await addPolicy({ name: "Vacation Notify", allowNegative: true });
    const start = addDays(companyDay(), 90);
    status(
      await call("post", "/pto-requests", cookies.hr).send({
        employeeId: nell.id,
        policyId: policy.id,
        start,
        end: start,
        hours: "8",
        note: "",
      }),
      201,
    );
    const told = new Set(
      (
        await rows((db) =>
          db.select().from(notifications).where(eq(notifications.title, "Time off request from Nell Notified")),
        )
      ).map((row) => row.userId),
    );
    expect(told.has(await harness.userIdOf(otherHr))).toBe(true);
    expect(told.has(await harness.userIdOf(twinEmail))).toBe(false);
  });

  it("keeps the stored contact fields when a writer without hr.employee.view saves", async () => {
    const contact = { name: "Pat Parent", phone: "555-0142", relation: "Parent" };
    const pia = await addEmployee(cookies.hr, {
      name: "Pia Private",
      email: "pia@example.test",
      phone: "555-0199",
      emergencyContact: contact,
    });
    const writer = await member("hrwriter", null);
    const saved = await call("put", `/employees/${pia.id}`, writer.cookie).send(
      form({ name: "Pia Private", title: "Lead", email: "", phone: "", emergencyContact: null }),
    );
    status(saved, 200);
    expect(saved.body).toMatchObject({ title: "Lead", email: "", phone: "" });
    const [stored] = await rows((db) => db.select().from(employees).where(eq(employees.id, pia.id)));
    expect(stored).toMatchObject({
      title: "Lead",
      email: "pia@example.test",
      phone: "555-0199",
      emergencyContact: contact,
    });
  });
});
