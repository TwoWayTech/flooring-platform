import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { paySummaryTable, payWorkweekTable, type CompanyFixtures } from "../src";

const load = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)), "utf8"),
  ) as CompanyFixtures;

describe("the payroll export's employee_external_id (click-through #48)", () => {
  it("every seeded person has a Payroll ID of their own", () => {
    for (const company of ["summit", "keystone", "harbor"]) {
      const ids = load(company).employees.map((e) => e.externalId);
      expect(
        ids.every((id) => typeof id === "string" && id !== ""),
        company,
      ).toBe(true);
      expect(new Set(ids).size, company).toBe(ids.length);
    }
  });

  it("fills the column from the person's Payroll ID on every row", () => {
    const summit = load("summit");
    const period = summit.payPeriods.find((p) => p.lines.length > 0)!;
    const rows = period.lines.map((line) => ({
      line,
      employee: summit.employees.find((e) => e.id === line.employeeId)!,
    }));
    const [header, ...body] = paySummaryTable(period, rows);
    const at = header!.indexOf("employee_external_id");
    expect(at).toBe(0);
    expect(body.map((r) => r[at])).toEqual(rows.map((r) => r.employee.externalId));
    expect(body.every((r) => r[at] !== "")).toBe(true);
  });

  it("leaves the summary blank, and the workweek file uses the email, for someone with no Payroll ID", () => {
    const summit = load("summit");
    const period = summit.payPeriods.find((p) => p.lines.length > 0)!;
    const line = period.lines[0]!;
    const employee = { ...summit.employees.find((e) => e.id === line.employeeId)! };
    delete employee.externalId;
    expect(paySummaryTable(period, [{ line, employee }])[1]![0]).toBe("");
    const weeks = payWorkweekTable([{ line, employee }]);
    for (const row of weeks.slice(1)) expect(row[0]).toBe(employee.email);
  });
});
