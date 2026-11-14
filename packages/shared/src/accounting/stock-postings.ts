import { dec, moneyString, type Dec } from "../money";
import type { PostingDraft, PostingLine } from "./postings";
import type { LedgerKey } from "./settings";

/**
 * Stock and payables postings (P12 part 3; ADR 0042; blueprint pages 24, 25 and 48). Goods are
 * valued at cost: what was received is owed to the supplier before the bill arrives (Goods
 * Received Not Billed), the bill moves it to Accounts Payable, a payment moves that to the bank,
 * and goods leave stock at their average cost (ADR 0040) into Cost of Goods Sold.
 */

function line(account: LedgerKey, debit: Dec, credit: Dec, locationId: string | null = null): PostingLine {
  return { account, debit: moneyString(debit), credit: moneyString(credit), locationId, customerId: null };
}

/** Drops lines that round to zero, so an entry never carries an empty line. */
function present(lines: PostingLine[]): PostingLine[] {
  return lines.filter((entry) => dec(entry.debit).gt(0) || dec(entry.credit).gt(0));
}

/** One received value per warehouse, as `receiptPosting` takes it. */
export interface ValueAt {
  locationId: string;
  value: string;
}

/**
 * Goods received (purchasing rule 19): debit Inventory at each warehouse for the received value at
 * the order's cost, credit Goods Received Not Billed. Damaged units are not stock and not billed.
 */
export function receiptPosting(
  receipt: { id: string; number: string; date: string; orderNumber: string },
  values: readonly ValueAt[],
): PostingDraft {
  const total = values.reduce((sum, entry) => sum.plus(entry.value), dec(0));
  return {
    event: "goods.received",
    sourceType: "goods_receipt",
    sourceId: receipt.id,
    sourceNumber: receipt.number,
    date: receipt.date,
    memo: `Goods received ${receipt.number} for ${receipt.orderNumber}`,
    lines: present([
      ...values.map((entry) => line("inventory", dec(entry.value), dec(0), entry.locationId)),
      line("received_not_billed", dec(0), total),
    ]),
  };
}

/**
 * A supplier's bill for received goods (purchasing rules 20 and 21): debit Goods Received Not
 * Billed for the received value it covers, credit Accounts Payable for the bill's total. A
 * difference (the match issue) is a price difference on goods in stock, so it moves Inventory
 * (blueprint-delta 2026-11-14; a question for the accountant). Bills an expense or a contract
 * raised never pass here: their own documents posted the payable.
 */
export function billPosting(
  bill: { id: string; number: string; issuedAt: string; total: string; supplierName: string },
  receivedValue: string,
): PostingDraft {
  const total = dec(bill.total);
  const received = dec(receivedValue);
  const difference = total.minus(received);
  return {
    event: "bill.entered",
    sourceType: "bill",
    sourceId: bill.id,
    sourceNumber: bill.number,
    date: bill.issuedAt,
    memo: `Bill ${bill.number} from ${bill.supplierName}`,
    lines: present([
      line("received_not_billed", received, dec(0)),
      difference.gt(0) ? line("inventory", difference, dec(0)) : line("inventory", dec(0), difference.negated()),
      line("accounts_payable", dec(0), total),
    ]),
  };
}

/** A confirmed supplier payment (purchasing rule 25): debit Accounts Payable, credit the method's bank. */
export function supplierPaymentPosting(
  payment: { id: string; number: string; date: string; amount: string; supplierName: string },
  cashAccount: LedgerKey,
): PostingDraft {
  const amount = dec(payment.amount);
  return {
    event: "supplier_payment.confirmed",
    sourceType: "supplier_payment",
    sourceId: payment.id,
    sourceNumber: payment.number,
    date: payment.date,
    memo: `Payment ${payment.number} to ${payment.supplierName}`,
    lines: present([line("accounts_payable", amount, dec(0)), line(cashAccount, dec(0), amount)]),
  };
}

/**
 * A stock count correction (inventory plan A-1): the change in quantity at cost. More than the
 * books said debits Inventory and credits Inventory Adjustments; less does the opposite.
 */
export function stockAdjustmentPosting(
  adjustment: { id: string; number: string; date: string; locationId: string; productName: string },
  value: string,
): PostingDraft {
  const amount = dec(value);
  const gain = amount.gt(0);
  const size = amount.abs();
  return {
    event: "stock.adjusted",
    sourceType: "stock_adjustment",
    sourceId: adjustment.id,
    sourceNumber: adjustment.number,
    date: adjustment.date,
    memo: `Stock count ${adjustment.number}, ${adjustment.productName}`,
    lines: present(
      gain
        ? [line("inventory", size, dec(0), adjustment.locationId), line("inventory_adjustments", dec(0), size)]
        : [line("inventory_adjustments", size, dec(0)), line("inventory", dec(0), size, adjustment.locationId)],
    ),
  };
}

/**
 * Goods leaving stock for a sale (ADR 0040, average cost): debit Cost of Goods Sold at the selling
 * location, credit Inventory at the warehouse. Inventory part 2 posts it when stock is cut or issued.
 */
export function costOfGoodsPosting(
  issue: { id: string; number: string; date: string; warehouseId: string; soldAtId: string; memo: string },
  cost: string,
): PostingDraft {
  const amount = dec(cost);
  return {
    event: "goods.issued",
    sourceType: "stock_issue",
    sourceId: issue.id,
    sourceNumber: issue.number,
    date: issue.date,
    memo: issue.memo,
    lines: present([
      line("cost_of_goods_sold", amount, dec(0), issue.soldAtId),
      line("inventory", dec(0), amount, issue.warehouseId),
    ]),
  };
}

/**
 * The moving average cost of a boxed product after a receipt (ADR 0040): the value on hand plus
 * the value received, over the quantity after. With nothing (or less than nothing) on hand, the
 * received cost stands. Rounded to the unit-cost scale, numeric(14,4).
 */
export function averageCost(onHand: string, currentCost: string, received: string, receivedCost: string): string {
  const before = dec(onHand);
  const after = before.plus(received);
  if (before.lte(0) || after.lte(0)) return dec(receivedCost).toDecimalPlaces(4).toFixed(4);
  return before
    .times(currentCost)
    .plus(dec(received).times(receivedCost))
    .dividedBy(after)
    .toDecimalPlaces(4)
    .toFixed(4);
}
