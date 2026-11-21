import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { dec, moneyString, sum, type CompanyFixtures, type Timesheet } from "@workspace/shared";
import { monthName } from "@/features/hr/commissions/month-name";
import { statementFigureColumns } from "@/features/hr/commissions/statement-columns";
import { hrHomeFigures } from "@/features/hr/hr-week";
import type { CommissionStatementRow } from "@/lib/api/contract";

const summit = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json"), "utf8"),
) as CompanyFixtures;

/** A statement row with only the figures the list reads. */
function statement(figures: Partial<CommissionStatementRow>): CommissionStatementRow {
  return {
    userId: "u1",
    month: "2026-10",
    earned: "0.00",
    override: "0.00",
    reversal: "0.00",
    adjustment: "0.00",
    net: "0.00",
    carryIn: "0.00",
    draw: "0.00",
    payable: "0.00",
    carryOut: "0.00",
    lines: [],
    needsReview: false,
    statementId: null,
    name: "Dana Whitfield",
    status: "draft",
    approvedBy: null,
    approvedAt: null,
    payPeriodId: null,
    monthEnded: true,
    planName: null,
    ...figures,
  };
}

describe("Commissions → Statements columns (click-through #49)", () => {
  const dana = statement({ override: "428.73", net: "428.73", payable: "428.73" });
  const rep = statement({ userId: "u2", earned: "500.00", reversal: "-20.00", net: "480.00", payable: "480.00" });

  it("shows Overrides, so a manager's row adds up from Earned to Payable", () => {
    const columns = statementFigureColumns([dana, rep]);
    expect(columns.map((c) => c.header)).toEqual(["Earned", "Overrides", "Reversals", "Payable"]);
    for (const row of [dana, rep]) {
      const parts = columns.filter((c) => c.id !== "payable").map((c) => c.value(row));
      expect(moneyString(sum(parts))).toBe(row.payable);
    }
  });

  it("adds Adjustments and Carried in when a row has them, Carried in as the deduction it is", () => {
    const carried = statement({
      earned: "300.00",
      adjustment: "25.00",
      carryIn: "75.00",
      net: "325.00",
      payable: "250.00",
    });
    const columns = statementFigureColumns([carried, rep]);
    expect(columns.map((c) => c.header)).toEqual([
      "Earned",
      "Overrides",
      "Reversals",
      "Adjustments",
      "Carried in",
      "Payable",
    ]);
    const parts = columns.filter((c) => c.id !== "payable").map((c) => c.value(carried));
    expect(moneyString(sum(parts))).toBe("250.00");
    expect(columns.find((c) => c.id === "carryIn")!.value(carried)).toBe("-75.00");
  });

  it("adds Draw when a plan pays one", () => {
    const drawn = statement({ earned: "100.00", net: "100.00", draw: "400.00", payable: "400.00" });
    expect(statementFigureColumns([drawn]).map((c) => c.header)).toContain("Draw");
  });

  it("names the month in words for the statement title", () => {
    expect(monthName("2026-10")).toBe("October 2026");
    expect(monthName("2027-01")).toBe("January 2027");
  });
});

describe("HR Home figures (click-through #65)", () => {
  const people = summit.employees;
  const someone = people.find((e) => e.workerType === "w2" && e.status === "active")!;
  const sheet = (weekStart: string, days: number[]): Timesheet => ({
    id: `ts-${weekStart}`,
    employeeId: someone.id,
    weekStart,
    days,
    status: "submitted",
    submittedAt: null,
    decidedBy: null,
    decidedAt: null,
    rejectionReason: null,
    source: "form",
    history: [],
  });
  // Saturday 2026-11-21; Monday workweeks start 2026-11-16.
  const today = "2026-11-21";

  it("counts this workweek's timesheets, not the newest week that has some", () => {
    const older = sheet("2026-11-09", [8, 8, 8, 8, 8, 0, 0]);
    const none = hrHomeFigures(people, [older], today, 1, "federal");
    expect(none.week).toBe("2026-11-16");
    expect(dec(none.hours).isZero()).toBe(true);
    const current = hrHomeFigures(people, [older, sheet("2026-11-16", [9, 9, 9, 9, 9, 0, 0])], today, 1, "federal");
    expect(current.hours).toBe("45");
    expect(current.overtime).toBe("5");
  });

  it("leaves 1099 contractors and leavers out of headcount and counts contractors on their own", () => {
    const figures = hrHomeFigures(people, [], today, 1, "federal");
    const active = people.filter((e) => e.status !== "terminated");
    const contractors = active.filter((e) => e.workerType === "1099").length;
    expect(contractors).toBeGreaterThan(0);
    expect(figures.contractors).toBe(contractors);
    expect(figures.staff).toHaveLength(active.length - contractors);
    expect(figures.staff.every((e) => e.workerType === "w2")).toBe(true);
  });
});
