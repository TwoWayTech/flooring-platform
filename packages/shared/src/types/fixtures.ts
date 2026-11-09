import type { Product, Roll } from "./catalog";
import type { Company, CompanyId, Role, User } from "./company";
import type { Commission, Employee, PtoRequest, Timesheet } from "./hr";
import type { Crew, Job } from "./installation";
import type { Meeting } from "./meetings";
import type { Bill, Expense, GoodsReceipt, PurchaseOrder, Supplier, SupplierPayment } from "./purchasing";
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
  purchaseOrders: PurchaseOrder[];
  receipts: GoodsReceipt[];
  bills: Bill[];
  supplierPayments: SupplierPayment[];
  expenses: Expense[];
  crews: Crew[];
  jobs: Job[];
  employees: Employee[];
  timesheets: Timesheet[];
  ptoRequests: PtoRequest[];
  commissions: Commission[];
  meetings: Meeting[];
  audit: AuditEntry[];
  /** Imports run in the demo, for the history and Undo (spec G1); none are generated. */
  importBatches: ImportBatch[];
  /** Column mappings saved per import kind (spec G1). */
  importMappings: ImportMapping[];
}

/** Platform-level fixtures: the companies the super-admin manages. */
export interface PlatformFixtures {
  anchorDate: string;
  companies: Company[];
}
