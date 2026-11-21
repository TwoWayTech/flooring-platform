import { addDays, daysBetween, last12Months } from "../../src/dates";
import { dec, moneyString, roundMoney, sum } from "../../src/money";
import type {
  Bill,
  Expense,
  ExpenseCategory,
  GoodsReceipt,
  PoLine,
  Product,
  PurchaseOrder,
  Supplier,
  SupplierPayment,
  SupplierTerms,
  User,
} from "../../src/types";
import { warehouseIds } from "./locations";
import type { GenContext } from "./context";
import { EMPTY } from "./expense-records";
import { supplierDueDate } from "../../src/operations/purchasing";
import { brandCode } from "./vocabulary";

const ORDERS_PER_MONTH = 5;

/** Generated purchasing documents for one company. */
export interface PurchasingFixtures {
  purchaseOrders: PurchaseOrder[];
  receipts: GoodsReceipt[];
  bills: Bill[];
  supplierPayments: SupplierPayment[];
}

function orderQuantity(ctx: GenContext, product: Product): string {
  if (product.category === "carpet" || product.category === "pad") return String(ctx.rng.int(15, 70) * 90);
  if (product.sqFtPerCarton)
    return dec(ctx.rng.int(4, 30) * 10)
      .times(product.sqFtPerCarton)
      .toString();
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
    ...(p.sqFtPerCarton ? { sqFtPerCarton: p.sqFtPerCarton } : {}),
  }));
}

/** How far along an order was by its age: drafts this week, in transit, received, then billed. */
type Stage = "draft" | "sent" | "received" | "billed";

function poStage(ctx: GenContext, createdAt: string, expectedAt: string): Stage {
  const age = daysBetween(createdAt, ctx.anchor);
  if (age <= 3 && ctx.rng.chance(0.5)) return "draft";
  if (expectedAt >= ctx.anchor) return "sent";
  return daysBetween(expectedAt, ctx.anchor) > 6 ? "billed" : "received";
}

/**
 * The days the payment draws were tuned with, per term, so the same random numbers are drawn as
 * before batch 2 and every later fixture stays the same (the bills' real due dates use the terms).
 */
const DRAW_DAYS: Partial<Record<SupplierTerms, number>> = { net_30: 30, net_60: 45, cod: 15 };

/** Supplier payments: old bills are settled, recent ones open or part-paid, so payables have an aging. */
function paidFor(ctx: GenContext, bill: Bill, terms: SupplierTerms): { at: string; amount: string } | null {
  const drawDue = addDays(bill.issuedAt, DRAW_DAYS[terms] ?? 30);
  const overdueDays = daysBetween(drawDue, ctx.anchor);
  const settled =
    overdueDays > 20 ? ctx.rng.chance(0.93) : overdueDays > 0 ? ctx.rng.chance(0.5) : ctx.rng.chance(0.15);
  if (!settled) return null;
  const partial = overdueDays <= 20 && ctx.rng.chance(0.3);
  const amount = partial ? moneyString(dec(bill.total).times("0.5")) : bill.total;
  const at = [addDays(bill.issuedAt, ctx.rng.int(10, 45)), ctx.anchor].sort()[0]!;
  return { at, amount };
}

/** A supplier payment record for a drawn payment (spec D3): numbered, with a reference and proof. */
function supplierPayment(
  ctx: GenContext,
  bill: Bill,
  paid: { at: string; amount: string },
  seq: number,
  payer: { id: string; name: string },
): SupplierPayment {
  const number = `SP-${String(seq).padStart(4, "0")}`;
  const method = seq % 3 === 0 ? "check" : "ach";
  return {
    id: ctx.id("spay"),
    number,
    supplierId: bill.supplierId,
    date: paid.at,
    method,
    reference:
      method === "check"
        ? `CHK-${4000 + seq}`
        : `ACH-${paid.at.slice(2).replaceAll("-", "")}-${String(seq).padStart(3, "0")}`,
    note: "",
    files: [
      {
        id: `${bill.id}-sp-proof`,
        name: `${number}-remittance.pdf`,
        type: "application/pdf",
        size: 2600 + seq * 7,
        uploadedBy: payer.name,
        uploadedAt: `${paid.at}T11:00`,
      },
    ],
    allocations: [{ billId: bill.id, amount: paid.amount }],
    amount: paid.amount,
    status: "confirmed",
    recordedById: payer.id,
    recordedBy: payer.name,
    recordedAt: `${paid.at}T11:00`,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  };
}

/** A receipt of the whole order, or of half of each line for every fourth order still open (spec D2). */
function receiptFor(
  ctx: GenContext,
  po: PurchaseOrder,
  at: string,
  partial: boolean,
  by: { id: string; name: string },
  seq: number,
): GoodsReceipt {
  return {
    id: ctx.id("gr"),
    number: `GR-${String(seq).padStart(4, "0")}`,
    poId: po.id,
    supplierId: po.supplierId,
    locationId: po.locationId,
    receivedAt: `${at}T10:00`,
    receivedById: by.id,
    receivedBy: by.name,
    note: "",
    lines: po.lines.map((l) => ({
      poLineId: l.id,
      productId: l.productId,
      received: partial ? halfReceived(l) : l.quantity,
      damaged: "0",
      rolls: [],
    })),
  };
}

/** Half a line, rounded up: in whole cartons for boxed goods (ADR 0027, F-m), so the rest can still arrive. */
function halfReceived(line: PoLine): string {
  if (!line.sqFtPerCarton) return dec(line.quantity).div(2).ceil().toString();
  return dec(line.quantity).div(line.sqFtPerCarton).div(2).ceil().times(line.sqFtPerCarton).toString();
}

/**
 * Twelve months of purchase orders from the catalog's suppliers (spec section 4, D1 to D3): drafts,
 * orders in transit, full and partial receipts, bills matched to their receipts and supplier
 * payments, so payables have an aging. Receipts here predate the opening stock counts, so they
 * carry no movements of their own; the stock fixtures already hold what arrived.
 */
export function buildPurchasing(
  ctx: GenContext,
  suppliers: Supplier[],
  products: readonly Product[],
  users: readonly User[],
): PurchasingFixtures {
  if (!ctx.company.sales) return { purchaseOrders: [], receipts: [], bills: [], supplierPayments: [] };
  suppliers.forEach((s, i) => (s.creditLimit = String((2 + (i % 4)) * 10000) + ".00"));
  const holder = (role: string) => users.find((u) => u.roleIds.some((r) => r.endsWith(role)));
  const receiver = holder("-role-warehouse") ?? holder("-role-owner")!;
  const payer = holder("-role-accountant") ?? holder("-role-owner")!;
  const stocked = suppliers.filter((s) => products.some((p) => p.supplierId === s.id && p.category !== "service"));
  const dates = last12Months(ctx.anchor).flatMap((month) =>
    Array.from({ length: ORDERS_PER_MONTH }, () => `${month}-${String(ctx.rng.int(1, 28)).padStart(2, "0")}`),
  );
  const purchaseOrders: PurchaseOrder[] = [];
  const receipts: GoodsReceipt[] = [];
  const bills: Bill[] = [];
  const supplierPayments: SupplierPayment[] = [];
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
      const stage = poStage(ctx, createdAt, expectedAt);
      const received = stage === "received" || stage === "billed";
      const total = moneyString(sum(lines.map((l) => roundMoney(dec(l.quantity).times(l.unitCost)))));
      const receivedAt = received ? [addDays(expectedAt, ctx.rng.int(-2, 2)), ctx.anchor].sort()[0]! : null;
      const po: PurchaseOrder = {
        id: ctx.id("po"),
        number: `PO-${3001 + i}`,
        supplierId: supplier.id,
        status: stage === "draft" ? "draft" : "ordered",
        createdAt,
        locationId: warehouseIds(ctx.company.id)[i % 3 === 2 ? 1 : 0]!,
        expectedAt,
        orderedAt: stage === "draft" ? null : createdAt,
        cancelledAt: null,
        lines,
        contactId: null,
        contactSnapshot: null,
        supplierRef: "",
        buyerId: "",
        placedVia: null,
        total,
      };
      purchaseOrders.push(po);
      if (!receivedAt) return;
      const receipt = receiptFor(
        ctx,
        po,
        receivedAt,
        stage === "received" && i % 4 === 0,
        receiver,
        receipts.length + 1,
      );
      receipts.push(receipt);
      if (stage !== "billed") return;
      const bill: Bill = {
        id: ctx.id("bill"),
        number: `${brandCode(supplier.name)}-${ctx.rng.int(10000, 99999)}`,
        supplierId: supplier.id,
        poId: po.id,
        receiptIds: [receipt.id],
        issuedAt: receivedAt,
        dueAt: supplierDueDate(receivedAt, supplier.terms),
        total,
        matchIssues: [],
        files: [],
      };
      const paid = paidFor(ctx, bill, supplier.terms);
      bills.push(bill);
      if (paid) supplierPayments.push(supplierPayment(ctx, bill, paid, supplierPayments.length + 1, payer));
    });
  return { purchaseOrders, receipts, bills, supplierPayments };
}

/** Monthly operating cost as a share of average monthly gross margin, by category. */
const EXPENSE_SHARES: readonly [ExpenseCategory, string, number][] = [
  ["payroll", "Office and sales payroll", 0.42],
  ["rent", "Showroom and warehouse rent", 0.16],
  ["electricity", "Utilities", 0.03],
  ["fuel_vehicles", "Van leases and fuel", 0.05],
  ["marketing", "Local advertising", 0.06],
  ["insurance", "General liability insurance", 0.03],
  ["internet_phone", "Internet and phone service", 0.015],
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
          ...EMPTY,
          id: ctx.id("exp"),
          date: `${month}-${flat ? "01" : String(ctx.rng.int(2, 27)).padStart(2, "0")}`,
          category,
          note: description,
          amount: moneyString(dec(avgMonthlyGross).times(share).times(factor)),
        };
      }),
    )
    .filter((e) => e.date <= ctx.anchor);
}
