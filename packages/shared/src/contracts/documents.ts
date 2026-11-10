import { computeTotals, type DocLine } from "../documents";
import { dec, moneyString, roundMoney, sum } from "../money";
import { dueDate, taxContextFor } from "../operations/quotes";
import { supplierDueDate } from "../operations/purchasing";
import type { Bill, Contract, ContractLine, Customer, Invoice, LocalizationSettings, Supplier } from "../types";

/** What identifies a new contract document. */
interface DocIds {
  id: string;
  number: string;
  issuedAt: string;
  createdBy: string;
  billingId: string;
}

/** Per-line money from a billing or a release. */
interface LineAmount {
  lineId: string;
  gross: string;
  withheld: string;
  released: string;
}

function docLine(line: ContractLine, id: string, amount: string, cost: string): DocLine {
  return {
    id,
    description: `${line.code} ${line.description}`,
    category: line.category,
    unit: "each",
    quantity: "1",
    unitPrice: amount,
    unitCost: cost,
  };
}

/** The share of a line's estimated cost for this billing, so margin plans are not paid on 100 % (plan K-10). */
const costShare = (line: ContractLine, gross: string) =>
  dec(line.scheduledValue).isZero()
    ? "0.00"
    : moneyString(roundMoney(dec(line.estimatedCost).times(gross).dividedBy(line.scheduledValue)));

/**
 * The invoice for a customer billing or release (ADR 0026). `total = subtotal + tax − withheld +
 * released`, so retained money is not in receivables until it is released. Tax follows the contract:
 * on the gross when billed, on the part not retained with the rest taxed at release, or none when
 * the contractor pays the tax.
 */
export function contractInvoice(
  contract: Contract,
  customer: Customer,
  lines: readonly ContractLine[],
  amounts: readonly LineAmount[],
  localization: Pick<LocalizationSettings, "tax" | "region">,
  ids: DocIds,
): Invoice {
  const lineOf = (lineId: string) => lines.find((l) => l.id === lineId)!;
  const billed = amounts.filter((a) => dec(a.gross).gt(0) || dec(a.gross).lt(0));
  const docLines = billed.map((a) =>
    docLine(lineOf(a.lineId), `${ids.id}-${a.lineId}`, a.gross, costShare(lineOf(a.lineId), a.gross)),
  );
  const ctx = taxContextFor(localization, contract.jobSite, customer, ids.issuedAt, false);
  const taxBase = (a: LineAmount): string => {
    if (contract.taxTreatment === "contractor_pays") return "0";
    if (contract.taxTreatment === "on_billing") return a.gross;
    return moneyString(dec(a.gross).minus(a.withheld).plus(a.released));
  };
  const taxLines = amounts.map((a) => docLine(lineOf(a.lineId), `${ids.id}-tax-${a.lineId}`, taxBase(a), "0"));
  const taxed = computeTotals(taxLines, ctx);
  const subtotal = sum(billed.map((a) => a.gross));
  const withheld = sum(amounts.map((a) => a.withheld));
  const released = sum(amounts.map((a) => a.released));
  const tax = dec(taxed.tax);
  return {
    id: ids.id,
    number: ids.number,
    quoteId: null,
    customerId: customer.id,
    salesRepId: contract.salesRepId,
    branchId: contract.branchId,
    locationId: contract.locationId,
    issuedAt: ids.issuedAt,
    dueAt: dueDate(ids.issuedAt, customer.terms),
    createdBy: ids.createdBy,
    sentAt: null,
    sentBy: null,
    voidedAt: null,
    voidReason: null,
    depositPct: "0",
    isReturn: false,
    creditForInvoiceId: null,
    refundedAt: null,
    jobSite: contract.jobSite,
    lines: docLines,
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
    subtotal: moneyString(subtotal),
    tax: moneyString(tax),
    total: moneyString(subtotal.plus(tax).minus(withheld).plus(released)),
    cost: moneyString(sum(docLines.map((l) => l.unitCost))),
    contractId: contract.id,
    billingId: ids.billingId,
    retainageWithheld: moneyString(withheld),
    retainageReleased: moneyString(released),
  };
}

/** The supplier bill for a subcontract billing or release (ADR 0026): no PO or receipts, retainage held off the total. */
export function contractBill(
  contract: Contract,
  supplier: Supplier,
  amounts: { gross: string; withheld: string; released: string },
  ids: Pick<DocIds, "id" | "number" | "issuedAt" | "billingId">,
): Bill {
  const total = dec(amounts.gross).minus(amounts.withheld).plus(amounts.released);
  return {
    id: ids.id,
    number: ids.number,
    supplierId: supplier.id,
    poId: null,
    receiptIds: [],
    issuedAt: ids.issuedAt,
    dueAt: supplierDueDate(ids.issuedAt, supplier.terms),
    total: moneyString(total),
    matchIssues: [],
    files: [],
    contractId: contract.id,
    billingId: ids.billingId,
    kind: dec(amounts.released).gt(0) ? "retainage_release" : "progress",
    gross: amounts.gross,
    retainageWithheld: amounts.withheld,
    retainageReleased: amounts.released,
  };
}
