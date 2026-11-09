import { dec } from "../../money";
import { supplierDueDate } from "../../operations/purchasing";
import { dueDate } from "../../operations/quotes";
import type { Bill, Customer, Invoice } from "../../types";
import { findParty, text } from "../lookup";
import type { KindHandler, ParsedRow, PlanContext, RowOutcome } from "../plan";
import type { CellProblem } from "../types";

/** The line every opening invoice carries: the balance brought over, untaxed and at no cost. */
const OPENING_LINE = "Opening balance from the previous system";
const NO_ADDRESS = { street: "", city: "", state: "", zip: "" };

/** Dates and balance shared by opening invoices and bills; an issue date may not be in the future. */
function opening(
  row: ParsedRow,
  ctx: PlanContext,
): { problems: CellProblem[] } | { issued: string; balance: string; due: string | null } {
  const issued = text(row, "issued");
  const balance = text(row, "balance");
  if (issued > ctx.today) return { problems: [{ field: "issued", message: "The issue date is in the future." }] };
  if (dec(balance).isZero()) return { problems: [{ field: "balance", message: "An open balance is more than zero." }] };
  return { issued, balance, due: row.due as string | null };
}

/** An opening invoice in the app's shape: one untaxed line for the balance, sent on its issue date. */
function openingInvoice(
  id: string,
  number: string,
  customer: Customer,
  on: { issued: string; due: string; balance: string },
  ctx: PlanContext,
  prior?: Invoice,
): Invoice {
  const rep = ctx.world.users.find((u) => u.id === customer.salesRepId);
  const warehouse = ctx.world.locations.find((l) => l.isDefault) ?? ctx.world.locations[0]!;
  const site = customer.addresses.find((a) => a.id === (customer.defaultJobSiteId ?? customer.defaultBillingId));
  return {
    id,
    number,
    quoteId: null,
    customerId: customer.id,
    salesRepId: customer.salesRepId,
    branchId: rep?.branchId ?? warehouse.branchId,
    issuedAt: on.issued,
    dueAt: on.due,
    createdBy: prior?.createdBy ?? ctx.actorId ?? "",
    sentAt: `${on.issued}T09:00`,
    sentBy: prior?.sentBy ?? ctx.actorId,
    voidedAt: null,
    voidReason: null,
    depositPct: "0",
    isReturn: false,
    creditForInvoiceId: null,
    refundedAt: null,
    locationId: warehouse.id,
    jobSite: site ? { street: site.street, city: site.city, state: site.state, zip: site.zip } : NO_ADDRESS,
    lines: [
      {
        id: prior?.lines[0]?.id ?? ctx.newId("line"),
        description: OPENING_LINE,
        category: "service",
        unit: "each",
        quantity: "1",
        unitPrice: on.balance,
        unitCost: "0.00",
      },
    ],
    taxRule: null,
    taxSource: { kind: "none", label: "Opening balance, tax was charged in the previous system" },
    taxOverride: null,
    taxExempt: false,
    subtotal: on.balance,
    tax: "0.00",
    total: on.balance,
    cost: "0.00",
  };
}

/**
 * Open customer invoices, the opening receivables (spec G1): matched on invoice number. The
 * due date defaults to the customer's terms. An invoice made in the app, or one that already
 * has payments or credits, is left alone: change it on the invoice instead.
 */
function resolveInvoice(row: ParsedRow, ctx: PlanContext): RowOutcome {
  const key = text(row, "customer");
  const customer = findParty(ctx.world.customers, key);
  if (!customer)
    return { problems: [{ field: "customer", message: `No customer matches “${key}”. Import customers first.` }] };
  const on = opening(row, ctx);
  if ("problems" in on) return on;
  const number = text(row, "number");
  const dates = { ...on, due: on.due ?? dueDate(on.issued, customer.terms) };
  const existing = ctx.world.invoices.find((i) => i.number.toLowerCase() === number.toLowerCase());
  if (!existing) {
    const invoice = openingInvoice(ctx.newId("inv"), number, customer, dates, ctx);
    return { action: "create", label: number, writes: [{ collection: "invoices", record: invoice }] };
  }
  if (existing.lines[0]?.description !== OPENING_LINE) {
    return { action: "skip", label: number, writes: [], note: "Made in the app; change it on the invoice." };
  }
  const touched =
    ctx.world.payments.some((p) => p.invoiceId === existing.id && p.status !== "voided" && p.status !== "rejected") ||
    ctx.world.invoiceAdjustments.some((a) => a.invoiceId === existing.id);
  if (touched)
    return { action: "skip", label: number, writes: [], note: "Has payments or credits; change it on the invoice." };
  const next = openingInvoice(existing.id, existing.number, customer, dates, ctx, existing);
  if (JSON.stringify(next) === JSON.stringify(existing))
    return { action: "skip", label: number, writes: [], note: "Nothing changed." };
  return { action: "update", label: number, writes: [{ collection: "invoices", record: next }] };
}

/**
 * Open supplier bills, the opening payables (spec G1, D3): matched on the supplier and its bill
 * number. The due date defaults to the supplier's terms. A bill entered against a purchase order,
 * or one with supplier payments, is left alone.
 */
function resolveBill(row: ParsedRow, ctx: PlanContext): RowOutcome {
  const key = text(row, "supplier");
  const supplier = findParty(ctx.world.suppliers, key);
  if (!supplier)
    return { problems: [{ field: "supplier", message: `No supplier matches “${key}”. Import suppliers first.` }] };
  const on = opening(row, ctx);
  if ("problems" in on) return on;
  const number = text(row, "number");
  const label = `${supplier.name} ${number}`;
  const existing = ctx.world.bills.find(
    (b) => b.supplierId === supplier.id && b.number.toLowerCase() === number.toLowerCase(),
  );
  const bill: Bill = {
    id: existing?.id ?? ctx.newId("bill"),
    number: existing?.number ?? number,
    supplierId: supplier.id,
    poId: null,
    receiptIds: [],
    issuedAt: on.issued,
    dueAt: on.due ?? supplierDueDate(on.issued, supplier.terms),
    total: on.balance,
    matchIssues: [],
    files: existing?.files ?? [],
  };
  if (!existing) return { action: "create", label, writes: [{ collection: "bills", record: bill }] };
  if (existing.poId)
    return { action: "skip", label, writes: [], note: "Entered from a purchase order; change it there." };
  const paid = ctx.world.supplierPayments.some(
    (p) => p.status !== "voided" && p.allocations.some((a) => a.billId === existing.id),
  );
  if (paid) return { action: "skip", label, writes: [], note: "Has supplier payments." };
  if (JSON.stringify(bill) === JSON.stringify(existing))
    return { action: "skip", label, writes: [], note: "Nothing changed." };
  return { action: "update", label, writes: [{ collection: "bills", record: bill }] };
}

const DATE_FIELDS = (issuedAliases: string[]) =>
  [
    {
      key: "issued",
      label: "Issue date",
      type: "date",
      required: true,
      aliases: issuedAliases,
      examples: ["2026-09-12", "10/03/2026"],
    },
    { key: "due", label: "Due date", type: "date", aliases: ["due", "due on"], examples: ["2026-10-12", ""] },
    {
      key: "balance",
      label: "Open balance",
      type: "money",
      required: true,
      aliases: ["balance", "amount due", "balance due", "open amount", "amount"],
      examples: ["4820.00", "$1,275.50"],
    },
  ] as const;

/** The open customer invoices kind. */
export const INVOICES: KindHandler = {
  labelField: "number",
  duplicateKey: (row) => text(row, "number").toLowerCase(),
  resolve: resolveInvoice,
  def: {
    kind: "invoices",
    label: "Open customer invoices",
    description: "What customers still owe from the previous system: the opening receivables.",
    module: "core",
    matchOn: "invoice number",
    fields: [
      {
        key: "number",
        label: "Invoice number",
        type: "text",
        required: true,
        aliases: ["invoice", "invoice no", "invoice #", "inv"],
        examples: ["OB-4471", "OB-4472"],
      },
      {
        key: "customer",
        label: "Customer",
        type: "text",
        required: true,
        aliases: ["customer id", "customer email", "account"],
        examples: ["CUST-1001", "avery.collins@mail.example"],
      },
      ...DATE_FIELDS(["date", "invoice date", "issue date"]),
    ],
  },
};

/** The open supplier bills kind. */
export const BILLS: KindHandler = {
  labelField: "number",
  duplicateKey: (row) => `${text(row, "supplier").toLowerCase()}|${text(row, "number").toLowerCase()}`,
  resolve: resolveBill,
  def: {
    kind: "bills",
    label: "Open supplier bills",
    description: "What the company still owes suppliers from the previous system: the opening payables.",
    module: "core",
    matchOn: "supplier and bill number",
    fields: [
      {
        key: "number",
        label: "Bill number",
        type: "text",
        required: true,
        aliases: ["bill", "bill no", "supplier invoice", "vendor invoice"],
        examples: ["RW-88120", "CT-5507"],
      },
      {
        key: "supplier",
        label: "Supplier",
        type: "text",
        required: true,
        aliases: ["vendor", "supplier name", "supplier id"],
        examples: ["Ridgeway Flooring Supply", "VEN-202"],
      },
      ...DATE_FIELDS(["date", "bill date", "issue date"]),
    ],
  },
};
