import type { Product, Roll } from "./catalog";
import type { Company, CompanyId, Role, User } from "./company";
import type { Commission, Employee, PtoRequest, Timesheet } from "./hr";
import type { Crew, Job } from "./installation";
import type { Meeting } from "./meetings";
import type { Bill, BillPayment, Expense, PurchaseOrder, Supplier } from "./purchasing";
import type { Customer, Invoice, Payment, Quote } from "./sales";
import type { AuditEntry, CompanySettings } from "./settings";

/** The fixtures for one company, as the generator writes them. */
export interface CompanyFixtures {
  companyId: CompanyId;
  /** The date the fixtures were generated against; DemoStore shifts dates to today. */
  anchorDate: string;
  settings: CompanySettings;
  roles: Role[];
  users: User[];
  products: Product[];
  rolls: Roll[];
  customers: Customer[];
  quotes: Quote[];
  invoices: Invoice[];
  payments: Payment[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  bills: Bill[];
  billPayments: BillPayment[];
  expenses: Expense[];
  crews: Crew[];
  jobs: Job[];
  employees: Employee[];
  timesheets: Timesheet[];
  ptoRequests: PtoRequest[];
  commissions: Commission[];
  meetings: Meeting[];
  audit: AuditEntry[];
}

/** Platform-level fixtures: the companies the super-admin manages. */
export interface PlatformFixtures {
  anchorDate: string;
  companies: Company[];
}
