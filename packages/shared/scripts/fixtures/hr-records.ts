import { addDays, last12Months, mondayOf } from "../../src/dates";
import {
  commissionAllocations,
  commissionLines,
  planOn,
  statementChain,
  statementKey,
  type CommissionInputs,
  type StatementFigures,
} from "../../src/hr/commission-plans";
import { grossPay } from "../../src/hr/pay";
import { newChecklist, OFFBOARDING_STEPS, ONBOARDING_STEPS } from "../../src/hr/people";
import { accrualFor, timeOffBalance } from "../../src/hr/time-off";
import { needsTimesheet } from "../../src/hr/timesheets";
import { dec } from "../../src/money";
import type {
  Bonus,
  CommissionAssignment,
  CommissionPlan,
  CommissionStatement,
  CompanyFixtures,
  ContractorPayment,
  Employee,
  PayPeriod,
  PtoRequest,
  TimeOffEntry,
  TimeOffPolicy,
  Timesheet,
} from "../../src/types";
import type { GenContext } from "./context";
import { Rng } from "./random";

/** The id of a company's policy of one kind; every company has one of each. */
export const policyIdFor = (prefix: string, kind: TimeOffPolicy["kind"]) => `${prefix}-pol-${kind}`;

const EXEMPT_ROLES: Record<string, Employee["exemptionBasis"]> = {
  owner: "executive",
  manager: "executive",
  accountant: "administrative",
  hr: "administrative",
  purchasing: "administrative",
};

/** The person who decides time and pay in the seed: HR if the company has one, else the owner. */
function approverName(f: CompanyFixtures): string {
  const hr = f.roles.find((r) => r.key === "hr");
  return f.users.find((u) => hr && u.roleIds.includes(hr.id))?.name ?? f.users[0]!.name;
}

/** A birth date a whole number of years before a day near the anchor, so Home has some coming up. */
function birthDate(rng: Rng, anchor: string, index: number): string {
  const near = addDays(anchor, index < 3 ? rng.int(2, 13) : rng.int(-180, 180));
  return `${Number(near.slice(0, 4)) - rng.int(24, 58)}${near.slice(4)}`;
}

/** Fills in what ADR 0024 adds to each person: FLSA status, home location, documents, checklists. */
function withPeople(ctx: GenContext, rng: Rng, f: CompanyFixtures): Employee[] {
  const roleKey = new Map(
    f.users.flatMap((u) => {
      const key = f.roles.find((r) => u.roleIds.includes(r.id))?.key;
      return u.employeeId && key ? [[u.employeeId, key] as const] : [];
    }),
  );
  const managerRole = f.roles.find((r) => r.key === "manager");
  const managerUser = f.users.find((u) => managerRole && u.roleIds.includes(managerRole.id) && u.status === "active");
  const firstWarehouse = f.locations[0]?.id ?? null;
  return f.employees.map((e, i) => {
    const key = roleKey.get(e.id);
    const basis = key ? (EXEMPT_ROLES[key] ?? null) : null;
    const exempt = e.workerType === "w2" && basis !== null && e.payType === "salary";
    const user = f.users.find((u) => u.employeeId === e.id);
    const isNew = e.hiredAt >= addDays(ctx.anchor, -90);
    const onboarding = newChecklist(ONBOARDING_STEPS, `${e.id}-on`).map((item, at) => ({
      ...item,
      doneAt: isNew && at >= 3 ? null : `${addDays(e.hiredAt, at + 1)}T10:00`,
    }));
    return {
      ...e,
      managerId: user ? e.managerId : (managerUser?.employeeId ?? e.managerId),
      flsaStatus: e.workerType === "1099" ? "not_applicable" : exempt ? "exempt" : "non_exempt",
      exemptionBasis: exempt ? basis : null,
      homeLocationId: user?.defaultLocationId ?? firstWarehouse,
      commissionVisible: i === 2 && f.invoices.length > 0 ? true : null,
      birthDate: birthDate(rng, ctx.anchor, i),
      emergencyContact: {
        name: rng.personName(),
        phone: rng.phone(ctx.company.areaCode),
        relation: rng.pick(["Spouse", "Parent", "Sibling"]),
      },
      documents: [
        {
          id: `${e.id}-doc-offer`,
          name: "Offer letter.pdf",
          type: "application/pdf",
          size: 48210,
          uploadedBy: "HR",
          uploadedAt: `${e.hiredAt}T09:00`,
        },
      ],
      onboarding,
      offboarding: e.status === "terminated" ? newChecklist(OFFBOARDING_STEPS, `${e.id}-off`) : [],
    } satisfies Employee;
  });
}

/** Salaried non-exempt staff also fill in timesheets (ADR 0024); added last so the seed stream holds. */
function salariedSheets(ctx: GenContext, rng: Rng, employees: readonly Employee[]): Timesheet[] {
  const thisWeek = mondayOf(ctx.anchor);
  const salaried = employees.filter((e) => e.payType === "salary" && needsTimesheet(e) && e.status === "active");
  return Array.from({ length: 8 }, (_, k) => addDays(thisWeek, -7 * k)).flatMap((weekStart, k) =>
    salaried.map((employee): Timesheet => {
      const long = rng.chance(0.25);
      const soFar = k === 0 ? Math.round((Date.parse(ctx.anchor) - Date.parse(thisWeek)) / 86_400_000) + 1 : 5;
      return {
        id: ctx.id("ts"),
        employeeId: employee.id,
        weekStart,
        days: Array.from({ length: 7 }, (_, d) => (d < Math.min(soFar, 5) ? (long && d < 3 ? 10 : 8) : 0)),
        status: k === 0 ? "draft" : k === 1 && rng.chance(0.5) ? "submitted" : "approved",
        submittedAt: null,
        decidedBy: null,
        decidedAt: null,
        rejectionReason: null,
        source: "form",
        history: [],
      };
    }),
  );
}

/** Adds submit and decide details to each sheet, and one sent back for correcting. */
function withSheetHistory(sheets: readonly Timesheet[], approver: string, employees: readonly Employee[]): Timesheet[] {
  let rejected = false;
  return sheets.map((sheet) => {
    if (sheet.status === "draft") return sheet;
    const submittedAt = `${addDays(sheet.weekStart, 7)}T16:30`;
    const by = employees.find((e) => e.id === sheet.employeeId)?.name ?? "Employee";
    const submitted = { at: submittedAt, by, action: "submitted" as const, reason: null };
    if (sheet.status === "submitted" && !rejected) {
      rejected = true;
      const reason = "Tuesday looks short. Add the hours from the late delivery.";
      const decidedAt = `${addDays(sheet.weekStart, 8)}T09:10`;
      return {
        ...sheet,
        status: "rejected" as const,
        submittedAt,
        decidedBy: approver,
        decidedAt,
        rejectionReason: reason,
        history: [submitted, { at: decidedAt, by: approver, action: "rejected" as const, reason }],
      };
    }
    if (sheet.status === "submitted") return { ...sheet, submittedAt, history: [submitted] };
    const decidedAt = `${addDays(sheet.weekStart, 8)}T09:30`;
    return {
      ...sheet,
      submittedAt,
      decidedBy: approver,
      decidedAt,
      history: [submitted, { at: decidedAt, by: approver, action: "approved" as const, reason: null }],
    };
  });
}

/** Vacation, sick, personal and unpaid. Vacation has a cap and no carryover limit, so it is California-safe. */
function buildPolicies(prefix: string): TimeOffPolicy[] {
  const base = { annualUseLimitHours: "", carryoverHours: "", waitingPeriodDays: 0, allowNegative: false };
  return [
    {
      ...base,
      id: policyIdFor(prefix, "vacation"),
      name: "Vacation",
      kind: "vacation",
      paid: true,
      accrualMethod: "per_pay_period",
      accrualRate: "3.08",
      capHours: "120",
    },
    {
      ...base,
      id: policyIdFor(prefix, "sick"),
      name: "Sick leave",
      kind: "sick",
      paid: true,
      accrualMethod: "per_hour_worked",
      accrualRate: "0.0333",
      capHours: "80",
      annualUseLimitHours: "40",
    },
    {
      ...base,
      id: policyIdFor(prefix, "personal"),
      name: "Personal days",
      kind: "personal",
      paid: true,
      accrualMethod: "annual_grant",
      accrualRate: "16",
      capHours: "",
    },
    {
      ...base,
      id: policyIdFor(prefix, "unpaid"),
      name: "Unpaid leave",
      kind: "unpaid",
      paid: false,
      accrualMethod: "none",
      accrualRate: "0",
      capHours: "",
    },
  ];
}

/** Marks past decisions and posts the ledger: opening balance, then what approved requests used. */
function withTimeOff(
  ctx: GenContext,
  rng: Rng,
  f: CompanyFixtures,
  employees: readonly Employee[],
  approver: string,
  policies: readonly TimeOffPolicy[],
) {
  const requests: PtoRequest[] = f.ptoRequests.map((r) => ({
    ...r,
    decidedBy: r.status === "pending" ? null : approver,
    decidedAt: r.status === "pending" ? null : `${addDays(r.start, -3)}T11:00`,
    decisionReason: r.status === "denied" ? "Too many people are out that week." : null,
  }));
  const entries: TimeOffEntry[] = [];
  const post = (e: Omit<TimeOffEntry, "id" | "requestId" | "payPeriodId">, requestId: string | null = null) =>
    entries.push({ ...e, id: ctx.id("tof"), requestId, payPeriodId: null });
  for (const r of requests.filter((x) => x.status === "approved")) {
    post(
      {
        employeeId: r.employeeId,
        policyId: r.policyId,
        date: r.start,
        kind: "used",
        hours: dec(r.hours).negated().toString(),
        note: "Time off taken",
      },
      r.id,
    );
  }
  const used = (employeeId: string, policyId: string) => timeOffBalance(entries, employeeId, policyId).negated();
  for (const e of employees.filter((x) => x.workerType === "w2")) {
    for (const policy of policies.filter((p) => p.accrualMethod !== "none")) {
      const opening =
        policy.kind === "vacation" ? (ctx.openingPto.get(e.id) ?? 40) : policy.kind === "sick" ? rng.int(8, 40) : 16;
      post({
        employeeId: e.id,
        policyId: policy.id,
        date: addDays(ctx.anchor, -120),
        kind: "carryover",
        hours: used(e.id, policy.id).plus(opening).toString(),
        note: "Opening balance",
      });
    }
  }
  return { requests, entries };
}

/** Three plans: showroom on paid revenue, commercial on margin, and a new-rep plan with a draw (ADR 0025). */
function buildPlans(prefix: string): CommissionPlan[] {
  const base = {
    version: 1,
    status: "active" as const,
    effectiveFrom: "2024-01-01",
    effectiveTo: null,
    tierMode: "marginal" as const,
    clawbackDays: 90,
  };
  return [
    {
      ...base,
      id: `${prefix}-plan-showroom`,
      name: "Showroom plan",
      basis: "paid_revenue",
      baseRatePct: "5",
      monthlyTarget: "50000",
      tiers: [{ fromPctOfTarget: "100", ratePct: "6" }],
      overridePct: "0",
      draw: { kind: "none", monthlyAmount: "0" },
    },
    {
      ...base,
      id: `${prefix}-plan-margin`,
      name: "Commercial margin plan",
      basis: "gross_margin",
      baseRatePct: "20",
      monthlyTarget: "15000",
      tiers: [{ fromPctOfTarget: "100", ratePct: "25" }],
      overridePct: "2",
      draw: { kind: "none", monthlyAmount: "0" },
    },
    {
      ...base,
      id: `${prefix}-plan-newrep`,
      name: "New rep plan",
      basis: "paid_revenue",
      baseRatePct: "5",
      monthlyTarget: "30000",
      tiers: [],
      overridePct: "0",
      draw: { kind: "recoverable", monthlyAmount: "1500" },
    },
  ];
}

/** Everyone in Sales gets a plan; the last rep is unsigned, so the acknowledgement step can be shown. */
function buildAssignments(
  ctx: GenContext,
  f: CompanyFixtures,
  plans: readonly CommissionPlan[],
): CommissionAssignment[] {
  const sales = f.roles.find((r) => r.key === "sales");
  const reps = f.users.filter((u) => sales && u.roleIds.includes(sales.id) && u.status !== "disabled");
  return reps.map((rep, i) => {
    const plan = plans[/commercial|account/i.test(rep.title) ? 1 : i === reps.length - 2 && reps.length > 3 ? 2 : 0]!;
    return {
      id: ctx.id("casg"),
      userId: rep.id,
      planId: plan.id,
      effectiveFrom: "2024-01-01",
      effectiveTo: null,
      monthlyTargetOverride: null,
      acknowledgement:
        i === reps.length - 1 ? null : { signedName: rep.name, signedAt: `${addDays(ctx.anchor, -300)}T10:00` },
    };
  });
}

/** Shares two invoices between two reps (spec C1 "split between two reps"). */
function withSplits(rng: Rng, f: CompanyFixtures) {
  const sales = f.roles.find((r) => r.key === "sales");
  const reps = f.users.filter((u) => sales && u.roleIds.includes(sales.id) && u.status === "active");
  if (reps.length < 2) return f.invoices;
  const paid = new Set(f.payments.filter((p) => p.status === "confirmed").map((p) => p.invoiceId));
  const candidates = f.invoices.filter(
    (i) => paid.has(i.id) && !i.isReturn && !i.voidedAt && i.salesRepId === reps[0]!.id,
  );
  const chosen = new Set([rng.pick(candidates)?.id, rng.pick(candidates)?.id]);
  return f.invoices.map((i) =>
    chosen.has(i.id)
      ? {
          ...i,
          commissionSplit: [
            { userId: reps[0]!.id, pct: "60" },
            { userId: reps[1]!.id, pct: "40" },
          ],
        }
      : i,
  );
}

/** Statements: months before the last complete month are paid, the rest are computed and open. */
function buildStatements(
  ctx: GenContext,
  f: CompanyFixtures,
  inputs: CommissionInputs,
  approver: string,
): {
  statements: CommissionStatement[];
  months: string[];
  chains: Map<string, StatementFigures[]>;
} {
  const months = last12Months(ctx.anchor);
  const paidMonths = months.slice(0, -2);
  const people = [...new Set(inputs.assignments.map((a) => a.userId))];
  const managers = people.flatMap((u) => inputs.managerOf(u) ?? []);
  const everyone = [...new Set([...people, ...managers])];
  const frozen = new Set(everyone.flatMap((u) => paidMonths.map((m) => statementKey(u, m))));
  const lines = commissionLines({ ...inputs, frozen });
  const statements: CommissionStatement[] = [];
  const chains = new Map<string, StatementFigures[]>();
  for (const userId of everyone) {
    const chain = statementChain(
      userId,
      months,
      lines,
      f.commissionAdjustments,
      (month) => planOn(inputs, userId, `${month}-15`)?.plan ?? null,
    );
    chains.set(userId, chain);
    for (const figures of chain) {
      if (!paidMonths.includes(figures.month) || figures.lines.length === 0) continue;
      statements.push({
        id: ctx.id("cst"),
        userId,
        month: figures.month,
        status: "paid",
        approvedBy: approver,
        approvedAt: `${addDays(`${figures.month}-28`, 7)}T10:00`,
        payPeriodId: null,
      });
    }
  }
  return { statements, months, chains };
}

/** Two bonuses in the last paid period: one production (counts for overtime), one discretionary. */
function buildBonuses(
  ctx: GenContext,
  employees: readonly Employee[],
  period: Pick<PayPeriod, "start" | "end">,
  approver: string,
): Bonus[] {
  const hourly = employees.filter((e) => e.payType === "hourly" && e.workerType === "w2" && e.status === "active");
  const base = { periodStart: period.start, periodEnd: period.end, approvedBy: approver };
  return [
    ...(hourly[0]
      ? [
          {
            ...base,
            id: ctx.id("bon"),
            employeeId: hourly[0].id,
            amount: "250.00",
            kind: "production" as const,
            reason: "Quarterly count accuracy target met",
          },
        ]
      : []),
    ...(hourly[1]
      ? [
          {
            ...base,
            id: ctx.id("bon"),
            employeeId: hourly[1].id,
            amount: "150.00",
            kind: "discretionary" as const,
            reason: "Stayed late for the storm cleanup",
          },
        ]
      : []),
  ];
}

/** A pay calendar around the anchor: older periods exported, last one in review, this one open. */
function buildPeriods(ctx: GenContext, f: CompanyFixtures): PayPeriod[] {
  const { payFrequency: frequency, payPeriodAnchor: anchor } = f.settings.hr;
  const length = frequency === "weekly" ? 7 : 14;
  const thisWeek = mondayOf(ctx.anchor);
  const out: PayPeriod[] = [];
  for (let start = anchor; start <= ctx.anchor; start = addDays(start, length)) {
    const end = addDays(start, length - 1);
    const status = end < addDays(thisWeek, -7) ? "exported" : end >= ctx.anchor ? "open" : "in_review";
    out.push({
      id: ctx.id("pp"),
      frequency,
      start,
      end,
      payDate: addDays(end, 5),
      status,
      approvedBy: null,
      approvedAt: null,
      exportedAt: null,
      excluded: [],
      lines: [],
    });
  }
  return out;
}

function buildContractorPayments(ctx: GenContext, rng: Rng, employees: readonly Employee[]): ContractorPayment[] {
  return employees
    .filter((e) => e.workerType === "1099" && e.status === "active")
    .flatMap((e) =>
      Array.from({ length: 3 }, (_, i): ContractorPayment => ({
        id: ctx.id("cpay"),
        employeeId: e.id,
        date: addDays(ctx.anchor, -12 - i * 21),
        description: rng.pick(["Project estimate", "Site measure", "Contract job", "Placement fee"]),
        amount: rng.money(400, 2200),
        status: i === 0 ? "approved" : "paid",
      })),
    );
}

/**
 * Runs last, on its own random stream, so nothing above it changes (CLAUDE.md rule 5). Past pay
 * periods are worked out with the same calculators the screens use, so seeded pay reconciles.
 */
export function withHrRecords(ctx: GenContext, f: CompanyFixtures): CompanyFixtures {
  const rng = new Rng(ctx.company.seed + 11);
  const approver = approverName(f);
  const prefix = ctx.company.idPrefix;
  const employees = withPeople(ctx, rng, f);
  const timesheets = withSheetHistory([...f.timesheets, ...salariedSheets(ctx, rng, employees)], approver, employees);
  const timeOffPolicies = buildPolicies(prefix);
  const { requests: ptoRequests, entries } = withTimeOff(ctx, rng, f, employees, approver, timeOffPolicies);
  const invoices = withSplits(rng, f);
  const commissionPlans = f.invoices.length ? buildPlans(prefix) : [];
  const commissionAssignments = f.invoices.length ? buildAssignments(ctx, f, commissionPlans) : [];
  const userOf = (employeeId: string | null) => f.users.find((u) => u.employeeId === employeeId) ?? null;
  const managerOf = (userId: string) => {
    const self = f.users.find((u) => u.id === userId);
    return userOf(employees.find((e) => e.id === self?.employeeId)?.managerId ?? null)?.id ?? null;
  };
  const inputs: CommissionInputs = {
    plans: commissionPlans,
    assignments: commissionAssignments,
    invoices,
    payments: f.payments,
    adjustments: f.invoiceAdjustments,
    managerOf,
    frozen: new Set(),
    today: ctx.anchor,
  };
  const { statements, months, chains } = buildStatements(ctx, f, inputs, approver);

  const payPeriods = buildPeriods(ctx, f);
  const exported = payPeriods.filter((p) => p.status === "exported");
  const lastPaid = exported.at(-1)!;
  const bonuses = buildBonuses(ctx, employees, lastPaid, approver);
  const paidThisRun = months.at(-3)!;
  for (const s of statements) if (s.month === paidThisRun) s.payPeriodId = lastPaid.id;

  for (const period of exported) {
    const inPeriod = statements.filter((s) => s.payPeriodId === period.id);
    period.lines = employees.flatMap((employee) => {
      if (employee.status === "terminated" || employee.hiredAt > period.end) return [];
      const user = userOf(employee.id);
      const own = inPeriod.filter((s) => s.userId === user?.id);
      const figures = own.flatMap((s) => chains.get(s.userId)?.find((c) => c.month === s.month) ?? []);
      const line = grossPay({
        employee,
        period,
        sheets: timesheets.filter((s) => s.employeeId === employee.id),
        leave: ptoRequests.filter((r) => r.employeeId === employee.id),
        policies: timeOffPolicies,
        companyRule: f.settings.localization.payroll.overtimeRule,
        commission: figures.reduce((total, c) => total.plus(c.payable), dec(0)).toFixed(2),
        bonuses: bonuses.filter((b) => b.employeeId === employee.id && b.periodStart === period.start),
        allocations: commissionAllocations(
          figures.flatMap((c) => c.lines),
          f.settings.hr.workweekStartDay,
        ),
      });
      return line ? [line] : [];
    });
    period.approvedBy = approver;
    period.approvedAt = `${addDays(period.end, 2)}T10:00`;
    period.exportedAt = `${addDays(period.end, 3)}T10:00`;
    for (const line of period.lines) {
      for (const policy of timeOffPolicies.filter(
        (p) => p.accrualMethod === "per_pay_period" || p.accrualMethod === "per_hour_worked",
      )) {
        const hours = accrualFor(policy, timeOffBalance(entries, line.employeeId, policy.id), line.hoursWorked);
        if (hours.lte(0)) continue;
        entries.push({
          id: ctx.id("tof"),
          employeeId: line.employeeId,
          policyId: policy.id,
          date: period.end,
          kind: "accrual",
          hours: hours.toDecimalPlaces(2).toString(),
          note: "Accrued with payroll",
          requestId: null,
          payPeriodId: period.id,
        });
      }
    }
  }

  return {
    ...f,
    employees,
    timesheets,
    ptoRequests,
    invoices,
    timeOffPolicies,
    timeOffEntries: entries,
    payPeriods,
    bonuses,
    contractorPayments: buildContractorPayments(ctx, rng, employees),
    commissionPlans,
    commissionAssignments,
    commissionStatements: statements,
  };
}
