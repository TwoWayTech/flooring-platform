import { describe, expect, it } from "vitest";
import {
  addDays,
  businessReport,
  capDrillRecords,
  DRILL_LIMIT,
  drillTotal,
  type BusinessReport,
  type BusinessRow,
  type BusinessSection,
  type DrillRecord,
} from "../src";
import { businessDataOf, loadFixtures, NO_FILTERS, rowsOf, sectionOf } from "./report-fixtures";

const record = (i: number, label = `INV-${String(i).padStart(4, "0")}`): DrillRecord => ({
  // Spread over about eight months, out of order, with some days shared.
  date: `2026-${String(1 + ((i * 7) % 8)).padStart(2, "0")}-${String(1 + ((i * 3) % 28)).padStart(2, "0")}`,
  label,
  amount: `${i}.00`,
  href: `/sales/invoices/${i}`,
});
const report = (count: number): BusinessReport => ({
  period: { from: "2026-01-01", to: "2026-08-31" },
  previous: { from: "2025-05-03", to: "2025-12-31" },
  sections: [
    {
      key: "summary",
      title: "Summary",
      note: null,
      columns: [{ id: "now", header: "This period", kind: "money" }],
      rows: [
        {
          id: "revenue",
          label: "Revenue",
          values: { now: "1.00" },
          records: Array.from({ length: count }, (_, i) => record(i)),
        },
        { id: "gross_pct", label: "Gross profit %", values: { now: "40.0" }, records: [], kind: "percent" },
      ],
      total: { id: "total", label: "Total", values: { now: "1.00" }, records: [] },
      chartColumn: null,
    },
  ],
});
const newestFirst = (records: readonly DrillRecord[]) =>
  records.every(
    (r, i) =>
      i === 0 || records[i - 1]!.date > r.date || (records[i - 1]!.date === r.date && records[i - 1]!.label <= r.label),
  );

describe("drill lists are capped on the server (ADR 0055 S8, S-DRL-1)", () => {
  it("keeps the latest 200 of 250 and says how many there are", () => {
    const capped = capDrillRecords(report(250));
    const row = capped.sections[0]!.rows[0]!;
    expect(DRILL_LIMIT).toBe(200);
    expect(row.records).toHaveLength(200);
    expect(row.recordCount).toBe(250);
    expect(newestFirst(row.records)).toBe(true);
    const all = [...report(250).sections[0]!.rows[0]!.records].sort((a, b) =>
      a.date === b.date ? (a.label < b.label ? -1 : 1) : a.date > b.date ? -1 : 1,
    );
    expect(row.records).toEqual(all.slice(0, 200));
  });

  it("only sorts a list that fits, without a count", () => {
    const row = capDrillRecords(report(150)).sections[0]!.rows[0]!;
    expect(row.records).toHaveLength(150);
    expect(newestFirst(row.records)).toBe(true);
    expect("recordCount" in row).toBe(false);
  });

  it("breaks a tie on the day by label", () => {
    const tied = report(0);
    tied.sections[0]!.rows[0]!.records = [record(1, "B"), record(1, "A"), record(1, "C")];
    expect(capDrillRecords(tied).sections[0]!.rows[0]!.records.map((r) => r.label)).toEqual(["A", "B", "C"]);
  });

  it("leaves values, percent rows and totals alone, and does not change its input", () => {
    const input = report(250);
    const before = JSON.parse(JSON.stringify(input)) as BusinessReport;
    const capped = capDrillRecords(input);
    expect(input).toEqual(before);
    const [revenue, percent] = capped.sections[0]!.rows;
    expect(revenue!.values).toEqual({ now: "1.00" });
    expect(percent).toEqual(before.sections[0]!.rows[1]);
    expect(capped.sections[0]!.total).toEqual(before.sections[0]!.total);
    expect(capped.period).toEqual(before.period);
    expect(capped.previous).toEqual(before.previous);
  });
});

describe("the total under a drill list (click-through #40)", () => {
  const columns: BusinessSection["columns"] = [
    { id: "now", header: "This period", kind: "money" },
    { id: "before", header: "Previous period", kind: "money" },
  ];
  const row = (now: string, amounts: string[]): BusinessRow => ({
    id: "revenue",
    label: "Revenue",
    values: { now, before: "9.99", change: "" },
    records: amounts.map((amount, i) => ({ ...record(i), amount })),
  });

  it("adds the records exactly and says Total when they make the figure clicked", () => {
    expect(drillTotal({ columns }, row("1000.30", ["0.10", "0.20", "1000.00"]))).toEqual({
      total: "1000.3",
      figure: "1000.30",
      matches: true,
    });
  });

  it("says the records differ when the figure is worked out from more than them", () => {
    expect(drillTotal({ columns }, row("500.00", ["120.00", "80.00"]))).toMatchObject({ total: "200", matches: false });
  });

  it("never claims a cut list is the whole figure", () => {
    const cut = capDrillRecords(report(250)).sections[0]!.rows[0]!;
    expect(drillTotal({ columns }, { ...cut, values: { now: "1.00" } })?.matches).toBe(false);
  });

  it("has no line for a row without records or a percent row", () => {
    expect(drillTotal({ columns }, row("0.00", []))).toBeNull();
    expect(drillTotal({ columns }, { ...row("40.0", ["1.00"]), kind: "percent" })).toBeNull();
  });

  it("matches the figure on every revenue, expense and cash row of the seeded report", () => {
    const f = loadFixtures("summit");
    const show = { margin: true, payroll: true, people: true, stock: true };
    const filters = { ...NO_FILTERS, from: addDays(f.anchorDate, -29), to: f.anchorDate };
    const business = businessReport(businessDataOf(f), filters, show);
    const checked = ["locations", "revenue_rep", "expense_category", "expense_vendor", "expense_location", "cash"];
    const rows = rowsOf(business).filter(({ section, row }) => checked.includes(section) && row.records.length);
    expect(rows.length).toBeGreaterThan(10);
    for (const { section, row } of rows) {
      expect(drillTotal(sectionOf(business, section), row)?.matches, `${section} ${row.label}`).toBe(true);
    }
    const summary = sectionOf(business, "summary");
    const revenue = summary.rows.find((r) => r.id === "revenue")!;
    expect(drillTotal(summary, revenue)).toMatchObject({ figure: revenue.values.now, matches: true });
  });
});
