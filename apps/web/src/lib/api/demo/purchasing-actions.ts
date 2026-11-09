import {
  allocate,
  billFromReceipts,
  billLedger,
  dec,
  moneyString,
  needsApproval,
  nextNumber,
  nextPaymentNumber,
  poTotal,
  receiptProblem,
  receiptStock,
  receivedValue,
  unbilledReceipts,
  type GoodsReceipt,
  type PurchaseOrder,
  type SupplierPayment,
} from "@workspace/shared";
import type {
  BillInput,
  NewPurchaseOrderInput,
  PaymentDecision,
  ReceiptInput,
  SupplierPaymentInput,
} from "../contract";
import { DemoRuleError } from "./admin-rules";
import { describeFiles, storeFiles, type ActionContext } from "./payment-actions";

const dollars = (amount: string) => `$${moneyString(amount)}`;

function orderOf(ctx: ActionContext, poId: string): PurchaseOrder {
  const po = ctx.db.get("purchaseOrders", poId);
  if (!po) throw new DemoRuleError("This purchase order no longer exists.");
  return po;
}

/** Creates a purchase order (spec D1): saved as a draft, or ordered at once. Audited. */
export async function createPurchaseOrder(ctx: ActionContext, input: NewPurchaseOrderInput) {
  await ctx.assertCan(["purchasing.order.create"]);
  if (input.lines.length === 0) throw new DemoRuleError("Add at least one line to the purchase order.");
  if (!ctx.db.get("suppliers", input.supplierId)) throw new DemoRuleError("Choose a supplier.");
  if (input.lines.some((l) => !dec(l.quantity || "0").gt(0))) throw new DemoRuleError("Every line needs a quantity.");
  const po: PurchaseOrder = {
    id: ctx.newId("po"),
    number: nextNumber(
      ctx.db.settings.localization.documents.poPrefix,
      ctx.db.list("purchaseOrders").map((p) => p.number),
      3001,
    ),
    supplierId: input.supplierId,
    status: input.asDraft ? "draft" : "ordered",
    createdAt: ctx.today,
    locationId: input.locationId,
    expectedAt: input.expectedAt,
    orderedAt: input.asDraft ? null : ctx.today,
    cancelledAt: null,
    lines: input.lines,
    total: poTotal(input.lines),
  };
  ctx.db.put("purchaseOrders", po);
  ctx.audit({
    category: "data",
    action: input.asDraft ? "Saved purchase order draft" : "Created purchase order",
    target: po.number,
    before: null,
    after: `total ${po.total}`,
  });
  return po;
}

/** Sends a draft to the supplier (Draft → Ordered). Audited. */
export async function markOrdered(ctx: ActionContext, poId: string) {
  await ctx.assertCan(["purchasing.order.create"]);
  const po = orderOf(ctx, poId);
  if (po.status !== "draft") throw new DemoRuleError(`${po.number} is not a draft.`);
  const ordered: PurchaseOrder = { ...po, status: "ordered", orderedAt: ctx.today };
  ctx.db.put("purchaseOrders", ordered);
  ctx.audit({
    category: "data",
    action: "Ordered purchase order",
    target: po.number,
    before: "draft",
    after: "ordered",
  });
  return ordered;
}

/** Cancels an order before anything arrived (spec D1). Audited with the reason. */
export async function cancelOrder(ctx: ActionContext, poId: string, reason: string) {
  await ctx.assertCan(["purchasing.order.create"]);
  const po = orderOf(ctx, poId);
  if (ctx.db.list("receipts").some((r) => r.poId === poId))
    throw new DemoRuleError(`${po.number} has receipts and can't be cancelled.`);
  if (po.status === "cancelled") throw new DemoRuleError(`${po.number} is already cancelled.`);
  if (reason.trim().length < 3) throw new DemoRuleError("Say why the order is cancelled.");
  const cancelled: PurchaseOrder = { ...po, status: "cancelled", cancelledAt: ctx.today };
  ctx.db.put("purchaseOrders", cancelled);
  ctx.audit({
    category: "data",
    action: "Cancelled purchase order",
    target: po.number,
    before: po.status,
    after: `cancelled: ${reason.trim()}`,
  });
  return cancelled;
}

/**
 * Records what arrived (spec D2): per line good and damaged units, roll numbers and dye lots, the
 * receiving warehouse. Partial receipts are fine; the receipt writes its stock movements and rolls.
 */
export async function recordReceipt(ctx: ActionContext, poId: string, input: ReceiptInput) {
  await ctx.assertCan(["purchasing.order.receive"]);
  const po = orderOf(ctx, poId);
  const lines = input.lines.filter((l) =>
    dec(l.received || "0")
      .plus(l.damaged || "0")
      .gt(0),
  );
  const problem = receiptProblem(po, lines, ctx.db.list("receipts"));
  if (problem) throw new DemoRuleError(problem);
  const receipt: GoodsReceipt = {
    id: ctx.newId("gr"),
    number: nextPaymentNumber(
      "GR-",
      ctx.db.list("receipts").map((r) => r.number),
    ),
    poId: po.id,
    supplierId: po.supplierId,
    locationId: input.locationId || po.locationId,
    receivedAt: ctx.now,
    receivedById: ctx.actor.id,
    receivedBy: ctx.actor.name,
    note: input.note.trim(),
    lines: lines.map((l) => ({ ...l, received: l.received || "0", damaged: l.damaged || "0" })),
  };
  ctx.db.put("receipts", receipt);
  const stock = receiptStock(po, receipt, ctx.db.list("products"), {
    movementId: () => ctx.newId("mov"),
    rollId: () => ctx.newId("roll"),
  });
  for (const m of stock.movements) ctx.db.put("stockMovements", m);
  for (const r of stock.rolls) ctx.db.put("rolls", r);
  const damaged = receipt.lines.reduce((s, l) => s.plus(l.damaged), dec(0));
  ctx.audit({
    category: "data",
    action: "Received goods",
    target: `${receipt.number} for ${po.number}`,
    before: null,
    after: `${stock.rolls.length} rolls, ${stock.movements.length} stock lines${damaged.gt(0) ? `, ${damaged.toString()} damaged` : ""}`,
  });
  return receipt;
}

/**
 * Enters the supplier's bill against the receipts not yet billed (spec D2): differences from the
 * goods received are flagged, not blocked, and the supplier's invoice file is attached.
 */
export async function enterBill(ctx: ActionContext, poId: string, input: BillInput, files: readonly File[]) {
  await ctx.assertCan(["purchasing.bill.create"]);
  const po = orderOf(ctx, poId);
  const supplier = ctx.db.get("suppliers", po.supplierId)!;
  const open = unbilledReceipts(po, ctx.db.list("receipts"), ctx.db.list("bills"));
  if (open.length === 0) throw new DemoRuleError(`Nothing received on ${po.number} is waiting for a bill.`);
  if (!input.number.trim()) throw new DemoRuleError("Enter the supplier's bill number.");
  if (!dec(/^\d+(\.\d{1,2})?$/.test(input.total.trim()) ? input.total.trim() : "0").gt(0)) {
    throw new DemoRuleError("Enter the bill total.");
  }
  const id = ctx.newId("bill");
  const metas = await describeFiles(ctx, id, files);
  await storeFiles(ctx, metas, files);
  const bill = {
    ...billFromReceipts(po, supplier, open, {
      id,
      number: input.number.trim(),
      issuedAt: input.issuedAt || ctx.today,
      total: input.total.trim(),
      formatMoney: dollars,
    }),
    files: metas,
  };
  ctx.db.put("bills", bill);
  ctx.audit({
    category: "data",
    action: "Entered bill",
    target: `${bill.number} for ${po.number}`,
    before: `received ${dollars(moneyString(receivedValue(po, open)))}`,
    after: `total ${dollars(bill.total)}${bill.matchIssues.length ? `; ${bill.matchIssues.join(" ")}` : ""}`,
  });
  return bill;
}

/**
 * Pays a supplier (spec D3, mirroring Appendix A): method, reference except for cash, mandatory
 * proof, one payment split over the supplier's open bills (oldest due first, or as allocated), and
 * with approval on, it waits for a second person.
 */
export async function recordSupplierPayment(ctx: ActionContext, input: SupplierPaymentInput, files: readonly File[]) {
  await ctx.assertCan(["purchasing.payment.record"]);
  const amount = dec(/^\d+(\.\d{1,2})?$/.test(input.amount.trim()) ? input.amount.trim() : "0");
  if (amount.lte(0)) throw new DemoRuleError("Enter an amount above zero.");
  if (input.method !== "cash" && !input.reference.trim()) throw new DemoRuleError("Enter the payment reference.");
  if (!input.date || input.date > ctx.today) throw new DemoRuleError("The payment date cannot be in the future.");
  const payments = ctx.db.list("supplierPayments");
  const open = ctx.db
    .list("bills")
    .filter((b) => b.supplierId === input.supplierId)
    .map((b) => ({ ...b, balance: billLedger(b, payments, ctx.today).balance }))
    .filter((b) => dec(b.balance).gt(0))
    .filter((b) => !input.billIds?.length || input.billIds.includes(b.id));
  const owed = open.reduce((s, b) => s.plus(b.balance), dec(0));
  if (amount.gt(owed))
    throw new DemoRuleError(`This is more than the ${dollars(moneyString(owed))} owed on these bills.`);
  const id = ctx.newId("spay");
  const metas = await describeFiles(ctx, id, files);
  await storeFiles(ctx, metas, files);
  const payment: SupplierPayment = {
    id,
    number: nextPaymentNumber(
      "SP-",
      payments.map((p) => p.number),
    ),
    supplierId: input.supplierId,
    date: input.date,
    method: input.method,
    reference: input.reference.trim(),
    note: input.note.trim(),
    files: metas,
    allocations: allocate(moneyString(amount), open),
    amount: moneyString(amount),
    status: needsApproval(ctx.db.settings.payments, amount.toString()) ? "pending" : "confirmed",
    recordedById: ctx.actor.id,
    recordedBy: ctx.actor.name,
    recordedAt: ctx.now,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  };
  ctx.db.put("supplierPayments", payment);
  const supplier = ctx.db.get("suppliers", input.supplierId);
  ctx.audit({
    action: "Paid supplier",
    target: `${payment.number} to ${supplier?.name ?? ""}`,
    before: `owed ${dollars(moneyString(owed))}`,
    after: `${dollars(payment.amount)} over ${payment.allocations.length} bills, ${payment.status === "pending" ? "pending verification" : "confirmed"}`,
  });
  return payment;
}

/** Confirms or rejects a supplier payment that waits; never by the person who recorded it. Audited. */
export async function reviewSupplierPayment(ctx: ActionContext, paymentId: string, decision: PaymentDecision) {
  await ctx.assertCan(["purchasing.payment.approve"]);
  const payment = ctx.db.get("supplierPayments", paymentId);
  if (!payment || payment.status !== "pending")
    throw new DemoRuleError("This payment is not waiting for verification.");
  if (payment.recordedById === ctx.actor.id) throw new DemoRuleError("Someone else must verify your payment.");
  const reason = decision.action === "reject" ? decision.reason.trim() : "";
  if (decision.action === "reject" && reason.length < 3) throw new DemoRuleError("Say why the payment is rejected.");
  const reviewed: SupplierPayment = {
    ...payment,
    status: decision.action === "confirm" ? "confirmed" : "rejected",
    reviewedBy: ctx.actor.name,
    reviewedAt: ctx.now,
    rejectReason: reason || null,
  };
  ctx.db.put("supplierPayments", reviewed);
  ctx.audit({
    action: decision.action === "confirm" ? "Confirmed supplier payment" : "Rejected supplier payment",
    target: payment.number,
    before: "pending verification",
    after: decision.action === "confirm" ? "confirmed" : `rejected: ${reason}`,
  });
  return reviewed;
}

/** Voids a supplier payment with a reason; it stays visible and the bills owe again. Audited. */
export async function voidSupplierPayment(ctx: ActionContext, paymentId: string, reason: string) {
  await ctx.assertCan(["purchasing.payment.void"]);
  const payment = ctx.db.get("supplierPayments", paymentId);
  if (!payment || (payment.status !== "confirmed" && payment.status !== "pending")) {
    throw new DemoRuleError("This payment can't be voided.");
  }
  if (reason.trim().length < 3) throw new DemoRuleError("Say why the payment is voided.");
  const voided: SupplierPayment = {
    ...payment,
    status: "voided",
    voidedBy: ctx.actor.name,
    voidedAt: ctx.now,
    voidReason: reason.trim(),
  };
  ctx.db.put("supplierPayments", voided);
  ctx.audit({
    action: "Voided supplier payment",
    target: payment.number,
    before: payment.status,
    after: `voided: ${reason.trim()}`,
  });
  return voided;
}
