import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  defaultNumberSettings,
  formatNumber,
  type Employee,
  type PayPeriodLine,
  type ViewedPayLine,
} from "@workspace/shared";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { MyPayView } from "@/features/my/my-pay";
import type { MyPortal } from "@/lib/api/contract";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";
import { strippedPayLine } from "./stripped-pay-line";

/**
 * Finding #26: My pay crashed with "[DecimalError] Invalid argument: undefined" for every Employee
 * and Manager in api mode, because it read the pay line's `salaryAmount`, which the API strips
 * without hr.employee.view_sensitive (CLAUDE.md rule 5). The page renders from the answer as sent.
 */
const summit = await loadCompanyFixtures("summit");
const period = summit.payPeriods.find((p) => p.lines.length > 0)!;

/** Summit's employee by name. */
function employee(name: string): Employee {
  return summit.employees.find((e) => e.name === name)!;
}

/** A line as `GET /me/portal` sends it to someone without view_sensitive: no rate, no salary. */
const stripped = strippedPayLine;

/** The portal answer for one person with their line from Summit's first paid period. */
function portalFor(person: Employee, line: ViewedPayLine): MyPortal {
  return {
    employee: person,
    visible: { pay: true, commission: false, rates: false, teamCalendar: false, clock: false },
    weekStart: period.start,
    weekStartDay: 1,
    timesheets: [],
    usesTimesheet: false,
    clock: { clockedInAt: null },
    balances: [],
    requests: [],
    pay: [{ period: { ...period, lines: [], excluded: [] }, line }],
    earnedThisYear: line.grossPay,
    statements: [],
    assignment: null,
    plan: null,
    contractorPayments: [],
    teamOut: [],
    teamNames: [],
  };
}

/** The page's markup from a portal answer. */
function render(portal: MyPortal): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <MyPayView portal={portal} />
    </TooltipProvider>,
  );
}

/** Markup as it reads on screen: tags out, spaces collapsed. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/** A money figure as the screen shows it with the default number settings. */
const money = (value: string) => formatNumber(value, "money", defaultNumberSettings());

/** The person's line in the period, as stored. */
function lineOf(person: Employee): PayPeriodLine {
  return period.lines.find((l) => l.employeeId === person.id)!;
}

describe("My pay renders the portal answer the API sends (finding #26)", () => {
  it("shows an hourly Employee's hours pay and gross pay from a line without rate or salary", () => {
    const bri = employee("Bri Alvarez");
    const line = lineOf(bri);
    const html = render(portalFor(bri, stripped(line)));
    expect(text(html)).toContain(`Hours pay ${money(line.straightTimePay)}`);
    expect(text(html)).toContain(`Estimated gross pay from hours and leave ${money(line.grossPay)}`);
    expect(html).not.toContain("Salary");
    expect(html).not.toContain("Not shown");
  });

  it("shows a salaried Manager's stripped salary as a dash, and still the gross pay", () => {
    const luis = employee("Luis Ortega");
    const line = lineOf(luis);
    const html = render(portalFor(luis, stripped(line)));
    expect(html).toContain('aria-label="Not shown"');
    expect(text(html)).toContain("Salary —");
    expect(text(html)).toContain(`Estimated gross pay from hours and leave ${money(line.grossPay)}`);
    expect(html).not.toContain("Hours pay");
  });

  it("shows the salary itself when the line carries it, as in demo mode", () => {
    const luis = employee("Luis Ortega");
    const line = lineOf(luis);
    const html = render(portalFor(luis, line));
    expect(text(html)).toContain(`Salary ${money(line.salaryAmount)}`);
    expect(html).not.toContain("Not shown");
  });
});
