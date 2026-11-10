import { dec } from "../../money";
import { timeOffBalance } from "../../hr/time-off";
import { US_STATES } from "../../us-pack/states";
import type { Employee, TimeOffEntry } from "../../types";
import { fold } from "../fields";
import { findParty, patched, text } from "../lookup";
import type { KindHandler, ParsedRow, PlanContext, RowOutcome, RowWrite } from "../plan";

const WORKER_TYPES: Record<Employee["workerType"], string> = { w2: "W-2 employee", "1099": "1099 contractor" };
const PAY_TYPES: Record<Employee["payType"], string> = { hourly: "Hourly", salary: "Salary", per_job: "Per job" };
const STATUSES: Record<Employee["status"], string> = {
  active: "Active",
  on_leave: "On leave",
  terminated: "Terminated",
};

/**
 * The opening vacation balance (ADR 0024): a balance is the sum of the ledger, so an imported
 * figure posts one adjustment for the difference, and nothing when it already matches.
 */
function balanceWrite(row: ParsedRow, ctx: PlanContext, employeeId: string): RowWrite[] {
  if (row.pto_hours === null) return [];
  const policy = ctx.world.timeOffPolicies.find((p) => p.kind === "vacation");
  if (!policy) return [];
  const change = dec(row.pto_hours as string).minus(timeOffBalance(ctx.world.timeOffEntries, employeeId, policy.id));
  if (change.isZero()) return [];
  const record: TimeOffEntry = {
    id: ctx.newId("tof"),
    employeeId,
    policyId: policy.id,
    date: ctx.today,
    kind: "adjustment",
    hours: change.toString(),
    note: "Imported opening balance",
    requestId: null,
    payPeriodId: null,
  };
  return [{ collection: "timeOffEntries", record }];
}

/**
 * Employees (spec G1): matched on email, then external ID. The manager must already be an
 * employee (or earlier in the same file). Pay rate is sensitive and is shown only with
 * hr.employee.view_sensitive, like on the employee screen.
 */
function resolveEmployee(row: ParsedRow, ctx: PlanContext): RowOutcome {
  const email = text(row, "email");
  const ext = text(row, "external_id");
  const { employees } = ctx.world;
  const existing =
    employees.find((e) => fold(e.email) === email) ??
    (ext ? employees.find((e) => e.externalId && fold(e.externalId) === fold(ext)) : undefined);
  const managerKey = text(row, "manager");
  const manager = managerKey ? findParty(employees, managerKey) : undefined;
  if (managerKey && !manager)
    return { problems: [{ field: "manager", message: `No employee matches “${managerKey}”.` }] };
  const name = text(row, "name");
  if (!existing) {
    const employee: Employee = {
      id: ctx.newId("emp"),
      companyId: ctx.companyId,
      externalId: ext || undefined,
      name,
      title: text(row, "title"),
      department: text(row, "department"),
      workerType: (row.worker_type as Employee["workerType"] | null) ?? "w2",
      payType: (row.pay_type as Employee["payType"] | null) ?? "hourly",
      payRate: text(row, "pay_rate"),
      state: text(row, "state"),
      email,
      phone: text(row, "phone"),
      hiredAt: text(row, "hired_at", ctx.today),
      status: (row.status as Employee["status"] | null) ?? "active",
      managerId: manager?.id ?? null,
      flsaStatus: row.worker_type === "1099" ? "not_applicable" : "non_exempt",
      exemptionBasis: null,
      salaryHoursPerWeek: 40,
      commissionVisible: null,
      homeLocationId: null,
      birthDate: null,
      emergencyContact: null,
      documents: [],
      onboarding: [],
      offboarding: [],
    };
    return {
      action: "create",
      label: name,
      writes: [{ collection: "employees", record: employee }, ...balanceWrite(row, ctx, employee.id)],
    };
  }
  const next = patched(existing, {
    externalId: ext || undefined,
    name,
    title: row.title as string | null,
    department: row.department as string | null,
    workerType: row.worker_type as Employee["workerType"] | null,
    payType: row.pay_type as Employee["payType"] | null,
    payRate: text(row, "pay_rate"),
    state: text(row, "state"),
    email,
    phone: row.phone as string | null,
    hiredAt: row.hired_at as string | null,
    status: row.status as Employee["status"] | null,
    managerId: manager?.id,
  });
  const balance = balanceWrite(row, ctx, existing.id);
  if (!next && balance.length === 0) return { action: "skip", label: name, writes: [], note: "Nothing changed." };
  return {
    action: "update",
    label: name,
    writes: [...(next ? [{ collection: "employees" as const, record: next }] : []), ...balance],
  };
}

/** The employees kind. */
export const EMPLOYEES: KindHandler = {
  labelField: "name",
  duplicateKey: (row) => text(row, "email"),
  resolve: resolveEmployee,
  def: {
    kind: "employees",
    label: "Employees",
    description: "People on payroll with title, department, pay and manager.",
    module: "hr",
    matchOn: "email, then External ID",
    fields: [
      {
        key: "external_id",
        label: "External ID",
        type: "text",
        aliases: ["id", "employee id", "employee number"],
        examples: ["E-0412", "E-0413"],
      },
      {
        key: "name",
        label: "Name",
        type: "text",
        required: true,
        aliases: ["employee", "full name", "employee name"],
        examples: ["Jordan Reyes", "Sam Ito"],
      },
      {
        key: "email",
        label: "Email",
        type: "email",
        required: true,
        aliases: ["work email", "email address"],
        examples: ["jordan.reyes@work.example", "sam.ito@work.example"],
      },
      {
        key: "title",
        label: "Title",
        type: "text",
        aliases: ["job title", "position"],
        examples: ["Installer", "Estimator"],
      },
      {
        key: "department",
        label: "Department",
        type: "text",
        aliases: ["dept", "team"],
        examples: ["Installation", "Sales"],
      },
      {
        key: "worker_type",
        label: "Worker type",
        type: "choice",
        choices: WORKER_TYPES,
        aliases: ["classification", "w2 or 1099"],
        examples: ["W-2 employee", "1099 contractor"],
      },
      {
        key: "pay_type",
        label: "Pay type",
        type: "choice",
        choices: PAY_TYPES,
        aliases: ["pay basis"],
        examples: ["Hourly", "Salary"],
      },
      {
        key: "pay_rate",
        label: "Pay rate",
        type: "money",
        required: true,
        aliases: ["rate", "wage", "salary", "hourly rate"],
        examples: ["28.50", "62000.00"],
      },
      {
        key: "state",
        label: "Work state",
        type: "choice",
        required: true,
        choices: Object.fromEntries(US_STATES),
        aliases: ["state", "work state"],
        examples: ["CO", "CO"],
      },
      {
        key: "phone",
        label: "Phone",
        type: "text",
        aliases: ["phone number", "mobile"],
        examples: ["(303) 555-0161", "(720) 555-0123"],
      },
      {
        key: "hired_at",
        label: "Hire date",
        type: "date",
        aliases: ["hired", "start date", "date hired"],
        examples: ["2024-03-18", "6/2/2025"],
      },
      {
        key: "status",
        label: "Status",
        type: "choice",
        choices: STATUSES,
        aliases: ["employment status"],
        examples: ["Active", "Active"],
      },
      {
        key: "pto_hours",
        label: "PTO balance (hours)",
        type: "number",
        aliases: ["pto", "pto balance", "vacation hours"],
        examples: ["40", "16"],
      },
      {
        key: "manager",
        label: "Manager",
        type: "text",
        aliases: ["manager email", "reports to", "supervisor"],
        examples: ["", "jordan.reyes@work.example"],
      },
    ],
  },
};
