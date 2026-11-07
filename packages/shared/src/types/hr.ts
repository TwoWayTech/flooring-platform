import type { CompanyId } from "./company";

/** An employee. Pay rate is sensitive (hr.employee.view_sensitive). */
export interface Employee {
  id: string;
  companyId: CompanyId;
  name: string;
  title: string;
  department: string;
  workerType: "w2" | "1099";
  payType: "hourly" | "salary" | "per_job";
  payRate: string;
  state: string;
  email: string;
  phone: string;
  hiredAt: string;
  status: "active" | "on_leave" | "terminated";
  ptoBalanceHours: string;
  managerId: string | null;
}

/** One week of hours for one employee, Monday first. */
export interface Timesheet {
  id: string;
  employeeId: string;
  weekStart: string;
  days: number[];
  status: "draft" | "submitted" | "approved";
}

/** A time-off request. */
export interface PtoRequest {
  id: string;
  employeeId: string;
  start: string;
  end: string;
  hours: string;
  kind: "vacation" | "sick" | "personal";
  status: "pending" | "approved" | "denied";
  note: string;
}

/** A monthly sales commission. */
export interface Commission {
  id: string;
  employeeId: string;
  month: string;
  sales: string;
  ratePct: string;
  amount: string;
}
