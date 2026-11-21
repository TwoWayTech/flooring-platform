import { signedCost, signedSubtotal } from "./analytics";
import { daysBetween } from "./dates";
import { dec, moneyString, roundMoney, sum, sumKnown, type Dec } from "./money";
import type { Payment, Quote, User, ViewedInvoice } from "./types";

/** One salesperson's figures for a period (spec E2 Sales → Team). */
export interface TeamRow {
  userId: string;
  name: string;
  sales: string;
  paidRevenue: string;
  /**
   * null when one of the person's invoices arrived without its cost: never zero or a partial sum
   * (CLAUDE.md rule 5; ADR 0037, 2026-11-17).
   */
  margin: string | null;
  quotesSent: number;
  conversionPct: string;
  /** `sales` (credit notes taken off) over the period's invoices that are not credit notes. */
  averageDeal: string;
  /** Every commission line in the range: the person's own, their manager overrides and reversals. */
  earned: string;
  paid: string;
  pending: string;
}

/** A person's commission for a period, from their commission lines. */
export interface TeamCommission {
  earned: string;
  paid: string;
  pending: string;
}

/** The records team figures read. */
export interface TeamInputs {
  users: readonly User[];
  /** Invoices as received: a viewer without product cost gets them without `cost` (rule 5). */
  invoices: readonly ViewedInvoice[];
  /** Commission per person for the period, from the HR statements (ADR 0025): one calculation. */
  commission: ReadonlyMap<string, TeamCommission>;
  payments: readonly Payment[];
  quotes: readonly Quote[];
}

/** Revenue before tax in a confirmed payment: the payment's share of the invoice subtotal. */
function paidShare(payment: Payment, invoice: Pick<ViewedInvoice, "subtotal" | "total">): Dec {
  if (dec(invoice.total).isZero()) return dec(0);
  return roundMoney(dec(payment.amount).times(invoice.subtotal).div(invoice.total));
}

/**
 * Team figures for a period (spec E2): invoiced sales and margin by issue date, margin unknown when
 * an invoice arrived without its cost (rule 5; ADR 0037, 2026-11-17); paid revenue from payments
 * confirmed in the period (the revenue part, tax left out); quotes sent and how many converted.
 * Commission comes from the HR commission lines (ADR 0025), so there is one calculation.
 */
export function teamStats(
  inputs: TeamInputs,
  range: { from: string; to: string; today: string; locationId?: string | null },
): TeamRow[] {
  const inRange = (iso: string) => iso >= range.from && iso <= range.to;
  const atWarehouse = (i: ViewedInvoice) => !range.locationId || i.locationId === range.locationId;
  const reps = inputs.users.filter(
    (u) => inputs.invoices.some((i) => i.salesRepId === u.id) || inputs.commission.has(u.id),
  );
  return reps
    .map((user): TeamRow => {
      const own = inputs.invoices.filter((i) => i.salesRepId === user.id && !i.voidedAt && atWarehouse(i));
      const issued = own.filter((i) => inRange(i.issuedAt));
      const sales = sum(issued.map(signedSubtotal));
      const cost = sumKnown(issued.map(signedCost));
      const byId = new Map(own.map((i) => [i.id, i]));
      const paidIn = inputs.payments.filter(
        (p) => p.status === "confirmed" && byId.has(p.invoiceId) && inRange(p.date),
      );
      const paidRevenue = sum(paidIn.map((p) => paidShare(p, byId.get(p.invoiceId)!)));
      const commission = inputs.commission.get(user.id);
      const sent = inputs.quotes.filter((q) => q.salesRepId === user.id && q.sentAt && inRange(q.sentAt));
      const converted = sent.filter((q) => q.status === "converted").length;
      // Average deal is the Sales figure (credit notes taken off) over the deals, so the two agree
      // (click-through #50); credit notes are not deals of their own.
      const deals = issued.filter((i) => !i.isReturn);
      return {
        userId: user.id,
        name: user.name,
        sales: moneyString(sales),
        paidRevenue: moneyString(paidRevenue),
        margin: cost === null ? null : moneyString(sales.minus(cost)),
        quotesSent: sent.length,
        conversionPct: sent.length ? dec(converted).div(sent.length).times(100).toDecimalPlaces(1).toString() : "0",
        averageDeal: deals.length ? moneyString(sales.div(deals.length)) : "0.00",
        earned: commission?.earned ?? "0.00",
        paid: commission?.paid ?? "0.00",
        pending: commission?.pending ?? "0.00",
      };
    })
    .sort((a, b) => dec(b.paidRevenue).comparedTo(a.paidRevenue));
}

/** Whether a range is a whole year or most of one, so the top performer reads Employee of the year. */
export function isYear(range: { from: string; to: string }): boolean {
  return daysBetween(range.from, range.to) >= 300;
}
