import {
  auditLog,
  customers as customerTable,
  employees as employeeTable,
  expenses as expenseTable,
  goodsReceipts,
  invoiceAdjustments,
  invoices as invoiceTable,
  locations as locationTable,
  outboxMessages,
  payPeriodLines,
  payPeriods as payPeriodTable,
  paymentsReceived,
  products as productTable,
  rolePermissions,
  roles,
  settings as settingsTable,
  userProfiles,
} from "@workspace/db/company";
import { tenantModuleOverrides } from "@workspace/db/control";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import {
  addDays,
  businessReport,
  capDrillRecords,
  dec,
  DEFAULT_SHARED_COSTS,
  FEATURES,
  hubWindow,
  last12Months,
  lineAmount,
  monthEnd,
  paymentsReport,
  pnlReport,
  REPORT_QUERY_MESSAGES as M,
  REPORT_WHOLE_COMPANY,
  roundMoney,
  salesByCategoryReport,
  scopeAllows,
  sum,
  type BusinessData,
  type BusinessFilters,
  type BusinessReport,
  type BusinessSection,
  type BusinessVisibility,
  type Customer,
  type DataScope,
  type Expense,
  type FeatureKey,
  type Invoice,
  type ModuleKey,
  type Payment,
  type PaymentsReportQuery,
  type PermissionKey,
  type PnlQuery,
  type Report,
  type ReportOptions,
  type SalesByCategoryQuery,
  type SharedCostSettings,
} from "@workspace/shared";
import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import request from "supertest";
import type { Response } from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLocations, loadMovements, loadProducts, loadRolls } from "../src/modules/inventory/inventory-records";
import { loadExpenses } from "../src/modules/finance/expense-records";
import { loadPayPeriods } from "../src/modules/hr/pay-records";
import { loadBills, loadSupplierPayments } from "../src/modules/purchasing/payables-records";
import { loadOrders, loadReceipts, loadSuppliers } from "../src/modules/purchasing/purchasing-records";
import { minuteIn, readSnapshot } from "../src/modules/reports/report-records";
import { loadInvoices, loadNames, loadPayments, loadRefunds } from "../src/modules/sales/invoice-records";
import { dayIn } from "../src/modules/sales/sales-common";
import { loadBranches, loadCustomers } from "../src/modules/sales/sales-records";
import { AuthHarness, PASSWORD, SUMMIT_ID, sessionCookie } from "./auth-harness";

/** Summit's time zone, the day every report reads in. */
const ZONE = "America/Denver";
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };
const ROUTES = ["options", "business", "pnl", "sales-by-category", "payments"] as const;
type Route = (typeof ROUTES)[number];

/** A path for each route that answers 200 for someone allowed. */
const PATHS: Record<Route, string> = {
  options: "/reports/options",
  business: `/reports/business?from=${OCTOBER.from}&to=${OCTOBER.to}`,
  pnl: "/reports/pnl",
  "sales-by-category": "/reports/sales-by-category",
  payments: "/reports/payments",
};

/** Every visibility flag on: what an Owner sees (ADR 0055). */
const ALL: BusinessVisibility = { margin: true, payroll: true, people: true, stock: true };
/** The Accountant: pay sight but no pay rates, so no People section (spec "Who uses it"). */
const ACCOUNTANT: BusinessVisibility = { ...ALL, people: false };
/** `rpt_nopay`: every cost key but no pay sight (ADR 0055 S3). */
const NOPAY: BusinessVisibility = { margin: true, payroll: false, people: false, stock: true };

/** The custom roles the stripping tests use, written into Summit's database (ADR 0055 B.5). */
const CUSTOM_ROLES: Record<string, { scope: DataScope; keys: PermissionKey[]; mfa: boolean }> = {
  rpt_nomargin: { scope: "all", keys: ["reports.financial.view", "reports.sales.view"], mfa: false },
  rpt_nopay: {
    scope: "all",
    keys: [
      "reports.financial.view",
      "sales.margin.view_sensitive",
      "contracts.contract.view_sensitive",
      "inventory.product.view_sensitive",
    ],
    mfa: false,
  },
  rpt_nocontracts: {
    scope: "all",
    keys: ["reports.financial.view", "sales.margin.view_sensitive", "inventory.product.view_sensitive"],
    mfa: false,
  },
  rpt_nocost: {
    scope: "all",
    keys: [
      "reports.financial.view",
      "reports.sales.view",
      "sales.margin.view_sensitive",
      "contracts.contract.view_sensitive",
      "hr.payroll.view",
    ],
    mfa: true,
  },
  rpt_costonly: { scope: "all", keys: ["reports.sales.view", "inventory.product.view_sensitive"], mfa: false },
  rpt_branchfin: { scope: "branch", keys: ["reports.financial.view"], mfa: false },
};

/** A Business report period with no filter, with some filters set. */
function filtersOf(period: { from: string; to: string }, over: Partial<BusinessFilters> = {}): BusinessFilters {
  return {
    ...period,
    locationIds: [],
    productCategory: null,
    expenseCategory: null,
    salesRepId: null,
    supplierId: null,
    ...over,
  };
}

/** The Business report's path for a period and filters, as the web client builds it. */
function businessPath(f: BusinessFilters): string {
  const params = new URLSearchParams({ from: f.from, to: f.to });
  if (f.locationIds.length > 0) params.set("locationIds", f.locationIds.join(","));
  for (const key of ["productCategory", "expenseCategory", "salesRepId", "supplierId"] as const) {
    const value = f[key];
    if (value) params.set(key, value);
  }
  return `/reports/business?${params.toString()}`;
}

/** Today in Summit's time zone, the day the API reads as today. */
const today = () => dayIn(new Date(), ZONE);

const section = (report: BusinessReport, key: string): BusinessSection | undefined =>
  report.sections.find((s) => s.key === key);
const sectionKeys = (report: BusinessReport) => report.sections.map((s) => s.key);
const summaryValue = (report: BusinessReport, id: string) =>
  section(report, "summary")!.rows.find((row) => row.id === id)?.values.now;

/** Every key of every row's and total's values, in every section. */
function valueKeys(report: BusinessReport): Set<string> {
  const keys = new Set<string>();
  for (const s of report.sections) {
    for (const row of [...s.rows, ...(s.total ? [s.total] : [])])
      for (const key of Object.keys(row.values)) keys.add(key);
  }
  return keys;
}

/** Every drill record of a report, totals included. */
function recordsOf(report: BusinessReport) {
  return report.sections.flatMap((s) => [...s.rows, ...(s.total ? [s.total] : [])].flatMap((row) => row.records));
}

/** Every key of a report's rows and totals (hub reports). */
function hubKeys(report: Report): Set<string> {
  return new Set([...report.rows, ...(report.totals ? [report.totals] : [])].flatMap((row) => Object.keys(row)));
}

/**
 * Reports on the API (docs/product-spec/reports.md; ADR 0055), on Summit as seeded plus a few edge
 * rows, a second flooring company and an HR Suite company: refusals, data scope, stripping, the
 * bounded range, switches, equality with the shared calculation, and the week-18 gate.
 */
describe("reports (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let companyB = { id: "", slug: "" };
  let hrCompany = { id: "", slug: "" };
  const cookies: Record<string, string> = {};
  const ids = { owner: "", manager: "", sales: "", springs: "", denverBranch: "" };
  const places: Record<string, string> = {};
  const edge = { creditNote: "", voided: "", writtenOff: "", homeless: "", otherBranch: "" };
  const invariantProblems: string[] = [];
  let vendorId = "";

  function call(path: string, cookie?: string) {
    let test = request(harness.app.getHttpServer()).get(path).set("X-Forwarded-Host", "localhost:3000");
    if (cookie) test = test.set("Cookie", cookie);
    return test;
  }

  function status(response: Response, expected: number): void {
    expect(response.status, `${response.status} ${JSON.stringify(response.body).slice(0, 400)}`).toBe(expected);
  }

  async function ok<T>(path: string, cookie: string): Promise<T> {
    const response = await call(path, cookie);
    status(response, 200);
    return response.body as T;
  }

  async function refused(path: string, cookie: string, code: number, body: { code: string; message?: string }) {
    const response = await call(path, cookie);
    status(response, code);
    if (body.message === undefined) expect(response.body.code).toBe(body.code);
    else expect(response.body).toEqual(body);
  }

  async function summit<T>(read: (db: Awaited<ReturnType<typeof harness.companyDb>>["db"]) => Promise<T>): Promise<T> {
    const handle = await harness.companyDb(SUMMIT_ID);
    try {
      return await read(handle.db);
    } finally {
      await handle.close();
    }
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

  async function withFeatureOff(key: FeatureKey, run: () => Promise<void>) {
    const feature = FEATURES[key] as { enabled: boolean };
    feature.enabled = false;
    try {
      await run();
    } finally {
      feature.enabled = true;
    }
  }

  async function withModuleOff(companyId: string, module: ModuleKey, run: () => Promise<void>) {
    await harness.control.db.insert(tenantModuleOverrides).values({ tenantId: companyId, module, enabled: false });
    try {
      await run();
    } finally {
      await harness.control.db
        .delete(tenantModuleOverrides)
        .where(and(eq(tenantModuleOverrides.tenantId, companyId), eq(tenantModuleOverrides.module, module)));
    }
  }

  /** The full company record, read by the module loaders with no window: what the expected values run on. */
  interface Full {
    business: Omit<BusinessData, "today">;
    invoices: Invoice[];
    payments: Payment[];
    expenses: Expense[];
    customers: Customer[];
    branches: Map<string, string | null>;
  }

  async function loadFull(): Promise<Full> {
    const control = harness.control.db;
    return summit(async (db) => {
      const invoices = await loadInvoices(db, ZONE);
      const payments = await loadPayments(db, control);
      const expenses = await loadExpenses(db, control);
      // Write-off and receipt moments are company minutes (ADR 0055 S12), re-read from the raw rows.
      const adjustments = (
        await db
          .select()
          .from(invoiceAdjustments)
          .where(isNull(invoiceAdjustments.deletedAt))
          .orderBy(invoiceAdjustments.at, invoiceAdjustments.id)
      ).map((row) => ({ invoiceId: row.invoiceId, kind: row.kind, amount: row.amount, at: minuteIn(row.at, ZONE) }));
      const receivedAt = new Map(
        (await db.select({ id: goodsReceipts.id, at: goodsReceipts.receivedAt }).from(goodsReceipts)).map((row) => [
          row.id,
          minuteIn(row.at, ZONE),
        ]),
      );
      const receipts = (await loadReceipts(db)).map((r) => ({ ...r, receivedAt: receivedAt.get(r.id)! }));
      const [shared] = await db
        .select({ value: settingsTable.value })
        .from(settingsTable)
        .where(eq(settingsTable.group, "sharedCosts"));
      const names = await loadNames(
        control,
        invoices.map((i) => i.salesRepId),
      );
      return {
        invoices,
        payments,
        expenses,
        customers: await loadCustomers(db),
        branches: await loadBranches(db),
        business: {
          invoices,
          payments,
          adjustments,
          refunds: await loadRefunds(db, control),
          expenses,
          bills: await loadBills(db, control),
          supplierPayments: await loadSupplierPayments(db, control),
          receipts,
          purchaseOrders: await loadOrders(db),
          suppliers: await loadSuppliers(db),
          users: [...names].map(([id, name]) => ({ id, name })),
          employees: await db
            .select({ id: employeeTable.id, name: employeeTable.name, homeLocationId: employeeTable.homeLocationId })
            .from(employeeTable),
          locations: await loadLocations(db),
          productCategories: await db
            .select({ id: productTable.id, category: productTable.category })
            .from(productTable),
          products: await loadProducts(db),
          rolls: await loadRolls(db),
          stockMovements: await loadMovements(db),
          payPeriods: await loadPayPeriods(db, control),
          settings: { sharedCosts: (shared?.value as SharedCostSettings | undefined) ?? DEFAULT_SHARED_COSTS },
        },
      };
    });
  }

  const expectedBusiness = (full: Full, filters: BusinessFilters, show: BusinessVisibility) =>
    capDrillRecords(businessReport({ ...full.business, today: today() }, filters, show));

  /** Profit and loss on the full record: the same profit calculation as the Business report (ADR 0061 decision 2). */
  const expectedPnl = (full: Full, query: PnlQuery, show: BusinessVisibility) =>
    pnlReport(query, { ...full.business, today: today() }, show);

  /** Whether a person's data scope covers an invoice, by the rule of GET /invoices (ADR 0055 S2). */
  const inScope = (who: { scope: DataScope; userId: string; branchId: string | null }) => (i: Invoice) =>
    scopeAllows(
      who.scope,
      { userId: who.userId, branchId: who.branchId },
      { ownerUserId: i.salesRepId, branchId: i.branchId },
    );

  const managerScope = () => ({ scope: "branch" as const, userId: ids.manager, branchId: ids.denverBranch });

  function expectedSales(full: Full, query: SalesByCategoryQuery, keep: (i: Invoice) => boolean, margin: boolean) {
    return salesByCategoryReport(
      query,
      { today: today(), invoices: full.invoices.filter(keep), products: full.business.productCategories },
      { margin },
    );
  }

  function expectedPayments(
    full: Full,
    query: PaymentsReportQuery,
    who: { scope: DataScope; userId: string; branchId: string | null },
  ) {
    const invoices = full.invoices.filter(inScope(who));
    const seen = new Set(invoices.map((i) => i.id));
    return paymentsReport(query, {
      today: today(),
      invoices,
      payments: full.payments.filter((p) => seen.has(p.invoiceId)),
      customers: full.customers.filter((c) =>
        scopeAllows(
          who.scope,
          { userId: who.userId, branchId: who.branchId },
          { ownerUserId: c.salesRepId || null, branchId: full.branches.get(c.salesRepId) ?? null },
        ),
      ),
    });
  }

  const gatePeriods = () => [
    OCTOBER,
    { from: "2026-01-01", to: "2026-06-30" },
    { from: "2025-12-15", to: "2026-02-10" },
    { from: addDays(today(), -365), to: today() },
  ];

  const gateFilters = (period: { from: string; to: string }) => [
    filtersOf(period),
    filtersOf(period, { locationIds: [places["Denver Central"]!, places["Summit Design Studio"]!] }),
    filtersOf(period, { expenseCategory: "rent" }),
    filtersOf(period, { supplierId: vendorId }),
  ];

  /** The week-18 gate: Profit by location adds up to the company's net profit and revenue. */
  function expectGate(report: BusinessReport, label: string) {
    const locations = section(report, "locations");
    expect(locations, label).toBeDefined();
    expect(dec(locations!.total!.values.net!).eq(summaryValue(report, "net")!), `${label}: net`).toBe(true);
    expect(dec(locations!.total!.values.revenue!).eq(summaryValue(report, "revenue")!), `${label}: revenue`).toBe(true);
  }

  /** What a report without the `margin` flag looks like (ADR 0055 S7, S17; R-STRIP-1's margin shape). */
  function expectNoMargin(report: BusinessReport) {
    expect(sectionKeys(report)).not.toContain("locations");
    expect(section(report, "summary")!.rows.map((row) => row.id)).toEqual([
      "revenue",
      "cash_in",
      "cash_out",
      "ar_current",
      "ar_overdue",
      "ap_current",
      "ap_overdue",
    ]);
    for (const key of ["revenue_category", "revenue_rep"]) {
      const s = section(report, key)!;
      expect(s.columns.map((c) => c.id)).toEqual(["revenue"]);
      for (const row of [...s.rows, s.total!]) expect(Object.keys(row.values)).toEqual(["revenue"]);
    }
    const keys = valueKeys(report);
    for (const hidden of ["margin", "cogs", "net", "gross", "direct"]) expect(keys.has(hidden)).toBe(false);
    expect(report.sections.flatMap((s) => s.rows).some((row) => row.id === "cogs")).toBe(false);
  }

  function expectNoMarginPnl(report: Report) {
    expect(report.columns.map((c) => c.id)).toEqual(["month", "revenue", "expenses"]);
    expect([...hubKeys(report)].sort()).toEqual(["expenses", "month", "revenue"]);
  }

  beforeAll(async () => {
    await harness.start();
    companyB = await harness.provisionCompany("rptb");
    hrCompany = await harness.provisionCompany("rpthr", ["hr"]);
    ids.owner = await harness.userIdOf("dana.whitfield@summitfloor.example");
    ids.manager = await harness.userIdOf("luis.ortega@summitfloor.example");
    ids.sales = await harness.userIdOf("priya.natarajan@summitfloor.example");
    ids.springs = await harness.userIdOf("sam.okafor@summitfloor.example");

    await summit(async (db) => {
      for (const row of await db.select().from(locationTable)) places[row.name] = row.id;
      const [luis] = await db
        .select({ branchId: userProfiles.branchId })
        .from(userProfiles)
        .where(eq(userProfiles.userId, ids.manager));
      ids.denverBranch = luis!.branchId!;
      for (const [key, role] of Object.entries(CUSTOM_ROLES)) {
        const [made] = await db.insert(roles).values({ key, name: key, dataScope: role.scope }).returning();
        await db
          .insert(rolePermissions)
          .values(role.keys.map((permissionKey) => ({ roleId: made!.id, permissionKey })));
      }
      // The document invariant the gate rests on (critic C6), checked before any edge row is written,
      // so a failing gate points at bad data rather than at the report.
      for (const invoice of await loadInvoices(db, ZONE)) {
        if (invoice.lines.length > 0) {
          const subtotal = sum(invoice.lines.map(lineAmount));
          const cost = sum(invoice.lines.map((line) => roundMoney(dec(line.quantity).times(line.unitCost))));
          if (!subtotal.eq(invoice.subtotal) || !cost.eq(invoice.cost)) invariantProblems.push(invoice.number);
        } else if (dec(invoice.subtotal).isZero() && !dec(invoice.cost).isZero()) {
          invariantProblems.push(invoice.number);
        }
      }
      const [vendor] = await db
        .select({ supplierId: expenseTable.supplierId })
        .from(expenseTable)
        .where(and(isNull(expenseTable.deletedAt), isNotNull(expenseTable.supplierId)))
        .limit(1);
      vendorId = vendor!.supplierId!;
    });

    // Edge rows for the gate, written behind the API's back once, each by the Owner (critic C18).
    await summit(async (db) => {
      const october = await db
        .select()
        .from(invoiceTable)
        .where(
          and(
            isNull(invoiceTable.deletedAt),
            isNull(invoiceTable.voidedAt),
            isNull(invoiceTable.contractId),
            eq(invoiceTable.isReturn, false),
            sql`${invoiceTable.issuedAt} >= '2026-10-02T12:00:00Z' and ${invoiceTable.issuedAt} < '2026-10-30T12:00:00Z'`,
          ),
        )
        .orderBy(invoiceTable.issuedAt);
      const payments = await db
        .select({ invoiceId: paymentsReceived.invoiceId, status: paymentsReceived.status })
        .from(paymentsReceived);
      const paid = new Set(payments.map((p) => p.invoiceId));
      const confirmed = new Set(payments.filter((p) => p.status === "confirmed").map((p) => p.invoiceId));
      const unpaid = october.filter((i) => !paid.has(i.id) && dec(i.total).gte(50));
      expect(unpaid.length).toBeGreaterThanOrEqual(2);
      const [writeOff, voided] = unpaid;
      const source = october[0]!;
      // Every seeded Summit invoice is on the Denver branch, so branch scope would cut nothing: one
      // paid October invoice moves to the Colorado Springs branch, outside the Manager's scope.
      const elsewhere = october.find((i) => confirmed.has(i.id) && i.id !== source.id)!;
      const [springs] = await db
        .select({ branchId: locationTable.branchId })
        .from(locationTable)
        .where(eq(locationTable.id, places["Colorado Springs"]!));
      expect(springs!.branchId).not.toBe(ids.denverBranch);
      await db
        .update(invoiceTable)
        .set({ branchId: springs!.branchId, updatedAt: new Date() })
        .where(eq(invoiceTable.id, elsewhere.id));
      edge.otherBranch = elsewhere.number;
      await db.insert(expenseTable).values({
        number: "EXP-RPT-0001",
        date: "2026-10-14",
        category: "marketing",
        locationId: null,
        amount: "300.00",
        tax: "0",
        paymentMethod: "card",
        status: "confirmed",
        settlement: "paid",
        recordedById: ids.owner,
        recordedAt: new Date("2026-10-14T16:00:00Z"),
        createdBy: ids.owner,
      });
      const writeOffRow = {
        invoiceId: writeOff!.id,
        customerId: writeOff!.customerId,
        kind: "write_off" as const,
        reason: "Report gate edge row",
        byUserId: ids.owner,
        createdBy: ids.owner,
      };
      await db.insert(invoiceAdjustments).values([
        // 12:00 in Denver (MDT, UTC−6).
        { ...writeOffRow, amount: "25.00", at: new Date("2026-10-20T18:00:00Z") },
        // 20:30 on 31 October in Denver is already 1 November in UTC: it is an October bad debt (S12).
        { ...writeOffRow, amount: "10.00", at: new Date("2026-11-01T02:30:00Z") },
      ]);
      edge.writtenOff = writeOff!.id;
      const creditNote = {
        ...source,
        id: uuidv7(),
        number: `${source.number}-RPT`,
        quoteId: null,
        isReturn: true,
        creditForInvoiceId: source.id,
        sentAt: null,
        sentBy: null,
        refundedAt: null,
        soldAtLocationId: places["Southgate Showroom"]!,
        subtotal: "100.00",
        cost: "40.00",
        tax: "0.00",
        total: "100.00",
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: ids.owner,
      };
      await db.insert(invoiceTable).values(creditNote);
      edge.creditNote = creditNote.number;
      await db
        .update(invoiceTable)
        .set({
          voidedAt: new Date(voided!.issuedAt.getTime() + 3_600_000),
          voidReason: "Report gate edge row",
          updatedAt: new Date(),
        })
        .where(eq(invoiceTable.id, voided!.id));
      edge.voided = voided!.number;
      const [period] = await db.select().from(payPeriodTable).where(eq(payPeriodTable.end, "2026-10-18"));
      const [line] = await db
        .select({ employeeId: payPeriodLines.employeeId })
        .from(payPeriodLines)
        .where(eq(payPeriodLines.payPeriodId, period!.id))
        .orderBy(payPeriodLines.id)
        .limit(1);
      await db
        .update(employeeTable)
        .set({ homeLocationId: null, updatedAt: new Date() })
        .where(eq(employeeTable.id, line!.employeeId));
      edge.homeless = line!.employeeId;
    });

    cookies.owner = await enrolled("dana.whitfield@summitfloor.example");
    cookies.accountant = await enrolled("grace.liu@summitfloor.example");
    cookies.manager = await harness.signIn("luis.ortega@summitfloor.example");
    cookies.sales = await harness.signIn("priya.natarajan@summitfloor.example");
    cookies.purchasing = await harness.signIn("renata.kowalski@summitfloor.example");
    for (const [key, role] of Object.entries(CUSTOM_ROLES)) {
      const email = await harness.addUser({ companyIds: [SUMMIT_ID], roles: [key] });
      if (role.scope === "branch") {
        const userId = await harness.userIdOf(email);
        await summit((db) =>
          db.update(userProfiles).set({ branchId: ids.denverBranch }).where(eq(userProfiles.userId, userId)),
        );
      }
      cookies[key] = role.mfa ? await enrolled(email) : await harness.signIn(email);
    }
    cookies.ownerB = await enrolled(await harness.addUser({ companyIds: [companyB.id], roles: ["owner"] }));
    cookies.ownerHr = await enrolled(await harness.addUser({ companyIds: [hrCompany.id], roles: ["owner"] }));
  }, 300_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("starts from seeded invoices that keep the document invariant (critic C6)", () => {
    expect(invariantProblems).toEqual([]);
  });

  it("refuses every route without a session (R-AUTH)", async () => {
    for (const route of ROUTES) {
      const response = await call(PATHS[route]);
      status(response, 401);
      expect(response.body.code).toBe("unauthenticated");
    }
  });

  it("serves Flooring Suite only, with module core on (R-PRODUCT; S13)", async () => {
    for (const route of ROUTES) {
      await refused(PATHS[route], cookies.ownerHr!, 403, { code: "product_not_enabled" });
    }
    await withModuleOff(companyB.id, "core", async () => {
      for (const route of ROUTES) {
        await refused(PATHS[route], cookies.ownerB!, 403, { code: "module_not_enabled" });
      }
    });
  });

  it("needs each report's own key (R-KEY)", async () => {
    for (const route of ROUTES) {
      await refused(PATHS[route], cookies.purchasing!, 403, { code: "forbidden" });
    }
    for (const route of ["business", "pnl", "payments"] as const) {
      await refused(PATHS[route], cookies.sales!, 403, { code: "forbidden" });
    }
    for (const route of ["options", "sales-by-category"] as const) status(await call(PATHS[route], cookies.sales), 200);
    for (const route of ["options", "sales-by-category", "payments"] as const) {
      status(await call(PATHS[route], cookies.manager), 200);
    }
  });

  it("opens the Business report and P&L to data scope all only (R-SCOPE-1; S1)", async () => {
    const wholeCompany = { code: "forbidden", message: REPORT_WHOLE_COMPANY };
    for (const cookie of [cookies.manager!, cookies.rpt_branchfin!]) {
      await refused(PATHS.business, cookie, 403, wholeCompany);
      await refused(PATHS.pnl, cookie, 403, wholeCompany);
    }
    status(await call(PATHS.payments, cookies.rpt_branchfin), 200);
  });

  it("cuts Sales by category to the Manager's branch or own invoices (R-SCOPE-2; S2)", async () => {
    const full = await loadFull();
    const query: SalesByCategoryQuery = { range: "12m", locationId: null, category: null };
    const answer = await ok<Report>(PATHS["sales-by-category"], cookies.manager!);
    expect(answer).toEqual(expectedSales(full, query, inScope(managerScope()), true));
    const behind = full.invoices.filter(inScope(managerScope()));
    expect(behind.length).toBeGreaterThan(0);
    expect(behind.some((i) => i.number === edge.otherBranch)).toBe(false);
    expect(behind.every((i) => i.branchId === ids.denverBranch || i.salesRepId === ids.manager)).toBe(true);
    const owner = await ok<Report>(PATHS["sales-by-category"], cookies.owner!);
    expect(dec(owner.totals!.revenue!).gt(answer.totals!.revenue!)).toBe(true);
  });

  it("cuts Payments received to the Manager's invoices, and names only customers in scope (R-SCOPE-3; S2)", async () => {
    const full = await loadFull();
    const query: PaymentsReportQuery = { range: "12m", locationId: null, method: null, customer: "" };
    const answer = await ok<Report>(PATHS.payments, cookies.manager!);
    expect(answer).toEqual(expectedPayments(full, query, managerScope()));
    expect(answer.rows.length).toBeGreaterThan(0);
    const byNumber = new Map(full.payments.map((p) => [p.number, p]));
    const invoices = new Map(full.invoices.map((i) => [i.id, i]));
    for (const row of answer.rows) {
      const invoice = invoices.get(byNumber.get(row.number!)!.invoiceId)!;
      expect(invoice.branchId === ids.denverBranch || invoice.salesRepId === ids.manager).toBe(true);
    }
    const ownerRows = (await ok<Report>(PATHS.payments, cookies.owner!)).rows;
    const outside = ownerRows.filter(
      (row) => invoices.get(byNumber.get(row.number!)!.invoiceId)!.number === edge.otherBranch,
    );
    expect(outside.length).toBeGreaterThan(0);
    expect(answer.rows.length).toBe(ownerRows.length - outside.length);
    // A Denver invoice whose customer moves to a Colorado Springs rep: the payment stays, the name goes.
    const window = hubWindow("12m", today());
    const target = full.payments.find((p) => {
      const invoice = invoices.get(p.invoiceId);
      return (
        p.status === "confirmed" &&
        p.date >= window.from &&
        p.date <= window.paymentsTo &&
        invoice?.branchId === ids.denverBranch &&
        invoice.salesRepId !== ids.manager
      );
    })!;
    expect(target).toBeDefined();
    const customer = full.customers.find((c) => c.id === target.customerId)!;
    await summit((db) =>
      db.update(customerTable).set({ salesRepId: ids.springs }).where(eq(customerTable.id, customer.id)),
    );
    try {
      const moved = await ok<Report>(PATHS.payments, cookies.manager!);
      expect(moved.rows.find((row) => row.number === target.number)!.customer).toBe("");
      const owner = await ok<Report>(PATHS.payments, cookies.owner!);
      expect(owner.rows.find((row) => row.number === target.number)!.customer).toBe(customer.name);
    } finally {
      await summit((db) =>
        db
          .update(customerTable)
          .set({ salesRepId: customer.salesRepId || null })
          .where(eq(customerTable.id, customer.id)),
      );
    }
    await refused(PATHS.payments, cookies.sales!, 403, { code: "forbidden" });
  });

  it("cuts Sales by category to a salesperson's own invoices (R-SCOPE-4; S2)", async () => {
    const full = await loadFull();
    const query: SalesByCategoryQuery = { range: "12m", locationId: null, category: null };
    const answer = await ok<Report>(PATHS["sales-by-category"], cookies.sales!);
    expect(answer).toEqual(expectedSales(full, query, (i) => i.salesRepId === ids.sales, false));
    expect(answer.rows.length).toBeGreaterThan(0);
  });

  it("gives the Owner every section in order (R-ROLE-1)", async () => {
    const report = await ok<BusinessReport>(PATHS.business, cookies.owner!);
    expect(sectionKeys(report)).toEqual([
      "summary",
      "locations",
      "revenue_category",
      "revenue_rep",
      "expense_category",
      "expense_vendor",
      "expense_location",
      "cash",
      "purchases",
      "taxes",
      "people",
      "stock",
    ]);
  });

  it("gives the Accountant everything but People costs, with people costs still in operating expenses (R-ROLE-2)", async () => {
    const owner = await ok<BusinessReport>(PATHS.business, cookies.owner!);
    const accountant = await ok<BusinessReport>(PATHS.business, cookies.accountant!);
    expect(sectionKeys(accountant)).toEqual(sectionKeys(owner).filter((key) => key !== "people"));
    expect(summaryValue(accountant, "opex")).toBe(summaryValue(owner, "opex"));
    expect(recordsOf(accountant).some((r) => r.label.startsWith("Gross pay"))).toBe(false);
  });

  it("offers each default role its reports, exports and pickers (R-ROLE-3; S1, S15)", async () => {
    const all = ["business", "pnl", "sales", "payments", "trial-balance"];
    const names = ["Colorado Springs", "Denver Central", "Southgate Showroom", "Summit Design Studio"];
    for (const cookie of [cookies.owner!, cookies.accountant!]) {
      const options = await ok<ReportOptions>(PATHS.options, cookie);
      expect(options.reports).toEqual(all);
      expect(options.exports).toEqual(all);
      expect(options.salespeople.length).toBeGreaterThan(0);
      expect(options.vendors.length).toBeGreaterThan(0);
      expect(options.locations.map((l) => l.name).sort()).toEqual(names);
    }
    const manager = await ok<ReportOptions>(PATHS.options, cookies.manager!);
    expect(manager).toMatchObject({ reports: ["sales", "payments"], exports: ["sales"], salespeople: [], vendors: [] });
    expect(manager.locations.map((l) => l.name).sort()).toEqual(names);
    const sales = await ok<ReportOptions>(PATHS.options, cookies.sales!);
    expect(sales).toMatchObject({ reports: ["sales"], exports: [], salespeople: [], vendors: [] });
    expect(sales.locations.map((l) => l.name).sort()).toEqual(names);
  });

  it("strips every cost figure without the margin key, at any depth (R-STRIP-1; S7)", async () => {
    const report = await ok<BusinessReport>(PATHS.business, cookies.rpt_nomargin!);
    expectNoMargin(report);
    for (const key of ["locations", "people", "stock", "purchases"]) expect(sectionKeys(report)).not.toContain(key);
    expectNoMarginPnl(await ok<Report>(PATHS.pnl, cookies.rpt_nomargin!));
  });

  it("leaves people costs out without pay sight, and says so (R-STRIP-2; S3)", async () => {
    const full = await loadFull();
    const filters = filtersOf(OCTOBER);
    const report = await ok<BusinessReport>(PATHS.business, cookies.rpt_nopay!);
    const owner = await ok<BusinessReport>(PATHS.business, cookies.owner!);
    const summary = section(report, "summary")!;
    expect(summary.rows.find((row) => row.id === "opex")!.label).toBe("Operating expenses, excluding people costs");
    expect(summary.rows.find((row) => row.id === "net")!.label).toBe("Net profit, before people costs and income tax");
    expect(summary.note).toContain("People costs are left out, because your access doesn't include pay periods.");
    expect(sectionKeys(report)).not.toContain("people");
    expect(summaryValue(report, "opex")).toBe(summaryValue(expectedBusiness(full, filters, NOPAY), "opex"));
    expect(dec(summaryValue(report, "opex")!).lt(summaryValue(owner, "opex")!)).toBe(true);
    expect(recordsOf(report).some((r) => r.label.startsWith("Gross pay") || r.label === "Payroll")).toBe(false);
    const pnl = await ok<Report>(PATHS.pnl, cookies.rpt_nopay!);
    const ownerPnl = await ok<Report>(PATHS.pnl, cookies.owner!);
    expect(pnl.columns.find((c) => c.id === "expenses")!.header).toBe("Expenses, excluding payroll");
    expect(pnl.columns.find((c) => c.id === "netIncome")!.header).toBe("Net income, before payroll");
    const query: PnlQuery = { range: "12m", locationId: null };
    expect(pnl).toEqual(expectedPnl(full, query, NOPAY));
    expect(ownerPnl).toEqual(expectedPnl(full, query, ALL));
    // The difference is the people costs of rule 7, as in the Business report (ADR 0061 decision 2).
    expect(dec(ownerPnl.totals!.expenses!).gt(pnl.totals!.expenses!)).toBe(true);
  });

  it("hides cost of goods while contract invoices exist and the contract cost key is missing (R-STRIP-3; S4)", async () => {
    const report = await ok<BusinessReport>(PATHS.business, cookies.rpt_nocontracts!);
    expectNoMargin(report);
    // The role holds the product-cost key, so Stock on hand and Purchases still show (S5).
    expect(sectionKeys(report)).toContain("stock");
    expect(sectionKeys(report)).toContain("purchases");
  });

  it("hides stock value and purchases at order cost without the product-cost key (R-STRIP-4; S5)", async () => {
    const report = await ok<BusinessReport>(PATHS.business, cookies.rpt_nocost!);
    expect(sectionKeys(report)).not.toContain("stock");
    expect(sectionKeys(report)).not.toContain("purchases");
    expect(report.sections.some((s) => (s.note ?? "").includes("Received but not billed"))).toBe(false);
  });

  it("keeps Sales by category to revenue with the product-cost key alone (R-STRIP-5; S6)", async () => {
    const report = await ok<Report>(PATHS["sales-by-category"], cookies.rpt_costonly!);
    expect(report.columns.map((c) => c.id)).toEqual(["category", "revenue"]);
    expect(hubKeys(report).has("cost")).toBe(false);
    expect(hubKeys(report).has("margin")).toBe(false);
  });

  it("hides every cost-of-goods figure with the margin key but no product-cost key (R-STRIP-6; S17)", async () => {
    expectNoMargin(await ok<BusinessReport>(PATHS.business, cookies.rpt_nocost!));
    expectNoMarginPnl(await ok<Report>(PATHS.pnl, cookies.rpt_nocost!));
    const sales = await ok<Report>(PATHS["sales-by-category"], cookies.rpt_nocost!);
    expect(sales.columns.map((c) => c.id)).toEqual(["category", "revenue"]);
    expect([...hubKeys(sales)].sort()).toEqual(["category", "revenue"]);
  });

  it("follows the module switches: Contracts off hides cost of goods, HR off hides pay (R-MODULES-OFF; S3, S4)", async () => {
    await withModuleOff(SUMMIT_ID, "contracts", async () => {
      expectNoMargin(await ok<BusinessReport>(PATHS.business, cookies.owner!));
      const sales = await ok<Report>(PATHS["sales-by-category"], cookies.owner!);
      expect(sales.columns.map((c) => c.id)).toEqual(["category", "revenue"]);
      expectNoMarginPnl(await ok<Report>(PATHS.pnl, cookies.owner!));
    });
    await withModuleOff(SUMMIT_ID, "hr", async () => {
      const report = await ok<BusinessReport>(PATHS.business, cookies.owner!);
      expect(sectionKeys(report)).not.toContain("people");
      const summary = section(report, "summary")!;
      expect(summary.rows.find((row) => row.id === "opex")!.label).toBe("Operating expenses, excluding people costs");
      expect(summary.rows.find((row) => row.id === "net")!.label).toBe(
        "Net profit, before people costs and income tax",
      );
      expect(summary.note).toContain("People costs are left out, because your access doesn't include pay periods.");
      const pnl = await ok<Report>(PATHS.pnl, cookies.owner!);
      expect(pnl.columns.find((c) => c.id === "expenses")!.header).toBe("Expenses, excluding payroll");
      expect(pnl.columns.find((c) => c.id === "netIncome")!.header).toBe("Net income, before payroll");
    });
  });

  it("refuses queries outside the bounds in the person's words (R-RANGE; S8, S10)", async () => {
    const o = `from=${OCTOBER.from}&to=${OCTOBER.to}`;
    const business: [string, string][] = [
      ["from=2026-03-02&to=2026-03-01", M.order],
      ["from=2025-01-01&to=2026-01-02", M.tooLong],
      ["from=2026-02-30&to=2026-03-01", M.realDate],
      ["from=0000-01-01&to=0000-01-02", M.realDate],
      ["from=9999-12-30&to=9999-12-31", M.realDate],
      [`from=${OCTOBER.from}`, M.date],
      [`${o}&foo=1`, M.unknown],
      [`from=2026-10-01&from=2026-10-02&to=${OCTOBER.to}`, M.date],
      [`${o}&locationIds=abc`, M.locations],
      [`${o}&locationIds=${uuidv7()}`, M.locations],
      [`${o}&productCategory=nope`, M.productCategory],
      [`${o}&expenseCategory=payroll`, M.expenseCategory],
      [`${o}&salesRepId=x`, M.salesperson],
      [`${o}&supplierId=x`, M.vendor],
      [`${o}&companyId=${companyB.id}`, M.unknown],
    ];
    for (const [query, message] of business) {
      await refused(`/reports/business?${query}`, cookies.owner!, 400, { code: "invalid_request", message });
    }
    const hub: [string, string][] = [
      ["/reports/pnl?range=2y", M.range],
      [`/reports/sales-by-category?locationId=${places["Southgate Showroom"]}`, M.warehouse],
      ["/reports/sales-by-category?category=service", M.category],
      ["/reports/payments?method=bitcoin", M.method],
      [`/reports/payments?customer=${"x".repeat(101)}`, M.customer],
      ["/reports/options?x=1", M.unknown],
    ];
    for (const [path, message] of hub) {
      await refused(path, cookies.owner!, 400, { code: "invalid_request", message });
    }
    status(await call("/reports/business?from=2025-01-01&to=2026-01-01", cookies.owner), 200);
  });

  it("hides a switched-off report on the API (R-SWITCH; CLAUDE.md rule 13)", async () => {
    await withFeatureOff("reports.hub", async () => {
      for (const route of ROUTES) await refused(PATHS[route], cookies.owner!, 404, { code: "not_found" });
    });
    const own: Record<Exclude<Route, "options">, FeatureKey> = {
      business: "reports.business",
      pnl: "reports.pnl",
      "sales-by-category": "reports.sales-category",
      payments: "reports.payments",
    };
    for (const [route, key] of Object.entries(own) as [Exclude<Route, "options">, FeatureKey][]) {
      await withFeatureOff(key, async () => {
        for (const other of ROUTES) {
          status(await call(PATHS[other], cookies.owner), other === route ? 404 : 200);
        }
      });
    }
    await withFeatureOff("reports.business", async () => {
      const options = await ok<ReportOptions>(PATHS.options, cookies.owner!);
      expect(options.reports).toEqual(["pnl", "sales", "payments", "trial-balance"]);
      expect(options.salespeople).toEqual([]);
      expect(options.vendors).toEqual([]);
    });
  });

  it("has no route for the removed reports (R-REMOVED; S14)", async () => {
    for (const path of ["receivables-aging", "payables-aging", "tax-jurisdiction", "inventory-valuation"]) {
      status(await call(`/reports/${path}`, cookies.owner), 404);
    }
  });

  it("answers exactly what the shared calculation gives on the full record (R-EQ)", async () => {
    const full = await loadFull();
    const people = [
      { cookie: cookies.owner!, show: ALL },
      { cookie: cookies.accountant!, show: ACCOUNTANT },
      { cookie: cookies.rpt_nopay!, show: NOPAY },
    ];
    for (const period of gatePeriods()) {
      for (const filters of gateFilters(period)) {
        for (const person of people) {
          const answer = await ok<BusinessReport>(businessPath(filters), person.cookie);
          expect(answer, JSON.stringify(filters)).toEqual(expectedBusiness(full, filters, person.show));
        }
      }
    }
    const everyone = { scope: "all" as const, userId: ids.owner, branchId: null };
    for (const range of ["12m", "3m", "1m", "ytd"] as const) {
      for (const locationId of [null, places["Denver Central"]!]) {
        const hub = `range=${range}${locationId ? `&locationId=${locationId}` : ""}`;
        const pnlQuery: PnlQuery = { range, locationId };
        expect(await ok<Report>(`/reports/pnl?${hub}`, cookies.owner!)).toEqual(expectedPnl(full, pnlQuery, ALL));
        expect(await ok<Report>(`/reports/pnl?${hub}`, cookies.rpt_nopay!)).toEqual(expectedPnl(full, pnlQuery, NOPAY));
        const salesQuery: SalesByCategoryQuery = { ...pnlQuery, category: null };
        expect(await ok<Report>(`/reports/sales-by-category?${hub}`, cookies.owner!)).toEqual(
          expectedSales(full, salesQuery, () => true, true),
        );
        expect(await ok<Report>(`/reports/sales-by-category?${hub}`, cookies.manager!)).toEqual(
          expectedSales(full, salesQuery, inScope(managerScope()), true),
        );
        const paymentsQuery: PaymentsReportQuery = { ...pnlQuery, method: null, customer: "" };
        expect(await ok<Report>(`/reports/payments?${hub}`, cookies.owner!)).toEqual(
          expectedPayments(full, paymentsQuery, everyone),
        );
        expect(await ok<Report>(`/reports/payments?${hub}`, cookies.manager!)).toEqual(
          expectedPayments(full, paymentsQuery, managerScope()),
        );
      }
    }
    const filtered: PaymentsReportQuery = { range: "12m", locationId: null, method: "check", customer: "a" };
    expect(await ok<Report>("/reports/payments?method=check&customer=a", cookies.owner!)).toEqual(
      expectedPayments(full, filtered, everyone),
    );
    expect(await ok<Report>("/reports/sales-by-category?category=lvp", cookies.owner!)).toEqual(
      expectedSales(full, { range: "12m", locationId: null, category: "lvp" }, () => true, true),
    );
  });

  it("keeps a deleted product's category and a deleted employee's location (R-DELETED; critic C10)", async () => {
    const before = await ok<BusinessReport>(PATHS.business, cookies.owner!);
    const { productId, employeeId } = await summit(async (db) => {
      const [line] = await db.execute<{ product_id: string }>(
        sql`select l.product_id from invoice_lines l join invoices i on i.id = l.invoice_id
            where l.product_id is not null and l.deleted_at is null and i.deleted_at is null and i.voided_at is null
              and i.issued_at >= '2026-10-02T12:00:00Z' and i.issued_at < '2026-10-30T12:00:00Z'
            order by l.id limit 1`,
      );
      const [period] = await db.select().from(payPeriodTable).where(eq(payPeriodTable.end, "2026-10-18"));
      const lines = await db
        .select({ employeeId: payPeriodLines.employeeId })
        .from(payPeriodLines)
        .where(eq(payPeriodLines.payPeriodId, period!.id));
      const [housed] = await db
        .select({ id: employeeTable.id })
        .from(employeeTable)
        .where(
          and(
            inArray(
              employeeTable.id,
              lines.map((l) => l.employeeId),
            ),
            isNotNull(employeeTable.homeLocationId),
          ),
        )
        .limit(1);
      return { productId: line!.product_id, employeeId: housed!.id };
    });
    const now = new Date();
    await summit(async (db) => {
      await db.update(productTable).set({ deletedAt: now }).where(eq(productTable.id, productId));
      await db.update(employeeTable).set({ deletedAt: now }).where(eq(employeeTable.id, employeeId));
    });
    try {
      const after = await ok<BusinessReport>(PATHS.business, cookies.owner!);
      const withoutStock = (report: BusinessReport) => ({
        ...report,
        sections: report.sections.filter((s) => s.key !== "stock"),
      });
      expect(withoutStock(after)).toEqual(withoutStock(before));
    } finally {
      await summit(async (db) => {
        await db.update(productTable).set({ deletedAt: null }).where(eq(productTable.id, productId));
        await db.update(employeeTable).set({ deletedAt: null }).where(eq(employeeTable.id, employeeId));
      });
    }
  });

  it("caps drill lists at the latest 200 records and says how many there are (R-DRILL; S8)", async () => {
    const full = await loadFull();
    const period = { from: "2025-11-16", to: "2026-11-15" };
    const report = await ok<BusinessReport>(businessPath(filtersOf(period)), cookies.owner!);
    for (const s of report.sections) {
      for (const row of [...s.rows, ...(s.total ? [s.total] : [])]) expect(row.records.length).toBeLessThanOrEqual(200);
    }
    const counted = full.invoices.filter((i) => !i.voidedAt && i.issuedAt >= period.from && i.issuedAt <= period.to);
    expect(counted.length).toBeGreaterThan(200);
    const revenue = section(report, "summary")!.rows.find((row) => row.id === "revenue")!;
    expect(revenue.records).toHaveLength(200);
    expect(revenue.recordCount).toBe(counted.length);
    expect(revenue.records[0]!.date).toBe(
      counted
        .map((i) => i.issuedAt)
        .sort()
        .at(-1),
    );
  });

  it("keeps each company's figures to itself (R-ISO)", async () => {
    const other = await ok<BusinessReport>(PATHS.business, cookies.ownerB!);
    expect(summaryValue(other, "revenue")).toBe("0.00");
    expect(recordsOf(other)).toEqual([]);
    const full = await loadFull();
    const summitReport = await ok<BusinessReport>(PATHS.business, cookies.owner!);
    expect(summitReport).toEqual(expectedBusiness(full, filtersOf(OCTOBER), ALL));
    const text = JSON.stringify(other);
    expect(full.invoices.some((i) => text.includes(i.number))).toBe(false);
  });

  it("only reads: no audit entry and no message (R-NOAUDIT)", async () => {
    const counts = () =>
      summit(async (db) => ({
        audit: (await db.select({ n: count() }).from(auditLog))[0]!.n,
        outbox: (await db.select({ n: count() }).from(outboxMessages))[0]!.n,
      }));
    const before = await counts();
    for (const route of ROUTES) status(await call(PATHS[route], cookies.owner), 200);
    expect(await counts()).toEqual(before);
  });

  it("tells browsers and caches not to keep any report (R-CACHE; S11)", async () => {
    for (const route of ROUTES) {
      const response = await call(PATHS[route], cookies.owner);
      status(response, 200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  });

  it("reads each report in one read-only, repeatable-read snapshot (R-SNAP; S9)", async () => {
    const handle = await harness.companyDb(SUMMIT_ID);
    try {
      const rows = await readSnapshot(handle.db, (tx) =>
        tx.execute<{ iso: string; ro: string }>(
          sql`select current_setting('transaction_isolation') as iso, current_setting('transaction_read_only') as ro`,
        ),
      );
      expect([...rows]).toEqual([{ iso: "repeatable read", ro: "on" }]);
      const write = readSnapshot(handle.db, (tx) =>
        tx.execute(sql`insert into settings (id, "group", value) values (${uuidv7()}, 'reportProbe', '{}'::jsonb)`),
      );
      const error = await write.then(
        () => null,
        (caught: unknown) => caught,
      );
      const state = (error as { cause?: { code?: string }; code?: string } | null)?.cause?.code;
      expect(state ?? (error as { code?: string } | null)?.code).toBe("25006");
    } finally {
      await handle.close();
    }
  });

  // Runs last: it removes and restores a location (Vitest runs a file's tests in order).
  it("adds location profits up to company profit, whatever the period, filters or access (R-GATE; week 18)", async () => {
    for (const period of gatePeriods()) {
      for (const filters of gateFilters(period)) {
        for (const cookie of [cookies.owner!, cookies.rpt_nopay!]) {
          expectGate(await ok<BusinessReport>(businessPath(filters), cookie), JSON.stringify(filters));
        }
      }
    }
    const southgate = places["Southgate Showroom"]!;
    await summit((db) =>
      db.update(locationTable).set({ deletedAt: new Date() }).where(eq(locationTable.id, southgate)),
    );
    try {
      const full = await loadFull();
      for (const period of gatePeriods()) {
        for (const cookie of [cookies.owner!, cookies.rpt_nopay!]) {
          const report = await ok<BusinessReport>(businessPath(filtersOf(period)), cookie);
          expectGate(report, `${period.from} without Southgate`);
          const picked = filtersOf(period, {
            locationIds: [places["Denver Central"]!, places["Summit Design Studio"]!],
          });
          expectGate(await ok<BusinessReport>(businessPath(picked), cookie), `${period.from} picked`);
        }
      }
      const october = await ok<BusinessReport>(PATHS.business, cookies.owner!);
      const removed = section(october, "locations")!.rows.find((row) => row.label === "Removed location");
      expect(removed).toBeDefined();
      expect(removed!.records.some((record) => record.label === edge.creditNote)).toBe(true);
      expect(october).toEqual(expectedBusiness(full, filtersOf(OCTOBER), ALL));
      await refused(businessPath(filtersOf(OCTOBER, { locationIds: [southgate] })), cookies.owner!, 400, {
        code: "invalid_request",
        message: M.locations,
      });
    } finally {
      await summit((db) => db.update(locationTable).set({ deletedAt: null }).where(eq(locationTable.id, southgate)));
    }
  });
  it("gives Profit and loss the Business report's profit for a month, a quarter, the year and a custom range (R-PROFIT; ADR 0061 decision 2)", async () => {
    const months = last12Months(today());
    const year = months.filter((m) => m.startsWith(today().slice(0, 4)));
    const spans = [
      { name: "October 2026", months: months.filter((m) => m === "2026-10") },
      { name: "last month", months: months.slice(-2, -1) },
      { name: "the last full quarter", months: months.slice(-4, -1) },
      { name: "year to date", months: year },
      { name: "a custom range of months", months: months.slice(1, 6) },
      { name: "the last 12 months", months },
    ].filter((span) => span.months.length > 0);
    const fixed = (value: string | undefined) => dec(value!).toFixed(2);
    const fromBusiness = (report: BusinessReport) => ({
      revenue: fixed(summaryValue(report, "revenue")),
      cogs: fixed(summaryValue(report, "cogs")),
      gross: fixed(summaryValue(report, "gross")),
      opex: fixed(summaryValue(report, "opex")),
      net: fixed(summaryValue(report, "net")),
    });
    const fromPnl = (rows: readonly Record<string, string>[]) => {
      const add = (id: string) => sum(rows.map((row) => row[id]!)).toFixed(2);
      return {
        revenue: add("revenue"),
        cogs: add("cogs"),
        gross: add("grossMargin"),
        opex: add("expenses"),
        net: add("netIncome"),
      };
    };
    const people = [
      { name: "Owner", cookie: cookies.owner! },
      { name: "Accountant", cookie: cookies.accountant! },
      { name: "no pay sight", cookie: cookies.rpt_nopay! },
    ];
    // P&L's one filter is a warehouse; it stands for the Business report with that location ticked.
    // P&L has no product category, expense category, salesperson or vendor filter (it refuses them).
    for (const locationId of [null, places["Denver Central"]!]) {
      const where = locationId ? `&locationId=${locationId}` : "";
      for (const person of people) {
        const pnl = await ok<Report>(`/reports/pnl?range=12m${where}`, person.cookie);
        for (const span of spans) {
          const period = { from: `${span.months[0]}-01`, to: monthEnd(span.months.at(-1)!) };
          const filters = filtersOf(period, { locationIds: locationId ? [locationId] : [] });
          const business = await ok<BusinessReport>(businessPath(filters), person.cookie);
          const rows = pnl.rows.filter((row) => span.months.includes(row.month!));
          expect(fromPnl(rows), `${person.name}, ${span.name}, ${locationId ?? "all"}`).toEqual(fromBusiness(business));
        }
        for (const range of ["3m", "ytd"] as const) {
          const preset = await ok<Report>(`/reports/pnl?range=${range}${where}`, person.cookie);
          const first = preset.rows[0]!.month!;
          const last = preset.rows.at(-1)!.month!;
          const filters = filtersOf(
            { from: `${first}-01`, to: monthEnd(last) },
            { locationIds: locationId ? [locationId] : [] },
          );
          const business = await ok<BusinessReport>(businessPath(filters), person.cookie);
          expect(fromPnl([preset.totals!]), `${person.name}, ${range} total`).toEqual(fromBusiness(business));
        }
      }
    }
    // Finding #39: October's expenses are the Business report's operating expenses, people costs included.
    const october = await ok<BusinessReport>(PATHS.business, cookies.owner!);
    const pnl = await ok<Report>("/reports/pnl?range=12m", cookies.owner!);
    const row = pnl.rows.find((r) => r.month === "2026-10");
    if (row) {
      const peopleCosts = section(october, "people")!.rows.find((r) => r.id === "pay")!.values.amount!;
      expect(fixed(row.expenses)).toBe(fixed(summaryValue(october, "opex")));
      expect(dec(row.expenses!).gte(peopleCosts)).toBe(true);
      expect(fixed(row.netIncome)).toBe(fixed(summaryValue(october, "net")));
    }
    for (const param of [
      "expenseCategory=rent",
      `supplierId=${vendorId}`,
      "productCategory=carpet",
      `salesRepId=${ids.sales}`,
    ]) {
      await refused(`/reports/pnl?${param}`, cookies.owner!, 400, { code: "invalid_request", message: M.unknown });
    }
  });
});
