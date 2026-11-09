import { computeTotals, type DocLine } from "../documents";
import { dec, maxDec, moneyString, sum } from "../money";
import type { Customer, Invoice, Job, PaymentTerms, Product } from "../types";
import type { LocalizationSettings } from "../types/settings";
import { dueDate, taxContextFor } from "./quotes";

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
