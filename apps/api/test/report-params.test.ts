import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { REPORT_QUERY_MESSAGES as M, REPORT_WHOLE_COMPANY } from "@workspace/shared";
import { describe, expect, it } from "vitest";
import { requireWholeCompany } from "../src/modules/reports/report-access";
import {
  checkLocations,
  checkWarehouse,
  parseBusinessQuery,
  parseOptionsQuery,
  parsePaymentsQuery,
  parsePnlQuery,
  parseSalesQuery,
} from "../src/modules/reports/report-params";
import { minuteIn } from "../src/modules/reports/report-records";

const A = "0190f6a2-0000-7000-8000-000000000001";
const B = "0190f6a2-0000-7000-8000-000000000002";
const PERIOD = { from: "2026-10-01", to: "2026-10-31" };

/** The 400 message a parse gives, or null when it parses. */
function refusal(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    const body = error.getResponse() as { code: string; message: string };
    expect(body.code).toBe("invalid_request");
    return body.message;
  }
}

describe("Business report query (ADR 0055 S8, S10)", () => {
  it("reads a period with no filter as the whole company", () => {
    expect(parseBusinessQuery(PERIOD)).toEqual({
      ...PERIOD,
      locationIds: [],
      productCategory: null,
      expenseCategory: null,
      salesRepId: null,
      supplierId: null,
    });
  });

  it("reads every filter in the pickers' shapes", () => {
    expect(
      parseBusinessQuery({
        ...PERIOD,
        locationIds: ` ${A}, ,${B},${A}`,
        productCategory: "carpet",
        expenseCategory: "sales_tax_payment",
        salesRepId: A,
        supplierId: B,
      }),
    ).toEqual({
      ...PERIOD,
      locationIds: [A, B],
      productCategory: "carpet",
      expenseCategory: "sales_tax_payment",
      salesRepId: A,
      supplierId: B,
    });
    expect(parseBusinessQuery({ ...PERIOD, locationIds: "" }).locationIds).toEqual([]);
  });

  it("refuses days that are not real report days, in the person's words", () => {
    expect(refusal(() => parseBusinessQuery({ to: "2026-10-31" }))).toBe(M.date);
    expect(refusal(() => parseBusinessQuery({ from: "2026-10-01" }))).toBe(M.date);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, from: "2026-1-01" }))).toBe(M.date);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, from: "" }))).toBe(M.date);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, from: "2026-02-30" }))).toBe(M.realDate);
    expect(refusal(() => parseBusinessQuery({ from: "0000-01-01", to: "0000-01-02" }))).toBe(M.realDate);
    expect(refusal(() => parseBusinessQuery({ from: "1899-12-31", to: "1900-01-01" }))).toBe(M.realDate);
    expect(refusal(() => parseBusinessQuery({ from: "9999-12-30", to: "9999-12-31" }))).toBe(M.realDate);
    expect(refusal(() => parseBusinessQuery({ from: "2999-12-31", to: "3000-01-01" }))).toBe(M.realDate);
    expect(refusal(() => parseBusinessQuery({ from: "1900-01-01", to: "1900-12-31" }))).toBeNull();
    expect(refusal(() => parseBusinessQuery({ from: "2999-01-01", to: "2999-12-31" }))).toBeNull();
  });

  it("answers a repeated parameter with that field's message, not the parser's wording", () => {
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, from: ["2026-10-01", "2026-10-02"] }))).toBe(M.date);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, locationIds: [A, B] }))).toBe(M.locations);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, salesRepId: [A, A] }))).toBe(M.salesperson);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, productCategory: ["carpet", "lvp"] }))).toBe(
      M.productCategory,
    );
  });

  it("refuses a period out of order or longer than 366 days counted inclusively", () => {
    expect(refusal(() => parseBusinessQuery({ from: "2026-03-02", to: "2026-03-01" }))).toBe(M.order);
    expect(refusal(() => parseBusinessQuery({ from: "2025-01-01", to: "2026-01-02" }))).toBe(M.tooLong);
    expect(refusal(() => parseBusinessQuery({ from: "2024-01-01", to: "2024-12-31" }))).toBeNull();
    expect(refusal(() => parseBusinessQuery({ from: "2025-11-16", to: "2026-11-16" }))).toBeNull();
    expect(refusal(() => parseBusinessQuery({ from: "2026-03-01", to: "2026-03-01" }))).toBeNull();
  });

  it("refuses filters that are not in the pickers", () => {
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, locationIds: "abc" }))).toBe(M.locations);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, locationIds: `${A},nope` }))).toBe(M.locations);
    const many = Array.from({ length: 51 }, (_, i) => `0190f6a2-0000-7000-8000-${String(i).padStart(12, "0")}`);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, locationIds: many.join(",") }))).toBe(M.locations);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, locationIds: many.slice(0, 50).join(",") }))).toBeNull();
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, productCategory: "nope" }))).toBe(M.productCategory);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, expenseCategory: "payroll" }))).toBe(M.expenseCategory);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, salesRepId: "x" }))).toBe(M.salesperson);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, supplierId: "x" }))).toBe(M.vendor);
  });

  it("refuses an unknown parameter first, so the tenant can never come from the query (CLAUDE.md rule 2)", () => {
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, foo: "1" }))).toBe(M.unknown);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, companyId: A }))).toBe(M.unknown);
    expect(refusal(() => parseBusinessQuery({ companyId: A }))).toBe(M.unknown);
    expect(refusal(() => parseBusinessQuery({ ...PERIOD, "locationIds[]": A }))).toBe(M.unknown);
  });
});

describe("hub report queries (spec rule 24; ADR 0055 S10)", () => {
  it("defaults to the last 12 months and the whole company", () => {
    expect(parsePnlQuery({})).toEqual({ range: "12m", locationId: null });
    expect(parsePnlQuery(undefined)).toEqual({ range: "12m", locationId: null });
    expect(parseSalesQuery({})).toEqual({ range: "12m", locationId: null, category: null });
    expect(parsePaymentsQuery({})).toEqual({ range: "12m", locationId: null, method: null, customer: "" });
  });

  it("reads each preset and filter", () => {
    for (const range of ["12m", "3m", "1m", "ytd"]) expect(parsePnlQuery({ range }).range).toBe(range);
    expect(parsePnlQuery({ locationId: A }).locationId).toBe(A);
    expect(parseSalesQuery({ range: "3m", category: "lvp" })).toEqual({
      range: "3m",
      locationId: null,
      category: "lvp",
    });
    expect(parsePaymentsQuery({ method: "ach", customer: "Ridge" })).toEqual({
      range: "12m",
      locationId: null,
      method: "ach",
      customer: "Ridge",
    });
  });

  it("refuses what the pickers never send", () => {
    expect(refusal(() => parsePnlQuery({ range: "2y" }))).toBe(M.range);
    expect(refusal(() => parsePnlQuery({ range: ["12m", "3m"] }))).toBe(M.range);
    expect(refusal(() => parsePnlQuery({ locationId: "abc" }))).toBe(M.warehouse);
    expect(refusal(() => parseSalesQuery({ category: "service" }))).toBe(M.category);
    expect(refusal(() => parseSalesQuery({ category: "nope" }))).toBe(M.category);
    expect(refusal(() => parsePaymentsQuery({ method: "bitcoin" }))).toBe(M.method);
    expect(refusal(() => parsePaymentsQuery({ customer: "x".repeat(101) }))).toBe(M.customer);
    expect(refusal(() => parsePaymentsQuery({ customer: "x".repeat(100) }))).toBeNull();
    expect(refusal(() => parsePaymentsQuery({ customer: ["a", "b"] }))).toBe(M.customer);
  });

  it("refuses an unknown parameter, the company included, and anything on the options route", () => {
    expect(refusal(() => parsePnlQuery({ companyId: A }))).toBe(M.unknown);
    expect(refusal(() => parseSalesQuery({ method: "cash" }))).toBe(M.unknown);
    expect(refusal(() => parsePaymentsQuery({ category: "lvp" }))).toBe(M.unknown);
    expect(refusal(() => parseOptionsQuery({ x: "1" }))).toBe(M.unknown);
    expect(refusal(() => parseOptionsQuery({}))).toBeNull();
  });
});

describe("report location checks (ADR 0055 S10)", () => {
  const live = [
    { id: A, kind: "warehouse" as const },
    { id: B, kind: "showroom" as const },
  ];

  it("takes only live locations, and only live warehouses for the hub reports", () => {
    expect(refusal(() => checkLocations([A, B], live))).toBeNull();
    expect(refusal(() => checkLocations([], live))).toBeNull();
    expect(refusal(() => checkLocations(["0190f6a2-0000-7000-8000-00000000000f"], live))).toBe(M.locations);
    expect(refusal(() => checkWarehouse(null, live))).toBeNull();
    expect(refusal(() => checkWarehouse(A, live))).toBeNull();
    expect(refusal(() => checkWarehouse(B, live))).toBe(M.warehouse);
    expect(refusal(() => checkWarehouse("0190f6a2-0000-7000-8000-00000000000f", live))).toBe(M.warehouse);
  });
});

describe("whole-company reports (ADR 0055 S1)", () => {
  it("lets only data scope all through, with the report's own words", () => {
    expect(() => requireWholeCompany({ dataScope: "all" })).not.toThrow();
    for (const dataScope of ["branch", "own"] as const) {
      try {
        requireWholeCompany({ dataScope });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getResponse()).toEqual({
          code: "forbidden",
          message: REPORT_WHOLE_COMPANY,
        });
      }
    }
  });
});

describe("company minutes (ADR 0055 S12)", () => {
  it("reads a Denver evening as that day, and midnight as 00", () => {
    expect(minuteIn(new Date("2026-10-21T02:30:00Z"), "America/Denver")).toBe("2026-10-20T20:30");
    expect(minuteIn(new Date("2026-10-20T06:00:00Z"), "America/Denver")).toBe("2026-10-20T00:00");
    expect(minuteIn(new Date("2026-10-20T06:00:00Z"), "UTC")).toBe("2026-10-20T06:00");
  });
});
