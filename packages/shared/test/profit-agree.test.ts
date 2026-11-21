import { describe, expect, it } from "vitest";
import {
  businessReport,
  dec,
  last12Months,
  monthEnd,
  NO_PROFIT_FILTERS,
  periodProfit,
  pnlReport,
  type BusinessData,
  type BusinessFilters,
  type BusinessInvoice,
  type BusinessVisibility,
  type Profit,
  type ProfitData,
  type ProfitFilters,
  type Report,
  type ReportRange,
} from "../src";
import { businessDataOf, loadFixtures, summaryValue } from "./report-fixtures";

const PAY: BusinessVisibility = { margin: true, payroll: true, people: true, stock: true };
const NO_PAY: BusinessVisibility = { ...PAY, payroll: false, people: false };

/** A profit as the decimal strings both reports print. */
const asText = (p: Profit) => ({
  revenue: p.revenue.toFixed(2),
  cost: p.cost.toFixed(2),
  gross: p.gross.toFixed(2),
  opex: p.opex.toFixed(2),
  net: p.net.toFixed(2),
});

/** The Business report's Summary profit, in the same five figures. */
function businessProfit(data: BusinessData, filters: BusinessFilters, show: BusinessVisibility) {
  const report = businessReport(data, filters, show);
  const value = (id: string) => dec(summaryValue(report, id)!).toFixed(2);
  return {
    revenue: value("revenue"),
    cost: value("cogs"),
    gross: value("gross"),
    opex: value("opex"),
    net: value("net"),
  };
}

/** A P&L row or total, in the same five figures. */
const pnlProfit = (row: Report["rows"][number]) => ({
  revenue: dec(row.revenue!).toFixed(2),
  cost: dec(row.cogs!).toFixed(2),
  gross: dec(row.grossMargin!).toFixed(2),
  opex: dec(row.expenses!).toFixed(2),
  net: dec(row.netIncome!).toFixed(2),
});

describe.each(["summit", "keystone"] as const)(
  "%s: the Business report and P&L give one profit (ADR 0061 decision 2)",
  (name) => {
    const data = businessDataOf(loadFixtures(name));
    const locations = data.locations.map((l) => l.id);
    const periods = [
      { from: "2026-10-01", to: "2026-10-31" },
      { from: "2026-07-01", to: "2026-09-30" },
      { from: "2026-01-01", to: data.today },
      { from: "2025-12-15", to: "2026-02-10" },
    ];
    const filterSets: ProfitFilters[] = [
      NO_PROFIT_FILTERS,
      { ...NO_PROFIT_FILTERS, locationIds: locations.slice(0, 1) },
      { ...NO_PROFIT_FILTERS, locationIds: locations.slice(1, 3) },
      { ...NO_PROFIT_FILTERS, productCategory: "carpet" },
      { ...NO_PROFIT_FILTERS, expenseCategory: "rent" },
      { ...NO_PROFIT_FILTERS, supplierId: data.expenses.find((e) => e.supplierId)?.supplierId ?? null },
    ];

    it("periodProfit is the Business report's Summary, for every period, filter and pay sight", () => {
      for (const period of periods) {
        for (const filters of filterSets) {
          for (const show of [PAY, NO_PAY]) {
            const where = `${JSON.stringify(period)} ${JSON.stringify(filters)} payroll ${show.payroll}`;
            expect(asText(periodProfit(data, filters, period, show)), where).toEqual(
              businessProfit(data, { ...period, ...filters }, show),
            );
          }
        }
      }
    });

    it("each P&L month is the Business report for that whole month, and the total is the whole range", () => {
      const ranges: ReportRange[] = ["12m", "3m", "1m", "ytd"];
      for (const range of ranges) {
        for (const locationId of [null, ...locations]) {
          for (const show of [PAY, NO_PAY]) {
            const where = `${range} ${locationId} payroll ${show.payroll}`;
            const report = pnlReport({ range, locationId }, data, show);
            const filters = { ...NO_PROFIT_FILTERS, locationIds: locationId ? [locationId] : [] };
            for (const row of report.rows) {
              const month = { from: `${row.month}-01`, to: monthEnd(row.month!) };
              expect(pnlProfit(row), `${where} ${row.month}`).toEqual(
                businessProfit(data, { ...month, ...filters }, show),
              );
            }
            const first = report.rows[0]!.month!;
            const last = report.rows.at(-1)!.month!;
            const whole = { from: `${first}-01`, to: monthEnd(last) };
            expect(pnlProfit(report.totals!), where).toEqual(asText(periodProfit(data, filters, whole, show)));
          }
        }
      }
    });

    it("the P&L's months are the last 12 calendar months", () => {
      const report = pnlReport({ range: "12m", locationId: null }, data, PAY);
      expect(report.rows.map((r) => r.month)).toEqual(last12Months(data.today));
    });
  },
);

describe("periodProfit follows the Business report's rules 5 to 9 (reports.md)", () => {
  const MONTH = { from: "2026-03-01", to: "2026-03-31" };
  const SHOWROOM = "loc-s";
  const WAREHOUSE = "loc-w";
  const invoice = (over: Partial<BusinessInvoice>): BusinessInvoice => ({
    id: "inv-1",
    number: "INV-1",
    salesRepId: "rep-1",
    locationId: WAREHOUSE,
    soldAtLocationId: SHOWROOM,
    issuedAt: "2026-03-10",
    dueAt: "2026-04-10",
    voidedAt: null,
    isReturn: false,
    depositPct: "0",
    subtotal: "1000.00",
    tax: "0.00",
    total: "1000.00",
    cost: "600.00",
    lines: [{ productId: undefined, category: "material", quantity: "10", unitPrice: "100.00", unitCost: "60.00" }],
    ...over,
  });
  const expense = (over: Partial<BusinessData["expenses"][number]>): BusinessData["expenses"][number] => ({
    id: "exp-1",
    number: "EXP-1",
    date: "2026-03-05",
    supplierId: null,
    category: "rent",
    locationId: SHOWROOM,
    amount: "100.00",
    tax: "8.00",
    status: "confirmed",
    settlement: "paid",
    ...over,
  });
  const base: ProfitData = {
    invoices: [invoice({})],
    expenses: [],
    adjustments: [],
    payPeriods: [],
    employees: [{ id: "emp-1", name: "Ada Lane", homeLocationId: SHOWROOM }],
    locations: [
      { id: SHOWROOM, name: "Showroom", kind: "showroom" },
      { id: WAREHOUSE, name: "Warehouse", kind: "warehouse" },
    ],
    productCategories: [],
    settings: { sharedCosts: { rule: "revenue", fixedPct: {} } },
  };
  const profit = (over: Partial<ProfitData>, filters = NO_PROFIT_FILTERS, payroll = true) =>
    asText(periodProfit({ ...base, ...over }, filters, MONTH, { payroll }));

  it("takes revenue and cost from the lines, a return subtracting, a void left out", () => {
    const invoices = [
      invoice({}),
      invoice({ id: "ret", isReturn: true, lines: [{ ...invoice({}).lines[0]!, quantity: "1" }] }),
      invoice({ id: "void", voidedAt: "2026-03-11" }),
    ];
    expect(profit({ invoices })).toEqual({
      revenue: "900.00",
      cost: "540.00",
      gross: "360.00",
      opex: "0.00",
      net: "360.00",
    });
  });

  it("counts a cost expense with its tax, but not a draft, a sales tax payment or a payroll expense in an HR month", () => {
    const expenses = [
      expense({}),
      expense({ id: "draft", status: "draft" }),
      expense({ id: "tax", category: "sales_tax_payment" }),
      expense({ id: "pay", category: "payroll", amount: "500.00", tax: "0.00" }),
    ];
    const payPeriods = [
      { status: "approved" as const, end: "2026-03-20", lines: [{ employeeId: "emp-1", grossPay: "2000.00" }] },
    ];
    // Rent 100 + 8 tax, and the month's HR gross pay 2000 in place of the 500 payroll expense (rule 7).
    expect(profit({ expenses, payPeriods }).opex).toBe("2108.00");
    // Without an approved or exported pay period, the payroll expense is the month's people cost.
    expect(profit({ expenses, payPeriods: [{ ...payPeriods[0]!, status: "in_review" as const }] }).opex).toBe("608.00");
    // Without pay sight, neither counts.
    expect(profit({ expenses, payPeriods }, NO_PROFIT_FILTERS, false).opex).toBe("108.00");
  });

  it("counts a write-off as a bad debt where the invoice was sold (rule 8)", () => {
    const adjustments = [{ invoiceId: "inv-1", kind: "write_off" as const, amount: "50.00", at: "2026-03-15 10:00" }];
    expect(profit({ adjustments }).opex).toBe("50.00");
    expect(profit({ adjustments }, { ...NO_PROFIT_FILTERS, locationIds: [SHOWROOM] }).opex).toBe("50.00");
    expect(profit({ adjustments }, { ...NO_PROFIT_FILTERS, locationIds: [WAREHOUSE] }).opex).toBe("0.00");
  });

  it("puts revenue where it was sold and splits a cost with no location by the month's revenue (rules 4 and 6)", () => {
    const expenses = [expense({ locationId: null, tax: "0.00" })];
    expect(profit({ expenses }, { ...NO_PROFIT_FILTERS, locationIds: [WAREHOUSE] })).toEqual({
      revenue: "0.00",
      cost: "0.00",
      gross: "0.00",
      opex: "0.00",
      net: "0.00",
    });
    expect(profit({ expenses }, { ...NO_PROFIT_FILTERS, locationIds: [SHOWROOM] }).opex).toBe("100.00");
    expect(profit({ expenses }).net).toBe("300.00");
  });
});
