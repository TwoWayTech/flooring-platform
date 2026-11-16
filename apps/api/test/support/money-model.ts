import {
  billLedger,
  boxedStock,
  maxDec,
  cashAccountFor,
  customerCredit,
  dec,
  EXPENSE_ACCOUNTS,
  expenseCost,
  isBoxed,
  isCashAccount,
  ledgerIndex,
  receivedValue,
  sum,
  type AccountingSettings,
  type Bill,
  type ContractBilling,
  type ContractorPayment,
  type Dec,
  type Expense,
  type GoodsReceipt,
  type Invoice,
  type InvoiceAdjustment,
  type LedgerKey,
  type PayPeriod,
  type Payment,
  type Product,
  type PurchaseOrder,
  type Refund,
  type Roll,
  type StockMovement,
  type SupplierPayment,
} from "@workspace/shared";
import { balanceOf, entryKey, type EntrySource, type TrialBalance } from "./ledger-read";
import type { MoneyApi } from "./money-actions";

/**
 * A seeded generator, the same LCG as the shared ledger property test (packages/shared
 * postings.test.ts), so a failing money run replays from its seed alone.
 */
export function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** Draws from a seeded generator: a whole number in a range, an item of a list, or yes with a chance. */
export interface Rng {
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

/** An Rng over a seed (see `lcg`). */
export function rngOf(seed: number): Rng {
  const next = lcg(seed);
  return {
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    chance: (p) => next() < p,
  };
}

/** One stock hold as `GET /stock-holds` lists it (inventory rules 13 to 17). */
export interface Hold {
  reservationId: string;
  invoiceId: string;
  mayIssue: boolean;
  productId: string;
  rollId: string | null;
  locationId: string;
  quantity: string;
  shortBy: string;
}

/**
 * Every money document of a company as the Owner reads them through the API, with its accounting
 * settings and trial balance: what the equalities compare.
 */
export interface Books {
  today: string;
  invoices: Invoice[];
  payments: Payment[];
  adjustments: InvoiceAdjustment[];
  refunds: Refund[];
  orders: PurchaseOrder[];
  receipts: GoodsReceipt[];
  bills: Bill[];
  supplierPayments: SupplierPayment[];
  expenses: Expense[];
  products: Product[];
  movements: StockMovement[];
  rolls: Roll[];
  holds: Hold[];
  contractBillings: ContractBilling[];
  payPeriods: PayPeriod[];
  /** Contractor payments still standing; a voided one leaves the list. */
  contractorPayments: ContractorPayment[];
  accounting: AccountingSettings;
  trial: TrialBalance;
}

/** Reads every list the equalities need, as one person with company-wide sight (the Owner). */
export async function readBooks(api: MoneyApi, cookie: string, today: string): Promise<Books> {
  const read = <T>(path: string) => api.read<T>(path, cookie);
  const [invoices, payments, adjustments, refunds, orders, receipts, bills, supplierPayments, expenses] =
    await Promise.all([
      read<Invoice[]>("/invoices"),
      read<Payment[]>("/payments"),
      read<InvoiceAdjustment[]>("/invoice-adjustments"),
      read<Refund[]>("/refunds"),
      read<PurchaseOrder[]>("/purchase-orders"),
      read<GoodsReceipt[]>("/receipts"),
      read<Bill[]>("/bills"),
      read<SupplierPayment[]>("/supplier-payments"),
      read<Expense[]>("/expenses"),
    ]);
  const [products, movements, rolls, holds, contractBillings, payPeriods, contractorPayments, accounting, trial] =
    await Promise.all([
      read<Product[]>("/products"),
      read<StockMovement[]>("/stock-movements"),
      read<Roll[]>("/rolls"),
      read<Hold[]>("/stock-holds"),
      read<ContractBilling[]>("/contract-billings"),
      read<PayPeriod[]>("/pay-periods"),
      read<ContractorPayment[]>("/contractor-payments"),
      read<AccountingSettings>("/settings/accounting"),
      api.trialBalance(cookie),
    ]);
  return {
    today,
    invoices,
    payments,
    adjustments,
    refunds,
    orders,
    receipts,
    bills,
    supplierPayments,
    expenses,
    products,
    movements,
    rolls,
    holds,
    contractBillings,
    payPeriods,
    contractorPayments,
    accounting,
    trial,
  };
}

/**
 * What the model knows that no document records: which cash account each money movement posted
 * to (the method's bank at that moment, ADR 0040), which documents ever posted, and the cost the
 * model predicted for each issue and stock correction from the average cost it read just before
 * (stock movements carry no cost; SH-7). Plus the E9 rounding allowance, and the contractor
 * payments that were paid, because a voided one leaves its list.
 */
export interface MoneyMemory {
  cashAt: Map<string, LedgerKey>;
  posted: Set<string>;
  issueCosts: Map<string, Dec>;
  issuedInvoices: Set<string>;
  corrections: Map<string, Dec>;
  e9Allowance: Dec;
  contractorPaid: Set<string>;
}

/** An empty memory, for a company with no documents. */
export function newMemory(): MoneyMemory {
  return {
    cashAt: new Map(),
    posted: new Set(),
    issueCosts: new Map(),
    issuedInvoices: new Set(),
    corrections: new Map(),
    e9Allowance: dec(0),
    contractorPaid: new Set(),
  };
}

/**
 * Notes what a step posted, from the books before and after it: documents that became confirmed
 * (or completed) post to the cash account their method has now, because the model changes the
 * bank settings only in a step that confirms nothing.
 */
export function observe(memory: MoneyMemory, after: Books): void {
  const cashFor = (method: Payment["method"]) => cashAccountFor(after.accounting, method);
  for (const payment of after.payments) {
    if (payment.status === "confirmed" && !memory.posted.has(payment.id)) {
      memory.posted.add(payment.id);
      memory.cashAt.set(payment.id, cashFor(payment.method));
    }
  }
  for (const payment of after.supplierPayments) {
    if (payment.status === "confirmed" && !memory.posted.has(payment.id)) {
      memory.posted.add(payment.id);
      memory.cashAt.set(payment.id, cashFor(payment.method));
    }
  }
  for (const expense of after.expenses) {
    if (expense.status === "confirmed" && !memory.posted.has(expense.id)) {
      memory.posted.add(expense.id);
      if (expense.settlement === "paid") memory.cashAt.set(expense.id, cashFor(expense.paymentMethod));
    }
  }
  for (const refund of after.refunds) {
    if (refund.status === "completed" && !memory.cashAt.has(refund.id))
      memory.cashAt.set(refund.id, cashFor(refund.method));
  }
}

/** One equality that did not hold: which, the ledger's figure and the documents' figure. */
export interface Mismatch {
  id: string;
  ledger: string;
  documents: string;
}

/** The purchase order a receipt or bill belongs to. */
function orderOf(books: Books, poId: string): PurchaseOrder {
  const order = books.orders.find((candidate) => candidate.id === poId);
  if (!order) throw new Error(`Purchase order ${poId} is not listed.`);
  return order;
}

/** What a PO bill covers at the order's costs: the received value of its receipts (purchasing rule 21). */
function billCovers(books: Books, bill: Bill): Dec {
  return receivedValue(
    orderOf(books, bill.poId!),
    books.receipts.filter((receipt) => bill.receiptIds.includes(receipt.id)),
  );
}

/** Each bill's price difference, which moves Inventory with no location (blueprint-delta 2026-11-14). */
function billDifferences(books: Books): Dec {
  return sum(books.bills.filter((bill) => bill.poId).map((bill) => dec(bill.total).minus(billCovers(books, bill))));
}

/** Preconditions the exact equalities rest on (SH-6): no clamp may hide a difference, no stock below zero. */
export function preconditionProblems(books: Books): string[] {
  const problems: string[] = [];
  const ledgers = ledgerIndex(books.invoices, books, books.today);
  const customers = new Set(books.invoices.map((invoice) => invoice.customerId));
  for (const customer of customers) {
    const own = books.invoices.filter((invoice) => invoice.customerId === customer);
    const unclamped = sum(own.map((invoice) => ledgers.get(invoice.id)!.overpaid))
      .plus(sum(own.filter((i) => i.isReturn && !i.voidedAt && !i.refundedAt).map((i) => i.total)))
      .minus(
        sum(
          books.adjustments
            .filter((a) => a.customerId === customer && a.kind === "credit_applied")
            .map((a) => a.amount),
        ),
      )
      .minus(
        sum(books.refunds.filter((r) => r.customerId === customer && r.status === "completed").map((r) => r.amount)),
      );
    if (unclamped.lt(0)) problems.push(`customer ${customer}: unclamped credit ${unclamped.toFixed(2)} is below zero`);
  }
  for (const payment of books.supplierPayments.filter((p) => p.status === "confirmed")) {
    const allocated = sum(payment.allocations.map((a) => a.amount));
    if (!allocated.eq(payment.amount))
      problems.push(`supplier payment ${payment.number}: ${allocated.toFixed(2)} of ${payment.amount} allocated`);
  }
  for (const bill of books.bills) {
    const paid = sum(
      books.supplierPayments
        .filter((p) => p.status === "confirmed")
        .flatMap((p) => p.allocations.filter((a) => a.billId === bill.id).map((a) => a.amount)),
    );
    if (paid.gt(bill.total)) problems.push(`bill ${bill.number}: ${paid.toFixed(2)} paid on a total of ${bill.total}`);
  }
  for (const [key, quantity] of stockByPlace(books)) {
    if (quantity.lt(0)) problems.push(`stock below zero at ${key}: ${quantity.toString()}`);
  }
  for (const roll of books.rolls) {
    if (dec(roll.remainingLengthFt).lt(0)) problems.push(`roll ${roll.rollNumber} is below zero`);
  }
  return problems;
}

/** Boxed stock per product and warehouse, keyed `product@location`. */
function stockByPlace(books: Books): Map<string, Dec> {
  const out = new Map<string, Dec>();
  for (const location of new Set(books.movements.map((m) => m.locationId))) {
    for (const [product, quantity] of boxedStock(books.movements, location))
      out.set(`${product}@${location}`, quantity);
  }
  return out;
}

/** The cash accounts in play: Cash and Bank, every bank account in the settings, and any bank account with entries. */
function cashAccounts(books: Books): string[] {
  const keys = new Set<string>(["cash"]);
  for (const bank of books.accounting.bankAccounts) if (bank.key) keys.add(bank.key);
  for (const row of books.trial.rows) if (row.key && isCashAccount(row.key)) keys.add(row.key);
  return [...keys];
}

/**
 * The control-account equalities E3 to E12 of the whole-product check, each between the trial
 * balance and the documents (or, for stock costs, the model's predictions). Balances are debits
 * less credits, so credit-side accounts are negated. Returns every equality that fails, empty when
 * the books agree with the documents.
 */
export function reconcile(books: Books, memory: MoneyMemory): Mismatch[] {
  const mismatches: Mismatch[] = [];
  const explained = new Set<string>();
  const check = (id: string, key: string, ledger: Dec, documents: Dec) => {
    explained.add(key);
    if (!ledger.eq(documents)) mismatches.push({ id, ledger: ledger.toFixed(2), documents: documents.toFixed(2) });
  };
  const credit = (key: string) => balanceOf(books.trial, key).negated();
  const debit = (key: string) => balanceOf(books.trial, key);
  const ledgers = ledgerIndex(books.invoices, books, books.today);
  const live = books.invoices.filter((invoice) => !invoice.voidedAt);
  const sales = live.filter((invoice) => !invoice.isReturn);
  const returns = live.filter((invoice) => invoice.isReturn);
  const confirmedExpenses = books.expenses.filter((expense) => expense.status === "confirmed");

  // E3: receivables are the invoices' balances; the overpaid part is credit (E4), an exact split.
  check(
    "E3 Accounts Receivable",
    "accounts_receivable",
    debit("accounts_receivable"),
    sum(sales.map((i) => ledgers.get(i.id)!.balance)),
  );
  // E4: customer credit, per customer as the shared rule derives it (ADR 0039).
  const customers = [...new Set(books.invoices.map((invoice) => invoice.customerId))];
  const owed = sum(customers.map((c) => customerCredit(c, books.invoices, ledgers, books.adjustments, books.refunds)));
  check("E4 Customer Credit", "customer_credit", credit("customer_credit"), owed);
  // E5: tax posts when invoiced (ADR 0040); returns give it back; a sales tax payment pays it down.
  const taxCharged = sum(live.map((invoice) => (invoice.isReturn ? dec(invoice.tax).negated() : dec(invoice.tax))));
  const taxPaid = sum(confirmedExpenses.filter((e) => e.category === "sales_tax_payment").map(expenseCost));
  check("E5 Sales Tax Payable", "sales_tax_payable", credit("sales_tax_payable"), taxCharged.minus(taxPaid));
  // E7: payables are the bills' balances from confirmed supplier payments.
  const payables = sum(books.bills.map((bill) => billLedger(bill, books.supplierPayments, books.today).balance));
  check("E7 Accounts Payable", "accounts_payable", credit("accounts_payable"), payables);
  // E8: goods received and not yet billed, at the orders' costs.
  const received = sum(books.receipts.map((receipt) => receivedValue(orderOf(books, receipt.poId), [receipt])));
  const billed = sum(books.bills.filter((bill) => bill.poId).map((bill) => billCovers(books, bill)));
  check("E8 Goods Received Not Billed", "received_not_billed", credit("received_not_billed"), received.minus(billed));
  // E9: inventory as posted (exact) and as valued at average cost (within the rounding allowance).
  const differences = billDifferences(books);
  const issued = sum([...memory.issueCosts.values()]);
  const corrected = sum([...memory.corrections.values()]);
  check(
    "E9 Inventory, postings",
    "inventory",
    debit("inventory"),
    received.plus(differences).minus(issued).plus(corrected),
  );
  const valuation = inventoryValuation(books).plus(differences);
  const allowance = memory.e9Allowance.toDecimalPlaces(2, 0);
  if (debit("inventory").minus(valuation).abs().gt(allowance)) {
    mismatches.push({
      id: `E9 Inventory, valuation (allowance ${allowance.toFixed(2)})`,
      ledger: debit("inventory").toFixed(2),
      documents: valuation.toFixed(2),
    });
  }
  // E6: retainage held on posted billings, customer side and subcontract side (ADR 0045).
  const postedBillings = books.contractBillings.filter((billing) => billing.status === "posted");
  const held = (list: readonly ContractBilling[]) => sum(list.map((b) => dec(b.withheld).minus(b.released)));
  const customerBillings = postedBillings.filter((billing) => billing.invoiceId);
  const subcontractBillings = postedBillings.filter((billing) => billing.billId);
  check("E6 Retainage Receivable", "retainage_receivable", debit("retainage_receivable"), held(customerBillings));
  check("E6 Retainage Payable", "retainage_payable", credit("retainage_payable"), held(subcontractBillings));
  // E11: approved pay runs accrue gross pay less the commission already accrued (ADR 0047, ADR 0048).
  const runs = books.payPeriods.filter((period) => period.status === "approved" || period.status === "exported");
  const runWages = sum(
    runs.flatMap((period) => period.lines.map((l) => maxDec(dec(l.grossPay).minus(l.commissionPay || "0"), 0))),
  );
  check("E11 Accrued Payroll", "accrued_payroll", credit("accrued_payroll"), runWages);
  const contractorPaid = books.contractorPayments.filter((payment) => payment.status === "paid");
  check("E12 Contract Labor", "contract_labor", debit("contract_labor"), sum(contractorPaid.map((p) => p.amount)));
  // E10: each cash account holds exactly the cash events posted to it.
  for (const key of cashAccounts(books)) {
    const at = (id: string) => memory.cashAt.get(id) === key;
    const expected = sum(books.payments.filter((p) => p.status === "confirmed" && at(p.id)).map((p) => p.amount))
      .minus(sum(books.refunds.filter((r) => r.status === "completed" && at(r.id)).map((r) => r.amount)))
      .minus(sum(books.supplierPayments.filter((p) => p.status === "confirmed" && at(p.id)).map((p) => p.amount)))
      .minus(sum(confirmedExpenses.filter((e) => e.settlement === "paid" && at(e.id)).map(expenseCost)))
      .minus(sum(contractorPaid.filter((p) => at(p.id)).map((p) => p.amount)));
    check(`E10 cash account ${key}`, key, debit(key), expected);
  }
  // E12: revenue, returns, bad debt, cost of goods, stock corrections and each expense account.
  check("E12 Sales", "sales", credit("sales"), sum(sales.map((i) => i.subtotal)));
  check("E12 Sales Returns", "sales_returns", debit("sales_returns"), sum(returns.map((i) => i.subtotal)));
  const writtenOff = sum(books.adjustments.filter((a) => a.kind === "write_off").map((a) => a.amount));
  check("E12 Bad Debt", "bad_debt", debit("bad_debt"), writtenOff);
  // Subcontracted work is a job cost at its gross (blueprint-delta 2026-11-14).
  const cogs = issued.plus(sum(subcontractBillings.map((billing) => billing.gross)));
  check("E12 Cost of Goods Sold", "cost_of_goods_sold", debit("cost_of_goods_sold"), cogs);
  check("E12 Inventory Adjustments", "inventory_adjustments", debit("inventory_adjustments"), corrected.negated());
  const expenseAccounts = new Set(Object.values(EXPENSE_ACCOUNTS).filter((key) => key !== "sales_tax_payable"));
  for (const key of expenseAccounts) {
    const documents = sum(confirmedExpenses.filter((e) => EXPENSE_ACCOUNTS[e.category] === key).map(expenseCost));
    check(`E12 expense account ${key}`, key, debit(key), key === "wages" ? documents.plus(runWages) : documents);
  }
  // Nothing else may move: every account with a balance is explained above (E2 covers the total).
  for (const row of books.trial.rows) {
    if (row.key && !explained.has(row.key) && !dec(row.balance).isZero()) {
      mismatches.push({ id: `unexplained account ${row.key}`, ledger: row.balance, documents: "0.00" });
    }
  }
  return mismatches;
}

/** Stock at the average cost now: boxed on hand × product cost, plus each roll's remaining area × its cost. */
function inventoryValuation(books: Books): Dec {
  const onHand = boxedStock(books.movements);
  const boxed = sum(
    books.products
      .filter((product) => isBoxed(product))
      .map((product) => (onHand.get(product.id) ?? dec(0)).times(product.cost)),
  );
  const rolls = sum(
    books.rolls.map((roll) => dec(roll.remainingLengthFt).times(String(roll.widthFt)).times(roll.costPerSqFt)),
  );
  return boxed.plus(rolls);
}

/**
 * The journal entries the documents call for (E14; CLAUDE.md rule 10), as `sourceType sourceId
 * event` keys: each issued invoice and credit note, each payment, supplier payment and expense
 * that ever posted, each adjustment, refund, receipt and PO bill, and each issue and correction
 * the model saw; every void of something posted adds its reversal.
 */
export function expectedEntries(books: Books, memory: MoneyMemory): string[] {
  const keys: string[] = [];
  const add = (sourceType: string, sourceId: string, event: string) =>
    keys.push(entryKey({ sourceType, sourceId, event }));
  for (const invoice of books.invoices.filter((i) => !i.billingId)) {
    const event = invoice.isReturn ? "credit_note.issued" : "invoice.issued";
    add("invoice", invoice.id, event);
    if (invoice.voidedAt) add("invoice", invoice.id, `${event}.reversed`);
  }
  const postedThenVoided = (id: string, status: string) => memory.posted.has(id) && status === "voided";
  for (const payment of books.payments.filter((p) => memory.posted.has(p.id))) {
    add("payment", payment.id, "payment.confirmed");
    if (postedThenVoided(payment.id, payment.status)) add("payment", payment.id, "payment.confirmed.reversed");
  }
  for (const payment of books.supplierPayments.filter((p) => memory.posted.has(p.id))) {
    add("supplier_payment", payment.id, "supplier_payment.confirmed");
    if (postedThenVoided(payment.id, payment.status))
      add("supplier_payment", payment.id, "supplier_payment.confirmed.reversed");
  }
  for (const expense of books.expenses.filter((e) => memory.posted.has(e.id))) {
    add("expense", expense.id, "expense.confirmed");
    if (postedThenVoided(expense.id, expense.status)) add("expense", expense.id, "expense.confirmed.reversed");
  }
  for (const adjustment of books.adjustments)
    add("adjustment", adjustment.id, adjustment.kind === "write_off" ? "write_off" : "credit.applied");
  for (const refund of books.refunds.filter((r) => r.status === "completed")) add("refund", refund.id, "refund");
  for (const receipt of books.receipts) add("goods_receipt", receipt.id, "goods.received");
  for (const bill of books.bills.filter((b) => b.poId)) add("bill", bill.id, "bill.entered");
  for (const [id, cost] of memory.issueCosts) if (!cost.isZero()) add("stock_issue", id, "goods.issued");
  for (const [id, value] of memory.corrections) if (!value.isZero()) add("stock_adjustment", id, "stock.adjusted");
  for (const billing of books.contractBillings) {
    add("contract_billing", billing.id, "contract_billing.posted");
    if (billing.status === "void") add("contract_billing", billing.id, "contract_billing.posted.reversed");
  }
  const standing = new Set(books.contractorPayments.map((payment) => payment.id));
  for (const id of memory.contractorPaid) {
    add("contractor_payment", id, "contractor_payment.paid");
    if (!standing.has(id)) add("contractor_payment", id, "contractor_payment.paid.reversed");
  }
  return keys.sort();
}

/**
 * Where the journal and the documents disagree (E14): entries no document calls for, documents
 * whose entry is missing, and reversals that are not dated the day they were made or don't point
 * at the entry they undo. A pay run's entry is keyed by its approval, not its period, so pay-run
 * entries are left to the payroll scenario (MI-5), which checks them one by one.
 */
export function entryProblems(entries: readonly EntrySource[], books: Books, memory: MoneyMemory): string[] {
  const expected = expectedEntries(books, memory);
  const actual = entries
    .filter((entry) => entry.sourceType !== "pay_period")
    .map(entryKey)
    .sort();
  const problems: string[] = [];
  const count = (list: readonly string[]) =>
    list.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());
  const want = count(expected);
  const have = count(actual);
  for (const [key, n] of want)
    if ((have.get(key) ?? 0) !== n) problems.push(`expected ${n} × ${key}, found ${have.get(key) ?? 0}`);
  for (const [key, n] of have) if (!want.has(key)) problems.push(`unexpected ${n} × ${key}`);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries.filter((e) => e.event.endsWith(".reversed"))) {
    const original = entry.reversesId ? byId.get(entry.reversesId) : undefined;
    if (!original || original.sourceId !== entry.sourceId || `${original.event}.reversed` !== entry.event) {
      problems.push(`${entryKey(entry)} does not point at the entry it reverses`);
    }
    if (entry.date !== books.today) problems.push(`${entryKey(entry)} is dated ${entry.date}, not the day it was made`);
  }
  return problems;
}
