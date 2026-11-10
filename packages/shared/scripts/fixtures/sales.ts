import { addDays, daysBetween, last12Months } from "../../src/dates";
import { computeTotals, depositAmount, type DocLine, type DocumentTotals } from "../../src/documents";
import { dec, moneyString } from "../../src/money";
import type {
  Address,
  CompanySettings,
  Customer,
  Invoice,
  InvoiceAdjustment,
  Payment,
  Product,
  Quote,
  QuoteStatus,
  Refund,
  User,
} from "../../src/types";
import { dueDate, taxContextFor } from "../../src/operations/quotes";
import { defaultAddress, plainAddress } from "../../src/customers";
import type { GenContext } from "./context";
import { branchWarehouse } from "./locations";
import { finishPayments, type DrawnPayment } from "./payments";
import { buildRooms, roomLines, tradeLines } from "./sales-lines";

/** Relative sales volume by calendar month: spring and fall peaks (spec section 4). */
const MONTH_WEIGHTS = [0.6, 0.65, 1.1, 1.35, 1.3, 0.95, 0.85, 0.9, 1.25, 1.35, 1.0, 0.7];
/**
 * Chance a past-due invoice is still unpaid, by days past due. Recent ones are often still
 * open and old ones rarely, so aging looks real: about 12 % of invoices overdue by count, but
 * most of the open balance current and very little over 90 days (spec section 4, B5).
 */
const UNPAID_CHANCE_BY_AGE: readonly [maxDaysPastDue: number, chance: number][] = [
  [30, 0.75],
  [60, 0.4],
  [90, 0.15],
  [Infinity, 0.02],
];
/** A homeowner job is installed about two weeks after the invoice; the balance is due then (spec B6). */
const INSTALL_LEAD_DAYS = 14;
/** Share of invoices later partly returned (spec section 4). */
const RETURN_SHARE = 0.03;

/** Generated sales documents for one company. */
export interface SalesFixtures {
  quotes: Quote[];
  invoices: Invoice[];
  payments: Payment[];
  invoiceAdjustments: InvoiceAdjustment[];
  refunds: Refund[];
}

interface SalesInputs {
  products: readonly Product[];
  customers: readonly Customer[];
  users: readonly User[];
  settings: CompanySettings;
}

/** Totals with the job-site rule, when the company collects tax in that state. */
function totalsFor(
  inputs: SalesInputs,
  lines: DocLine[],
  site: Address,
  customer: Customer,
  on: string,
  lumpSum: boolean,
) {
  const ctx = taxContextFor(inputs.settings.localization, site, customer, on, lumpSum);
  return { rule: ctx.rule, exempt: ctx.exempt, source: ctx.source, totals: computeTotals(lines, ctx) };
}

/**
 * A date in the trailing 12 months, weighted by season and never after the anchor. The anchor's
 * own month is weighted by the share of it that has passed, so it reads as month to date.
 */
function seasonalDate(ctx: GenContext): string {
  const months = last12Months(ctx.anchor);
  const anchorDay = Number(ctx.anchor.slice(8, 10));
  const weights = months.map((m, i) => {
    const seasonal = MONTH_WEIGHTS[Number(m.slice(5)) - 1]!;
    return i === months.length - 1 ? (seasonal * anchorDay) / 30 : seasonal;
  });
  const index = ctx.rng.weightedIndex(weights);
  const lastDay = index === months.length - 1 ? anchorDay : 28;
  return `${months[index]}-${String(ctx.rng.int(1, lastDay)).padStart(2, "0")}`;
}

function pickCustomer(ctx: GenContext, customers: readonly Customer[]): Customer {
  if (!ctx.company.modules.includes("retail")) return ctx.rng.pick(customers);
  const type = ctx.rng.pick([
    "homeowner",
    "homeowner",
    "homeowner",
    "homeowner",
    "homeowner",
    "homeowner",
    "homeowner",
    "contractor",
    "contractor",
    "dealer",
  ]);
  return ctx.rng.pick(customers.filter((c) => c.type === type));
}

function buildQuote(ctx: GenContext, inputs: SalesInputs, createdAt: string): Quote {
  const customer = pickCustomer(ctx, inputs.customers);
  const rep = inputs.users.find((u) => u.id === customer.salesRepId)!;
  const measured = ctx.company.modules.includes("retail") && customer.type !== "dealer";
  const rooms = measured ? buildRooms(ctx) : [];
  const lines = measured ? roomLines(ctx, inputs.products, rooms) : tradeLines(ctx, inputs.products);
  const jobSite =
    customer.type === "contractor" && measured ? ctx.address() : plainAddress(defaultAddress(customer, "job_site"));
  const lumpSum = ctx.rng.chance(0.05);
  const { totals } = totalsFor(inputs, lines, jobSite, customer, createdAt, lumpSum);
  return {
    id: ctx.id("quo"),
    number: "",
    customerId: customer.id,
    salesRepId: rep.id,
    branchId: rep.branchId,
    status: "draft",
    createdAt,
    sentAt: null,
    expiresAt: null,
    locationId: branchWarehouse(ctx.company.id, rep.branchId),
    jobSite,
    rooms,
    lines,
    depositPct: customer.type === "homeowner" ? inputs.settings.localization.documents.defaultDepositPct : "0",
    lumpSum,
    taxOverride: null,
    invoiceId: null,
    total: totals.total,
    notes: ctx.rng.chance(0.2)
      ? ctx.rng.pick(["Customer prefers a morning start.", "Pets in the home.", "Match existing trim."])
      : "",
  };
}

/**
 * Status of a quote that was not invoiced (spec B1): recent quotes are drafts, pending or accepted;
 * old ones mostly declined, the rest still pending and so expired.
 */
function openQuoteStatus(ctx: GenContext, createdAt: string): QuoteStatus {
  const age = daysBetween(createdAt, ctx.anchor);
  if (age <= 14) return ctx.rng.pick(["draft", "pending", "pending", "accepted"]);
  return ctx.rng.chance(0.7) ? "declined" : "pending";
}

/** A quote that left draft was sent the day it was made and is valid for the company's expiry days. */
function markSent(quote: Quote, expiryDays: number) {
  if (quote.status === "draft") return;
  quote.sentAt = quote.createdAt;
  quote.expiresAt = addDays(quote.createdAt, expiryDays);
}

function buildInvoice(ctx: GenContext, inputs: SalesInputs, quote: Quote): Invoice {
  const customer = inputs.customers.find((c) => c.id === quote.customerId)!;
  const issuedAt = [addDays(quote.createdAt, ctx.rng.int(1, 10)), ctx.anchor].sort()[0]!;
  const { rule, exempt, source, totals } = totalsFor(
    inputs,
    quote.lines,
    quote.jobSite,
    customer,
    issuedAt,
    quote.lumpSum,
  );
  return {
    id: ctx.id("inv"),
    number: "",
    quoteId: quote.id,
    customerId: customer.id,
    salesRepId: quote.salesRepId,
    branchId: quote.branchId,
    locationId: quote.locationId,
    issuedAt,
    // With a deposit, the rest is due once the job is installed (spec B6); jobs not yet done hold it.
    dueAt: dueDate(
      dec(quote.depositPct).gt(0) && ctx.company.modules.includes("installation")
        ? addDays(issuedAt, INSTALL_LEAD_DAYS)
        : issuedAt,
      customer.terms,
    ),
    createdBy: quote.salesRepId,
    // Seeded invoices went to the customer the day they were made.
    sentAt: issuedAt,
    sentBy: quote.salesRepId,
    voidedAt: null,
    voidReason: null,
    depositPct: quote.depositPct,
    isReturn: false,
    creditForInvoiceId: null,
    refundedAt: null,
    jobSite: quote.jobSite,
    lines: quote.lines,
    taxRule: rule
      ? { state: rule.state, jurisdiction: rule.jurisdiction, ratePct: rule.ratePct, version: rule.version }
      : null,
    taxSource: source,
    taxOverride: null,
    taxExempt: exempt,
    ...documentAmounts(totals),
  };
}

function documentAmounts(totals: DocumentTotals) {
  return { subtotal: totals.subtotal, tax: totals.tax, total: totals.total, cost: totals.cost };
}

/**
 * How much of an invoice gets paid: everything, a deposit or part, most of it (a late payer with a
 * small remainder), or nothing yet.
 */
type Settlement = "paid" | "partial" | "mostly" | "unpaid";
/** The share a late payer has paid when a small remainder is left (spec B5: little old debt). */
const MOSTLY_PAID = "0.9";

function settlementFor(ctx: GenContext, invoice: Invoice): Settlement {
  const daysPastDue = daysBetween(invoice.dueAt!, ctx.anchor);
  if (daysPastDue <= 0) return ctx.rng.pick(["unpaid", "partial", "unpaid", "paid"]);
  const [, chance] = UNPAID_CHANCE_BY_AGE.find(([max]) => daysPastDue <= max)!;
  // A late payer has usually paid most of it, so little of the open balance is overdue (spec B5).
  return ctx.rng.chance(chance) ? ctx.rng.pick<Settlement>(["mostly", "mostly"]) : "paid";
}

/**
 * Payments for an invoice. A homeowner deposit is paid at issue; the balance follows before the
 * anchor date. Payments never exceed the invoice total (spec section 4 reconciliation).
 */
function paymentsFor(ctx: GenContext, invoice: Invoice, quote: Quote, settlement: Settlement): DrawnPayment[] {
  if (settlement === "unpaid") return [];
  const total = dec(invoice.total);
  const hasDeposit = dec(quote.depositPct).gt(0);
  const first = hasDeposit ? depositAmount(invoice.total, quote.depositPct) : moneyString(total.times("0.4"));
  const fullPayment = hasDeposit ? [first, moneyString(total.minus(first))] : [invoice.total];
  const amounts =
    settlement === "partial"
      ? [first]
      : settlement === "mostly"
        ? [moneyString(total.times(MOSTLY_PAID))]
        : fullPayment;
  const method = ctx.rng.pick(["card", "check", "ach", "cash"] as const);
  return amounts
    .filter((a) => dec(a).gt(0))
    .map((amount, i) => ({
      id: ctx.id("pay"),
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      date: i === 0 ? invoice.issuedAt : [addDays(invoice.issuedAt, ctx.rng.int(3, 40)), ctx.anchor].sort()[0]!,
      amount,
      method,
    }));
}

/** A return of part of the main material from a paid invoice, settled by refund at once. */
function buildReturn(ctx: GenContext, inputs: SalesInputs, original: Invoice): Invoice | null {
  const line = original.lines.find((l) => l.category === "material");
  if (!line) return null;
  const customer = inputs.customers.find((c) => c.id === original.customerId)!;
  const pack = inputs.products.find((p) => p.id === line.productId)?.sqFtPerCarton;
  const quantity = pack
    ? dec(Math.max(1, Math.floor((Number(line.quantity) / Number(pack)) * 0.25)))
        .times(pack)
        .toString()
    : line.unit === "each"
      ? String(Math.max(1, Math.floor(Number(line.quantity) * 0.25)))
      : dec(line.quantity).times("0.25").toDecimalPlaces(2).toString();
  const lines = [{ ...line, id: ctx.id("ln"), quantity, roomIds: undefined }];
  const issuedAt = [addDays(original.issuedAt, ctx.rng.int(5, 20)), ctx.anchor].sort()[0]!;
  const { totals } = totalsFor(inputs, lines, original.jobSite, customer, original.issuedAt, false);
  return {
    ...original,
    id: ctx.id("inv"),
    quoteId: null,
    issuedAt,
    dueAt: issuedAt,
    sentAt: issuedAt,
    depositPct: "0",
    isReturn: true,
    // The credit was refunded on the spot, so it never becomes customer credit.
    creditForInvoiceId: original.id,
    refundedAt: issuedAt,
    lines,
    ...documentAmounts(totals),
  };
}

/** Numbers documents in date order: Q-2001, INV-1001, CR-5001. */
function number<T extends { number: string }>(docs: T[], prefix: string, start: number, dateOf: (d: T) => string) {
  [...docs].sort((a, b) => dateOf(a).localeCompare(dateOf(b))).forEach((d, i) => (d.number = `${prefix}${start + i}`));
}

/**
 * Twelve months of quotes, the invoices converted from them, their payments and a few returns
 * (spec section 4). Invoice totals come from the shared calculator, so they reconcile.
 */
export function buildSales(ctx: GenContext, inputs: SalesInputs): SalesFixtures {
  const plan = ctx.company.sales;
  if (!plan) return { quotes: [], invoices: [], payments: [], invoiceAdjustments: [], refunds: [] };
  const quotes = Array.from({ length: plan.quotes }, () => seasonalDate(ctx))
    .sort()
    .map((date) => buildQuote(ctx, inputs, date));
  const convertible = quotes.filter((q) => daysBetween(q.createdAt, ctx.anchor) >= 2);
  const converted = new Set(ctx.rng.sample(convertible, plan.invoices).map((q) => q.id));
  const invoices: Invoice[] = [];
  const drawn: DrawnPayment[] = [];
  const fullyPaid = new Set<string>();
  for (const quote of quotes) {
    if (!converted.has(quote.id)) {
      quote.status = openQuoteStatus(ctx, quote.createdAt);
      markSent(quote, inputs.settings.localization.documents.quoteExpiryDays);
      continue;
    }
    const invoice = buildInvoice(ctx, inputs, quote);
    const paid = paymentsFor(ctx, invoice, quote, settlementFor(ctx, invoice));
    if (moneyString(paid.reduce((s, p) => s.plus(p.amount), dec(0))) === invoice.total) fullyPaid.add(invoice.id);
    quote.status = "converted";
    markSent(quote, inputs.settings.localization.documents.quoteExpiryDays);
    quote.invoiceId = invoice.id;
    invoices.push(invoice);
    drawn.push(...paid);
  }
  const returnable = invoices.filter((i) => fullyPaid.has(i.id));
  const returns = ctx.rng
    .sample(returnable, Math.round(invoices.length * RETURN_SHARE))
    .map((inv) => buildReturn(ctx, inputs, inv))
    .filter((r): r is Invoice => r !== null);
  number(quotes, inputs.settings.localization.documents.quotePrefix, 2001, (q) => q.createdAt);
  number(invoices, inputs.settings.localization.documents.invoicePrefix, 1001, (i) => i.issuedAt);
  number(returns, "CR-", 5001, (i) => i.issuedAt);
  const payments = finishPayments(drawn, invoices, inputs.users, inputs.settings, ctx.anchor);
  return { quotes, invoices: [...invoices, ...returns], payments, invoiceAdjustments: [], refunds: [] };
}
