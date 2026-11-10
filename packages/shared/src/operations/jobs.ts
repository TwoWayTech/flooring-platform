import { computeTotals, productTaxCategory, type DocLine } from "../documents";
import { dec, maxDec, moneyString, roundMoney, sum } from "../money";
import { rollAreaSqFt } from "../units";
import { defaultAddress, plainAddress } from "../customers";
import type { Crew, Customer, Invoice, Job, PaymentTerms, Product, Roll } from "../types";
import type { LocalizationSettings } from "../types/settings";
import { dueDate, taxContextFor } from "./quotes";

/** Loaded hourly cost of a W-2 crew; subcontractors charge 62 % of the labor billed instead. */
const CREW_HOURLY_COST = "38.00";
const SUB_SHARE_OF_LABOR = "0.62";

/** Labor billed on an invoice or quote: the lines taxed as installation labor. */
export function laborLines(doc: Pick<Invoice, "lines">) {
  return doc.lines.filter((l) => l.category === "labor");
}

/**
 * Job costing (spec "Installation"): materials at the document's unit cost; labor hours from the
 * area installed (2.2 h per 100 sq ft plus 2 h set-up), costed at crew hours or the
 * subcontractor's share of the labor billed; revenue as the subtotal. Margin is derived, not stored.
 */
export function jobCostFrom(doc: Pick<Invoice, "lines" | "subtotal">, crew: Pick<Crew, "kind">) {
  const labor = laborLines(doc);
  const installSqFt = labor.filter((l) => l.unit === "sq_ft").reduce((s, l) => s.plus(l.quantity), dec(0));
  const laborHours = installSqFt.dividedBy(100).times("2.2").plus(2).toDecimalPlaces(1);
  const billedLabor = labor.reduce((s, l) => s.plus(roundMoney(dec(l.quantity).times(l.unitPrice))), dec(0));
  const laborCost = crew.kind === "crew" ? laborHours.times(CREW_HOURLY_COST) : billedLabor.times(SUB_SHARE_OF_LABOR);
  return {
    materials: doc.lines
      .filter((l) => l.category === "material")
      .map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        cost: moneyString(dec(l.quantity).times(l.unitCost)),
      })),
    laborHours: laborHours.toString(),
    laborCost: moneyString(laborCost),
    revenue: doc.subtotal,
  };
}

/**
 * An installation job scheduled for an invoice (feature batch 2, H flow 1): at the job site, by
 * one crew, costed from the invoice, as long as the labor hours (at least 2, at most 9 a day).
 */
export function jobFromInvoice(
  invoice: Invoice,
  crew: Crew,
  input: { id: string; number: string; date: string; startHour: number },
): Job {
  const costing = jobCostFrom(invoice, crew);
  const material = invoice.lines.find((l) => l.category === "material");
  return {
    id: input.id,
    number: input.number,
    customerId: invoice.customerId,
    invoiceId: invoice.id,
    crewId: crew.id,
    date: input.date,
    startHour: input.startHour,
    durationHours: Math.min(9, Math.max(2, Math.ceil(Number(costing.laborHours)))),
    status: "scheduled",
    address: invoice.jobSite,
    scope: material?.description ?? "Installation",
    ...costing,
    photos: [],
    signedOffAt: null,
    signedBy: null,
    notes: "",
  };
}

/**
 * What a signed-off job does to its invoice (spec B6): a balance held until installation becomes
 * due under the customer's terms from the completion day, and an invoice not yet sent is marked
 * sent then. An invoice that already had a due date keeps it.
 */
export function invoiceAfterInstallation(
  invoice: Invoice,
  completedOn: string,
  terms: PaymentTerms,
  by: string,
): Invoice {
  return {
    ...invoice,
    dueAt: invoice.dueAt ?? dueDate(completedOn, terms),
    sentAt: invoice.sentAt ?? completedOn,
    sentBy: invoice.sentAt ? invoice.sentBy : by,
  };
}

/**
 * Invoice lines for a job that has none (spec B6 "Create invoice from this job"): its materials at
 * their catalog price (matched by description, else at cost), then one labor line carrying the
 * rest of the job's agreed revenue, never less than the labor cost.
 */
export function linesFromJob(job: Job, products: readonly Product[], newId: () => string): DocLine[] {
  const materials = job.materials.map((m): DocLine => {
    const product = products.find((p) => `${p.brand} ${p.name}` === m.description || p.name === m.description);
    const unitCost = dec(m.cost)
      .div(dec(m.quantity).isZero() ? 1 : m.quantity)
      .toDecimalPlaces(4)
      .toString();
    return {
      id: newId(),
      productId: product?.id,
      description: m.description,
      category: "material",
      unit: m.unit,
      quantity: m.quantity,
      unitPrice: product?.price ?? moneyString(unitCost),
      unitCost,
    };
  });
  const goods = sum(materials.map((l) => dec(l.quantity).times(l.unitPrice)));
  const labor = maxDec(dec(job.revenue).minus(goods), dec(job.laborCost));
  return [
    ...materials,
    {
      id: newId(),
      description: `Installation labor, ${job.laborHours} hours`,
      category: "labor",
      unit: "each",
      quantity: "1",
      unitPrice: moneyString(labor),
      unitCost: moneyString(job.laborCost),
    },
  ];
}

/** A new invoice for a job, dated today with the customer's terms, taxed by the job site (spec B6). */
export function invoiceFromJob(
  job: Job,
  customer: Customer,
  lines: DocLine[],
  localization: Pick<LocalizationSettings, "tax" | "region">,
  input: { id: string; number: string; issuedAt: string; createdBy: string; branchId: string; locationId: string },
): Invoice {
  const ctx = taxContextFor(localization, job.address, customer, input.issuedAt, false);
  const totals = computeTotals(lines, ctx);
  const installed = job.signedOffAt?.slice(0, 10) ?? null;
  return {
    id: input.id,
    number: input.number,
    quoteId: null,
    customerId: customer.id,
    salesRepId: customer.salesRepId,
    branchId: input.branchId,
    locationId: input.locationId,
    issuedAt: input.issuedAt,
    dueAt: dueDate(installed ?? input.issuedAt, customer.terms),
    createdBy: input.createdBy,
    sentAt: null,
    sentBy: null,
    voidedAt: null,
    voidReason: null,
    depositPct: "0",
    isReturn: false,
    creditForInvoiceId: null,
    refundedAt: null,
    jobSite: job.address,
    lines,
    taxRule: ctx.rule
      ? {
          state: ctx.rule.state,
          jurisdiction: ctx.rule.jurisdiction,
          ratePct: ctx.rule.ratePct,
          version: ctx.rule.version,
        }
      : null,
    taxSource: ctx.source,
    taxOverride: null,
    taxExempt: ctx.exempt,
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    cost: totals.cost,
  };
}

/**
 * A one-line invoice for a length cut from a roll (spec C1 "Create a new invoice"): the roll's
 * product by the sq ft (length × width), its price, the roll's own cost, taxed by the
 * customer's job site, tied to the roll so the reservation holds it.
 */
export function invoiceFromRoll(
  roll: Pick<Roll, "id" | "widthFt" | "costPerSqFt" | "locationId">,
  product: Product,
  customer: Customer,
  lengthFt: string,
  localization: Pick<LocalizationSettings, "tax" | "region">,
  input: { id: string; lineId: string; number: string; issuedAt: string; createdBy: string; branchId: string },
): Invoice {
  const sqFt = rollAreaSqFt(roll.widthFt, lengthFt).toDecimalPlaces(2);
  const line: DocLine = {
    id: input.lineId,
    productId: product.id,
    description: `${product.brand} ${product.name}`,
    category: productTaxCategory(product),
    unit: "sq_ft",
    quantity: sqFt.toString(),
    unitPrice: product.price,
    unitCost: roll.costPerSqFt,
    rollId: roll.id,
  };
  const site = plainAddress(defaultAddress(customer, "job_site"));
  const job = { address: site, signedOffAt: null } as unknown as Job;
  return invoiceFromJob(job, customer, [line], localization, { ...input, locationId: roll.locationId });
}
