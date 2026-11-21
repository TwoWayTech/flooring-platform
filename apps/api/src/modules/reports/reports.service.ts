import { Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  businessReport,
  businessWindow,
  capDrillRecords,
  featureOn,
  hubWindow,
  paymentsReport,
  pnlReport,
  reportAccess,
  reportVisibility,
  salesByCategoryReport,
  seesTrialBalance,
  type BusinessData,
  type BusinessFilters,
  type BusinessReport,
  type PaymentsReportQuery,
  type PnlQuery,
  type Report,
  type ReportOptions,
  type ReportVisibility,
  type SalesByCategoryQuery,
} from "@workspace/shared";
import type { RequestAccess } from "../../core/access/access.service";
import { CONTROL_DB } from "../../core/database/control-db";
import { LedgerService } from "../../core/ledger/ledger.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { loadLocations, loadProducts, loadRolls } from "../inventory/inventory-records";
import { loadNames } from "../sales/invoice-records";
import { companyClock, seesCustomer, seesDocument } from "../sales/sales-common";
import { loadBranches } from "../sales/sales-records";
import { checkHubLocation, checkLocations, checkWarehouse } from "./report-params";
import {
  hasContractInvoices,
  loadAdjustmentRows,
  loadBillRows,
  loadCustomerRows,
  loadEmployeeRows,
  loadExpenseRows,
  loadInvoiceHeads,
  loadInvoiceHeadsById,
  loadInvoiceRepIds,
  loadMovementTotals,
  loadOrderRows,
  loadPaymentRows,
  loadPayRows,
  loadProductCategories,
  loadReceiptRows,
  loadRefundRows,
  loadSalesLines,
  loadSharedCosts,
  loadSupplierNames,
  loadSupplierPaymentRows,
  loadVendorOptions,
  readSnapshot,
  withLines,
  type ReportInvoice,
} from "./report-records";

/** Who a rep id no longer in the control database reads as (spec rule 15, as the demo shows it). */
const FORMER_EMPLOYEE = "Former employee";

/** What a person may see inside reports, from their effective permissions and one fact of the data (ADR 0055). */
async function visibilityFor(tx: CompanyDb, access: RequestAccess): Promise<ReportVisibility> {
  return reportVisibility(access, { hasContractInvoices: await hasContractInvoices(tx) });
}

/**
 * The reports (spec docs/product-spec/reports.md; ADR 0055). Every report reads the company's
 * documents in one read-only snapshot, narrowed to the columns and dates it needs, and runs the
 * same shared calculation as the demo. Hidden figures are never computed (S7); nothing is written,
 * audited or notified, and no figure is logged.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * What the reports page may offer this person (ADR 0055 S1, S15): the reports they may open and
   * export, the live locations, and the Business report's pickers only when they may open it.
   */
  async options(tenant: TenantContext, access: RequestAccess): Promise<ReportOptions> {
    // The trial balance is listed only when GET /ledger/trial-balance would answer: its route checks
    // first, then the sight rule on the journal's facts (ADR 0055 "Trial balance").
    const mayAskBooks = reportAccess(access, featureOn, true).reports.includes("trial-balance");
    const read = await readSnapshot(await this.tenancy.db(tenant), async (tx) => {
      const books = mayAskBooks && seesTrialBalance(access, await this.ledger.trialBalanceFacts(tx));
      const offer = reportAccess(access, featureOn, books);
      const withPickers = offer.reports.includes("business");
      return {
        ...offer,
        locations: await loadLocations(tx),
        repIds: withPickers ? await loadInvoiceRepIds(tx) : [],
        vendors: withPickers ? await loadVendorOptions(tx) : [],
      };
    });
    const { reports, exports } = read;
    const names = await loadNames(this.control.db, read.repIds);
    const salespeople = read.repIds
      .map((id) => ({ id, name: names.get(id) ?? FORMER_EMPLOYEE }))
      .sort((a, b) => a.name.localeCompare(b.name, "en") || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      reports,
      exports,
      locations: read.locations.map(({ id, name, kind }) => ({ id, name, kind })),
      salespeople,
      vendors: read.vendors,
    };
  }

  /**
   * The Business report (spec F2, rules 1 to 23), for data scope `all` only (S1, checked by the
   * controller). It reads only the documents `businessWindow` names: the period and the one before
   * it, plus the history balances need. Drill lists are capped at 200 per row (S8).
   */
  async business(tenant: TenantContext, access: RequestAccess, filters: BusinessFilters): Promise<BusinessReport> {
    const clock = await companyClock(this.control.db, tenant);
    const w = businessWindow(filters, clock.day);
    const { data, show } = await readSnapshot(await this.tenancy.db(tenant), async (tx) => {
      const locations = await loadLocations(tx);
      checkLocations(filters.locationIds, locations);
      const show = await visibilityFor(tx, access);
      const adjustments = await loadAdjustmentRows(tx, clock.zone, w.historyTo);
      const heads = await loadInvoiceHeads(tx, clock.zone, { to: w.headsTo });
      // A write-off in the window counts at its invoice's location whenever the invoice was issued
      // (rule 8), so an invoice issued after the period's month is read by id (ADR 0055).
      const known = new Set(heads.map((head) => head.id));
      const writtenOff = adjustments
        .filter((a) => a.kind === "write_off" && a.at.slice(0, 10) >= w.datedFrom && a.at.slice(0, 10) <= w.datedTo)
        .map((a) => a.invoiceId)
        .filter((id) => !known.has(id));
      const allHeads = [...heads, ...(await loadInvoiceHeadsById(tx, clock.zone, [...new Set(writtenOff)]))];
      const counted = new Set(
        allHeads
          .filter((head) => !head.voidedAt && head.issuedAt >= w.datedFrom && head.issuedAt <= w.datedTo)
          .map((head) => head.id),
      );
      const lines = await loadSalesLines(tx, { from: w.datedFrom, to: w.datedTo }, counted);
      const receipts = show.stock ? await loadReceiptRows(tx, clock.zone, w.receiptsFrom, w.receiptsTo) : [];
      const payPeriods = show.payroll ? await loadPayRows(tx, w.datedFrom, w.datedTo) : [];
      const employeeIds = [...new Set(payPeriods.flatMap((period) => period.lines.map((line) => line.employeeId)))];
      const data: Omit<BusinessData, "users"> = {
        invoices: withLines(allHeads, lines),
        payments: await loadPaymentRows(tx, { to: w.historyTo, confirmedOnly: false }),
        adjustments,
        refunds: await loadRefundRows(tx, w.datedFrom, w.datedTo),
        expenses: await loadExpenseRows(tx, {
          from: w.datedFrom,
          to: w.datedTo,
          salesTaxThrough: w.historyTo,
          payroll: show.payroll,
        }),
        bills: await loadBillRows(tx),
        supplierPayments: await loadSupplierPaymentRows(tx, w.historyTo),
        receipts,
        purchaseOrders: await loadOrderRows(tx, [...new Set(receipts.map((receipt) => receipt.poId))]),
        suppliers: await loadSupplierNames(tx),
        employees: await loadEmployeeRows(tx, employeeIds),
        locations: locations.map(({ id, name, kind, floorAreaSqFt }) => ({
          id,
          name,
          kind,
          ...(floorAreaSqFt === undefined ? {} : { floorAreaSqFt }),
        })),
        productCategories: await loadProductCategories(tx),
        // Stock on hand shows product cost, so it is read only for those who may see it (S5).
        products: show.stock ? (await loadProducts(tx)).map(({ id, cost }) => ({ id, cost })) : [],
        rolls: show.stock ? await loadRolls(tx) : [],
        stockMovements: show.stock ? await loadMovementTotals(tx) : [],
        payPeriods,
        settings: { sharedCosts: await loadSharedCosts(tx) },
        today: clock.day,
      };
      return { data, show };
    });
    const reps = data.invoices
      .filter((head) => head.issuedAt >= w.datedFrom && head.issuedAt <= w.datedTo)
      .map((head) => head.salesRepId);
    const names = await loadNames(this.control.db, reps);
    const users = [...names].map(([id, name]) => ({ id, name }));
    return capDrillRecords(businessReport({ ...data, users }, filters, show));
  }

  /** Profit and loss by month (spec rule 24), for data scope `all` only (S1, checked by the controller). */
  async pnl(tenant: TenantContext, access: RequestAccess, query: PnlQuery): Promise<Report> {
    const clock = await companyClock(this.control.db, tenant);
    const w = hubWindow(query.range, clock.day);
    const { invoices, expenses, show } = await readSnapshot(await this.tenancy.db(tenant), async (tx) => {
      checkHubLocation("pnl", query.locationId, await loadLocations(tx));
      const show = await visibilityFor(tx, access);
      return {
        show,
        invoices: await loadInvoiceHeads(tx, clock.zone, { from: w.from, to: w.invoicesTo }),
        expenses: await loadExpenseRows(tx, { from: w.from, to: w.expensesTo, payroll: show.payroll }),
      };
    });
    return pnlReport(query, { today: clock.day, invoices, expenses }, show);
  }

  /**
   * Sales by category (spec rule 24) over the invoices in the person's data scope, by the rules of
   * GET /invoices (ADR 0055 S2): own by rep, branch by the invoice's branch, or all.
   */
  async salesByCategory(tenant: TenantContext, access: RequestAccess, query: SalesByCategoryQuery): Promise<Report> {
    const clock = await companyClock(this.control.db, tenant);
    const w = hubWindow(query.range, clock.day);
    const { invoices, products, show } = await readSnapshot(await this.tenancy.db(tenant), async (tx) => {
      checkWarehouse(query.locationId, await loadLocations(tx));
      const show = await visibilityFor(tx, access);
      const heads = (await loadInvoiceHeads(tx, clock.zone, { from: w.from, to: w.invoicesTo })).filter((head) =>
        seesDocument(access, head),
      );
      const counted = new Set(heads.filter((head) => !head.voidedAt).map((head) => head.id));
      const lines = await loadSalesLines(tx, { from: w.from, to: w.invoicesTo }, counted);
      return { show, invoices: withLines(heads, lines), products: await loadProductCategories(tx) };
    });
    return salesByCategoryReport(query, { today: clock.day, invoices, products }, show);
  }

  /**
   * Payments received (spec rule 24): confirmed payments on invoices in the person's data scope, by
   * the rules of GET /payments (ADR 0055 S2). A customer outside their scope reads with no name.
   */
  async payments(tenant: TenantContext, access: RequestAccess, query: PaymentsReportQuery): Promise<Report> {
    const clock = await companyClock(this.control.db, tenant);
    const w = hubWindow(query.range, clock.day);
    const read = await readSnapshot(await this.tenancy.db(tenant), async (tx) => {
      checkWarehouse(query.locationId, await loadLocations(tx));
      const all = await loadPaymentRows(tx, { from: w.from, to: w.paymentsTo, confirmedOnly: true });
      const heads: ReportInvoice[] = (
        await loadInvoiceHeadsById(tx, clock.zone, [...new Set(all.map((payment) => payment.invoiceId))])
      ).filter((head) => seesDocument(access, head));
      const seen = new Set(heads.map((head) => head.id));
      const payments = all.filter((payment) => seen.has(payment.invoiceId));
      const customers = await loadCustomerRows(tx, [...new Set(payments.map((payment) => payment.customerId))]);
      const branches = await loadBranches(tx);
      return {
        invoices: heads,
        payments,
        customers: customers
          .filter((customer) => seesCustomer(access, customer, branches))
          .map(({ id, name }) => ({ id, name })),
      };
    });
    return paymentsReport(query, { today: clock.day, ...read });
  }
}
