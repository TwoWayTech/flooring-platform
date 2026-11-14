import {
  auditLog,
  branches,
  commissionAdjustments,
  commissionPlans,
  customers,
  employees,
  invoices,
  journalEntries,
  journalLines,
  ledgerAccounts,
  locations,
  outboxMessages,
  paymentsReceived,
  rolePermissions,
  roles,
  settings,
  userProfiles,
} from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { addDays, dec, moneyString, monthEnd, PRODUCT_HEADER, sum, workweekStartOf } from "@workspace/shared";
import { and, eq, inArray } from "drizzle-orm";
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

/** The monday of the workweek `weeksAgo` weeks before today's (the seeded workweek starts on Monday). */
function week(weeksAgo: number): string {
  return addDays(workweekStartOf(companyDay(), 1), -7 * weeksAgo);
}

/** The month (`yyyy-MM`) `back` months before the current one. */
function monthsAgo(back: number): string {
  const [year, month] = companyDay().slice(0, 7).split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1 - back, 1)).toISOString().slice(0, 7);
}

/** Midday UTC on a day of a month, so the day reads the same in every time zone. */
function at(month: string, day: string): Date {
  return new Date(`${month}-${day}T12:00:00Z`);
}

interface TrialBalance {
  balanced: boolean;
  rows: { key: string | null; balance: string }[];
}

interface LineView {
  id: string;
  kind: string;
  invoiceId: string;
  sourceId: string;
  planId: string;
  basis: string;
  base: string | null;
  collected: string;
  commission: string;
  reversalState: string | null;
}

interface StatementRow {
  userId: string;
  month: string;
  status: string;
  earned: string;
  override: string;
  reversal: string;
  adjustment: string;
  net: string;
  carryIn: string;
  draw: string;
  payable: string;
  carryOut: string;
  lines: LineView[];
  needsReview: boolean;
  statementId: string | null;
  name: string;
  approvedBy: string | null;
  payPeriodId: string | null;
  monthEnded: boolean;
  planName: string | null;
}

interface PlanView {
  id: string;
  name: string;
  version: number;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  baseRatePct: string;
  monthlyTarget: string;
}

interface AssignmentView {
  id: string;
  userId: string;
  planId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  monthlyTargetOverride: string | null;
  acknowledgement: { signedName: string; signedAt: string } | null;
}

interface CommissionData {
  statements: StatementRow[];
  plans: PlanView[];
  assignments: AssignmentView[];
  people: { id: string; name: string; active: boolean }[];
  invoices: { id: string; number: string; salesRepId: string; isReturn: boolean; voidedAt: string | null }[];
}

interface PayLine {
  employeeId: string;
  grossPay: string;
  salaryAmount: string;
  commissionPay: string;
  nondiscretionaryBonus: string;
  discretionaryBonus: string;
  overtimeTrueUp: string;
}

interface PeriodBody {
  id: string;
  start: string;
  end: string;
  status: string;
  lines: PayLine[];
}

/** A plan body as the form sends it. */
function planBody(over: Record<string, unknown> = {}) {
  return {
    name: "Flat five",
    basis: "paid_revenue",
    baseRatePct: "4",
    monthlyTarget: "10000.00",
    tierMode: "marginal",
    tiers: [],
    overridePct: "0",
    draw: { kind: "none", monthlyAmount: "0.00" },
    clawbackDays: 90,
    ...over,
  };
}

const ADDRESS = { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" };

/**
 * Commissions on the API (commissions.md; ADR 0048; api-contract.md "Commissions"): keys, scope and
 * product, plans and their versions, assignments, statements built from paid invoices with the margin
 * base hidden, approval with its postings and separation of duties, adjustments and reversal decisions,
 * the pay run that pays an approved statement outside Wages, team totals and audit without amounts.
 */
describe("commissions API (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let other = { id: "", slug: "" };
  let hrSuite = { id: "", slug: "" };
  const M1 = monthsAgo(1);
  const M2 = monthsAgo(2);
  const M3 = monthsAgo(3);
  const CURRENT = monthsAgo(0);
  const ids = {
    owner: "",
    hrA: "",
    hrB: "",
    hrC: "",
    repA: "",
    repB: "",
    repS: "",
    repT: "",
    empA: "",
    empHrA: "",
    empT: "",
    flatV2: "",
    planO: "",
    branchMain: "",
    branchOther: "",
    locA: "",
    locB: "",
    customer: "",
    flat: "",
    margin: "",
    i1: "",
    i2: "",
    i3: "",
    i4: "",
    i5: "",
    pay3: "",
    pay5: "",
  };
  const cookies = {
    owner: "",
    accountant: "",
    hrA: "", // linked; adds plans and assignments, adds the pay run's period
    hrB: "", // linked; adds a plan, adjusts, sets a sale's split, approves what it did not shape
    hrC: "", // an HR manager whose sign-in is not linked to an employee
    repA: "",
    repB: "",
    repS: "",
    manager: "", // branch scope, in the Main branch
    managerOther: "", // branch scope, in another branch
    employee: "",
    view: "",
    approve: "",
    adjust: "",
    manage: "",
    branchAll: "",
    otherOwner: "",
    hrSuiteOwner: "",
  };
  let ledgerStart = new Map<string, string>();

  function call(method: "get" | "post" | "put", path: string, cookie?: string, product?: "hr") {
    let test = request(harness.app.getHttpServer())[method](path).set("X-Forwarded-Host", "localhost:3000");
    if (cookie) test = test.set("Cookie", cookie);
    if (product) test = test.set(PRODUCT_HEADER, product);
    return test;
  }

  const send = (method: "post" | "put", path: string, cookie: string, body: Record<string, unknown> = {}) =>
    call(method, path, cookie).send(body);

  /** Asserts a status and shows the body when it differs. */
  function status(response: Response, expected: number): void {
    expect(response.status, JSON.stringify(response.body)).toBe(expected);
  }

  /** Asserts one refusal: 400 with the one error body and this message. */
  function refused(response: Response, message: string): void {
    status(response, 400);
    expect(response.body).toEqual({ code: "invalid_request", message });
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

  async function data(cookie = cookies.owner): Promise<CommissionData> {
    const read = await call("get", "/commissions", cookie);
    status(read, 200);
    return read.body as CommissionData;
  }

  /** One person's statement for a month, as HR → Commissions shows it. */
  async function statement(userId: string, month: string, cookie = cookies.owner): Promise<StatementRow> {
    const row = (await data(cookie)).statements.find((s) => s.userId === userId && s.month === month);
    expect(row, `${userId} ${month}`).toBeDefined();
    return row!;
  }

  const approve = (cookie: string, userId: string, month: string) =>
    send("post", "/commission-statements/approve", cookie, { userId, month });

  async function auditOf(action: string) {
    return rows((db) => db.select().from(auditLog).where(eq(auditLog.action, action)));
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
              payType: "salary",
              payRate: "52000.00",
              state: "TX",
              hiredAt: companyDay(),
              status: "active",
              flsaStatus: "exempt",
              exemptionBasis: "administrative",
              ...over,
            })
            .returning()
        )[0]!,
    );
  }

  async function addInvoice(
    number: string,
    salesRepId: string,
    subtotal: string,
    cost: string,
    month: string,
    branchId = ids.branchMain,
  ) {
    return rows(
      async (db) =>
        (
          await db
            .insert(invoices)
            .values({
              number,
              customerId: ids.customer,
              salesRepId,
              branchId,
              issuedAt: at(month, "09"),
              locationId: ids.locA,
              jobSite: ADDRESS,
              taxSource: { kind: "none", label: "No tax" },
              subtotal,
              tax: "0.00",
              total: subtotal,
              cost,
            })
            .returning({ id: invoices.id })
        )[0]!.id,
    );
  }

  /** A customer payment on a day of a month (the 10th unless given); only a confirmed one earns commission. */
  async function addPayment(
    number: string,
    invoiceId: string,
    amount: string,
    month: string,
    state: "confirmed" | "pending" = "confirmed",
    day = "10",
  ) {
    const when = at(month, day);
    return rows(
      async (db) =>
        (
          await db
            .insert(paymentsReceived)
            .values({
              number,
              invoiceId,
              customerId: ids.customer,
              kind: "payment",
              amount,
              date: `${month}-${day}`,
              method: "check",
              status: state,
              recordedById: ids.owner,
              recordedAt: when,
              reviewedById: state === "confirmed" ? ids.hrA : null,
              reviewedAt: state === "confirmed" ? when : null,
            })
            .returning({ id: paymentsReceived.id })
        )[0]!.id,
    );
  }

  /** The journal entry a statement's approval posted, with its lines by account key. */
  async function entryOf(statementId: string) {
    return rows(async (db) => {
      const [entry] = await db
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.sourceType, "commission_statement"), eq(journalEntries.sourceId, statementId)));
      const lines = entry
        ? await db
            .select({
              key: ledgerAccounts.key,
              debit: journalLines.debit,
              credit: journalLines.credit,
              locationId: journalLines.locationId,
            })
            .from(journalLines)
            .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
            .where(eq(journalLines.entryId, entry.id))
        : [];
      return { entry, lines };
    });
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("commis");
    other = await harness.provisionCompany("commisother");
    hrSuite = await harness.provisionCompany("commishr", ["hr"]);
    await rows(async (db) => {
      const [main, elsewhere] = await db
        .insert(branches)
        .values([
          { name: "Main", city: "Austin", state: "TX" },
          { name: "Elsewhere", city: "Dallas", state: "TX" },
        ])
        .returning();
      ids.branchMain = main!.id;
      ids.branchOther = elsewhere!.id;
      const [a, b] = await db
        .insert(locations)
        .values([
          { name: "North Store", kind: "showroom" as const, branchId: main!.id, address: ADDRESS, isDefault: true },
          { name: "South Store", kind: "showroom" as const, branchId: main!.id, address: ADDRESS },
        ])
        .returning();
      ids.locA = a!.id;
      ids.locB = b!.id;
      const [buyer] = await db
        .insert(customers)
        .values({ type: "homeowner", name: "Sample Buyer", terms: "due_on_receipt" })
        .returning();
      ids.customer = buyer!.id;
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
      // Custom roles hold one commission key each, company-wide; one holds all four at branch scope.
      const make = async (key: string, dataScope: "all" | "branch", keys: string[]) => {
        const [role] = await db.insert(roles).values({ key, name: key, dataScope }).returning();
        await db.insert(rolePermissions).values(keys.map((permissionKey) => ({ roleId: role!.id, permissionKey })));
      };
      await make("commview", "all", ["hr.commission.view"]);
      await make("commapprove", "all", ["hr.commission.approve"]);
      await make("commadjust", "all", ["hr.commission.adjust"]);
      await make("commmanage", "all", ["hr.commission.manage"]);
      await make("commbranch", "branch", [
        "hr.commission.view",
        "hr.commission.approve",
        "hr.commission.adjust",
        "hr.commission.manage",
      ]);
    });
    const emails = {
      hrA: await harness.addUser({ companyIds: [company.id], roles: ["hr"] }),
      hrB: await harness.addUser({ companyIds: [company.id], roles: ["hr"] }),
      hrC: await harness.addUser({ companyIds: [company.id], roles: ["hr"] }),
      accountant: await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }),
      repA: await harness.addUser({ companyIds: [company.id], roles: ["sales"] }),
      repB: await harness.addUser({ companyIds: [company.id], roles: ["sales"] }),
      repS: await harness.addUser({ companyIds: [company.id], roles: ["sales"] }),
      manager: await harness.addUser({ companyIds: [company.id], roles: ["manager"] }),
      managerOther: await harness.addUser({ companyIds: [company.id], roles: ["manager"] }),
      employee: await harness.addUser({ companyIds: [company.id], roles: ["employee"] }),
      view: await harness.addUser({ companyIds: [company.id], roles: ["commview"] }),
      approve: await harness.addUser({ companyIds: [company.id], roles: ["commapprove"] }),
      adjust: await harness.addUser({ companyIds: [company.id], roles: ["commadjust"] }),
      manage: await harness.addUser({ companyIds: [company.id], roles: ["commmanage"] }),
      branchAll: await harness.addUser({ companyIds: [company.id], roles: ["commbranch"] }),
      owner: await harness.addUser({ companyIds: [company.id], roles: ["owner"] }),
    };
    ids.owner = await harness.userIdOf(emails.owner);
    ids.hrA = await harness.userIdOf(emails.hrA);
    ids.hrB = await harness.userIdOf(emails.hrB);
    ids.hrC = await harness.userIdOf(emails.hrC);
    ids.repA = await harness.userIdOf(emails.repA);
    ids.repB = await harness.userIdOf(emails.repB);
    ids.repS = await harness.userIdOf(emails.repS);
    // The reps are W-2 staff, linked so a statement that pays something can be approved. Only Rep A,
    // hired long ago, is in the pay run; the rest are hired today and wait for a run of their own.
    const hrAEmp = await person({ name: "Hana Hartley" });
    const hrBEmp = await person({ name: "Hal Hendry" });
    const repAEmp = await person({ name: "Rae Anders", hiredAt: "2024-01-08", homeLocationId: ids.locA });
    const repBEmp = await person({ name: "Ben Brooks", homeLocationId: ids.locB });
    const repSEmp = await person({ name: "Sia Summers" });
    ids.empA = repAEmp.id;
    ids.empHrA = hrAEmp.id;
    for (const [userId, employeeId] of [
      [ids.hrA, hrAEmp.id],
      [ids.hrB, hrBEmp.id],
      [ids.repA, repAEmp.id],
      [ids.repB, repBEmp.id],
      [ids.repS, repSEmp.id],
    ] as const) {
      await rows((db) => db.update(userProfiles).set({ employeeId }).where(eq(userProfiles.userId, userId)));
    }
    await rows(async (db) => {
      await db
        .update(userProfiles)
        .set({ branchId: ids.branchMain })
        .where(eq(userProfiles.userId, await harness.userIdOf(emails.manager)));
      await db
        .update(userProfiles)
        .set({ branchId: ids.branchOther })
        .where(eq(userProfiles.userId, await harness.userIdOf(emails.managerOther)));
    });
    cookies.owner = await enrolled(emails.owner);
    cookies.accountant = await enrolled(emails.accountant);
    cookies.hrA = await enrolled(emails.hrA);
    cookies.hrB = await enrolled(emails.hrB);
    cookies.hrC = await enrolled(emails.hrC);
    cookies.repA = await harness.signIn(emails.repA);
    cookies.repB = await harness.signIn(emails.repB);
    cookies.repS = await harness.signIn(emails.repS);
    cookies.manager = await harness.signIn(emails.manager);
    cookies.managerOther = await harness.signIn(emails.managerOther);
    cookies.employee = await harness.signIn(emails.employee);
    cookies.view = await enrolled(emails.view);
    cookies.approve = await enrolled(emails.approve);
    cookies.adjust = await enrolled(emails.adjust);
    cookies.manage = await enrolled(emails.manage);
    cookies.branchAll = await enrolled(emails.branchAll);
    cookies.otherOwner = await enrolled(await harness.addUser({ companyIds: [other.id], roles: ["owner"] }));
    cookies.hrSuiteOwner = await enrolled(await harness.addUser({ companyIds: [hrSuite.id], roles: ["owner"] }));
    await call("put", "/settings/accounting", cookies.accountant)
      .send({
        costingMethod: "average",
        salesTaxBasis: "accrual",
        bankAccounts: [{ name: "Operating", methods: ["check"] }],
      })
      .expect(200);
  }, 300_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("holds every route to its commission key, to company-wide scope and to the Flooring Suite", async () => {
    const some = uuidv7();
    const routes = [
      { method: "get", path: "/commissions", key: "view" },
      { method: "post", path: "/commission-statements/approve", key: "approve" },
      { method: "post", path: "/commission-adjustments", key: "adjust" },
      { method: "post", path: "/commission-reversals/decide", key: "approve" },
      { method: "post", path: "/commission-plans", key: "manage" },
      { method: "put", path: `/commission-plans/${some}`, key: "manage" },
      { method: "post", path: "/commission-assignments", key: "manage" },
    ] as const;
    const holders = ["view", "approve", "adjust", "manage"] as const;
    for (const route of routes) {
      const label = `${route.method} ${route.path}`;
      expect((await call(route.method, route.path).send({})).status, `anonymous ${label}`).toBe(401);
      for (const who of holders) {
        const answer = await call(route.method, route.path, cookies[who]).send({});
        // The holder of the key passes the guards (an empty body is then the only thing wrong); the rest are refused.
        expect(answer.status, `${who} ${label}: ${JSON.stringify(answer.body)}`).toBe(
          who === route.key ? (route.method === "get" ? 200 : 400) : 403,
        );
        if (who !== route.key) expect(JSON.stringify(answer.body)).not.toMatch(/\d+\.\d{2}/);
      }
      // A sales rep, an Accountant (who reads payroll but not commission) and the keys at branch scope are refused.
      for (const who of ["repA", "accountant", "employee", "branchAll"] as const) {
        expect((await call(route.method, route.path, cookies[who]).send({})).status, `${who} ${label}`).toBe(403);
      }
    }
    const branchRead = await call("get", "/commissions", cookies.branchAll);
    expect(branchRead.body.message).toBe("Commission statements cover the whole company.");
    // The HR Suite has no Commissions page: its own Owner meets 404, on a read and on a write.
    status(await call("get", "/commissions", cookies.hrSuiteOwner, "hr"), 404);
    status(await call("post", "/commission-plans", cookies.hrSuiteOwner, "hr").send(planBody()), 404);
    // Sales -> Team totals: the key sales.commission.view, a strict range, nothing for the signed-out.
    const range = { from: `${M3}-01`, to: companyDay() };
    const query = `?from=${range.from}&to=${range.to}`;
    expect((await call("get", `/commission-totals${query}`)).status).toBe(401);
    status(await call("get", `/commission-totals${query}`, cookies.employee), 403);
    status(await call("get", `/commission-totals${query}`, cookies.repA), 200);
    const missing = await call("get", `/commission-totals?from=${range.from}`, cookies.owner);
    status(missing, 400);
    expect(missing.body.code).toBe("invalid_request");
    status(await call("get", `/commission-totals?from=soon&to=${range.to}`, cookies.owner), 400);
  });

  it("adds and edits a plan, with one error body, a unique name, and the edit in place before any approval", async () => {
    const own = (over: Record<string, unknown>) => send("post", "/commission-plans", cookies.hrA, planBody(over));
    refused(await own({ baseRatePct: "101" }), "Enter a base rate from 0 to 100 percent.");
    refused(await own({ baseRatePct: "5.12345" }), "Enter a base rate from 0 to 100 percent.");
    refused(await own({ name: "   " }), "Give the plan a name.");
    refused(await own({ monthlyTarget: "ten thousand" }), "Enter the monthly target in dollars and cents.");
    refused(await own({ clawbackDays: 4000 }), "Enter a clawback window from 0 to 3650 days.");
    refused(await own({ draw: { kind: "none", monthlyAmount: "5.00" } }), "A plan with no draw has no draw amount.");
    refused(
      await own({
        tiers: [
          { fromPctOfTarget: "100", ratePct: "6" },
          { fromPctOfTarget: "100", ratePct: "7" },
        ],
      }),
      "Two tiers start at the same point of the target.",
    );
    status(await own({ basis: "gross_profit" }), 400);
    const extra = await own({ version: 9 });
    status(extra, 400);
    expect(extra.body.code).toBe("invalid_request");
    // A deciding sign-in must be linked to an employee, unless it is the Owner's.
    status(await send("post", "/commission-plans", cookies.hrC, planBody()), 400);

    const added = await own({});
    status(added, 201);
    expect(added.body).toMatchObject({
      name: "Flat five",
      version: 1,
      status: "active",
      effectiveFrom: companyDay(),
      effectiveTo: null,
      basis: "paid_revenue",
      baseRatePct: "4",
      monthlyTarget: "10000.00",
      overridePct: "0",
      draw: { kind: "none", monthlyAmount: "0.00" },
      clawbackDays: 90,
    });
    ids.flat = added.body.id as string;
    refused(await own({}), "Another plan already has this name.");
    // No statement is approved yet, so a save edits in place: same plan, same version.
    const edited = await send("put", `/commission-plans/${ids.flat}`, cookies.hrA, planBody({ baseRatePct: "5" }));
    status(edited, 200);
    expect(edited.body).toMatchObject({ id: ids.flat, version: 1, status: "active", baseRatePct: "5" });
    status(await send("put", `/commission-plans/${uuidv7()}`, cookies.hrA, planBody()), 404);
    status(await send("put", "/commission-plans/not-a-uuid", cookies.hrA, planBody()), 400);
    // A gross margin plan, added by someone else, with a short clawback window.
    const margin = await send(
      "post",
      "/commission-plans",
      cookies.hrB,
      planBody({
        name: "Margin ten",
        basis: "gross_margin",
        baseRatePct: "10",
        monthlyTarget: "20000.00",
        clawbackDays: 10,
      }),
    );
    status(margin, 201);
    ids.margin = margin.body.id as string;
    expect(await auditOf("Added commission plan")).toHaveLength(2);
    expect(await auditOf("Edited commission plan")).toHaveLength(1);
  });

  it("puts people on a plan: never oneself, linked, a member, a plan in force, and a new assignment replaces the old", async () => {
    const assignBody = (over: Record<string, unknown> = {}) => ({
      userId: ids.repA,
      planId: ids.flat,
      effectiveFrom: `${M2}-01`,
      ...over,
    });
    const assign = (cookie: string, over: Record<string, unknown> = {}) =>
      send("post", "/commission-assignments", cookie, assignBody(over));
    // A plan added today can't be in force before today.
    refused(await assign(cookies.hrA), `This plan starts on ${companyDay()}.`);
    // Back-date the plans' start, as a plan added months ago would be.
    await rows((db) =>
      db
        .update(commissionPlans)
        .set({ effectiveFrom: `${M3}-01` })
        .where(inArray(commissionPlans.id, [ids.flat, ids.margin])),
    );
    refused(await assign(cookies.hrA, { userId: ids.hrA }), "Someone else must put you on a plan.");
    refused(await assign(cookies.owner, { userId: ids.owner }), "Someone else must put you on a plan.");
    expect((await assign(cookies.hrC)).body.message).toContain("Link your sign-in");
    refused(await assign(cookies.hrA, { userId: uuidv7() }), "Choose someone in this company.");
    refused(await assign(cookies.hrA, { planId: uuidv7() }), "Choose a plan.");
    refused(
      await assign(cookies.hrA, { monthlyTargetOverride: "abc" }),
      "Enter the monthly target in dollars and cents, or leave it blank.",
    );
    status(await assign(cookies.hrA, { role: "owner" }), 400);

    const first = await assign(cookies.hrA);
    status(first, 201);
    expect(first.body).toMatchObject({
      userId: ids.repA,
      planId: ids.flat,
      effectiveFrom: `${M2}-01`,
      effectiveTo: null,
      monthlyTargetOverride: null,
      acknowledgement: null,
    });
    // The same date again replaces it: one live assignment for the person, and the audit says which.
    const again = await assign(cookies.hrA);
    status(again, 201);
    const mine = (await data()).assignments.filter((a) => a.userId === ids.repA);
    expect(mine.map((a) => a.id)).toEqual([again.body.id]);
    const [replacing] = (await auditOf("Assigned commission plan")).filter((a) => a.targetId === again.body.id);
    expect(replacing!.after).toMatchObject({ ownTarget: false, replaced: [first.body.id] });
    status(await assign(cookies.hrA, { userId: ids.repB, planId: ids.margin }), 201);
    status(await assign(cookies.hrA, { userId: ids.repS }), 201);
    expect(await auditOf("Assigned commission plan")).toHaveLength(4);
  });

  it("builds statements from confirmed payments only, and hides a margin plan's base from anyone without view_sensitive", async () => {
    // Sales: Rep A sold I1 and I2 (paid revenue plan), Rep B sold I3 and I5 (margin plan), Rep S sold I4.
    ids.i1 = await addInvoice("INV-C1", ids.repA, "1000.00", "600.00", M2);
    ids.i2 = await addInvoice("INV-C2", ids.repA, "400.00", "200.00", M1);
    ids.i3 = await addInvoice("INV-C3", ids.repB, "2000.00", "1200.00", M2);
    ids.i4 = await addInvoice("INV-C4", ids.repS, "600.00", "300.00", M1);
    ids.i5 = await addInvoice("INV-C5", ids.repB, "1000.00", "500.00", M2);
    // Rep S's sale shares its commission with Rep S alone, set by HR before any payment (sales rule 39).
    status(
      await send("put", `/invoices/${ids.i4}/commission-split`, cookies.hrB, {
        split: [{ userId: ids.repS, pct: "100" }],
      }),
      200,
    );
    await addPayment("PAY-C1", ids.i1, "1000.00", M2);
    await addPayment("PAY-C1P", ids.i1, "300.00", M2, "pending");
    await addPayment("PAY-C2", ids.i2, "400.00", M1);
    ids.pay3 = await addPayment("PAY-C3", ids.i3, "2000.00", M2);
    await addPayment("PAY-C4", ids.i4, "600.00", M1);
    ids.pay5 = await addPayment("PAY-C5", ids.i5, "1000.00", M2);

    const owner = await data();
    const figures = (userId: string, month: string) =>
      owner.statements.find((s) => s.userId === userId && s.month === month)!;
    // 5% of 1000.00 paid revenue; the pending 300.00 earns nothing. Nothing has been approved: all draft.
    expect(figures(ids.repA, M2)).toMatchObject({
      status: "draft",
      earned: "50.00",
      override: "0.00",
      reversal: "0.00",
      adjustment: "0.00",
      net: "50.00",
      carryIn: "0.00",
      draw: "0.00",
      payable: "50.00",
      carryOut: "0.00",
      monthEnded: true,
      planName: "Flat five",
      statementId: null,
    });
    expect(figures(ids.repA, M2).lines).toHaveLength(1);
    expect(figures(ids.repA, M2).lines[0]).toMatchObject({
      kind: "earned",
      base: "1000.00",
      collected: "1000.00",
      commission: "50.00",
    });
    expect(figures(ids.repA, M1)).toMatchObject({ earned: "20.00", payable: "20.00" });
    expect(figures(ids.repS, M1)).toMatchObject({ earned: "30.00", payable: "30.00" });
    expect(figures(ids.repA, CURRENT)).toMatchObject({ monthEnded: false, payable: "0.00" });
    expect(figures(ids.repA, M3)).toMatchObject({ planName: null, payable: "0.00" });
    // The margin plan pays 10% of margin dollars: 800.00 and 500.00, so 80.00 and 50.00.
    expect(figures(ids.repB, M2)).toMatchObject({ earned: "130.00", payable: "130.00", planName: "Margin ten" });
    expect(
      figures(ids.repB, M2)
        .lines.map((l) => [l.base, l.commission])
        .sort(),
    ).toEqual([
      ["500.00", "50.00"],
      ["800.00", "80.00"],
    ]);
    // Invoices come as references only: never an amount or a cost.
    for (const invoice of owner.invoices) {
      expect(Object.keys(invoice).sort()).toEqual(["id", "isReturn", "number", "salesRepId", "voidedAt"]);
    }
    expect(owner.invoices.map((i) => i.number).sort()).toEqual(["INV-C1", "INV-C2", "INV-C3", "INV-C4", "INV-C5"]);
    expect(owner.people.map((p) => p.id)).toEqual(expect.arrayContaining([ids.repA, ids.repB, ids.repS]));

    // HR holds hr.commission.view but not sales.margin.view_sensitive: the margin base is null, never the cost.
    const hr = await data(cookies.hrA);
    const hrLines = hr.statements.flatMap((s) => s.lines);
    for (const line of hrLines.filter((l) => l.planId === ids.margin)) expect(line.base).toBeNull();
    expect(hrLines.filter((l) => l.planId === ids.margin)).toHaveLength(2);
    expect(hrLines.find((l) => l.planId === ids.flat)!.base).not.toBeNull();
    const text = JSON.stringify(hr);
    expect(text).not.toContain('"cost"');
    expect(text).not.toContain("1200.00");
    expect(text).not.toMatch(/subtotal|"total"/);
    expect(hr.statements.find((s) => s.userId === ids.repB && s.month === M2)!.earned).toBe("130.00");
  });

  it("adds adjustments with a reason, a named invoice for a deduction, never one's own, and nets them into the statement", async () => {
    const adjust = (cookie: string, over: Record<string, unknown> = {}) =>
      send("post", "/commission-adjustments", cookie, {
        userId: ids.repA,
        month: M1,
        amount: "25.00",
        invoiceId: null,
        reason: "Spiff for the Maple job",
        ...over,
      });
    refused(await adjust(cookies.hrB, { amount: "0.00" }), "Enter an amount, for example 150 or -75.");
    refused(await adjust(cookies.hrB, { amount: "12.345" }), "Enter an amount, for example 150 or -75.");
    refused(await adjust(cookies.hrB, { reason: "ok" }), "Give a reason; it stays on the statement.");
    refused(await adjust(cookies.hrB, { amount: "-5.00" }), "A deduction must name the invoice it relates to.");
    refused(await adjust(cookies.hrB, { amount: "-5.00", invoiceId: ids.i3 }), "Choose an invoice this person sold.");
    refused(await adjust(cookies.hrB, { amount: "-5.00", invoiceId: uuidv7() }), "Choose a live invoice.");
    refused(await adjust(cookies.hrB, { month: "2020-01" }), "Choose one of the last twelve months.");
    refused(await adjust(cookies.hrB, { month: "2026-13" }), "Choose a month.");
    refused(await adjust(cookies.hrB, { userId: ids.hrB }), "Someone else must change your own statement.");
    refused(await adjust(cookies.hrB, { userId: uuidv7() }), "Choose someone in this company.");
    expect((await adjust(cookies.hrC)).body.message).toContain("Link your sign-in");
    status(await adjust(cookies.hrB, { note: "extra" }), 400);

    status(await adjust(cookies.hrB), 201);
    status(await adjust(cookies.hrB, { amount: "-5.00", invoiceId: ids.i2, reason: "Returned trim" }), 201);
    // 20.00 earned + 25.00 - 5.00: the adjustments are in the open statement, and nothing was posted.
    expect(await statement(ids.repA, M1)).toMatchObject({
      earned: "20.00",
      adjustment: "20.00",
      net: "40.00",
      payable: "40.00",
      status: "draft",
    });
    const kinds = (await auditOf("Adjusted commission statement")).map((a) => (a.after as { kind: string }).kind);
    expect(kinds.sort()).toEqual(["addition", "deduction"]);
    expect(dec((await balances()).get("commissions_expense") ?? "0").isZero()).toBe(true);
  });

  it("approves months in order and posts Commissions against Accrued Payroll at month end, never one's own or by an unlinked approver", async () => {
    ledgerStart = await balances();
    const ownApproval = "Someone else must approve your own statement.";
    refused(await approve(cookies.owner, ids.owner, M2), ownApproval);
    refused(await approve(cookies.hrB, ids.hrB, M2), ownApproval);
    expect((await approve(cookies.hrC, ids.repA, M2)).body.message).toContain("Link your sign-in");
    refused(
      await approve(cookies.hrB, ids.repA, M1),
      `Approve the statement for ${M2} first, so each month's carry is final.`,
    );
    refused(await approve(cookies.hrB, ids.repA, CURRENT), "A statement can be approved once its month has ended.");
    status(await approve(cookies.hrB, "not-a-uuid", M2), 400);
    status(
      await send("post", "/commission-statements/approve", cookies.hrB, { userId: ids.repA, month: M2, x: 1 }),
      400,
    );

    const approved = await approve(cookies.hrB, ids.repA, M2);
    status(approved, 201);
    expect(approved.body).toMatchObject({
      userId: ids.repA,
      month: M2,
      status: "approved",
      approvedBy: "Test User",
      payPeriodId: null,
    });
    const after = await balances();
    expect(moved(ledgerStart, after, "commissions_expense")).toBe("50.00");
    expect(moved(ledgerStart, after, "accrued_payroll")).toBe("-50.00");
    expect(moved(ledgerStart, after, "wages")).toBe("0.00");
    const { entry, lines } = await entryOf(approved.body.id);
    expect(entry).toMatchObject({ event: "commission.approved", date: monthEnd(M2) });
    expect(entry!.memo).toBe(`Commission statement CS-${(approved.body.id as string).slice(-8)}, ${M2}`);
    expect(entry!.memo).not.toMatch(/\d+\.\d{2}/);
    // The expense counts at the rep's home location; the accrual is company-wide.
    const expense = lines.find((l) => l.key === "commissions_expense")!;
    expect(moneyString(expense.debit)).toBe("50.00");
    expect(expense.locationId).toBe(ids.locA);
    const accrual = lines.find((l) => l.key === "accrued_payroll")!;
    expect(moneyString(accrual.credit)).toBe("50.00");
    expect(accrual.locationId).toBeNull();
    // Once only; and the statement now reads as approved with the amount that posted.
    refused(await approve(cookies.hrB, ids.repA, M2), "This statement is already approved.");
    expect(await statement(ids.repA, M2)).toMatchObject({
      status: "approved",
      approvedBy: "Test User",
      payable: "50.00",
      statementId: approved.body.id,
    });
    const [audit] = await auditOf("Approved commission statement");
    expect(audit).toMatchObject({
      targetId: approved.body.id,
      before: { status: "draft" },
      after: { status: "approved", month: M2 },
    });
    expect(await auditOf("Approved commission statement")).toHaveLength(1);
    // The rep is told, with no amount, in a message only they and HR may read (commission.ready, restricted).
    const [message] = await rows((db) =>
      db.select().from(outboxMessages).where(eq(outboxMessages.eventKey, "commission.ready")),
    );
    expect(message).toMatchObject({ recipientId: ids.repA, sourceId: approved.body.id, restricted: true });
    expect(message!.subject).toBe(`Your commission statement for ${M2} is ready`);
    expect(`${message!.subject} ${message!.bodyText} ${JSON.stringify(message!.values)}`).not.toMatch(/\d+\.\d{2}/);
  });

  it("refuses an approver who adjusted, assigned, set the plan or set the sale's split, unless the Owner, and posts what the Owner approves", async () => {
    const before = await balances();
    // Rep A's last month: hrB adjusted it, hrA made the assignment and the plan.
    refused(
      await approve(cookies.hrB, ids.repA, M1),
      "Someone else must approve a statement you adjusted or decided a reversal on.",
    );
    expect((await approve(cookies.hrA, ids.repA, M1)).body.message).toBe(
      "Someone else must approve a statement under a plan assignment you made.",
    );
    const ownerApproved = await approve(cookies.owner, ids.repA, M1);
    status(ownerApproved, 201);
    expect(moved(before, await balances(), "commissions_expense")).toBe("40.00");
    // Rep B: hrB added the margin plan, hrA made the assignment.
    expect((await approve(cookies.hrB, ids.repB, M2)).body.message).toBe(
      "Someone else must approve a statement under a plan you added or changed.",
    );
    expect((await approve(cookies.hrA, ids.repB, M2)).body.message).toBe(
      "Someone else must approve a statement under a plan assignment you made.",
    );
    status(await approve(cookies.owner, ids.repB, M2), 201);
    // Rep S: hrB set the split of the sale in it.
    expect((await approve(cookies.hrB, ids.repS, M1)).body.message).toBe(
      "Someone else must approve a statement on a sale whose commission split you set.",
    );
    expect((await approve(cookies.hrA, ids.repS, M1)).body.message).toBe(
      "Someone else must approve a statement under a plan assignment you made.",
    );
    status(await approve(cookies.owner, ids.repS, M1), 201);
    const after = await balances();
    // 40.00 + 130.00 + 30.00 accrued by these three approvals, the margin base never read by the approver.
    expect(moved(before, after, "commissions_expense")).toBe("200.00");
    expect(moved(before, after, "accrued_payroll")).toBe("-200.00");
    const expense = (await entryOf((await statement(ids.repB, M2)).statementId!)).lines.find(
      (l) => l.key === "commissions_expense",
    )!;
    expect(moneyString(expense.debit)).toBe("130.00");
    expect(expense.locationId).toBe(ids.locB);
  });

  it("freezes approved months: adjustments and reversal decisions go on the next open statement and net into it", async () => {
    const frozen = "This statement is approved. Put the change on the next open statement.";
    const adjust = (userId: string, month: string) =>
      send("post", "/commission-adjustments", cookies.hrB, {
        userId,
        month,
        amount: "10.00",
        invoiceId: null,
        reason: "Late bonus",
      });
    refused(await adjust(ids.repA, M2), frozen);
    refused(await adjust(ids.repA, M1), frozen);
    refused(await adjust(ids.repB, M2), frozen);
    const decide = (cookie: string, lineId: string, outcome: string, reason = "Customer paid again by check") =>
      send("post", "/commission-reversals/decide", cookie, { userId: ids.repB, month: M2, lineId, outcome, reason });
    refused(await decide(cookies.hrA, "rv-nothing", "waived"), frozen);
    // A new assignment can only start after the end of the last approved month.
    refused(
      await send("post", "/commission-assignments", cookies.hrA, {
        userId: ids.repB,
        planId: ids.margin,
        effectiveFrom: `${M2}-20`,
      }),
      `Start the plan after ${monthEnd(M2)}, the end of the last approved statement.`,
    );

    // Rep B's two payments are voided after their month was approved and past the plan's 10-day window.
    const voidedAt = at(CURRENT, companyDay().slice(8, 10));
    await rows((db) =>
      db
        .update(paymentsReceived)
        .set({ status: "voided", voidedAt, voidedById: ids.owner, voidReason: "Check bounced" })
        .where(inArray(paymentsReceived.id, [ids.pay3, ids.pay5])),
    );
    const waiting = await statement(ids.repB, CURRENT);
    expect(waiting).toMatchObject({ needsReview: true, reversal: "0.00", payable: "0.00" });
    const reversals = waiting.lines.filter((l) => l.kind === "reversal");
    expect(reversals.map((l) => [l.commission, l.reversalState]).sort()).toEqual([
      ["-50.00", "needs_review"],
      ["-80.00", "needs_review"],
    ]);
    // Statement approval waits for the decisions, and a decision must name a real reversal waiting on that statement.
    const open = (lineId: string, outcome: string, reason = "Customer paid again by check", month = CURRENT) =>
      send("post", "/commission-reversals/decide", cookies.hrA, { userId: ids.repB, month, lineId, outcome, reason });
    refused(await open("rv-nothing", "waived"), "This reversal is not waiting for a decision.");
    refused(await open(reversals[0]!.id, "waived", "x"), "Give a reason; it stays on the statement.");
    status(await open(reversals[0]!.id, "maybe"), 400);
    expect((await statement(ids.repB, CURRENT)).needsReview).toBe(true);
    const accepted = reversals.find((l) => l.commission === "-80.00")!;
    const waived = reversals.find((l) => l.commission === "-50.00")!;
    status(await open(accepted.id, "applied"), 201);
    status(await open(waived.id, "waived"), 201);
    refused(await open(accepted.id, "waived"), "This reversal is not waiting for a decision.");
    // The accepted clawback nets into the open month: payable never goes below zero, the shortfall carries forward.
    const decided = await statement(ids.repB, CURRENT);
    expect(decided).toMatchObject({
      needsReview: false,
      reversal: "-80.00",
      adjustment: "0.00",
      net: "-80.00",
      payable: "0.00",
      carryOut: "80.00",
    });
    expect(decided.lines.find((l) => l.id === waived.id)!.reversalState).toBe("waived");
    // The decisions are stored as 0.00 adjustments that record the call, and the approved month is untouched.
    const stored = await rows((db) =>
      db.select().from(commissionAdjustments).where(eq(commissionAdjustments.userId, ids.repB)),
    );
    expect(stored.map((s) => [s.amount, (s.decides as { outcome: string }).outcome]).sort()).toEqual([
      ["0.00", "applied"],
      ["0.00", "waived"],
    ]);
    expect(await statement(ids.repB, M2)).toMatchObject({ status: "approved", payable: "130.00" });
    // An open month after the last approved one takes an ordinary adjustment and nets it in.
    status(
      await send("post", "/commission-adjustments", cookies.hrB, {
        userId: ids.repA,
        month: CURRENT,
        amount: "10.00",
        invoiceId: null,
        reason: "Late bonus",
      }),
      201,
    );
    expect(await statement(ids.repA, CURRENT)).toMatchObject({ adjustment: "10.00", net: "10.00", payable: "10.00" });
    expect(await auditOf("Accepted commission reversal")).toHaveLength(1);
    expect(await auditOf("Waived commission reversal")).toHaveLength(1);
  });

  it("pays an approved statement through the pay run outside Wages, releases it on reopen and marks it paid on export", async () => {
    const opened = await send("post", "/pay-periods", cookies.hrA, { date: week(1) });
    status(opened, 201);
    const periodId = opened.body.id as string;
    const before = await balances();
    const approved = await send("post", `/pay-periods/${periodId}/approve`, cookies.owner);
    status(approved, 201);
    const period = approved.body as PeriodBody;
    // Only Rep A is in the run. Rep A's two approved statements (50.00 and 40.00) are paid as commission pay.
    expect(period.lines.map((l) => l.employeeId)).toEqual([ids.empA]);
    const line = period.lines[0]!;
    expect(line.commissionPay).toBe("90.00");
    expect(
      sum([
        line.salaryAmount,
        line.commissionPay,
        line.nondiscretionaryBonus,
        line.discretionaryBonus,
        line.overtimeTrueUp,
      ]).toString(),
    ).toBe(dec(line.grossPay).toString());
    const wagesOnly = moneyString(dec(line.grossPay).minus(line.commissionPay));
    const afterRun = await balances();
    // Wages carries gross less commission; the commission was expensed when approved and is not expensed twice.
    expect(moved(before, afterRun, "wages")).toBe(wagesOnly);
    expect(moved(before, afterRun, "commissions_expense")).toBe("0.00");
    expect(moved(before, afterRun, "accrued_payroll")).toBe(moneyString(dec(wagesOnly).negated()));
    // Accrued payroll ends at the run's full gross plus the 160.00 of commission still waiting for a run.
    expect(moved(ledgerStart, afterRun, "accrued_payroll")).toBe(moneyString(dec(line.grossPay).plus(160).negated()));
    expect(moved(ledgerStart, afterRun, "commissions_expense")).toBe("250.00");
    // The run links the statements it pays; the other reps' wait, because they are not in this run.
    expect((await statement(ids.repA, M2)).payPeriodId).toBe(periodId);
    expect((await statement(ids.repA, M1)).payPeriodId).toBe(periodId);
    expect((await statement(ids.repS, M1)).payPeriodId).toBeNull();
    expect((await statement(ids.repB, M2)).payPeriodId).toBeNull();

    // A reopen reverses the payroll entry only: the statements are released and still accrued.
    status(await send("post", `/pay-periods/${periodId}/reopen`, cookies.hrB), 201);
    const reopened = await balances();
    expect(moved(before, reopened, "wages")).toBe("0.00");
    expect(moved(before, reopened, "accrued_payroll")).toBe("0.00");
    expect(moved(before, reopened, "commissions_expense")).toBe("0.00");
    const released = await statement(ids.repA, M2);
    expect(released).toMatchObject({ status: "approved", payPeriodId: null, payable: "50.00" });

    // Approved again, the same statements are paid again; the export marks them paid.
    status(await send("post", `/pay-periods/${periodId}/approve`, cookies.owner), 201);
    expect((await statement(ids.repA, M1)).payPeriodId).toBe(periodId);
    const exported = await send("post", `/pay-periods/${periodId}/export`, cookies.accountant);
    status(exported, 201);
    expect(exported.body.status).toBe("exported");
    expect(await statement(ids.repA, M2)).toMatchObject({ status: "paid", payPeriodId: periodId, payable: "50.00" });
    expect(await statement(ids.repA, M1)).toMatchObject({ status: "paid", payPeriodId: periodId, payable: "40.00" });
    expect(await statement(ids.repS, M1)).toMatchObject({ status: "approved", payPeriodId: null });
    // A paid statement is closed: there is nothing left to approve or to pay.
    refused(await approve(cookies.owner, ids.repA, M2), "This statement is already approved.");
    expect(await auditOf("Added commission statement to pay period")).toHaveLength(4);
    expect(await auditOf("Released commission statement from pay period")).toHaveLength(2);
    expect(await auditOf("Paid commission statement")).toHaveLength(2);
  });

  it("totals commission per person for Sales, Team, narrowed by the viewer's data scope", async () => {
    const query = `?from=${M3}-01&to=${companyDay()}`;
    const totals = async (cookie: string) => {
      const read = await call("get", `/commission-totals${query}`, cookie);
      status(read, 200);
      return new Map(read.body as [string, { earned: string; paid: string; pending: string }][]);
    };
    const everyone = await totals(cookies.owner);
    expect([...everyone.keys()].sort()).toEqual([ids.repA, ids.repB, ids.repS].sort());
    // Rep A's two months are paid; Rep S's is approved and waits; Rep B's earnings and clawbacks net to nothing.
    expect(everyone.get(ids.repA)).toEqual({ earned: "70.00", paid: "70.00", pending: "0.00" });
    expect(everyone.get(ids.repS)).toEqual({ earned: "30.00", paid: "0.00", pending: "30.00" });
    expect(everyone.get(ids.repB)).toEqual({ earned: "0.00", paid: "0.00", pending: "0.00" });
    // A sales rep (scope own) sees themselves; a branch manager sees the reps on invoices in the branch.
    expect([...(await totals(cookies.repA)).keys()]).toEqual([ids.repA]);
    expect([...(await totals(cookies.repS)).keys()]).toEqual([ids.repS]);
    expect([...(await totals(cookies.manager)).keys()].sort()).toEqual([ids.repA, ids.repB, ids.repS].sort());
    expect([...(await totals(cookies.managerOther)).keys()]).toEqual([]);
    // A range with no confirmed payment in it is empty.
    const empty = await call("get", `/commission-totals?from=${M3}-01&to=${M3}-02`, cookies.owner);
    status(empty, 200);
    expect(empty.body).toEqual([]);
  });

  it("publishes a new plan version once a statement is approved: old one retired, people moved over unsigned", async () => {
    const yesterday = addDays(companyDay(), -1);
    const saved = await send("put", `/commission-plans/${ids.flat}`, cookies.hrA, planBody({ baseRatePct: "6" }));
    status(saved, 200);
    expect(saved.body).toMatchObject({
      version: 2,
      status: "active",
      effectiveFrom: companyDay(),
      effectiveTo: null,
      baseRatePct: "6",
    });
    expect(saved.body.id).not.toBe(ids.flat);
    const after = await data();
    const versions = after.plans.filter((p) => p.name === "Flat five").sort((a, b) => a.version - b.version);
    expect(versions.map((p) => [p.version, p.status, p.effectiveTo])).toEqual([
      [1, "retired", yesterday],
      [2, "active", null],
    ]);
    expect(versions[0]!.baseRatePct).toBe("5");
    for (const userId of [ids.repA, ids.repS]) {
      const mine = after.assignments
        .filter((a) => a.userId === userId)
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      expect(mine).toHaveLength(2);
      expect(mine[0]).toMatchObject({ planId: ids.flat, effectiveTo: yesterday });
      expect(mine[1]).toMatchObject({ planId: saved.body.id, effectiveFrom: companyDay(), acknowledgement: null });
    }
    // The old version can't be saved again, and the paid months keep the figures of the plan they ran under.
    refused(
      await send("put", `/commission-plans/${ids.flat}`, cookies.hrA, planBody({ baseRatePct: "7" })),
      "Only an active plan can be changed.",
    );
    expect(await statement(ids.repA, M2)).toMatchObject({ status: "paid", payable: "50.00", earned: "50.00" });
    const [published] = await auditOf("Published new version of commission plan");
    expect(published).toMatchObject({ targetId: saved.body.id, after: { version: 2, moved: 2 } });
    // Each assignment the new version ended or created is audited on its own, with no amount.
    const moves = await auditOf("Moved commission assignment to new plan version");
    expect(moves).toHaveLength(4);
    expect(moves.filter((m) => m.before === null).map((m) => (m.after as { planId: string }).planId)).toEqual([
      saved.body.id,
      saved.body.id,
    ]);
    ids.flatV2 = saved.body.id as string;
  });

  it("never shows or changes another company's commissions", async () => {
    const mine = await data(cookies.otherOwner);
    expect(mine.statements).toEqual([]);
    expect(mine.plans).toEqual([]);
    expect(mine.assignments).toEqual([]);
    expect(mine.invoices).toEqual([]);
    expect(mine.people.map((p) => p.id)).not.toContain(ids.repA);
    status(
      await send("put", `/commission-plans/${ids.margin}`, cookies.otherOwner, planBody({ name: "Margin ten" })),
      404,
    );
    refused(
      await send("post", "/commission-assignments", cookies.otherOwner, {
        userId: ids.repA,
        planId: ids.margin,
        effectiveFrom: `${M2}-01`,
      }),
      "Choose someone in this company.",
    );
    refused(await approve(cookies.otherOwner, ids.repA, M2), "This statement no longer exists.");
    const totals = await call("get", `/commission-totals?from=${M3}-01&to=${companyDay()}`, cookies.otherOwner);
    status(totals, 200);
    expect(totals.body).toEqual([]);
    // Nothing of company one's changed meanwhile.
    expect((await statement(ids.repB, M2)).status).toBe("approved");
  });

  it("writes audit rows for every change, and none of them carries an amount", async () => {
    const entries = await rows((db) =>
      db
        .select()
        .from(auditLog)
        .where(inArray(auditLog.targetType, ["commission_statement", "commission_assignment"])),
    );
    expect(entries.length).toBeGreaterThan(15);
    for (const entry of entries) {
      const text = JSON.stringify([entry.before, entry.after, entry.targetLabel]);
      expect(text, `${entry.action}: ${text}`).not.toMatch(/\d+\.\d{2}/);
      expect(entry.actorUserId).toBeTruthy();
    }
    expect(new Set(entries.map((e) => e.action))).toEqual(
      new Set([
        "Approved commission statement",
        "Adjusted commission statement",
        "Accepted commission reversal",
        "Waived commission reversal",
        "Assigned commission plan",
        "Moved commission assignment to new plan version",
        "Added commission statement to pay period",
        "Released commission statement from pay period",
        "Paid commission statement",
      ]),
    );
    const plans = await rows((db) => db.select().from(auditLog).where(eq(auditLog.targetType, "commission_plan")));
    expect(new Set(plans.map((e) => e.action))).toEqual(
      new Set(["Added commission plan", "Edited commission plan", "Published new version of commission plan"]),
    );
  });

  // First security review of PR #27: the tests below cover its findings, on the state left above.
  it("hides margin dollars on a split sale from an HR reader, on the paid revenue co-rep's line too", async () => {
    // Rep B (margin plan) sold it and shares half with Rep S (paid revenue plan, version 2 from today).
    const sale = await addInvoice("INV-C7", ids.repB, "1000.00", "400.00", CURRENT);
    status(
      await send("put", `/invoices/${sale}/commission-split`, cookies.hrB, {
        split: [
          { userId: ids.repB, pct: "50" },
          { userId: ids.repS, pct: "50" },
        ],
      }),
      200,
    );
    await addPayment("PAY-C7", sale, "1000.00", CURRENT, "confirmed", companyDay().slice(8, 10));
    const onSale = (body: CommissionData) =>
      body.statements.flatMap((s) => s.lines).filter((l) => l.invoiceId === sale);
    // The Owner sees the base: 600.00 of margin, 300.00 each, Rep S's line on his own paid revenue plan.
    const owner = onSale(await data());
    const coRep = owner.find((l) => l.kind === "earned" && l.planId === ids.flatV2)!;
    expect(coRep).toMatchObject({ base: "300.00", basis: "gross_margin" });
    // HR, without sales.margin.view_sensitive, sees no margin dollars on either share.
    const hr = onSale(await data(cookies.hrA));
    expect(hr).toHaveLength(owner.length);
    for (const line of hr) expect(line.base, line.id).toBeNull();
    expect(hr.find((l) => l.id === coRep.id)!.commission).toBe(coRep.commission);
  });

  it("totals only the lines on invoices the viewer's scope covers, and the viewer's own lines whole", async () => {
    const query = `?from=${M3}-01&to=${companyDay()}`;
    const totals = async (cookie: string) =>
      new Map(
        (await call("get", `/commission-totals${query}`, cookie).expect(200)).body as [string, { earned: string }][],
      );
    // Rep S also sold in the other branch.
    const elsewhere = await addInvoice("INV-C8", ids.repS, "500.00", "200.00", CURRENT, ids.branchOther);
    await addPayment("PAY-C8", elsewhere, "500.00", CURRENT, "confirmed", companyDay().slice(8, 10));
    const lines = (await data()).statements.flatMap((s) => s.lines);
    const there = sum(lines.filter((l) => l.invoiceId === elsewhere).map((l) => l.commission));
    expect(there.gt(0)).toBe(true);
    const all = dec((await totals(cookies.owner)).get(ids.repS)!.earned);
    // The Main branch manager sees Rep S's Main sales only; the other branch's manager only the sale there.
    expect((await totals(cookies.manager)).get(ids.repS)!.earned).toBe(moneyString(all.minus(there)));
    const other = await totals(cookies.managerOther);
    expect([...other.keys()]).toEqual([ids.repS]);
    expect(other.get(ids.repS)!.earned).toBe(moneyString(there));
    // Rep S (scope own) sees all of their own commission.
    expect((await totals(cookies.repS)).get(ids.repS)!.earned).toBe(moneyString(all));
  });

  it("bounds an adjustment's amount", async () => {
    const adjust = (amount: string) =>
      send("post", "/commission-adjustments", cookies.hrB, {
        userId: ids.repS,
        month: CURRENT,
        amount,
        invoiceId: null,
        reason: "Year-end spiff",
      });
    refused(await adjust("1000000.01"), "An adjustment can be at most 1,000,000.00 either way.");
    refused(await adjust("1234567890123"), "Enter an amount, for example 150 or -75.");
    refused(await adjust(`${"9".repeat(40)}.00`), "Enter an amount, for example 150 or -75.");
  });

  it("refuses a manager changing an override plan or assigning their own people to one, and an approver who set the manager or cleared a split", async () => {
    // Rep T is new: a W-2 rep whose manager, set by hrB through People, is hrA.
    ids.repT = await harness.userIdOf(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    const repT = await person({ name: "Tia Torres", hiredAt: "2024-01-08", homeLocationId: ids.locA });
    ids.empT = repT.id;
    await rows((db) => db.update(userProfiles).set({ employeeId: repT.id }).where(eq(userProfiles.userId, ids.repT)));
    status(
      await send("put", `/employees/${repT.id}`, cookies.hrB, {
        name: "Tia Torres",
        title: "Sales",
        department: "Sales",
        workerType: "w2",
        payType: "salary",
        state: "TX",
        email: "",
        phone: "",
        hiredAt: "2024-01-08",
        status: "active",
        managerId: ids.empHrA,
        flsaStatus: "exempt",
        exemptionBasis: "administrative",
        salaryHoursPerWeek: 40,
        commissionVisible: null,
        homeLocationId: ids.locA,
        emergencyContact: null,
      }),
      200,
    );
    // The Owner adds a plan that pays the manager a 2% override, in force since M3.
    const added = await send(
      "post",
      "/commission-plans",
      cookies.owner,
      planBody({ name: "Override two", overridePct: "2" }),
    );
    status(added, 201);
    ids.planO = added.body.id as string;
    await rows((db) =>
      db
        .update(commissionPlans)
        .set({ effectiveFrom: `${M3}-01` })
        .where(eq(commissionPlans.id, ids.planO)),
    );
    const assignT = (cookie: string) =>
      send("post", "/commission-assignments", cookie, {
        userId: ids.repT,
        planId: ids.planO,
        effectiveFrom: `${M3}-01`,
      });
    refused(await assignT(cookies.hrA), "Someone else must put your own people on a plan that pays you an override.");
    status(await assignT(cookies.owner), 201);
    refused(
      await send(
        "put",
        `/commission-plans/${ids.planO}`,
        cookies.hrA,
        planBody({ name: "Override two", overridePct: "3" }),
      ),
      "Someone else must change a plan that pays you an override.",
    );

    // hrA sets the split of the M2 sale and clears it again before any payment: no live split row is left.
    const t3 = await addInvoice("INV-T3", ids.repT, "1000.00", "500.00", M3);
    const t2 = await addInvoice("INV-T2", ids.repT, "800.00", "400.00", M2);
    for (const split of [[{ userId: ids.repT, pct: "100" }], []]) {
      status(await send("put", `/invoices/${t2}/commission-split`, cookies.hrA, { split }), 200);
    }
    await addPayment("PAY-T3", t3, "1000.00", M3);
    await addPayment("PAY-T2", t2, "800.00", M2);
    // hrA is paid the override on Rep T's sales.
    expect((await statement(ids.hrA, M3)).override).toBe("20.00");

    const managerSet = "Someone else must approve a statement whose override you shaped by setting a manager.";
    expect((await approve(cookies.hrB, ids.repT, M3)).body.message).toBe(managerSet);
    status(await approve(cookies.hrA, ids.repT, M3), 201);
    expect((await approve(cookies.hrA, ids.repT, M2)).body.message).toBe(
      "Someone else must approve a statement on a sale whose commission split you set.",
    );
    expect((await approve(cookies.hrB, ids.repT, M2)).body.message).toBe(managerSet);
    // The manager's own statement carries the override, shaped by whoever set the manager.
    expect((await approve(cookies.hrB, ids.hrA, M3)).body.message).toBe(managerSet);
    status(await approve(cookies.owner, ids.repT, M2), 201);
  });

  it("lists approved commission no pay run can pay in the pay-period review, and never marks it paid", async () => {
    const opened = await send("post", "/pay-periods", cookies.owner, { date: week(3) });
    status(opened, 201);
    const review = async () =>
      (await call("get", `/pay-periods/${opened.body.id as string}/review`, cookies.owner).expect(200)).body as {
        strandedCommission: { userId: string; month: string; reason: string; name: string }[];
      };
    // Rep T's two approved statements wait for a run that includes them; nothing is stranded yet.
    expect((await review()).strandedCommission.filter((s) => s.userId === ids.repT)).toEqual([]);
    await rows((db) => db.update(employees).set({ status: "terminated" }).where(eq(employees.id, ids.empT)));
    const stranded = (await review()).strandedCommission;
    expect(stranded.map((s) => [s.userId, s.month, s.reason]).sort()).toEqual(
      [
        [ids.repT, M2, "They have left, so no pay run includes them."],
        [ids.repT, M3, "They have left, so no pay run includes them."],
      ].sort(),
    );
    expect(JSON.stringify(stranded)).not.toMatch(/\d+\.\d{2}/);
    expect(await statement(ids.repT, M2)).toMatchObject({ status: "approved", payPeriodId: null });
    // A 1099 worker can't be paid through a run either.
    await rows((db) =>
      db
        .update(employees)
        .set({ status: "active", workerType: "1099", flsaStatus: "not_applicable", exemptionBasis: null })
        .where(eq(employees.id, ids.empT)),
    );
    expect(new Set((await review()).strandedCommission.map((s) => s.reason))).toEqual(
      new Set(["They are a 1099 contractor, and pay runs pay W-2 staff only."]),
    );
  });
});
