import type { TeamCommission } from "../commissions";
import { addDays } from "../dates";
import { dec, maxDec, minDec, moneyString, pctOf, roundMoney, sum, type Dec } from "../money";
import type { WeekAllocation } from "./pay";
import { workweekStartOf } from "./timesheets";
import type {
  CommissionAdjustment,
  CommissionAssignment,
  CommissionPlan,
  Invoice,
  InvoiceAdjustment,
  Payment,
} from "../types";

/** One line of a commission statement (ADR 0025). */
export interface CommissionLine {
  id: string;
  userId: string;
  month: string;
  kind: "earned" | "override" | "reversal";
  invoiceId: string;
  /** The payment, or the credit application, that produced it. */
  sourceId: string;
  subjectUserId: string | null;
  planId: string;
  /**
   * The basis of the plan that worked out `base`: on a split sale the first member's plan sets the
   * invoice's base for everyone in the split, and override and reversal lines keep it, so whether
   * `base` is margin dollars (CLAUDE.md rule 5; `hideMarginBase`) follows this, not `planId`.
   */
  basis: CommissionPlan["basis"];
  collected: string;
  base: string;
  commission: string;
  confirmedOn: string;
  windowEndsOn: string;
  reversalState: "applied" | "needs_review" | "waived" | null;
}

/** The commission on an amount under a plan's monthly curve; no rounding inside (ADR 0025). */
export function commissionCurve(plan: CommissionPlan, target: Dec, amount: Dec): Dec {
  const bands = [...plan.tiers]
    .map((t) => ({ from: pctOf(target, t.fromPctOfTarget), rate: t.ratePct }))
    .sort((a, b) => a.from.comparedTo(b.from));
  if (plan.tierMode === "retroactive") {
    const reached = bands.filter((b) => amount.gte(b.from)).at(-1);
    return pctOf(amount, reached?.rate ?? plan.baseRatePct);
  }
  let total = pctOf(minDec(amount, bands[0]?.from ?? amount), plan.baseRatePct);
  bands.forEach((band, i) => {
    const top = bands[i + 1]?.from ?? amount;
    const inside = maxDec(minDec(amount, top).minus(band.from), 0);
    total = total.plus(pctOf(inside, band.rate));
  });
  return total;
}

/** Everything the engine reads. */
export interface CommissionInputs {
  plans: readonly CommissionPlan[];
  assignments: readonly CommissionAssignment[];
  invoices: readonly Invoice[];
  payments: readonly Payment[];
  adjustments: readonly InvoiceAdjustment[];
  /**
   * A person's manager user id on a day, for overrides: the override on a line goes to the manager
   * on the line's confirmed day, not today's (owner decision 2026-11-15; ADR 0048; `managerOn` reads
   * the dated history). Null means no override.
   */
  managerOf: (userId: string, date: string) => string | null;
  /** Months whose statements are approved: a void there reverses instead of disappearing. */
  frozen: ReadonlySet<string>;
  /** HR's decisions on reversals that arrived outside their window, by reversal line id. */
  decisions?: ReadonlyMap<string, "applied" | "waived">;
  today: string;
}

/** `user|month`, the key of a frozen statement. */
export const statementKey = (userId: string, month: string) => `${userId}|${month}`;

/** The plan a person is on for a date, or null. */
export function planOn(inputs: Pick<CommissionInputs, "plans" | "assignments">, userId: string, date: string) {
  const assignment = inputs.assignments.find(
    (a) => a.userId === userId && a.effectiveFrom <= date && (!a.effectiveTo || a.effectiveTo >= date),
  );
  if (!assignment) return null;
  const plan = inputs.plans.find((p) => p.id === assignment.planId);
  return plan ? { plan, assignment } : null;
}

interface CollectEvent {
  invoice: Invoice;
  sourceId: string;
  amount: string;
  confirmedOn: string;
  order: string;
  /** A void taking back a payment that already earned: lowers what counts as collected. */
  isVoid?: boolean;
}

function confirmedDate(p: Payment): string {
  return (p.reviewedAt ?? p.recordedAt).slice(0, 10);
}

/** An invoice's subtotal, cost and total net of its credit notes (ADR 0025, step 2). */
function netInvoice(invoice: Invoice, invoices: readonly Invoice[], before: string) {
  const credits = invoices.filter((c) => c.creditForInvoiceId === invoice.id && !c.voidedAt && c.issuedAt <= before);
  const minus = (field: "subtotal" | "cost" | "total") => dec(invoice[field]).minus(sum(credits.map((c) => c[field])));
  return { S: minus("subtotal"), C: minus("cost"), G: minus("total") };
}

/** The commission base of what has been collected on an invoice (ADR 0025, steps 3 and 4). */
function baseOf(basis: CommissionPlan["basis"], collected: Dec, net: ReturnType<typeof netInvoice>): Dec {
  if (net.G.lte(0) || net.S.lte(0)) return dec(0);
  const K = minDec(collected, net.G);
  const revenue = roundMoney(K.times(net.S).dividedBy(net.G));
  if (basis === "paid_revenue") return revenue;
  return maxDec(roundMoney(revenue.times(net.S.minus(net.C)).dividedBy(net.S)), 0);
}

/**
 * Every commission line up to today (ADR 0025 order of operations, plan N-4). A confirmed payment
 * advances commission: base from what has been collected, split between the reps, the monthly
 * tier, then the manager's flat override, rounded on running totals so a month adds up however
 * the payments arrive. A void in an approved month reverses; a credit note reverses newest lines
 * first, only inside each line's window. Reversals never change a tier.
 */
export function commissionLines(inputs: CommissionInputs): CommissionLine[] {
  const { invoices, payments, adjustments, today } = inputs;
  const events: CollectEvent[] = [];
  for (const invoice of invoices) {
    if (invoice.voidedAt || invoice.isReturn) continue;
    for (const p of payments) {
      if (p.invoiceId !== invoice.id) continue;
      const date = confirmedDate(p);
      const voidedAfterApproval = p.status === "voided" && p.voidedAt !== null && inputsFrozen(inputs, invoice, date);
      if (p.status !== "confirmed" && !voidedAfterApproval) continue;
      events.push({ invoice, sourceId: p.id, amount: p.amount, confirmedOn: date, order: `${date}|${p.id}` });
      if (voidedAfterApproval) {
        const voidedOn = p.voidedAt!.slice(0, 10);
        events.push({
          invoice,
          sourceId: p.id,
          amount: p.amount,
          confirmedOn: voidedOn,
          order: `${voidedOn}|${p.id}|void`,
          isVoid: true,
        });
      }
    }
    for (const a of adjustments) {
      if (a.invoiceId === invoice.id && a.kind === "credit_applied") {
        const date = a.at.slice(0, 10);
        events.push({ invoice, sourceId: a.id, amount: a.amount, confirmedOn: date, order: `${date}|${a.id}` });
      }
    }
  }
  events.sort((a, b) => a.order.localeCompare(b.order));

  const lines: CommissionLine[] = [];
  const collectedByInvoice = new Map<string, Dec>();
  const liveByInvoice = new Map<string, Dec>();
  const creditedThisMonth = new Map<string, Dec>();
  for (const event of events) {
    if (event.confirmedOn > today) continue;
    const { invoice } = event;
    const collected = (collectedByInvoice.get(invoice.id) ?? dec(0)).plus(
      event.isVoid ? dec(event.amount).negated() : event.amount,
    );
    collectedByInvoice.set(invoice.id, collected);
    const split = splitOf(invoice);
    const first = planOn(inputs, split[0]!.userId, event.confirmedOn);
    if (!first) continue;
    const net = netInvoice(invoice, invoices, event.confirmedOn);
    const base = baseOf(first.plan.basis, collected, net);
    if (event.isVoid) {
      liveByInvoice.set(invoice.id, base);
      continue;
    }
    const delta = base.minus(liveByInvoice.get(invoice.id) ?? 0);
    if (delta.lte(0)) continue;
    liveByInvoice.set(invoice.id, base);
    let allocated = dec(0);
    split.forEach((s, i) => {
      const onPlan = planOn(inputs, s.userId, event.confirmedOn);
      if (!onPlan) return;
      const share = i === split.length - 1 ? delta.minus(allocated) : roundMoney(pctOf(delta, s.pct));
      allocated = allocated.plus(share);
      const month = event.confirmedOn.slice(0, 7);
      const key = `${s.userId}|${month}`;
      const before = creditedThisMonth.get(key) ?? dec(0);
      const after = before.plus(share);
      creditedThisMonth.set(key, after);
      const target = dec(onPlan.assignment.monthlyTargetOverride ?? onPlan.plan.monthlyTarget);
      const commission = roundMoney(commissionCurve(onPlan.plan, target, after)).minus(
        roundMoney(commissionCurve(onPlan.plan, target, before)),
      );
      const windowEndsOn = addDays(event.confirmedOn, onPlan.plan.clawbackDays);
      const line = {
        userId: s.userId,
        month,
        invoiceId: invoice.id,
        sourceId: event.sourceId,
        planId: onPlan.plan.id,
        basis: first.plan.basis,
        collected: moneyString(event.amount),
        confirmedOn: event.confirmedOn,
        windowEndsOn,
        reversalState: null,
      };
      lines.push({
        ...line,
        id: `cl-${event.sourceId}-${s.userId}`,
        kind: "earned",
        subjectUserId: null,
        base: moneyString(share),
        commission: moneyString(commission),
      });
      // The manager on the confirmed day earns the override (ADR 0048); reversal lines copy this
      // line's userId, so a later reorg never moves a reversal to the new manager.
      const manager = dec(onPlan.plan.overridePct).gt(0) ? inputs.managerOf(s.userId, event.confirmedOn) : null;
      if (manager) {
        const override = roundMoney(pctOf(after, onPlan.plan.overridePct)).minus(
          roundMoney(pctOf(before, onPlan.plan.overridePct)),
        );
        lines.push({
          ...line,
          id: `co-${event.sourceId}-${s.userId}`,
          userId: manager,
          kind: "override",
          subjectUserId: s.userId,
          base: moneyString(share),
          commission: moneyString(override),
        });
      }
    });
  }
  return [...lines, ...voidReversals(inputs, lines), ...creditNoteReversals(inputs, lines)].sort((a, b) =>
    a.confirmedOn.localeCompare(b.confirmedOn),
  );
}

function splitOf(invoice: Invoice): { userId: string; pct: string }[] {
  return invoice.commissionSplit?.length ? invoice.commissionSplit : [{ userId: invoice.salesRepId, pct: "100" }];
}

function inputsFrozen(inputs: CommissionInputs, invoice: Invoice, date: string): boolean {
  return splitOf(invoice).some((s) => inputs.frozen.has(statementKey(s.userId, date.slice(0, 7))));
}

/** A payment voided after its month was approved reverses in the month of the void (ADR 0025). */
function voidReversals(inputs: CommissionInputs, lines: readonly CommissionLine[]): CommissionLine[] {
  return inputs.payments
    .filter((p) => p.status === "voided" && p.voidedAt)
    .flatMap((p) => {
      const voidedOn = p.voidedAt!.slice(0, 10);
      return lines
        .filter((l) => l.sourceId === p.id)
        .map((l) => ({
          ...l,
          id: `rv-${l.id}`,
          reversalState: (voidedOn <= l.windowEndsOn
            ? "applied"
            : (inputs.decisions?.get(`rv-${l.id}`) ?? "needs_review")) as CommissionLine["reversalState"],
          month: voidedOn.slice(0, 7),
          kind: "reversal" as const,
          confirmedOn: voidedOn,
          commission: moneyString(dec(l.commission).negated()),
        }));
    });
}

/**
 * A credit note reverses commission inside each line's window (ADR 0025): the fall in the base is
 * split like the sale, then each rep's newest lines go first. Credits run in date order and each
 * takes only what earlier ones left, so a second credit note never reverses the first one's amount.
 */
function creditNoteReversals(inputs: CommissionInputs, lines: readonly CommissionLine[]): CommissionLine[] {
  const out: CommissionLine[] = [];
  const taken = new Map<string, Dec>();
  const leftOn = (line: CommissionLine) => dec(line.base).minus(taken.get(line.id) ?? 0);
  const credits = inputs.invoices
    .filter((c) => c.creditForInvoiceId && !c.voidedAt)
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
  for (const credit of credits) {
    const invoice = inputs.invoices.find((i) => i.id === credit.creditForInvoiceId);
    if (!invoice || credit.issuedAt > inputs.today) continue;
    const owned = lines.filter((l) => l.invoiceId === invoice.id && l.kind === "earned");
    if (owned.length === 0) continue;
    const net = netInvoice(invoice, inputs.invoices, credit.issuedAt);
    const collected = sum(
      inputs.payments.filter((p) => p.invoiceId === invoice.id && p.status === "confirmed").map((p) => p.amount),
    );
    const fall = owned
      .reduce((total, l) => total.plus(leftOn(l)), dec(0))
      .minus(baseOf(owned[0]!.basis, collected, net));
    if (fall.lte(0)) continue;
    const split = splitOf(invoice);
    let allocated = dec(0);
    split.forEach((s, i) => {
      let remaining = i === split.length - 1 ? fall.minus(allocated) : roundMoney(pctOf(fall, s.pct));
      allocated = allocated.plus(remaining);
      const newestFirst = owned
        .filter((l) => l.userId === s.userId)
        .sort((a, b) => b.confirmedOn.localeCompare(a.confirmedOn));
      for (const line of newestFirst) {
        if (line.windowEndsOn < credit.issuedAt || remaining.lte(0)) break;
        const left = leftOn(line);
        if (left.lte(0)) continue;
        const chunk = minDec(remaining, left);
        const reversed = chunk.gte(line.base)
          ? dec(line.commission)
          : roundMoney(dec(line.commission).times(chunk).dividedBy(line.base));
        remaining = remaining.minus(chunk);
        taken.set(line.id, dec(line.base).minus(left).plus(chunk));
        out.push({
          ...line,
          id: `rc-${credit.id}-${line.id}`,
          month: credit.issuedAt.slice(0, 7),
          kind: "reversal",
          confirmedOn: credit.issuedAt,
          base: moneyString(chunk.negated()),
          commission: moneyString(reversed.negated()),
          reversalState: "applied",
        });
      }
    });
  }
  return out;
}

/** A statement's figures for one person and month, with the draw (ADR 0025). */
export interface StatementFigures {
  userId: string;
  month: string;
  earned: string;
  override: string;
  reversal: string;
  adjustment: string;
  net: string;
  carryIn: string;
  draw: string;
  /** What the pay period reads; never negative, so a bad month cannot touch base pay. */
  payable: string;
  carryOut: string;
  lines: CommissionLine[];
  needsReview: boolean;
}

/**
 * Every month's statement for one person, oldest first, so each carry feeds the next. `carryIn` is
 * what the month before the first one carried out; `commissionStatementRows` works it out from the
 * person's whole history, so the carry never restarts at 0 as the twelve-month window slides (ADR 0048).
 */
export function statementChain(
  userId: string,
  months: readonly string[],
  lines: readonly CommissionLine[],
  adjustments: readonly CommissionAdjustment[],
  planFor: (month: string) => CommissionPlan | null,
  carryIn = "0.00",
): StatementFigures[] {
  let carry = dec(carryIn);
  return [...months].sort().map((month) => {
    const own = lines.filter((l) => l.userId === userId && l.month === month);
    const earned = sum(own.filter((l) => l.kind === "earned").map((l) => l.commission));
    const override = sum(own.filter((l) => l.kind === "override").map((l) => l.commission));
    const reversal = sum(
      own.filter((l) => l.kind === "reversal" && l.reversalState === "applied").map((l) => l.commission),
    );
    const adjustment = sum(adjustments.filter((a) => a.userId === userId && a.month === month).map((a) => a.amount));
    const net = earned.plus(override).plus(reversal).plus(adjustment);
    const A = net.minus(carry);
    const plan = planFor(month);
    const D = dec(plan?.draw.kind && plan.draw.kind !== "none" ? plan.draw.monthlyAmount : 0);
    const payable = maxDec(D, A);
    const recoverable = plan?.draw.kind === "recoverable";
    const carryOut = recoverable ? maxDec(payable.minus(A), 0) : maxDec(A.negated(), 0);
    const result: StatementFigures = {
      userId,
      month,
      earned: moneyString(earned),
      override: moneyString(override),
      reversal: moneyString(reversal),
      adjustment: moneyString(adjustment),
      net: moneyString(net),
      carryIn: moneyString(carry),
      draw: moneyString(D),
      payable: moneyString(payable),
      carryOut: moneyString(carryOut),
      lines: own,
      needsReview: own.some((l) => l.reversalState === "needs_review"),
    };
    carry = carryOut;
    return result;
  });
}

/** Commission per person for a range (Sales → Team, ADR 0025): paid means its month's statement is paid. */
export function commissionTotals(
  lines: readonly CommissionLine[],
  paidMonths: ReadonlySet<string>,
  range: { from: string; to: string },
): Map<string, TeamCommission> {
  const out = new Map<string, TeamCommission>();
  for (const line of lines) {
    if (line.confirmedOn < range.from || line.confirmedOn > range.to) continue;
    const seen = out.get(line.userId) ?? { earned: "0.00", paid: "0.00", pending: "0.00" };
    const isPaid = paidMonths.has(statementKey(line.userId, line.month));
    out.set(line.userId, {
      earned: moneyString(dec(seen.earned).plus(line.commission)),
      paid: isPaid ? moneyString(dec(seen.paid).plus(line.commission)) : seen.paid,
      pending: isPaid ? seen.pending : moneyString(dec(seen.pending).plus(line.commission)),
    });
  }
  return out;
}

/** Each line's commission against the workweek its payment was confirmed, for the overtime true-up (ADR 0024). */
export function commissionAllocations(
  lines: readonly Pick<CommissionLine, "confirmedOn" | "commission">[],
  weekStartDay: number,
): WeekAllocation[] {
  const totals = new Map<string, Dec>();
  for (const line of lines) {
    const week = workweekStartOf(line.confirmedOn, weekStartDay);
    totals.set(week, (totals.get(week) ?? dec(0)).plus(line.commission));
  }
  return [...totals.entries()].map(([weekStart, amount]) => ({ weekStart, amount: moneyString(amount) }));
}

/** The largest statement adjustment either way, in dollars (ADR 0048): a typo can't post millions. */
export const MAX_ADJUSTMENT = "1000000.00";

/** A statement adjustment as typed: dollars and cents, up to twelve digits, optionally negative. */
export const ADJUSTMENT_AMOUNT = /^-?\d{1,12}(\.\d{1,2})?$/;

/** Why a statement adjustment cannot be saved (spec C1, ADR 0025; bounded by ADR 0048). */
export function adjustmentProblem(amount: string, reason: string, invoiceId: string | null): string | null {
  if (!ADJUSTMENT_AMOUNT.test(amount.trim()) || dec(amount).isZero()) return "Enter an amount, for example 150 or -75.";
  if (dec(amount).abs().gt(MAX_ADJUSTMENT)) return "An adjustment can be at most 1,000,000.00 either way.";
  if (reason.trim().length < 3) return "Give a reason; it stays on the statement.";
  if (dec(amount).lt(0) && !invoiceId) return "A deduction must name the invoice it relates to.";
  return null;
}
