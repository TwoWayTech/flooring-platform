import type { InAppNotification, NotificationRule, OutboxMessage } from "./notifications";
import type { Product, Roll } from "./catalog";
import type { Company, CompanyId, Role, User } from "./company";
import type {
  Bonus,
  ClockEntry,
  CommissionAdjustment,
  CommissionAssignment,
  CommissionPlan,
  CommissionStatement,
  ContractorPayment,
  Employee,
  PayPeriod,
  PtoRequest,
  TimeOffEntry,
  TimeOffPolicy,
  Timesheet,
} from "./hr";
import type {
  ChangeOrder,
  Contract,
  ContractBilling,
  ContractLine,
  InsuranceCertificate,
  LienWaiver,
} from "./contracts";
import type { Crew, Job } from "./installation";
import type { Meeting } from "./meetings";
import type {
  Bill,
  Expense,
  GoodsReceipt,
  PurchaseOrder,
  Supplier,
  SupplierPayment,
  SupplierContact,
} from "./purchasing";
import type { Location, StockMovement, Transfer } from "./locations";
import type { Reservation, StockAdjustment } from "./stock";
import type { Customer, Invoice, InvoiceAdjustment, Payment, Quote, Refund } from "./sales";
import type { AuditEntry, CompanySettings } from "./settings";
import type { ImportBatch, ImportMapping } from "../import/types";

/** The fixtures for one company, as the generator writes them. */
export interface CompanyFixtures {
  companyId: CompanyId;
  /** The date the fixtures were generated against; DemoStore shifts dates to today. */
  anchorDate: string;
  settings: CompanySettings;
  roles: Role[];
  users: User[];
  locations: Location[];
  products: Product[];
  rolls: Roll[];
  stockMovements: StockMovement[];
  transfers: Transfer[];
  reservations: Reservation[];
  stockAdjustments: StockAdjustment[];
  customers: Customer[];
  quotes: Quote[];
  invoices: Invoice[];
  payments: Payment[];
  invoiceAdjustments: InvoiceAdjustment[];
  refunds: Refund[];
  suppliers: Supplier[];
  supplierContacts: SupplierContact[];
  purchaseOrders: PurchaseOrder[];
  receipts: GoodsReceipt[];
  bills: Bill[];
  supplierPayments: SupplierPayment[];
  expenses: Expense[];
  crews: Crew[];
  jobs: Job[];
  contracts: Contract[];
  contractLines: ContractLine[];
  changeOrders: ChangeOrder[];
  contractBillings: ContractBilling[];
  lienWaivers: LienWaiver[];
  insuranceCertificates: InsuranceCertificate[];
  employees: Employee[];
  timesheets: Timesheet[];
  ptoRequests: PtoRequest[];
  timeOffPolicies: TimeOffPolicy[];
  timeOffEntries: TimeOffEntry[];
  clockEntries: ClockEntry[];
  payPeriods: PayPeriod[];
  bonuses: Bonus[];
  contractorPayments: ContractorPayment[];
  commissionPlans: CommissionPlan[];
  commissionAssignments: CommissionAssignment[];
  commissionStatements: CommissionStatement[];
  commissionAdjustments: CommissionAdjustment[];
  meetings: Meeting[];
  audit: AuditEntry[];
  /** Imports run in the demo, for the history and Undo (spec G1); none are generated. */
  importBatches: ImportBatch[];
  /** Column mappings saved per import kind (spec G1). */
  importMappings: ImportMapping[];
  /** A company's notification choices per event (spec A4); empty means the catalogue's defaults. */
  notificationRules: NotificationRule[];
  outboxMessages: OutboxMessage[];
  inAppNotifications: InAppNotification[];
}

/** Platform-level fixtures: the companies the super-admin manages. */
export interface PlatformFixtures {
  anchorDate: string;
  companies: Company[];
}
