import { describe, expect, it } from "vitest";
import {
  REPORT_QUERY_MESSAGES as M,
  REPORT_RANGE_KEYS,
  hubWindow,
  reportDayProblem,
  reportMonths,
  reportPeriodProblem,
} from "../src";

describe("report days and periods (ADR 0055 S8, S-PER-1)", () => {
  it("refuses a period that runs backwards or is longer than 366 days", () => {
    expect(reportPeriodProblem("2026-03-02", "2026-03-01")).toBe(M.order);
    expect(reportPeriodProblem("2026-01-01", "2026-12-31")).toBeNull();
    expect(reportPeriodProblem("2024-01-01", "2024-12-31")).toBeNull();
    expect(reportPeriodProblem("2025-01-01", "2026-01-02")).toBe(M.tooLong);
    expect(reportPeriodProblem("2024-01-01", "2025-01-01")).toBe(M.tooLong);
    expect(reportPeriodProblem("2026-10-14", "2026-10-14")).toBeNull();
  });

  it("takes only real days with a four-digit year from 1900 to 2999", () => {
    for (const day of ["2026-02-30", "0000-01-01", "1899-12-31", "3000-01-01", "9999-12-31", "2026-13-01"]) {
      expect(reportDayProblem(day)).toBe(M.realDate);
    }
    for (const day of ["2026-1-01", "", "2026-01-01T00:00", "yesterday", " 2026-01-01"]) {
      expect(reportDayProblem(day)).toBe(M.date);
    }
    for (const day of ["1900-01-01", "2999-12-31", "2024-02-29"]) expect(reportDayProblem(day)).toBeNull();
    expect(reportDayProblem("2026-02-29")).toBe(M.realDate);
  });

  it("uses the same words as the sales routes for a missing or impossible day", () => {
    expect(M.date).toBe("Enter a date.");
    expect(M.realDate).toBe("Enter a real date.");
    expect(M.tooLong).toBe("Choose a period of 366 days or less.");
  });
});

describe("hub report dates (spec rule 24, S-PER-2)", () => {
  it("covers the chosen months, ending with this month", () => {
    expect(REPORT_RANGE_KEYS).toEqual(["12m", "3m", "1m", "ytd"]);
    expect(reportMonths("ytd", "2026-01-20")).toEqual(["2026-01"]);
    expect(reportMonths("3m", "2026-01-20")).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(reportMonths("1m", "2026-11-04")).toEqual(["2026-11"]);
    const year = reportMonths("12m", "2026-11-04");
    expect(year).toHaveLength(12);
    expect(year[0]).toBe("2025-12");
    expect(year.at(-1)).toBe("2026-11");
  });

  it("reads invoices to the day after today, payments to today and expenses to the month's end", () => {
    expect(hubWindow("3m", "2026-11-04")).toEqual({
      months: ["2026-09", "2026-10", "2026-11"],
      from: "2026-09-01",
      invoicesTo: "2026-11-05",
      paymentsTo: "2026-11-04",
      expensesTo: "2026-11-30",
    });
    expect(hubWindow("1m", "2026-12-31").invoicesTo).toBe("2027-01-01");
    expect(hubWindow("ytd", "2024-02-10").expensesTo).toBe("2024-02-29");
  });
});
