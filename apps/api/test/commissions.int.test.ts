import {
  auditLog,
  bonuses,
  branches,
  commissionAdjustments,
  commissionAssignments,
  commissionPlans,
  commissionStatements,
  customers,
  employeeManagerHistory,
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
import { tenantModuleOverrides } from "@workspace/db/control";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import {
  addDays,
  dec,
  FEATURES,
  HIDDEN_PAY_DETAILS,
  moneyString,
  monthEnd,
  PAY_SENSITIVE_AUDIT_ACTIONS,
  PRODUCT_HEADER,
  sum,
  workweekStartOf,
} from "@workspace/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import type { Response } from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";

/** The day of a moment (now unless given) in the test company's time zone (America/Chicago), the day the API dates by. */
function companyDay(moment = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(moment);
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
  subjectUserId: string | null;
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

/** The refusal of a statement carrying an override earned under a manager its own person set (ADR 0048). */
const SELF_MADE =
  "This statement's own person set the manager of someone whose override is on it, on the days those overrides were earned. Someone else must set that same manager again first.";

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
    empHrB: "",
    empU: "",
    repU: "",
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

  /**
   * Records that `by` made `managerId` the employee's manager on `day`, as a People save on that day
   * would have. Overrides follow the manager on each line's day (owner decision 2026-11-15; ADR
   * 0048), and these tests record sales in earlier months, so the history must reach back to them;
   * `by` is who set it, which the self-made manager guard reads.
   */
  async function managedSince(employeeId: string, managerId: string | null, day: string, by: string) {
    await rows((db) =>
      db.insert(employeeManagerHistory).values({ employeeId, managerId, effectiveFrom: day, createdBy: by }),
    );
  }

  /** An employee's manager history rows in the order they were recorded (UUID v7 ids). */
  async function historyOf(employeeId: string) {
    const recorded = await rows((db) =>
      db.select().from(employeeManagerHistory).where(eq(employeeManagerHistory.employeeId, employeeId)),
    );
    return recorded
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((row) => ({ managerId: row.managerId, effectiveFrom: row.effectiveFrom, createdBy: row.createdBy }));
  }

  /** A bonus for an employee, soft-deleted when `voided` (the audit resolves a voided bonus's employee too). */
  async function bonusFor(employeeId: string, voided = false) {
    return (
      await rows((db) =>
        db
          .insert(bonuses)
          .values({
            employeeId,
            amount: "100.00",
            kind: "flat_sum",
            periodStart: companyDay(),
            periodEnd: companyDay(),
            approvedById: ids.owner,
            reason: "Probe",
            deletedAt: voided ? new Date() : null,
          })
          .returning(),
      )
    )[0]!.id;
  }

  /** A commission adjustment row for a rep and month M1; its id is what adjustment audit entries target. */
  async function adjustmentFor(userId: string) {
    return (
      await rows((db) =>
        db
          .insert(commissionAdjustments)
          .values({ userId, month: M1, amount: "0.00", reason: "Probe", byUserId: ids.owner, at: new Date() })
          .returning(),
      )
    )[0]!.id;
  }

  /** An audit_log row for a pay-sensitive action, labelled so a test can pick its own rows out of the list. */
  function payAuditEntry(
    label: string,
    action: string,
    targetType: string,
    targetId: string,
    after: Record<string, unknown>,
  ) {
    return {
      actorUserId: ids.owner,
      actorRole: "Owner",
      category: "data" as const,
      action,
      targetType,
      targetId,
      targetLabel: label,
      before: null,
      after,
    };
  }

  /** A new rep: a sign-in linked to a W-2 employee hired long ago, so a statement that pays something can be approved. */
  async function newRep(name: string, over: Partial<typeof employees.$inferInsert> = {}) {
    const userId = await harness.userIdOf(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    const employee = await person({ name, hiredAt: "2024-01-08", ...over });
    await rows((db) => db.update(userProfiles).set({ employeeId: employee.id }).where(eq(userProfiles.userId, userId)));
    return { userId, employeeId: employee.id };
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

  /**
   * A customer payment on a day of a month (the 10th unless given), recorded and confirmed at midday
   * UTC unless `when` says otherwise; only a confirmed one earns commission.
   */
  async function addPayment(
    number: string,
    invoiceId: string,
    amount: string,
    month: string,
    state: "confirmed" | "pending" = "confirmed",
    day = "10",
    when = at(month, day),
  ) {
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
    ids.empHrB = hrBEmp.id;
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
    await harness.grantStepUp(cookies.accountant);
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
    await managedSince(repT.id, ids.empHrA, "2024-01-08", ids.hrB);
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

  // Second security review of PR #27: the tests below cover its findings, on the state left above.
  it("lets only the Owner move someone on an override plan, refuses a statement whose person made themselves the manager, and checks the subject's assignment", async () => {
    // Rep U is new, a W-2 rep; hrB makes themselves Rep U's manager before Rep U is on any plan.
    const repU = await harness.userIdOf(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    const empU = await person({ name: "Uma Underwood", hiredAt: "2024-01-08" });
    await rows((db) => db.update(userProfiles).set({ employeeId: empU.id }).where(eq(userProfiles.userId, repU)));
    const form = (over: Record<string, unknown>) => ({
      name: "Uma Underwood",
      title: "Sales",
      department: "Sales",
      workerType: "w2",
      payType: "salary",
      state: "TX",
      email: "",
      phone: "",
      hiredAt: "2024-01-08",
      status: "active",
      managerId: ids.empHrB,
      flsaStatus: "exempt",
      exemptionBasis: "administrative",
      salaryHoursPerWeek: 40,
      commissionVisible: null,
      homeLocationId: null,
      emergencyContact: null,
      ...over,
    });
    const edit = (cookie: string, over: Record<string, unknown> = {}) =>
      send("put", `/employees/${empU.id}`, cookie, form(over));
    status(await edit(cookies.hrB), 200);
    await managedSince(empU.id, ids.empHrB, "2024-01-08", ids.hrB);
    // hrA (not Rep U's manager) puts Rep U on the 2% override plan.
    status(
      await send("post", "/commission-assignments", cookies.hrA, {
        userId: repU,
        planId: ids.planO,
        effectiveFrom: `${M3}-01`,
      }),
      201,
    );

    // From now on only the Owner moves Rep U: not to oneself, not away, not by the sign-in link.
    const onlyOwner = "This person earns their manager an override, so only the Owner can change their manager.";
    refused(await edit(cookies.hrA, { managerId: ids.empHrA }), onlyOwner);
    refused(await edit(cookies.hrB, { managerId: null }), onlyOwner);
    refused(
      await edit(cookies.hrA, { userId: null }),
      "This person has commission plans, statements or overrides, so only the Owner can change their sign-in link.",
    );
    refused(
      await send("post", "/employees", cookies.hrA, form({ name: "Uma Again", managerId: ids.empHrA, userId: repU })),
      onlyOwner,
    );
    // Other fields stay HR's to edit.
    status(await edit(cookies.hrA, { title: "Senior Sales" }), 200);
    expect((await rows((db) => db.select().from(employees).where(eq(employees.id, empU.id))))[0]!.managerId).toBe(
      ids.empHrB,
    );

    // Rep U sells in M1: hrB is paid the override.
    const sale = await addInvoice("INV-U1", repU, "1000.00", "500.00", M1);
    await addPayment("PAY-U1", sale, "1000.00", M1);
    const managers = await statement(ids.hrB, M1);
    expect(dec(managers.override).gt(0)).toBe(true);
    expect(managers.lines.filter((l) => l.kind === "override").map((l) => l.subjectUserId)).toEqual([repU]);
    // hrB set that manager, so nobody approves hrB's statement, the Owner included.
    refused(await approve(cookies.owner, ids.hrB, M1), SELF_MADE);
    refused(await approve(cookies.hrA, ids.hrB, M1), SELF_MADE);
    // The Owner reviews the manager (clears it, sets it again): the Owner has now set that same
    // manager, which confirms the earlier days too.
    status(await edit(cookies.owner, { managerId: null, title: "Senior Sales" }), 200);
    status(await edit(cookies.owner, { title: "Senior Sales" }), 200);
    // hrA put Rep U, whose override is on hrB's statement, on the plan: hrA may not approve it.
    refused(
      await approve(cookies.hrA, ids.hrB, M1),
      "Someone else must approve a statement under a plan assignment you made.",
    );
    status(await approve(cookies.owner, ids.hrB, M1), 201);
    ids.repU = repU;
    ids.empU = empU.id;
  });

  it("clears the signatures of a plan edited in place, and audits it with no amount", async () => {
    const added = await send("post", "/commission-plans", cookies.owner, planBody({ name: "Signed plan" }));
    status(added, 201);
    const planId = added.body.id as string;
    const assigned = await send("post", "/commission-assignments", cookies.owner, {
      userId: ids.repU,
      planId,
      effectiveFrom: companyDay(),
    });
    status(assigned, 201);
    await rows((db) =>
      db
        .update(commissionAssignments)
        .set({ acknowledgedName: "Uma Underwood", acknowledgedAt: new Date() })
        .where(eq(commissionAssignments.id, assigned.body.id as string)),
    );
    const signed = (await data()).assignments.find((a) => a.id === assigned.body.id)!;
    expect(signed.acknowledgement).not.toBeNull();
    // No statement from today on is approved, so the save edits the plan in place: Rep U signs again.
    const edited = await send(
      "put",
      `/commission-plans/${planId}`,
      cookies.hrA,
      planBody({ name: "Signed plan", baseRatePct: "6" }),
    );
    status(edited, 200);
    expect(edited.body).toMatchObject({ id: planId, version: 1, baseRatePct: "6" });
    expect((await data()).assignments.find((a) => a.id === assigned.body.id)!.acknowledgement).toBeNull();
    const cleared = (await auditOf("Cleared commission plan signature after plan edit")).filter(
      (a) => a.targetId === assigned.body.id,
    );
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({ actorUserId: ids.hrA, after: { signed: false, planId } });
    expect(JSON.stringify([cleared[0]!.before, cleared[0]!.after])).not.toMatch(/\d+\.\d{2}/);
  });

  it("hides Sales, Team commission totals when the commissions switch is off", async () => {
    const query = `?from=${M3}-01&to=${companyDay()}`;
    status(await call("get", `/commission-totals${query}`, cookies.owner), 200);
    const feature = FEATURES["hr.commissions"] as { enabled: boolean };
    feature.enabled = false;
    try {
      status(await call("get", `/commission-totals${query}`, cookies.owner), 404);
      status(await call("get", `/commission-totals${query}`, cookies.repA), 404);
    } finally {
      feature.enabled = true;
    }
    status(await call("get", `/commission-totals${query}`, cookies.owner), 200);
  });

  // Third security review of PR #27: the tests below cover its findings, on the state left above.
  /** An employee form as People sends it, for a salaried exempt W-2 person hired long ago. */
  const employeeForm = (name: string, over: Record<string, unknown> = {}) => ({
    name,
    title: "Sales",
    department: "Sales",
    workerType: "w2",
    payType: "salary",
    state: "TX",
    email: "",
    phone: "",
    hiredAt: "2024-01-08",
    status: "active",
    managerId: null,
    flsaStatus: "exempt",
    exemptionBasis: "administrative",
    salaryHoursPerWeek: 40,
    commissionVisible: null,
    homeLocationId: null,
    emergencyContact: null,
    ...over,
  });

  it("lets only the Owner re-link a sign-in with commission, and refuses an approver who changed the link", async () => {
    const added = await send("post", "/commission-plans", cookies.owner, planBody({ name: "Relink plan" }));
    status(added, 201);
    const planId = added.body.id as string;
    await rows((db) =>
      db
        .update(commissionPlans)
        .set({ effectiveFrom: `${M3}-01` })
        .where(eq(commissionPlans.id, planId)),
    );
    const assign = async (userId: string) =>
      status(
        await send("post", "/commission-assignments", cookies.owner, { userId, planId, effectiveFrom: `${M1}-01` }),
        201,
      );
    const onlyOwner =
      "This person has commission plans, statements or overrides, so only the Owner can change their sign-in link.";

    // Rep R is on a plan with no override; Wes is an ally's W-2 record with no sign-in.
    const repR = await harness.userIdOf(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    const empR = await person({ name: "Ray Reyes", hiredAt: "2024-01-08" });
    const wes = await person({ name: "Wes Ward", hiredAt: "2024-01-08" });
    await rows((db) => db.update(userProfiles).set({ employeeId: empR.id }).where(eq(userProfiles.userId, repR)));
    await assign(repR);
    const saleR = await addInvoice("INV-R1", repR, "1000.00", "500.00", M1);
    await addPayment("PAY-R1", saleR, "1000.00", M1);
    // An HR manager can neither unlink Rep R nor put Rep R's sign-in on another record.
    const save = (cookie: string, id: string | null, name: string, over: Record<string, unknown>) =>
      id
        ? send("put", `/employees/${id}`, cookie, employeeForm(name, over))
        : send("post", "/employees", cookie, employeeForm(name, over));
    refused(await save(cookies.hrA, empR.id, "Ray Reyes", { userId: null }), onlyOwner);
    refused(await save(cookies.hrA, wes.id, "Wes Ward", { userId: repR }), onlyOwner);
    refused(await save(cookies.hrA, null, "Ray Again", { userId: repR }), onlyOwner);
    // The Owner may; the entries carry the old and the new link.
    status(await save(cookies.owner, empR.id, "Ray Reyes", { userId: null }), 200);
    status(await save(cookies.owner, wes.id, "Wes Ward", { userId: repR }), 200);
    const links = (await auditOf("Edited employee"))
      .filter((a) => a.targetId === empR.id || a.targetId === wes.id)
      .map((a) => [a.targetId, (a.before as { userId?: unknown }).userId, (a.after as { userId?: unknown }).userId]);
    expect(links).toEqual(
      expect.arrayContaining([
        [empR.id, repR, null],
        [wes.id, null, repR],
      ]),
    );
    // hrA changed nothing, so hrA approves; Rep R's commission is now paid to Wes's record.
    status(await approve(cookies.hrA, repR, M1), 201);

    // hrB links Rep Q's sign-in while Rep Q has no commission; Rep Q is put on a plan afterwards.
    const repQ = await harness.userIdOf(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
    const empQ = await person({ name: "Quinn Quade", hiredAt: "2024-01-08" });
    status(await save(cookies.hrB, empQ.id, "Quinn Quade", { userId: repQ }), 200);
    await assign(repQ);
    const saleQ = await addInvoice("INV-Q1", repQ, "1000.00", "500.00", M1);
    await addPayment("PAY-Q1", saleQ, "1000.00", M1);
    // The link decides who is paid, so hrB approves neither the statement nor a pay run paying Rep Q.
    refused(
      await approve(cookies.hrB, repQ, M1),
      "Someone else must approve a statement whose person's sign-in link you changed.",
    );
    const run = await send("post", "/pay-periods", cookies.owner, { date: week(2) });
    status(run, 201);
    refused(
      await send("post", `/pay-periods/${run.body.id as string}/approve`, cookies.hrB),
      "Someone else must approve a pay run that pays a person whose pay you added or changed.",
    );
    status(await approve(cookies.hrA, repQ, M1), 201);

    // With no plan left and the statement already in an approved run, Rep Q still counts: a reopen
    // hands the statement back to the next run (fourth review of PR #27).
    await rows((db) =>
      db.update(commissionAssignments).set({ deletedAt: new Date() }).where(eq(commissionAssignments.userId, repQ)),
    );
    await rows((db) =>
      db
        .update(commissionStatements)
        .set({ payPeriodId: run.body.id as string })
        .where(eq(commissionStatements.userId, repQ)),
    );
    refused(await save(cookies.hrA, empQ.id, "Quinn Quade", { userId: null }), onlyOwner);
  });

  it("refuses everyone, the Owner too, making their own employee the manager of someone on an override plan", async () => {
    const empOwner = await person({ name: "Olive Owens" });
    const edit = (managerId: string) =>
      send(
        "put",
        `/employees/${ids.empU}`,
        cookies.owner,
        employeeForm("Uma Underwood", { managerId, title: "Senior Sales" }),
      );
    await rows((db) =>
      db.update(userProfiles).set({ employeeId: empOwner.id }).where(eq(userProfiles.userId, ids.owner)),
    );
    try {
      refused(
        await edit(empOwner.id),
        "Nobody makes themselves the manager of someone whose sales pay them an override.",
      );
      // Someone else's employee is the Owner's to set.
      status(await edit(ids.empHrA), 200);
    } finally {
      await rows((db) => db.update(userProfiles).set({ employeeId: null }).where(eq(userProfiles.userId, ids.owner)));
    }
  });

  it("makes a People save wait for the payroll lock", async () => {
    let pending: Promise<Response> | undefined;
    await rows((db) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hr:payroll-approve'))`);
        let settled = false;
        pending = send(
          "put",
          `/employees/${ids.empU}`,
          cookies.owner,
          employeeForm("Uma Underwood", { managerId: ids.empHrA, title: "Lead Sales" }),
        ).then((response) => {
          settled = true;
          return response;
        });
        await new Promise((resolve) => setTimeout(resolve, 750));
        expect(settled).toBe(false);
      }),
    );
    status(await pending!, 200);
  });

  it("hides Sales, Team commission totals from a company without the HR module", async () => {
    const query = `?from=${M3}-01&to=${companyDay()}`;
    status(await call("get", `/commission-totals${query}`, cookies.otherOwner), 200);
    await harness.control.db.insert(tenantModuleOverrides).values({ tenantId: other.id, module: "hr", enabled: false });
    try {
      status(await call("get", `/commission-totals${query}`, cookies.otherOwner), 404);
    } finally {
      await harness.control.db.delete(tenantModuleOverrides).where(eq(tenantModuleOverrides.tenantId, other.id));
    }
  });

  // Owner decision 2026-11-14 (ADR 0048 "Audit visibility"): plan terms and reasons only for pay viewers.
  it("shows the details of plan-terms and reason audit entries only to the Owner and pay view_sensitive holders", async () => {
    const probe = "Audit visibility probe";
    const secret = "Probe reason: spiff on the Maple job";
    await rows((db) =>
      db.insert(auditLog).values([
        ...[...PAY_SENSITIVE_AUDIT_ACTIONS].map((action) => ({
          actorUserId: ids.hrA,
          actorRole: "HR manager",
          category: "data" as const,
          action,
          targetType: "audit_probe",
          targetLabel: probe,
          before: { baseRatePct: "3.3333", tiers: [{ fromPctOfTarget: "100", ratePct: "6" }] },
          after: { baseRatePct: "7.7777", draw: { kind: "recoverable" }, reason: secret },
        })),
        {
          actorUserId: ids.hrA,
          actorRole: "HR manager",
          category: "data" as const,
          action: "Approved commission statement",
          targetType: "audit_probe",
          targetLabel: probe,
          before: { status: "draft" },
          after: { status: "approved" },
        },
      ]),
    );
    type Entry = { id: string; action: string; target: string; before: string | null; after: string | null };
    const read = async (cookie: string) => {
      const answer = await call("get", "/audit", cookie);
      status(answer, 200);
      return answer.body as Entry[];
    };
    const [owner, hr, accountant] = await Promise.all([
      read(cookies.owner),
      read(cookies.hrB),
      read(cookies.accountant),
    ]);
    // Rows are kept for everyone, so the count, the order and the CSV export (built from this list) agree.
    expect(accountant.map((e) => e.id)).toEqual(owner.map((e) => e.id));
    expect(hr.map((e) => e.id)).toEqual(owner.map((e) => e.id));

    const probes = (entries: Entry[]) => entries.filter((e) => e.target === probe);
    expect(probes(owner)).toHaveLength(PAY_SENSITIVE_AUDIT_ACTIONS.size + 1);
    for (const seen of [probes(owner), probes(hr)]) {
      for (const entry of seen.filter((e) => PAY_SENSITIVE_AUDIT_ACTIONS.has(e.action))) {
        expect(entry.after, entry.action).toContain(secret);
        expect(entry.before, entry.action).toContain("3.3333");
      }
    }
    // The Accountant reads the audit log but not pay: the row, who and when, never the terms or reason.
    for (const entry of probes(accountant)) {
      if (PAY_SENSITIVE_AUDIT_ACTIONS.has(entry.action)) {
        expect(entry).toMatchObject({ before: HIDDEN_PAY_DETAILS, after: HIDDEN_PAY_DETAILS });
      } else {
        expect(entry.after).toContain("approved");
      }
    }
    const accountantText = JSON.stringify(accountant);
    expect(accountantText).not.toContain("Probe reason");
    expect(accountantText).not.toContain("7.7777");
    // The real entries written above: the adjustment reasons and the plan terms are hidden too.
    expect(accountantText).not.toContain("Spiff for the Maple job");
    expect(accountantText).not.toContain("Returned trim");
    expect(accountantText).not.toMatch(/baseRatePct|monthlyTarget|clawbackDays/);
    const realAdjustments = accountant.filter(
      (e) => e.action === "Adjusted commission statement" && e.target !== probe,
    );
    expect(realAdjustments.length).toBeGreaterThan(1);
    expect(realAdjustments.every((e) => e.before === null && e.after === HIDDEN_PAY_DETAILS)).toBe(true);
    expect(JSON.stringify(owner)).toContain("Spiff for the Maple job");
    expect(JSON.stringify(hr)).toContain("Returned trim");
    expect(JSON.stringify(owner)).toMatch(/baseRatePct/);
  });

  // Owner decision 2026-11-15 (ADR 0048 "Audit visibility"): below company-wide scope, a pay viewer
  // reads pay details only for people in their scope, and plan terms not at all.
  it("shows a branch-scoped pay viewer the pay details of themselves and their reports only", async () => {
    await rows(async (db) => {
      const [role] = await db
        .insert(roles)
        .values({ key: "payaudit", name: "payaudit", dataScope: "branch" })
        .returning();
      await db.insert(rolePermissions).values(
        ["settings.audit.view", "hr.employee.view_sensitive"].map((permissionKey) => ({
          roleId: role!.id,
          permissionKey,
        })),
      );
    });
    const leadEmail = await harness.addUser({ companyIds: [company.id], roles: ["payaudit"] });
    const reportEmail = await harness.addUser({ companyIds: [company.id], roles: ["sales"] });
    const lead = await person({ name: "Lena Lead" });
    const report = await person({ name: "Rory Report", managerId: lead.id });
    const outsider = await person({ name: "Otto Outside" });
    const reportUser = await harness.userIdOf(reportEmail);
    for (const [email, employeeId] of [
      [leadEmail, lead.id],
      [reportEmail, report.id],
    ] as const) {
      const userId = await harness.userIdOf(email);
      await rows((db) => db.update(userProfiles).set({ employeeId }).where(eq(userProfiles.userId, userId)));
    }
    const cookie = await enrolled(leadEmail);
    const probe = "Scoped audit probe";
    const entry = (action: string, targetType: string, targetId: string, after: Record<string, unknown>) =>
      payAuditEntry(probe, action, targetType, targetId, after);
    const entries = [
      entry("Added bonus", "bonus", await bonusFor(report.id), { reason: "Reason: Rory bonus" }),
      entry("Voided bonus", "bonus", await bonusFor(outsider.id), { reason: "Reason: Otto bonus" }),
      entry("Left out of pay period", "pay_period", uuidv7(), { employeeId: lead.id, reason: "Reason: Lena" }),
      entry("Brought back into pay period", "pay_period", uuidv7(), { employeeId: outsider.id, reason: null }),
      entry("Adjusted commission statement", "commission_statement", await adjustmentFor(reportUser), {
        reason: "Reason: Rory adjustment",
      }),
      entry("Adjusted commission statement", "commission_statement", await adjustmentFor(ids.repA), {
        reason: "Reason: Rae adjustment",
      }),
      entry("Edited commission plan", "commission_plan", uuidv7(), { baseRatePct: "9.9999" }),
    ];
    await rows((db) => db.insert(auditLog).values(entries));
    type Entry = { target: string; after: string | null };
    const read = async (as: string) =>
      ((await call("get", "/audit", as).expect(200)).body as Entry[]).filter((e) => e.target === probe);
    const details = (seen: Entry[]) => seen.map((e) => e.after ?? "").join("\n");

    const seen = await read(cookie);
    expect(seen).toHaveLength(entries.length);
    const text = details(seen);
    for (const own of ["Reason: Rory bonus", "Reason: Lena", "Reason: Rory adjustment"]) expect(text).toContain(own);
    for (const other of ["Reason: Otto bonus", outsider.id, "Reason: Rae adjustment", "9.9999"]) {
      expect(text).not.toContain(other);
    }
    expect(seen.filter((e) => e.after === HIDDEN_PAY_DETAILS)).toHaveLength(4);
    // The Owner and a company-wide HR manager read every entry; the Accountant, without the key, none.
    for (const as of [cookies.owner, cookies.hrB]) {
      const all = details(await read(as));
      for (const any of ["Reason: Otto bonus", "Reason: Rae adjustment", "9.9999"]) expect(all).toContain(any);
    }
    expect((await read(cookies.accountant)).every((e) => e.after === HIDDEN_PAY_DETAILS)).toBe(true);
  });
  // Owner decision 2026-11-15 (ADR 0048 "Manager history"): an override line goes to the manager on the
  // line's confirmed day, so a reorg never moves a line that was already earned.
  describe("overrides follow the manager on the line's day", () => {
    /** A manager, with a sign-in the override statement is read under. */
    const manager = (name: string) => newRep(name);
    /** The override one manager's statement for a month holds; "0.00" when there is no statement. */
    async function overrideOf(userId: string, month: string): Promise<string> {
      const row = (await data()).statements.find((s) => s.userId === userId && s.month === month);
      return row?.override ?? "0.00";
    }
    /** Puts the rep on the 2% override plan from M3 and records a paid 1000.00 sale on a day. */
    async function sale(repUserId: string, number: string, month: string, day: string) {
      const invoice = await addInvoice(number, repUserId, "1000.00", "500.00", month);
      await addPayment(`PAY-${number}`, invoice, "1000.00", month, "confirmed", day);
    }
    const assignOverride = async (userId: string) =>
      status(
        await send("post", "/commission-assignments", cookies.owner, {
          userId,
          planId: ids.planO,
          effectiveFrom: `${M3}-01`,
        }),
        201,
      );

    it("pays the override to the old manager for a payment confirmed before the change day, and to the new one from that day on", async () => {
      const oldBoss = await manager("Olga Oldboss");
      const newBoss = await manager("Nate Newboss");
      const rep = await newRep("Rhea Reorg");
      await managedSince(rep.employeeId, oldBoss.employeeId, "2024-01-08", ids.owner);
      await managedSince(rep.employeeId, newBoss.employeeId, `${M1}-15`, ids.owner);
      await rows((db) =>
        db.update(employees).set({ managerId: newBoss.employeeId }).where(eq(employees.id, rep.employeeId)),
      );
      await assignOverride(rep.userId);
      await sale(rep.userId, "INV-RG1", M1, "14");
      await sale(rep.userId, "INV-RG2", M1, "15");
      await sale(rep.userId, "INV-RG3", M1, "28");
      // 2% of one 1000.00 payment is 20.00: the 14th is the old manager's, the 15th and later the new one's.
      const oldLines = (await statement(oldBoss.userId, M1)).lines.filter((l) => l.kind === "override");
      const newLines = (await statement(newBoss.userId, M1)).lines.filter((l) => l.kind === "override");
      expect(oldLines.map((l) => [l.subjectUserId, l.commission])).toEqual([[rep.userId, "20.00"]]);
      expect(newLines.map((l) => [l.subjectUserId, l.commission]).sort()).toEqual(
        [
          [rep.userId, "20.00"],
          [rep.userId, "20.00"],
        ].sort(),
      );
      expect(await overrideOf(oldBoss.userId, M1)).toBe("20.00");
      expect(await overrideOf(newBoss.userId, M1)).toBe("40.00");
    });

    it("keeps an approved month's lines and amounts of the old manager when the Owner moves the rep to a new manager", async () => {
      const oldBoss = await manager("Ora Prior");
      const newBoss = await manager("Neil Fresh");
      const rep = await newRep("Rudy Reassigned", { managerId: oldBoss.employeeId });
      await managedSince(rep.employeeId, oldBoss.employeeId, "2024-01-08", ids.owner);
      await assignOverride(rep.userId);
      await sale(rep.userId, "INV-RA2", M2, "10");
      await sale(rep.userId, "INV-RA1", M1, "10");
      status(await approve(cookies.owner, oldBoss.userId, M2), 201);
      const approvedBefore = await statement(oldBoss.userId, M2);
      expect(approvedBefore).toMatchObject({ status: "approved", override: "20.00" });
      expect(await overrideOf(oldBoss.userId, M1)).toBe("20.00");

      // The Owner moves Rep Rudy under the new manager today.
      status(
        await send("put", `/employees/${rep.employeeId}`, cookies.owner, {
          ...employeeForm("Rudy Reassigned", { managerId: newBoss.employeeId }),
        }),
        200,
      );
      const history = await rows((db) =>
        db.select().from(employeeManagerHistory).where(eq(employeeManagerHistory.employeeId, rep.employeeId)),
      );
      expect(history.find((h) => h.effectiveFrom === companyDay())).toMatchObject({ managerId: newBoss.employeeId });

      // Earlier months stay with the old manager, the approved one unchanged line for line.
      expect(await statement(oldBoss.userId, M2)).toEqual(approvedBefore);
      expect(await overrideOf(oldBoss.userId, M1)).toBe("20.00");
      expect(await overrideOf(newBoss.userId, M2)).toBe("0.00");
      expect(await overrideOf(newBoss.userId, M1)).toBe("0.00");

      // A payment confirmed today is the new manager's.
      const today = await addInvoice("INV-RA3", rep.userId, "1000.00", "500.00", CURRENT);
      await addPayment("PAY-RA3", today, "1000.00", CURRENT, "confirmed", companyDay().slice(8));
      expect(await overrideOf(newBoss.userId, CURRENT)).toBe("20.00");
      expect(await overrideOf(oldBoss.userId, CURRENT)).toBe("0.00");
    });

    /** Moves an employee to a manager through People, as the Owner (only the Owner moves people on override plans). */
    const moveTo = async (employeeId: string, name: string, managerId: string | null) =>
      status(await send("put", `/employees/${employeeId}`, cookies.owner, employeeForm(name, { managerId })), 200);

    // First review of PR #32: manager changes are dated on the company's calendar, so is the lookup.
    it("pays the override of a payment confirmed on the company's evening before a reorg to the old manager", async () => {
      const oldBoss = await manager("Eve Early");
      const newBoss = await manager("Lou Late");
      const rep = await newRep("Nia Night", { managerId: oldBoss.employeeId });
      await managedSince(rep.employeeId, oldBoss.employeeId, "2024-01-08", ids.owner);
      await assignOverride(rep.userId);
      // 03:00 UTC on the company's today is 21:00 or 22:00 the evening before in Chicago.
      const today = companyDay();
      const evening = new Date(`${today}T03:00:00Z`);
      expect(companyDay(evening)).toBe(addDays(today, -1));
      const invoice = await addInvoice("INV-NE1", rep.userId, "1000.00", "500.00", M1);
      await addPayment("PAY-NE1", invoice, "1000.00", CURRENT, "confirmed", today.slice(8), evening);
      await moveTo(rep.employeeId, "Nia Night", newBoss.employeeId);
      // The line's month is its UTC day's, today's month; the manager is the one of the company's day before.
      const month = today.slice(0, 7);
      expect(await overrideOf(oldBoss.userId, month)).toBe("20.00");
      expect(await overrideOf(newBoss.userId, month)).toBe("0.00");
    });

    // First review of PR #32 (blocking): a later move no longer clears a self-made manager's earlier days.
    it("keeps refusing the months a statement's own person set the manager after the Owner moves the rep elsewhere, until someone else sets that manager again", async () => {
      const setter = await manager("Sid Selfset");
      const other = await manager("Ola Other");
      const rep = await newRep("Rex Report", { managerId: setter.employeeId });
      // Sid made himself Rex's manager long ago, while Rex was on no override plan.
      await managedSince(rep.employeeId, setter.employeeId, "2024-01-08", setter.userId);
      await assignOverride(rep.userId);
      await sale(rep.userId, "INV-SS1", M1, "10");
      expect(await overrideOf(setter.userId, M1)).toBe("20.00");
      refused(await approve(cookies.owner, setter.userId, M1), SELF_MADE);

      // The Owner corrects the reporting line today: the M1 override stays Sid's, so it stays refused.
      await moveTo(rep.employeeId, "Rex Report", other.employeeId);
      expect(await overrideOf(setter.userId, M1)).toBe("20.00");
      expect(await overrideOf(other.userId, M1)).toBe("0.00");
      refused(await approve(cookies.owner, setter.userId, M1), SELF_MADE);
      refused(await approve(cookies.hrB, setter.userId, M1), SELF_MADE);

      // The Owner sets Sid as Rex's manager again: someone else has now chosen him, the earlier days included.
      await moveTo(rep.employeeId, "Rex Report", setter.employeeId);
      status(await approve(cookies.owner, setter.userId, M1), 201);
    });

    /**
     * An "Edited employee" entry from before the manager history began, as a People save writes it
     * (people.service.ts `save`): `by` changed the manager `from` → `to` at `when`. Only these entries
     * say who set the manager a since-records-began row holds (ADR 0048 "Self-made manager").
     */
    async function earlierManagerChange(
      employeeId: string,
      name: string,
      by: string,
      change: { from: string | null; to: string; when: Date },
    ) {
      await rows((db) =>
        db.insert(auditLog).values({
          at: change.when,
          actorUserId: by,
          actorRole: "HR manager",
          category: "data",
          action: "Edited employee",
          targetType: "employee",
          targetId: employeeId,
          targetLabel: name,
          before: { managerId: change.from },
          after: { managerId: change.to },
        }),
      );
    }

    /**
     * The row migration 0005 gave every live employee: since records began, the manager they had, and
     * the employee row's own created_by, as no person recorded it.
     */
    async function backfilled(employeeId: string) {
      await rows(async (db) => {
        const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
        await db.insert(employeeManagerHistory).values({
          employeeId,
          managerId: employee!.managerId,
          effectiveFrom: null,
          createdBy: employee!.createdBy,
        });
      });
    }

    // Third review of PR #32: the self-made guard on the rows migration 0005 wrote, which only the audit log
    // can say who set (`withSetters` in commission-records.ts).
    it("refuses the months of a backfilled manager the statement's own person set, read from the audit log, until someone else sets that manager again", async () => {
      const setter = await manager("Sam Backfill");
      const other = await manager("Opal Pick");
      const rep = await newRep("Tia Migrated", { managerId: setter.employeeId, createdBy: ids.hrA });
      // Before the history began the Owner made Opal Tia's manager, then Sam made himself her manager.
      // Migration 0005 then wrote one since-records-began row naming Sam, created by hrA, who added Tia.
      await earlierManagerChange(rep.employeeId, "Tia Migrated", ids.owner, {
        from: null,
        to: other.employeeId,
        when: new Date("2024-02-01T15:00:00Z"),
      });
      await earlierManagerChange(rep.employeeId, "Tia Migrated", setter.userId, {
        from: other.employeeId,
        to: setter.employeeId,
        when: new Date("2024-03-01T15:00:00Z"),
      });
      await backfilled(rep.employeeId);
      expect(await historyOf(rep.employeeId)).toEqual([
        { managerId: setter.employeeId, effectiveFrom: null, createdBy: ids.hrA },
      ]);
      await assignOverride(rep.userId);
      await sale(rep.userId, "INV-BF1", M1, "10");
      expect(await overrideOf(setter.userId, M1)).toBe("20.00");
      // No dated row yet: the last manager change of all set the row, and that was Sam's own.
      refused(await approve(cookies.owner, setter.userId, M1), SELF_MADE);

      // The Owner moves Tia to Opal today, her first dated row. That save's own audit entry comes after the
      // row in the same transaction, so Sam's change stays the last one before the history began.
      await moveTo(rep.employeeId, "Tia Migrated", other.employeeId);
      expect(await historyOf(rep.employeeId)).toEqual([
        { managerId: setter.employeeId, effectiveFrom: null, createdBy: ids.hrA },
        { managerId: other.employeeId, effectiveFrom: companyDay(), createdBy: ids.owner },
      ]);
      expect(await overrideOf(setter.userId, M1)).toBe("20.00");
      refused(await approve(cookies.owner, setter.userId, M1), SELF_MADE);
      refused(await approve(cookies.hrB, setter.userId, M1), SELF_MADE);

      // The Owner sets Sam again: someone else has now chosen him, the backfilled days included.
      await moveTo(rep.employeeId, "Tia Migrated", setter.employeeId);
      status(await approve(cookies.owner, setter.userId, M1), 201);
    });

    // Third review of PR #32: a person with no history row gets their since-records-began row from the first
    // People save, created by that editor, who did not set the manager it holds.
    it("reads who set the manager a person had before their first People save from the audit log, not from that save or a later one", async () => {
      const setter = await manager("Seb Unrecorded");
      const other = await manager("Otis Other");
      // Uma was added outside the app, so no history row records that Seb made himself her manager.
      const rep = await newRep("Uma Unrecorded", { managerId: setter.employeeId, createdBy: ids.hrA });
      await earlierManagerChange(rep.employeeId, "Uma Unrecorded", setter.userId, {
        from: null,
        to: setter.employeeId,
        when: new Date("2024-03-01T15:00:00Z"),
      });
      await assignOverride(rep.userId);
      await sale(rep.userId, "INV-FE1", M1, "10");
      expect(await overrideOf(setter.userId, M1)).toBe("20.00");
      refused(await approve(cookies.owner, setter.userId, M1), SELF_MADE);

      // The Owner's save writes both rows, each created by the Owner, and its audit entry in one transaction.
      await moveTo(rep.employeeId, "Uma Unrecorded", other.employeeId);
      expect(await historyOf(rep.employeeId)).toEqual([
        { managerId: setter.employeeId, effectiveFrom: null, createdBy: ids.owner },
        { managerId: other.employeeId, effectiveFrom: companyDay(), createdBy: ids.owner },
      ]);
      refused(await approve(cookies.owner, setter.userId, M1), SELF_MADE);

      // A later save, here clearing her manager, does not move where the history began: the first dated row.
      await moveTo(rep.employeeId, "Uma Unrecorded", null);
      refused(await approve(cookies.owner, setter.userId, M1), SELF_MADE);
    });

    // First review of PR #32: `paysActorOverride` counts every manager in the window, not only today's.
    it("refuses a past manager in the statements' window an override assignment or an override plan edit for that person", async () => {
      const next = await manager("Ned Next");
      const rep = await newRep("Pia Past", { managerId: next.employeeId });
      // hrA managed Pia until the Owner moved her to Ned on the 15th of M2.
      await managedSince(rep.employeeId, ids.empHrA, "2024-01-08", ids.owner);
      await managedSince(rep.employeeId, next.employeeId, `${M2}-15`, ids.owner);
      refused(
        await send("post", "/commission-assignments", cookies.hrA, {
          userId: rep.userId,
          planId: ids.planO,
          effectiveFrom: `${M1}-01`,
        }),
        "Someone else must put your own people on a plan that pays you an override.",
      );
      const added = await send(
        "post",
        "/commission-plans",
        cookies.owner,
        planBody({ name: "Past override", overridePct: "1" }),
      );
      status(added, 201);
      const planId = added.body.id as string;
      await rows((db) =>
        db
          .update(commissionPlans)
          .set({ effectiveFrom: `${M3}-01` })
          .where(eq(commissionPlans.id, planId)),
      );
      status(
        await send("post", "/commission-assignments", cookies.owner, {
          userId: rep.userId,
          planId,
          effectiveFrom: `${M1}-01`,
        }),
        201,
      );
      refused(
        await send(
          "put",
          `/commission-plans/${planId}`,
          cookies.hrA,
          planBody({ name: "Past override", overridePct: "2" }),
        ),
        "Someone else must change a plan that pays you an override.",
      );
    });
  });

  // First review of PR #32: what People writes to the dated manager history (ADR 0048).
  describe("People writes the manager history", () => {
    const today = () => companyDay();

    it("writes a since-records-began row for a person added with a manager, and none for one added without", async () => {
      const boss = await newRep("Bea Boss");
      const added = await send(
        "post",
        "/employees",
        cookies.hrA,
        employeeForm("Ann Added", { managerId: boss.employeeId }),
      );
      status(added, 201);
      expect(await historyOf(added.body.id as string)).toEqual([
        { managerId: boss.employeeId, effectiveFrom: null, createdBy: ids.hrA },
      ]);
      const plain = await send("post", "/employees", cookies.hrA, employeeForm("Pat Plain"));
      status(plain, 201);
      expect(await historyOf(plain.body.id as string)).toEqual([]);
    });

    it("records a person's first change as their manager until then since records began, then the change from today, and a cleared manager as none", async () => {
      const boss = await newRep("Cal Current");
      const next = await newRep("Dee Next");
      const fay = await person({ name: "Fay First", hiredAt: "2024-01-08", managerId: boss.employeeId });
      status(
        await send(
          "put",
          `/employees/${fay.id}`,
          cookies.hrA,
          employeeForm("Fay First", { managerId: next.employeeId }),
        ),
        200,
      );
      expect(await historyOf(fay.id)).toEqual([
        { managerId: boss.employeeId, effectiveFrom: null, createdBy: ids.hrA },
        { managerId: next.employeeId, effectiveFrom: today(), createdBy: ids.hrA },
      ]);
      status(
        await send("put", `/employees/${fay.id}`, cookies.hrA, employeeForm("Fay First", { managerId: null })),
        200,
      );
      expect((await historyOf(fay.id)).at(-1)).toEqual({ managerId: null, effectiveFrom: today(), createdBy: ids.hrA });
    });

    it("lets the later of two changes on one day decide the override, and pays none once the manager is cleared", async () => {
      const first = await newRep("Gil First");
      const second = await newRep("Hal Second");
      const third = await newRep("Ida Third");
      const rep = await newRep("Ivy Same", { managerId: first.employeeId });
      await managedSince(rep.employeeId, first.employeeId, "2024-01-08", ids.owner);
      status(
        await send("post", "/commission-assignments", cookies.owner, {
          userId: rep.userId,
          planId: ids.planO,
          effectiveFrom: `${M3}-01`,
        }),
        201,
      );
      const form = (managerId: string | null) => employeeForm("Ivy Same", { managerId });
      status(await send("put", `/employees/${rep.employeeId}`, cookies.owner, form(second.employeeId)), 200);
      status(await send("put", `/employees/${rep.employeeId}`, cookies.owner, form(third.employeeId)), 200);
      expect((await historyOf(rep.employeeId)).slice(-2)).toEqual([
        { managerId: second.employeeId, effectiveFrom: today(), createdBy: ids.owner },
        { managerId: third.employeeId, effectiveFrom: today(), createdBy: ids.owner },
      ]);
      const invoice = await addInvoice("INV-SD1", rep.userId, "1000.00", "500.00", CURRENT);
      await addPayment("PAY-SD1", invoice, "1000.00", CURRENT, "confirmed", today().slice(8));
      const overrideOf = async (userId: string) =>
        (await data()).statements.find((s) => s.userId === userId && s.month === CURRENT)?.override ?? "0.00";
      expect(await overrideOf(third.userId)).toBe("20.00");
      expect(await overrideOf(second.userId)).toBe("0.00");
      status(await send("put", `/employees/${rep.employeeId}`, cookies.owner, form(null)), 200);
      expect((await historyOf(rep.employeeId)).at(-1)).toEqual({
        managerId: null,
        effectiveFrom: today(),
        createdBy: ids.owner,
      });
      expect(await overrideOf(third.userId)).toBe("0.00");
    });
  });

  // Owner decision 2026-11-15 (ADR 0048 "Sign-in re-link"): approval stores the employee the statement pays.
  describe("the paid employee stored at approval", () => {
    async function storedEmployee(userId: string, month: string): Promise<string | null> {
      const [row] = await rows((db) =>
        db
          .select({ employeeId: commissionStatements.employeeId })
          .from(commissionStatements)
          .where(and(eq(commissionStatements.userId, userId), eq(commissionStatements.month, month))),
      );
      return row?.employeeId ?? null;
    }
    let planId = "";
    /** A rep on a plain plan with one paid sale in M1, approved by the Owner. */
    async function approvedRep(name: string, number: string) {
      if (!planId) {
        const added = await send("post", "/commission-plans", cookies.owner, planBody({ name: "Stored pay plan" }));
        status(added, 201);
        planId = added.body.id as string;
        await rows((db) =>
          db
            .update(commissionPlans)
            .set({ effectiveFrom: `${M3}-01` })
            .where(eq(commissionPlans.id, planId)),
        );
      }
      const rep = await newRep(name);
      status(
        await send("post", "/commission-assignments", cookies.owner, {
          userId: rep.userId,
          planId,
          effectiveFrom: `${M1}-01`,
        }),
        201,
      );
      const invoice = await addInvoice(number, rep.userId, "1000.00", "500.00", M1);
      await addPayment(`PAY-${number}`, invoice, "1000.00", M1);
      expect(await storedEmployee(rep.userId, M1)).toBeNull();
      const payable = (await statement(rep.userId, M1)).payable;
      expect(dec(payable).gt(0)).toBe(true);
      status(await approve(cookies.owner, rep.userId, M1), 201);
      expect(await storedEmployee(rep.userId, M1)).toBe(rep.employeeId);
      return { ...rep, payable };
    }
    const relink = async (name: string, from: string, to: string, userId: string) => {
      status(await send("put", `/employees/${from}`, cookies.owner, employeeForm(name, { userId: null })), 200);
      const target = await person({ name: `${name} Successor`, hiredAt: "2024-01-08" });
      status(
        await send("put", `/employees/${target.id}`, cookies.owner, employeeForm(`${name} Successor`, { userId })),
        200,
      );
      return target.id;
    };

    it("stores the employee at approval, and a later re-link leaves the pay run paying the stored employee", async () => {
      const rep = await approvedRep("Yara Yates", "INV-ST1");
      const successor = await relink("Yara Yates", rep.employeeId, "", rep.userId);
      expect(await storedEmployee(rep.userId, M1)).toBe(rep.employeeId);

      const opened = await send("post", "/pay-periods", cookies.owner, { date: week(4) });
      status(opened, 201);
      const run = await send("post", `/pay-periods/${opened.body.id as string}/approve`, cookies.owner);
      status(run, 201);
      const lines = new Map((run.body as PeriodBody).lines.map((l) => [l.employeeId, l]));
      expect(lines.get(rep.employeeId)?.commissionPay).toBe(rep.payable);
      expect(lines.get(successor)?.commissionPay ?? "0.00").toBe("0.00");
      expect(await statement(rep.userId, M1)).toMatchObject({
        status: "approved",
        payPeriodId: opened.body.id,
        payable: rep.payable,
      });
    });

    it("flags a stored employee who is terminated, a 1099 contractor or removed, whatever the rep's link is today", async () => {
      const rep = await approvedRep("Zane Zimmer", "INV-ST2");
      await relink("Zane Zimmer", rep.employeeId, "", rep.userId);
      const opened = await send("post", "/pay-periods", cookies.owner, { date: week(5) });
      status(opened, 201);
      const stranded = async () =>
        (
          (await call("get", `/pay-periods/${opened.body.id as string}/review`, cookies.owner).expect(200)).body as {
            strandedCommission: { userId: string; month: string; reason: string }[];
          }
        ).strandedCommission
          .filter((s) => s.userId === rep.userId)
          .map((s) => [s.month, s.reason]);
      const set = (values: Partial<typeof employees.$inferInsert>) =>
        rows((db) => db.update(employees).set(values).where(eq(employees.id, rep.employeeId)));

      // The stored employee is an active W-2: nothing is stranded, though the rep's link points elsewhere.
      expect(await stranded()).toEqual([]);
      await set({ status: "terminated" });
      expect(await stranded()).toEqual([[M1, "They have left, so no pay run includes them."]]);
      await set({ status: "active", workerType: "1099", flsaStatus: "not_applicable", exemptionBasis: null });
      expect(await stranded()).toEqual([[M1, "They are a 1099 contractor, and pay runs pay W-2 staff only."]]);
      await set({
        workerType: "w2",
        flsaStatus: "exempt",
        exemptionBasis: "administrative",
        deletedAt: new Date(),
      });
      expect(await stranded()).toEqual([[M1, "Their employee record was removed, so no pay run includes them."]]);
      await set({ deletedAt: null });
      expect(await stranded()).toEqual([]);
      // Never marked paid while stranded.
      expect(await statement(rep.userId, M1)).toMatchObject({ status: "approved", payPeriodId: null });
    });

    // First review of PR #32: a statement stored before the column, with no employee, follows today's link.
    it("pays and flags a statement stored with no employee by the rep's sign-in link today", async () => {
      const rep = await approvedRep("Lee Legacy", "INV-ST3");
      await rows((db) =>
        db
          .update(commissionStatements)
          .set({ employeeId: null })
          .where(and(eq(commissionStatements.userId, rep.userId), eq(commissionStatements.month, M1))),
      );
      const opened = await send("post", "/pay-periods", cookies.owner, { date: week(6) });
      status(opened, 201);
      const periodId = opened.body.id as string;
      const stranded = async () =>
        (
          (await call("get", `/pay-periods/${periodId}/review`, cookies.owner).expect(200)).body as {
            strandedCommission: { userId: string; month: string; reason: string }[];
          }
        ).strandedCommission
          .filter((s) => s.userId === rep.userId)
          .map((s) => [s.month, s.reason]);
      const linkTo = async (userId: string | null) =>
        status(
          await send("put", `/employees/${rep.employeeId}`, cookies.owner, employeeForm("Lee Legacy", { userId })),
          200,
        );
      expect(await stranded()).toEqual([]);
      await linkTo(null);
      expect(await stranded()).toEqual([[M1, "Their sign-in is not linked to an employee."]]);
      await linkTo(rep.userId);
      expect(await stranded()).toEqual([]);
      const run = await send("post", `/pay-periods/${periodId}/approve`, cookies.owner);
      status(run, 201);
      const line = (run.body as PeriodBody).lines.find((l) => l.employeeId === rep.employeeId);
      expect(line?.commissionPay).toBe(rep.payable);
    });

    // First review of PR #32: a re-link moves override lines, approved and paid months' too, so only the Owner re-links.
    it("lets only the Owner re-link a manager whose people are on an override plan, or a rep whose statements are all paid", async () => {
      const onlyOwner =
        "This person has commission plans, statements or overrides, so only the Owner can change their sign-in link.";
      const unlink = (cookie: string, employeeId: string, name: string) =>
        send("put", `/employees/${employeeId}`, cookie, employeeForm(name, { userId: null }));
      // Moe has no plan of his own; Rob reports to him and is on the override plan.
      const boss = await newRep("Moe Manager");
      const rep = await newRep("Rob Report", { managerId: boss.employeeId });
      await managedSince(rep.employeeId, boss.employeeId, "2024-01-08", ids.owner);
      status(
        await send("post", "/commission-assignments", cookies.owner, {
          userId: rep.userId,
          planId: ids.planO,
          effectiveFrom: `${M3}-01`,
        }),
        201,
      );
      refused(await unlink(cookies.hrA, boss.employeeId, "Moe Manager"), onlyOwner);
      // Pam's only statement is paid and her plan is gone.
      const paid = await approvedRep("Pam Paid", "INV-ST4");
      await rows(async (db) => {
        await db
          .update(commissionStatements)
          .set({ status: "paid" })
          .where(eq(commissionStatements.userId, paid.userId));
        await db
          .update(commissionAssignments)
          .set({ deletedAt: new Date() })
          .where(eq(commissionAssignments.userId, paid.userId));
      });
      refused(await unlink(cookies.hrA, paid.employeeId, "Pam Paid"), onlyOwner);
      status(await unlink(cookies.owner, boss.employeeId, "Moe Manager"), 200);
      status(await unlink(cookies.owner, paid.employeeId, "Pam Paid"), 200);
    });
  });

  // Owner decision 2026-11-15 (ADR 0048 "Audit visibility"): bonus and exclusion reasons are pay-sensitive,
  // and a pay viewer below company-wide scope reads details only for people in their scope.
  describe("GET /audit pay details by viewer", () => {
    type Entry = { target: string; action: string; after: string | null };
    const probe = "Pay reason probe";
    const reasons = {
      added: "Reason: added bonus",
      voided: "Reason: voided bonus",
      left: "Reason: left out",
      back: "Reason: brought back",
    };
    let own = { cookie: "", employeeId: "", userId: "" };
    let report = "";
    let outsider = "";
    let allCookie = "";

    const read = async (cookie: string) =>
      ((await call("get", "/audit", cookie).expect(200)).body as Entry[]).filter((e) => e.target === probe);
    /** The probe entries a viewer reads with details, by the reason text their `after` carries. */
    const visible = (seen: Entry[]) => seen.filter((e) => e.after !== HIDDEN_PAY_DETAILS && e.after !== null);
    const text = (seen: Entry[]) =>
      visible(seen)
        .map((e) => e.after)
        .join("\n");

    beforeAll(async () => {
      await rows(async (db) => {
        for (const [key, dataScope] of [
          ["payown", "own"],
          ["payall", "all"],
        ] as const) {
          const [role] = await db.insert(roles).values({ key, name: key, dataScope }).returning();
          await db.insert(rolePermissions).values(
            ["settings.audit.view", "hr.employee.view_sensitive"].map((permissionKey) => ({
              roleId: role!.id,
              permissionKey,
            })),
          );
        }
      });
      const ownEmail = await harness.addUser({ companyIds: [company.id], roles: ["payown"] });
      const allEmail = await harness.addUser({ companyIds: [company.id], roles: ["payall"] });
      const me = await person({ name: "Mona Mine" });
      report = (await person({ name: "Ronan Reports", managerId: me.id })).id;
      outsider = (await person({ name: "Otis Outer" })).id;
      const ownUser = await harness.userIdOf(ownEmail);
      await rows((db) => db.update(userProfiles).set({ employeeId: me.id }).where(eq(userProfiles.userId, ownUser)));
      own = { cookie: await enrolled(ownEmail), employeeId: me.id, userId: ownUser };
      allCookie = await enrolled(allEmail);
      const entry = (action: string, targetType: string, targetId: string, after: Record<string, unknown>) =>
        payAuditEntry(probe, action, targetType, targetId, after);
      const mineAdded = await bonusFor(me.id);
      const mineVoided = await bonusFor(me.id, true);
      const reportBonus = await bonusFor(report);
      const outsiderBonus = await bonusFor(outsider, true);
      await rows((db) =>
        db.insert(auditLog).values([
          entry("Added bonus", "bonus", mineAdded, { reason: reasons.added }),
          entry("Voided bonus", "bonus", mineVoided, { reason: reasons.voided }),
          entry("Left out of pay period", "pay_period", uuidv7(), { employeeId: me.id, reason: reasons.left }),
          entry("Brought back into pay period", "pay_period", uuidv7(), { employeeId: me.id, reason: reasons.back }),
          entry("Added bonus", "bonus", reportBonus, { reason: "Reason: report bonus" }),
          entry("Voided bonus", "bonus", outsiderBonus, { reason: "Reason: outsider voided" }),
          entry("Left out of pay period", "pay_period", uuidv7(), {
            employeeId: outsider,
            reason: "Reason: outsider",
          }),
          entry("Edited commission plan", "commission_plan", uuidv7(), { baseRatePct: "8.8888" }),
        ]),
      );
    });

    it("hides the four bonus and exclusion actions from a viewer without the pay key, and keeps their rows", async () => {
      const everyone = await read(cookies.owner);
      const accountant = await read(cookies.accountant);
      expect(accountant.map((e) => e.action)).toEqual(everyone.map((e) => e.action));
      for (const action of ["Added bonus", "Voided bonus", "Left out of pay period", "Brought back into pay period"]) {
        const rowsOf = accountant.filter((e) => e.action === action);
        expect(rowsOf.length, action).toBeGreaterThan(0);
        expect(
          rowsOf.every((e) => e.after === HIDDEN_PAY_DETAILS),
          action,
        ).toBe(true);
      }
      expect(JSON.stringify(accountant)).not.toMatch(/Reason: |8\.8888/);
      // An employee with no audit permission reads no audit at all.
      status(await call("get", "/audit", cookies.employee), 403);
    });

    it("shows an own-scope pay viewer only their own employee's details, never their reports', and no plan terms", async () => {
      const seen = await read(own.cookie);
      expect(seen).toHaveLength(8);
      const shown = text(seen);
      for (const mine of Object.values(reasons)) expect(shown).toContain(mine);
      for (const hidden of ["Reason: report bonus", "Reason: outsider", outsider, "8.8888"]) {
        expect(shown).not.toContain(hidden);
      }
      expect(visible(seen)).toHaveLength(4);
      expect(seen.filter((e) => e.after === HIDDEN_PAY_DETAILS)).toHaveLength(4);
    });

    it("shows an all-scope pay viewer and the Owner every entry, plan terms included", async () => {
      for (const cookie of [allCookie, cookies.owner]) {
        const seen = await read(cookie);
        expect(seen).toHaveLength(8);
        expect(visible(seen)).toHaveLength(8);
        const shown = text(seen);
        for (const any of [...Object.values(reasons), "Reason: report bonus", "Reason: outsider", "8.8888"]) {
          expect(shown).toContain(any);
        }
      }
    });
  });
});
