import { describe, expect, it } from "vitest";
import type { Report } from "@workspace/shared";
import { presentReport } from "@/features/reports/present-report";

/** A company date pattern stand-in, so the test shows which cells went through it. */
const formatDate = (iso: string) => `day ${iso}`;

const payments: Report = {
  title: "Payments received",
  columns: [
    { id: "date", header: "Date", format: "date" },
    { id: "number", header: "Payment" },
    { id: "amount", header: "Amount", kind: "money" },
  ],
  rows: [
    { date: "2026-10-03", number: "PAY-0101", amount: "1200.00" },
    { date: "", number: "PAY-0102", amount: "5.10" },
  ],
  totals: { date: "Total", amount: "1205.10" },
};

const pnl: Report = {
  title: "Profit and loss",
  columns: [
    { id: "month", header: "Month", format: "month" },
    { id: "revenue", header: "Revenue", kind: "money" },
  ],
  rows: [
    { month: "2025-12", revenue: "1000.00" },
    { month: "2026-01", revenue: "250.50" },
  ],
  totals: { month: "Total", revenue: "1250.50" },
};

describe("presentReport (raw API days and months shown the company's way, ADR 0055)", () => {
  it("W-PRE-1 formats date cells with the company pattern and leaves the rest and the totals alone", () => {
    const shown = presentReport(payments, formatDate);
    expect(shown.rows).toEqual([
      { date: "day 2026-10-03", number: "PAY-0101", amount: "1200.00" },
      { date: "", number: "PAY-0102", amount: "5.10" },
    ]);
    expect(shown.totals).toEqual({ date: "Total", amount: "1205.10" });
    expect(shown.columns).toBe(payments.columns);
    expect(payments.rows[0]!.date).toBe("2026-10-03");
  });

  it("W-PRE-1 formats month cells as MMM yyyy and keeps the totals' Total text", () => {
    const shown = presentReport(pnl, formatDate);
    expect(shown.rows.map((r) => r.month)).toEqual(["Dec 2025", "Jan 2026"]);
    expect(shown.rows.map((r) => r.revenue)).toEqual(["1000.00", "250.50"]);
    expect(shown.totals).toEqual({ month: "Total", revenue: "1250.50" });
  });

  it("W-PRE-1 returns a report with no date or month column as it is", () => {
    const sales: Report = {
      title: "Sales by category",
      columns: [
        { id: "category", header: "Category" },
        { id: "revenue", header: "Revenue", kind: "money" },
      ],
      rows: [{ category: "2026-10-03", revenue: "10.00" }],
      totals: { category: "Total", revenue: "10.00" },
    };
    expect(presentReport(sales, formatDate)).toBe(sales);
  });
});
