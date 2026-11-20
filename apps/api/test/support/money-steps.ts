import {
  billLedger,
  boxedOnHand,
  customerCredit,
  dec,
  ledgerIndex,
  minDec,
  moneyString,
  sum,
  type Dec,
  type Invoice,
  type InvoiceLedger,
  type PaymentMethod,
} from "@workspace/shared";
import { CARPET, TILE } from "./company-bootstrap";
import type { MoneyCast } from "./money-prelude";
import type { Rng } from "./money-model";
import {
  applyCredit,
  carpetArea,
  correctStock,
  creditNote,
  enterBill,
  issueStock,
  moveMethod,
  paySupplier,
  purchaseOrder,
  quotedInvoice,
  receive,
  recordExpense,
  recordPayment,
  refund,
  reviewExpense,
  reviewPayment,
  reviewSupplierPayment,
  rollInvoice,
  serviceLine,
  tileCartons,
  tileLine,
  unbilledValue,
  voidExpense,
  voidInvoice,
  voidPayment,
  voidSupplierPayment,
  writeOff,
} from "./money-ops";
import type { AllowedRefusal, MoneyRun } from "./money-run";

/** One kind of random step (MI-1's tail): how often it is drawn, when it applies, and what it does. */
export interface MoneyStep {
  kind: string;
  weight: number;
  applicable(run: MoneyRun): boolean;
  run(run: MoneyRun, cast: MoneyCast, rng: Rng): Promise<string>;
  /** Refusals this step may meet without failing, each with the spec rule that makes it right. */
  allowedRefusals: readonly AllowedRefusal[];
}

const METHODS: readonly PaymentMethod[] = ["cash", "check", "ach", "card"];
const EXPENSE_CATEGORIES = [
  "rent",
  "supplies",
  "electricity",
  "marketing",
  "professional_fees",
  "insurance",
  "other",
] as const;

/** Cents between two amounts, as a money string. */
function cents(rng: Rng, min: Dec, max: Dec): string {
  const low = Number(min.times(100).ceil().toString());
  const high = Number(max.times(100).floor().toString());
  return moneyString(dec(rng.int(low, Math.max(low, high))).dividedBy(100));
}

/** Every invoice's ledger, from the books after the last step. */
function ledgers(run: MoneyRun): Map<string, InvoiceLedger> {
  return ledgerIndex(run.books.invoices, run.books, run.today);
}

/** Sales invoices (not credit notes, not void) still owing something. */
function owing(run: MoneyRun): Invoice[] {
  const index = ledgers(run);
  return run.books.invoices.filter((i) => !i.isReturn && !i.voidedAt && dec(index.get(i.id)!.balance).gt(0));
}

/** Each customer's credit now (spec Appendix A). */
function creditOf(run: MoneyRun, customerId: string): Dec {
  const { invoices, adjustments, refunds } = run.books;
  return customerCredit(customerId, invoices, ledgers(run), adjustments, refunds);
}

/** Whether an invoice carries a live credit note, which blocks voiding its payments (spec rule 32). */
function hasLiveNote(run: MoneyRun, invoiceId: string): boolean {
  return run.books.invoices.some((n) => n.isReturn && !n.voidedAt && n.creditForInvoiceId === invoiceId);
}

/** Holds that may be issued now: paid for, something reserved (a short row is refused, inventory rule 15), and the stock is there. */
function issuable(run: MoneyRun) {
  return run.books.holds.filter((hold) => {
    if (!hold.mayIssue || !dec(hold.quantity).gt(0)) return false;
    if (hold.rollId)
      return run.books.rolls.some((r) => r.id === hold.rollId && dec(r.remainingLengthFt).gte(hold.quantity));
    return boxedOnHand(run.books.movements, hold.productId, hold.locationId).gte(hold.quantity);
  });
}

/** Rolls with at least 5 ft not held for another invoice. */
function freeRolls(run: MoneyRun) {
  return run.books.rolls
    .map((roll) => {
      const held = sum(run.books.holds.filter((h) => h.rollId === roll.id).map((h) => h.quantity));
      return { roll, free: dec(roll.remainingLengthFt).minus(held) };
    })
    .filter((entry) => entry.free.gte(5));
}

/** Purchase orders with something still to come. */
function openOrders(run: MoneyRun) {
  return run.books.orders.filter((order) => {
    if (order.status !== "ordered") return false;
    return order.lines.some((line) => remaining(run, order.id, line.id).gt(0));
  });
}

/** What is still due on one order line: ordered less received and damaged. */
function remaining(run: MoneyRun, poId: string, lineId: string): Dec {
  const line = run.books.orders.find((o) => o.id === poId)!.lines.find((l) => l.id === lineId)!;
  const arrived = sum(
    run.books.receipts
      .filter((r) => r.poId === poId)
      .flatMap((r) =>
        r.lines.filter((l) => l.poLineId === lineId).map((l) => dec(l.received || "0").plus(l.damaged || "0")),
      ),
  );
  return dec(line.quantity).minus(arrived);
}

/** What a supplier can still be paid: each bill's balance less what already waits (audit U-04). */
function unpaid(run: MoneyRun, supplierId: string): Dec {
  return sum(
    run.books.bills
      .filter((bill) => bill.supplierId === supplierId)
      .map((bill) => billLedger(bill, run.books.supplierPayments, run.today).unpaid),
  );
}

/** Confirmed expenses that may be voided: paid ones, or on-account ones whose bill nobody has paid toward. */
function voidableExpenses(run: MoneyRun) {
  return run.books.expenses.filter((expense) => {
    if (expense.status !== "confirmed") return false;
    if (!expense.billId) return true;
    return !run.books.supplierPayments.some(
      (p) =>
        (p.status === "confirmed" || p.status === "pending") && p.allocations.some((a) => a.billId === expense.billId),
    );
  });
}

/** A credit note's room on an invoice: its subtotal less live notes already against it. */
function noteRoom(run: MoneyRun, invoice: Invoice): Dec {
  const notes = run.books.invoices.filter((n) => n.isReturn && !n.voidedAt && n.creditForInvoiceId === invoice.id);
  return dec(invoice.subtotal).minus(sum(notes.map((n) => n.subtotal)));
}

const PAYMENT_CREDIT_USED: AllowedRefusal = {
  status: 400,
  code: "invalid_request",
  message: /^Credit from payment \S+ was already applied or refunded, so it can't be voided\.$/,
  rule: "sales rule 32: a payment whose extra became credit that was then used can't be voided",
};

const REVIEW_ABOVE_BALANCE: AllowedRefusal = {
  status: 400,
  code: "invalid_request",
  message: /^Payment \S+ is more than the balance now\. Someone who may give customer credit must confirm it\.$/,
  rule: "sales rule 28: confirming more than the balance makes credit, which needs sales.payment.apply_credit",
};

/**
 * The random tail's step table (MI-1): the same event kinds as the prelude, each with a precondition
 * read from the books so it is drawn only when the rules allow it. A refusal passes only when it is
 * listed with its rule; anything else fails the run with its seed.
 */
export const MONEY_STEPS: readonly MoneyStep[] = [
  {
    kind: "invoice",
    weight: 4,
    applicable: () => true,
    async run(run, cast, rng) {
      const customer = rng.pick(cast.customers);
      const lines = [tileLine(run.places.tile, tileCartons(rng.int(1, 6)))];
      if (rng.chance(0.25)) lines.push(serviceLine(run.places.service));
      const invoice = await quotedInvoice(run, customer, lines);
      return `invoice ${invoice.number} for ${invoice.total}`;
    },
    allowedRefusals: [],
  },
  {
    kind: "roll sale",
    weight: 1,
    applicable: (run) => freeRolls(run).length > 0,
    async run(run, cast, rng) {
      const { roll, free } = rng.pick(freeRolls(run));
      const length = String(rng.int(5, Math.min(40, Number(free.floor().toString()))));
      const invoice = await rollInvoice(run, roll.id, rng.pick(cast.customers), length);
      return `roll invoice ${invoice.number}: ${length} ft of ${roll.rollNumber}`;
    },
    allowedRefusals: [],
  },
  {
    kind: "payment",
    weight: 5,
    applicable: (run) => owing(run).length > 0,
    async run(run, _cast, rng) {
      const invoice = rng.pick(owing(run));
      const balance = dec(ledgers(run).get(invoice.id)!.balance);
      const owner = rng.chance(0.75);
      const roll = rng.int(1, 100);
      let amount = moneyString(balance);
      let extra = false;
      if (roll > 40 && roll <= 65) amount = cents(rng, dec("0.01"), balance);
      else if (roll > 65 && roll <= 80 && balance.gt(5))
        amount = moneyString(balance.minus(cents(rng, dec("0.01"), dec("4.99"))));
      else if (roll > 80 && owner) {
        amount = moneyString(balance.plus(cents(rng, dec("1.00"), dec("50.00"))));
        extra = true;
      }
      const payment = await recordPayment(run, invoice.id, amount, rng.pick(METHODS), owner ? "owner" : "sales", extra);
      return `payment ${payment.number} of ${amount} on ${invoice.number} (${payment.status})`;
    },
    allowedRefusals: [],
  },
  {
    kind: "payment review",
    weight: 2,
    applicable: (run) => run.books.payments.some((p) => p.status === "pending"),
    async run(run, _cast, rng) {
      const payment = rng.pick(run.books.payments.filter((p) => p.status === "pending"));
      const confirm = rng.chance(0.8);
      await reviewPayment(run, payment, confirm);
      return `payment ${payment.number} ${confirm ? "confirmed" : "rejected"}`;
    },
    allowedRefusals: [REVIEW_ABOVE_BALANCE],
  },
  {
    kind: "payment void",
    weight: 1,
    applicable: (run) => run.books.payments.some((p) => p.status === "confirmed" && !hasLiveNote(run, p.invoiceId)),
    async run(run, _cast, rng) {
      const payment = rng.pick(
        run.books.payments.filter((p) => p.status === "confirmed" && !hasLiveNote(run, p.invoiceId)),
      );
      await voidPayment(run, payment.id);
      return `payment ${payment.number} voided`;
    },
    allowedRefusals: [PAYMENT_CREDIT_USED],
  },
  {
    kind: "write-off",
    weight: 1,
    applicable: (run) => writeOffs(run).length > 0,
    async run(run, _cast, rng) {
      const invoice = rng.pick(writeOffs(run));
      const adjustment = await writeOff(run, invoice.id);
      return `write-off of ${adjustment.amount} on ${invoice.number}`;
    },
    allowedRefusals: [],
  },
  {
    kind: "apply credit",
    weight: 1,
    applicable: (run) => owing(run).some((i) => creditOf(run, i.customerId).gt(0)),
    async run(run, _cast, rng) {
      const invoice = rng.pick(owing(run).filter((i) => creditOf(run, i.customerId).gt(0)));
      const adjustment = await applyCredit(run, invoice.id);
      return `credit of ${adjustment.amount} applied to ${invoice.number}`;
    },
    allowedRefusals: [],
  },
  {
    kind: "credit note",
    weight: 1,
    applicable: (run) => noteCandidates(run).length > 0,
    async run(run, _cast, rng) {
      const invoice = rng.pick(noteCandidates(run));
      const amount = cents(rng, dec("1.00"), minDec(noteRoom(run, invoice), dec("200.00")));
      const note = await creditNote(run, invoice.id, amount);
      return `credit note ${note.number} of ${amount} before tax on ${invoice.number}`;
    },
    allowedRefusals: [],
  },
  {
    kind: "refund",
    weight: 1,
    applicable: (run) => run.books.invoices.some((i) => creditOf(run, i.customerId).gte(1)),
    async run(run, cast, rng) {
      const customer = rng.pick(cast.customers.filter((c) => creditOf(run, c).gte(1)));
      const amount = cents(rng, dec("1.00"), creditOf(run, customer));
      await refund(run, customer, amount, rng.pick(METHODS));
      return `refund of ${amount}`;
    },
    allowedRefusals: [],
  },
  {
    kind: "invoice void",
    weight: 1,
    applicable: (run) => voidable(run).length > 0,
    async run(run, _cast, rng) {
      const invoice = rng.pick(voidable(run));
      await voidInvoice(run, invoice.id);
      return `invoice ${invoice.number} voided`;
    },
    allowedRefusals: [],
  },
  {
    kind: "issue",
    weight: 3,
    applicable: (run) => issuable(run).length > 0,
    async run(run, _cast, rng) {
      const hold = rng.pick(issuable(run));
      const invoice = run.books.invoices.find((candidate) => candidate.id === hold.invoiceId)!;
      await issueStock(run, hold.invoiceId);
      return `${hold.rollId ? "roll cut" : "stock issued"} for ${invoice.number}`;
    },
    allowedRefusals: [],
  },
  {
    kind: "purchase",
    weight: 2,
    applicable: () => true,
    async run(run, cast, rng) {
      const tileQty = tileCartons(rng.int(5, 20));
      const cost = dec(rng.int(20000, 24000)).dividedBy(10000).toFixed(4);
      const lines = [{ productId: run.places.tile, description: "Slate Tile", quantity: tileQty, unitCost: cost }];
      const withRoll = rng.chance(0.3);
      const rollFt = String(rng.int(50, 150));
      if (withRoll) {
        lines.push({
          productId: run.places.carpet,
          description: "Harbor Carpet",
          quantity: carpetArea(rollFt),
          unitCost: CARPET.cost,
        });
      }
      const where = rng.chance(0.8) ? run.places.warehouses[0] : run.places.warehouses[1];
      const order = await purchaseOrder(run, cast.suppliers.goods, where, lines, rng.chance(0.3));
      const damagedCartons = rng.chance(0.2) ? rng.int(1, 2) : 0;
      const partial = rng.chance(0.3);
      const tileIn = dec(tileQty)
        .minus(tileCartons(damagedCartons))
        .minus(partial ? tileCartons(2) : "0");
      await receive(run, order, [
        {
          poLineId: order.lines[0]!.id,
          productId: run.places.tile,
          received: tileIn.toString(),
          damaged: tileCartons(damagedCartons),
          rolls: [],
        },
        ...(withRoll
          ? [
              {
                poLineId: order.lines[1]!.id,
                productId: run.places.carpet,
                received: carpetArea(rollFt),
                damaged: "0",
                rolls: [{ rollNumber: `R${run.seed}-${run.log.length}`, dyeLot: "B2", lengthFt: rollFt }],
              },
            ]
          : []),
      ]);
      return `order ${order.number}: ${tileQty} sq ft of tile at ${cost}${withRoll ? `, a ${rollFt} ft roll` : ""}; ${tileIn.toString()} received`;
    },
    allowedRefusals: [],
  },
  {
    kind: "receive the rest",
    weight: 1,
    applicable: (run) => openOrders(run).length > 0,
    async run(run, _cast, rng) {
      const order = rng.pick(openOrders(run));
      const lines = order.lines
        .map((line) => ({ line, open: remaining(run, order.id, line.id) }))
        .filter((entry) => entry.open.gt(0) && entry.line.productId === run.places.tile)
        .map(({ line, open }) => ({
          poLineId: line.id,
          productId: line.productId,
          received: open.toString(),
          damaged: "0",
          rolls: [],
        }));
      await receive(run, order, lines);
      return `the rest of ${order.number} received`;
    },
    allowedRefusals: [],
  },
  {
    kind: "bill",
    weight: 2,
    applicable: (run) => run.books.orders.some((order) => dec(unbilledValue(run, order.id)).gt(0)),
    async run(run, _cast, rng) {
      const order = rng.pick(run.books.orders.filter((o) => dec(unbilledValue(run, o.id)).gt(0)));
      const difference = rng.chance(0.3) ? cents(rng, dec("0.01"), dec("20.00")) : "0.00";
      const signed = rng.chance(0.5) ? difference : moneyString(dec(difference).negated());
      const bill = await enterBill(run, order.id, signed);
      return `bill of ${bill.total} on ${order.number}`;
    },
    allowedRefusals: [],
  },
  {
    kind: "supplier payment",
    weight: 2,
    applicable: (run) => supplierIds(run).some((id) => unpaid(run, id).gt(0)),
    async run(run, _cast, rng) {
      const supplier = rng.pick(supplierIds(run).filter((id) => unpaid(run, id).gt(0)));
      const amount = rng.chance(0.5)
        ? moneyString(unpaid(run, supplier))
        : cents(rng, dec("0.01"), unpaid(run, supplier));
      const payment = await paySupplier(run, supplier, amount, rng.pick(METHODS));
      return `supplier payment ${payment.number} of ${amount} (${payment.status})`;
    },
    allowedRefusals: [],
  },
  {
    kind: "supplier payment review",
    weight: 1,
    applicable: (run) => run.books.supplierPayments.some((p) => p.status === "pending"),
    async run(run, _cast, rng) {
      const payment = rng.pick(run.books.supplierPayments.filter((p) => p.status === "pending"));
      const confirm = rng.chance(0.8);
      await reviewSupplierPayment(run, payment.id, confirm);
      return `supplier payment ${payment.number} ${confirm ? "confirmed" : "rejected"}`;
    },
    allowedRefusals: [],
  },
  {
    kind: "supplier payment void",
    weight: 1,
    applicable: (run) => run.books.supplierPayments.some((p) => p.status === "confirmed" || p.status === "pending"),
    async run(run, _cast, rng) {
      const payment = rng.pick(
        run.books.supplierPayments.filter((p) => p.status === "confirmed" || p.status === "pending"),
      );
      await voidSupplierPayment(run, payment.id);
      return `supplier payment ${payment.number} voided`;
    },
    allowedRefusals: [],
  },
  {
    kind: "expense",
    weight: 2,
    applicable: () => true,
    async run(run, cast, rng) {
      const onAccount = rng.chance(0.3);
      const amount = cents(rng, dec("20.00"), dec("1400.00"));
      const tax = rng.chance(0.5) ? cents(rng, dec("1.00"), dec("80.00")) : "";
      const expense = await recordExpense(run, {
        supplierId: cast.suppliers.services,
        category: rng.pick(EXPENSE_CATEGORIES),
        locationId: rng.chance(0.5) ? run.places.warehouses[0] : null,
        amount,
        tax,
        paymentMethod: rng.pick(METHODS),
        settlement: onAccount ? "on_account" : "paid",
      });
      return `expense ${expense.number} of ${amount}${tax ? ` + ${tax} tax` : ""} (${expense.settlement}, ${expense.status})`;
    },
    allowedRefusals: [],
  },
  {
    kind: "expense review",
    weight: 1,
    applicable: (run) => run.books.expenses.some((e) => e.status === "pending"),
    async run(run, _cast, rng) {
      const expense = rng.pick(run.books.expenses.filter((e) => e.status === "pending"));
      const approve = rng.chance(0.8);
      await reviewExpense(run, expense.id, approve);
      return `expense ${expense.number} ${approve ? "approved" : "rejected"}`;
    },
    allowedRefusals: [],
  },
  {
    kind: "expense void",
    weight: 1,
    applicable: (run) => voidableExpenses(run).length > 0,
    async run(run, _cast, rng) {
      const expense = rng.pick(voidableExpenses(run));
      await voidExpense(run, expense.id);
      return `expense ${expense.number} voided`;
    },
    allowedRefusals: [],
  },
  {
    kind: "sales tax payment",
    weight: 1,
    applicable: () => true,
    async run(run, cast, rng) {
      const amount = cents(rng, dec("10.00"), dec("100.00"));
      await recordExpense(run, {
        supplierId: cast.suppliers.government,
        category: "sales_tax_payment",
        locationId: null,
        amount,
        tax: "",
        paymentMethod: rng.pick(METHODS),
        settlement: "paid",
      });
      return `sales tax payment of ${amount}`;
    },
    allowedRefusals: [],
  },
  {
    kind: "stock correction",
    weight: 1,
    applicable: (run) =>
      boxedOnHand(run.books.movements, run.places.tile, run.places.warehouses[0]).gte(tileCartons(3)),
    async run(run, _cast, rng) {
      const cartons = rng.int(1, 3) * (rng.chance(0.5) ? 1 : -1);
      const change = dec(TILE.sqFtPerCarton).times(cartons).toString();
      await correctStock(run, run.places.tile, run.places.warehouses[0], change);
      return `tile counted ${change} sq ft off the books`;
    },
    allowedRefusals: [],
  },
  {
    kind: "payment method moved",
    weight: 1,
    applicable: () => true,
    async run(run, _cast, rng) {
      const method = rng.pick(["check", "ach"] as const);
      const to = rng.pick(["Operating", "Reserve"]);
      await moveMethod(run, method, to);
      return `${method} now posts to ${to}`;
    },
    allowedRefusals: [],
  },
];

/** Invoices whose small leftover may be written off: owing no more than the limit, nothing waiting. */
function writeOffs(run: MoneyRun): Invoice[] {
  const index = ledgers(run);
  return owing(run).filter((invoice) => {
    const ledger = index.get(invoice.id)!;
    return dec(ledger.balance).lte("5.00") && dec(ledger.pending).isZero();
  });
}

/** Invoices that may take a credit note: live, not a contract billing, never written off, with room left. */
function noteCandidates(run: MoneyRun): Invoice[] {
  const index = ledgers(run);
  return run.books.invoices.filter(
    (i) =>
      !i.isReturn &&
      !i.voidedAt &&
      !i.billingId &&
      dec(index.get(i.id)!.writtenOff).isZero() &&
      noteRoom(run, i).gte(1),
  );
}

/** Invoices that may be voided: nothing confirmed, credited or written off, no live note, no stock gone. */
function voidable(run: MoneyRun): Invoice[] {
  const index = ledgers(run);
  return run.books.invoices.filter((i) => {
    if (i.isReturn || i.voidedAt || i.billingId || hasLiveNote(run, i.id) || run.memory.issuedInvoices.has(i.id))
      return false;
    const ledger = index.get(i.id)!;
    return dec(ledger.paid).isZero() && dec(ledger.credited).isZero() && dec(ledger.writtenOff).isZero();
  });
}

/** Suppliers with bills. */
function supplierIds(run: MoneyRun): string[] {
  return [...new Set(run.books.bills.map((bill) => bill.supplierId))];
}

/** Draws one applicable step by weight. */
export function drawStep(run: MoneyRun, rng: Rng): MoneyStep {
  const open = MONEY_STEPS.filter((step) => step.applicable(run));
  const total = open.reduce((n, step) => n + step.weight, 0);
  let ticket = rng.int(1, total);
  for (const step of open) {
    ticket -= step.weight;
    if (ticket <= 0) return step;
  }
  return open[open.length - 1]!;
}
