import { daysBetween } from "./dates";
import type { InvoiceLedger } from "./ledger";
import { dec, moneyString, roundMoney, sum, type Dec } from "./money";
import type { Invoice, Payment, Quote, Role, User } from "./types";
import type { CommissionRule } from "./types/settings";

/**
 * The commission rule for a person (spec E2): their own rule first, else their role's. People
 * without one earn no commission.
 */
export function ruleFor(user: User, roles: readonly Role[], rules: readonly CommissionRule[]): CommissionRule | null {
  const own = rules.find((r) => r.appliesTo.kind === "user" && r.appliesTo.userId === user.id);
  if (own) return own;
  const keys = roles.filter((r) => user.roleIds.includes(r.id)).map((r) => r.key);
  return rules.find((r) => r.appliesTo.kind === "role" && keys.includes(r.appliesTo.roleKey)) ?? null;
}

/** The rate a base earns: the highest tier it reaches, else the rule's base rate (spec E2 "optional tiers"). */
export function rateFor(rule: CommissionRule, base: Dec): string {
  const reached = [...rule.tiers]
    .sort((a, b) => dec(b.fromAmount).comparedTo(a.fromAmount))
    .find((t) => base.gte(t.fromAmount));
  return reached?.ratePct ?? rule.ratePct;
}

/** One salesperson's figures for a period (spec E2 Sales → Team). */
export interface TeamRow {
  userId: string;
  name: string;
  sales: string;
  paidRevenue: string;
  margin: string;
  quotesSent: number;
  conversionPct: string;
  averageDeal: string;
  earned: string;
  paid: string;
  pending: string;
}

/** The records team figures read. */
export interface TeamInputs {
  users: readonly User[];
  roles: readonly Role[];
  rules: readonly CommissionRule[];
  invoices: readonly Invoice[];
  ledgers: ReadonlyMap<string, InvoiceLedger>;
  payments: readonly Payment[];
  quotes: readonly Quote[];
}

/** Revenue before tax in a confirmed payment: the payment's share of the invoice subtotal. */
function paidShare(payment: Payment, invoice: Invoice): Dec {
  if (dec(invoice.total).isZero()) return dec(0);
  return roundMoney(dec(payment.amount).times(invoice.subtotal).div(invoice.total));
}

/**
 * Team figures for a period (spec E2): invoiced sales and margin by issue date; paid revenue from
 * payments confirmed in the period (the revenue part, tax left out); quotes sent and how many
 * converted; commission earned when payments are confirmed, on paid revenue or on the margin of
 * what was paid, at the rule's tier. Commission is paid with payroll at month end, so what was
 * earned before this month counts as paid and this month's is pending.
 */
export function teamStats(
  inputs: TeamInputs,
  range: { from: string; to: string; today: string; locationId?: string | null },
): TeamRow[] {
  const inRange = (iso: string) => iso >= range.from && iso <= range.to;
  const atWarehouse = (i: Invoice) => !range.locationId || i.locationId === range.locationId;
  const thisMonth = range.today.slice(0, 7);
  const reps = inputs.users.filter(
    (u) => inputs.invoices.some((i) => i.salesRepId === u.id) || ruleFor(u, inputs.roles, inputs.rules),
  );
  return reps
    .map((user): TeamRow => {
      const own = inputs.invoices.filter((i) => i.salesRepId === user.id && !i.voidedAt && atWarehouse(i));
      const issued = own.filter((i) => inRange(i.issuedAt));
      const sign = (i: Invoice) => (i.isReturn ? -1 : 1);
      const sales = sum(issued.map((i) => dec(i.subtotal).times(sign(i))));
      const cost = sum(issued.map((i) => dec(i.cost).times(sign(i))));
      const byId = new Map(own.map((i) => [i.id, i]));
      const paidIn = inputs.payments.filter(
        (p) => p.status === "confirmed" && byId.has(p.invoiceId) && inRange(p.date),
      );
      const rule = ruleFor(user, inputs.roles, inputs.rules);
      const base = (p: Payment) => {
        const invoice = byId.get(p.invoiceId)!;
        const revenue = paidShare(p, invoice);
        if (rule?.basis !== "gross_margin" || dec(invoice.subtotal).isZero()) return revenue;
        return roundMoney(revenue.times(dec(invoice.subtotal).minus(invoice.cost)).div(invoice.subtotal));
      };
      const paidRevenue = sum(paidIn.map((p) => paidShare(p, byId.get(p.invoiceId)!)));
      const earnedOn = (list: readonly Payment[]) => {
        if (!rule) return dec(0);
        const b = sum(list.map(base));
        return roundMoney(b.times(rateFor(rule, b)).div(100));
      };
      const earned = earnedOn(paidIn);
      const pending = earnedOn(paidIn.filter((p) => p.date.startsWith(thisMonth)));
      const sent = inputs.quotes.filter((q) => q.salesRepId === user.id && q.sentAt && inRange(q.sentAt));
      const converted = sent.filter((q) => q.status === "converted").length;
      const deals = issued.filter((i) => !i.isReturn);
      return {
        userId: user.id,
        name: user.name,
        sales: moneyString(sales),
        paidRevenue: moneyString(paidRevenue),
        margin: moneyString(sales.minus(cost)),
        quotesSent: sent.length,
        conversionPct: sent.length ? dec(converted).div(sent.length).times(100).toDecimalPlaces(1).toString() : "0",
        averageDeal: deals.length ? moneyString(sum(deals.map((i) => i.subtotal)).div(deals.length)) : "0.00",
        earned: moneyString(earned),
        paid: moneyString(earned.minus(pending)),
        pending: moneyString(pending),
      };
    })
    .sort((a, b) => dec(b.paidRevenue).comparedTo(a.paidRevenue));
}

/** Whether a range is a whole year or most of one, so the top performer reads Employee of the year. */
export function isYear(range: { from: string; to: string }): boolean {
  return daysBetween(range.from, range.to) >= 300;
}
