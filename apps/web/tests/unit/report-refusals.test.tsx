import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { REPORT_QUERY_MESSAGES as M, REPORT_WHOLE_COMPANY } from "@workspace/shared";
import { CustomDates } from "@/features/reports/custom-dates";
import { customPeriod, editCustomPeriod } from "@/features/reports/custom-period";
import { ReportFallback } from "@/features/reports/report-fallback";
import { DemoRuleError } from "@/lib/api/demo/admin-rules";
import { HttpApiError } from "@/lib/api/http/transport";
import type { QueryState } from "@/lib/api/use-api";

const THIS_YEAR = { from: "2026-01-01", to: "2026-11-15" };

/** A report read that failed with this error. */
function failed(error: Error): QueryState<unknown> {
  return { status: "error", data: undefined, error, retry: () => undefined };
}

/** The fallback a report shows for this failed read. */
function fallback(error: Error): string {
  return renderToStaticMarkup(
    <ReportFallback query={failed(error)} label="Loading report" onRefresh={() => undefined} />,
  );
}

describe("Business report Custom dates (ADR 0055 S8, review round 3)", () => {
  it("keeps the last period that worked while the typed one is refused, and applies the next good one", () => {
    const start = customPeriod(THIS_YEAR);
    expect(start).toEqual({ typed: THIS_YEAR, applied: THIS_YEAR, problem: null });

    const tooLong = editCustomPeriod(start, { from: "2025-01-01" });
    expect(tooLong).toEqual({ typed: { ...THIS_YEAR, from: "2025-01-01" }, applied: THIS_YEAR, problem: M.tooLong });
    expect(editCustomPeriod(tooLong, { from: "2026-11-16" }).problem).toBe(M.order);
    expect(editCustomPeriod(tooLong, { from: "" })).toMatchObject({ applied: THIS_YEAR, problem: M.date });
    expect(editCustomPeriod(tooLong, { to: "2026-02-30" })).toMatchObject({ applied: THIS_YEAR, problem: M.realDate });

    const fixed = editCustomPeriod(tooLong, { from: "2026-06-01" });
    expect(fixed).toEqual({
      typed: { from: "2026-06-01", to: "2026-11-15" },
      applied: { from: "2026-06-01", to: "2026-11-15" },
      problem: null,
    });
  });

  it("shows the refusal beside the dates, marks both inputs invalid and says the figures stay", () => {
    const html = renderToStaticMarkup(
      <CustomDates
        period={editCustomPeriod(customPeriod(THIS_YEAR), { from: "2025-01-01" })}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain(
      "Choose a period of 366 days or less. The figures below still show the last dates that worked.",
    );
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(2);
    expect(html.match(/aria-describedby="business-custom-dates-problem"/g)).toHaveLength(2);
    expect(html).toContain('aria-live="polite"');
  });

  it("says nothing and marks nothing while the dates are fine", () => {
    const html = renderToStaticMarkup(<CustomDates period={customPeriod(THIS_YEAR)} onChange={() => undefined} />);
    expect(html).not.toContain('aria-invalid="');
    expect(html).not.toContain("aria-describedby");
    expect(html).toContain('class="sr-only"></p>');
  });
});

describe("ReportFallback (ADR 0055 S1, S8, S10)", () => {
  it("shows a refused filter as a notice in the server's words, with no Try again", () => {
    for (const error of [new DemoRuleError(M.tooLong), new HttpApiError(M.locations, 400, "invalid_request")]) {
      const html = fallback(error);
      expect(html).toContain(error.message);
      expect(html).toContain("Change the filters above to see the report.");
      expect(html).not.toContain("Try again");
      expect(html).not.toContain("This page could not load its data.");
    }
  });

  it("keeps the whole-company notice with Show my reports", () => {
    const html = fallback(new HttpApiError(REPORT_WHOLE_COMPANY, 403, "forbidden"));
    expect(html).toContain("Show my reports");
    expect(html).not.toContain("Try again");
  });

  it("still offers Try again when the read itself failed", () => {
    const html = fallback(new Error("The server could not be reached."));
    expect(html).toContain("This page could not load its data.");
    expect(html).toContain("Try again");
  });
});
