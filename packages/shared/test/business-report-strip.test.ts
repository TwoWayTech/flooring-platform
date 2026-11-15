import { describe, expect, it } from "vitest";
import { businessReport, dec, type BusinessExpense, type BusinessReport, type BusinessVisibility } from "../src";
import { businessDataOf, loadFixtures, NO_FILTERS, rowsOf, sectionOf } from "./report-fixtures";

const HIDDEN_KEYS = ["margin", "cogs", "net", "gross", "direct", "opex", "gross_pct", "net_pct"];
const HIDDEN_SECTIONS = ["locations", "people", "stock", "purchases"];
const NOTHING: BusinessVisibility = { margin: false, payroll: false, people: false, stock: false };
const EVERYTHING: BusinessVisibility = { margin: true, payroll: true, people: true, stock: true };

/** Every key the answer carries: column ids, row ids, value keys and drill record keys, by section. */
function walk(report: BusinessReport) {
  const problems: string[] = [];
  for (const section of report.sections) {
    const columns = new Set(section.columns.map((c) => c.id));
    for (const id of columns) if (HIDDEN_KEYS.includes(id)) problems.push(`${section.key}: column ${id}`);
    for (const row of [...section.rows, ...(section.total ? [section.total] : [])]) {
      if (HIDDEN_KEYS.includes(row.id)) problems.push(`${section.key}: row ${row.id}`);
      for (const key of Object.keys(row.values)) {
        if (HIDDEN_KEYS.includes(key)) problems.push(`${section.key}/${row.id}: value ${key}`);
        if (!columns.has(key)) problems.push(`${section.key}/${row.id}: value ${key} has no column`);
      }
      for (const record of row.records) {
        for (const key of Object.keys(record)) {
          if (!["date", "label", "amount", "href"].includes(key))
            problems.push(`${section.key}/${row.id}: record ${key}`);
        }
      }
    }
  }
  return problems;
}

describe.each(["summit", "keystone"] as const)(
  "%s: hidden figures are not in the answer (ADR 0055 S7, S-BR-3)",
  (name) => {
    const f = loadFixtures(name);
    const data = businessDataOf(f);
    const filters = { from: "2026-01-01", to: f.anchorDate, ...NO_FILTERS };

    it("leaves out every row, column, value and section a person may not see", () => {
      const report = businessReport(data, filters, NOTHING);
      expect(walk(report)).toEqual([]);
      for (const key of HIDDEN_SECTIONS) expect(report.sections.map((s) => s.key)).not.toContain(key);
      expect(sectionOf(report, "summary").rows.map((r) => r.id)).toEqual([
        "revenue",
        "cash_in",
        "cash_out",
        "ar_current",
        "ar_overdue",
        "ap_current",
        "ap_overdue",
      ]);
      for (const key of ["revenue_category", "revenue_rep"]) {
        expect(sectionOf(report, key).columns.map((c) => c.id)).toEqual(["revenue"]);
      }
    });

    it("keeps every value a row carries in a visible column, with everything shown too", () => {
      const report = businessReport(data, filters, EVERYTHING);
      expect(walk(report).filter((p) => p.includes("has no column"))).toEqual([]);
      for (const key of ["revenue_category", "revenue_rep"]) {
        for (const row of sectionOf(report, key).rows)
          expect(Object.keys(row.values).sort()).toEqual(["margin", "revenue"]);
      }
    });

    it("names the expense column `amount`, not the reserved sensitive name `cost`", () => {
      const report = businessReport(data, filters, NOTHING);
      for (const key of ["expense_category", "expense_vendor", "expense_location"]) {
        const section = sectionOf(report, key);
        expect(section.columns).toEqual([{ id: "amount", header: "Cost", kind: "money" }]);
        expect(section.chartColumn).toBe("amount");
      }
      expect(rowsOf(report).some(({ row }) => "cost" in row.values)).toBe(false);
    });
  },
);

describe("pay never reaches a figure without pay sight (ADR 0055 S3, S-BR-4)", () => {
  const f = loadFixtures("summit");
  const data = businessDataOf(f);
  const filters = { from: "2026-10-01", to: "2026-10-31", ...NO_FILTERS };
  const template = f.expenses.find((e) => e.category === "payroll" && e.status === "confirmed")!;
  const taxed: BusinessExpense = { ...template, id: "taxed-payroll", date: "2026-10-20", tax: "12.34" };
  const withTaxed = { ...data, expenses: [...data.expenses, taxed] };
  const memo = (report: BusinessReport) => sectionOf(report, "taxes").rows.find((r) => r.id === "memo")!.values.amount!;

  it("gives the same answer with or without a taxed payroll expense", () => {
    const show = { ...EVERYTHING, payroll: false, people: false };
    const without = { ...data, expenses: data.expenses.filter((e) => e.id !== taxed.id) };
    expect(businessReport(withTaxed, filters, show)).toEqual(businessReport(without, filters, show));
  });

  it("counts the payroll expense's tax in the memo with pay sight", () => {
    const before = memo(businessReport(data, filters, EVERYTHING));
    const after = memo(businessReport(withTaxed, filters, EVERYTHING));
    expect(dec(after).minus(before).toFixed(2)).toBe("12.34");
  });

  it("shows People costs only with pay sight as well as the pay-rate key", () => {
    const keys = (show: BusinessVisibility) => businessReport(data, filters, show).sections.map((s) => s.key);
    expect(keys(EVERYTHING)).toContain("people");
    expect(keys({ ...EVERYTHING, payroll: false })).not.toContain("people");
    expect(keys({ ...EVERYTHING, people: false })).not.toContain("people");
  });
});
