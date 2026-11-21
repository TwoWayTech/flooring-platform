import {
  adjustmentNeedsApproval,
  boxedOnHand,
  cutRoll,
  dec,
  invoiceLedger,
  invoiceFromRoll,
  isShort,
  mayIssue,
  nextNumber,
  nextPaymentNumber,
  planReservations,
  rollAvailable,
  cartonPack,
  isWholeCartons,
  stockIssueAction,
  stockUnit,
  type AdjustmentReason,
  type Invoice,
  type Reservation,
  type StockAdjustment,
  type StockMovement,
} from "@workspace/shared";
import type {
  AdjustmentDecision,
  AdjustmentInput,
  RollInvoiceInput,
  StockCorrectionInput,
  StockHold,
} from "../contract";
import { DemoRuleError } from "./admin-rules";
import type { ActionContext } from "./payment-actions";

/** The stock records reservation planning reads. */
const stockOf = (ctx: ActionContext) => ({
  rolls: ctx.db.list("rolls"),
  movements: ctx.db.list("stockMovements"),
  reservations: ctx.db.list("reservations"),
});

/** Reserves stock for a newly issued invoice (spec C2) and returns what was held or found short. */
export function reserveFor(ctx: ActionContext, invoice: Invoice): Reservation[] {
  const drafts = planReservations(invoice, ctx.db.list("products"), stockOf(ctx));
  const saved = drafts.map((d): Reservation => ({ ...d, id: ctx.newId("res"), createdAt: ctx.now }));
  for (const r of saved) ctx.db.put("reservations", r);
  return saved;
}

/** Gives back every active reservation of an invoice, e.g. when it is voided (spec C2). */
export function releaseFor(ctx: ActionContext, invoiceId: string): number {
  const held = ctx.db.list("reservations").filter((r) => r.invoiceId === invoiceId && r.status === "active");
  for (const r of held) ctx.db.put("reservations", { ...r, status: "released", closedAt: ctx.now });
  return held.length;
}

/** Open reservations with what a warehouse needs to cut against them (audit U-03). */
export async function listStockHolds(ctx: ActionContext): Promise<StockHold[]> {
  await ctx.assertCan(["inventory.roll.view", "inventory.product.view"]);
  const payments = ctx.db.list("payments");
  const adjustments = ctx.db.list("invoiceAdjustments");
  return ctx.db
    .list("reservations")
    .filter((r) => r.status === "active")
    .flatMap((r) => {
      const invoice = ctx.db.get("invoices", r.invoiceId);
      if (!invoice) return [];
      return [
        {
          reservationId: r.id,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          customerName: ctx.db.get("customers", invoice.customerId)?.name ?? "",
          mayIssue: mayIssue(invoiceLedger(invoice, { payments, adjustments }, ctx.today)),
          productId: r.productId,
          rollId: r.rollId,
          locationId: r.locationId,
          quantity: r.quantity,
          shortBy: r.shortBy,
        },
      ];
    });
}

/**
 * Cuts or issues reserved stock for its invoice (spec C1, C2): only once confirmed money has come
 * in, unless someone with inventory.reservation.override gives a reason. A roll is cut with the
 * existing remnant rule and the cut links the invoice; boxed goods leave through an issue movement.
 */
export async function issueReservation(ctx: ActionContext, reservationId: string, overrideReason?: string) {
  await ctx.assertCan(["inventory.roll.cut"]);
  const reservation = ctx.db.get("reservations", reservationId);
  if (!reservation || reservation.status !== "active") throw new DemoRuleError("This reservation is no longer open.");
  if (dec(reservation.quantity).lte(0)) throw new DemoRuleError("Nothing is reserved on this line; it is short.");
  const invoice = ctx.db.get("invoices", reservation.invoiceId)!;
  const ledger = invoiceLedger(
    invoice,
    { payments: ctx.db.list("payments"), adjustments: ctx.db.list("invoiceAdjustments") },
    ctx.today,
  );
  const override = overrideReason?.trim() ?? "";
  if (!mayIssue(ledger)) {
    if (!override) {
      throw new DemoRuleError(`Invoice ${invoice.number} has no confirmed payment yet. Record the deposit first.`);
    }
    await ctx.assertCan(["inventory.reservation.override"]);
  }
  const source = { kind: "invoice" as const, id: invoice.id, number: invoice.number };
  let after: string;
  let cutRollNumber: string | null = null;
  if (reservation.rollId) {
    const roll = ctx.db.get("rolls", reservation.rollId)!;
    cutRollNumber = roll.rollNumber;
    if (roll.transferId) throw new DemoRuleError(`Roll ${roll.rollNumber} is on a transfer; receive it first.`);
    const result = cutRoll(
      roll,
      { lengthFt: reservation.quantity, at: ctx.now, reference: invoice.number, byUserId: ctx.actor.id },
      { cutId: ctx.newId("cut"), remnantId: ctx.newId("roll") },
    );
    const cut = { ...result.roll.cuts.at(-1)!, source };
    ctx.db.put("rolls", { ...result.roll, cuts: [...result.roll.cuts.slice(0, -1), cut] });
    if (result.remnant) ctx.db.put("rolls", result.remnant);
    after = `cut ${reservation.quantity} ft from ${roll.rollNumber}${result.remnant ? `, remnant ${result.remnant.rollNumber}` : ""}`;
  } else {
    const movement: StockMovement = {
      id: ctx.newId("mov"),
      at: ctx.now,
      productId: reservation.productId,
      locationId: reservation.locationId,
      quantity: dec(reservation.quantity).negated().toString(),
      kind: "issue",
      source,
      byUserId: ctx.actor.id,
    };
    ctx.db.put("stockMovements", movement);
    after = `issued ${reservation.quantity}`;
  }
  const issued: Reservation = { ...reservation, status: "issued", closedAt: ctx.now, overrideReason: override || null };
  ctx.db.put("reservations", issued);
  ctx.audit({
    category: "data",
    action: stockIssueAction(!(override && !mayIssue(ledger)), invoice.number, cutRollNumber),
    target: invoice.number,
    before: "reserved",
    after: override && !mayIssue(ledger) ? `${after}; override: ${override}` : after,
  });
  return issued;
}

/** Applies an approved adjustment: a roll's length changes with a history line, boxed goods get a movement. */
function apply(ctx: ActionContext, adjustment: StockAdjustment) {
  const source = { kind: "adjustment" as const, id: adjustment.id, number: adjustment.number };
  if (adjustment.rollId) {
    const roll = ctx.db.get("rolls", adjustment.rollId)!;
    const remaining = dec(roll.remainingLengthFt).plus(adjustment.quantity);
    ctx.db.put("rolls", {
      ...roll,
      remainingLengthFt: remaining.toString(),
      cuts: [
        ...roll.cuts,
        {
          id: ctx.newId("cut"),
          at: ctx.now,
          lengthFt: dec(adjustment.quantity).negated().toString(),
          reference: adjustment.number,
          byUserId: adjustment.requestedById,
          source,
        },
      ],
    });
    return;
  }
  ctx.db.put("stockMovements", {
    id: ctx.newId("mov"),
    at: ctx.now,
    productId: adjustment.productId,
    locationId: adjustment.locationId,
    quantity: adjustment.quantity,
    kind: "adjustment",
    source,
    byUserId: adjustment.requestedById,
  });
}

/**
 * Corrects stock to what was physically counted (plan A-1): the difference is written as an
 * approved adjustment with the reason, so on hand still adds up and the change is audited.
 * Boxed goods must stay whole cartons or items.
 */
export async function correctStockCount(ctx: ActionContext, input: StockCorrectionInput) {
  await ctx.assertCan(["inventory.stock.correct"]);
  const reason = input.reason.trim();
  if (reason.length < 3) throw new DemoRuleError("Say why the count is being corrected.");
  const counted = dec(input.counted);
  if (counted.lt(0)) throw new DemoRuleError("A count cannot be negative.");
  const product = ctx.db.get("products", input.productId);
  if (!product || !stockUnit(product)) throw new DemoRuleError("This product is not stocked.");
  const roll = input.rollId ? ctx.db.get("rolls", input.rollId) : undefined;
  if (input.rollId && !roll) throw new DemoRuleError("This roll no longer exists.");
  if (!roll) {
    // The same rule as the API's count (F-m): a pack is a carton only above zero.
    const pack = cartonPack(product.sqFtPerCarton);
    if (pack ? !isWholeCartons(counted, pack) : !counted.isInteger()) {
      throw new DemoRuleError(pack ? `Count whole cartons: multiples of ${pack} sq ft.` : "Count whole items.");
    }
  }
  const before = roll
    ? dec(roll.remainingLengthFt)
    : boxedOnHand(ctx.db.list("stockMovements"), product.id, input.locationId);
  const change = counted.minus(before);
  if (change.isZero()) throw new DemoRuleError("That is what the books already say.");
  const adjustment: StockAdjustment = {
    id: ctx.newId("adj"),
    number: nextPaymentNumber(
      "ADJ-",
      ctx.db.list("stockAdjustments").map((a) => a.number),
    ),
    productId: product.id,
    rollId: roll?.id ?? null,
    locationId: roll?.locationId ?? input.locationId,
    quantity: change.toString(),
    reason: "count",
    note: reason,
    status: "approved",
    requestedById: ctx.actor.id,
    requestedBy: ctx.actor.name,
    requestedAt: ctx.now,
    reviewedBy: ctx.actor.name,
    reviewedAt: ctx.now,
    rejectReason: null,
  };
  ctx.db.put("stockAdjustments", adjustment);
  apply(ctx, adjustment);
  ctx.audit({
    category: "data",
    action: "Corrected stock count",
    target: roll ? `Roll ${roll.rollNumber}` : product.name,
    before: before.toString(),
    after: `${counted.toString()}: ${reason}`,
  });
  return adjustment;
}

const REASONS: readonly AdjustmentReason[] = ["damage", "count", "samples", "other"];

/**
 * Records a stock adjustment (spec C1): the only way stock changes without a sale, a receipt or a
 * transfer. A reason is required; above the company's quantity it waits for an Owner or Manager.
 */
export async function recordAdjustment(ctx: ActionContext, input: AdjustmentInput) {
  await ctx.assertCan(["inventory.stock.adjust"]);
  if (!REASONS.includes(input.reason)) throw new DemoRuleError("Choose why the stock changes.");
  if (input.reason === "other" && input.note.trim().length < 3) throw new DemoRuleError("Say what happened.");
  const quantity = dec(/^-?\d+(\.\d{1,2})?$/.test(input.quantity.trim()) ? input.quantity.trim() : "0");
  if (quantity.isZero()) throw new DemoRuleError("Enter how much changes, for example -3 or 12.");
  const product = ctx.db.get("products", input.productId);
  if (!product || !stockUnit(product)) throw new DemoRuleError("This product is not stocked.");
  const roll = input.rollId ? ctx.db.get("rolls", input.rollId) : undefined;
  if (input.rollId && !roll) throw new DemoRuleError("This roll no longer exists.");
  if (roll && quantity.lt(0) && quantity.abs().gt(rollAvailable(roll, ctx.db.list("reservations")))) {
    throw new DemoRuleError(
      `Only ${rollAvailable(roll, ctx.db.list("reservations")).toString()} ft of this roll is free.`,
    );
  }
  const pending = adjustmentNeedsApproval(quantity.toString(), ctx.db.settings.inventory.adjustmentApprovalQty);
  const adjustment: StockAdjustment = {
    id: ctx.newId("adj"),
    number: nextPaymentNumber(
      "ADJ-",
      ctx.db.list("stockAdjustments").map((a) => a.number),
    ),
    productId: product.id,
    rollId: roll?.id ?? null,
    locationId: roll?.locationId ?? input.locationId,
    quantity: quantity.toString(),
    reason: input.reason,
    note: input.note.trim(),
    status: pending ? "pending" : "approved",
    requestedById: ctx.actor.id,
    requestedBy: ctx.actor.name,
    requestedAt: ctx.now,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
  };
  ctx.db.put("stockAdjustments", adjustment);
  if (!pending) apply(ctx, adjustment);
  ctx.audit({
    category: "data",
    action: pending ? "Requested stock adjustment" : "Adjusted stock",
    target: `${adjustment.number} ${roll ? `roll ${roll.rollNumber}` : product.name}`,
    before: null,
    after: `${adjustment.quantity} (${adjustment.reason}${adjustment.note ? `: ${adjustment.note}` : ""})${pending ? ", waits for approval" : ""}`,
  });
  return adjustment;
}

/** An Owner or Manager approves or rejects an adjustment that waits (spec C1); not their own. */
export async function reviewAdjustment(ctx: ActionContext, adjustmentId: string, decision: AdjustmentDecision) {
  await ctx.assertCan(["inventory.stock.approve"]);
  const adjustment = ctx.db.get("stockAdjustments", adjustmentId);
  if (!adjustment || adjustment.status !== "pending") throw new DemoRuleError("This adjustment is not waiting.");
  if (adjustment.requestedById === ctx.actor.id) throw new DemoRuleError("Someone else must approve your adjustment.");
  const reason = decision.action === "reject" ? decision.reason.trim() : "";
  if (decision.action === "reject" && reason.length < 3) throw new DemoRuleError("Say why it is rejected.");
  const reviewed: StockAdjustment = {
    ...adjustment,
    status: decision.action === "approve" ? "approved" : "rejected",
    reviewedBy: ctx.actor.name,
    reviewedAt: ctx.now,
    rejectReason: reason || null,
  };
  ctx.db.put("stockAdjustments", reviewed);
  if (decision.action === "approve") apply(ctx, reviewed);
  ctx.audit({
    category: "data",
    action: decision.action === "approve" ? "Approved stock adjustment" : "Rejected stock adjustment",
    target: adjustment.number,
    before: `${adjustment.quantity}, waiting`,
    after: decision.action === "approve" ? "applied" : `rejected: ${reason}`,
  });
  return reviewed;
}

/**
 * A quick invoice for a length of one roll (spec C1: Cut roll → Create a new invoice): the roll's
 * product at its price, priced by the sq yd, with the roll reserved for it. The cut follows once
 * the deposit or payment is in.
 */
export async function createRollInvoice(ctx: ActionContext, input: RollInvoiceInput) {
  await ctx.assertCan(["sales.invoice.create"]);
  const roll = ctx.db.get("rolls", input.rollId);
  if (!roll) throw new DemoRuleError("This roll no longer exists.");
  const customer = ctx.db.get("customers", input.customerId);
  if (!customer) throw new DemoRuleError("Choose a customer.");
  const length = dec(/^\d+(\.\d{1,2})?$/.test(input.lengthFt.trim()) ? input.lengthFt.trim() : "0");
  if (length.lte(0)) throw new DemoRuleError("Enter the length to cut, in ft.");
  if (length.gt(rollAvailable(roll, ctx.db.list("reservations")))) {
    throw new DemoRuleError(
      `Only ${rollAvailable(roll, ctx.db.list("reservations")).toString()} ft of ${roll.rollNumber} is free.`,
    );
  }
  const product = ctx.db.get("products", roll.productId)!;
  const invoice = invoiceFromRoll(roll, product, customer, length.toString(), ctx.db.settings.localization, {
    id: ctx.newId("inv"),
    lineId: ctx.newId("ln"),
    number: nextNumber(
      ctx.db.settings.localization.documents.invoicePrefix,
      ctx.db.list("invoices").map((i) => i.number),
      1001,
    ),
    issuedAt: ctx.today,
    createdBy: ctx.actor.id,
    branchId: ctx.actor.branchId,
  });
  ctx.db.put("invoices", invoice);
  const held = reserveFor(ctx, invoice);
  ctx.audit({
    category: "data",
    action: "Created invoice for a roll cut",
    target: `${invoice.number} for roll ${roll.rollNumber}`,
    before: null,
    after: `${length.toString()} ft, total ${invoice.total}; ${reservationSummary(held)}`,
  });
  return invoice;
}

/** For the audit line: what a reservation plan held. */
export function reservationSummary(reservations: readonly Reservation[]): string {
  const short = reservations.filter(isShort).length;
  return `${reservations.length} reserved${short ? `, ${short} short` : ""}`;
}
