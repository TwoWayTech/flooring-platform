import { addDays, daysBetween, last12Months, mondayOf } from "../../src/dates";
import { dec, moneyString, pctOf, sum } from "../../src/money";
import type { DefaultRoleKey } from "../../src/permissions/roles";
import type { Commission, Employee, Invoice, PtoRequest, Timesheet, User } from "../../src/types";
import type { PersonSeed } from "./companies";
import type { GenContext } from "./context";
import { emailFor } from "./random";

type Pay = Pick<Employee, "workerType" | "payType" | "payRate" | "department">;

/** Pay by role. Salaried rates are annual, hourly rates per hour (pay rate is sensitive data). */
function payFor(ctx: GenContext, role: DefaultRoleKey): Pay {
  const { rng } = ctx;
  const salary = (min: number, max: number, department: string): Pay => ({
    workerType: "w2",
    payType: "salary",
    payRate: `${rng.int(min, max) * 1000}.00`,
    department,
  });
  const hourly = (min: number, max: number, department: string): Pay => ({
    workerType: "w2",
    payType: "hourly",
    payRate: rng.money(min, max),
    department,
  });
  switch (role) {
    case "owner":
      return salary(130, 160, "Leadership");
    case "manager":
      return salary(78, 95, "Operations");
    case "accountant":
      return salary(64, 82, "Finance");
    case "hr":
      return salary(58, 74, "People");
    case "sales":
      return salary(46, 58, "Sales");
    case "purchasing":
      return salary(58, 72, "Purchasing");
    case "warehouse":
      return hourly(19, 26, "Warehouse");
    case "installer":
      return hourly(27, 38, "Installation");
    case "employee":
      return ctx.company.product === "hr" ? salary(48, 62, "Recruiting") : hourly(18, 24, "Office");
  }
}

/** Extra staff beyond the users: hourly warehouse and install help, or placed temps for staffing. */
const EXTRA_TITLES: Record<"flooring" | "hr", readonly (readonly [string, DefaultRoleKey | "contractor"])[]> = {
  flooring: [
    ["Warehouse associate", "warehouse"],
    ["Installer helper", "installer"],
    ["Delivery driver", "warehouse"],
    ["Contract estimator", "contractor"],
  ],
  hr: [
    ["Light industrial associate", "employee"],
    ["Forklift operator", "employee"],
    ["Event staff", "employee"],
    ["Contract recruiter", "contractor"],
  ],
};

function extraEmployee(ctx: GenContext, index: number, ownerId: string): Employee {
  const { rng, company } = ctx;
  const [title, kind] = rng.pick(EXTRA_TITLES[company.product]);
  const placedInCa = company.id === "harbor" && index % 4 === 0;
  const name = rng.personName();
  const pay: Pay =
    kind === "contractor"
      ? { workerType: "1099", payType: "hourly", payRate: rng.money(38, 55), department: "Contractors" }
      : company.product === "hr"
        ? { workerType: "w2", payType: "hourly", payRate: rng.money(17, 26), department: "Placements" }
        : payFor(ctx, kind);
  return {
    id: ctx.id("emp"),
    companyId: company.id,
    name,
    title,
    ...pay,
    state: placedInCa ? "CA" : company.state,
    email: emailFor(name, company.domain),
    phone: rng.phone(placedInCa ? "619" : company.areaCode),
    hiredAt: addDays(ctx.anchor, -rng.int(40, 1500)),
    status: rng.chance(0.05) ? "on_leave" : "active",
    ptoBalanceHours: String(rng.int(0, 96)),
    managerId: ownerId,
  };
}

function personEmployee(ctx: GenContext, person: PersonSeed, ownerId: string | null, id: string): Employee {
  const { rng, company } = ctx;
  const branchState = company.branches[person.branch]!.state;
  return {
    id,
    companyId: company.id,
    name: person.name,
    title: person.title,
    ...payFor(ctx, person.role),
    state: branchState,
    email: emailFor(person.name, company.domain),
    phone: rng.phone(branchState === "CA" ? "619" : company.areaCode),
    hiredAt: addDays(ctx.anchor, person.status === "invited" ? -rng.int(1, 10) : -rng.int(200, 2600)),
    status: person.status === "disabled" ? "terminated" : "active",
    ptoBalanceHours: String(rng.int(8, 120)),
    managerId: ownerId === id ? null : ownerId,
  };
}

/** Employees: the company's users first (same order), then extra staff up to the spec's headcount. */
export function buildEmployees(ctx: GenContext): Employee[] {
  const ids = ctx.company.people.map(() => ctx.id("emp"));
  const ownerId = ids[0]!;
  const people = ctx.company.people.map((p, i) => personEmployee(ctx, p, ownerId, ids[i]!));
  const extras = Array.from({ length: ctx.company.employeeCount - people.length }, (_, i) =>
    extraEmployee(ctx, i, ownerId),
  );
  return [...people, ...extras];
}

/**
 * A week of hours, Monday first. About one week in five runs long (overtime under the federal
 * 40-hour rule), and California workers sometimes work 10-hour days, which is daily overtime
 * under the California example rule (spec section 1, US pack).
 */
function weekHours(ctx: GenContext, employee: Employee, daysWorked: number): number[] {
  const { rng } = ctx;
  const long = rng.chance(0.2);
  return Array.from({ length: 7 }, (_, day) => {
    if (day >= daysWorked) return 0;
    if (day === 5) return long ? rng.pick([4, 5, 6]) : 0;
    if (day === 6) return 0;
    if (employee.state === "CA" && rng.chance(0.25)) return 10;
    if (long && rng.chance(0.5)) return rng.pick([9.5, 10, 10.5]);
    return rng.pick([7.5, 8, 8, 8]);
  });
}

/** Eight weeks of timesheets for active hourly W-2 staff; this week is still a draft. */
export function buildTimesheets(ctx: GenContext, employees: readonly Employee[]): Timesheet[] {
  const thisWeek = mondayOf(ctx.anchor);
  const daysSoFar = daysBetween(thisWeek, ctx.anchor) + 1;
  const hourly = employees.filter((e) => e.status === "active" && e.payType === "hourly" && e.workerType === "w2");
  return Array.from({ length: 8 }, (_, k) => addDays(thisWeek, -7 * k)).flatMap((weekStart, k) =>
    hourly.map((employee) => ({
      id: ctx.id("ts"),
      employeeId: employee.id,
      weekStart,
      days: weekHours(ctx, employee, k === 0 ? daysSoFar : 7),
      status: k === 0 ? "draft" : k === 1 && ctx.rng.chance(0.6) ? "submitted" : "approved",
    })),
  );
}

const PTO_COUNTS: Record<string, number> = { summit: 8, keystone: 6, harbor: 12 };

/** Time-off requests around the anchor date: past ones decided, future ones mostly pending. */
export function buildPto(ctx: GenContext, employees: readonly Employee[]): PtoRequest[] {
  const active = employees.filter((e) => e.status === "active");
  return Array.from({ length: PTO_COUNTS[ctx.company.id] ?? 0 }, () => {
    const start = addDays(ctx.anchor, ctx.rng.int(-60, 45));
    const days = ctx.rng.int(1, 5);
    const past = start < ctx.anchor;
    return {
      id: ctx.id("pto"),
      employeeId: ctx.rng.pick(active).id,
      start,
      end: addDays(start, days - 1),
      hours: String(days * 8),
      kind: ctx.rng.pick(["vacation", "vacation", "sick", "personal"] as const),
      status: past ? (ctx.rng.chance(0.85) ? "approved" : "denied") : ctx.rng.chance(0.7) ? "pending" : "approved",
      note: ctx.rng.chance(0.4) ? ctx.rng.pick(["Family trip", "Medical appointment", "Moving day"]) : "",
    };
  });
}

/** Commission rate on a rep's net sales (subtotal, before tax), paid monthly. */
const COMMISSION_PCT = "4";

/**
 * Monthly commissions for sales reps, computed from their invoices: net sales (returns
 * subtracted) times the commission rate. Never typed by hand (spec section 4).
 */
export function buildCommissions(ctx: GenContext, users: readonly User[], invoices: readonly Invoice[]): Commission[] {
  const reps = users.filter((u) => u.employeeId && u.roleIds.some((r) => r.endsWith("-role-sales")));
  return last12Months(ctx.anchor).flatMap((month) =>
    reps.map((rep) => {
      const sales = sum(
        invoices
          .filter((i) => i.salesRepId === rep.id && !i.voidedAt && i.issuedAt.startsWith(month))
          .map((i) => (i.isReturn ? dec(i.subtotal).negated() : i.subtotal)),
      );
      return {
        id: ctx.id("com"),
        employeeId: rep.employeeId!,
        month,
        sales: moneyString(sales),
        ratePct: COMMISSION_PCT,
        amount: moneyString(pctOf(sales, COMMISSION_PCT)),
      };
    }),
  );
}
