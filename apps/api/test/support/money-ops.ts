import {
  averageCost,
  boxedOnHand,
  dec,
  isBoxed,
  moneyString,
  receivedValue,
  type AccountingSettings,
  type BankAccountSetting,
  type Bill,
  type Expense,
  type GoodsReceipt,
  type Invoice,
  type InvoiceAdjustment,
  type Payment,
  type PaymentMethod,
  type PurchaseOrder,
  type Refund,
  type SupplierPayment,
} from "@workspace/shared";
import { APPROVAL_THRESHOLD, CARPET, TILE, TILE_WASTE_PCT } from "./company-bootstrap";
import { moneyCalls, type ExpenseInput, type OrderLine, type QuoteLine, type ReceiptLineInput } from "./money-actions";
import type { MoneyRun } from "./money-run";
import { stepUp } from "./sign-in";

/**
 * The money events the check drives, each as the person the product expects to do it, shared by
 * the deterministic prelude and the random tail so every event is written once. Operations that
 * move stock at cost read the average cost first and tell the model what should post (SH-7).
 */

/** A tile line of a quote, by the sq ft at the tile's price. */
export function tileLine(productId: string, quantity: string): QuoteLine {
  return {
    productId,
    description: "Slate Tile",
    category: "material",
    unit: "sq_ft",
    quantity,
    unitPrice: "4.50",
    wastePct: TILE_WASTE_PCT,
  };
}

/** A measure visit from the catalog: a service, not stocked and not taxed (Colorado rule). */
export function serviceLine(productId: string): QuoteLine {
  return {
    productId,
    description: "Measure visit",
    category: "service",
    unit: "each",
    quantity: "1",
    unitPrice: "75.00",
  };
}

/** A quote by Sales, sent, accepted and converted to an invoice shipping from the first warehouse. */
export async function quotedInvoice(run: MoneyRun, customerId: string, lines: readonly QuoteLine[]): Promise<Invoice> {
  const sales = run.actors.sales;
  const quote = await run.act<{ id: string }>(
    201,
    moneyCalls.quote(customerId, run.places.warehouses[0], lines),
    sales,
  );
  await run.act(201, moneyCalls.quoteStatus(quote.id, "send"), sales);
  await run.act(201, moneyCalls.quoteStatus(quote.id, "accept"), sales);
  const invoice = await run.act<Invoice>(201, moneyCalls.invoiceFromQuote(quote.id), sales);
  run.note("invoice");
  return invoice;
}

/** A quick invoice by Sales for a length of a roll (inventory rule 18). */
export async function rollInvoice(
  run: MoneyRun,
  rollId: string,
  customerId: string,
  lengthFt: string,
): Promise<Invoice> {
  const invoice = await run.act<Invoice>(201, moneyCalls.rollInvoice(rollId, customerId, lengthFt), run.actors.sales);
  run.note("roll invoice");
  return invoice;
}

/** Who records a customer payment: the Owner (confirmed up to the threshold) or Sales (own scope, so it always waits). */
export type Recorder = "owner" | "sales";

/** Records a customer payment dated today; the Owner may take the extra as credit (spec rule 28). */
export async function recordPayment(
  run: MoneyRun,
  invoiceId: string,
  amount: string,
  method: PaymentMethod,
  by: Recorder,
  extraAsCredit = false,
): Promise<Payment> {
  const cookie = by === "owner" ? run.owner : run.actors.sales;
  const payment = await run.act<Payment>(
    201,
    moneyCalls.payment(invoiceId, amount, method, run.today, extraAsCredit),
    cookie,
  );
  const expected = by === "sales" || dec(amount).gt(APPROVAL_THRESHOLD) ? "pending" : "confirmed";
  if (payment.status !== expected) run.fail(`Payment ${payment.number} is ${payment.status}, expected ${expected}.`);
  if (payment.status === "confirmed") run.posted(payment.id, payment.method);
  run.note(`payment ${payment.status}`);
  return payment;
}

/** Confirms or rejects a waiting payment as someone other than its recorder (two-person check, spec rule 28). */
export async function reviewPayment(
  run: MoneyRun,
  payment: Pick<Payment, "id" | "recordedById">,
  confirm: boolean,
): Promise<Payment> {
  const reviewer = payment.recordedById === run.actors.owner.userId ? run.actors.accountant.cookie : run.owner;
  const reviewed = await run.act<Payment>(201, moneyCalls.paymentReview(payment.id, confirm), reviewer);
  if (reviewed.status === "confirmed") run.posted(reviewed.id, reviewed.method);
  run.note(confirm ? "payment confirmed on review" : "payment rejected");
  return reviewed;
}

/** Voids a payment as the Accountant (spec rule 32). */
export async function voidPayment(run: MoneyRun, paymentId: string): Promise<void> {
  await run.act(201, moneyCalls.paymentVoid(paymentId), run.actors.accountant.cookie);
  run.note("payment voided");
}

/** A credit note for an amount before tax, by the Owner (spec rule 38). */
export async function creditNote(run: MoneyRun, invoiceId: string, subtotal: string): Promise<Invoice> {
  const note = await run.act<Invoice>(201, moneyCalls.creditNote(invoiceId, subtotal), run.owner);
  run.note("credit note");
  return note;
}

/** Writes off a small leftover as the Accountant (spec rule 34). */
export async function writeOff(run: MoneyRun, invoiceId: string): Promise<InvoiceAdjustment> {
  // Writing off needs a step-up (ADR 0063); here it is setup, not what is tested.
  await run.harness.grantStepUp(run.actors.accountant.cookie);
  const adjustment = await run.act<InvoiceAdjustment>(
    201,
    moneyCalls.writeOff(invoiceId),
    run.actors.accountant.cookie,
  );
  run.note("write-off");
  return adjustment;
}

/** Applies the customer's credit to an invoice as the Owner (spec rule 36). */
export async function applyCredit(run: MoneyRun, invoiceId: string): Promise<InvoiceAdjustment> {
  const adjustment = await run.act<InvoiceAdjustment>(201, moneyCalls.applyCredit(invoiceId), run.owner);
  run.note("credit applied");
  return adjustment;
}

/** Refunds customer credit as the Accountant (spec rule 37). */
export async function refund(
  run: MoneyRun,
  customerId: string,
  amount: string,
  method: PaymentMethod,
): Promise<Refund> {
  // A refund needs a step-up (ADR 0063); here it is setup, not what is tested.
  await run.harness.grantStepUp(run.actors.accountant.cookie);
  const done = await run.act<Refund>(
    201,
    moneyCalls.refund(customerId, amount, method, run.today),
    run.actors.accountant.cookie,
  );
  run.posted(done.id, done.method);
  run.note("refund");
  return done;
}

/** Voids an invoice or credit note as the Owner. */
export async function voidInvoice(run: MoneyRun, invoiceId: string): Promise<void> {
  await run.act(201, moneyCalls.voidInvoice(invoiceId), run.owner);
  run.note("invoice voided");
}

/**
 * Issues an invoice's boxed stock, or cuts its roll, as the Warehouse (inventory rules 13 to 17),
 * after reading the cost it should post: the product's average cost, or the roll's own cost per
 * sq ft, each times what leaves stock (ADR 0040).
 */
export async function issueStock(run: MoneyRun, invoiceId: string): Promise<void> {
  const books = await run.refresh();
  const hold = books.holds.find((candidate) => candidate.invoiceId === invoiceId);
  if (!hold) return run.fail(`Invoice ${invoiceId} has no stock hold to issue.`);
  let cost: string;
  if (hold.rollId) {
    const roll = books.rolls.find((candidate) => candidate.id === hold.rollId)!;
    cost = moneyString(dec(hold.quantity).times(String(roll.widthFt)).times(roll.costPerSqFt));
  } else {
    const product = books.products.find((candidate) => candidate.id === hold.productId)!;
    cost = moneyString(dec(hold.quantity).times(product.cost));
  }
  await run.act(201, moneyCalls.issue(hold.reservationId), run.actors.warehouse);
  run.memory.issueCosts.set(hold.reservationId, dec(cost));
  run.memory.issuedInvoices.add(invoiceId);
  run.memory.e9Allowance = run.memory.e9Allowance.plus("0.005");
  run.note(hold.rollId ? "roll cut" : "stock issued");
}

/** A purchase order by Purchasing, placed at once or drafted and then placed (purchasing rules 1 to 9). */
export async function purchaseOrder(
  run: MoneyRun,
  supplierId: string,
  locationId: string,
  lines: readonly OrderLine[],
  draftFirst: boolean,
): Promise<PurchaseOrder> {
  const purchasing = run.actors.purchasing;
  const order = await run.act<PurchaseOrder>(
    201,
    moneyCalls.purchaseOrder(supplierId, locationId, lines, draftFirst),
    purchasing,
  );
  if (draftFirst) await run.act(201, moneyCalls.placeOrder(order.id), purchasing);
  run.note("purchase order");
  return order;
}

/**
 * Receives goods as the Warehouse (purchasing rule 19), and checks each boxed product's new
 * average cost with the shared `averageCost` from what was on hand before (ADR 0040; SH-7).
 */
export async function receive(
  run: MoneyRun,
  order: PurchaseOrder,
  lines: readonly ReceiptLineInput[],
): Promise<GoodsReceipt> {
  const before = await run.refresh();
  const expected = new Map<string, string>();
  for (const line of lines) {
    const product = before.products.find((candidate) => candidate.id === line.productId)!;
    if (!isBoxed(product) || dec(line.received).lte(0)) continue;
    const unitCost = order.lines.find((candidate) => candidate.id === line.poLineId)!.unitCost;
    const onHand = boxedOnHand(before.movements, product.id).toString();
    expected.set(product.id, averageCost(onHand, product.cost, line.received, unitCost));
  }
  const receipt = await run.act<GoodsReceipt>(201, moneyCalls.receipt(order.id, lines), run.actors.warehouse);
  const after = await run.refresh();
  for (const [productId, cost] of expected) {
    const product = after.products.find((candidate) => candidate.id === productId)!;
    if (product.cost !== cost)
      run.fail(`AVG: ${product.name} costs ${product.cost} after ${receipt.number}, expected ${cost}.`);
    const onHand = boxedOnHand(after.movements, productId);
    run.memory.e9Allowance = run.memory.e9Allowance.plus(onHand.times("0.00005"));
  }
  run.memory.e9Allowance = run.memory.e9Allowance.plus(dec("0.005").times(lines.length));
  run.note(lines.some((line) => dec(line.damaged || "0").gt(0)) ? "receipt with damage" : "receipt");
  return receipt;
}

/** The received value of an order's receipts not yet on a bill: what a bill at value would total. */
export function unbilledValue(run: MoneyRun, poId: string): string {
  const order = run.books.orders.find((candidate) => candidate.id === poId)!;
  const billed = new Set(run.books.bills.flatMap((bill) => bill.receiptIds));
  return moneyString(
    receivedValue(
      order,
      run.books.receipts.filter((r) => r.poId === poId && !billed.has(r.id)),
    ),
  );
}

/** Enters the supplier's bill as Purchasing over every unbilled receipt, at value plus a difference (purchasing rules 20, 21). */
export async function enterBill(run: MoneyRun, poId: string, difference = "0.00"): Promise<Bill> {
  await run.refresh();
  const total = moneyString(dec(unbilledValue(run, poId)).plus(difference));
  const bill = await run.act<Bill>(201, moneyCalls.bill(poId, total, run.today), run.actors.purchasing);
  run.note(dec(difference).isZero() ? "bill" : "bill with a price difference");
  return bill;
}

/** Pays a supplier as Purchasing: confirmed up to the threshold, else waiting for review (purchasing rule 25). */
export async function paySupplier(
  run: MoneyRun,
  supplierId: string,
  amount: string,
  method: PaymentMethod,
  billIds?: readonly string[],
): Promise<SupplierPayment> {
  const call = moneyCalls.supplierPayment(supplierId, amount, method, run.today, billIds);
  const payment = await run.act<SupplierPayment>(201, call, run.actors.purchasing);
  const expected = dec(amount).gt(APPROVAL_THRESHOLD) ? "pending" : "confirmed";
  if (payment.status !== expected)
    run.fail(`Supplier payment ${payment.number} is ${payment.status}, expected ${expected}.`);
  if (payment.status === "confirmed") run.posted(payment.id, payment.method);
  run.note(`supplier payment ${payment.status}`);
  return payment;
}

/** Confirms or rejects a waiting supplier payment as the Owner (someone other than Purchasing). */
export async function reviewSupplierPayment(run: MoneyRun, paymentId: string, confirm: boolean): Promise<void> {
  const reviewed = await run.act<SupplierPayment>(201, moneyCalls.supplierPaymentReview(paymentId, confirm), run.owner);
  if (reviewed.status === "confirmed") run.posted(reviewed.id, reviewed.method);
  run.note(confirm ? "supplier payment confirmed on review" : "supplier payment rejected");
}

/** Voids a supplier payment as the Accountant. */
export async function voidSupplierPayment(run: MoneyRun, paymentId: string): Promise<void> {
  await run.act(201, moneyCalls.supplierPaymentVoid(paymentId), run.actors.accountant.cookie);
  run.note("supplier payment voided");
}

/**
 * Records an expense as the Accountant, dated today unless another day is given; above Summit's
 * expense threshold it waits for review (finance-expenses rule 9).
 */
export async function recordExpense(
  run: MoneyRun,
  input: Omit<ExpenseInput, "date"> & { date?: string },
): Promise<Expense> {
  const call = moneyCalls.expense({ ...input, date: input.date ?? run.today });
  const expense = await run.act<Expense>(201, call, run.actors.accountant.cookie);
  if (expense.status === "confirmed")
    run.posted(expense.id, expense.settlement === "paid" ? expense.paymentMethod : null);
  run.note(
    input.category === "sales_tax_payment" ? "sales tax payment" : `expense ${input.settlement} ${expense.status}`,
  );
  return expense;
}

/** Approves or rejects a waiting expense as the Owner (its recorder is the Accountant). */
export async function reviewExpense(run: MoneyRun, expenseId: string, approve: boolean): Promise<void> {
  const reviewed = await run.act<Expense>(201, moneyCalls.expenseReview(expenseId, approve), run.owner);
  if (reviewed.status === "confirmed")
    run.posted(reviewed.id, reviewed.settlement === "paid" ? reviewed.paymentMethod : null);
  run.note(approve ? "expense approved" : "expense rejected");
}

/** Voids an expense as the Accountant. */
export async function voidExpense(run: MoneyRun, expenseId: string): Promise<void> {
  await run.act(201, moneyCalls.expenseVoid(expenseId), run.actors.accountant.cookie);
  run.note("expense voided");
}

/**
 * Counts boxed stock at a warehouse as the Owner, `change` sq ft away from the books, after reading
 * the average cost the correction posts at (ADR 0042).
 */
export async function correctStock(
  run: MoneyRun,
  productId: string,
  locationId: string,
  change: string,
): Promise<void> {
  const books = await run.refresh();
  const product = books.products.find((candidate) => candidate.id === productId)!;
  const counted = boxedOnHand(books.movements, productId, locationId).plus(change);
  const adjustment = await run.act<{ id: string }>(
    201,
    moneyCalls.stockCorrection(productId, null, locationId, counted.toString()),
    run.owner,
  );
  run.memory.corrections.set(adjustment.id, dec(moneyString(dec(change).times(product.cost))));
  run.memory.e9Allowance = run.memory.e9Allowance.plus("0.005");
  run.note("stock correction");
}

/**
 * Saves the bank accounts as the Owner, after a step-up: accounting saves need one (PR #57); the
 * costing method and tax basis stay the owner's defaults (ADR 0040).
 */
export async function saveBanks(
  run: MoneyRun,
  bankAccounts: readonly BankAccountSetting[],
): Promise<AccountingSettings> {
  const settings: AccountingSettings = {
    costingMethod: "average",
    salesTaxBasis: "accrual",
    bankAccounts: [...bankAccounts],
  };
  await stepUp(run.harness, run.actors.owner);
  const saved = await run.act<AccountingSettings>(200, moneyCalls.accounting(settings), run.owner);
  run.note("bank accounts saved");
  return saved;
}

/** Moves a payment method to the named bank account, taking it off any other (ADR 0040). */
export async function moveMethod(run: MoneyRun, method: PaymentMethod, toName: string): Promise<void> {
  const banks = run.books.accounting.bankAccounts.map((bank) => ({
    ...bank,
    methods: bank.name === toName ? [...new Set([...bank.methods, method])] : bank.methods.filter((m) => m !== method),
  }));
  await saveBanks(run, banks);
  run.note("payment method moved");
}

/** The carpet's area for a length of roll, in sq ft. */
export function carpetArea(lengthFt: string): string {
  return dec(lengthFt).times(CARPET.widthFt).toString();
}

/** Whole cartons of tile, as sq ft. */
export function tileCartons(cartons: number): string {
  return dec(TILE.sqFtPerCarton).times(cartons).toString();
}

/** Pays a contractor payment HR recorded, as the Owner (someone else must pay; ADR 0047), into the method's bank. */
export async function payContractor(run: MoneyRun, paymentId: string, method: PaymentMethod): Promise<void> {
  await run.act(201, moneyCalls.contractorPay(paymentId, method), run.owner);
  run.memory.contractorPaid.add(paymentId);
  run.posted(paymentId, method);
  run.note("contractor payment paid");
}
