import type { CompanyDb } from "@workspace/db";
import {
  billReceipts,
  customers,
  employees,
  expenses,
  goodsReceipts,
  invoiceAdjustments,
  invoiceLines,
  invoices,
  paymentAllocations,
  paymentsMade,
  paymentsReceived,
  payPeriodLines,
  payPeriods,
  poLines,
  products,
  purchaseOrders,
  receiptLines,
  refunds,
  settings,
  stockMovements,
  supplierBills,
  suppliers,
} from "@workspace/db/company";
import {
  addDays,
  DEFAULT_SHARED_COSTS,
  type BusinessAdjustment,
  type BusinessBill,
  type BusinessEmployee,
  type BusinessExpense,
  type BusinessInvoice,
  type BusinessOrder,
  type BusinessPayPeriod,
  type BusinessReceipt,
  type BusinessRefund,
  type BusinessSupplierPayment,
  type Customer,
  type HubInvoice,
  type Invoice,
  type Payment,
  type Product,
  type SalesLine,
  type SharedCostSettings,
  type StockMovement,
  type Supplier,
} from "@workspace/shared";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { dayIn } from "../sales/sales-common";

/**
 * One read-only snapshot for a whole report (ADR 0055 S9): every figure comes from the same moment,
 * so a write landing mid-report can't make the location rows disagree with the company total, and
 * nothing the report runs can write. Read-only transactions take no locks for writes, so the STATUS
 * note against REPEATABLE READ (the lock-then-read pattern of posting writes, ADR 0053) does not apply.
 */
export function readSnapshot<T>(db: CompanyDb, read: (tx: CompanyDb) => Promise<T>): Promise<T> {
  return db.transaction(read, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/**
 * A moment as the company's minute, `yyyy-MM-ddTHH:mm` in its time zone (ADR 0055 S12). Write-offs
 * and goods receipts are stamped moments; read as UTC, one made on a Denver evening would land on
 * the next day, or in the next period.
 */
export function minuteIn(moment: Date, zone: string): string {
  const parts = new Map(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(moment)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}`;
}

/** Midnight UTC at the start of a day. */
const startOf = (day: string) => new Date(`${day}T00:00:00Z`);

/**
 * UTC bounds that hold every moment of the company days [from, to] in any time zone (UTC−12 to
 * UTC+14): a day before and a day after. Stamped columns are narrowed by these in SQL, then cut to
 * the exact company day in code, so no `AT TIME ZONE` is needed and a DST change can't move a day.
 * The year range of report days (S8) keeps every bound a four-digit year.
 */
const coarseFrom = (from: string) => startOf(addDays(from, -1));
const coarseBefore = (to: string) => startOf(addDays(to, 2));

/**
 * An invoice head as the reports read it: the Business report's and the hub's fields, and the
 * customer and branch for data scope. Lines are filled only for the invoices a report counts.
 */
export type ReportInvoice = BusinessInvoice & HubInvoice & Pick<Invoice, "customerId" | "branchId">;

const HEAD = {
  id: invoices.id,
  number: invoices.number,
  customerId: invoices.customerId,
  salesRepId: invoices.salesRepId,
  branchId: invoices.branchId,
  locationId: invoices.locationId,
  soldAtLocationId: invoices.soldAtLocationId,
  issuedAt: invoices.issuedAt,
  dueAt: invoices.dueAt,
  voidedAt: invoices.voidedAt,
  isReturn: invoices.isReturn,
  depositPct: invoices.depositPct,
  subtotal: invoices.subtotal,
  tax: invoices.tax,
  total: invoices.total,
  cost: invoices.cost,
};

type HeadRow = Pick<typeof invoices.$inferSelect, keyof typeof HEAD>;

/** A head row with its days read in the company's time zone, as `loadInvoices` reads them. */
function headOf(row: HeadRow, zone: string): ReportInvoice {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    salesRepId: row.salesRepId,
    branchId: row.branchId,
    locationId: row.locationId,
    ...(row.soldAtLocationId ? { soldAtLocationId: row.soldAtLocationId } : {}),
    issuedAt: dayIn(row.issuedAt, zone),
    dueAt: row.dueAt,
    voidedAt: row.voidedAt ? dayIn(row.voidedAt, zone) : null,
    isReturn: row.isReturn,
    depositPct: row.depositPct,
    subtotal: row.subtotal,
    tax: row.tax,
    total: row.total,
    cost: row.cost,
    lines: [],
  };
}

/** Whether a live invoice has a contract: its cost is then the contract's estimated cost share (ADR 0055 S4). */
export async function hasContractInvoices(tx: CompanyDb): Promise<boolean> {
  const rows = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(isNotNull(invoices.contractId), isNull(invoices.deletedAt)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Live invoice heads issued on company days up to `to`, and from `from` when given, newest first as
 * `loadInvoices` orders them, with no lines. The Business report reads every head up to the end of
 * its period's month (`businessWindow.headsTo`); a hub report reads its window.
 */
export async function loadInvoiceHeads(
  tx: CompanyDb,
  zone: string,
  w: { from?: string; to: string },
): Promise<ReportInvoice[]> {
  const rows = await tx
    .select(HEAD)
    .from(invoices)
    .where(
      and(
        isNull(invoices.deletedAt),
        w.from ? gte(invoices.issuedAt, coarseFrom(w.from)) : undefined,
        lt(invoices.issuedAt, coarseBefore(w.to)),
      ),
    )
    .orderBy(desc(invoices.issuedAt), desc(invoices.number));
  return rows
    .map((row) => headOf(row, zone))
    .filter((head) => head.issuedAt <= w.to && (!w.from || head.issuedAt >= w.from));
}

/** Live invoice heads by id, whatever their dates (write-offs' invoices, payments' invoices), newest first. */
export async function loadInvoiceHeadsById(
  tx: CompanyDb,
  zone: string,
  ids: readonly string[],
): Promise<ReportInvoice[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select(HEAD)
    .from(invoices)
    .where(and(isNull(invoices.deletedAt), inArray(invoices.id, [...ids])))
    .orderBy(desc(invoices.issuedAt), desc(invoices.number));
  return rows.map((row) => headOf(row, zone));
}

/**
 * The sales lines of the invoices in `keep`, by invoice, in their order on the document. A join on
 * live, non-void invoices in the coarse window of [from, to] instead of a long `IN` list; `keep` is
 * the exact set (non-void heads on company days in the window, and in the person's scope).
 */
export async function loadSalesLines(
  tx: CompanyDb,
  w: { from: string; to: string },
  keep: ReadonlySet<string>,
): Promise<Map<string, SalesLine[]>> {
  const byInvoice = new Map<string, SalesLine[]>();
  if (keep.size === 0) return byInvoice;
  const rows = await tx
    .select({
      invoiceId: invoiceLines.invoiceId,
      productId: invoiceLines.productId,
      category: invoiceLines.category,
      quantity: invoiceLines.quantity,
      unitPrice: invoiceLines.unitPrice,
      unitCost: invoiceLines.unitCost,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(
      and(
        isNull(invoiceLines.deletedAt),
        isNull(invoices.deletedAt),
        isNull(invoices.voidedAt),
        gte(invoices.issuedAt, coarseFrom(w.from)),
        lt(invoices.issuedAt, coarseBefore(w.to)),
      ),
    )
    .orderBy(asc(invoiceLines.position));
  for (const row of rows) {
    if (!keep.has(row.invoiceId)) continue;
    const list = byInvoice.get(row.invoiceId) ?? [];
    list.push({
      ...(row.productId ? { productId: row.productId } : {}),
      category: row.category,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      unitCost: row.unitCost,
    });
    byInvoice.set(row.invoiceId, list);
  }
  return byInvoice;
}

/** The heads with their lines put in; a head with none keeps its empty list (a credit note, or not counted). */
export function withLines(heads: readonly ReportInvoice[], lines: ReadonlyMap<string, SalesLine[]>): ReportInvoice[] {
  return heads.map((head) => {
    const own = lines.get(head.id);
    return own ? { ...head, lines: own } : head;
  });
}

/** The customer payment fields the reports read: the Business report's and Payments received's. */
export type ReportPayment = Pick<
  Payment,
  "id" | "number" | "invoiceId" | "customerId" | "kind" | "amount" | "date" | "method" | "reference" | "status"
>;

/**
 * Live customer payments dated up to `to` (and from `from` when given), newest recorded first as
 * `loadPayments` orders them. Payments received reads confirmed ones only.
 */
export async function loadPaymentRows(
  tx: CompanyDb,
  w: { from?: string; to: string; confirmedOnly: boolean },
): Promise<ReportPayment[]> {
  return tx
    .select({
      id: paymentsReceived.id,
      number: paymentsReceived.number,
      invoiceId: paymentsReceived.invoiceId,
      customerId: paymentsReceived.customerId,
      kind: paymentsReceived.kind,
      amount: paymentsReceived.amount,
      date: paymentsReceived.date,
      method: paymentsReceived.method,
      reference: paymentsReceived.reference,
      status: paymentsReceived.status,
    })
    .from(paymentsReceived)
    .where(
      and(
        isNull(paymentsReceived.deletedAt),
        w.from ? gte(paymentsReceived.date, w.from) : undefined,
        lte(paymentsReceived.date, w.to),
        w.confirmedOnly ? eq(paymentsReceived.status, "confirmed") : undefined,
      ),
    )
    .orderBy(desc(paymentsReceived.recordedAt), desc(paymentsReceived.number));
}

/**
 * Live write-offs and credit applied on company days up to `through`, oldest first as
 * `loadAdjustments` orders them, stamped with the company's minute (ADR 0055 S12).
 */
export async function loadAdjustmentRows(tx: CompanyDb, zone: string, through: string): Promise<BusinessAdjustment[]> {
  const rows = await tx
    .select({
      invoiceId: invoiceAdjustments.invoiceId,
      kind: invoiceAdjustments.kind,
      amount: invoiceAdjustments.amount,
      at: invoiceAdjustments.at,
    })
    .from(invoiceAdjustments)
    .where(and(isNull(invoiceAdjustments.deletedAt), lt(invoiceAdjustments.at, coarseBefore(through))))
    .orderBy(asc(invoiceAdjustments.at), asc(invoiceAdjustments.id));
  return rows
    .map((row) => ({ invoiceId: row.invoiceId, kind: row.kind, amount: row.amount, at: minuteIn(row.at, zone) }))
    .filter((row) => row.at.slice(0, 10) <= through);
}

/** Live customer refunds dated in [from, to]: cash paid out (rule 11). */
export async function loadRefundRows(tx: CompanyDb, from: string, to: string): Promise<BusinessRefund[]> {
  return tx
    .select({ amount: refunds.amount, date: refunds.date, status: refunds.status })
    .from(refunds)
    .where(and(isNull(refunds.deletedAt), gte(refunds.date, from), lte(refunds.date, to)))
    .orderBy(desc(refunds.at), desc(refunds.number));
}

/**
 * Live expenses dated in [from, to], plus sales tax payments up to `salesTaxThrough` when given (the
 * Taxes section's "still owed"), newest first as `loadExpenses` orders them. Without pay sight the
 * payroll months are never read (ADR 0041; ADR 0055 S3); the shared report drops them too.
 */
export async function loadExpenseRows(
  tx: CompanyDb,
  w: { from: string; to: string; salesTaxThrough?: string; payroll: boolean },
): Promise<BusinessExpense[]> {
  const dated = and(gte(expenses.date, w.from), lte(expenses.date, w.to));
  return tx
    .select({
      id: expenses.id,
      number: expenses.number,
      date: expenses.date,
      supplierId: expenses.supplierId,
      category: expenses.category,
      locationId: expenses.locationId,
      amount: expenses.amount,
      tax: expenses.tax,
      status: expenses.status,
      settlement: expenses.settlement,
    })
    .from(expenses)
    .where(
      and(
        isNull(expenses.deletedAt),
        w.salesTaxThrough
          ? or(dated, and(eq(expenses.category, "sales_tax_payment"), lte(expenses.date, w.salesTaxThrough)))
          : dated,
        w.payroll ? undefined : ne(expenses.category, "payroll"),
      ),
    )
    .orderBy(desc(expenses.date), desc(expenses.number));
}

/**
 * Every live supplier bill with the receipts it covers. Not windowed: a receipt billed after the
 * period still counts as billed (rule 18), and what suppliers are owed needs every bill.
 */
export async function loadBillRows(tx: CompanyDb): Promise<BusinessBill[]> {
  const bills = await tx
    .select({
      id: supplierBills.id,
      issuedAt: supplierBills.issuedAt,
      dueAt: supplierBills.dueAt,
      total: supplierBills.total,
    })
    .from(supplierBills)
    .where(isNull(supplierBills.deletedAt))
    .orderBy(desc(supplierBills.issuedAt), desc(supplierBills.number));
  const links = await tx
    .select({ billId: billReceipts.billId, receiptId: billReceipts.receiptId })
    .from(billReceipts)
    .where(isNull(billReceipts.deletedAt));
  const byBill = new Map<string, string[]>();
  for (const link of links) byBill.set(link.billId, [...(byBill.get(link.billId) ?? []), link.receiptId]);
  return bills.map((bill) => ({ ...bill, receiptIds: byBill.get(bill.id) ?? [] }));
}

/**
 * Live supplier payments dated up to `through`, newest recorded first as `loadSupplierPayments`
 * orders them, with their live allocations: cash paid out and what each bill still owes (rules 11, 12).
 */
export async function loadSupplierPaymentRows(tx: CompanyDb, through: string): Promise<BusinessSupplierPayment[]> {
  const payments = await tx
    .select({ id: paymentsMade.id, amount: paymentsMade.amount, date: paymentsMade.date, status: paymentsMade.status })
    .from(paymentsMade)
    .where(and(isNull(paymentsMade.deletedAt), lte(paymentsMade.date, through)))
    .orderBy(desc(paymentsMade.recordedAt), desc(paymentsMade.number));
  const allocations = await tx
    .select({
      paymentId: paymentAllocations.paymentId,
      billId: paymentAllocations.billId,
      amount: paymentAllocations.amount,
    })
    .from(paymentAllocations)
    .innerJoin(paymentsMade, eq(paymentsMade.id, paymentAllocations.paymentId))
    .where(and(isNull(paymentAllocations.deletedAt), isNull(paymentsMade.deletedAt), lte(paymentsMade.date, through)))
    .orderBy(asc(paymentAllocations.createdAt), asc(paymentAllocations.id));
  const byPayment = new Map<string, { billId: string; amount: string }[]>();
  for (const { paymentId, billId, amount } of allocations) {
    byPayment.set(paymentId, [...(byPayment.get(paymentId) ?? []), { billId, amount }]);
  }
  return payments.map(({ id, amount, date, status }) => ({
    amount,
    date,
    status,
    allocations: byPayment.get(id) ?? [],
  }));
}

/**
 * Live goods receipts received on company days in [from, to], newest first, with their live lines:
 * purchases received in the period (rule 18). Stamped with the company's minute (ADR 0055 S12).
 * Read only for a person who may see order costs (S5).
 */
export async function loadReceiptRows(
  tx: CompanyDb,
  zone: string,
  from: string,
  to: string,
): Promise<BusinessReceipt[]> {
  const rows = await tx
    .select({ id: goodsReceipts.id, poId: goodsReceipts.poId, receivedAt: goodsReceipts.receivedAt })
    .from(goodsReceipts)
    .where(
      and(
        isNull(goodsReceipts.deletedAt),
        gte(goodsReceipts.receivedAt, coarseFrom(from)),
        lt(goodsReceipts.receivedAt, coarseBefore(to)),
      ),
    )
    .orderBy(desc(goodsReceipts.receivedAt));
  const receipts = rows
    .map((row) => ({ id: row.id, poId: row.poId, receivedAt: minuteIn(row.receivedAt, zone) }))
    .filter((row) => row.receivedAt.slice(0, 10) >= from && row.receivedAt.slice(0, 10) <= to);
  if (receipts.length === 0) return [];
  const lines = await tx
    .select({ receiptId: receiptLines.receiptId, poLineId: receiptLines.poLineId, received: receiptLines.received })
    .from(receiptLines)
    .where(
      and(
        isNull(receiptLines.deletedAt),
        inArray(
          receiptLines.receiptId,
          receipts.map((receipt) => receipt.id),
        ),
      ),
    );
  return receipts.map((receipt) => ({
    ...receipt,
    lines: lines
      .filter((line) => line.receiptId === receipt.id)
      .map(({ poLineId, received }) => ({ poLineId, received })),
  }));
}

/** The live purchase orders of the given receipts, with each live line's order cost (rule 18). */
export async function loadOrderRows(tx: CompanyDb, poIds: readonly string[]): Promise<BusinessOrder[]> {
  if (poIds.length === 0) return [];
  const orders = await tx
    .select({ id: purchaseOrders.id, supplierId: purchaseOrders.supplierId })
    .from(purchaseOrders)
    .where(and(isNull(purchaseOrders.deletedAt), inArray(purchaseOrders.id, [...poIds])))
    .orderBy(desc(purchaseOrders.createdAt));
  if (orders.length === 0) return [];
  const lines = await tx
    .select({ id: poLines.id, poId: poLines.poId, unitCost: poLines.unitCost })
    .from(poLines)
    .where(
      and(
        isNull(poLines.deletedAt),
        inArray(
          poLines.poId,
          orders.map((order) => order.id),
        ),
      ),
    )
    .orderBy(asc(poLines.position));
  return orders.map((order) => ({
    ...order,
    lines: lines.filter((line) => line.poId === order.id).map(({ id, unitCost }) => ({ id, unitCost })),
  }));
}

/** Every supplier's name, deleted ones included, so an old expense or order keeps its vendor's name. */
export async function loadSupplierNames(tx: CompanyDb): Promise<Pick<Supplier, "id" | "name">[]> {
  return tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).orderBy(asc(suppliers.name));
}

/**
 * Approved and exported pay periods ending in [from, to], newest first as `loadPayPeriods` orders
 * them, with each live line's gross pay (rule 7). Read only with pay sight (ADR 0055 S3).
 */
export async function loadPayRows(tx: CompanyDb, from: string, to: string): Promise<BusinessPayPeriod[]> {
  const periods = await tx
    .select({ id: payPeriods.id, status: payPeriods.status, end: payPeriods.end })
    .from(payPeriods)
    .where(
      and(
        isNull(payPeriods.deletedAt),
        inArray(payPeriods.status, ["approved", "exported"]),
        gte(payPeriods.end, from),
        lte(payPeriods.end, to),
      ),
    )
    .orderBy(desc(payPeriods.start), asc(payPeriods.id));
  if (periods.length === 0) return [];
  const lines = await tx
    .select({
      payPeriodId: payPeriodLines.payPeriodId,
      employeeId: payPeriodLines.employeeId,
      grossPay: payPeriodLines.grossPay,
    })
    .from(payPeriodLines)
    .where(
      and(
        isNull(payPeriodLines.deletedAt),
        inArray(
          payPeriodLines.payPeriodId,
          periods.map((period) => period.id),
        ),
      ),
    )
    .orderBy(asc(payPeriodLines.id));
  return periods.map(({ id, status, end }) => ({
    status,
    end,
    lines: lines
      .filter((line) => line.payPeriodId === id)
      .map(({ employeeId, grossPay }) => ({ employeeId, grossPay })),
  }));
}

/**
 * The employees named by pay lines, deleted or not, so a former employee's pay stays at their
 * location (ADR 0055). Names reach only the People costs drill records, which need `people`.
 */
export async function loadEmployeeRows(tx: CompanyDb, ids: readonly string[]): Promise<BusinessEmployee[]> {
  if (ids.length === 0) return [];
  return tx
    .select({ id: employees.id, name: employees.name, homeLocationId: employees.homeLocationId })
    .from(employees)
    .where(inArray(employees.id, [...ids]));
}

/** Every product's category, deleted ones included, so an old line keeps its category (ADR 0055). */
export async function loadProductCategories(tx: CompanyDb): Promise<Pick<Product, "id" | "category">[]> {
  return tx.select({ id: products.id, category: products.category }).from(products).orderBy(asc(products.sku));
}

/** How company-wide costs are split (Settings → Shared costs); the revenue rule when never saved (ADR 0023). */
export async function loadSharedCosts(tx: CompanyDb): Promise<SharedCostSettings> {
  const [row] = await tx
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.group, "sharedCosts"), isNull(settings.deletedAt)));
  return (row?.value as SharedCostSettings | undefined) ?? DEFAULT_SHARED_COSTS;
}

/**
 * Boxed stock per product and warehouse: one sum of the append-only movements per pair, the same
 * sums `boxedStock` makes from every movement. Read only for a person who may see stock value.
 */
export async function loadMovementTotals(
  tx: CompanyDb,
): Promise<Pick<StockMovement, "productId" | "locationId" | "quantity">[]> {
  return tx
    .select({
      productId: stockMovements.productId,
      locationId: stockMovements.locationId,
      quantity: sql<string>`sum(${stockMovements.quantity})::text`,
    })
    .from(stockMovements)
    .groupBy(stockMovements.productId, stockMovements.locationId);
}

/** The given live customers' names and reps: Payments received names only the customers a person may see. */
export async function loadCustomerRows(
  tx: CompanyDb,
  ids: readonly string[],
): Promise<Pick<Customer, "id" | "name" | "salesRepId">[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ id: customers.id, name: customers.name, salesRepId: customers.salesRepId })
    .from(customers)
    .where(and(isNull(customers.deletedAt), inArray(customers.id, [...ids])));
  return rows.map((row) => ({ ...row, salesRepId: row.salesRepId ?? "" }));
}

/** Everyone who is the rep on a live invoice, for the Business report's salesperson picker. */
export async function loadInvoiceRepIds(tx: CompanyDb): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ salesRepId: invoices.salesRepId })
    .from(invoices)
    .where(isNull(invoices.deletedAt));
  return rows.map((row) => row.salesRepId);
}

/** Live suppliers by name, for the Business report's vendor picker. */
export async function loadVendorOptions(tx: CompanyDb): Promise<Pick<Supplier, "id" | "name">[]> {
  return tx
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(isNull(suppliers.deletedAt))
    .orderBy(asc(suppliers.name), asc(suppliers.id));
}
