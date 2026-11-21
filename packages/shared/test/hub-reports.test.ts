import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dec,
  paymentsReport,
  pnlReport,
  salesByCategoryReport,
  sum,
  type CompanyFixtures,
  type Expense,
  type HubReportData,
  type PnlData,
  type Payment,
  type PaymentsReportQuery,
  type Report,
} from "../src";
import { businessDataOf } from "./report-fixtures";

const summit = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/summit.json", import.meta.url)), "utf8"),
) as CompanyFixtures;
const data: HubReportData = {
  today: summit.anchorDate,
  invoices: summit.invoices,
  products: summit.products,
  payments: summit.payments,
  customers: summit.customers,
};
const all = { margin: true, payroll: true };
/** What Profit and loss reads: the profit calculation's documents (ADR 0061 decision 2). */
const pnlData: PnlData = businessDataOf(summit);
const DENVER = "sm-loc-denver";
const SPRINGS = "sm-loc-springs";
const keysOf = (report: Report) => [
  ...new Set([...report.rows.flatMap((r) => Object.keys(r)), ...Object.keys(report.totals ?? {})]),
];
const payments = (query: Partial<PaymentsReportQuery>, d: HubReportData = data) =>
  paymentsReport({ range: "12m", locationId: null, method: null, customer: "", ...query }, d);

// Golden values: the web builders in apps/web/src/features/reports/report-model.ts at e6b37ea, run on
// the Summit fixtures with the page's own rule 24 filters, today = the fixtures' anchor (2026-11-04).
describe("the hub reports moved to shared give the web's old output (S-HUB-1)", () => {
  it("Profit and loss keeps its shape and its revenue (ADR 0061 decision 2 changed expenses and net)", () => {
    const year = pnlReport({ range: "12m", locationId: null }, pnlData, all);
    expect(year.totals!.revenue).toBe("2006976.46");
    expect(year.totals!.cogs).toBe("1184202.02");
    const recent = pnlReport({ range: "3m", locationId: null }, pnlData, all);
    expect(recent.rows.map((r) => [r.month, r.revenue, r.cogs, r.grossMarginPct])).toEqual([
      ["2026-09", "304385.84", "180214.72", "40.79398700018371419642911116"],
      ["2026-10", "395894.37", "236492.13", "40.26383098097606187226153279"],
      ["2026-11", "19963.55", "11123.09", "44.28300577803046051428728858"],
    ]);
    expect(recent.rows[0]!.month).toBe("2026-09");
    expect(recent.columns[0]).toEqual({ id: "month", header: "Month", format: "month" });
  });

  it("Sales by category", () => {
    const report = salesByCategoryReport({ range: "12m", locationId: null, category: null }, data, all);
    expect(report.rows.map((r) => [r.category, r.revenue, r.cost, r.margin])).toEqual([
      ["Carpet", "609193.75", "365380.80", "243812.95"],
      ["Installation labor", "390470.90", "217804.28", "172666.62"],
      ["LVP and LVT", "384989.13", "231205.98", "153783.15"],
      ["Porcelain tile", "169642.40", "99534.58", "70107.82"],
      ["Solid hardwood", "110213.40", "64844.00", "45369.40"],
      ["Engineered hardwood", "79819.84", "48799.73", "31020.11"],
      ["Carpet tile", "74722.56", "42267.84", "32454.72"],
      ["Laminate", "74208.47", "45695.64", "28512.83"],
      ["Materials", "69000.00", "42780.00", "26220.00"],
      ["Pad and underlayment", "27129.33", "16505.46", "10623.87"],
      ["Services", "8645.00", "3990.00", "4655.00"],
      ["Adhesives and trims", "7611.68", "4623.71", "2987.97"],
      ["Freight and delivery", "1330.00", "770.00", "560.00"],
    ]);
    expect(report.totals).toEqual({
      category: "Total",
      revenue: "2006976.46",
      cost: "1184202.02",
      margin: "822774.44",
    });
    const carpet = salesByCategoryReport({ range: "ytd", locationId: DENVER, category: "carpet" }, data, all);
    expect(carpet.rows).toEqual([{ category: "Carpet", revenue: "583846.86", cost: "349604.99", margin: "234241.87" }]);
    expect(carpet.totals).toEqual({ category: "Total", revenue: "583846.86", cost: "349604.99", margin: "234241.87" });
  });

  it("Payments received", () => {
    const year = payments({});
    expect(year.rows).toHaveLength(341);
    expect(year.totals).toEqual({ date: "Total", amount: "1884512.85" });
    const checks = payments({ range: "3m", locationId: DENVER, method: "check" });
    expect(checks.rows).toHaveLength(14);
    expect(checks.totals).toEqual({ date: "Total", amount: "208583.3" });
    expect(payments({ customer: "  CON " }).rows).toHaveLength(8);
    expect(year.columns[0]).toEqual({ id: "date", header: "Date", format: "date" });
    expect(year.rows[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("hidden columns are absent, not blank (ADR 0055 S6, S18, S-HUB-2)", () => {
  it("Sales by category without margin has no cost or margin anywhere", () => {
    const report = salesByCategoryReport({ range: "12m", locationId: null, category: null }, data, {
      margin: false,
    });
    expect(report.columns.map((c) => c.id)).toEqual(["category", "revenue"]);
    expect(keysOf(report).sort()).toEqual(["category", "revenue"]);
    expect(report.totals).toEqual({ category: "Total", revenue: "2006976.46" });
  });

  it("Profit and loss without margin shows month, revenue and expenses only", () => {
    const report = pnlReport({ range: "12m", locationId: null }, pnlData, { margin: false, payroll: true });
    expect(report.columns.map((c) => c.id)).toEqual(["month", "revenue", "expenses"]);
    expect(keysOf(report).sort()).toEqual(["expenses", "month", "revenue"]);
    const full = pnlReport({ range: "12m", locationId: null }, pnlData, all);
    expect(report.totals).toEqual({ month: "Total", revenue: "2006976.46", expenses: full.totals!.expenses });
  });
});

describe("pay is left out of the P&L without pay sight (ADR 0055 S3, S-HUB-3)", () => {
  // August has no HR pay period, so its payroll expense is its people cost (rule 7).
  const extra: Expense = {
    ...summit.expenses.find((e) => e.category === "payroll" && e.status === "confirmed")!,
    id: "extra-payroll",
    date: "2026-08-20",
    amount: "1000.00",
    tax: "0.00",
  };
  const withExtra = { ...pnlData, expenses: [...pnlData.expenses, extra] };
  const august = (report: Report) => report.rows.find((r) => r.month === "2026-08")!;
  const october = (report: Report) => report.rows.find((r) => r.month === "2026-10")!;
  const noPay = { margin: true, payroll: false };

  it("ignores payroll expenses and pay periods and says so in the headers", () => {
    const report = pnlReport({ range: "ytd", locationId: null }, withExtra, noPay);
    const stripped = { ...pnlData, expenses: pnlData.expenses.filter((e) => e.category !== "payroll"), payPeriods: [] };
    expect(report).toEqual(pnlReport({ range: "ytd", locationId: null }, stripped, noPay));
    expect(report.columns.find((c) => c.id === "expenses")!.header).toBe("Expenses, excluding payroll");
    expect(report.columns.find((c) => c.id === "netIncome")!.header).toBe("Net income, before payroll");
    const seeded = pnlReport({ range: "ytd", locationId: null }, pnlData, all);
    expect(dec(october(report).expenses!).lt(october(seeded).expenses!)).toBe(true);
    expect(dec(august(report).expenses!).lt(august(seeded).expenses!)).toBe(true);
  });

  it("counts a payroll expense with its tax in a month without HR pay, with pay sight", () => {
    const before = august(pnlReport({ range: "ytd", locationId: null }, pnlData, all)).expenses!;
    const after = pnlReport({ range: "ytd", locationId: null }, withExtra, all);
    expect(dec(august(after).expenses!).minus(before).toFixed(2)).toBe("1000.00");
    expect(after.columns.find((c) => c.id === "expenses")!.header).toBe("Expenses");
    expect(after.columns.find((c) => c.id === "netIncome")!.header).toBe("Net income");
  });

  it("counts HR gross pay instead of the payroll expense in a month with an approved or exported pay period (rule 7)", () => {
    const octoberExtra = { ...extra, id: "october-payroll", date: "2026-10-20" };
    const before = october(pnlReport({ range: "ytd", locationId: null }, pnlData, all)).expenses!;
    const after = pnlReport(
      { range: "ytd", locationId: null },
      { ...pnlData, expenses: [...pnlData.expenses, octoberExtra] },
      all,
    );
    expect(october(after).expenses).toBe(before);
  });
});

describe("Payments received filters (spec rule 24, S-HUB-4)", () => {
  const old = summit.invoices.find((i) => i.issuedAt < "2026-01-01" && !i.voidedAt)!;
  const base = summit.payments.find((p) => p.status === "confirmed")!;
  const late: Payment = { ...base, id: "late", number: "PAY-LATE", invoiceId: old.id, date: summit.anchorDate };
  const springsInvoice = { ...old, id: "springs-invoice", number: "INV-SPRINGS", locationId: SPRINGS };
  const springsPayment: Payment = {
    ...base,
    id: "springs",
    number: "PAY-SPRINGS",
    invoiceId: springsInvoice.id,
    date: summit.anchorDate,
  };
  const more = {
    ...data,
    invoices: [...data.invoices, springsInvoice],
    payments: [...data.payments, late, springsPayment],
  };

  it("names the invoice of a payment even when it was issued before the dates", () => {
    const row = payments({ range: "1m" }, more).rows.find((r) => r.number === "PAY-LATE")!;
    expect(row.invoice).toBe(old.number);
  });

  it("takes the warehouse from the payment's invoice", () => {
    expect(payments({ range: "1m", locationId: SPRINGS }, more).rows.map((r) => r.number)).toEqual(["PAY-SPRINGS"]);
    expect(payments({ range: "1m", locationId: DENVER }, more).rows.map((r) => r.number)).not.toContain("PAY-SPRINGS");
  });

  it("matches the method exactly and part of the customer's name, ignoring case", () => {
    const checks = payments({ method: "check" });
    expect(checks.rows.length).toBeGreaterThan(0);
    for (const r of checks.rows) expect(r.method).toBe("Check");
    const named = payments({ customer: "  CON " });
    for (const r of named.rows) expect(r.customer.toLowerCase()).toContain("con");
  });

  it("reads an empty name for a customer the viewer may not see", () => {
    const report = payments({}, { ...data, customers: [] });
    expect(report.rows.every((r) => r.customer === "")).toBe(true);
    expect(payments({ customer: "con" }, { ...data, customers: [] }).rows).toEqual([]);
  });

  it("totals the rows and keeps only confirmed payments, by date then number", () => {
    const report = payments({});
    expect(report.totals!.amount).toBe(sum(report.rows.map((r) => r.amount!)).toString());
    const confirmed = summit.payments.filter(
      (p) => p.status === "confirmed" && p.date >= "2025-12-01" && p.date <= summit.anchorDate,
    );
    expect(report.rows).toHaveLength(confirmed.length);
    const order = report.rows.map((r) => `${r.date} ${r.number}`);
    expect(order).toEqual([...order].sort());
  });
});
