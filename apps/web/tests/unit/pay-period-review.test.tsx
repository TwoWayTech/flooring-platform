import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  defaultNumberSettings,
  formatNumber,
  paySummaryTable,
  payWorkweekTable,
  sum,
  type PayPeriodLine,
  type PermissionKey,
} from "@workspace/shared";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { WorkspaceContext, type Workspace } from "@/components/workspace/workspace-context";
import { ReviewBody } from "@/features/hr/pay-periods-page";
import type { PayPeriodReview } from "@/lib/api/contract";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";
import { strippedPayLine } from "./stripped-pay-line";

// The lines table's URL state reads an empty address; nothing here calls the API.
vi.mock("@/lib/api", () => ({ api: { today: () => "2026-11-04" } }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/hr/pay-periods",
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * HR → Pay periods for a reviewer without hr.employee.view_sensitive (click-through #26): the API
 * strips each line's rate and salary (CLAUDE.md rule 5), and the review renders from that answer
 * with the salary as "Not shown" and no Salary total, instead of crashing in decimal.js.
 */
const summit = await loadCompanyFixtures("summit");
const period = summit.payPeriods.find((p) => p.lines.length > 0)!;

/** The review answer for this period, with each line as `strip` leaves it. */
function review(strip: (line: PayPeriodLine) => PayPeriodReview["rows"][number]["line"]): PayPeriodReview {
  return {
    period: { ...period, lines: [] },
    rows: period.lines.map((line) => ({
      line: strip(line),
      employee: summit.employees.find((e) => e.id === line.employeeId)!,
      excludedReason: null,
    })),
    blockers: [],
    contractors: [],
    contractorNames: {},
    warnings: [],
  };
}

/** The review's markup for a viewer holding pay-period view only. */
function render(answer: PayPeriodReview): string {
  const held = new Set<PermissionKey>(["hr.payroll.view"]);
  const workspace = { access: { permissions: held }, user: { id: "sm-usr-01" }, settings: summit.settings };
  return renderToStaticMarkup(
    <TooltipProvider>
      <WorkspaceContext.Provider value={workspace as unknown as Workspace}>
        <ReviewBody review={answer} period={answer.period} />
      </WorkspaceContext.Provider>
    </TooltipProvider>,
  );
}

/** A money figure as the screen shows it with the default number settings. */
const money = (value: string) => formatNumber(value, "money", defaultNumberSettings());

describe("a pay period's review renders from lines without rate or salary (click-through #26)", () => {
  it("shows every line, its gross pay, and each salary as Not shown, with no Salary total", () => {
    const html = render(review(strippedPayLine));
    for (const line of period.lines) expect(html).toContain(money(line.grossPay));
    expect(html.match(/aria-label="Not shown"/g)).toHaveLength(period.lines.length);
    const salaries = sum(period.lines.map((l) => l.salaryAmount)).toString();
    expect(html).not.toContain(money(salaries));
  });

  it("shows the salaries and their total when the lines carry them", () => {
    const html = render(review((line) => line));
    expect(html).not.toContain("Not shown");
    const salaries = sum(period.lines.map((l) => l.salaryAmount)).toString();
    expect(html).toContain(money(salaries));
  });

  it("leaves a stripped rate and salary empty in the payroll files, never the text undefined", () => {
    const rows = review(strippedPayLine).rows;
    const files = [paySummaryTable(period, rows), payWorkweekTable(rows)];
    for (const table of files) {
      for (const row of table) expect(row.every((cell) => typeof cell === "string")).toBe(true);
    }
    const [header, first] = paySummaryTable(period, rows);
    expect(first![header!.indexOf("base_rate")]).toBe("");
    expect(first![header!.indexOf("salary_amount")]).toBe("");
  });
});
