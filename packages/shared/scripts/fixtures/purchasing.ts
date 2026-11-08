import { addDays, daysBetween, last12Months } from "../../src/dates";
import { dec, moneyString, roundMoney, sum } from "../../src/money";
import type { Bill, BillPayment, Expense, PoLine, Product, PurchaseOrder, Supplier } from "../../src/types";
import { warehouseIds } from "./locations";
import type { GenContext } from "./context";
import { dueDate } from "../../src/operations/quotes";
import { brandCode } from "./vocabulary";

const ORDERS_PER_MONTH = 5;

/** Generated purchasing documents for one company. */
export interface PurchasingFixtures {
  purchaseOrders: PurchaseOrder[];
  bills: Bill[];
  billPayments: BillPayment[];
}

function orderQuantity(ctx: GenContext, product: Product): string {
  if (product.unit === "sq_yd") return String(ctx.rng.int(15, 70) * 10);
  if (product.unit === "carton") return String(ctx.rng.int(4, 30) * 10);
  return String(ctx.rng.int(2, 10) * 10);
}

function poLines(ctx: GenContext, products: readonly Product[]): PoLine[] {
  return ctx.rng.sample(products, ctx.rng.int(1, Math.min(4, products.length))).map((p) => ({
    id: ctx.id("pol"),
    productId: p.id,
    description: `${p.brand} ${p.name}`,
    quantity: orderQuantity(ctx, p),
    unit: p.unit,
    unitCost: p.cost,
  }));
}

/** PO status by age: drafts this week, sent while in transit, then received, then billed. */
function poStage(ctx: GenContext, createdAt: string, expectedAt: string): PurchaseOrder["status"] {
  const age = daysBetween(createdAt, ctx.anchor);
  if (age <= 3 && ctx.rng.chance(0.5)) return "draft";
  if (expectedAt >= ctx.anchor) return "sent";
  return daysBetween(expectedAt, ctx.anchor) > 6 ? "billed" : "received";
}

/** Bill payments: old bills are settled, recent ones open or part-paid, so payables have an aging. */
function billPaymentsFor(ctx: GenContext, bill: Bill): BillPayment[] {
  const overdueDays = daysBetween(bill.dueAt, ctx.anchor);
  const settled =
    overdueDays > 20 ? ctx.rng.chance(0.93) : overdueDays > 0 ? ctx.rng.chance(0.5) : ctx.rng.chance(0.15);
  if (!settled) return [];
  const partial = overdueDays <= 20 && ctx.rng.chance(0.3);
  const amount = partial ? moneyString(dec(bill.total).times("0.5")) : bill.total;
  const at = [addDays(bill.issuedAt, ctx.rng.int(10, 45)), ctx.anchor].sort()[0]!;
  return [{ id: ctx.id("bpay"), billId: bill.id, supplierId: bill.supplierId, at, amount }];
}

/**
 * Twelve months of purchase orders from the catalog's suppliers, the bills for received goods
 * and their payments (spec section 4: some bills stay open).
 */
export function buildPurchasing(
  ctx: GenContext,
  suppliers: readonly Supplier[],
  products: readonly Product[],
): PurchasingFixtures {
  if (!ctx.company.sales) return { purchaseOrders: [], bills: [], billPayments: [] };
  const stocked = suppliers.filter((s) => products.some((p) => p.supplierId === s.id && p.category !== "service"));
  const dates = last12Months(ctx.anchor).flatMap((month) =>
    Array.from({ length: ORDERS_PER_MONTH }, () => `${month}-${String(ctx.rng.int(1, 28)).padStart(2, "0")}`),
  );
  const purchaseOrders: PurchaseOrder[] = [];
  const bills: Bill[] = [];
  const billPayments: BillPayment[] = [];
  dates
    .filter((d) => d <= ctx.anchor)
    .sort()
    .forEach((createdAt, i) => {
      const supplier = ctx.rng.pick(stocked);
      const lines = poLines(
        ctx,
        products.filter((p) => p.supplierId === supplier.id && p.category !== "service"),
      );
      const expectedAt = addDays(createdAt, ctx.rng.int(6, 14));
      const status = poStage(ctx, createdAt, expectedAt);
      const received = status === "received" || status === "billed";
      const total = moneyString(sum(lines.map((l) => roundMoney(dec(l.quantity).times(l.unitCost)))));
      const po: PurchaseOrder = {
        id: ctx.id("po"),
        number: `PO-${3001 + i}`,
        supplierId: supplier.id,
        status,
        createdAt,
        locationId: warehouseIds(ctx.company.id)[i % 3 === 2 ? 1 : 0]!,
        expectedAt,
        receivedAt: received ? [addDays(expectedAt, ctx.rng.int(-2, 2)), ctx.anchor].sort()[0]! : null,
        lines,
        total,
      };
      purchaseOrders.push(po);
      if (status !== "billed") return;
      const bill: Bill = {
        id: ctx.id("bill"),
        number: `${brandCode(supplier.name)}-${ctx.rng.int(10000, 99999)}`,
        supplierId: supplier.id,
        poId: po.id,
        issuedAt: po.receivedAt!,
        dueAt: dueDate(po.receivedAt!, supplier.terms),
        total,
        paid: "0.00",
      };
      const paid = billPaymentsFor(ctx, bill);
      bill.paid = moneyString(sum(paid.map((p) => p.amount)));
      bills.push(bill);
      billPayments.push(...paid);
    });
  return { purchaseOrders, bills, billPayments };
}

/** Monthly operating cost as a share of average monthly gross margin, by category. */
const EXPENSE_SHARES: readonly [Expense["category"], string, number][] = [
  ["payroll", "Office and sales payroll", 0.42],
  ["rent", "Showroom and warehouse rent", 0.16],
  ["utilities", "Utilities", 0.03],
  ["vehicles", "Van leases and fuel", 0.05],
  ["marketing", "Local advertising", 0.06],
  ["insurance", "General liability insurance", 0.03],
  ["software", "Software subscriptions", 0.015],
];

/**
 * Operating expenses for the P&L, sized from the company's own average gross margin so net
 * income stays plausible. Rent and insurance are flat; the rest vary month to month.
 */
export function buildExpenses(ctx: GenContext, avgMonthlyGross: string): Expense[] {
  if (!ctx.company.sales) return [];
  return last12Months(ctx.anchor)
    .flatMap((month) =>
      EXPENSE_SHARES.map(([category, description, share]) => {
        const flat = category === "rent" || category === "insurance";
        const factor = flat ? "1" : ctx.rng.decimal(0.85, 1.15, 3);
        return {
          id: ctx.id("exp"),
          at: `${month}-${flat ? "01" : String(ctx.rng.int(2, 27)).padStart(2, "0")}`,
          category,
          description,
          amount: moneyString(dec(avgMonthlyGross).times(share).times(factor)),
        };
      }),
    )
    .filter((e) => e.at <= ctx.anchor);
}
