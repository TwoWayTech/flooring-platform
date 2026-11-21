import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDays,
  businessReport,
  capDrillRecords,
  dec,
  EMPTY_REPORT_OPTIONS,
  REPORT_QUERY_MESSAGES,
  REPORT_WHOLE_COMPANY,
  reportVisibility,
  salesByCategoryReport,
  type BusinessFilters,
  type BusinessReport,
  type CompanyFixtures,
  type FeatureKey,
  type FeatureRegister,
  type Report,
} from "@workspace/shared";
import { viewerAccess } from "@/lib/access";
import { CompanyDb } from "@/lib/api/demo/company-db";
import type { FileStore } from "@/lib/api/demo/file-store";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";
import { demoPaymentsReport, demoSalesByCategoryReport, type ReportViewer } from "@/lib/api/demo/report-actions";
import { scopeSubject } from "@/lib/api/demo/scope";
import { DemoStore } from "@/lib/api/demo/store";

/** Switches these tests turn off; every other one keeps its real value. */
const OFF = vi.hoisted(() => new Set<string>());
vi.mock("@workspace/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/shared")>();
  return {
    ...real,
    featureOn: (key: FeatureKey, register?: FeatureRegister) => (OFF.has(key) ? false : real.featureOn(key, register)),
  };
});

afterEach(() => OFF.clear());

/** Summit personas (fixtures): Owner, branch Manager (Denver), own-scope Sales, Accountant, Employee, Purchasing. */
const OWNER = "sm-usr-01";
const MANAGER = "sm-usr-02";
const SALES = "sm-usr-03";
const ACCOUNTANT = "sm-usr-06";
const EMPLOYEE = "sm-usr-14";
const PURCHASING = "sm-usr-15";
/** Two more Summit reps, moved in the scope tests below. */
const EVAN = "sm-usr-08";
const NADIA = "sm-usr-09";
const SHOWROOM = "sm-loc-southgate";
const NO_KEY = "Your role does not allow this. Ask an Owner to change your security role.";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** A fresh demo store with Summit open for one person (each test starts from the fixtures). */
async function summit(userId = OWNER, viewAsRoleId: string | null = null): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId, viewAsRoleId });
  return store;
}

/** The refusal an action gives, or "" when it was allowed. */
async function refusal(action: Promise<unknown>): Promise<string> {
  try {
    await action;
    return "";
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure);
  }
}

/** The last 90 days to the demo's today, with no filter. */
function quarter(store: DemoStore, over: Partial<BusinessFilters> = {}): BusinessFilters {
  const today = store.today();
  return {
    from: addDays(today, -89),
    to: today,
    locationIds: [],
    productCategory: null,
    expenseCategory: null,
    salesRepId: null,
    supplierId: null,
    ...over,
  };
}

/** Every key of every object in a value, at any depth. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, into));
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysOf(inner, into);
    }
  }
  return into;
}

const sectionKeys = (report: BusinessReport) => report.sections.map((s) => s.key);
const summaryRow = (report: BusinessReport, id: string) =>
  report.sections.find((s) => s.key === "summary")!.rows.find((r) => r.id === id);

describe("reports in the demo follow the API's rules (ADR 0055 S16)", () => {
  it("W-DEMO-1 offers each role the reports the API would, with the pickers only for the Business report", async () => {
    const owner = await summit(OWNER);
    const options = await owner.reportOptions();
    expect(options.reports).toEqual(["business", "pnl", "sales", "payments"]);
    expect(options.exports).toEqual(["business", "pnl", "sales", "payments"]);
    expect(options.locations.map((l) => l.name)).toEqual([
      "Denver Central",
      "Colorado Springs",
      "Summit Design Studio",
      "Southgate Showroom",
    ]);
    expect(options.salespeople.map((p) => p.name)).toEqual(["Evan Shaw", "Nadia Petrov", "Priya Natarajan"]);
    expect(options.vendors.length).toBe((await owner.list("suppliers")).length);
    const names = options.vendors.map((v) => v.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));

    const manager = await summit(MANAGER);
    expect(await manager.reportOptions()).toEqual({
      ...options,
      reports: ["sales", "payments"],
      exports: ["sales"],
      salespeople: [],
      vendors: [],
    });
    const sales = await summit(SALES);
    expect(await sales.reportOptions()).toMatchObject({
      reports: ["sales"],
      exports: [],
      salespeople: [],
      vendors: [],
    });
  });

  it("W-DEMO-1 refuses the Business report and P&L to a branch Manager, signed in or viewed as", async () => {
    for (const store of [await summit(MANAGER), await summit(OWNER, "sm-role-manager")]) {
      expect(await refusal(store.businessReport(quarter(store)))).toBe(REPORT_WHOLE_COMPANY);
      expect(await refusal(store.pnlReport({ range: "12m", locationId: null }))).toBe(REPORT_WHOLE_COMPANY);
      expect(await refusal(store.salesByCategoryReport({ range: "12m", locationId: null, category: null }))).toBe("");
      expect((await store.reportOptions()).reports).toEqual(["sales", "payments"]);
    }
  });

  it("W-DEMO-1 gives a person with no report key no reports rather than an error, and refuses the reports themselves", async () => {
    for (const userId of [EMPLOYEE, PURCHASING]) {
      const store = await summit(userId);
      expect(await store.reportOptions()).toEqual(EMPTY_REPORT_OPTIONS);
      expect(await refusal(store.businessReport(quarter(store)))).toBe(NO_KEY);
      expect(await refusal(store.salesByCategoryReport({ range: "12m", locationId: null, category: null }))).toBe(
        NO_KEY,
      );
      expect(await refusal(store.paymentsReport({ range: "12m", locationId: null, method: null, customer: "" }))).toBe(
        NO_KEY,
      );
    }
  });

  it("W-DEMO-2 gives the Owner exactly the shared calculation over the company's records, capped", async () => {
    const store = await summit(OWNER);
    const [company, roles, users] = await Promise.all([store.getCompany(), store.list("roles"), store.list("users")]);
    const access = viewerAccess(
      company,
      roles,
      users.find((u) => u.id === OWNER)!,
      null,
    );
    const invoices = await store.list("invoices");
    const products = await store.list("products");
    const filters = quarter(store);
    const expected = capDrillRecords(
      businessReport(
        {
          invoices,
          payments: await store.list("payments"),
          adjustments: await store.list("invoiceAdjustments"),
          refunds: await store.list("refunds"),
          expenses: await store.list("expenses"),
          bills: await store.list("bills"),
          supplierPayments: await store.list("supplierPayments"),
          receipts: await store.list("receipts"),
          purchaseOrders: await store.list("purchaseOrders"),
          suppliers: await store.list("suppliers"),
          users,
          employees: await store.list("employees"),
          locations: await store.list("locations"),
          productCategories: products,
          products,
          rolls: await store.list("rolls"),
          stockMovements: await store.list("stockMovements"),
          payPeriods: await store.list("payPeriods"),
          settings: await store.getSettings(),
          today: store.today(),
        },
        filters,
        reportVisibility(access, { hasContractInvoices: invoices.some((i) => !!i.contractId) }),
      ),
    );
    const report = await store.businessReport(filters);
    expect(report).toEqual(expected);
    expect(sectionKeys(report)).toContain("people");
    expect(sectionKeys(report)).toContain("locations");
  });

  it("W-DEMO-2 shows the Accountant no People costs, with the same operating expenses as the Owner", async () => {
    const owner = await summit(OWNER);
    const accountant = await summit(ACCOUNTANT);
    const mine = await owner.businessReport(quarter(owner));
    const theirs = await accountant.businessReport(quarter(accountant));
    expect(sectionKeys(theirs)).not.toContain("people");
    expect(summaryRow(theirs, "opex")?.values).toEqual(summaryRow(mine, "opex")?.values);
    expect(summaryRow(theirs, "opex")?.label).toBe(summaryRow(mine, "opex")?.label);
  });

  it("W-DEMO-3 gives Sales their own invoices only, with no cost or margin anywhere", async () => {
    const owner = await summit(OWNER);
    const priya = await summit(SALES);
    const query = { range: "12m" as const, locationId: null, category: null };
    const report = await priya.salesByCategoryReport(query);
    expect(report.columns.map((c) => c.id)).toEqual(["category", "revenue"]);
    expect([...keysOf(report)].filter((key) => key === "cost" || key === "margin")).toEqual([]);
    const hers = (await owner.list("invoices")).filter((i) => i.salesRepId === SALES);
    const expected = salesByCategoryReport(
      query,
      { today: priya.today(), invoices: hers, products: await owner.list("products") },
      { margin: false },
    );
    expect(report).toEqual(expected);
    const everyone = await owner.salesByCategoryReport(query);
    expect(dec(report.totals!.revenue!).lessThan(everyone.totals!.revenue!)).toBe(true);
  });

  it("W-DEMO-3 narrows a Manager's reports to invoices on their branch or their own, and customers to theirs", async () => {
    // Nadia's invoices move to the Springs branch and Evan moves there himself, so the Denver
    // Manager loses Nadia's invoices and Evan's customers' names but keeps Evan's Denver invoices.
    const fixtures = await loadCompanyFixtures("summit");
    const owner = await summit(OWNER);
    const moved: CompanyFixtures = {
      ...fixtures,
      users: fixtures.users.map((u) => (u.id === EVAN ? { ...u, branchId: "sm-br-springs" } : u)),
      invoices: fixtures.invoices.map((i) => (i.salesRepId === NADIA ? { ...i, branchId: "sm-br-springs" } : i)),
    };
    const db = new CompanyDb(moved, owner.today());
    const [company, roles] = await Promise.all([owner.getCompany(), owner.list("roles")]);
    const viewerOf = (userId: string): ReportViewer => {
      const self = db.get("users", userId)!;
      return {
        access: viewerAccess(company, roles, self, null),
        subject: scopeSubject(db, { userId, viewAsRoleId: null }),
        today: owner.today(),
      };
    };
    const query = { range: "12m" as const, locationId: null, method: null, customer: "" };

    const all = demoPaymentsReport(db, viewerOf(OWNER), query);
    const branch = demoPaymentsReport(db, viewerOf(MANAGER), query);
    const payments = new Map(db.list("payments").map((p) => [p.number, p]));
    const invoiceOf = (row: Report["rows"][number]) => db.get("invoices", payments.get(row.number!)!.invoiceId)!;
    expect(branch.rows.length).toBeGreaterThan(0);
    expect(branch.rows.length).toBeLessThan(all.rows.length);
    for (const row of branch.rows) {
      const invoice = invoiceOf(row);
      expect(invoice.branchId === "sm-br-denver" || invoice.salesRepId === MANAGER).toBe(true);
    }
    const customers = new Map(db.list("customers").map((c) => [c.id, c]));
    const evansRows = branch.rows.filter((row) => customers.get(invoiceOf(row).customerId)?.salesRepId === EVAN);
    expect(evansRows.length).toBeGreaterThan(0);
    expect(evansRows.every((row) => row.customer === "")).toBe(true);
    expect(branch.rows.some((row) => row.customer !== "")).toBe(true);

    const sales = demoSalesByCategoryReport(db, viewerOf(MANAGER), { ...query, category: null });
    const visible = db.list("invoices").filter((i) => i.branchId === "sm-br-denver");
    expect(sales).toEqual(
      salesByCategoryReport(
        { ...query, category: null },
        { today: owner.today(), invoices: visible, products: db.list("products") },
        reportVisibility(viewerOf(MANAGER).access, {
          hasContractInvoices: db.list("invoices").some((i) => !!i.contractId),
        }),
      ),
    );
  });

  it("W-DEMO-4 refuses a period or filter the API would refuse, in the API's words", async () => {
    const store = await summit(OWNER);
    const today = store.today();
    expect(await refusal(store.businessReport(quarter(store, { from: addDays(today, -366) })))).toBe(
      "Choose a period of 366 days or less.",
    );
    expect(await refusal(store.businessReport(quarter(store, { from: addDays(today, -365) })))).toBe("");
    expect(await refusal(store.businessReport(quarter(store, { from: "0000-01-01" })))).toBe("Enter a real date.");
    expect(await refusal(store.businessReport(quarter(store, { to: "2026-02-30" })))).toBe("Enter a real date.");
    expect(await refusal(store.businessReport(quarter(store, { from: today, to: addDays(today, -1) })))).toBe(
      REPORT_QUERY_MESSAGES.order,
    );
    expect(await refusal(store.businessReport(quarter(store, { locationIds: ["sm-loc-nowhere"] })))).toBe(
      REPORT_QUERY_MESSAGES.locations,
    );
    // Profit and loss takes any live location, showrooms too; the other hub reports only warehouses.
    expect(await refusal(store.pnlReport({ range: "12m", locationId: SHOWROOM }))).toBe("");
    expect(await refusal(store.pnlReport({ range: "12m", locationId: "sm-loc-nowhere" }))).toBe(
      REPORT_QUERY_MESSAGES.location,
    );
    expect(await refusal(store.salesByCategoryReport({ range: "12m", locationId: SHOWROOM, category: null }))).toBe(
      REPORT_QUERY_MESSAGES.warehouse,
    );
    expect(
      await refusal(store.paymentsReport({ range: "12m", locationId: null, method: null, customer: "x".repeat(101) })),
    ).toBe(REPORT_QUERY_MESSAGES.customer);
  });

  it("W-DEMO-5 hides a switched-off report as the API does: no options with the hub off, and the report refused", async () => {
    const store = await summit(OWNER);
    OFF.add("reports.business");
    const options = await store.reportOptions();
    expect(options.reports).toEqual(["pnl", "sales", "payments"]);
    expect({ salespeople: options.salespeople, vendors: options.vendors }).toEqual({ salespeople: [], vendors: [] });
    expect(await refusal(store.businessReport(quarter(store)))).toBe("This report is switched off.");
    expect(await refusal(store.pnlReport({ range: "12m", locationId: null }))).toBe("");
    OFF.add("reports.hub");
    expect(await store.reportOptions()).toEqual(EMPTY_REPORT_OPTIONS);
    expect(await refusal(store.pnlReport({ range: "12m", locationId: null }))).toBe("This report is switched off.");
  });
});
