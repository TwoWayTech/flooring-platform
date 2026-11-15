import { addDays, daysBetween } from "../dates";
import { dec, maxDec, minDec, moneyString, roundMoney, roundUnitCost, sum, type Dec } from "../money";
import { isBoxed, stockUnit } from "../stock";
import type {
  Bill,
  GoodsReceipt,
  PoLine,
  Product,
  PurchaseOrder,
  ReceiptLine,
  Roll,
  StockMovement,
  Supplier,
  SupplierPayment,
  SupplierTerms,
} from "../types";

/** Supplier terms as people say them (spec D3). */
export const SUPPLIER_TERMS_LABELS: Record<SupplierTerms, string> = {
  pay_on_order: "Pay on order",
  cod: "Cash on delivery",
  net_30: "Net 30",
  net_60: "Net 60",
  net_90: "Net 90",
  net_180: "Net 180",
  monthly_statement: "Monthly statement",
};

const NET_DAYS: Partial<Record<SupplierTerms, number>> = { net_30: 30, net_60: 60, net_90: 90, net_180: 180 };

/**
 * When a supplier bill is due under the supplier's terms (spec D3): on the bill date for pay on
 * order and cash on delivery, after the net days, or at the end of the month after for a
 * monthly statement.
 */
export function supplierDueDate(issuedAt: string, terms: SupplierTerms): string {
  if (terms === "monthly_statement") {
    const [y, m] = issuedAt.split("-").map(Number) as [number, number];
    const next = new Date(Date.UTC(y, m + 1, 0));
    return next.toISOString().slice(0, 10);
  }
  return addDays(issuedAt, NET_DAYS[terms] ?? 0);
}

/** Total of purchase order lines: quantity × unit cost, each rounded to cents. */
export function poTotal(lines: readonly Pick<PoLine, "quantity" | "unitCost">[]): string {
  return moneyString(sum(lines.map((l) => roundMoney(dec(l.quantity).times(l.unitCost)))));
}

/**
 * Cartons for an area (spec D1: order by area, cartons are calculated), rounded up: 500 sq ft at
 * 23.64 sq ft per carton is 21.2, so 22 cartons.
 */
export function cartonsFor(areaSqFt: string, sqFtPerCarton: string): { exact: Dec; cartons: Dec } {
  const exact = dec(areaSqFt).div(sqFtPerCarton);
  return { exact: exact.toDecimalPlaces(1), cartons: exact.ceil() };
}

/** What has arrived so far for each PO line, good units only. */
export function receivedByLine(poId: string, receipts: readonly GoodsReceipt[]): Map<string, Dec> {
  const out = new Map<string, Dec>();
  for (const r of receipts.filter((x) => x.poId === poId)) {
    for (const l of r.lines) out.set(l.poLineId, (out.get(l.poLineId) ?? dec(0)).plus(l.received));
  }
  return out;
}

/**
 * Why a receipt cannot be recorded, or null (spec D2): something arrived, and never more than is
 * still due. Each order line appears once, and rolls entered for a line are broadloom and never
 * cover more area than was received on it, so a receipt can never make stock out of nothing
 * (PR #13 security review). Without `products` (older callers) the roll check is skipped.
 */
export function receiptProblem(
  po: PurchaseOrder,
  lines: readonly ReceiptLine[],
  receipts: readonly GoodsReceipt[],
  products?: readonly Product[],
): string | null {
  if (po.status !== "ordered") return `${po.number} is ${po.status === "draft" ? "still a draft" : "cancelled"}.`;
  const got = receivedByLine(po.id, receipts);
  const seen = new Set<string>();
  let any = false;
  for (const line of lines) {
    if (seen.has(line.poLineId)) return "Each order line can appear once on a receipt.";
    seen.add(line.poLineId);
    const rollProblem = products ? rollsProblem(line, products) : null;
    if (rollProblem) return rollProblem;
    const ordered = po.lines.find((l) => l.id === line.poLineId);
    if (!ordered) return "A line is not on this purchase order.";
    const received = dec(line.received || "0");
    const damaged = dec(line.damaged || "0");
    if (received.lt(0) || damaged.lt(0)) return "Quantities cannot be negative.";
    if (received.plus(damaged).gt(0)) any = true;
    const open = dec(ordered.quantity).minus(got.get(ordered.id) ?? 0);
    if (received.plus(damaged).gt(open)) return `${ordered.description}: only ${open.toString()} is still to come.`;
  }
  return any ? null : "Enter what arrived on at least one line.";
}

/** Rolls entered on a receipt line: only for broadloom, each with a length, together no more area than received. */
function rollsProblem(line: ReceiptLine, products: readonly Product[]): string | null {
  if (line.rolls.length === 0) return null;
  const product = products.find((p) => p.id === line.productId);
  if (!product || stockUnit(product) !== "ft" || !product.widthFt) return "Rolls can only be entered for broadloom.";
  if (line.rolls.some((roll) => !dec(roll.lengthFt || "0").gt(0))) return "Every roll needs a length.";
  const area = sum(line.rolls.map((roll) => dec(roll.lengthFt).times(product.widthFt!)));
  // One square foot of rounding is allowed between the roll labels and the received area.
  if (area.gt(dec(line.received || "0").plus(1))) {
    return `The rolls add up to ${area.toString()} sq ft, more than the ${line.received || "0"} received.`;
  }
  return null;
}

/**
 * The stock a receipt brings in (spec D2): boxed goods as receipt movements, broadloom as the
 * rolls entered (or one roll for the line when none were entered), costed per sq ft from the
 * line's cost. Damaged units do not enter stock.
 */
export function receiptStock(
  po: PurchaseOrder,
  receipt: GoodsReceipt,
  products: readonly Product[],
  ids: { movementId: () => string; rollId: () => string },
): { movements: StockMovement[]; rolls: Roll[] } {
  const movements: StockMovement[] = [];
  const rolls: Roll[] = [];
  for (const line of receipt.lines) {
    const product = products.find((p) => p.id === line.productId);
    const ordered = po.lines.find((l) => l.id === line.poLineId);
    if (!product || !ordered || dec(line.received).lte(0)) continue;
    if (stockUnit(product) === "ft" && product.widthFt) {
      const fallback = dec(line.received).dividedBy(product.widthFt).toDecimalPlaces(1);
      const entered = line.rolls.length
        ? line.rolls
        : [
            {
              rollNumber: `${product.sku.slice(0, 2)}-${receipt.number.slice(-4)}`,
              dyeLot: `${po.number.slice(-3)}A`,
              lengthFt: fallback.toString(),
            },
          ];
      for (const r of entered) {
        rolls.push({
          id: ids.rollId(),
          rollNumber: r.rollNumber,
          productId: product.id,
          dyeLot: r.dyeLot,
          widthFt: product.widthFt,
          originalLengthFt: r.lengthFt,
          remainingLengthFt: r.lengthFt,
          costPerSqFt: roundUnitCost(dec(ordered.unitCost)).toString(),
          locationId: line.locationId ?? receipt.locationId,
          bin: "Receiving",
          transferId: null,
          isRemnant: false,
          parentRollId: null,
          receivedAt: receipt.receivedAt.slice(0, 10),
          cuts: [],
        });
      }
    } else if (isBoxed(product)) {
      movements.push({
        id: ids.movementId(),
        at: receipt.receivedAt,
        productId: product.id,
        locationId: line.locationId ?? receipt.locationId,
        quantity: dec(line.received).toString(),
        kind: "receipt",
        source: { kind: "receipt", id: receipt.id, number: receipt.number },
        byUserId: receipt.receivedById,
      });
    }
  }
  return { movements, rolls };
}

/** Value of the good units on some receipts, at the PO's costs: what may be billed for them. */
export function receivedValue(
  po: { lines: readonly Pick<PoLine, "id" | "unitCost">[] },
  receipts: readonly { lines: readonly Pick<ReceiptLine, "poLineId" | "received">[] }[],
): Dec {
  return sum(
    receipts.flatMap((r) =>
      r.lines.map((l) => roundMoney(dec(l.received).times(po.lines.find((x) => x.id === l.poLineId)?.unitCost ?? 0))),
    ),
  );
}

/** Receipts of a PO not yet on any bill (spec D2: what was received is what can be billed). */
export function unbilledReceipts(
  po: PurchaseOrder,
  receipts: readonly GoodsReceipt[],
  bills: readonly Bill[],
): GoodsReceipt[] {
  const billed = new Set(bills.flatMap((b) => b.receiptIds));
  return receipts.filter((r) => r.poId === po.id && !billed.has(r.id));
}

/** Differences between a supplier's bill and the goods received, in words (spec D2: flagged, not blocked). */
export function matchIssues(total: string, expected: Dec, formatMoney: (v: string) => string): string[] {
  const diff = dec(total).minus(expected);
  if (diff.abs().lt("0.01")) return [];
  return [
    `Billed ${formatMoney(moneyString(total))}, received goods worth ${formatMoney(moneyString(expected))} (${diff.gt(0) ? "over" : "under"} by ${formatMoney(moneyString(diff.abs()))}).`,
  ];
}

/** What a bill owes now, from confirmed supplier payments (spec D3). */
export interface BillLedger {
  /** Waiting for verification (audit U-04). */
  pending: string;
  /** The balance less what is waiting. */
  unpaid: string;
  paid: string;
  balance: string;
  state: "open" | "partial" | "paid";
  overdue: boolean;
  daysOverdue: number;
}

/** The bill fields a bill's ledger reads, so callers may pass narrow rows (reports, ADR 0055). */
export type LedgerBill = Pick<Bill, "id" | "total" | "dueAt">;

/** The supplier payment fields a bill's ledger reads: its status and how it was split over bills. */
export type LedgerSupplierPayment = Pick<SupplierPayment, "status"> & {
  allocations: readonly Pick<SupplierPayment["allocations"][number], "billId" | "amount">[];
};

/** A bill's ledger: total − confirmed allocations, never below zero; overdue past its due date. */
export function billLedger(bill: LedgerBill, payments: readonly LedgerSupplierPayment[], today: string): BillLedger {
  const paid = sum(
    payments
      .filter((p) => p.status === "confirmed")
      .flatMap((p) => p.allocations.filter((a) => a.billId === bill.id).map((a) => a.amount)),
  );
  const pending = sum(
    payments
      .filter((p) => p.status === "pending")
      .flatMap((p) => p.allocations.filter((a) => a.billId === bill.id).map((a) => a.amount)),
  );
  const balance = maxDec(dec(bill.total).minus(paid), 0);
  const overdue = balance.gt(0) && daysBetween(bill.dueAt, today) > 0;
  return {
    paid: moneyString(paid),
    pending: moneyString(pending),
    /** What can still be paid: the balance less what already waits for a check (audit U-04). */
    unpaid: moneyString(maxDec(balance.minus(pending), 0)),
    balance: moneyString(balance),
    state: balance.isZero() ? "paid" : paid.gt(0) ? "partial" : "open",
    overdue,
    daysOverdue: overdue ? daysBetween(bill.dueAt, today) : 0,
  };
}

/** A purchase order's status (spec D1): stored Draft / Ordered / Cancelled, the rest derived. */
export type PoState =
  "draft" | "ordered" | "partly_received" | "received" | "billed" | "partly_paid" | "paid" | "cancelled";

/** Words for each PO status. */
export const PO_STATE_LABELS: Record<PoState, string> = {
  draft: "Draft",
  ordered: "Ordered",
  partly_received: "Partly received",
  received: "Received",
  billed: "Billed",
  partly_paid: "Partly paid",
  paid: "Paid",
  cancelled: "Cancelled",
};

/** Derives a PO's status from its receipts, its bills and what was paid on them. */
export function poState(
  po: PurchaseOrder,
  receipts: readonly GoodsReceipt[],
  bills: readonly Bill[],
  payments: readonly SupplierPayment[],
  today: string,
): PoState {
  if (po.status !== "ordered") return po.status;
  const got = receivedByLine(po.id, receipts);
  const anyIn = [...got.values()].some((v) => v.gt(0));
  if (!anyIn) return "ordered";
  const all = po.lines.every((l) => (got.get(l.id) ?? dec(0)).gte(l.quantity));
  const own = bills.filter((b) => b.poId === po.id);
  const fullyBilled = all && unbilledReceipts(po, receipts, bills).length === 0 && own.length > 0;
  if (!fullyBilled) return all ? "received" : "partly_received";
  const ledgers = own.map((b) => billLedger(b, payments, today));
  if (ledgers.every((l) => l.state === "paid")) return "paid";
  return ledgers.some((l) => l.state !== "open") ? "partly_paid" : "billed";
}

/**
 * Splits one supplier payment over bills (spec D3), oldest due first, each up to what it still
 * owes; whatever is left over is not allocated.
 */
export function allocate(
  amount: string,
  bills: readonly (Bill & { balance: string })[],
): { billId: string; amount: string }[] {
  let left = dec(amount);
  const out: { billId: string; amount: string }[] = [];
  for (const bill of [...bills].sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
    if (left.lte(0)) break;
    const take = minDec(left, bill.balance);
    if (take.lte(0)) continue;
    out.push({ billId: bill.id, amount: moneyString(take) });
    left = left.minus(take);
  }
  return out;
}

/** What the company owes one supplier (spec D3): balance, credit used against the limit, next due date. */
export interface SupplierBalance {
  owed: string;
  overdue: string;
  creditLimit: string;
  /** Share of the credit limit in use, as a percent; 0 without a limit. */
  creditUsedPct: string;
  nextDueAt: string | null;
}

/** A supplier's balance from its bills' ledgers. */
export function supplierBalance(
  supplier: Pick<Supplier, "id" | "creditLimit">,
  bills: readonly Bill[],
  ledgers: ReadonlyMap<string, BillLedger>,
): SupplierBalance {
  const own = bills.filter((b) => b.supplierId === supplier.id && dec(ledgers.get(b.id)?.balance ?? "0").gt(0));
  const owed = sum(own.map((b) => ledgers.get(b.id)!.balance));
  const overdue = sum(own.filter((b) => ledgers.get(b.id)!.overdue).map((b) => ledgers.get(b.id)!.balance));
  const limit = dec(supplier.creditLimit || "0");
  return {
    owed: moneyString(owed),
    overdue: moneyString(overdue),
    creditLimit: moneyString(limit),
    creditUsedPct: limit.gt(0) ? owed.div(limit).times(100).toDecimalPlaces(1).toString() : "0",
    nextDueAt:
      own
        .filter((b) => !ledgers.get(b.id)!.overdue)
        .map((b) => b.dueAt)
        .sort()[0] ?? null,
  };
}

/** A supplier bill for received goods, due under the supplier's terms (spec D2, D3). */
export function billFromReceipts(
  po: PurchaseOrder,
  supplier: Supplier,
  receipts: readonly GoodsReceipt[],
  input: { id: string; number: string; issuedAt: string; total: string; formatMoney: (v: string) => string },
): Bill {
  return {
    id: input.id,
    number: input.number,
    supplierId: supplier.id,
    poId: po.id,
    receiptIds: receipts.map((r) => r.id),
    issuedAt: input.issuedAt,
    dueAt: supplierDueDate(input.issuedAt, supplier.terms),
    total: moneyString(input.total),
    matchIssues: matchIssues(input.total, receivedValue(po, receipts), input.formatMoney),
    files: [],
  };
}

/**
 * Payables in two figures (spec D3, like receivables in B5): current and overdue from each bill's
 * due date, and what falls due in the next 7 days.
 */
export function payablesSummary(bills: readonly Bill[], ledgers: ReadonlyMap<string, BillLedger>, today: string) {
  const open = bills.filter((b) => dec(ledgers.get(b.id)?.balance ?? "0").gt(0));
  const balance = (b: Bill) => ledgers.get(b.id)!.balance;
  const late = open.filter((b) => ledgers.get(b.id)!.overdue);
  const current = open.filter((b) => !ledgers.get(b.id)!.overdue);
  const soon = addDays(today, 7);
  return {
    total: moneyString(sum(open.map(balance))),
    current: moneyString(sum(current.map(balance))),
    overdue: moneyString(sum(late.map(balance))),
    dueSoon: moneyString(sum(current.filter((b) => b.dueAt <= soon).map(balance))),
  };
}

/** Every bill's ledger at once, keyed by bill id. */
export function billLedgerIndex(
  bills: readonly LedgerBill[],
  payments: readonly LedgerSupplierPayment[],
  today: string,
): Map<string, BillLedger> {
  return new Map(bills.map((b) => [b.id, billLedger(b, payments, today)]));
}
